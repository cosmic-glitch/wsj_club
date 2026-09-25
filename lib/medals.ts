import type { Track } from "@/lib/content";

/**
 * Daily medals — the CLIENT-SAFE half (no DB imports; the server-side store
 * is lib/marks.ts). Every reading a student touches ends the day in one of
 * four states, the highest rung reached:
 *
 *   (nothing) — no mark, no quiz
 *   bronze    — the student marked the article read (level-1 mark)
 *   silver    — the student marked the handout done (level-2 mark; implies
 *               bronze — marking the handout without the article still
 *               gives silver), or finished the self-quiz (same mark)
 *   gold      — a completed AI voice quiz (derived from rc_quiz_sessions,
 *               never stored as a mark; it implies everything below it)
 *
 * A medal only goes up, on the day or later (a past reading can be lifted).
 * ANY medal keeps the streak alive — the streak measures showing up, the
 * medal how far the day went — and silver is what unlocks a reading's words
 * into the word bank (lib/marks.ts bankDates).
 */

export type Medal = "bronze" | "silver" | "gold";

/** The stored attestation levels (gold is derived, not stored). */
export type MarkLevel = 1 | 2;

export const MEDAL_ICON: Record<Medal, string> = {
  bronze: "🥉",
  silver: "🥈",
  gold: "🥇",
};

/** Short labels for tooltips/legends. */
export const MEDAL_LABEL: Record<Medal, string> = {
  bronze: "Read the article",
  silver: "Finished the handout",
  gold: "Did the AI quiz",
};

/** The three rungs in order, for legends. */
export const MEDALS: Medal[] = ["bronze", "silver", "gold"];

export type MedalMap = Record<string, Medal>;

export type Streak = {
  /** Consecutive readings (newest → older) with any medal; a not-yet-past
      reading with no medal is skipped, the first missed past reading ends it. */
  current: number;
  /** The longest such run over the whole history (includes the current run). */
  best: number;
  /** How many readings ended on each rung (only the highest rung counts). */
  counts: Record<Medal, number>;
  /** Readings with any medal. */
  total: number;
};

export function medalOf(level: number | undefined, quizzed: boolean): Medal | undefined {
  if (quizzed) return "gold";
  if (level === 2) return "silver";
  if (level === 1) return "bronze";
  return undefined;
}

const RANK: Record<Medal, number> = { bronze: 1, silver: 2, gold: 3 };

/** The higher of two medals (either may be missing). */
export function higherMedal(a?: Medal, b?: Medal): Medal | undefined {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * Combine one student's stored marks on a track with their completed-quiz
 * dates into the per-date medal map.
 */
export function medalsFor(
  marks: { date: string; level: number }[],
  quizDates: Set<string>,
): MedalMap {
  const out: MedalMap = {};
  for (const m of marks) {
    const medal = medalOf(m.level, false);
    if (medal) out[m.date] = higherMedal(out[m.date], medal)!;
  }
  for (const d of quizDates) out[d] = "gold";
  return out;
}

/**
 * The streak over a track's reading dates (NEWEST FIRST — the index order).
 * `today` is the viewer's local date: today's (or a future) reading with no
 * medal doesn't break the chain, only a missed PAST reading does. A day with
 * no published reading can't break it either — the chain counts readings,
 * not calendar days.
 */
export function streakOf(dates: string[], medals: MedalMap, today: string): Streak {
  let current = 0;
  for (const d of dates) {
    if (medals[d]) current++;
    else if (d >= today) continue;
    else break;
  }
  let best = 0;
  let run = 0;
  for (let i = dates.length - 1; i >= 0; i--) {
    const d = dates[i];
    if (medals[d]) best = Math.max(best, ++run);
    else if (d < today) run = 0;
  }
  const counts: Record<Medal, number> = { bronze: 0, silver: 0, gold: 0 };
  let total = 0;
  for (const d of dates) {
    const m = medals[d];
    if (!m) continue;
    total++;
    counts[m]++;
  }
  return { current, best, counts, total };
}

/** The viewer's local date as "YYYY-MM-DD" (TodayTag's computation). */
export function localYMD(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

/** The handout URL for a reading on a track. */
export function handoutHref(track: Track, date: string): string {
  return `${track === "junior" ? "/junior" : ""}/reading/${date}`;
}
