"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ArticleLink from "@/components/ArticleLink";
import TodayTag from "@/components/TodayTag";

/**
 * The daily article vote — the "TODAY'S READ — YOU DECIDE" row at the top of
 * the senior index (see the daily vote in CLAUDE.md).
 *
 * The ROW is deliberately compact — date · title · one boxed VOTE button,
 * exactly the shape of every other reading row — because a poll can carry many
 * candidates (7–10), which inline would swamp the landing page. The candidates
 * live in a MODAL the button opens: pick one (tap to select), press Submit,
 * see the tally. The modal is PORTALED to document.body for the same reason
 * VoiceQuiz's is — the landing list's transform entrance animation makes a
 * nested position:fixed overlay anchor to the list instead of the viewport on
 * iOS — and it scrolls internally (max-h + overflow-y-auto) so a long ballot
 * stays usable on a phone.
 *
 * Rendered as the FIRST <li> of the (statically generated) readings list; it
 * fetches `/api/vote` after mount and renders nothing when no poll is live, so
 * the page stays static and hydration always matches (same recipe as the TODAY
 * chip). While a poll is live the previous newest row keeps its server-rendered
 * yellow — the `vote-live` class on this row is what demotes it, via sibling-
 * selector variants in LandingIndex (`[.vote-live~&]:…`), so the poll takes
 * over as THE highlighted "today" entry.
 *
 * Candidates show their real article links (many families subscribe — the
 * pitch plus the article is what people vote on). Voting requires login (the
 * same on-click gate as the voice quiz — logged out, the modal shows a log-in
 * prompt instead of the ballot); a vote can be changed while the poll is live,
 * and the tally (counts only, never names) appears only after you've cast
 * yours. No deadline is shown — the owner announces the window in the group
 * chat, and publishing the day's reading is what actually closes the poll.
 */

type Candidate = {
  id: string;
  title: string;
  source: string;
  pitch: string;
  articleUrl: string;
};

type PollState = {
  active: boolean;
  date?: string;
  candidates?: Candidate[];
  user?: string | null;
  yourVote?: string | null;
  tally?: Record<string, number>;
};

/** "2026-07-16" → "Jul 16" (rendered uppercase — same as the row date tags). */
function dateTag(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// The row's VOTE button — the exact boxed-uppercase style of the other rows'
// action buttons (LandingIndex's `btn`), group-hover inversion included.
const ROW_BTN =
  "inline-block cursor-pointer border-2 border-[#0a0a0a] px-[10px] py-[5px] text-[10.5px] font-bold uppercase leading-normal tracking-[.08em] text-[#0a0a0a] no-underline min-[681px]:px-2 min-[681px]:py-[3px] group-hover:border-white group-hover:text-white group-hover:hover:border-[#ffe600] group-hover:hover:bg-[#ffe600] group-hover:hover:text-[#0a0a0a]";

// Modal buttons/headings in the voice-quiz modal's brutalist language.
const BTN_PRIMARY =
  "border-2 border-[#0a0a0a] bg-[#0a0a0a] px-5 py-2.5 font-mono text-sm font-bold uppercase tracking-[.08em] text-[#ffe600] transition hover:bg-[#ffe600] hover:text-[#0a0a0a] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-[#0a0a0a] disabled:hover:text-[#ffe600]";
const BTN_SECONDARY =
  "border-2 border-[#0a0a0a] bg-white px-4 py-2 font-mono text-xs font-bold uppercase tracking-[.06em] text-[#0a0a0a] transition hover:bg-[#0a0a0a] hover:text-[#ffe600]";
const MODAL_H2 = "font-display text-xl font-normal uppercase text-[#0a0a0a]";

export default function VotePoll() {
  const [poll, setPoll] = useState<PollState | null>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/vote", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: PollState) => setPoll(d))
      .catch(() => setPoll({ active: false }));
  }, []);

  // Esc closes the modal; lock body scroll while it's open (the AdminSessions
  // recipe — the ballot scrolls inside the panel, not behind it).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!poll?.active || !poll.date || !poll.candidates?.length) return null;
  const { date, candidates } = poll;
  const voted = Boolean(poll.yourVote);

  function openModal() {
    setSelected(poll?.yourVote ?? null);
    setError(null);
    setOpen(true);
  }

  async function submit() {
    if (!selected || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, candidateId: selected }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Could not save your vote. Please try again.");
      } else {
        setPoll((p) =>
          p ? { ...p, yourVote: d.yourVote, tally: d.tally } : p
        );
      }
    } catch {
      setError("Could not save your vote. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const modal = !open
    ? null
    : createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0a]/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-lg flex-col border-[3px] border-[#0a0a0a] bg-white shadow-[8px_8px_0_#ffe600,8px_8px_0_3px_#0a0a0a]"
            onClick={(e) => e.stopPropagation()}
          >
            {!poll.user ? (
              // Logged out: the same on-click gate as the voice quiz.
              <div className="p-6">
                <h2 className={MODAL_H2}>You need to log in</h2>
                <p className="mt-2 font-sans text-sm text-stone-600">
                  Please log in first (the &ldquo;Log in&rdquo; button at the
                  top of the page), then cast your vote.
                </p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className={`mt-5 ${BTN_SECONDARY}`}
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <div className="px-5 pt-5 pb-3">
                  <h2 className={MODAL_H2}>Today&rsquo;s read — you decide</h2>
                  <p className="mt-1 font-sans text-[13px] leading-snug text-stone-600">
                    {voted
                      ? "Your vote is in — you can change it until the handout is published."
                      : "Tap the article the club should read today, then submit. You can change your vote until the handout is published."}
                  </p>
                </div>

                {/* the ballot — scrolls inside the panel on a long candidate list */}
                <div
                  role="radiogroup"
                  aria-label="Today's article candidates"
                  className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-1"
                >
                  {candidates.map((c) => {
                    const isSelected = selected === c.id;
                    const isYourVote = poll.yourVote === c.id;
                    const count = poll.tally?.[c.id];
                    return (
                      <div
                        key={c.id}
                        role="radio"
                        aria-checked={isSelected}
                        tabIndex={0}
                        onClick={() => setSelected(c.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelected(c.id);
                          }
                        }}
                        className={`cursor-pointer border-2 border-[#0a0a0a] p-3 transition-shadow ${
                          isSelected
                            ? "bg-[#ffe600] shadow-[4px_4px_0_#0a0a0a]"
                            : "bg-white hover:bg-stone-100"
                        }`}
                      >
                        <p className="text-[13.5px] font-bold leading-[1.35]">
                          <span className="mr-2 inline-block bg-[#0a0a0a] px-[6px] py-[1px] align-[2px] text-[9px] font-bold uppercase tracking-[.14em] text-white">
                            {c.source}
                          </span>
                          {c.title}
                        </p>
                        <p className="mt-1 font-sans text-[13px] leading-snug text-stone-700">
                          {c.pitch}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <ArticleLink
                            href={c.articleUrl}
                            className="inline-block border-2 border-[#0a0a0a] bg-white px-2 py-[3px] text-[10px] font-bold uppercase tracking-[.08em] text-[#0a0a0a] no-underline hover:bg-[#0a0a0a] hover:text-[#ffe600]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Read it
                          </ArticleLink>
                          {isYourVote && (
                            <span className="text-[10px] font-bold uppercase tracking-[.08em]">
                              Your vote ✓
                            </span>
                          )}
                          {typeof count === "number" && (
                            <span className="ml-auto whitespace-nowrap text-[10px] font-bold uppercase tracking-[.08em] text-stone-600">
                              {count} vote{count === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="border-t-2 border-[#0a0a0a] px-5 py-4">
                  {error && (
                    <p className="mb-2 font-sans text-[13px] font-bold text-red-700">
                      {error}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={submit}
                      disabled={!selected || selected === poll.yourVote || pending}
                      className={`flex-1 ${BTN_PRIMARY}`}
                    >
                      {pending
                        ? "Saving…"
                        : voted
                          ? selected === poll.yourVote
                            ? "Vote saved ✓"
                            : "Change vote"
                          : "Submit vote"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className={BTN_SECONDARY}
                    >
                      Close
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      );

  return (
    <li className="vote-live group grid grid-cols-1 gap-y-[6px] border-b-2 border-[#0a0a0a] bg-[#ffe600] px-3.5 py-3 hover:bg-[#0a0a0a] hover:text-white min-[681px]:grid-cols-[112px_1fr_max-content] min-[681px]:items-center min-[681px]:gap-4 min-[681px]:px-4">
      <span className="whitespace-nowrap text-xs font-bold uppercase tracking-[.06em] group-hover:text-[#ffe600]">
        {dateTag(date)}
        <TodayTag date={date} />
      </span>

      <span className="min-w-0 text-[19px] font-bold leading-[1.35] group-hover:text-[#ffe600]">
        TODAY&rsquo;S READ — YOU DECIDE
      </span>

      <span className="flex flex-wrap gap-[6px] min-[681px]:flex-nowrap">
        <button type="button" onClick={openModal} className={ROW_BTN}>
          {voted ? "Voted ✓" : "Vote"}
        </button>
      </span>

      {modal}
    </li>
  );
}
