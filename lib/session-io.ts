import { del, list } from "@vercel/blob";
import { dbSelect } from "@/lib/db";
import type { Track } from "@/lib/content";

/**
 * Shared server-side helpers for the voice-quiz session records in Blob — the
 * sanitizers for client-sent fields (used by /api/quiz-report and
 * /api/quiz-progress) and the "in-progress slot" primitives (pause & resume).
 *
 * The SLOT is the single Blob record holding a paused/live attempt — at most
 * one per (student, date), at a STABLE pathname that each checkpoint overwrites
 * in place. Its existence is what shows "Continue" (Scores) and the
 * Continue/Start-over chooser (the home launcher); the terminal actions (End /
 * Cancel / Start over) delete it. Server-only (imports the Blob SDK) — the
 * client mirrors the pathname convention in components/VoiceQuiz.tsx.
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
 * The slot's stable keys. IMPORTANT: derive `safeName` from the COOKIE user,
 * never from the request body — these pathnames are overwritable, so a
 * body-derived name would let a crafted request stomp another student's slot.
 */
export function slotJsonPathname(track: Track, date: string, safeName: string): string {
  return `quiz-sessions/${sessionPrefix(track, date)}/${safeName}-inprogress.json`;
}

export function slotAudioPathname(track: Track, date: string, safeName: string): string {
  return `quiz-sessions/${sessionPrefix(track, date)}/${safeName}-inprogress.wav`;
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
 * Read a student's in-progress slot from rc_quiz_slots (the Phase 3 read
 * flip — PLAN-supabase.md), reconstructed into the same JSON shape the Blob
 * slot holds so callers and the client are agnostic to the store. Returns
 * null when no slot exists; THROWS on a DB failure so callers can fall back
 * to the Blob `readSlot` below (the slot is still dual-written until Phase 4,
 * when that fallback dies). Keyed by the login user — the DB PK — not the
 * filename-safe name.
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

/**
 * Read a student's in-progress slot; null when none exists.
 *
 * The slot is overwritten in place many times per quiz, and a public Blob URL
 * is CDN-edge-cached — a plain `no-store` fetch can return a STALE copy right
 * after an overwrite (this bit us before; see lib/users.ts). A UNIQUE `?v=` per
 * read forces a CDN miss so every read comes from the origin; measured on this
 * store, an overwrite is visible at the origin within ~1s (whereas `list()`'s
 * `uploadedAt` metadata lags an overwrite by several seconds, so keying by it —
 * the lib/users.ts recipe — was still serving ~5s-stale slots). Slot reads are
 * rare (a launch probe, a resume, a save-time salvage), so skipping the CDN
 * cache here costs nothing. Remaining known gaps, both ≲ a few seconds and
 * acceptable: content written in the last ~1s, and `list()` not yet SHOWING a
 * slot created in the last few seconds (the existence check).
 */
export async function readSlot(
  track: Track,
  date: string,
  safeName: string
): Promise<{ url: string; session: SlotRecord } | null> {
  const target = slotJsonPathname(track, date, safeName);
  const { blobs } = await list({ prefix: target });
  const blob = blobs.find((b) => b.pathname === target);
  if (!blob) return null;
  const res = await fetch(`${blob.url}?v=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`slot fetch failed (${res.status})`);
  const session = (await res.json()) as SlotRecord;
  return { url: blob.url, session };
}

/**
 * Delete a student's in-progress slot (the JSON and its flushed audio, if any).
 * Called after a TERMINAL save — End, Cancel, or Start over — so a stale
 * "Continue" can't linger and the one-per-day slot frees up. Idempotent: a very
 * early exit simply has no slot to remove.
 */
export async function deleteSlot(
  track: Track,
  date: string,
  safeName: string
): Promise<void> {
  const targets = new Set([
    slotJsonPathname(track, date, safeName),
    slotAudioPathname(track, date, safeName),
  ]);
  // deleteSlot hand-rolls its own list() prefix (it does NOT call the pathname
  // helpers for the list), so it must route through sessionPrefix too — left
  // senior-keyed, End/Cancel/Start-over on a JUNIOR attempt would list the
  // senior prefix, find nothing, and orphan the junior slot (an immortal
  // "Continue"). The required `track` param forces this.
  const { blobs } = await list({
    prefix: `quiz-sessions/${sessionPrefix(track, date)}/${safeName}-inprogress`,
  });
  const urls = blobs.filter((b) => targets.has(b.pathname)).map((b) => b.url);
  if (urls.length) await del(urls);
}
