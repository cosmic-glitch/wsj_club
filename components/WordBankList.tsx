"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PronounceButton from "@/components/PronounceButton";
import { useAuth } from "@/components/AuthProvider";
import type { Track } from "@/lib/content";

/**
 * One word within a day's group — flattened server-side (components/
 * WordBank.tsx) with its pronunciation-clip URL already resolved (audioSrcFor
 * reads the filesystem at build time, so it can't run here). `meaning` is the
 * broad "In general" definition.
 */
export type BankWord = {
  term: string;
  pronunciation?: string; // the plain-English respelling
  meaning: string;
  audioSrc?: string;
};

/** One reading's group: the date (the sort key, shown) + its words. */
export type BankDay = {
  date: string; // "YYYY-MM-DD"
  dateLabel: string; // "Jul 8" — the visible date column
  articleTitle: string;
  href: string; // track-prefixed handout link for the day
  words: BankWord[];
};

/** The one bordered box every non-list state (loading/login/empty) renders in. */
function StatusBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-10 border-[3px] border-[#0a0a0a] p-8 text-center font-mono text-sm font-bold uppercase tracking-[.08em] text-[#0a0a0a]">
      {children}
    </div>
  );
}

/**
 * The Word Bank's interactive body. The page itself is static and carries
 * EVERY reading's words for the track (all handouts are public anyway); what's
 * personal is the FILTER — after mount this asks /api/quiz-dates for the
 * logged-in user's own completed-quiz dates (identity from the cookie) and
 * shows only those days (the TodayTag/VotePoll recipe: the page stays
 * prerendered, the personal bit hydrates in). Logged out → a log-in prompt.
 *
 * Rendered as one row per quizzed reading, NEWEST FIRST — the date is the
 * sort column and leads the row (the LandingIndex row grid), then the article
 * title (→ its handout) with the day's words underneath.
 */
export default function WordBankList({
  days,
  track = "senior",
}: {
  days: BankDay[];
  track?: Track;
}) {
  const { user, isAdmin, ready } = useAuth();
  const [dates, setDates] = useState<string[] | null>(null); // null = not loaded yet
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // isAdmin (parent/owner) skips the fetch — they get the students-only
    // notice below, so their quiz dates are never needed.
    if (!ready || !user || isAdmin) return;
    let cancelled = false;
    fetch(`/api/quiz-dates?track=${track}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((d) => {
        if (!cancelled) setDates(Array.isArray(d.dates) ? d.dates : []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, user, isAdmin, track]);

  if (!ready) {
    return <StatusBox>Loading your words…</StatusBox>;
  }

  if (!user) {
    return (
      <StatusBox>
        Log in to see your word bank.
        <span className="mt-2 block text-xs font-normal normal-case tracking-normal text-stone-500">
          Your bank collects the words from every reading you&apos;ve taken the
          AI quiz on. Use the log-in control at the top of the page.
        </span>
      </StatusBox>
    );
  }

  // A parent (or the owner) has no personal word bank — the bank is built
  // from a student's own quiz sessions.
  if (isAdmin) {
    return (
      <StatusBox>
        Students only.
        <span className="mt-2 block text-xs font-normal normal-case tracking-normal text-stone-500">
          You need to be logged in as a student to see your personal word bank.
        </span>
      </StatusBox>
    );
  }

  if (failed) {
    return <StatusBox>Couldn&apos;t load your words — try a reload.</StatusBox>;
  }

  if (dates === null) {
    return <StatusBox>Loading your words…</StatusBox>;
  }

  const covered = new Set(dates);
  const mine = days.filter((d) => covered.has(d.date));

  if (mine.length === 0) {
    return (
      <StatusBox>
        No words in your bank yet.
        <span className="mt-2 block text-xs font-normal normal-case tracking-normal text-stone-500">
          Take a day&apos;s AI quiz and that reading&apos;s words appear here.
        </span>
      </StatusBox>
    );
  }

  const wordCount = mine.reduce((n, d) => n + d.words.length, 0);

  return (
    <div>
      <p className="mt-4 font-mono text-xs font-bold uppercase tracking-[.1em] text-stone-500">
        {`${wordCount} words from ${mine.length} ${
          mine.length === 1 ? "reading" : "readings"
        } you've quizzed on`}
      </p>

      <ul className="mt-4 border-[3px] border-[#0a0a0a]">
        {mine.map((d) => (
          <li
            key={d.date}
            className="grid grid-cols-1 gap-y-1 border-b-2 border-[#0a0a0a] px-3.5 py-3 last:border-b-0 min-[681px]:grid-cols-[112px_1fr] min-[681px]:gap-x-4 min-[681px]:px-4"
          >
            {/* The sort column: the day, newest group first. */}
            <span className="whitespace-nowrap pt-[2px] font-mono text-xs font-bold uppercase tracking-[.06em] text-[#0a0a0a]">
              {d.dateLabel}
            </span>

            <div className="min-w-0">
              <Link
                href={d.href}
                className="font-sans text-[14.5px] font-bold leading-[1.35] tracking-[-.01em] text-[#0a0a0a] no-underline hover:bg-[#ffe600]"
              >
                {d.articleTitle}
              </Link>

              <ul className="mt-2.5 space-y-2.5">
                {d.words.map((w) => (
                  <li key={w.term}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-sans text-[15px] font-bold leading-tight text-[#0a0a0a]">
                        {w.term}
                      </span>
                      {w.pronunciation && (
                        <span className="font-mono text-xs tracking-[.02em] text-stone-500">
                          {w.pronunciation}
                        </span>
                      )}
                      <PronounceButton
                        text={w.term}
                        label={w.term}
                        audioSrc={w.audioSrc}
                      />
                    </div>
                    <p className="mt-0.5 text-sm leading-relaxed text-stone-700">
                      {w.meaning}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
