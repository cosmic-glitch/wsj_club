import bcrypt from "bcryptjs";
import { dbInsert, dbSelect, dbUpsert } from "@/lib/db";

/**
 * User / classroom repository (Postgres — the rc_users table).
 *
 * The single source of truth for who can log in, their role, and — for students
 * — which parent's classroom they belong to. This is deliberately the ONLY
 * module that reads or writes user records; the auth layer and the routes just
 * call these functions.
 *
 * The DB stores the modern field names natively (role "parent"/"student",
 * parent_id) — the legacy Blob store's "teacher"/teacherId era ended with the
 * Supabase migration (PLAN-supabase.md). Reads are single consistent queries;
 * a DB failure THROWS so callers surface an error instead of silently treating
 * everyone as logged out.
 *
 * Passwords are stored ONLY as bcrypt hashes (bcryptjs, 10 rounds).
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

const BCRYPT_ROUNDS = 10;
const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;

/** Strip the password hash for anything that leaves the server. */
export function toPublic(u: User): PublicUser {
  const rest = { ...u } as Partial<User>;
  delete rest.passwordHash;
  return rest as PublicUser;
}

function fromRow(r: Record<string, unknown>): User | null {
  if (typeof r.username !== "string") return null;
  return {
    username: r.username,
    displayName:
      typeof r.display_name === "string" ? r.display_name : r.username,
    passwordHash: typeof r.password_hash === "string" ? r.password_hash : "",
    role: r.role === "student" ? "student" : "parent",
    ...(typeof r.parent_id === "string" && r.parent_id
      ? { parentId: r.parent_id }
      : {}),
    active: r.active !== false,
    ...(typeof r.created_by === "string" ? { createdBy: r.created_by } : {}),
    createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : "",
  };
}

function toRow(u: User): Record<string, unknown> {
  return {
    username: u.username,
    display_name: u.displayName,
    password_hash: u.passwordHash,
    role: u.role,
    parent_id: u.parentId ?? null,
    active: u.active !== false,
    created_by: u.createdBy ?? null,
    ...(u.createdAt ? { created_at: u.createdAt } : {}),
  };
}

async function selectUsers(query: string): Promise<User[]> {
  const rows = await dbSelect("rc_users", query);
  if (rows === null) throw new Error("users DB read failed");
  return rows.map(fromRow).filter((u): u is User => u !== null);
}

/** Look up a single user by username, or null. */
export async function getUser(username: string): Promise<User | null> {
  if (!username) return null;
  const users = await selectUsers(
    `?username=eq.${encodeURIComponent(username)}&select=*`
  );
  return users[0] ?? null;
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
  const users = await selectUsers(
    `?role=eq.student&parent_id=eq.${encodeURIComponent(parentId)}&select=*`
  );
  return users
    .map(toPublic)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Every parent (owner use). */
export async function listParents(): Promise<PublicUser[]> {
  const users = await selectUsers("?role=eq.parent&select=*");
  return users
    .map(toPublic)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Overwrite an existing record (rename / reset / deactivate). */
async function save(user: User): Promise<void> {
  const ok = await dbUpsert("rc_users", toRow(user), "username");
  if (!ok) throw new Error("users DB write failed");
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
 * Create a new user. Enforces username format + the role/parent invariant (a
 * student must have a parent; a parent must not). Global uniqueness is the
 * table's primary key — a duplicate insert conflicts, it can never silently
 * overwrite. Throws UserError on any violation. Returns the public record.
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
  const status = await dbInsert("rc_users", toRow(user));
  if (status === "conflict") {
    throw new UserError("username-taken", "That username is already taken.");
  }
  if (status !== "ok") throw new Error("users DB write failed");
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
