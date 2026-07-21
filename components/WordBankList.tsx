"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PronounceButton from "@/components/PronounceButton";
import { useAuth } from "@/components/AuthProvider";
import type { Track } from "@/lib/content";

/**
 * One Word Bank word — a vocab entry from one day's reading, flattened
 * server-side (components/WordBank.tsx) with its pronunciation-clip URL
 * already resolved (audioSrcFor reads the filesystem at build time, so it
 * can't run here). `meaning` is the broad "In general" definition.
 */
export type BankWord = {
  term: string;
  pronunciation?: string; // the plain-English respelling
  meaning: string;
  date: string; // "YYYY-MM-DD"
  dateLabel: string; // "Jul 8" — the chip text
  articleTitle: string;
  audioSrc?: string;
  href: string; // track-prefixed handout link for the source day
};

/** The one bordered box every non-list state (loading/login/empty) renders in. */
function StatusBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-10 border-[3px] border-[#0a0a0a] p-8 text-center font-mono text-sm font-bold uppercase tracking-[.08em] text-[#0a0a0a]">
      {children}
    </div>
  );
}

/** A word row: term + respelling + ▶, meaning always visible, date chip. */
function WordRow({ word }: { word: BankWord }) {
  return (
    <li className="border-b-2 border-[#0a0a0a] px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-x-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-sans text-[15px] font-bold leading-tight text-[#0a0a0a]">
            {word.term}
          </span>
          {word.pronunciation && (
            <span className="font-mono text-xs tracking-[.02em] text-stone-500">
              {word.pronunciation}
            </span>
          )}
          <PronounceButton
            text={word.term}
            label={word.term}
            audioSrc={word.audioSrc}
          />
        </div>
        <Link
          href={word.href}
          title={word.articleTitle}
          className="ml-auto inline-block shrink-0 self-start whitespace-nowrap border-2 border-[#0a0a0a] px-2 py-[3px] font-mono text-[10px] font-bold uppercase tracking-[.08em] text-[#0a0a0a] no-underline hover:bg-[#ffe600]"
        >
          {word.dateLabel}
        </Link>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-stone-700">
        {word.meaning}
      </p>
    </li>
  );
}

/**
 * The Word Bank's interactive body. The page itself is static and carries
 * EVERY word of the track (all handouts are public anyway); what's personal
 * is the FILTER — after mount this asks /api/quiz-dates for the logged-in
 * user's own completed-quiz dates (identity from the cookie) and shows only
 * the words from those readings, so nobody is shown words from sessions they
 * never took (the TodayTag/VotePoll recipe: the page stays prerendered, the
 * personal bit hydrates in). Logged out → a log-in prompt instead of a list.
 */
export default function WordBankList({
  words,
  track = "senior",
}: {
  words: BankWord[];
  track?: Track;
}) {
  const { user, ready } = useAuth();
  const [query, setQuery] = useState("");
  const [dates, setDates] = useState<string[] | null>(null); // null = not loaded yet
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!ready || !user) return;
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
  }, [ready, user, track]);

  if (!ready || (user && !failed && dates === null)) {
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

  if (failed) {
    return <StatusBox>Couldn&apos;t load your words — try a reload.</StatusBox>;
  }

  const covered = new Set(dates);
  const mine = words.filter((w) => covered.has(w.date));

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

  const readingCount = new Set(mine.map((w) => w.date)).size;
  const q = query.trim().toLowerCase();
  const shown = q
    ? mine.filter(
        (w) =>
          w.term.toLowerCase().includes(q) ||
          w.meaning.toLowerCase().includes(q) ||
          w.articleTitle.toLowerCase().includes(q),
      )
    : mine;

  return (
    <div>
      <p className="mt-4 font-mono text-xs font-bold uppercase tracking-[.1em] text-stone-500">
        {`${mine.length} words from ${readingCount} ${
          readingCount === 1 ? "reading" : "readings"
        } you've quizzed on`}
      </p>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search your words…"
        aria-label="Search your words"
        className="mt-4 w-full border-[3px] border-[#0a0a0a] bg-white px-4 py-3 font-mono text-sm text-[#0a0a0a] outline-none placeholder:uppercase placeholder:tracking-[.08em] placeholder:text-stone-400 focus:shadow-[5px_5px_0_0_#ffe600]"
      />

      {shown.length === 0 ? (
        <p className="mt-8 border-[3px] border-[#0a0a0a] p-6 text-center font-mono text-sm font-bold uppercase tracking-[.08em] text-[#0a0a0a]">
          No matches for “{query.trim()}”.
        </p>
      ) : (
        <ul className="mt-8 border-[3px] border-[#0a0a0a]">
          {shown.map((w) => (
            <WordRow key={`${w.date}-${w.term}`} word={w} />
          ))}
        </ul>
      )}
    </div>
  );
}
