import crypto from "crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { getUser, verifyLogin, type User } from "@/lib/users";

/**
 * Username/password auth for the voice quiz + the parent (Scores/Students) area.
 *
 * Exists to gate the paid OpenAI calls behind a login so the public site can't
 * run up charges, and to scope each parent to their own classroom.
 *
 * Users now live in the Blob-backed repository (`lib/users.ts`) — one record per
 * login with a role (parent/student) and, for students, the owning parent.
 * This module keeps the cookie/HMAC machinery and derives role/identity by
 * looking the user up in that repository.
 *
 * - A successful login sets an httpOnly cookie: the username plus an HMAC
 *   signature (`AUTH_SECRET`) so it can't be forged. The cookie carries only the
 *   username; role/classroom are looked up fresh from the repository.
 * - Owner (may create parent accounts) is an env capability: `OWNER_USERS`
 *   (comma-separated). Fail closed if unset — nobody is an owner.
 *
 * Transitional env fallback: until the migration seed has run, a username absent
 * from the repository falls back to the legacy `AUTH_USERS` (base64 JSON of
 * `{ username: bcryptHash }`) and `ADMIN_USERS` env vars, so a mid-rollout gap
 * can't lock anyone out. Remove the fallback once the seed is confirmed in prod.
 *
 * Why AUTH_USERS is base64: bcrypt hashes contain `$`, which Next.js's `.env`
 * loader expands as a variable reference; base64-encoding the whole map sidesteps
 * that and keeps the value identical between local `.env.local` and Vercel.
 */

const COOKIE_NAME = "wsj_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * Legacy fallback: username -> bcrypt hash, parsed from AUTH_USERS (base64 JSON).
 * Consulted only for a username that isn't in the Blob repository yet (the
 * transitional window before/after the migration seed). Remove once the seed is
 * confirmed in production.
 */
function getUsers(): Record<string, string> {
  const raw = process.env.AUTH_USERS;
  if (!raw) return {};
  let text = raw.trim();
  // Normally base64-encoded JSON; fall back to plain JSON if it already looks so.
  if (!text.startsWith("{")) {
    try {
      const decoded = Buffer.from(text, "base64").toString("utf8").trim();
      if (decoded.startsWith("{")) text = decoded;
    } catch {
      /* not base64 — fall through */
    }
  }
  try {
    return JSON.parse(text) as Record<string, string>;
  } catch {
    console.error("AUTH_USERS is not valid (base64-encoded) JSON");
    return {};
  }
}

function secret(): string {
  // A stable default keeps local dev working; production sets AUTH_SECRET.
  return process.env.AUTH_SECRET || "wsj-club-dev-secret-change-me";
}

function sign(username: string): string {
  return crypto.createHmac("sha256", secret()).update(username).digest("hex");
}

/** Constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Check a username/password pair. Prefers the Blob repository (which also
 * enforces the active flag); falls back to the legacy AUTH_USERS env only for a
 * username the repository doesn't know yet.
 */
export async function verifyCredentials(
  username: string,
  password: string
): Promise<boolean> {
  const record = await getUser(username);
  if (record) return (await verifyLogin(username, password)) !== null;

  // Transitional fallback: a user not yet migrated into the repository.
  const hash = getUsers()[username];
  if (typeof hash !== "string") return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/** The signed cookie value to store for a logged-in user. */
export function makeSessionToken(username: string): string {
  return `${username}.${sign(username)}`;
}

/**
 * Verify a cookie's HMAC and return the username it encodes, or null. This is a
 * pure signature check — it does NOT confirm the user still exists (that lookup
 * is async and lives in currentUser).
 */
export function readSessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const username = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(signature, sign(username))) return null;
  return username;
}

/**
 * Read the logged-in username from the request cookies (server-side), confirming
 * the user still exists and is active. A deactivated user (or one removed from
 * the repository) is treated as logged out even with a valid cookie.
 */
export async function currentUser(): Promise<string | null> {
  const store = await cookies();
  const username = readSessionToken(store.get(COOKIE_NAME)?.value);
  if (!username) return null;

  const record = await getUser(username);
  if (record) return record.active === false ? null : username;

  // Transitional fallback: a user still only in the legacy env var.
  if (username in getUsers()) return username;
  return null;
}

/** The full record for the logged-in user (role/classroom), or null. */
export async function currentUserRecord(): Promise<User | null> {
  const store = await cookies();
  const username = readSessionToken(store.get(COOKIE_NAME)?.value);
  if (!username) return null;
  return getUser(username);
}

/**
 * Legacy fallback: the parent usernames from the `ADMIN_USERS` env var
 * (comma-separated). Consulted only for a username not yet in the repository.
 */
function getAdminUsers(): string[] {
  return (process.env.ADMIN_USERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Owner usernames from the `OWNER_USERS` env var (comma-separated). An owner is
 * a parent who may ALSO create parent accounts. Owner-ness is an env capability
 * (not a writable field on a record), so it can't be granted by writing a blob.
 * Fail closed: unset ⇒ nobody is an owner.
 */
function getOwnerUsers(): string[] {
  return (process.env.OWNER_USERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Whether the given username is the owner. */
export function isOwner(username: string | null): boolean {
  if (!username) return false;
  return getOwnerUsers().includes(username);
}

/**
 * Parent/admin access for the `/admin` portal (Scores + Students). True for a
 * user whose role is "parent" (or the owner). Fail closed (null → false).
 * Async because the role now comes from the Blob repository.
 */
export async function isAdmin(username: string | null): Promise<boolean> {
  if (!username) return false;
  if (isOwner(username)) return true;
  const record = await getUser(username);
  if (record) return record.role === "parent";

  // Transitional fallback: legacy ADMIN_USERS for an un-migrated user.
  return getAdminUsers().includes(username);
}

/** Set the session cookie for `username` on the cookie store. */
export async function setSessionCookie(username: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, makeSessionToken(username), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

/** Clear the session cookie. */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
