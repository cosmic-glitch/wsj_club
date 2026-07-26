"use client";

import { useState } from "react";
import type { QuizQuestion } from "@/lib/content";
import { Rich } from "@/lib/rich-text";

// The interactive self-quiz, in the site's brutalist language: square black
// borders, mono uppercase labels, the yellow #ffe600 accent for the picked
// (and, after submit, correct) option. Right/wrong keep the semantic
// emerald/red hues so the feedback stays instantly readable for kids.
export default function Quiz({ questions }: { questions: QuizQuestion[] }) {
  // answers[i] = the option index the student picked for question i (or null)
  const [answers, setAnswers] = useState<(number | null)[]>(
    () => questions.map(() => null)
  );
  const [submitted, setSubmitted] = useState(false);

  const answeredCount = answers.filter((a) => a !== null).length;
  const score = questions.reduce(
    (n, q, i) => (answers[i] === q.answerIndex ? n + 1 : n),
    0
  );

  function pick(qi: number, oi: number) {
    if (submitted) return;
    setAnswers((prev) => {
      const next = [...prev];
      next[qi] = oi;
      return next;
    });
  }

  function reset() {
    setAnswers(questions.map(() => null));
    setSubmitted(false);
  }

  return (
    <div className="space-y-6">
      {questions.map((q, qi) => {
        const picked = answers[qi];
        return (
          <div key={qi} className="border-[3px] border-[#0a0a0a] bg-white p-5">
            <p className="font-bold text-[#0a0a0a]">
              <span className="mr-2 font-mono text-stone-400">{qi + 1}.</span>
              <Rich text={q.question} />
            </p>
            <div className="mt-4 grid gap-2">
              {q.options.map((opt, oi) => {
                const isPicked = picked === oi;
                const isCorrect = oi === q.answerIndex;
                let cls =
                  "flex items-start gap-3 border-2 px-4 py-3 text-left text-sm transition";
                if (!submitted) {
                  cls += isPicked
                    ? " border-[#0a0a0a] bg-[#ffe600] text-[#0a0a0a]"
                    : " border-[#0a0a0a] bg-white text-stone-800 hover:bg-[#0a0a0a] hover:text-white";
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
                    onClick={() => pick(qi, oi)}
                    disabled={submitted}
                    className={cls}
                  >
                    {/* opacity (not a fixed grey) so the letter stays legible
                        when the row hover-inverts to black. */}
                    <span className="mt-0.5 font-mono font-bold opacity-50">
                      {String.fromCharCode(65 + oi)}
                    </span>
                    <span>
                      <Rich text={opt} />
                    </span>
                  </button>
                );
              })}
            </div>
            {submitted && (
              <p className="mt-3 border-l-[5px] border-[#0a0a0a] bg-stone-100 px-4 py-3 text-sm text-stone-700">
                <span className="mr-1.5 font-mono text-[11px] font-bold uppercase tracking-[.08em] text-[#0a0a0a]">
                  {picked === q.answerIndex ? "Correct." : "Not quite."}
                </span>
                <Rich text={q.explanation} />
              </p>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-4">
        {!submitted ? (
          <button
            type="button"
            onClick={() => setSubmitted(true)}
            disabled={answeredCount < questions.length}
            className="border-2 border-[#0a0a0a] bg-[#0a0a0a] px-5 py-2.5 font-mono text-sm font-bold uppercase tracking-[.08em] text-[#ffe600] transition enabled:hover:bg-[#ffe600] enabled:hover:text-[#0a0a0a] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {answeredCount < questions.length
              ? `Answer all ${questions.length} questions (${answeredCount}/${questions.length})`
              : "Check my answers"}
          </button>
        ) : (
          <>
            <p className="font-display text-2xl font-normal uppercase text-[#0a0a0a]">
              You scored{" "}
              <span className="bg-[#ffe600] px-1.5">
                {score} / {questions.length}
              </span>
            </p>
            <button
              type="button"
              onClick={reset}
              className="border-2 border-[#0a0a0a] bg-white px-4 py-2 font-mono text-sm font-bold uppercase tracking-[.08em] text-[#0a0a0a] transition hover:bg-[#0a0a0a] hover:text-white"
            >
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
