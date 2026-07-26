#!/usr/bin/env node
/**
 * One-time (re-runnable) backfill: users/<username>.json blobs → rc_users.
 * Idempotent — upserts on username; safe to re-run anytime as the reconciler
 * (Blob is authoritative during the shadow phase, so overwriting from it is
 * always safe). Maps the legacy stored names (role "teacher", teacherId) to
 * the DB's modern ones (parent, parent_id).
 *
 * Usage: node --env-file=.env.local scripts/migrate-users-to-db.mjs [--dry-run]
 */
import { list } from "@vercel/blob";
import { dbUpsert, fetchBlobJson } from "./db-rest.mjs";

const DRY_RUN = process.argv.includes("--dry-run");

const { blobs } = await list({ prefix: "users/" });
const users = [];
for (const b of blobs.filter((b) => b.pathname.endsWith(".json"))) {
  const raw = await fetchBlobJson(b.url);
  if (!raw || typeof raw.username !== "string") {
    console.warn(`skipping unreadable user blob: ${b.pathname}`);
    continue;
  }
  users.push({
    username: raw.username,
    display_name: raw.displayName ?? raw.username,
    password_hash: raw.passwordHash ?? "",
    role: raw.role === "student" ? "student" : "parent",
    parent_id: raw.role === "student" ? (raw.teacherId ?? null) : null,
    active: raw.active !== false,
    created_by: raw.createdBy ?? null,
    ...(raw.createdAt ? { created_at: raw.createdAt } : {}),
  });
}

// Parents first — rc_users.parent_id is a self-referencing FK.
users.sort((a, b) => (a.role === b.role ? 0 : a.role === "parent" ? -1 : 1));

for (const u of users) {
  const label = `${u.username} (${u.role}${u.parent_id ? ` → ${u.parent_id}` : ""}${u.active ? "" : ", inactive"})`;
  if (DRY_RUN) {
    console.log(`would upsert ${label}`);
    continue;
  }
  await dbUpsert("rc_users", u, "username");
  console.log(`✓ ${label}`);
}
console.log(DRY_RUN ? `\nDry run — ${users.length} users, nothing written.` : `\nBackfilled ${users.length} users.`);
