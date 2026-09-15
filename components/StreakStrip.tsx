"use client";

import { useMedals } from "./Medals";
import {
  MEDAL_ICON,
  MEDAL_LABEL,
  MEDALS,
  localYMD,
  type Medal,
} from "@/lib/medals";

/**
 * The personal streak ribbon — a full-width black bar under the masthead,
 * STUDENTS ONLY (a parent/owner earns no medals, so they never see it):
 * "N-DAY STREAK · BEST N · N GOLD" over the track's last 14 readings as
 * squares, each carrying the day's medal (🥉 read the article, 🥈 finished
 * the handout, 🥇 did the AI quiz), dashed = today's still open, dark =
 * missed. A legend on the right names the three rungs.
 *
 * The data comes from the page's MedalsProvider (one fetch shared with the
 * index rows); the streak itself is computed server-side by lib/medals.ts
 * streakOf — ANY medal keeps the chain alive, a day with no published
 * reading can't break it, today's not-yet-touched reading doesn't either;
 * only a missed PAST reading resets it. "Today" is the viewer's local date,
 * same as TodayTag.
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

export default function StreakStrip({
  dates,
}: {
  /** The track's reading dates, newest first (the index order). */
  dates: string[];
}) {
  const { student, state } = useMedals();
  if (!student || !state || dates.length === 0) return null;

  const { medals, streak } = state;
  const today = localYMD();
  const shown = dates.slice(0, 14).reverse(); // oldest → newest
  const newest = shown[shown.length - 1];

  const square = (d: string, medal: Medal | undefined) => {
    if (medal) {
      return (
        <div
          key={d}
          role="img"
          aria-label={`${dateTag(d)}: ${MEDAL_LABEL[medal]}`}
          title={`${dateTag(d)} · ${MEDAL_LABEL[medal]}`}
          className="flex h-5 flex-1 items-center justify-center border border-[#ffe600] bg-[#ffe600]/15 text-[12px] leading-none"
        >
          {MEDAL_ICON[medal]}
        </div>
      );
    }
    return (
      <div
        key={d}
        title={`${dateTag(d)} · ${d >= today ? "today, still open" : "missed"}`}
        className={`h-5 flex-1 ${
          d >= today
            ? "border-2 border-dashed border-[#ffe600]"
            : "border border-[#3a3a3a]"
        }`}
      />
    );
  };

  return (
    <div className="bg-[#0a0a0a] text-white">
      <div className="mx-auto max-w-[980px] px-[18px] pb-3 pt-2.5">
        <div className="mb-2 flex items-baseline justify-between gap-3 text-[9px] font-bold uppercase tracking-[.15em]">
          <span className="whitespace-nowrap">
            <span className="text-[#ffe600]">{streak.current}-day streak</span>
            {/* "Best" is noise when the current streak IS the best. */}
            {streak.best > streak.current && <>{" · "}Best {streak.best}</>}
            {" · "}
            {streak.gold} gold
          </span>
          {/* The legend — hidden on a narrow phone, where the head line runs
              out of room once the streak hits two digits. */}
          <span className="hidden whitespace-nowrap text-stone-400 min-[430px]:inline">
            {MEDALS.map((m, i) => (
              <span key={m}>
                {i > 0 && " · "}
                <span className="mr-1 text-[10px]">{MEDAL_ICON[m]}</span>
                {m === "bronze" ? "Article" : m === "silver" ? "Handout" : "AI quiz"}
              </span>
            ))}
          </span>
        </div>
        <div className="flex gap-1">{shown.map((d) => square(d, medals[d]))}</div>
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
