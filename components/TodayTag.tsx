"use client";

import { useEffect, useState } from "react";

/**
 * The black "TODAY" chip on the newest reading's row — shown only when that
 * reading's date is actually the viewer's current date. The page is statically
 * generated, so a build-time check would freeze "today" at build time; instead
 * the check runs client-side after mount (server and first client render both
 * produce nothing, so there's no hydration mismatch — the chip just pops in),
 * and it uses the viewer's local date rather than the build server's UTC.
 */
export default function TodayTag({ date }: { date: string }) {
  const [isToday, setIsToday] = useState(false);

  useEffect(() => {
    const now = new Date();
    const local = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    setIsToday(local === date);
  }, [date]);

  if (!isToday) return null;

  return (
    <span className="ml-[9px] inline-block bg-[#0a0a0a] px-[7px] py-[2px] align-[1px] text-[9.5px] font-bold tracking-[.2em] text-[#ffe600]">
      TODAY
    </span>
  );
}
