"use client";

import Link from "next/link";
import { useState } from "react";
import { useMedals } from "./Medals";
import VoiceQuiz from "./VoiceQuiz";
import type { Track } from "@/lib/content";
import { MEDAL_ICON, MEDAL_LABEL } from "@/lib/medals";

/**
 * The handout's finish line — the yellow box at the end of the page. For a
 * logged-in STUDENT it's where the day gets its silver: a pledge ("I attest
 * that I have read every word to know and every concept … and understand
 * what each means") that must be ticked before Mark-it-done enables; the
 * moment it's tapped the box flips
 * to the done state with the streak ticking up in place, then offers the
 * step up (the AI quiz launcher — gold) and the self-quiz. Already silver →
 * straight to the done state; gold → "AI quiz done". A parent or a
 * logged-out visitor gets the plain self-quiz CTA the box always had.
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
  const { ready, student, state, mark } = useMedals();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attested, setAttested] = useState(false);
  const quizHref = `${track === "junior" ? "/junior" : ""}/reading/${date}/quiz`;

  const box = "mt-14 border-[3px] border-[#0a0a0a] bg-[#ffe600] p-6 text-center";
  const head =
    "font-mono text-sm font-bold uppercase tracking-[.08em] text-[#0a0a0a]";
  const primary =
    "mt-4 inline-block border-2 border-[#0a0a0a] bg-[#0a0a0a] px-6 py-3 font-mono text-sm font-bold uppercase tracking-[.1em] text-[#ffe600] no-underline transition hover:bg-white hover:text-[#0a0a0a]";
  const secondary =
    "inline-block border-2 border-[#0a0a0a] bg-white px-4 py-2 font-mono text-xs font-bold uppercase tracking-[.1em] text-[#0a0a0a] no-underline transition hover:bg-[#0a0a0a] hover:text-white";

  // Not a student (or auth/medals still loading): the plain CTA.
  const medal = state?.medals[date];
  if (!ready || !student || !state) {
    return (
      <div className={box}>
        <p className={head}>Read the handout? Now test yourself.</p>
        <Link href={quizHref} className={primary}>
          Take the self-quiz →
        </Link>
      </div>
    );
  }

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
        <p className={head}>Before you mark it done</p>
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
        <p className="mt-4">
          <Link href={quizHref} className={secondary}>
            Or take the self-quiz →
          </Link>
        </p>
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
      <p className="mt-4">
        <Link href={quizHref} className={secondary}>
          Take the self-quiz →
        </Link>
      </p>
    </div>
  );
}
