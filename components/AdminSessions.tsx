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
  // The owning teacher's username, stamped at save time so /admin can scope each
  // teacher to their own classroom. Older sessions predate it (undefined) — the
  // /admin filter then falls back to roster membership by loginUser.
  teacherId?: string;
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
  // Set when the student pressed Cancel: saved ungraded (score "—") for the
  // teacher only — /admin filters these out of a student's own view.
  cancelled?: boolean;
  // The in-progress slot (pause & resume): a paused/live attempt, checkpointed
  // after every answer, never graded until End. Shown as "In progress" with a
  // Continue button for its owner. Explicit flag — NOT inferred from
  // partial/report, because legacy failure-partials whose grading errored also
  // have report: null and must not grow a broken Continue.
  inProgress?: boolean;
  // The slot's last-checkpoint time (it has no endedAt — nothing ended).
  updatedAt?: string;
  // How many times the attempt was paused and continued (teacher-visible).
  resumeCount?: number;
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

// Quiz length as minutes to one decimal, e.g. "8.7" — compact, a single number.
// The "minutes" unit lives in the column header, not on each value. "—" when the
// duration wasn't recorded.
function fmtDuration(ms?: number): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  return (ms / 60000).toFixed(1);
}

// Scores are all out of 10, so show just the number ("9/10" → "9"). The "—" of a
// no-answers card (and anything without an "/10") passes through unchanged.
function fmtScore(score?: string): string {
  if (!score) return "";
  return score.split("/")[0].trim();
}

export default function AdminSessions({
  groups,
  canDelete,
  viewerUser,
}: {
  groups: ArticleGroup[];
  // Only the teacher (admin) may delete attempts; students see their own
  // sessions read-only.
  canDelete: boolean;
  // The logged-in viewer — an in-progress attempt shows its Continue button
  // only to the user who owns it (a teacher sees it as informational).
  viewerUser?: string | null;
}) {
  // Which attempt's detail is open in the modal (null = closed). A single
  // "Details" link per attempt opens the full combined view — feedback +
  // recording + transcript, all in one modal.
  const [session, setSession] = useState<Session | null>(null);

  // Local-time labels are computed only after mount (see fmtLocal).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Esc closes the modal; lock body scroll while it's open.
  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSession(null);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [session]);

  const hasFeedback = (r: Report | null) =>
    !!(
      r &&
      (r.summary ||
        (r.strengths && r.strengths.length > 0) ||
        (r.gaps && r.gaps.length > 0))
    );

  return (
    <>
      {/* One row per article. Three columns: date · title · the sequenced list
          of every attempt on that article. overflow-x-auto is a safety net so a
          narrow screen scrolls rather than squashing the columns. */}
      <div className="mt-6 overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
              <th className="px-3 py-2.5 font-semibold">Date</th>
              <th className="px-3 py-2.5 font-semibold">Article</th>
              {/* The "Attempts" cell holds a sub-grid (one line per attempt). These
                  labels use the SAME widths + px-1 + gap-2 as the attempt rows
                  below, and since they're in the same table column they line up.
                  Data columns are right-aligned to match the values; Details holds
                  a single link that opens the combined detail modal, then a final
                  Delete column (teacher only). The sub-columns are kept tight and
                  the admin route widens the page (app/admin/layout.tsx) so the
                  whole line — through the last Delete column — fits without
                  clipping on desktop. */}
              <th className="px-3 py-2.5 font-semibold">
                <div className="flex items-end gap-2 px-1">
                  <span className="w-20 text-right">Student</span>
                  <span className="w-10 text-right">Score</span>
                  <span className="w-8 text-right">Mins</span>
                  <span className="w-32 text-right">Time</span>
                  <span className="w-40 text-right">Details</span>
                  {canDelete && <span className="w-20 text-right">Delete</span>}
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {groups.map((g) => (
              <tr key={g.date} className="align-top">
                <td className="whitespace-nowrap px-3 py-3 font-serif text-sm font-bold text-stone-500">
                  {g.dateLabel}
                </td>
                {/* [overflow-wrap:anywhere] lets a very long title word (e.g.
                    "Astrophysicists") break so this column can shrink instead of
                    forcing the whole table wider than max-w-4xl — which would push
                    the last (Delete) column off the right edge on desktop. */}
                <td className="px-3 py-3 [overflow-wrap:anywhere]">
                  <Link
                    href={`/reading/${g.date}`}
                    className="font-medium text-stone-900 hover:text-sky-700 hover:underline"
                  >
                    {g.title}
                  </Link>
                </td>
                <td className="px-3 py-3">
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
                      // An in-progress attempt: its OWNER gets a Continue link
                      // (resumes the quiz); anyone else (the teacher) gets the
                      // usual Details view of the transcript-so-far.
                      const ownsInProgress =
                        s.inProgress === true &&
                        viewerUser != null &&
                        (s.loginUser ?? s.studentName) === viewerUser;
                      return (
                        <li
                          key={s.blobUrl}
                          className="flex items-center gap-2 px-1 py-1"
                        >
                          <span className="w-20 shrink-0 truncate text-right font-medium text-stone-800">
                            {s.studentName}
                          </span>
                          <span className="w-10 shrink-0 whitespace-nowrap text-right font-semibold text-stone-800">
                            {s.inProgress ? "—" : fmtScore(score)}
                          </span>
                          <span className="w-8 shrink-0 whitespace-nowrap text-right tabular-nums text-stone-500">
                            {s.inProgress ? "—" : fmtDuration(s.durationMs)}
                          </span>
                          <span className="w-32 shrink-0 whitespace-nowrap text-right text-stone-500">
                            {fmtLocal(s.endedAt ?? s.updatedAt ?? "", mounted)}
                          </span>
                          {/* Details: ONE link that opens the combined detail
                              modal — feedback + recording + transcript together.
                              Any badge sits INLINE (pushed left with mr-auto; the
                              link stays right-aligned), filling this column's
                              slack — with just one short link there's room, so a
                              badge never forces the row to a 2nd line. */}
                          <span className="flex w-40 shrink-0 items-center justify-end gap-2">
                            {s.inProgress && (
                              <span className="mr-auto shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                                in progress
                              </span>
                            )}
                            {s.partial && !s.inProgress && (
                              <span className="mr-auto shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                partial
                              </span>
                            )}
                            {s.cancelled && (
                              <span className="mr-auto shrink-0 rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600">
                                cancelled
                              </span>
                            )}
                            {ownsInProgress ? (
                              <Link
                                href={`/?resume=${s.date}`}
                                className="font-medium text-sky-700 hover:text-sky-800 hover:underline"
                              >
                                Continue
                              </Link>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setSession(s)}
                                className="font-medium text-sky-700 hover:text-sky-800 hover:underline"
                              >
                                Details
                              </button>
                            )}
                          </span>
                          {/* Delete is the LAST column — a single per-attempt
                              action (teacher only), right-aligned in its own
                              fixed-width slot so it lines up down the list and is
                              never pushed off the right edge on desktop. */}
                          {canDelete && (
                            <span className="flex w-20 shrink-0 justify-end">
                              <DeleteSessionButton
                                url={s.blobUrl}
                                audioUrl={s.audioUrl}
                                label={`${s.studentName} · ${s.title}`}
                              />
                            </span>
                          )}
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
          stays compact no matter how long a transcript runs. One modal shows the
          whole attempt: feedback, the recording, and the transcript together. */}
      {session && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-900/50 p-4 backdrop-blur-sm sm:p-6"
          onClick={() => setSession(null)}
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
                    {session.studentName}
                  </span>
                  {session.report?.score && (
                    <span className="text-xl font-bold text-sky-700">
                      {session.report.score}
                    </span>
                  )}
                  {session.inProgress && (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                      in progress
                    </span>
                  )}
                  {session.partial && !session.inProgress && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                      partial
                    </span>
                  )}
                  {session.cancelled && (
                    <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600">
                      cancelled
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-sm text-stone-500">
                  <Link
                    href={`/reading/${session.date}`}
                    className="hover:text-sky-700 hover:underline"
                  >
                    {session.title}
                  </Link>{" "}
                  · {fmtLocal(session.endedAt ?? session.updatedAt ?? "", mounted)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSession(null)}
                aria-label="Close"
                className="shrink-0 rounded-md px-2 py-1 text-lg leading-none text-stone-400 hover:bg-stone-100 hover:text-stone-700"
              >
                ✕
              </button>
            </div>

            {/* Body — the whole attempt in one scroll: a status banner (if any),
                then the three labeled sections Feedback · Recording · Transcript. */}
            <div className="max-h-[70vh] space-y-6 overflow-y-auto px-6 py-4">
              {session.inProgress && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
                  <span className="font-semibold">In progress</span> — this quiz
                  hasn’t been finished yet, so it isn’t graded. The transcript and
                  recording cover what’s been done so far.
                  {session.failure?.detail
                    ? ` Last paused after a problem: ${session.failure.detail}`
                    : ""}
                </div>
              )}

              {session.cancelled && (
                <div className="rounded-lg border border-stone-200 bg-stone-100 px-3 py-2 text-sm text-stone-600">
                  <span className="font-semibold">Cancelled attempt</span> — the
                  student ended this quiz early, so it wasn’t graded; saved with
                  whatever was recorded up to that point.
                </div>
              )}

              {session.partial && !session.inProgress && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <span className="font-semibold">Incomplete attempt</span>
                  {session.failure?.reason ? ` — ${session.failure.reason}` : ""}.{" "}
                  {session.failure?.detail ||
                    "Ended because of (or was abandoned after) a failure; saved with whatever was recorded."}
                </div>
              )}

              {/* Pause-anytime makes a mid-quiz look-something-up detour possible,
                  so the teacher gets to SEE that an attempt didn't run in one
                  sitting. Teacher-only (canDelete is the teacher signal). */}
              {canDelete && (session.resumeCount ?? 0) > 0 && (
                <p className="text-xs text-stone-500">
                  Resumed {session.resumeCount} time
                  {session.resumeCount === 1 ? "" : "s"} — this attempt was paused
                  and continued later.
                </p>
              )}

              {/* Feedback */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Feedback
                </p>
                {session.inProgress ? (
                  <p className="text-sm text-stone-400">
                    In progress — not yet graded.
                  </p>
                ) : hasFeedback(session.report) ? (
                  <>
                    {session.report?.summary && (
                      <p className="text-sm text-stone-600">
                        {session.report.summary}
                      </p>
                    )}
                    {((session.report?.strengths &&
                      session.report.strengths.length > 0) ||
                      (session.report?.gaps &&
                        session.report.gaps.length > 0)) && (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {session.report?.strengths &&
                          session.report.strengths.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
                                Strengths
                              </p>
                              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-stone-700">
                                {session.report.strengths.map((x, j) => (
                                  <li key={j}>{x}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        {session.report?.gaps &&
                          session.report.gaps.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                                To review
                              </p>
                              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-stone-700">
                                {session.report.gaps.map((x, j) => (
                                  <li key={j}>{x}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-stone-400">
                    No feedback was saved for this attempt.
                  </p>
                )}
              </div>

              {/* Recording */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Recording
                </p>
                {session.audioUrl ? (
                  <SessionAudio src={session.audioUrl} />
                ) : (
                  <p className="text-sm text-stone-400">
                    No recording was saved for this attempt.
                  </p>
                )}
              </div>

              {/* Transcript */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Transcript
                </p>
                {session.transcript && session.transcript.length > 0 ? (
                  <div className="space-y-1.5">
                    {session.transcript.map((t, j) => (
                      <p key={j} className="text-sm">
                        <span
                          className={
                            t.role === "tutor"
                              ? "font-semibold text-sky-700"
                              : "font-semibold text-stone-700"
                          }
                        >
                          {t.role === "tutor" ? "Tutor" : session.studentName}:{" "}
                        </span>
                        <span className="text-stone-600">{t.text}</span>
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-stone-400">
                    No transcript was saved for this attempt.
                  </p>
                )}
              </div>
            </div>

            {/* Footer — this modal is view-only. Deleting an attempt is a single
                action in the row's last column (teacher only), not here. */}
            <div className="flex items-center justify-end gap-3 border-t border-stone-200 px-6 py-3">
              <button
                type="button"
                onClick={() => setSession(null)}
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
