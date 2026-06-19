import crypto from "crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";

/**
 * Tiny username/password auth for the voice-quiz feature.
 *
 * Exists to gate the paid Realtime API behind a login so the public site can't
 * run up OpenAI charges.
 *
 * - Credentials live in the `AUTH_USERS` env var: a JSON map of
 *   `{ username: bcryptHash }`, base64-encoded. Passwords are stored ONLY as
 *   bcrypt hashes (the same scheme as the foliotracker project: bcryptjs, 10
 *   salt rounds) — never in plaintext, never in source. Generate the value with
 *   `node scripts/hash-password.mjs <user> <password> ...`.
 * - If `AUTH_USERS` is unset, there are no users and nobody can log in (fail closed).
 * - A successful login sets an httpOnly cookie: the username plus an HMAC
 *   signature (`AUTH_SECRET`) so it can't be forged.
 *
 * Why base64: bcrypt hashes contain `$`, which Next.js's `.env` loader expands
 * as a variable reference. Base64-encoding the whole map sidesteps that and
 * keeps the value identical between local `.env.local` and Vercel.
 */

const COOKIE_NAME = "wsj_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** username -> bcrypt hash, parsed from AUTH_USERS (base64-encoded JSON). */
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

/** Check a username/password pair against the configured bcrypt hashes. */
export async function verifyCredentials(
  username: string,
  password: string
): Promise<boolean> {
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

/** Verify a cookie value and return the username it encodes, or null. */
export function readSessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const username = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(signature, sign(username))) return null;
  // Make sure the user still exists in the current config.
  if (!(username in getUsers())) return null;
  return username;
}

/** Read the logged-in username from the request cookies (server-side). */
export async function currentUser(): Promise<string | null> {
  const store = await cookies();
  return readSessionToken(store.get(COOKIE_NAME)?.value);
}

/**
 * Teacher/admin access for the `/admin` portal (report cards + transcripts).
 *
 * The teacher's usernames live in the `ADMIN_USERS` env var: a comma-separated
 * list (e.g. `ADMIN_USERS=teacher,anurag`). Every name must also be a real login
 * in `AUTH_USERS`. If `ADMIN_USERS` is unset, NOBODY is an admin (fail closed) —
 * so students who log in for the voice quiz still can't reach `/admin`.
 */
function getAdminUsers(): string[] {
  return (process.env.ADMIN_USERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Whether ADMIN_USERS has been configured at all (used for setup hints). */
export function adminConfigured(): boolean {
  return getAdminUsers().length > 0;
}

/** Whether the given username is a teacher/admin. Fail closed (null → false). */
export function isAdmin(username: string | null): boolean {
  if (!username) return false;
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
