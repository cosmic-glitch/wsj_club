import { list, put } from "@vercel/blob";
import bcrypt from "bcryptjs";

/**
 * User / classroom repository (Blob-backed).
 *
 * The single source of truth for who can log in, their role, and — for students
 * — which parent's classroom they belong to. This is deliberately the ONLY
 * module that reads or writes user blobs, so a later move to a real database is
 * a change to this one file (the auth layer and the routes just call these
 * functions).
 *
 * Storage: one blob per user at `users/<username>.json` (deterministic pathname,
 * no random suffix, so a user is looked up by key). Reads go through the Blob
 * API (`list` + `fetch(..., no-store)`), never a long-lived cached URL. The set
 * is tiny (a handful of logins), so listing everyone on each read is cheap.
 *
 * Passwords are stored ONLY as bcrypt hashes (bcryptjs, 10 rounds — the same
 * scheme as the old AUTH_USERS env var and the foliotracker project).
 *
 * TERMINOLOGY: what the app calls a PARENT account was originally called a
 * "teacher", and the stored blobs keep the legacy names — `role: "teacher"`
 * and the `teacherId` field — so no record needs migrating. The conversion
 * happens HERE (fromStored/toStored); nothing above this module ever sees the
 * legacy names.
 */

export type UserRole = "parent" | "student";

export type User = {
  username: string; // login id — globally unique, lowercased
  displayName: string; // shown in the UI, e.g. "Anusha"
  passwordHash: string; // bcrypt
  role: UserRole;
  parentId?: string; // students: owning parent's username; parents: unset
  active: boolean; // false blocks login but keeps the record + history
  createdBy?: string; // audit — who created this record
  createdAt: string; // ISO
};

/**
 * The on-disk (Blob) shape — the legacy "teacher" era field names. Every stored
 * record uses `role: "teacher"` + `teacherId`; we keep writing them so the
 * store stays uniform and old records never need a migration.
 */
type StoredUser = Omit<User, "role" | "parentId"> & {
  role: "teacher" | "student";
  teacherId?: string;
};

function fromStored(raw: StoredUser): User {
  const { role, teacherId, ...rest } = raw;
  return {
    ...rest,
    role: role === "student" ? "student" : "parent",
    ...(teacherId ? { parentId: teacherId } : {}),
  };
}

function toStored(u: User): StoredUser {
  const { role, parentId, ...rest } = u;
  return {
    ...rest,
    role: role === "parent" ? "teacher" : "student",
    ...(parentId ? { teacherId: parentId } : {}),
  };
}

/** The shape safe to send to the browser — never includes the hash. */
export type PublicUser = Omit<User, "passwordHash">;

/** A user-facing error with a machine code so routes can map it to a status. */
export class UserError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "UserError";
  }
}

const PREFIX = "users/";
const BCRYPT_ROUNDS = 10;
const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;
const CACHE_TTL_MS = 15_000;

function pathFor(username: string): string {
  return `${PREFIX}${username}.json`;
}

/** Strip the password hash for anything that leaves the server. */
export function toPublic(u: User): PublicUser {
  const rest = { ...u } as Partial<User>;
  delete rest.passwordHash;
  return rest as PublicUser;
}

// A short per-instance cache so gated requests don't each re-list Blob. Kept
// brief so a deactivation / password reset takes effect quickly. Writes clear it.
let cache: { at: number; users: Map<string, User> } | null = null;

async function loadAll(force = false): Promise<Map<string, User>> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.users;
  }
  let blobs;
  try {
    ({ blobs } = await list({ prefix: PREFIX }));
  } catch (err) {
    // Transient Blob failure: serve the last good cache if we have one rather
    // than pretending there are no users (which would log everyone out). If we
    // have nothing cached, return empty and let the auth layer's env fallback
    // decide — fail closed for unknown users.
    console.error("Loading users from Blob failed:", err);
    return cache?.users ?? new Map();
  }
  const users = new Map<string, User>();
  await Promise.all(
    blobs
      .filter((b) => b.pathname.endsWith(".json"))
      .map(async (b) => {
        try {
          // Cache-bust the CDN with the blob's uploadedAt. The public Blob URL
          // is edge-cached, so after an overwrite (e.g. a password reset) a plain
          // fetch can serve a STALE copy from a previously-warmed edge — even with
          // no-store, which only governs our own client cache. list() metadata is
          // read-after-write consistent, so keying the URL by uploadedAt turns a
          // changed record into a fresh cache key and forces the current content.
          const v = new Date(b.uploadedAt).getTime();
          const res = await fetch(`${b.url}?v=${v}`, { cache: "no-store" });
          const raw = (await res.json()) as StoredUser;
          if (raw && typeof raw.username === "string") {
            users.set(raw.username, fromStored(raw));
          }
        } catch (err) {
          console.error("Skipping unreadable user blob:", b.pathname, err);
        }
      })
  );
  cache = { at: Date.now(), users };
  return users;
}

/** Force the next read to re-list Blob (used after a write). */
export function invalidateUserCache(): void {
  cache = null;
}

/** Look up a single user by username, or null. */
export async function getUser(username: string): Promise<User | null> {
  if (!username) return null;
  const all = await loadAll();
  return all.get(username) ?? null;
}

/**
 * Verify a login. Returns the user on success, or null if the credentials are
 * wrong OR the account is deactivated. (Callers only need "is this a valid,
 * active login" — never leak which of the two it was.)
 */
export async function verifyLogin(
  username: string,
  password: string
): Promise<User | null> {
  const u = await getUser(username);
  if (!u || u.active === false) return null;
  try {
    if (await bcrypt.compare(password, u.passwordHash)) return u;
  } catch {
    /* fall through */
  }
  return null;
}

/** A parent's classroom: their active + inactive students, by display name. */
export async function listStudents(parentId: string): Promise<PublicUser[]> {
  const all = await loadAll();
  return [...all.values()]
    .filter((u) => u.role === "student" && u.parentId === parentId)
    .map(toPublic)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Every parent (owner use). */
export async function listParents(): Promise<PublicUser[]> {
  const all = await loadAll();
  return [...all.values()]
    .filter((u) => u.role === "parent")
    .map(toPublic)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Write a full record (create or overwrite, in the legacy stored shape) and clear the cache. */
async function save(user: User): Promise<void> {
  await put(pathFor(user.username), JSON.stringify(toStored(user), null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  invalidateUserCache();
}

/**
 * Write a complete record verbatim (reusing an existing hash) — used by the
 * one-time migration seed, which carries hashes over from AUTH_USERS rather than
 * re-hashing. Normal app flows use createUser (which hashes a plaintext).
 */
export async function upsertUser(user: User): Promise<void> {
  await save(user);
}

export type CreateUserInput = {
  username: string;
  displayName: string;
  password: string; // plaintext — hashed here
  role: UserRole;
  parentId?: string;
  active?: boolean;
};

/**
 * Create a new user. Enforces username format + global uniqueness and the
 * role/parent invariant (a student must have a parent; a parent must not).
 * Throws UserError on any violation. Returns the public record (no hash).
 */
export async function createUser(
  input: CreateUserInput,
  createdBy?: string
): Promise<PublicUser> {
  const username = input.username.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw new UserError(
      "invalid-username",
      "Username must be 3–32 characters: lowercase letters, numbers, - or _."
    );
  }
  if (input.role === "student" && !input.parentId) {
    throw new UserError("missing-parent", "A student must belong to a parent.");
  }
  if (input.role === "parent" && input.parentId) {
    throw new UserError("parent-has-parent", "A parent can't belong to a parent.");
  }
  if (!input.password) {
    throw new UserError("weak-password", "A password is required.");
  }
  const all = await loadAll(true); // force-fresh so the uniqueness check is real
  if (all.has(username)) {
    throw new UserError("username-taken", "That username is already taken.");
  }
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const user: User = {
    username,
    displayName: input.displayName.trim() || username,
    passwordHash,
    role: input.role,
    ...(input.role === "student" ? { parentId: input.parentId } : {}),
    active: input.active ?? true,
    createdBy,
    createdAt: new Date().toISOString(),
  };
  await save(user);
  return toPublic(user);
}

/** Set a new password (hashes it). */
export async function setPassword(username: string, newPassword: string): Promise<void> {
  if (!newPassword) {
    throw new UserError("weak-password", "A password is required.");
  }
  const u = await getUser(username);
  if (!u) throw new UserError("not-found", "User not found.");
  u.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await save(u);
}

/** Change a user's display name. */
export async function rename(username: string, displayName: string): Promise<void> {
  const u = await getUser(username);
  if (!u) throw new UserError("not-found", "User not found.");
  u.displayName = displayName.trim() || u.username;
  await save(u);
}

/** Activate / deactivate a user (soft-delete). */
export async function setActive(username: string, active: boolean): Promise<void> {
  const u = await getUser(username);
  if (!u) throw new UserError("not-found", "User not found.");
  u.active = active;
  await save(u);
}
