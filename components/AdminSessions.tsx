"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import DeleteSessionButton from "@/components/DeleteSessionButton";
import SessionAudio from "@/components/SessionAudio";

export type Turn = { role: "student" | "tutor"; text: string };
export type Report = {
  score?: string;
  summary?: string;
  strengths?: string[];
  gaps?: string[];
  keyIdeas?: string;
  vocab?: string;
  concepts?: string;
};
export type SessionFailure = { reason?: string; detail?: string };
export type Session = {
  date: string;
  title: string;
  studentName: string;
  loginUser?: string;
  endedAt: string;
  // Length of the saved recording (total talk time — the same duration the
  // playback control shows), in ms. Undefined when nothing was recorded → "—".
  durationMs?: number;
  transcript: Turn[];
  report: Report | null;
  audioUrl?: string;
  // Set when the attempt ended because of (or was abandoned after) a
  // transcription/tutor failure — saved anyway as an INCOMPLETE attempt. `failure`
  // carries the reason + a short detail. Older sessions predate these (undefined).
  partial?: boolean;
  failure?: SessionFailure | null;
  // The Blob URL of this session's JSON — attached at load time so the teacher
  // can delete it. Not part of the saved JSON itself.
  blobUrl: string;
};
// One article's row in the table: the day + its title + every attempt on it
// (across all students). Grouped + labeled on the server.
export type ArticleGroup = {
  date: string;
  dateLabel: string;
  title: string;
  attempts: Session[];
};

/**
 * Format an ISO timestamp in the *viewer's* local timezone. Done client-side
 * (the server runs in UTC), so we guard with `mounted`: the first render — both
 * on the server and during hydration — shows a deterministic date slice, then
 * we upgrade to the full local date+time after mount. This keeps server and
 * client markup identical at hydration (no mismatch) while still showing the
 * teacher their own local time.
 */
function fmtLocal(iso: string, mounted: boolean): string {
  if (!iso) return "";
  if (!mounted) return iso.slice(0, 10);
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Quiz length as minutes to one decimal, e.g. "8.7m" — compact, a single number.
// "—" when the duration wasn't recorded.
function fmtDuration(ms?: number): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  return `${(ms / 60000).toFixed(1)}m`;
}

export default function AdminSessions({
  groups,
  canDelete,
}: {
  groups: ArticleGroup[];
  // Only the teacher (admin) may delete attempts; students see their own
  // sessions read-only.
  canDelete: boolean;
}) {
  // Which attempt's full detail is open in the modal (null = none).
  const [open, setOpen] = useState<Session | null>(null);

  // Local-time labels are computed only after mount (see fmtLocal).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Esc closes the modal; lock body scroll while it's open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* One row per article. Three columns: date · title · the sequenced list
          of every attempt on that article. overflow-x-auto is a safety net so a
          narrow screen scrolls rather than squashing the columns. */}
      <div className="mt-6 overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
              <th className="px-4 py-2.5 font-semibold">Date</th>
              <th className="px-4 py-2.5 font-semibold">Article</th>
              <th className="px-4 py-2.5 font-semibold">Attempts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {groups.map((g) => (
              <tr key={g.date} className="align-top">
                <td className="whitespace-nowrap px-4 py-3 font-serif text-sm font-bold text-stone-500">
                  {g.dateLabel}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/reading/${g.date}`}
                    className="font-medium text-stone-900 hover:text-sky-700 hover:underline"
                  >
                    {g.title}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {/* key MUST be the stable blobUrl, never the array index: the
                      Delete flow removes one attempt and refreshes the list, and
                      an index key would let a removed row's React state (e.g. the
                      Delete button's "Deleting…") leak onto whatever attempt
                      shifts into its slot. */}
                  {/* Fixed-width columns ("tabbed out") so that, down the list,
                      every name, score, duration, and time line up vertically.
                      Each column keeps its width even when its value is missing,
                      so the rest still align. */}
                  <ol className="space-y-0.5">
                    {g.attempts.map((s) => {
                      const score = s.report?.score;
                      return (
                        <li key={s.blobUrl}>
                          <button
                            type="button"
                            onClick={() => setOpen(s)}
                            className="group flex w-full items-baseline gap-3 rounded-md px-2 py-1 text-left hover:bg-sky-50"
                          >
                            <span className="w-24 shrink-0 whitespace-nowrap font-medium text-stone-800 group-hover:text-sky-700">
                              {s.studentName}
                            </span>
                            <span className="w-12 shrink-0 whitespace-nowrap font-semibold text-sky-700">
                              {score}
                            </span>
                            <span className="w-14 shrink-0 whitespace-nowrap tabular-nums text-stone-500">
                              {fmtDuration(s.durationMs)}
                            </span>
                            <span className="w-36 shrink-0 whitespace-nowrap text-stone-500">
                              {fmtLocal(s.endedAt, mounted)}
                            </span>
                            {s.partial && (
                              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                partial
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The attempt detail "pops out" as a modal over the same page — the table
          stays compact no matter how long a transcript runs. */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-900/50 p-4 backdrop-blur-sm sm:p-6"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="my-4 w-full max-w-2xl rounded-2xl bg-white shadow-xl sm:my-8"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header — who, what, when, and the score. */}
            <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-6 py-4">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-serif text-xl font-bold text-stone-900">
                    {open.studentName}
                  </span>
                  {open.report?.score && (
                    <span className="text-xl font-bold text-sky-700">
                      {open.report.score}
                    </span>
                  )}
                  {open.partial && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                      partial
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-sm text-stone-500">
                  <Link
                    href={`/reading/${open.date}`}
                    className="hover:text-sky-700 hover:underline"
                  >
                    {open.title}
                  </Link>{" "}
                  · {fmtLocal(open.endedAt, mounted)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(null)}
                aria-label="Close"
                className="shrink-0 rounded-md px-2 py-1 text-lg leading-none text-stone-400 hover:bg-stone-100 hover:text-stone-700"
              >
                ✕
              </button>
            </div>

            {/* Body — report card, recording, full transcript. Scrolls if long. */}
            <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
              {open.partial && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <span className="font-semibold">Incomplete attempt</span>
                  {open.failure?.reason ? ` — ${open.failure.reason}` : ""}.{" "}
                  {open.failure?.detail ||
                    "Ended because of (or was abandoned after) a failure; saved with whatever was recorded."}
                </div>
              )}

              {open.report?.summary && (
                <p className="text-sm text-stone-600">{open.report.summary}</p>
              )}

              {open.report &&
                ((open.report.strengths && open.report.strengths.length > 0) ||
                  (open.report.gaps && open.report.gaps.length > 0)) && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {open.report.strengths && open.report.strengths.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
                          Strengths
                        </p>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-stone-700">
                          {open.report.strengths.map((x, j) => (
                            <li key={j}>{x}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {open.report.gaps && open.report.gaps.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                          To review
                        </p>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-stone-700">
                          {open.report.gaps.map((x, j) => (
                            <li key={j}>{x}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

              {open.audioUrl && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                    Recording
                  </p>
                  <SessionAudio src={open.audioUrl} />
                </div>
              )}

              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                  Transcript
                </p>
                <div className="mt-2 space-y-1.5">
                  {open.transcript?.map((t, j) => (
                    <p key={j} className="text-sm">
                      <span
                        className={
                          t.role === "tutor"
                            ? "font-semibold text-sky-700"
                            : "font-semibold text-stone-700"
                        }
                      >
                        {t.role === "tutor" ? "Tutor" : open.studentName}:{" "}
                      </span>
                      <span className="text-stone-600">{t.text}</span>
                    </p>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer — delete this attempt (teacher only), or close. Deleting
                closes the modal (the table refreshes and the row drops). */}
            <div
              className={`flex items-center gap-3 border-t border-stone-200 px-6 py-3 ${
                canDelete ? "justify-between" : "justify-end"
              }`}
            >
              {canDelete && (
                <DeleteSessionButton
                  url={open.blobUrl}
                  audioUrl={open.audioUrl}
                  label={`${open.studentName} · ${open.title}`}
                  onDeleted={() => setOpen(null)}
                />
              )}
              <button
                type="button"
                onClick={() => setOpen(null)}
                className="rounded-md border border-stone-200 px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
