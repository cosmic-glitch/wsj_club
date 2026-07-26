#!/usr/bin/env node
/**
 * One-time (re-runnable) backfill: quiz-sessions/**​/*.json blobs →
 * rc_quiz_sessions (terminal attempts, keyed on source_blob = the pathname)
 * and rc_quiz_slots (the -inprogress.json pause/resume slots, keyed on the
 * slot PK). Idempotent — safe to re-run anytime as the reconciler: during the
 * shadow phase Blob is authoritative and never staler than its DB mirror, so
 * overwriting from it is always safe. Blob records are left in place.
 *
 * Track comes from the record's `track` stamp, falling back to the junior/
 * path segment (records predating the stamp), else senior.
 *
 * Usage: node --env-file=.env.local scripts/migrate-sessions-to-db.mjs [--dry-run]
 */
import { list } from "@vercel/blob";
import { dbUpsert, fetchBlobJson } from "./db-rest.mjs";

const DRY_RUN = process.argv.includes("--dry-run");

const str = (v) => (typeof v === "string" && v ? v : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

// quiz-sessions/[junior/]<date>/<file>.json — the turns/ subdir holds
// transient audio clips (never .json), so the extension filter excludes it.
const PATH_RE = /^quiz-sessions\/(junior\/)?(\d{4}-\d{2}-\d{2})\/([^/]+)\.json$/;

const blobs = [];
let cursor;
do {
  const page = await list({ prefix: "quiz-sessions/", cursor });
  blobs.push(...page.blobs);
  cursor = page.cursor;
} while (cursor);

let sessions = 0;
let slots = 0;
let skipped = 0;

for (const b of blobs) {
  const m = PATH_RE.exec(b.pathname);
  if (!m) continue; // audio, turns/ clips, anything non-JSON
  let rec;
  try {
    rec = await fetchBlobJson(b.url);
  } catch (err) {
    console.warn(`skipping unreadable ${b.pathname}: ${err.message}`);
    skipped++;
    continue;
  }
  const track = rec.track === "junior" ? "junior" : m[1] ? "junior" : "senior";
  const date = str(rec.date) ?? m[2];

  if (b.pathname.endsWith("-inprogress.json")) {
    const login = str(rec.loginUser) ?? str(rec.studentName);
    if (!login) {
      console.warn(`skipping slot with no loginUser: ${b.pathname}`);
      skipped++;
      continue;
    }
    const row = {
      login_user: login,
      track,
      date,
      title: str(rec.title) ?? "",
      student_name: str(rec.studentName) ?? login,
      parent_id: str(rec.teacherId),
      transcript: rec.transcript ?? [],
      tutor_done: rec.tutorDone === true,
      resume_count: num(rec.resumeCount) ?? 0,
      failure: rec.failure ?? null,
      audio_url: str(rec.audioUrl),
      duration_ms: num(rec.durationMs),
      diag: rec.diag ?? null,
      updated_at: str(rec.updatedAt) ?? b.uploadedAt,
    };
    if (!DRY_RUN) await dbUpsert("rc_quiz_slots", row, "login_user,track,date");
    console.log(`${DRY_RUN ? "would upsert slot" : "✓ slot"}: ${b.pathname}`);
    slots++;
  } else {
    const row = {
      source_blob: b.pathname,
      date,
      track,
      title: str(rec.title) ?? "",
      student_name: str(rec.studentName) ?? str(rec.loginUser) ?? "",
      login_user: str(rec.loginUser),
      parent_id: str(rec.teacherId),
      ended_at: str(rec.endedAt) ?? b.uploadedAt,
      duration_ms: num(rec.durationMs),
      score: rec.report?.score != null ? String(rec.report.score) : null,
      report: rec.report ?? null,
      transcript: rec.transcript ?? [],
      audio_url: str(rec.audioUrl),
      partial: rec.partial === true,
      cancelled: rec.cancelled === true,
      failure: rec.failure ?? null,
      resume_count: num(rec.resumeCount) ?? 0,
      diag: rec.diag ?? null,
    };
    if (!DRY_RUN) await dbUpsert("rc_quiz_sessions", row, "source_blob");
    sessions++;
  }
}

console.log(
  `${DRY_RUN ? "Dry run — would backfill" : "Backfilled"} ${sessions} terminal sessions + ${slots} slots` +
    (skipped ? ` (${skipped} skipped — see warnings)` : "")
);
