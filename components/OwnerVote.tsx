"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { TRACKS, TRACK_LABEL, type Track } from "@/lib/track";

/**
 * The owner's daily vote (/vote) — every level's live ballot on one page.
 * Owner's rule: only the owner votes, and the vote is shown to nobody else
 * (the home page carries no vote). The 6am autopilot DM links here. A tap on
 * a candidate casts (or changes) the vote at once; publishing a level's
 * reading closes its poll, and the publish run tallies what's here.
 */

type Candidate = {
  id: string;
  title: string;
  source: string;
  pitch: string;
  articleUrl: string;
  kind?: "news" | "enrichment";
};

type Poll = {
  active: boolean;
  date?: string;
  candidates?: Candidate[];
  yourVote?: string | null;
};

function dateTag(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function Ballot({ track }: { track: Track }) {
  const [poll, setPoll] = useState<Poll | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/vote?track=${track}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Poll) => alive && setPoll(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [track]);

  async function vote(id: string) {
    if (!poll?.date || saving || id === poll.yourVote) return;
    setSaving(id);
    setError(null);
    try {
      const res = await fetch("/api/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: poll.date, candidateId: id, track }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setError(d.error ?? "Couldn't save the vote — try again.");
      else setPoll((p) => (p ? { ...p, yourVote: d.yourVote } : p));
    } catch {
      setError("Couldn't save the vote — try again.");
    } finally {
      setSaving(null);
    }
  }

  const head = (
    <h2 className="flex items-center bg-[#0a0a0a] px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[.14em] text-[#ffe600]">
      {TRACK_LABEL[track]}
      {poll?.active && poll.date && (
        <span className="ml-auto text-white/70">{dateTag(poll.date)}</span>
      )}
    </h2>
  );

  if (!poll || failed || !poll.active || !poll.candidates?.length) {
    return (
      <section className="border-[3px] border-[#0a0a0a]">
        {head}
        <p className="px-3 py-3 font-sans text-[14px] text-stone-600">
          {failed ? "Couldn't load this ballot." : !poll ? "Loading…" : "No vote open — today's reading is out (or no poll was opened)."}
        </p>
      </section>
    );
  }

  return (
    <section className="border-[3px] border-[#0a0a0a]">
      {head}
      <p className="border-b-2 border-[#0a0a0a] px-3 py-2 font-mono text-[10.5px] font-bold uppercase tracking-[.08em]">
        {poll.yourVote ? "Voted ✓ — tap another to change" : "Not voted yet — tap the pick"}
      </p>
      <div role="radiogroup" aria-label={`${TRACK_LABEL[track]} candidates`}>
        {poll.candidates.map((c, i) => {
          const mine = poll.yourVote === c.id;
          return (
            <div
              key={c.id}
              role="radio"
              aria-checked={mine}
              tabIndex={0}
              onClick={() => vote(c.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  void vote(c.id);
                }
              }}
              className={`cursor-pointer border-b-2 border-[#0a0a0a] px-3 py-2.5 last:border-b-0 ${
                mine ? "bg-[#ffe600]" : "bg-white hover:bg-stone-100"
              }`}
            >
              <p className="flex items-start gap-2 font-sans text-[14.5px] font-bold leading-[1.35]">
                <span className="mt-[2px] w-5 flex-none font-mono text-[11px] text-stone-500">{i + 1}.</span>
                <span className="min-w-0 flex-1">
                  <span className="mr-2 inline-block bg-[#0a0a0a] px-[6px] py-[1px] align-[2px] font-mono text-[9px] uppercase tracking-[.14em] text-white">
                    {c.source}
                  </span>
                  {c.title}
                </span>
                <span className="flex-none font-mono text-[11px] uppercase tracking-[.08em]">
                  {saving === c.id ? "…" : mine ? "✓" : ""}
                </span>
              </p>
              <p className="mt-1 pl-7 font-sans text-[13px] leading-snug text-stone-700">
                {c.pitch}{" "}
                <a
                  href={c.articleUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="whitespace-nowrap text-stone-500 underline underline-offset-2 hover:text-[#0a0a0a]"
                >
                  (article)
                </a>
              </p>
            </div>
          );
        })}
      </div>
      {error && <p className="px-3 py-2 font-sans text-[13px] font-bold text-red-700">{error}</p>}
    </section>
  );
}

export default function OwnerVote() {
  const { user, isOwner, ready } = useAuth();
  if (!ready) return null;
  if (!user || !isOwner) {
    return (
      <p className="border-[3px] border-[#0a0a0a] p-5 font-sans text-[15px]">
        This page is for the club owner{user ? "" : " — log in first"}.
      </p>
    );
  }
  return (
    <div className="space-y-5">
      {TRACKS.map((t) => (
        <Ballot key={t} track={t} />
      ))}
    </div>
  );
}
