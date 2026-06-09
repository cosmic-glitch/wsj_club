"use client";

import { useState } from "react";
import type { QuizQuestion } from "@/lib/content";

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
          <div
            key={qi}
            className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm"
          >
            <p className="font-medium text-stone-900">
              <span className="mr-2 text-stone-400">{qi + 1}.</span>
              {q.question}
            </p>
            <div className="mt-4 grid gap-2">
              {q.options.map((opt, oi) => {
                const isPicked = picked === oi;
                const isCorrect = oi === q.answerIndex;
                let cls =
                  "flex items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm transition";
                if (!submitted) {
                  cls += isPicked
                    ? " border-sky-500 bg-sky-50 text-stone-900"
                    : " border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50";
                } else if (isCorrect) {
                  cls += " border-emerald-500 bg-emerald-50 text-emerald-900";
                } else if (isPicked) {
                  cls += " border-red-400 bg-red-50 text-red-900";
                } else {
                  cls += " border-stone-200 bg-white text-stone-500";
                }
                return (
                  <button
                    key={oi}
                    type="button"
                    onClick={() => pick(qi, oi)}
                    disabled={submitted}
                    className={cls}
                  >
                    <span className="mt-0.5 font-semibold text-stone-400">
                      {String.fromCharCode(65 + oi)}
                    </span>
                    <span>{opt}</span>
                  </button>
                );
              })}
            </div>
            {submitted && (
              <p className="mt-3 rounded-lg bg-stone-50 px-4 py-3 text-sm text-stone-600">
                <span className="font-semibold text-stone-800">
                  {picked === q.answerIndex ? "Correct. " : "Not quite. "}
                </span>
                {q.explanation}
              </p>
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-4">
        {!submitted ? (
          <button
            type="button"
            onClick={() => setSubmitted(true)}
            disabled={answeredCount < questions.length}
            className="rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-medium text-white transition enabled:hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {answeredCount < questions.length
              ? `Answer all ${questions.length} questions (${answeredCount}/${questions.length})`
              : "Check my answers"}
          </button>
        ) : (
          <>
            <p className="text-lg font-semibold text-stone-900">
              You scored {score} / {questions.length}
            </p>
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
            >
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
