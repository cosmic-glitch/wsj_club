#!/usr/bin/env node
/**
 * Generate the AUTH_USERS env value for the WSJ Reading Club login.
 *
 * Passwords are bcrypt-hashed (bcryptjs, 10 salt rounds) — the same scheme as
 * the foliotracker project. The output is base64-encoded JSON, ready to paste
 * as the AUTH_USERS env var (locally in .env.local and in Vercel project env).
 * Base64 is used because bcrypt hashes contain `$`, which Next.js's .env loader
 * would otherwise try to expand.
 *
 * Usage:
 *   node scripts/hash-password.mjs <user> <password> [<user> <password> ...]
 *
 * Example (test user + the four kids):
 *   node scripts/hash-password.mjs test master alice pw1 ben pw2 cara pw3 dan pw4
 */
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;
const args = process.argv.slice(2);

if (args.length < 2 || args.length % 2 !== 0) {
  console.error(
    "Usage: node scripts/hash-password.mjs <user> <password> [<user> <password> ...]"
  );
  process.exit(1);
}

const users = {};
for (let i = 0; i < args.length; i += 2) {
  users[args[i]] = bcrypt.hashSync(args[i + 1], SALT_ROUNDS);
}

const json = JSON.stringify(users);
const b64 = Buffer.from(json, "utf8").toString("base64");

console.log("\nAUTH_USERS (base64 — paste this as the env var value):\n");
console.log(b64);
console.log("\nUsers configured: " + Object.keys(users).join(", "));
console.log("(passwords are bcrypt-hashed; the plaintext is never stored)\n");
