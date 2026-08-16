"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import type { Track } from "@/lib/content";
import type { MasterySummary, WordQuizQuestion } from "@/lib/word-quiz";

/**
 * The Word Bank's quiz panel — the interactive leaf on the static /words page
 * (same recipe as WordBankList below it: hydrate, fetch once with identity
 * from the cookie). Students only; parents get nothing (the list below shows
 * them the students-only notice).
 *
 * One GET builds a scheduled round server-side (due words first — Leitner);
 * the student answers one question at a time with instant feedback; the
 * finishing POST moves each word's mastery box and records the attempt for
 * the Reports page. Abandoning mid-round records nothing.
 */

type Phase = "idle" | "starting" | "playing" | "saving" | "done";

/** What the client keeps per answered question — the POST body's rows. */
type Answered = Pick<
  WordQuizQuestion,
  "word" | "date" | "kind" | "prompt" | "options" | "answerIndex"
> & { pickedIndex: number };

/**
 * Deliberately NO total word count here: the quiz pool dedupes words that
 * appeared in more than one reading (one mastery entry per word), so its
 * total runs slightly under the list's per-reading count below — showing
 * both invited "why don't these match?". Only the two numbers that don't
 * sum to a total survive: mastered, and due today.
 */
function SummaryStrip({ summary }: { summary: MasterySummary }) {
  return (
    <p className="font-mono text-xs font-bold uppercase tracking-[.1em] text-stone-500">
      {`${summary.mastered} ${summary.mastered === 1 ? "word" : "words"} mastered`}
      {summary.due > 0 && (
        <span className="ml-2 bg-[#ffe600] px-1.5 py-0.5 text-[#0a0a0a]">
          {summary.due} due for review
        </span>
      )}
    </p>
  );
}

export default function WordQuiz({ track = "senior" }: { track?: Track }) {
  const { user, isAdmin, ready } = useAuth();
  const [summary, setSummary] = useState<MasterySummary | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [round, setRound] = useState<WordQuizQuestion[]>([]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [answered, setAnswered] = useState<Answered[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !user || isAdmin) return;
    let cancelled = false;
    fetch(`/api/word-quiz?track=${track}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((d) => {
        if (!cancelled && d.summary) setSummary(d.summary);
      })
      .catch(() => {}); // no summary → the panel just stays hidden
    return () => {
      cancelled = true;
    };
  }, [ready, user, isAdmin, track]);

  const start = useCallback(async () => {
    setPhase("starting");
    setError(null);
    try {
      const r = await fetch(`/api/word-quiz?track=${track}`);
      if (!r.ok) throw new Error(`${r.status}`);
      const d = (await r.json()) as {
        round: WordQuizQuestion[];
        summary: MasterySummary;
      };
      setSummary(d.summary);
      if (!Array.isArray(d.round) || d.round.length === 0) {
        throw new Error("empty");
      }
      setRound(d.round);
      setIdx(0);
      setPicked(null);
      setAnswered([]);
      setPhase("playing");
    } catch {
      setError("Couldn't start the quiz — try again.");
      setPhase("idle");
    }
  }, [track]);

  const save = useCallback(
    async (rows: Answered[]) => {
      setPhase("saving");
      setError(null);
      try {
        const r = await fetch("/api/word-quiz", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ track, answered: rows }),
        });
        if (!r.ok) throw new Error(`${r.status}`);
        const d = (await r.json()) as { summary: MasterySummary };
        if (d.summary) setSummary(d.summary);
        setPhase("done");
      } catch {
        setError("Couldn't save your round.");
        setPhase("done");
      }
    },
    [track],
  );

  // Hidden until it can be useful: needs a logged-in student with a bank.
  if (!ready || !user || isAdmin || !summary || summary.total === 0) {
    return null;
  }

  const q = round[idx];
  const isLast = idx === round.length - 1;
  const score = answered.filter((a) => a.pickedIndex === a.answerIndex).length;
  const missed = answered.filter((a) => a.pickedIndex !== a.answerIndex);
  const meaningFor = (word: string) =>
    round.find((r) => r.word === word)?.meaning ?? "";

  function pick(oi: number) {
    if (picked !== null || !q) return;
    setPicked(oi);
    setAnswered((prev) => [
      ...prev,
      {
        word: q.word,
        date: q.date,
        kind: q.kind,
        prompt: q.prompt,
        options: q.options,
        answerIndex: q.answerIndex,
        pickedIndex: oi,
      },
    ]);
  }

  function next(rows: Answered[]) {
    if (isLast) {
      void save(rows);
    } else {
      setIdx((i) => i + 1);
      setPicked(null);
    }
  }

  return (
    <div className="mt-6 border-[3px] border-[#0a0a0a] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-[3px] border-[#0a0a0a] bg-[#0a0a0a] px-4 py-2.5">
        <span className="font-mono text-xs font-bold uppercase tracking-[.14em] text-[#ffe600]">
          Word quiz
        </span>
        {phase === "playing" && (
          <span className="font-mono text-xs font-bold uppercase tracking-[.14em] text-white">
            Word {idx + 1} / {round.length}
          </span>
        )}
      </div>

      {(phase === "idle" || phase === "starting") && (
        <div className="space-y-4 p-4 min-[681px]:p-5">
          <SummaryStrip summary={summary} />
          <p className="text-sm leading-relaxed text-stone-600">
            Test yourself on all the words you&apos;ve read so far. Words you
            miss come back sooner; words you keep getting right show up less
            and less until they&apos;re mastered.
          </p>
          {error && (
            <p className="border-2 border-red-500 bg-red-50 px-3 py-2 font-mono text-xs font-bold uppercase tracking-[.08em] text-red-900">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void start()}
            disabled={phase === "starting"}
            className="border-2 border-[#0a0a0a] bg-[#0a0a0a] px-5 py-2.5 font-mono text-sm font-bold uppercase tracking-[.08em] text-[#ffe600] transition enabled:hover:bg-[#ffe600] enabled:hover:text-[#0a0a0a] disabled:cursor-wait disabled:opacity-60"
          >
            {phase === "starting" ? "Picking your words…" : "Quiz me"}
          </button>
        </div>
      )}

      {phase === "playing" && q && (
        <div className="p-4 min-[681px]:p-5">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[.14em] text-stone-500">
            {q.kind === "example"
              ? "Which word completes the sentence?"
              : "Which word does this definition describe?"}
          </p>
          <p className="mt-3 border-l-[5px] border-[#0a0a0a] bg-stone-100 px-4 py-3 text-sm leading-relaxed text-stone-800">
            {q.prompt}
          </p>
          <div className="mt-4 grid gap-2 min-[521px]:grid-cols-2">
            {q.options.map((opt, oi) => {
              const isPicked = picked === oi;
              const isCorrect = oi === q.answerIndex;
              let cls =
                "flex items-center gap-3 border-2 px-4 py-3 text-left text-[15px] font-bold transition";
              if (picked === null) {
                cls +=
                  " border-[#0a0a0a] bg-white text-[#0a0a0a] hover:bg-[#0a0a0a] hover:text-white";
              } else if (isCorrect) {
                cls += " border-emerald-600 bg-emerald-50 text-emerald-900";
              } else if (isPicked) {
                cls += " border-red-500 bg-red-50 text-red-900";
              } else {
                cls += " border-stone-300 bg-white text-stone-400";
              }
              return (
                <button
                  key={oi}
                  type="button"
                  onClick={() => pick(oi)}
                  disabled={picked !== null}
                  className={cls}
                >
                  <span className="font-mono text-sm opacity-50">
                    {String.fromCharCode(65 + oi)}
                  </span>
                  <span>{opt}</span>
                </button>
              );
            })}
          </div>

          {picked !== null && (
            <div className="mt-4 border-l-[5px] border-[#0a0a0a] bg-stone-100 px-4 py-3 text-sm text-stone-700">
              <span className="mr-1.5 font-mono text-[11px] font-bold uppercase tracking-[.08em] text-[#0a0a0a]">
                {picked === q.answerIndex
                  ? "Correct."
                  : `Not quite — it's "${q.options[q.answerIndex]}".`}
              </span>
              <span className="font-bold">{q.word}</span> — {q.meaning}
            </div>
          )}

          {picked !== null && (
            <button
              type="button"
              onClick={() => next(answered)}
              className="mt-4 border-2 border-[#0a0a0a] bg-[#0a0a0a] px-5 py-2.5 font-mono text-sm font-bold uppercase tracking-[.08em] text-[#ffe600] transition hover:bg-[#ffe600] hover:text-[#0a0a0a]"
            >
              {isLast ? "See my results" : "Next word"}
            </button>
          )}
        </div>
      )}

      {phase === "saving" && (
        <p className="p-6 text-center font-mono text-sm font-bold uppercase tracking-[.08em] text-stone-500">
          Saving your round…
        </p>
      )}

      {phase === "done" && (
        <div className="space-y-4 p-4 min-[681px]:p-5">
          <p className="font-display text-3xl font-normal uppercase text-[#0a0a0a]">
            You scored{" "}
            <span className="bg-[#ffe600] px-1.5">
              {score} / {answered.length}
            </span>
          </p>
          <SummaryStrip summary={summary} />
          {error && (
            <p className="border-2 border-red-500 bg-red-50 px-3 py-2 font-mono text-xs font-bold uppercase tracking-[.08em] text-red-900">
              {error}{" "}
              <button
                type="button"
                onClick={() => void save(answered)}
                className="underline"
              >
                Try saving again
              </button>
            </p>
          )}
          {missed.length > 0 && (
            <div>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[.14em] text-stone-500">
                Worth another look — these come back tomorrow
              </p>
              <ul className="mt-2 space-y-2.5">
                {missed.map((m) => (
                  <li key={m.word} className="text-sm leading-relaxed">
                    <span className="font-bold text-[#0a0a0a]">{m.word}</span>{" "}
                    <span className="text-stone-700">
                      — {meaningFor(m.word)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void start()}
              className="border-2 border-[#0a0a0a] bg-[#0a0a0a] px-5 py-2.5 font-mono text-sm font-bold uppercase tracking-[.08em] text-[#ffe600] transition hover:bg-[#ffe600] hover:text-[#0a0a0a]"
            >
              Another round
            </button>
            <button
              type="button"
              onClick={() => {
                setPhase("idle");
                setError(null);
              }}
              className="border-2 border-[#0a0a0a] bg-white px-4 py-2.5 font-mono text-sm font-bold uppercase tracking-[.08em] text-[#0a0a0a] transition hover:bg-[#0a0a0a] hover:text-white"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
