"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import type { Track } from "@/lib/content";

/**
 * "Completed by arjun · samaira" on each index row — who has finished the
 * day's AI quiz. The peer-nudge layer: names only, deliberately no "N of M"
 * count (the club mixes regulars with occasional participants, so a
 * denominator would lie).
 *
 * The TodayTag/VotePoll recipe: the page stays statically generated and this
 * hydrates in — but the fetch is hoisted to ONE provider around the readings
 * list (the AuthProvider lesson: a fetch per row would fire a dozen identical
 * requests). Logged out, the provider never fetches and every row renders
 * nothing (the API is login-gated anyway — usernames stay off the public
 * page).
 *
 * Rendered as an inline tail on the row's TITLE span (after the CLUB PICK
 * chip), not as its own grid cell: on mobile the row is a one-column grid, so
 * a new cell would cost a whole line — inline text just flows into the slack
 * at the end of the title's last line.
 */

const CompletionsContext = createContext<Record<string, string[]> | null>(null);

export function CompletionsProvider({
  track = "senior",
  children,
}: {
  track?: Track;
  children: React.ReactNode;
}) {
  const auth = useAuth();
  const [completions, setCompletions] = useState<Record<
    string,
    string[]
  > | null>(null);

  useEffect(() => {
    if (!auth.user) return;
    let stale = false;
    fetch(`/api/quiz-completions?track=${track}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!stale && d?.completions) setCompletions(d.completions);
      })
      .catch(() => {
        // Best-effort chrome — a failed fetch just leaves the tags off.
      });
    return () => {
      stale = true;
    };
  }, [auth.user, track]);

  return (
    <CompletionsContext.Provider value={completions}>
      {children}
    </CompletionsContext.Provider>
  );
}

export function CompletedBy({ date }: { date: string }) {
  const names = useContext(CompletionsContext)?.[date];
  if (!names || names.length === 0) return null;

  return (
    // Mono opts back in (label layer) inside the sans title span; muted so it
    // reads as metadata next to the title, with hover-inversion + yellow-row
    // variants matching the row states.
    <span className="ml-2 font-mono text-[9.5px] font-bold uppercase tracking-[.1em] text-stone-500 group-hover:text-stone-400">
      Completed by {names.join(" · ")}
    </span>
  );
}
