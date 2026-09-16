import { currentUserRecord } from "@/lib/auth";
import { loadSessions } from "@/lib/sessions";
import type { Track } from "@/lib/content";
import {
  bankFor,
  buildRound,
  recordRound,
  type AnsweredWordQuestion,
} from "@/lib/word-quiz";
import { bankDates, loadMarksFor } from "@/lib/marks";
import { classroomOf } from "@/lib/users";

/**
 * The word-bank quiz API — for every active login (a parent who reads earns
 * silver like a student, and silver is what fills the bank).
 *
 *   GET  /api/word-quiz?track=   → a freshly scheduled round over the CALLER's
 *                                  bank + their mastery summary (no side
 *                                  effects — nothing changes until POST).
 *   POST /api/word-quiz          → save a finished round: moves each word's
 *                                  Leitner box and records the attempt for
 *                                  the Reports page.
 *
 * Identity always comes from the signed cookie; `track` is only a label.
 * Correctness is recomputed server-side from each question's answerIndex and
 * the source date is re-stamped from the bank — the body's own claims are
 * never trusted for either.
 */

const trackOf = (v: unknown): Track => (v === "junior" ? "junior" : "senior");

async function viewerAndBank(track: Track) {
  const record = await currentUserRecord();
  if (!record || record.active === false) {
    return { error: Response.json({ error: "Not logged in." }, { status: 401 }) };
  }
  const [sessions, marks] = await Promise.all([
    loadSessions(),
    loadMarksFor(record.username, track),
  ]);
  if (!Array.isArray(sessions)) {
    return { error: Response.json({ error: sessions.error }, { status: 500 }) };
  }
  // The bank = quizzed readings + handout-done (silver) readings — the same
  // rule as /api/quiz-dates (lib/marks.ts bankDates).
  const dates = bankDates(sessions, marks ?? [], record.username, track);
  return { record, bank: bankFor(track, dates) };
}

export async function GET(request: Request) {
  const track = trackOf(new URL(request.url).searchParams.get("track"));
  const got = await viewerAndBank(track);
  if ("error" in got) return got.error;

  const built = await buildRound(got.record.username, track, got.bank);
  if (!built) {
    return Response.json(
      { error: "Couldn't load your words — try again." },
      { status: 500 },
    );
  }
  return Response.json(built);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  const { track: rawTrack, answered } = (body ?? {}) as {
    track?: unknown;
    answered?: unknown;
  };
  const track = trackOf(rawTrack);

  const got = await viewerAndBank(track);
  if ("error" in got) return got.error;

  // Validate each answered question and keep only words actually in the
  // caller's bank — a forged word can't seed a mastery row.
  const byWord = new Map(got.bank.map((e) => [e.word.toLowerCase(), e]));
  const clean: AnsweredWordQuestion[] = [];
  const seen = new Set<string>();
  if (Array.isArray(answered)) {
    for (const q of answered.slice(0, 20)) {
      if (!q || typeof q !== "object") continue;
      const { word, kind, prompt, options, answerIndex, pickedIndex } =
        q as Record<string, unknown>;
      if (typeof word !== "string") continue;
      const entry = byWord.get(word.toLowerCase());
      if (!entry || seen.has(word.toLowerCase())) continue;
      if (
        typeof prompt !== "string" ||
        !Array.isArray(options) ||
        !options.every((o) => typeof o === "string") ||
        typeof answerIndex !== "number" ||
        typeof pickedIndex !== "number"
      ) {
        continue;
      }
      seen.add(word.toLowerCase());
      clean.push({
        word: entry.word,
        date: entry.date,
        kind: kind === "example" ? "example" : "meaning",
        prompt,
        options: options as string[],
        answerIndex,
        pickedIndex,
        correct:
          pickedIndex === answerIndex &&
          options[answerIndex]?.toLowerCase() === entry.word.toLowerCase(),
      });
    }
  }
  if (clean.length === 0) {
    return Response.json({ error: "Nothing to record." }, { status: 400 });
  }

  const summary = await recordRound(
    got.record.username,
    classroomOf(got.record) ?? undefined,
    track,
    got.bank,
    clean,
  );
  if (!summary) {
    return Response.json(
      { error: "Couldn't save your round — try again." },
      { status: 500 },
    );
  }
  return Response.json({ ok: true, summary });
}
