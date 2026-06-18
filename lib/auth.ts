import crypto from "crypto";
import { cookies } from "next/headers";

/**
 * Tiny username/password auth for the voice-quiz feature.
 *
 * This exists mostly to gate the paid Realtime API behind a login so the
 * public site can't run up OpenAI charges. It is deliberately simple:
 *
 * - Credentials live in the `AUTH_USERS` env var (JSON: {"name":"password"}).
 *   If unset, it defaults to a single test user `test`/`hello123`.
 * - A successful login sets an httpOnly cookie whose value is the username
 *   plus an HMAC signature (so it can't be forged without `AUTH_SECRET`).
 *
 * To add the four real students later, just set `AUTH_USERS` to a JSON map of
 * their names → passwords — no code change needed.
 */

const COOKIE_NAME = "wsj_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function getUsers(): Record<string, string> {
  const raw = process.env.AUTH_USERS;
  if (raw) {
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      console.error("AUTH_USERS is not valid JSON; falling back to default user");
    }
  }
  return { test: "hello123" };
}

function secret(): string {
  // A stable default keeps local dev working; production should set AUTH_SECRET.
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

/** Check a username/password pair against the configured users. */
export function verifyCredentials(username: string, password: string): boolean {
  const users = getUsers();
  const expected = users[username];
  if (typeof expected !== "string") return false;
  return safeEqual(password, expected);
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
