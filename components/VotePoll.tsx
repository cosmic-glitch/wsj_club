"use client";

import { useEffect, useState } from "react";
import ArticleLink from "@/components/ArticleLink";
import TodayTag from "@/components/TodayTag";

/**
 * The daily article vote — the "TODAY'S READ — YOU DECIDE" row at the top of
 * the senior index (see the daily vote in CLAUDE.md).
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
 * same on-click gate as the voice quiz); a vote can be changed while the poll
 * is live, and the tally appears only after you've cast yours. No deadline is
 * shown — the owner announces the window in the group chat, and publishing the
 * day's reading is what actually closes the poll.
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

// Boxed uppercase buttons in the index rows' language (no group-hover — this
// row doesn't invert on hover; it's an interactive card, not a link row).
const BTN =
  "inline-block cursor-pointer border-2 border-[#0a0a0a] bg-white px-[10px] py-[5px] text-[10.5px] font-bold uppercase leading-normal tracking-[.08em] text-[#0a0a0a] no-underline transition hover:bg-[#0a0a0a] hover:text-[#ffe600] disabled:cursor-default disabled:opacity-50";
const BTN_PICKED =
  "inline-block border-2 border-[#0a0a0a] bg-[#0a0a0a] px-[10px] py-[5px] text-[10.5px] font-bold uppercase leading-normal tracking-[.08em] text-[#ffe600]";

export default function VotePoll() {
  const [poll, setPoll] = useState<PollState | null>(null);
  const [pending, setPending] = useState<string | null>(null); // candidate id being submitted
  const [needLogin, setNeedLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/vote", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: PollState) => setPoll(d))
      .catch(() => setPoll({ active: false }));
  }, []);

  if (!poll?.active || !poll.date || !poll.candidates?.length) return null;
  const { date, candidates } = poll;

  async function vote(candidateId: string) {
    if (!poll?.user) {
      setNeedLogin(true);
      return;
    }
    setPending(candidateId);
    setError(null);
    try {
      const res = await fetch("/api/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, candidateId }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Could not save your vote. Please try again.");
      } else {
        setPoll({ ...poll, yourVote: d.yourVote, tally: d.tally });
      }
    } catch {
      setError("Could not save your vote. Please try again.");
    } finally {
      setPending(null);
    }
  }

  const voted = Boolean(poll.yourVote);
  const totalVotes = poll.tally
    ? Object.values(poll.tally).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <li className="vote-live border-b-2 border-[#0a0a0a] bg-[#ffe600] px-3.5 py-4 min-[681px]:px-4">
      {/* header: date + TODAY chip + the "you decide" masthead line */}
      <div className="whitespace-nowrap text-xs font-bold uppercase tracking-[.06em]">
        {dateTag(date)}
        <TodayTag date={date} />
      </div>
      <p className="mt-1 text-[19px] font-bold leading-[1.35]">
        TODAY&rsquo;S READ — YOU DECIDE
      </p>
      <p className="mt-1 font-sans text-[13px] leading-snug text-[#0a0a0a]/80">
        {voted
          ? "Vote saved — you can change it until the handout is published."
          : "Read the pitches (or the articles), then vote for the one the club should read today."}
      </p>

      {needLogin && !poll.user && (
        <p className="mt-3 border-2 border-[#0a0a0a] bg-white px-3 py-2 font-sans text-[13px] leading-snug">
          <span className="font-mono text-xs font-bold uppercase tracking-[.06em]">
            You need to log in to vote
          </span>
          <br />
          Use the &ldquo;Log in&rdquo; button at the top of the page, then come
          back and vote.
        </p>
      )}
      {error && (
        <p className="mt-3 border-2 border-[#0a0a0a] bg-white px-3 py-2 font-sans text-[13px] font-bold leading-snug text-red-700">
          {error}
        </p>
      )}

      <ul className="mt-3 grid gap-2">
        {candidates.map((c) => {
          const picked = poll.yourVote === c.id;
          const count = poll.tally?.[c.id];
          return (
            <li
              key={c.id}
              className={`border-2 border-[#0a0a0a] bg-white p-3 ${
                picked ? "shadow-[4px_4px_0_#0a0a0a]" : ""
              }`}
            >
              <p className="text-[14.5px] font-bold leading-[1.35]">
                <span className="mr-2 inline-block bg-[#0a0a0a] px-[6px] py-[1px] align-[2px] text-[9.5px] font-bold uppercase tracking-[.14em] text-white">
                  {c.source}
                </span>
                {c.title}
              </p>
              <p className="mt-1.5 font-sans text-[13px] leading-snug text-stone-700">
                {c.pitch}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-[6px]">
                <ArticleLink href={c.articleUrl} className={BTN}>
                  Web
                </ArticleLink>
                {picked ? (
                  <span className={BTN_PICKED}>Your pick ✓</span>
                ) : (
                  <button
                    type="button"
                    className={BTN}
                    disabled={pending !== null}
                    onClick={() => vote(c.id)}
                  >
                    {pending === c.id ? "Saving…" : voted ? "Switch to this" : "Vote"}
                  </button>
                )}
                {typeof count === "number" && (
                  <span className="ml-auto flex items-center gap-2">
                    {totalVotes > 0 && (
                      <span
                        className="hidden h-[10px] bg-[#0a0a0a] min-[681px]:inline-block"
                        style={{ width: `${(count / totalVotes) * 90 + 6}px` }}
                      />
                    )}
                    <span className="whitespace-nowrap text-[10.5px] font-bold uppercase tracking-[.08em]">
                      {count} vote{count === 1 ? "" : "s"}
                    </span>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </li>
  );
}
