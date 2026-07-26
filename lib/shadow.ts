import { dbDelete, dbSelect, dbUpsert } from "@/lib/db";
import { safeNameOf } from "@/lib/session-io";
import type { Track } from "@/lib/content";
import type { User } from "@/lib/users";

/**
 * The dual-write SHADOW layer (PLAN-supabase.md Phase 1): every Blob write of
 * structured data mirrors itself into the rc_* Postgres tables. Blob stays the
 * store of record — every function here is best-effort (lib/db.ts logs and
 * swallows failures), so a DB hiccup can never break a login, a checkpoint, a
 * save, or a vote. Drift is caught by scripts/diff-blob-db.mjs and healed by
 * re-running the backfill scripts (Blob is never staler than its shadow).
 *
 * Callers AWAIT these (they're one cheap HTTP call each) — a fire-and-forget
 * promise could be killed when the serverless response ends.
 */

const str = (v: unknown): string | null =>
  typeof v === "string" && v ? v : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;

function trackOf(v: unknown): Track {
  return v === "junior" ? "junior" : "senior";
}

/** Mirror a user record (create / rename / reset / deactivate all land here). */
export async function shadowUpsertUser(u: User): Promise<void> {
  await dbUpsert(
    "rc_users",
    {
      username: u.username,
      display_name: u.displayName,
      password_hash: u.passwordHash,
      role: u.role, // already the modern name — the legacy "teacher" never leaves lib/users.ts
      parent_id: u.parentId ?? null,
      active: u.active !== false,
      created_by: u.createdBy ?? null,
      ...(u.createdAt ? { created_at: u.createdAt } : {}),
    },
    "username"
  );
}

/**
 * Mirror a TERMINAL session record (End / Cancel / the start-over archive)
 * right after its Blob `put`. `sourceBlob` is the stored blob's pathname — the
 * idempotency key shared with the backfill, so whichever writes first wins and
 * the other is a no-op update of identical data.
 */
export async function shadowSaveSession(
  session: Record<string, unknown>,
  sourceBlob: string
): Promise<void> {
  const report = session.report as { score?: unknown } | null | undefined;
  await dbUpsert(
    "rc_quiz_sessions",
    {
      source_blob: sourceBlob,
      date: str(session.date) ?? "",
      track: trackOf(session.track),
      title: str(session.title) ?? "",
      student_name: str(session.studentName) ?? str(session.loginUser) ?? "",
      login_user: str(session.loginUser),
      parent_id: str(session.teacherId), // legacy field name on the record; modern name in the DB
      ended_at: str(session.endedAt) ?? new Date().toISOString(),
      duration_ms: num(session.durationMs),
      score:
        report && report.score != null ? String(report.score) : null,
      report: session.report ?? null,
      transcript: session.transcript ?? [],
      audio_url: str(session.audioUrl),
      partial: session.partial === true,
      cancelled: session.cancelled === true,
      failure: session.failure ?? null,
      resume_count: num(session.resumeCount) ?? 0,
      diag: session.diag ?? null,
    },
    "source_blob"
  );
}

/** Remove a mirrored terminal session when its blob is deleted (owner Delete). */
export async function shadowDeleteSessionByBlob(
  sourceBlob: string
): Promise<void> {
  await dbDelete(
    "rc_quiz_sessions",
    `?source_blob=eq.${encodeURIComponent(sourceBlob)}`
  );
}

/** Mirror a checkpoint of the in-progress slot (overwrite-in-place → upsert on the PK). */
export async function shadowUpsertSlot(
  loginUser: string,
  track: Track,
  date: string,
  slot: Record<string, unknown>
): Promise<void> {
  await dbUpsert(
    "rc_quiz_slots",
    {
      login_user: loginUser,
      track,
      date,
      title: str(slot.title) ?? "",
      student_name: str(slot.studentName) ?? loginUser,
      parent_id: str(slot.teacherId),
      transcript: slot.transcript ?? [],
      tutor_done: slot.tutorDone === true,
      resume_count: num(slot.resumeCount) ?? 0,
      failure: slot.failure ?? null,
      audio_url: str(slot.audioUrl),
      duration_ms: num(slot.durationMs),
      diag: slot.diag ?? null,
      updated_at: str(slot.updatedAt) ?? new Date().toISOString(),
    },
    "login_user,track,date"
  );
}

/** Remove the mirrored slot (terminal save / start-over deleted the blob slot). */
export async function shadowDeleteSlot(
  loginUser: string,
  track: Track,
  date: string
): Promise<void> {
  await dbDelete(
    "rc_quiz_slots",
    `?login_user=eq.${encodeURIComponent(loginUser)}&track=eq.${track}&date=eq.${encodeURIComponent(date)}`
  );
}

/**
 * Remove a mirrored slot known only by its blob pathname's safeName (the owner
 * deleting an in-progress row on Scores — the route holds a blob URL, not a
 * login). Matches by safeNameOf(login_user) over the (track, date) slots.
 */
export async function shadowDeleteSlotBySafeName(
  track: Track,
  date: string,
  safeName: string
): Promise<void> {
  const rows = await dbSelect(
    "rc_quiz_slots",
    `?track=eq.${track}&date=eq.${encodeURIComponent(date)}&select=login_user`
  );
  const login = rows
    ?.map((r) => r.login_user)
    .find((u): u is string => typeof u === "string" && safeNameOf(u) === safeName);
  if (login) await shadowDeleteSlot(login, track, date);
}

/** Mirror a poll definition (scripts/open-vote.mjs writes the Blob poll; the app never does). */
export async function shadowUpsertBallot(
  track: Track,
  date: string,
  username: string,
  candidateId: string
): Promise<void> {
  const rows = await dbSelect(
    "rc_polls",
    `?track=eq.${track}&date=eq.${encodeURIComponent(date)}&select=id`
  );
  const pollId = rows?.[0]?.id;
  if (typeof pollId !== "string") {
    // Poll not mirrored (opened before the shadow phase / script ran without
    // DB env) — the votes backfill catches the ballot up later.
    console.error(`Shadow ballot skipped: no rc_polls row for ${track} ${date}`);
    return;
  }
  await dbUpsert(
    "rc_ballots",
    {
      poll_id: pollId,
      username,
      candidate_id: candidateId,
      updated_at: new Date().toISOString(),
    },
    "poll_id,username"
  );
}
