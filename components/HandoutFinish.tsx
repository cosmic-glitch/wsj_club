"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { useMedals } from "./Medals";
import VoiceQuiz from "./VoiceQuiz";
import type { Track } from "@/lib/content";
import { MEDAL_ICON, MEDAL_LABEL } from "@/lib/medals";

/**
 * The handout's finish line — the yellow box at the end of the page. For any
 * logged-in reader (student or parent) it's where the day gets its silver: a pledge ("I attest
 * that I have read every word to know and every concept … and understand
 * what each means") that must be ticked before Mark-it-done enables; the
 * moment it's tapped the box flips
 * to the done state with the streak ticking up in place, then offers the
 * step up (the AI quiz launcher — gold). Already silver → straight to the
 * done state; gold → "AI quiz done". A logged-out visitor is told to log
 * in. (The self-quiz page still exists by
 * URL and still records silver, but the handout no longer links to it —
 * owner's call.)
 *
 * Marking the handout done gives silver even without a bronze (each rung
 * implies the ones below); a mark only goes up. The provider around this
 * (Handout wraps it in MedalsProvider) owns the fetch + the POST.
 */
export default function HandoutFinish({
  track,
  date,
  title,
  voiceQuiz,
}: {
  track: Track;
  date: string;
  title: string;
  voiceQuiz: boolean;
}) {
  const { ready, loggedIn, state, mark } = useMedals();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attested, setAttested] = useState(false);

  const box = "mt-14 border-[3px] border-[#0a0a0a] bg-[#ffe600] p-6 text-center";
  const head =
    "font-mono text-sm font-bold uppercase tracking-[.08em] text-[#0a0a0a]";
  const primary =
    "mt-4 inline-block border-2 border-[#0a0a0a] bg-[#0a0a0a] px-6 py-3 font-mono text-sm font-bold uppercase tracking-[.1em] text-[#ffe600] no-underline transition hover:bg-white hover:text-[#0a0a0a]";
  // Auth unknown yet, or a login whose medals haven't loaded: nothing.
  // Logged out: say how to earn the medal, so a reader who isn't signed in
  // knows the box exists.
  if (!ready) return null;
  if (!user) {
    return (
      <div className={box}>
        <p className={head}>Earn a silver medal {MEDAL_ICON.silver}</p>
        <p className="mx-auto mt-3 max-w-md font-sans text-[15px] leading-relaxed text-[#0a0a0a]">
          Log in (top right) to attest you&apos;ve read this handout and
          mark it done.
        </p>
      </div>
    );
  }
  if (!loggedIn || !state) return null;
  const medal = state.medals[date];

  async function markDone() {
    setBusy(true);
    setFailed(false);
    const s = await mark(date, 2);
    setBusy(false);
    if (!s) setFailed(true);
  }

  if (!medal || medal === "bronze") {
    return (
      <div className={box}>
        <p className={head}>Earn a silver medal {MEDAL_ICON.silver}</p>
        <label className="mx-auto mt-3 flex max-w-md cursor-pointer items-start gap-3 text-left font-sans text-[15px] leading-relaxed text-[#0a0a0a]">
          <input
            type="checkbox"
            checked={attested}
            onChange={(e) => setAttested(e.target.checked)}
            className="mt-1 h-5 w-5 flex-none cursor-pointer accent-[#0a0a0a]"
          />
          <span>
            I attest that I have read every word to know and every concept in
            this handout, and that I understand what each of them means.
          </span>
        </label>
        <button
          type="button"
          onClick={markDone}
          disabled={busy || !attested}
          className={`${primary} disabled:cursor-not-allowed disabled:opacity-40`}
        >
          {busy ? "Saving…" : `Mark it done ${MEDAL_ICON.silver}`}
        </button>
        {failed && (
          <p className="mt-3 font-mono text-xs font-bold uppercase tracking-[.08em] text-red-700">
            Couldn&apos;t save that — try again.
          </p>
        )}
      </div>
    );
  }

  const { streak } = state;
  return (
    <div className={box}>
      <p className={head}>
        <span role="img" aria-label={MEDAL_LABEL[medal]} className="mr-2">
          {MEDAL_ICON[medal]}
        </span>
        {medal === "gold" ? "AI quiz done." : "Handout done."}{" "}
        <span className="bg-[#0a0a0a] px-1.5 text-[#ffe600]">
          {streak.current}-day streak
        </span>
      </p>
      {medal === "silver" && voiceQuiz && (
        <>
          <p className="mt-3 font-sans text-[15px] text-[#0a0a0a]">
            Want gold? Explain the article to the AI tutor.
          </p>
          <VoiceQuiz
            date={date}
            title={title}
            track={track}
            launcherClassName={primary}
            launcherLabel={`Take the AI quiz ${MEDAL_ICON.gold}`}
          />
        </>
      )}
    </div>
  );
}
