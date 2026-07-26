"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Track } from "@/lib/content";

/**
 * "Completed by 3" on each index row — how many accounts have finished the
 * day's AI quiz. The peer-nudge layer: a bare count, PUBLIC to everyone
 * (participation, not identity — the vote's totalVotes call), with no names
 * and deliberately no "of M" denominator (the club mixes regulars with
 * occasional participants, so a total would lie).
 *
 * The TodayTag/VotePoll recipe: the page stays statically generated and this
 * hydrates in — but the fetch is hoisted to ONE provider around the readings
 * list (the AuthProvider lesson: a fetch per row would fire a dozen identical
 * requests).
 *
 * Rendered inside the row's ACTION-BAR span, right of the AI QUIZ button —
 * there's slack there, and it keeps the title clean (it started as a title
 * tail, which the owner found polluted the title). Not its own grid cell: on
 * mobile the row is a one-column grid, so a new cell would cost a whole line;
 * in the bar it shares the buttons' line (wrapping within the bar only on the
 * narrowest screens).
 */

const CompletionsContext = createContext<Record<string, number> | null>(null);

export function CompletionsProvider({
  track = "senior",
  children,
}: {
  track?: Track;
  children: React.ReactNode;
}) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let stale = false;
    fetch(`/api/quiz-completions?track=${track}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!stale && d?.counts) setCounts(d.counts);
      })
      .catch(() => {
        // Best-effort chrome — a failed fetch just leaves the tags off.
      });
    return () => {
      stale = true;
    };
  }, [track]);

  return (
    <CompletionsContext.Provider value={counts}>
      {children}
    </CompletionsContext.Provider>
  );
}

export function CompletedBy({ date }: { date: string }) {
  const count = useContext(CompletionsContext)?.[date];
  if (!count) return null;

  return (
    // self-center keeps the tiny label vertically centered on the buttons'
    // line; muted so it reads as metadata next to them, with a
    // hover-inversion variant matching the row states.
    <span className="self-center whitespace-nowrap font-mono text-[9.5px] font-bold uppercase tracking-[.1em] text-stone-500 group-hover:text-stone-400">
      Completed by {count}
    </span>
  );
}
