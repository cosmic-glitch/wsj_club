import { del, list } from "@vercel/blob";
import { dbDelete, dbInsert, dbSelect, dbUpsert } from "@/lib/db";
import type { Track } from "@/lib/content";

/**
 * Shared server-side helpers for the voice-quiz session records — the
 * sanitizers for client-sent fields (used by /api/quiz-report and
 * /api/quiz-progress), the "in-progress slot" primitives (pause & resume),
 * and the terminal-session insert. Records live in Postgres (rc_quiz_slots /
 * rc_quiz_sessions); only AUDIO stays in Blob (large, immutable, served by
 * URL — the stitched teacher WAV and the slot's pause-time flush).
 *
 * The SLOT is the single record holding a paused/live attempt — at most one
 * per (student, track, date), a DB invariant (the rc_quiz_slots PK). Its
 * existence is what shows "Continue" (Reports) and the Continue/Start-over
 * chooser (the home launcher); the terminal actions (End / Cancel / Start
 * over) delete it. Server-only — the client mirrors the slot-AUDIO pathname
 * convention in components/VoiceQuiz.tsx.
 */

export type Turn = { role: "student" | "tutor"; text: string };

export type SessionFailure = { reason: string; detail: string };

/** The filename-safe form of a username (same convention as quiz-report). */
export function safeNameOf(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase();
}

/**
 * The Blob key prefix for one (track, date)'s session records: `junior/<date>`
 * on the junior track, else just `<date>`. EVERY `quiz-sessions/…` literal must
 * route through this — a junior article almost always shares a date with a
 * senior one, so a track-blind key would collide (overwriting the senior day's
 * sessions / slot).
 *
 * `track` is REQUIRED here and on every slot helper below — deliberately no
 * `"senior"` default. A default would let a junior call site compile while
 * silently computing the *senior* path, and because the slot flush is
 * best-effort that failure is invisible (a lost junior recording / an orphaned
 * junior slot). Required params make every call site a compile error the checker
 * enumerates. The default lives at the API boundary, where each route parses
 * `track` out of the request once.
 */
export function sessionPrefix(track: Track, date: string): string {
  return track === "junior" ? `junior/${date}` : date;
}

/**
 * The slot's stable AUDIO key — the client's pause-time WAV flush uploads here
 * (via a /api/quiz-audio client token), overwriting in place. IMPORTANT:
 * derive `safeName` from the COOKIE user, never from the request body — the
 * pathname is overwritable, so a body-derived name would let a crafted request
 * stomp another student's recording.
 */
export function slotAudioPathname(track: Track, date: string, safeName: string): string {
  return `quiz-sessions/${sessionPrefix(track, date)}/${safeName}-inprogress.wav`;
}

/** The pre-migration slot JSON key — kept only so deleteSlotBlobs cleans up any legacy leftover. */
function slotJsonPathname(track: Track, date: string, safeName: string): string {
  return `quiz-sessions/${sessionPrefix(track, date)}/${safeName}-inprogress.json`;
}

// ---- Sanitizers for client-sent fields (free text — cap everything) --------

export function sanitizeTranscript(v: unknown): Turn[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 400).map((t) => ({
    role: t?.role === "student" ? ("student" as const) : ("tutor" as const),
    text: String(t?.text ?? "").slice(0, 8000),
  }));
}

export function sanitizeFailure(v: unknown): SessionFailure | null {
  if (!v || typeof v !== "object") return null;
  const f = v as { reason?: unknown; detail?: unknown };
  return {
    reason: String(f.reason ?? "unknown").slice(0, 200),
    detail: String(f.detail ?? "").slice(0, 2000),
  };
}

/** Non-negative ms, capped at 6h against a bad client value. */
export function sanitizeDurationMs(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0
    ? Math.min(Math.round(v), 6 * 60 * 60 * 1000)
    : undefined;
}

export function sanitizeResumeCount(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0
    ? Math.min(Math.round(v), 1000)
    : 0;
}

const str = (v: unknown, n: number) =>
  typeof v === "string" && v.trim() ? v.slice(0, n) : undefined;

/**
 * Client diagnostics (logging only): a stable per-quiz `sessionId` + per-mount
 * `mountId`, the end trigger + phase, and an ordered breadcrumb trail. These
 * make a recurrence of the "one quiz saved as two records" bug self-explaining
 * (e.g. the same sessionId on two records ⇒ a double-save). All free text from
 * the client, so sanitize + length/count-cap everything.
 */
export function sanitizeDiag(body: {
  sessionId?: unknown;
  mountId?: unknown;
  endReason?: unknown;
  phaseAtEnd?: unknown;
  breadcrumbs?: unknown;
}) {
  return {
    sessionId: str(body.sessionId, 64),
    mountId: str(body.mountId, 64),
    endReason: str(body.endReason, 64),
    phaseAtEnd: str(body.phaseAtEnd, 32),
    breadcrumbs: Array.isArray(body.breadcrumbs)
      ? body.breadcrumbs.slice(0, 400).map((e) => ({
          t: typeof e?.t === "number" && Number.isFinite(e.t) ? Math.round(e.t) : 0,
          ev: String(e?.ev ?? "").slice(0, 48),
          ...(e?.info ? { info: String(e.info).slice(0, 200) } : {}),
        }))
      : undefined,
  };
}

// ---- The in-progress slot ---------------------------------------------------

export type SlotRecord = Record<string, unknown> & {
  transcript?: Turn[];
  tutorDone?: boolean;
  resumeCount?: number;
  audioUrl?: string;
  durationMs?: number;
  diag?: { sessionId?: string };
};

/**
 * Read a student's in-progress slot from rc_quiz_slots, reconstructed into
 * the JSON shape the client expects (the same record upsertSlotRecord takes).
 * Returns null when no slot exists; THROWS on a DB failure so callers surface
 * an error instead of treating it as "no slot". Keyed by the login user — the
 * DB PK — not the filename-safe name.
 */
export async function getSlotRecord(
  loginUser: string,
  track: Track,
  date: string
): Promise<SlotRecord | null> {
  const rows = await dbSelect(
    "rc_quiz_slots",
    `?login_user=eq.${encodeURIComponent(loginUser)}&track=eq.${track}&date=eq.${encodeURIComponent(date)}&select=*`
  );
  if (rows === null) throw new Error("slot DB read failed");
  const r = rows[0];
  if (!r) return null;
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  return {
    date,
    ...(track === "junior" ? { track } : {}),
    title: typeof r.title === "string" ? r.title : "",
    studentName: typeof r.student_name === "string" ? r.student_name : loginUser,
    loginUser,
    ...(typeof r.parent_id === "string" ? { teacherId: r.parent_id } : {}),
    inProgress: true,
    partial: true,
    cancelled: false,
    report: null,
    updatedAt: r.updated_at
      ? new Date(String(r.updated_at)).toISOString()
      : new Date().toISOString(),
    transcript: Array.isArray(r.transcript) ? (r.transcript as Turn[]) : [],
    tutorDone: r.tutor_done === true,
    resumeCount: num(r.resume_count) ?? 0,
    ...(typeof r.audio_url === "string" && r.audio_url
      ? { audioUrl: r.audio_url }
      : {}),
    ...(num(r.duration_ms) != null ? { durationMs: num(r.duration_ms) } : {}),
    failure: r.failure ?? null,
    ...(r.diag ? { diag: r.diag as SlotRecord["diag"] } : {}),
  };
}

const strOf = (v: unknown): string | null =>
  typeof v === "string" && v ? v : null;
const numOf = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;

/**
 * Checkpoint a student's in-progress slot: one atomic upsert on the slot PK
 * (the overwrite-in-place semantics are transactional). THROWS on failure —
 * a lost checkpoint is a failed request, so the client keeps the turn and
 * retries, rather than silently losing progress. Takes the same record shape
 * getSlotRecord returns (the legacy `teacherId` field name maps to parent_id
 * here).
 */
export async function upsertSlotRecord(
  loginUser: string,
  track: Track,
  date: string,
  slot: Record<string, unknown>
): Promise<void> {
  const ok = await dbUpsert(
    "rc_quiz_slots",
    {
      login_user: loginUser,
      track,
      date,
      title: strOf(slot.title) ?? "",
      student_name: strOf(slot.studentName) ?? loginUser,
      parent_id: strOf(slot.teacherId),
      transcript: slot.transcript ?? [],
      tutor_done: slot.tutorDone === true,
      resume_count: numOf(slot.resumeCount) ?? 0,
      failure: slot.failure ?? null,
      audio_url: strOf(slot.audioUrl),
      duration_ms: numOf(slot.durationMs),
      diag: slot.diag ?? null,
      updated_at: strOf(slot.updatedAt) ?? new Date().toISOString(),
    },
    "login_user,track,date"
  );
  if (!ok) throw new Error("slot DB write failed");
}

/**
 * Insert a TERMINAL session record (End / Cancel / the start-over archive)
 * into rc_quiz_sessions. Returns success — callers decide whether a failure
 * fails the request (start-over must not discard an unarchived slot) or is
 * logged and tolerated (End already has the student's report in hand, and
 * skipping the slot delete keeps Continue alive for a retry).
 */
export async function saveSessionRow(
  session: Record<string, unknown>
): Promise<boolean> {
  const report = session.report as { score?: unknown } | null | undefined;
  const status = await dbInsert("rc_quiz_sessions", {
    date: strOf(session.date) ?? "",
    track: session.track === "junior" ? "junior" : "senior",
    title: strOf(session.title) ?? "",
    student_name: strOf(session.studentName) ?? strOf(session.loginUser) ?? "",
    login_user: strOf(session.loginUser),
    parent_id: strOf(session.teacherId), // legacy field name on the record; modern name in the DB
    ended_at: strOf(session.endedAt) ?? new Date().toISOString(),
    duration_ms: numOf(session.durationMs),
    score: report && report.score != null ? String(report.score) : null,
    report: session.report ?? null,
    transcript: session.transcript ?? [],
    audio_url: strOf(session.audioUrl),
    partial: session.partial === true,
    cancelled: session.cancelled === true,
    failure: session.failure ?? null,
    resume_count: numOf(session.resumeCount) ?? 0,
    diag: session.diag ?? null,
  });
  return status === "ok";
}

/** Delete a slot's DB row. Returns success; deleting a missing row is success. */
export async function deleteSlotRow(
  loginUser: string,
  track: Track,
  date: string
): Promise<boolean> {
  return dbDelete(
    "rc_quiz_slots",
    `?login_user=eq.${encodeURIComponent(loginUser)}&track=eq.${track}&date=eq.${encodeURIComponent(date)}`
  );
}

/**
 * Delete a slot's Blob leftovers: the flushed audio at the stable slot-WAV key
 * and any pre-migration slot JSON. Called after a TERMINAL save — End, Cancel,
 * or Start over — so the stable key frees up for the next attempt. Idempotent:
 * a quiz that never flushed audio simply has nothing to remove.
 */
export async function deleteSlotBlobs(
  track: Track,
  date: string,
  safeName: string
): Promise<void> {
  const targets = new Set([
    slotJsonPathname(track, date, safeName),
    slotAudioPathname(track, date, safeName),
  ]);
  // This hand-rolls its own list() prefix (it does NOT call the pathname
  // helpers for the list), so it must route through sessionPrefix too — left
  // senior-keyed, End/Cancel/Start-over on a JUNIOR attempt would list the
  // senior prefix, find nothing, and orphan the junior slot audio. The
  // required `track` param forces this.
  const { blobs } = await list({
    prefix: `quiz-sessions/${sessionPrefix(track, date)}/${safeName}-inprogress`,
  });
  const urls = blobs.filter((b) => targets.has(b.pathname)).map((b) => b.url);
  if (urls.length) await del(urls);
}
