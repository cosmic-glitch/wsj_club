#!/usr/bin/env node
/**
 * One-time migration: move the logins from the legacy AUTH_USERS env var into
 * the Blob-backed user repository (lib/users.ts), assigning each a role and —
 * for students — an owning parent (their "classroom").
 *
 * Roles here use the app's verbiage — "parent" / parentId. The stored blob keeps
 * the LEGACY field names (`role: "teacher"`, `teacherId`) that lib/users.ts
 * expects on disk; the conversion happens at the write below.
 *
 * It REUSES the bcrypt hashes already in AUTH_USERS (no plaintext passwords are
 * handled), and writes one blob per user at `users/<username>.json` in the same
 * shape lib/users.ts reads. Idempotent: re-running overwrites the same keys.
 *
 * After this runs (and OWNER_USERS is set), the repository is the source of
 * truth; AUTH_USERS/ADMIN_USERS remain only as a transitional fallback and can
 * be retired once verified in production.
 *
 * Usage:
 *   node --env-file=.env.local scripts/seed-users.mjs           # write
 *   node --env-file=.env.local scripts/seed-users.mjs --dry-run # preview only
 *
 * Needs AUTH_USERS + BLOB_READ_WRITE_TOKEN (both in .env.local).
 */
import { put } from "@vercel/blob";

const DRY_RUN = process.argv.includes("--dry-run");

// The roster to seed. Every username here must already exist in AUTH_USERS —
// the script carries that hash over. `test` is a leftover throwaway login: keep
// the record but deactivate it so it can't log in.
const ROSTER = [
  { username: "anurag", role: "parent" }, // owner (also set OWNER_USERS=anurag)
  { username: "madan", role: "parent" },
  { username: "arjun", role: "student", parentId: "anurag" },
  { username: "anusha", role: "student", parentId: "anurag" },
  { username: "samaira", role: "student", parentId: "anurag" },
  { username: "mehar", role: "student", parentId: "anurag" },
  { username: "puneeth", role: "student", parentId: "madan" },
  { username: "test", role: "student", parentId: "anurag", active: false },
];

function decodeAuthUsers() {
  const raw = (process.env.AUTH_USERS || "").trim();
  if (!raw) {
    console.error("Missing AUTH_USERS. Run with: node --env-file=.env.local scripts/seed-users.mjs");
    process.exit(1);
  }
  let text = raw;
  if (!text.startsWith("{")) {
    try {
      const decoded = Buffer.from(text, "base64").toString("utf8").trim();
      if (decoded.startsWith("{")) text = decoded;
    } catch {
      /* fall through */
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    console.error("AUTH_USERS is not valid (base64-encoded) JSON.");
    process.exit(1);
  }
}

function titleCase(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const hashes = decodeAuthUsers();

if (!DRY_RUN && !process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("Missing BLOB_READ_WRITE_TOKEN. Run with: node --env-file=.env.local scripts/seed-users.mjs");
  process.exit(1);
}

// Validate every roster username has a hash + every parentId points at a parent.
const parents = new Set(ROSTER.filter((r) => r.role === "parent").map((r) => r.username));
let bad = false;
for (const r of ROSTER) {
  if (typeof hashes[r.username] !== "string") {
    console.error(`✗ ${r.username}: no bcrypt hash in AUTH_USERS`);
    bad = true;
  }
  if (r.role === "student" && !parents.has(r.parentId)) {
    console.error(`✗ ${r.username}: parentId "${r.parentId}" is not a parent in this roster`);
    bad = true;
  }
}
if (bad) process.exit(1);

const now = new Date().toISOString();

for (const r of ROSTER) {
  const user = {
    username: r.username,
    displayName: titleCase(r.username),
    passwordHash: hashes[r.username],
    // Legacy stored names: "teacher"/teacherId on disk mean parent/parentId.
    role: r.role === "parent" ? "teacher" : r.role,
    ...(r.role === "student" ? { teacherId: r.parentId } : {}),
    active: r.active ?? true,
    createdBy: "seed",
    createdAt: now,
  };

  const label = `${r.username} (${r.role}${r.parentId ? ` → ${r.parentId}` : ""}${user.active ? "" : ", inactive"})`;
  if (DRY_RUN) {
    console.log(`would write users/${r.username}.json  —  ${label}`);
    continue;
  }
  await put(`users/${r.username}.json`, JSON.stringify(user, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  console.log(`✓ users/${r.username}.json  —  ${label}`);
}

console.log(
  DRY_RUN
    ? "\nDry run — nothing written. Re-run without --dry-run to seed."
    : `\nSeeded ${ROSTER.length} users. Set OWNER_USERS=anurag (Vercel + .env.local) before Phase 2.`
);
