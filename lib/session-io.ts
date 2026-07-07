import { del, list } from "@vercel/blob";

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
 * The slot's stable keys. IMPORTANT: derive `safeName` from the COOKIE user,
 * never from the request body — these pathnames are overwritable, so a
 * body-derived name would let a crafted request stomp another student's slot.
 */
export function slotJsonPathname(date: string, safeName: string): string {
  return `quiz-sessions/${date}/${safeName}-inprogress.json`;
}

export function slotAudioPathname(date: string, safeName: string): string {
  return `quiz-sessions/${date}/${safeName}-inprogress.wav`;
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
  date: string,
  safeName: string
): Promise<{ url: string; session: SlotRecord } | null> {
  const target = slotJsonPathname(date, safeName);
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
export async function deleteSlot(date: string, safeName: string): Promise<void> {
  const targets = new Set([
    slotJsonPathname(date, safeName),
    slotAudioPathname(date, safeName),
  ]);
  const { blobs } = await list({
    prefix: `quiz-sessions/${date}/${safeName}-inprogress`,
  });
  const urls = blobs.filter((b) => targets.has(b.pathname)).map((b) => b.url);
  if (urls.length) await del(urls);
}
