"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * "Suggestions" — the OWNER's replacement for the members' "Suggest" link in
 * the topline auth bar (HomeAuthBar swaps this in when the viewer is the
 * owner). The owner doesn't propose articles — they pick them — so instead of
 * the submit form they get the queue: every OPEN suggestion, with the
 * suggester's name. Read-only on purpose: resolving (used/declined) stays in
 * scripts/suggestions.mjs, which the daily pickers run — closing one here
 * would let a suggestion vanish without ever being read into a day's field.
 */

const MODAL_H2 = "font-display text-xl font-normal uppercase text-[#0a0a0a]";
const BTN_SECONDARY =
  "border-2 border-[#0a0a0a] bg-white px-4 py-2 font-mono text-xs font-bold uppercase tracking-[.06em] text-[#0a0a0a] transition hover:bg-[#0a0a0a] hover:text-[#ffe600]";

type Suggestion = {
  id: string;
  track: "senior" | "junior";
  url: string;
  username: string;
  created_at: string;
};

const TRACK_LABEL: Record<Suggestion["track"], string> = {
  senior: "Regular",
  junior: "Junior",
};

/** "today" / "yesterday" / "n days ago" from an ISO timestamp. */
function age(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export default function SuggestionsQueue({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Esc closes; body scroll locks while open (the VotePoll/SuggestArticle recipe).
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

  async function openModal() {
    setRows(null);
    setError(null);
    setOpen(true);
    try {
      const res = await fetch("/api/suggestions");
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Could not load the suggestions.");
      } else {
        setRows(d.suggestions ?? []);
      }
    } catch {
      setError("Could not load the suggestions.");
    }
  }

  const modal = !open
    ? null
    : createPortal(
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-[#0a0a0a]/60 p-4 pt-14 sm:items-center sm:pt-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md border-[3px] border-[#0a0a0a] bg-white shadow-[8px_8px_0_#ffe600,8px_8px_0_3px_#0a0a0a]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <h2 className={MODAL_H2}>Suggestions</h2>

              {error ? (
                <p className="mt-3 font-sans text-[13px] font-bold text-red-700">
                  {error}
                </p>
              ) : rows === null ? (
                <p className="mt-3 font-mono text-xs uppercase tracking-[.1em] text-stone-500">
                  Loading…
                </p>
              ) : rows.length === 0 ? (
                <p className="mt-3 font-sans text-sm text-stone-600">
                  The queue is empty — nobody has an open suggestion right now.
                </p>
              ) : (
                <ul className="mt-4 max-h-[55vh] space-y-3 overflow-y-auto">
                  {rows.map((r) => (
                    <li key={r.id} className="border-2 border-[#0a0a0a] p-3">
                      <p className="font-mono text-[10px] font-bold uppercase tracking-[.14em] text-stone-500">
                        <span className="text-[#0a0a0a]">{r.username}</span>
                        {" · "}
                        {TRACK_LABEL[r.track]}
                        {" · "}
                        {age(r.created_at)}
                      </p>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 block break-all font-sans text-sm text-[#0a0a0a] underline decoration-2 underline-offset-2 hover:bg-[#ffe600]"
                      >
                        {r.url}
                      </a>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className={BTN_SECONDARY}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      );

  return (
    <>
      <button type="button" onClick={openModal} className={className}>
        Suggestions
      </button>
      {modal}
    </>
  );
}
