"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Track } from "@/lib/content";

/**
 * "Suggest" — the topline link that lets any member propose an article for the
 * club to read (see "Article suggestions" in CLAUDE.md). It lives inside
 * HomeAuthBar's logged-in link group, so it rides along everywhere that bar
 * renders: the landing topline on both indexes and the site-wide header on
 * every inner page.
 *
 * Logged-in only — the link simply isn't there for a visitor, whose bar is a
 * bare "Log in" button; there's no half-open state to explain. (Voting needs
 * its on-click login gate because its row is part of the page content;
 * this is chrome, so hiding it is the honest affordance.)
 *
 * The form is deliberately ONE field plus a track choice: paste the URL, pick
 * Regular (default) or Junior, submit. No title, no pitch, no reason —
 * anything more is a form kids won't fill in, and the picker skill reads the
 * article itself anyway. The modal is portaled to document.body for the same
 * reason VotePoll's is (the landing list's transform entrance animation
 * re-anchors a nested position:fixed overlay on iOS).
 *
 * Nothing about the queue is shown back: suggestions are a note to the owner,
 * read by scripts/suggestions.mjs during the daily pick, not a leaderboard.
 */

const BTN_PRIMARY =
  "border-2 border-[#0a0a0a] bg-[#0a0a0a] px-5 py-2.5 font-mono text-sm font-bold uppercase tracking-[.08em] text-[#ffe600] transition hover:bg-[#ffe600] hover:text-[#0a0a0a] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-[#0a0a0a] disabled:hover:text-[#ffe600]";
const BTN_SECONDARY =
  "border-2 border-[#0a0a0a] bg-white px-4 py-2 font-mono text-xs font-bold uppercase tracking-[.06em] text-[#0a0a0a] transition hover:bg-[#0a0a0a] hover:text-[#ffe600]";
const MODAL_H2 = "font-display text-xl font-normal uppercase text-[#0a0a0a]";

const TRACKS: { value: Track; label: string; hint: string }[] = [
  { value: "senior", label: "Regular", hint: "Grades 8–10" },
  { value: "junior", label: "Junior", hint: "Grades 5–7" },
];

export default function SuggestArticle({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [track, setTrack] = useState<Track>("senior");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Esc closes; body scroll locks while open (the VotePoll/AdminSessions recipe).
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

  function openModal() {
    // Fresh every time — the default track is Regular, always (a junior page
    // doesn't silently retarget the suggestion).
    setUrl("");
    setTrack("senior");
    setError(null);
    setDone(false);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || !url.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), track }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Could not send your suggestion. Please try again.");
      } else {
        setDone(true);
      }
    } catch {
      setError("Could not send your suggestion. Please try again.");
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
            className="w-full max-w-md border-[3px] border-[#0a0a0a] bg-white shadow-[8px_8px_0_#ffe600,8px_8px_0_3px_#0a0a0a]"
            onClick={(e) => e.stopPropagation()}
          >
            {done ? (
              <div className="p-6">
                <h2 className={MODAL_H2}>Thanks — it&rsquo;s in the queue</h2>
                <p className="mt-2 font-sans text-sm text-stone-600">
                  Your article goes into the pile the club looks at when picking
                  the next read. No promises it wins the day — but it will be
                  read and considered.
                </p>
                <div className="mt-5 flex items-center gap-2">
                  <button type="button" onClick={openModal} className={BTN_SECONDARY}>
                    Suggest another
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
            ) : (
              <form onSubmit={submit} className="p-6">
                <h2 className={MODAL_H2}>Suggest an article</h2>
                <p className="mt-2 font-sans text-[13px] leading-snug text-stone-600">
                  Found something the club should read? Paste the link.
                </p>

                <fieldset className="mt-5">
                  <legend className="font-mono text-[10px] font-bold uppercase tracking-[.2em] text-stone-500">
                    Which club
                  </legend>
                  <div className="mt-2 flex gap-2">
                    {TRACKS.map((t) => {
                      const active = track === t.value;
                      return (
                        <button
                          key={t.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setTrack(t.value)}
                          className={`flex-1 cursor-pointer border-2 border-[#0a0a0a] px-3 py-2 text-left transition-shadow ${
                            active
                              ? "bg-[#ffe600] shadow-[4px_4px_0_#0a0a0a]"
                              : "bg-white hover:bg-stone-100"
                          }`}
                        >
                          <span className="block font-mono text-xs font-bold uppercase tracking-[.08em]">
                            {t.label}
                          </span>
                          <span className="block font-sans text-[11px] text-stone-600">
                            {t.hint}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <label className="mt-5 block font-mono text-[10px] font-bold uppercase tracking-[.2em] text-stone-500">
                  Article link
                  <input
                    type="text"
                    inputMode="url"
                    autoFocus
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://…"
                    className="mt-2 w-full border-2 border-[#0a0a0a] px-3 py-2 font-sans text-sm normal-case tracking-normal text-[#0a0a0a] placeholder:text-stone-400 focus:bg-[#fffbd6] focus:outline-none"
                  />
                </label>

                {error && (
                  <p className="mt-3 font-sans text-[13px] font-bold text-red-700">
                    {error}
                  </p>
                )}

                <div className="mt-5 flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={!url.trim() || pending}
                    className={`flex-1 ${BTN_PRIMARY}`}
                  >
                    {pending ? "Sending…" : "Send suggestion"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className={BTN_SECONDARY}
                  >
                    Close
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>,
        document.body
      );

  return (
    <>
      <button type="button" onClick={openModal} className={className}>
        Suggest
      </button>
      {modal}
    </>
  );
}
