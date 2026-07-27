#!/usr/bin/env node
/**
 * One-off: create new users in rc_users (the lib/users.ts repository). Hashes
 * plaintext passwords with bcrypt (10 rounds) and enforces username
 * uniqueness + the student→parent invariant before inserting.
 *
 * Edit NEW_USERS below (the repo is public — never commit real passwords),
 * run, then revert the edit:
 *
 *   node --env-file=.env.local scripts/add-user.mjs           # write
 *   node --env-file=.env.local scripts/add-user.mjs --dry-run # preview
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_KEY in .env.local.
 */
import bcrypt from "bcryptjs";
import { dbSelect, dbUpsert } from "./db-rest.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const BCRYPT_ROUNDS = 10;
const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;

// Parent first so the student's parentId points at an existing parent.
// EXAMPLE ONLY — replace before running:
const NEW_USERS = [
  // { username: "newparent", displayName: "New Parent", password: "...", role: "parent" },
  // { username: "newkid", displayName: "New Kid", password: "...", role: "student", parentId: "newparent" },
];

if (NEW_USERS.length === 0) {
  console.error("NEW_USERS is empty — edit scripts/add-user.mjs and fill it in first.");
  process.exit(1);
}

// Load existing usernames to guard uniqueness.
const existing = new Set(
  (await dbSelect("rc_users", "?select=username")).map((r) => r.username)
);

const parentsInBatch = new Set(NEW_USERS.filter((u) => u.role === "parent").map((u) => u.username));
let bad = false;
for (const u of NEW_USERS) {
  if (!USERNAME_RE.test(u.username)) { console.error(`✗ ${u.username}: bad username format`); bad = true; }
  if (existing.has(u.username)) { console.error(`✗ ${u.username}: already exists`); bad = true; }
  if (u.role === "student" && !(parentsInBatch.has(u.parentId) || existing.has(u.parentId))) {
    console.error(`✗ ${u.username}: parentId "${u.parentId}" is not an existing parent`); bad = true;
  }
}
if (bad) process.exit(1);

const now = new Date().toISOString();
for (const u of NEW_USERS) {
  const row = {
    username: u.username,
    display_name: u.displayName,
    password_hash: await bcrypt.hash(u.password, BCRYPT_ROUNDS),
    role: u.role,
    parent_id: u.role === "student" ? u.parentId : null,
    active: true,
    created_by: "add-user-script",
    created_at: now,
  };
  const label = `${u.username} (${u.role}${u.parentId ? ` → ${u.parentId}` : ""})`;
  if (DRY_RUN) { console.log(`would insert rc_users ${u.username}  —  ${label}`); continue; }
  await dbUpsert("rc_users", row, "username");
  console.log(`✓ rc_users ${u.username}  —  ${label}`);
}
console.log(DRY_RUN ? "\nDry run — nothing written." : `\nCreated ${NEW_USERS.length} users.`);
