"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import type { Track } from "@/lib/content";

/**
 * The personal streak ribbon — a full-width black bar under the masthead,
 * STUDENTS ONLY (a parent/owner takes no quizzes, so they never see it):
 * "N-DAY STREAK · BEST N · N QUIZZES" over the track's last 14 readings as
 * squares (yellow = quizzed, dashed = today's still open, dark = missed).
 *
 * The TodayTag/VotePoll/CompletedBy recipe: the page stays statically
 * generated and this hydrates in, ONE fetch on mount — and it reuses
 * /api/quiz-dates (identity from the cookie, "completed" = the same terminal
 * attempts the Word Bank and Scores count) rather than adding a route.
 *
 * A streak counts consecutive READINGS quizzed, not calendar days — a day
 * with no published reading can't break it, and the occasional junior track
 * gets the same semantics. Today's not-yet-taken quiz doesn't break the
 * chain either (it shows as the dashed square); only a missed PAST reading
 * resets it. "Today" is the viewer's local date, same as TodayTag.
 */

/** "2026-07-08" → "Jul 8" — same as LandingIndex's dateTag. */
function dateTag(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The viewer's local date as "YYYY-MM-DD" (TodayTag's computation). */
function localYMD(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export default function StreakStrip({
  track,
  dates,
}: {
  track: Track;
  /** The track's reading dates, newest first (the index order). */
  dates: string[];
}) {
  const { user, role, ready } = useAuth();
  const [done, setDone] = useState<Set<string> | null>(null);

  const student = ready && Boolean(user) && role === "student";

  useEffect(() => {
    if (!student) return;
    let stale = false;
    fetch(`/api/quiz-dates?track=${track}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!stale && Array.isArray(d?.dates)) setDone(new Set(d.dates));
      })
      .catch(() => {
        // Best-effort chrome — a failed fetch just leaves the ribbon off.
      });
    return () => {
      stale = true;
    };
  }, [student, track]);

  if (!student || !done || dates.length === 0) return null;

  const today = localYMD();

  // Current streak: walk newest → oldest; a pending (not-yet-past) reading is
  // skipped, the first missed past reading ends the run.
  let current = 0;
  for (const d of dates) {
    if (done.has(d)) current++;
    else if (d >= today) continue;
    else break;
  }

  // Best streak: the longest completed run over the whole history (a pending
  // reading doesn't cut a run, same as above). Includes the current run.
  let best = 0;
  let run = 0;
  for (let i = dates.length - 1; i >= 0; i--) {
    const d = dates[i];
    if (done.has(d)) best = Math.max(best, ++run);
    else if (d < today) run = 0;
  }

  const total = done.size;
  const shown = dates.slice(0, 14).reverse(); // oldest → newest
  const newest = shown[shown.length - 1];

  return (
    <div className="bg-[#0a0a0a] text-white">
      <div className="mx-auto max-w-[980px] px-[18px] pb-3 pt-2.5">
        <div className="mb-2 flex items-baseline justify-between gap-3 text-[9px] font-bold uppercase tracking-[.15em]">
          <span className="whitespace-nowrap">
            <span className="text-[#ffe600]">{current}-day streak</span>
            {/* "Best" is noise when the current streak IS the best. */}
            {best > current && <>{" · "}Best {best}</>}
            {" · "}
            {total} {total === 1 ? "quiz" : "quizzes"}
          </span>
          {/* Redundant with the ticks row on a narrow phone, where the head
              line runs out of room once the streak hits two digits. */}
          <span className="hidden whitespace-nowrap text-stone-400 min-[430px]:inline">
            Last {shown.length} readings
          </span>
        </div>
        <div className="flex gap-1">
          {shown.map((d) => (
            <div
              key={d}
              className={`h-4 flex-1 ${
                done.has(d)
                  ? "bg-[#ffe600]"
                  : d >= today
                    ? "border-2 border-dashed border-[#ffe600]"
                    : "border border-[#3a3a3a]"
              }`}
            />
          ))}
        </div>
        <div className="mt-[5px] flex justify-between text-[7.5px] font-bold uppercase tracking-[.12em] text-stone-400">
          <span>{dateTag(shown[0])}</span>
          <span className={newest >= today ? "text-[#ffe600]" : ""}>
            {newest >= today ? "Today" : dateTag(newest)}
          </span>
        </div>
      </div>
    </div>
  );
}
