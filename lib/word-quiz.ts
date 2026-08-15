import { getAllReadings, type Track } from "@/lib/content";
import { stripMarkdown } from "@/lib/rich-text";
import { dbInsert, dbSelect, dbUpsert } from "@/lib/db";
import type { Session } from "@/components/AdminSessions";

/**
 * The word-bank quiz: multiple-choice rounds over a student's PERSONAL word
 * bank (the vocab from readings they've completed the voice quiz on — the
 * same filter as the Word Bank page), with per-word mastery tracked in
 * rc_word_mastery so every round is scheduled, not random.
 *
 * Scheduling is a plain Leitner ladder. Each (student, track, word) has a
 * box 0–5: a right answer moves it up one, a wrong answer drops it back to 0,
 * and the box sets how many days until the word is due again. A round picks
 * due words first, then words never asked (newest reading first), then pads
 * with not-yet-due words (least recently asked) so a round is always full
 * when the bank allows.
 *
 * Questions are built entirely from authored content — no model calls:
 *   meaning  — the word's definition prose with the word redacted; pick which
 *              word it defines.
 *   example  — an example sentence (or the article quote) with the word
 *              blanked; pick the word that completes it.
 * Both kinds answer with WORDS, so options stay short. Distractors come from
 * the track's full vocab pool (not just the student's bank), same part of
 * speech when possible.
 */

export type WordQuizKind = "meaning" | "example";

export type WordQuizQuestion = {
  word: string; // the answer, exactly as authored
  date: string; // source reading date
  kind: WordQuizKind;
  prompt: string; // redacted meaning prose, or the blanked sentence
  options: string[]; // 4 words (fewer only if the whole pool is tiny)
  answerIndex: number;
  meaning: string; // the answer's full (markdown-stripped) meaning — the reveal after answering
};

/** A question with the student's pick — what a saved attempt stores. */
export type AnsweredWordQuestion = Omit<WordQuizQuestion, "meaning"> & {
  pickedIndex: number;
  correct: boolean;
};

export type MasterySummary = {
  total: number; // words in the bank
  mastered: number; // box >= MASTERED_BOX
  learning: number; // asked at least once, not yet mastered
  fresh: number; // never asked
  due: number; // due for review today
};

export type WordQuizAttempt = {
  id: string;
  username: string;
  parentId?: string;
  track: Track;
  score: number;
  total: number;
  missed: string[]; // the words answered wrong, for the compact reports row
  createdAt: string; // ISO
};

export const ROUND_SIZE = 10;
export const MASTERED_BOX = 4;

/** Days until a word is due again, by the box it just landed in. */
const INTERVAL_DAYS = [1, 1, 3, 7, 14, 30];

/* ---------------------------------------------------------------- bank --- */

type BankEntry = {
  word: string;
  date: string;
  partOfSpeech: string;
  meaning: string;
  examples: string[];
  articleQuote: string;
};

/**
 * The dates of a user's completed voice-quiz sessions on a track — the Word
 * Bank filter (also used by /api/quiz-dates). Terminal attempts count; a
 * cancelled attempt or an in-progress slot doesn't.
 */
export function completedQuizDates(
  sessions: Session[],
  user: string,
  track: Track,
): Set<string> {
  return new Set(
    sessions
      .filter(
        (s) =>
          (s.loginUser ?? s.studentName) === user &&
          !s.cancelled &&
          !s.inProgress &&
          (s.track === "junior") === (track === "junior"),
      )
      .map((s) => s.date),
  );
}

/**
 * The student's quizzable bank: every vocab word from their completed-quiz
 * dates, deduped by word (a recurring word keeps its NEWEST reading date).
 */
export function bankFor(track: Track, dates: Set<string>): BankEntry[] {
  const bank = new Map<string, BankEntry>();
  // getAllReadings is newest-first; first sighting wins = newest date.
  for (const r of getAllReadings(track)) {
    if (!dates.has(r.date)) continue;
    for (const w of r.vocab) {
      const key = w.word.toLowerCase();
      if (!bank.has(key)) {
        bank.set(key, {
          word: w.word,
          date: r.date,
          partOfSpeech: w.partOfSpeech,
          meaning: w.meaning,
          examples: w.examples,
          articleQuote: w.articleQuote,
        });
      }
    }
  }
  return [...bank.values()];
}

/* ------------------------------------------------------------- mastery --- */

type MasteryRow = {
  word: string;
  box: number;
  times_right: number;
  times_wrong: number;
  next_due: string | null;
  last_asked_at: string | null;
};

async function loadMastery(
  user: string,
  track: Track,
): Promise<Map<string, MasteryRow> | null> {
  const rows = await dbSelect(
    "rc_word_mastery",
    `?username=eq.${encodeURIComponent(user)}&track=eq.${track}` +
      `&select=word,box,times_right,times_wrong,next_due,last_asked_at`,
  );
  if (!rows) return null;
  const map = new Map<string, MasteryRow>();
  for (const r of rows) {
    if (typeof r.word !== "string") continue;
    map.set(r.word.toLowerCase(), {
      word: r.word,
      box: typeof r.box === "number" ? r.box : 0,
      times_right: typeof r.times_right === "number" ? r.times_right : 0,
      times_wrong: typeof r.times_wrong === "number" ? r.times_wrong : 0,
      next_due: typeof r.next_due === "string" ? r.next_due : null,
      last_asked_at:
        typeof r.last_asked_at === "string" ? r.last_asked_at : null,
    });
  }
  return map;
}

/** Today as "YYYY-MM-DD" in the club's timezone (US Pacific). */
export function clubToday(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function summarize(
  bank: BankEntry[],
  mastery: Map<string, MasteryRow>,
): MasterySummary {
  const today = clubToday();
  const s: MasterySummary = {
    total: bank.length,
    mastered: 0,
    learning: 0,
    fresh: 0,
    due: 0,
  };
  for (const e of bank) {
    const row = mastery.get(e.word.toLowerCase());
    if (!row || row.times_right + row.times_wrong === 0) s.fresh++;
    else if (row.box >= MASTERED_BOX) s.mastered++;
    else s.learning++;
    if (row?.next_due && row.next_due <= today) s.due++;
  }
  return s;
}

/* ----------------------------------------------------------- questions --- */

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * A pattern matching the word and its common inflections (plural, past,
 * -ing, -ly, y→ies), longest form first, whole words only. Used to redact
 * the answer out of its own definition and to blank example sentences.
 */
function inflectionPattern(word: string): RegExp {
  const w = word.toLowerCase();
  const forms = new Set([w, `${w}s`, `${w}es`, `${w}d`, `${w}ed`, `${w}ing`, `${w}ly`]);
  if (w.endsWith("e")) {
    const s = w.slice(0, -1);
    forms.add(`${s}ing`).add(`${s}ed`);
  }
  if (w.endsWith("y")) {
    const s = w.slice(0, -1);
    forms.add(`${s}ies`).add(`${s}ied`).add(`${s}ily`);
  }
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alts = [...forms]
    .sort((a, b) => b.length - a.length)
    .map(esc)
    .join("|");
  return new RegExp(`\\b(?:${alts})\\b`, "gi");
}

const BLANK = "_____";

/** Replace the word (and inflections) with a blank. hit = anything matched. */
function redact(text: string, word: string): { text: string; hit: boolean } {
  let hit = false;
  const out = text.replace(inflectionPattern(word), () => {
    hit = true;
    return BLANK;
  });
  return { text: out, hit };
}

/** Crude same-stem test so a distractor never near-duplicates the answer. */
function sharesStem(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.slice(0, 4) === y.slice(0, 4);
}

/** First token of the authored part of speech, lowercased ("noun (plural)" → "noun"). */
function posKey(pos: string): string {
  return (pos.split(/[\s,(]+/)[0] || "").toLowerCase();
}

/**
 * The distractor pool: every vocab word across the whole track (deduped),
 * falling back to the senior pool when a young junior track is still too
 * small to fill options.
 */
function distractorPool(track: Track): { word: string; pos: string }[] {
  const seen = new Set<string>();
  const pool: { word: string; pos: string }[] = [];
  const collect = (t: Track) => {
    for (const r of getAllReadings(t)) {
      for (const w of r.vocab) {
        const key = w.word.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        pool.push({ word: w.word, pos: posKey(w.partOfSpeech) });
      }
    }
  };
  collect(track);
  if (track === "junior" && pool.length < 12) collect("senior");
  return pool;
}

function buildQuestion(
  entry: BankEntry,
  pool: { word: string; pos: string }[],
): WordQuizQuestion {
  const meaning = stripMarkdown(entry.meaning);

  // Sentences that actually contain the word are usable as blank-the-word
  // prompts; the article quote counts too (it always should contain it).
  const sentences = [...entry.examples, entry.articleQuote]
    .map((s) => redact(stripMarkdown(s), entry.word))
    .filter((r) => r.hit)
    .map((r) => r.text);

  const kind: WordQuizKind =
    sentences.length > 0 && Math.random() < 0.6 ? "example" : "meaning";
  const prompt =
    kind === "example"
      ? sentences[Math.floor(Math.random() * sentences.length)]
      : redact(meaning, entry.word).text;

  const candidates = pool.filter((c) => !sharesStem(c.word, entry.word));
  const samePos = candidates.filter((c) => c.pos === posKey(entry.partOfSpeech));
  const picked: string[] = [];
  for (const src of [samePos, candidates]) {
    for (const c of shuffle(src)) {
      if (picked.length >= 3) break;
      if (!picked.some((p) => p.toLowerCase() === c.word.toLowerCase())) {
        picked.push(c.word);
      }
    }
  }

  const options = shuffle([entry.word, ...picked]);
  return {
    word: entry.word,
    date: entry.date,
    kind,
    prompt,
    options,
    answerIndex: options.findIndex((o) => o === entry.word),
    meaning,
  };
}

/* --------------------------------------------------------------- round --- */

/**
 * Build a round for a student: due words first (most overdue leading), then
 * never-asked words (newest reading first — fresh readings enter the ladder
 * fast), then a pad of not-yet-due words (least recently asked). The final
 * order is shuffled. Returns null on a DB failure.
 */
export async function buildRound(
  user: string,
  track: Track,
  bank: BankEntry[],
): Promise<{ round: WordQuizQuestion[]; summary: MasterySummary } | null> {
  const mastery = await loadMastery(user, track);
  if (!mastery) return null;

  const today = clubToday();
  const due: BankEntry[] = [];
  const fresh: BankEntry[] = [];
  const rest: BankEntry[] = [];
  for (const e of bank) {
    const row = mastery.get(e.word.toLowerCase());
    if (!row) fresh.push(e);
    else if (row.next_due && row.next_due <= today) due.push(e);
    else rest.push(e);
  }
  const dueKey = (e: BankEntry) =>
    mastery.get(e.word.toLowerCase())?.next_due ?? "";
  const askedKey = (e: BankEntry) =>
    mastery.get(e.word.toLowerCase())?.last_asked_at ?? "";
  due.sort((a, b) => dueKey(a).localeCompare(dueKey(b)));
  fresh.sort((a, b) => b.date.localeCompare(a.date));
  rest.sort((a, b) => askedKey(a).localeCompare(askedKey(b)));

  const chosen = [...due, ...fresh, ...rest].slice(0, ROUND_SIZE);
  const pool = distractorPool(track);
  const round = shuffle(chosen).map((e) => buildQuestion(e, pool));
  return { round, summary: summarize(bank, mastery) };
}

/* ------------------------------------------------------------- results --- */

/**
 * Save a finished round: move each word's Leitner box (right = up one,
 * wrong = back to 0), stamp the next-due date, and record the attempt row
 * for the Reports page. Returns the refreshed summary, or null on failure.
 */
export async function recordRound(
  user: string,
  parentId: string | undefined,
  track: Track,
  bank: BankEntry[],
  answered: AnsweredWordQuestion[],
): Promise<MasterySummary | null> {
  const mastery = await loadMastery(user, track);
  if (!mastery) return null;

  const today = clubToday();
  const now = new Date().toISOString();
  const upserts = answered.map((q) => {
    const row = mastery.get(q.word.toLowerCase());
    const box = q.correct ? Math.min((row?.box ?? 0) + 1, 5) : 0;
    return {
      username: user,
      track,
      word: q.word,
      date: q.date,
      box,
      times_right: (row?.times_right ?? 0) + (q.correct ? 1 : 0),
      times_wrong: (row?.times_wrong ?? 0) + (q.correct ? 0 : 1),
      last_result: q.correct,
      last_asked_at: now,
      next_due: addDays(today, INTERVAL_DAYS[box]),
      updated_at: now,
    };
  });
  if (!(await dbUpsert("rc_word_mastery", upserts, "username,track,word"))) {
    return null;
  }

  const score = answered.filter((q) => q.correct).length;
  const saved = await dbInsert("rc_word_quiz_attempts", {
    username: user,
    parent_id: parentId ?? null,
    track,
    questions: answered,
    score,
    total: answered.length,
  });
  if (saved !== "ok") return null;

  // Re-read so the summary reflects the round just recorded.
  const after = await loadMastery(user, track);
  return after ? summarize(bank, after) : null;
}

/* ----------------------------------------------------- reports loading --- */

/** Recent recorded rounds, newest first, for the Reports page. */
export async function loadWordQuizAttempts(): Promise<WordQuizAttempt[] | null> {
  const rows = await dbSelect(
    "rc_word_quiz_attempts",
    "?select=id,username,parent_id,track,questions,score,total,created_at" +
      "&order=created_at.desc&limit=200",
  );
  if (!rows) return null;
  return rows.flatMap((r) => {
    if (typeof r.id !== "string" || typeof r.username !== "string") return [];
    const questions = Array.isArray(r.questions) ? r.questions : [];
    const missed = questions
      .filter(
        (q): q is AnsweredWordQuestion =>
          !!q && typeof q === "object" && (q as AnsweredWordQuestion).correct === false,
      )
      .map((q) => q.word);
    return [
      {
        id: r.id,
        username: r.username,
        ...(typeof r.parent_id === "string" && r.parent_id
          ? { parentId: r.parent_id }
          : {}),
        track: r.track === "junior" ? ("junior" as const) : ("senior" as const),
        score: typeof r.score === "number" ? r.score : 0,
        total: typeof r.total === "number" ? r.total : questions.length,
        missed,
        createdAt: r.created_at
          ? new Date(String(r.created_at)).toISOString()
          : "",
      },
    ];
  });
}
