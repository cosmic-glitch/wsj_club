import { dbInsert, dbSelect } from "@/lib/db";
import type { Track } from "@/lib/content";

/**
 * Page-activity events — the rc_events table (supabase/migrations/0005).
 *
 * One append-only row per thing a visitor did that no other table records:
 * opening the served article page (and how long it stayed visible), opening
 * the handout / self-quiz / word bank, tapping a glossary word. The client
 * fires these from the article pages' public/glossary.js and from the
 * PageBeacon leaf on the static React pages; POST /api/events validates and
 * stamps identity from the cookie. AI-quiz and word-quiz completions are NOT
 * re-logged here — rc_quiz_sessions / rc_word_quiz_attempts stay the record
 * and lib/analytics.ts joins them in.
 *
 * `username` is null for a logged-out visitor — kept as the separate
 * "anonymous" bucket (owner's rule), never attributed.
 */

export const EVENT_KINDS = [
  "article_view",
  "article_read",
  "handout_view",
  "selfquiz_view",
  "wordbank_view",
  "gloss_tap",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type EventMeta = {
  /** Per-page-load id (random, client-made): ties an article_view to the
   *  article_read / gloss_tap events of the same open. */
  v?: string;
  /** article_read: cumulative seconds the page was VISIBLE, at this flush. */
  seconds?: number;
  /** gloss_tap: the glossary term (display form) and its entry kind. */
  word?: string;
  kind?: string;
};

export type ActivityEvent = {
  id: number;
  at: string; // ISO
  username: string | null; // null = anonymous
  parentId: string | null;
  track: Track;
  date: string | null; // 'YYYY-MM-DD'; null for pages with no reading (word bank)
  kind: EventKind;
  meta: EventMeta;
};

export type EventInput = {
  kind: EventKind;
  track: Track;
  date: string | null;
  meta: EventMeta;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_WORD = 80;
const MAX_VIEW_ID = 32;

function isKind(v: unknown): v is EventKind {
  return typeof v === "string" && (EVENT_KINDS as readonly string[]).includes(v);
}

/**
 * Validate a client body into an EventInput, or null when it's malformed. The
 * meta is rebuilt field-by-field from an allowlist (never stored as sent) and
 * every string is length-capped — this endpoint is public, so the body is
 * hostile until proven otherwise.
 */
export function parseEventInput(body: unknown): EventInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!isKind(b.kind)) return null;
  const track: Track = b.track === "junior" ? "junior" : "senior";
  let date: string | null = null;
  if (typeof b.date === "string" && DATE_RE.test(b.date)) date = b.date;
  // Every kind but the word bank belongs to a reading.
  if (b.kind !== "wordbank_view" && !date) return null;

  const meta: EventMeta = {};
  const m =
    b.meta && typeof b.meta === "object" ? (b.meta as Record<string, unknown>) : {};
  if (typeof m.v === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(m.v)) {
    meta.v = m.v.slice(0, MAX_VIEW_ID);
  }
  if (b.kind === "article_read") {
    const s = typeof m.seconds === "number" ? m.seconds : NaN;
    if (!Number.isFinite(s) || s < 0) return null;
    // Clamp at 6 hours — anything longer is a forgotten tab, not reading.
    meta.seconds = Math.min(Math.round(s), 6 * 3600);
  }
  if (b.kind === "gloss_tap") {
    if (typeof m.word !== "string" || !m.word.trim()) return null;
    meta.word = m.word.trim().slice(0, MAX_WORD);
    if (typeof m.kind === "string") meta.kind = m.kind.slice(0, 16);
  }
  return { kind: b.kind, track, date, meta };
}

/** Insert one event. `who` is resolved from the cookie by the route. */
export async function recordEvent(
  input: EventInput,
  who: { username: string | null; parentId: string | null }
): Promise<boolean> {
  const result = await dbInsert("rc_events", {
    username: who.username,
    parent_id: who.parentId,
    track: input.track,
    date: input.date,
    kind: input.kind,
    meta: Object.keys(input.meta).length ? input.meta : null,
  });
  return result === "ok";
}

const PAGE = 1000; // PostgREST's default max rows per request

/**
 * Every event on a track since `since` (ISO; omit for all time), oldest first.
 * Pages through PostgREST's 1000-row cap so a long window never silently
 * truncates. Returns null on a DB failure.
 */
export async function loadEvents(
  track: Track,
  since?: string
): Promise<ActivityEvent[] | null> {
  const out: ActivityEvent[] = [];
  let offset = 0;
  for (;;) {
    const filter =
      `?select=id,at,username,parent_id,track,date,kind,meta` +
      `&track=eq.${track}` +
      (since ? `&at=gte.${encodeURIComponent(since)}` : "") +
      `&order=id.asc&limit=${PAGE}&offset=${offset}`;
    const rows = await dbSelect("rc_events", filter);
    if (rows === null) return null;
    for (const r of rows) {
      if (!isKind(r.kind)) continue;
      const at = typeof r.at === "string" ? new Date(r.at) : null;
      if (!at || Number.isNaN(at.getTime())) continue;
      out.push({
        id: Number(r.id),
        at: at.toISOString(),
        username: typeof r.username === "string" && r.username ? r.username : null,
        parentId: typeof r.parent_id === "string" && r.parent_id ? r.parent_id : null,
        track: r.track === "junior" ? "junior" : "senior",
        date: typeof r.date === "string" && r.date ? r.date : null,
        kind: r.kind,
        meta: r.meta && typeof r.meta === "object" ? (r.meta as EventMeta) : {},
      });
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}
