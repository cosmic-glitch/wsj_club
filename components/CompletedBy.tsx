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
 * Placement is RESPONSIVE — LandingIndex renders it twice, one visible per
 * breakpoint: on desktop in the row's action bar right of the AI QUIZ button
 * (real slack there), on mobile RIGHT-ALIGNED on the DATE line (the date +
 * TODAY chip sit left, the count is pushed to the row's right edge so the
 * line doesn't read crowded) — the phone's action bar has no slack (three
 * buttons ≈ ¾ of the width, so the tag wrapped to its own line, which the
 * owner ruled out), while the date line is mostly empty. It started as a
 * title tail,
 * which the owner found polluted the title; never its own grid cell (a new
 * cell = a whole extra mobile line).
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

export function CompletedBy({
  date,
  className = "",
}: {
  date: string;
  className?: string;
}) {
  const count = useContext(CompletionsContext)?.[date];
  if (!count) return null;

  return (
    // Muted so it reads as metadata next to the date / buttons, with a
    // hover-inversion variant matching the row states; the caller's className
    // carries the per-breakpoint visibility + spacing.
    <span
      className={`whitespace-nowrap font-mono text-[9.5px] font-bold uppercase tracking-[.1em] text-stone-500 group-hover:text-stone-400 ${className}`}
    >
      Completed by {count}
    </span>
  );
}
