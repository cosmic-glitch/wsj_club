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
 * The personal streak ribbon — a full-width black bar under the home page's
 * masthead, for every login (parents earn medals too); nothing logged out.
 * ONE streak across all three levels (owner's rule): a day counts if the
 * member earned a medal on any level's reading of that date. "N-DAY STREAK ·
 * BEST N · N GOLD …" over the last 14 club days as squares, each carrying the
 * day's best medal (🥉 read the article, 🥈 finished the handout, 🥇 did the
 * AI quiz), dashed = today's still open, dark = missed. The medal counts
 * count every reading on every level.
 *
 * The data comes from the page's MedalsProvider (any track's — the streak and
 * the per-day map are the same in each); the streak itself is computed
 * server-side by lib/medals.ts clubStreak. "Today" is the viewer's local
 * date, same as TodayTag.
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
  /** The club days (every date any level published), newest first. */
  dates: string[];
}) {
  const { loggedIn, state, failed } = useMedals();
  if (!loggedIn || dates.length === 0 || (!state && failed)) return null;

  const today = localYMD();
  const shown = dates.slice(0, 14).reverse(); // oldest → newest
  const newest = shown[shown.length - 1];

  // Medals not loaded yet (first visit for this login; after that the
  // provider's cache paints the real bar at once): an empty bar with the same
  // structure, so the full one fills in place instead of pushing the deck
  // and the readings down when it lands.
  if (!state) {
    return (
      <div className="bg-[#0a0a0a] text-white" aria-hidden="true">
        <div className="mx-auto max-w-[980px] px-[18px] pb-3 pt-2.5">
          <div className="mb-2 min-h-[15px]" />
          <div className="flex gap-1">
            {shown.map((d) => (
              <div key={d} className="h-5 flex-1 border border-[#3a3a3a]" />
            ))}
          </div>
          <div className="mt-[5px] text-[7.5px] font-bold">&nbsp;</div>
        </div>
      </div>
    );
  }

  const { days, streak } = state;

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
        {/* The head line may wrap on a phone (the medal tally runs long) —
            it used to be one nowrap line and ran off the screen's edge. */}
        <div className="mb-2 flex min-h-[15px] items-baseline justify-between gap-3 text-[9px] font-bold uppercase leading-[15px] tracking-[.15em]">
          <span className="flex flex-wrap gap-x-[.6em]">
            <span className="whitespace-nowrap text-[#ffe600]">{streak.current}-day streak</span>
            {/* "Best" is noise when the current streak IS the best. */}
            {streak.best > streak.current && (
              <span className="whitespace-nowrap">· Best {streak.best}</span>
            )}
            {/* The tally of medals actually held, highest rung first — a
                rung with none is left out, so a bronze-only reader sees
                "3 bronze", not "0 gold". */}
            {[...MEDALS]
              .reverse()
              .filter((m) => streak.counts[m] > 0)
              .map((m) => (
                <span key={m} className="whitespace-nowrap">
                  · {streak.counts[m]} {m}
                </span>
              ))}
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
        <div className="flex gap-1">{shown.map((d) => square(d, days[d]))}</div>
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
