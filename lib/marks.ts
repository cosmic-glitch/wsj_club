import { dbSelect, dbUpsert } from "@/lib/db";
import type { Track } from "@/lib/content";
import type { Session } from "@/components/AdminSessions";
import { completedQuizDates } from "@/lib/word-quiz";
import { medalsFor, type MarkLevel, type MedalMap } from "@/lib/medals";

/**
 * The reading-marks store (rc_reading_marks; migration 0006) — the SERVER
 * half of the daily medals (the client-safe rules live in lib/medals.ts).
 * One row per (student, track, date) holding the highest level attested:
 * 1 = read the article (bronze), 2 = read the handout (silver). Gold is
 * never written here — it's a completed rc_quiz_sessions row, joined in by
 * medalsFor at read time.
 *
 * Identity is always the caller's cookie (the routes pass it in); `track`
 * is a required, explicit param everywhere, like the slot helpers.
 */

export type ReadingMark = {
  username: string;
  parentId?: string;
  track: Track;
  date: string;
  level: MarkLevel;
  updatedAt: string;
};

const SELECT = "select=username,parent_id,track,date,level,updated_at";

function rowToMark(r: Record<string, unknown>): ReadingMark | null {
  if (typeof r.username !== "string" || typeof r.date !== "string") return null;
  const level = r.level === 2 ? 2 : r.level === 1 ? 1 : null;
  if (!level) return null;
  return {
    username: r.username,
    ...(typeof r.parent_id === "string" && r.parent_id
      ? { parentId: r.parent_id }
      : {}),
    track: r.track === "junior" ? "junior" : "senior",
    date: r.date,
    level,
    updatedAt: r.updated_at ? new Date(String(r.updated_at)).toISOString() : "",
  };
}

/** Every mark (club-sized table) — for the Reports / Students pages. */
export async function loadMarks(): Promise<ReadingMark[] | null> {
  const rows = await dbSelect("rc_reading_marks", `?${SELECT}`);
  if (!rows) return null;
  return rows.flatMap((r) => rowToMark(r) ?? []);
}

/** One student's marks on one track. */
export async function loadMarksFor(
  username: string,
  track: Track,
): Promise<ReadingMark[] | null> {
  const rows = await dbSelect(
    "rc_reading_marks",
    `?username=eq.${encodeURIComponent(username)}&track=eq.${track}&${SELECT}`,
  );
  if (!rows) return null;
  return rows.flatMap((r) => rowToMark(r) ?? []);
}

/**
 * Record an attestation. A mark only goes UP: an existing row at the same or
 * a higher level is left alone (the response still reports the level held).
 * Returns the level now on record, or null on a DB failure.
 */
export async function recordMark(
  who: { username: string; parentId: string | null },
  track: Track,
  date: string,
  level: MarkLevel,
): Promise<MarkLevel | null> {
  const existing = await dbSelect(
    "rc_reading_marks",
    `?username=eq.${encodeURIComponent(who.username)}&track=eq.${track}&date=eq.${date}&select=level`,
  );
  if (!existing) return null;
  const held = existing[0]?.level;
  if (held === 2) return 2;
  if (held === 1 && level === 1) return 1;
  const ok = await dbUpsert(
    "rc_reading_marks",
    {
      username: who.username,
      parent_id: who.parentId,
      track,
      date,
      level,
      updated_at: new Date().toISOString(),
    },
    "username,track,date",
  );
  return ok ? level : null;
}

/** One student's medal map on a track: their marks + completed quizzes. */
export function medalsOf(
  marks: ReadingMark[],
  sessions: Session[],
  username: string,
  track: Track,
): MedalMap {
  return medalsFor(
    marks.filter((m) => m.username === username && m.track === track),
    completedQuizDates(sessions, username, track),
  );
}

/**
 * The dates whose words are in a student's word bank: readings they've
 * completed the AI quiz on OR marked the handout done (silver) — reading the
 * handout is what earns its words. The single source for /api/quiz-dates
 * and the word-quiz round builder.
 */
export function bankDates(
  sessions: Session[],
  marks: ReadingMark[],
  username: string,
  track: Track,
): Set<string> {
  const dates = completedQuizDates(sessions, username, track);
  for (const m of marks) {
    if (m.username === username && m.track === track && m.level >= 2) {
      dates.add(m.date);
    }
  }
  return dates;
}
