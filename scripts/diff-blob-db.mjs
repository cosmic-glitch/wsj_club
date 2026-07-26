#!/usr/bin/env node
/**
 * The Phase 2 gate (PLAN-supabase.md): verify the DB mirror against Blob,
 * field by field. Blob is authoritative during the shadow phase — every
 * difference this reports is a shadow-write bug (or a write that predates the
 * shadow), healed by re-running the migrate-*-to-db.mjs scripts.
 *
 * Reports, per store: blob records MISSING from the DB, DB rows ORPHANED
 * (no blob — expected briefly for a just-deleted blob; persistent orphans are
 * a missed shadow delete), and rows whose fields DIVERGE. Exits non-zero when
 * anything is off. Run it a few times across a normal day of quizzing; the
 * flip gate is a clean run while the site is in active use.
 *
 * Usage: node --env-file=.env.local scripts/diff-blob-db.mjs
 */
import { list } from "@vercel/blob";
import { dbSelect, fetchBlobJson } from "./db-rest.mjs";

let problems = 0;
const report = (line) => {
  problems++;
  console.log(`  ✗ ${line}`);
};

// jsonb round-trips lose key order (Postgres normalizes it), and blob JSON
// omits keys the DB stores as null — canonicalize both sides before compare.
function canon(v) {
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      const c = canon(v[k]);
      if (c !== null) out[k] = c;
    }
    return out;
  }
  return v;
}
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const epoch = (v) => (v ? new Date(v).getTime() : null);

function compareFields(label, pairs) {
  for (const [field, blobVal, dbVal] of pairs) {
    if (!eq(blobVal, dbVal)) {
      report(`${label}: ${field} diverges (blob=${JSON.stringify(canon(blobVal))?.slice(0, 80)} db=${JSON.stringify(canon(dbVal))?.slice(0, 80)})`);
    }
  }
}

async function listAll(prefix) {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor });
    blobs.push(...page.blobs);
    cursor = page.cursor;
  } while (cursor);
  return blobs;
}

// ---- users ------------------------------------------------------------------
console.log("users:");
{
  const blobs = (await listAll("users/")).filter((b) => b.pathname.endsWith(".json"));
  const rows = await dbSelect("rc_users", "?select=*");
  const byName = new Map(rows.map((r) => [r.username, r]));
  const seen = new Set();
  for (const b of blobs) {
    const u = await fetchBlobJson(b.url).catch(() => null);
    if (!u?.username) {
      report(`${b.pathname}: unreadable blob`);
      continue;
    }
    seen.add(u.username);
    const row = byName.get(u.username);
    if (!row) {
      report(`${u.username}: missing from rc_users`);
      continue;
    }
    compareFields(u.username, [
      ["display_name", u.displayName ?? u.username, row.display_name],
      ["password_hash", u.passwordHash, row.password_hash],
      ["role", u.role === "student" ? "student" : "parent", row.role],
      ["parent_id", u.teacherId ?? null, row.parent_id],
      ["active", u.active !== false, row.active],
    ]);
  }
  for (const r of rows) {
    if (!seen.has(r.username)) report(`${r.username}: orphan row in rc_users (no blob)`);
  }
  console.log(`  ${blobs.length} blobs vs ${rows.length} rows`);
}

// ---- sessions + slots ---------------------------------------------------------
console.log("quiz sessions + slots:");
{
  const PATH_RE = /^quiz-sessions\/(junior\/)?(\d{4}-\d{2}-\d{2})\/([^/]+)\.json$/;
  const blobs = (await listAll("quiz-sessions/")).filter((b) => PATH_RE.test(b.pathname));
  const rows = await dbSelect("rc_quiz_sessions", "?select=*");
  const slotRows = await dbSelect("rc_quiz_slots", "?select=*");
  const bySource = new Map(rows.map((r) => [r.source_blob, r]));
  const slotByKey = new Map(slotRows.map((r) => [`${r.login_user}|${r.track}|${r.date}`, r]));
  const seenSources = new Set();
  const seenSlots = new Set();

  for (const b of blobs) {
    const m = PATH_RE.exec(b.pathname);
    const rec = await fetchBlobJson(b.url).catch(() => null);
    if (!rec) {
      report(`${b.pathname}: unreadable blob`);
      continue;
    }
    const track = rec.track === "junior" ? "junior" : m[1] ? "junior" : "senior";
    const date = rec.date ?? m[2];

    if (b.pathname.endsWith("-inprogress.json")) {
      const login = rec.loginUser ?? rec.studentName;
      const key = `${login}|${track}|${date}`;
      seenSlots.add(key);
      const row = slotByKey.get(key);
      if (!row) {
        report(`slot ${key}: missing from rc_quiz_slots`);
        continue;
      }
      compareFields(`slot ${key}`, [
        ["title", rec.title, row.title],
        ["transcript", rec.transcript ?? [], row.transcript],
        ["tutor_done", rec.tutorDone === true, row.tutor_done],
        ["resume_count", rec.resumeCount ?? 0, row.resume_count],
        ["failure", rec.failure ?? null, row.failure],
        ["audio_url", rec.audioUrl ?? null, row.audio_url],
        ["diag", rec.diag ?? null, row.diag],
      ]);
      if (epoch(rec.updatedAt) !== epoch(row.updated_at)) {
        report(`slot ${key}: updated_at diverges (blob=${rec.updatedAt} db=${row.updated_at})`);
      }
    } else {
      seenSources.add(b.pathname);
      const row = bySource.get(b.pathname);
      if (!row) {
        report(`${b.pathname}: missing from rc_quiz_sessions`);
        continue;
      }
      compareFields(b.pathname, [
        ["date", date, row.date],
        ["track", track, row.track],
        ["title", rec.title ?? "", row.title],
        ["student_name", rec.studentName ?? rec.loginUser ?? "", row.student_name],
        ["login_user", rec.loginUser ?? null, row.login_user],
        ["parent_id", rec.teacherId ?? null, row.parent_id],
        ["duration_ms", rec.durationMs ?? null, row.duration_ms],
        ["score", rec.report?.score != null ? String(rec.report.score) : null, row.score],
        ["report", rec.report ?? null, row.report],
        ["transcript", rec.transcript ?? [], row.transcript],
        ["audio_url", rec.audioUrl ?? null, row.audio_url],
        ["partial", rec.partial === true, row.partial],
        ["cancelled", rec.cancelled === true, row.cancelled],
        ["failure", rec.failure ?? null, row.failure],
        ["resume_count", rec.resumeCount ?? 0, row.resume_count],
        ["diag", rec.diag ?? null, row.diag],
      ]);
      if (rec.endedAt && epoch(rec.endedAt) !== epoch(row.ended_at)) {
        report(`${b.pathname}: ended_at diverges (blob=${rec.endedAt} db=${row.ended_at})`);
      }
    }
  }
  for (const r of rows) {
    if (r.source_blob && !seenSources.has(r.source_blob)) {
      report(`${r.source_blob}: orphan row in rc_quiz_sessions (no blob)`);
    }
  }
  for (const r of slotRows) {
    const key = `${r.login_user}|${r.track}|${r.date}`;
    if (!seenSlots.has(key)) report(`slot ${key}: orphan row in rc_quiz_slots (no blob slot)`);
  }
  console.log(`  ${blobs.length} blobs vs ${rows.length} session rows + ${slotRows.length} slot rows`);
}

// ---- votes --------------------------------------------------------------------
console.log("votes:");
{
  const POLL_RE = /^votes\/(junior\/)?(\d{4}-\d{2}-\d{2})\/poll\.json$/;
  const BALLOT_RE = /^votes\/(junior\/)?(\d{4}-\d{2}-\d{2})\/ballots\/[^/]+\.json$/;
  const blobs = await listAll("votes/");
  const pollRows = await dbSelect("rc_polls", "?select=*");
  const ballotRows = await dbSelect("rc_ballots", "?select=*");
  const pollByKey = new Map(pollRows.map((r) => [`${r.track}|${r.date}`, r]));
  const pollById = new Map(pollRows.map((r) => [r.id, r]));

  const seenPolls = new Set();
  const seenBallots = new Set();
  for (const b of blobs) {
    const pm = POLL_RE.exec(b.pathname);
    if (pm) {
      const key = `${pm[1] ? "junior" : "senior"}|${pm[2]}`;
      seenPolls.add(key);
      const poll = await fetchBlobJson(b.url).catch(() => null);
      const row = pollByKey.get(key);
      if (!row) {
        report(`poll ${key}: missing from rc_polls`);
      } else if (poll && !eq(poll.candidates, row.candidates)) {
        report(`poll ${key}: candidates diverge`);
      }
      continue;
    }
    const bm = BALLOT_RE.exec(b.pathname);
    if (bm) {
      const key = `${bm[1] ? "junior" : "senior"}|${bm[2]}`;
      const ballot = await fetchBlobJson(b.url).catch(() => null);
      if (!ballot?.user) {
        report(`${b.pathname}: unreadable ballot`);
        continue;
      }
      const pollRow = pollByKey.get(key);
      if (!pollRow) continue; // already reported as a missing poll
      seenBallots.add(`${pollRow.id}|${ballot.user}`);
      const row = ballotRows.find((r) => r.poll_id === pollRow.id && r.username === ballot.user);
      if (!row) report(`ballot ${key} ${ballot.user}: missing from rc_ballots`);
      else if (row.candidate_id !== ballot.candidateId) {
        report(`ballot ${key} ${ballot.user}: candidate diverges (blob=${ballot.candidateId} db=${row.candidate_id})`);
      }
    }
  }
  for (const r of pollRows) {
    if (!seenPolls.has(`${r.track}|${r.date}`)) report(`poll ${r.track} ${r.date}: orphan row in rc_polls`);
  }
  for (const r of ballotRows) {
    if (!seenBallots.has(`${r.poll_id}|${r.username}`)) {
      const p = pollById.get(r.poll_id);
      report(`ballot ${p ? `${p.track} ${p.date}` : r.poll_id} ${r.username}: orphan row in rc_ballots`);
    }
  }
  console.log(`  ${pollRows.length} poll rows, ${ballotRows.length} ballot rows checked`);
}

if (problems) {
  console.log(`\n✗ ${problems} difference(s) — fix the shadow write and re-run the migrate scripts to heal.`);
  process.exit(1);
}
console.log("\n✓ Blob and DB are in sync.");
