"use client";

import { useMedals } from "./Medals";
import {
  MEDAL_ICON,
  MEDAL_LABEL,
  MEDALS,
  localYMD,
  type Medal,
  type MedalMap,
} from "@/lib/medals";

/**
 * The personal streak ribbon — a quiet light strip under the home page's
 * masthead, for every login (parents earn medals too); nothing logged out.
 * ONE streak across all three levels (owner's rule): a day counts if the
 * member earned a medal on any level's reading of that date. "N-DAY STREAK ·
 * BEST N · N GOLD …" over the last 14 club days as squares, each carrying the
 * day's best medal (🥉 read the article, 🥈 finished the handout, 🥇 did the
 * AI quiz), dashed = today's still open, plain = missed. The medal counts
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
  const days: MedalMap = state?.days ?? {};
  const streak = state?.streak ?? null;

  const square = (d: string, medal: Medal | undefined) => {
    if (!state) {
      return <div key={d} className="h-4 flex-1 border border-stone-200" />;
    }
    if (medal) {
      return (
        <div
          key={d}
          role="img"
          aria-label={`${dateTag(d)}: ${MEDAL_LABEL[medal]}`}
          title={`${dateTag(d)} · ${MEDAL_LABEL[medal]}`}
          className="flex h-4 flex-1 items-center justify-center border border-[#d9c300] bg-[#fff6a8] text-[10px] leading-none"
        >
          {MEDAL_ICON[medal]}
        </div>
      );
    }
    return (
      <div
        key={d}
        title={`${dateTag(d)} · ${d >= today ? "today, still open" : "missed"}`}
        className={`h-4 flex-1 border bg-white ${
          d >= today ? "border-dashed border-stone-500" : "border-stone-300"
        }`}
      />
    );
  };

  // One row on a wide screen (stats · squares · legend); on a phone the
  // squares drop to their own full-width line under the stats. Before the
  // medals load (first visit for this login; after that the provider's cache
  // paints the real bar at once) the same structure renders empty, so the
  // full bar fills in place instead of pushing the deck down when it lands.
  return (
    <div
      className="border-b border-stone-200 bg-stone-50"
      aria-hidden={state ? undefined : true}
    >
      <div className="mx-auto flex max-w-[980px] flex-wrap items-center gap-x-3 gap-y-1.5 px-[18px] py-1.5 text-[9px] font-bold uppercase leading-[14px] tracking-[.15em]">
        {/* The stats may wrap on a phone (the medal tally runs long). */}
        <span className="order-1 flex min-h-[14px] flex-wrap gap-x-[.6em] text-stone-500">
          {streak && (
            <>
              <span className="whitespace-nowrap text-[#0a0a0a]">{streak.current}-day streak</span>
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
            </>
          )}
        </span>
        <div className="order-3 flex basis-full gap-[3px] sm:order-2 sm:basis-0 sm:flex-1">
          {shown.map((d) => square(d, days[d]))}
        </div>
        {/* The legend — hidden on a narrow phone, where the stats line runs
            out of room once the streak hits two digits. */}
        <span className="order-2 ml-auto hidden whitespace-nowrap text-stone-400 min-[430px]:inline sm:order-3 sm:ml-0">
          {MEDALS.map((m, i) => (
            <span key={m}>
              {i > 0 && " · "}
              <span className="mr-1 text-[10px]">{MEDAL_ICON[m]}</span>
              {m === "bronze" ? "Article" : m === "silver" ? "Handout" : "AI quiz"}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
