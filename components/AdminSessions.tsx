"use client";

import { useEffect, useRef, useState } from "react";
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
  // The reading track. Absent means senior (no backfill of the existing
  // records); junior attempts are stamped "junior" at save time. Drives the
  // junior badge + the track prefix on this attempt's links, so a junior 8/10 is
  // never silently compared against a senior 8/10.
  track?: "junior";
  title: string;
  studentName: string;
  loginUser?: string;
  // The owning parent's username, stamped at save time so /admin can scope each
  // parent to their own classroom. Stored in the session JSON under the legacy
  // `teacherId` field name (normalized by lib/sessions.ts). Older sessions
  // predate it (undefined) — the /admin filter then falls back to roster
  // membership by loginUser.
  parentId?: string;
  // UI-only: the display name of the parent this attempt belongs to, resolved
  // on the server for the OWNER's unified Scores table (the Parent column).
  // Not part of the saved session JSON; only populated when showParent.
  parentName?: string;
  endedAt: string;
  // Length of the saved recording (total talk time — the same duration the
  // playback control shows), in ms. Undefined when nothing was recorded → "—".
  durationMs?: number;
  // SCORE ONLY — loadSessions slims the report down to its score (the only bit
  // the table shows). The summary/strengths/gaps narrative and the transcript
  // stay in the session's Blob JSON; the Details modal fetches them from
  // blobUrl on open (details are viewed rarely, so shipping every attempt's
  // full record in the page payload was pure waste).
  report: Report | null;
  audioUrl?: string;
  // Set when the attempt ended because of (or was abandoned after) a
  // transcription/tutor failure — saved anyway as an INCOMPLETE attempt. `failure`
  // carries the reason + a short detail. Older sessions predate these (undefined).
  partial?: boolean;
  failure?: SessionFailure | null;
  // Set when the student pressed Cancel: saved ungraded (score "—") for the
  // parent only — /admin filters these out of a student's own view.
  cancelled?: boolean;
  // The in-progress slot (pause & resume): a paused/live attempt, checkpointed
  // after every answer, never graded until End. Shown as "In progress" with a
  // Continue button for its owner. Explicit flag — NOT inferred from
  // partial/report, because legacy failure-partials whose grading errored also
  // have report: null and must not grow a broken Continue.
  inProgress?: boolean;
  // The slot's last-checkpoint time (it has no endedAt — nothing ended).
  updatedAt?: string;
  // How many times the attempt was paused and continued (parent-visible).
  resumeCount?: number;
  // The Blob URL of this session's JSON — attached at load time so the owner
  // can delete it. Not part of the saved JSON itself.
  blobUrl: string;
};
// One article's row in the table: the day + its title + every attempt on it
// (across all students). Grouped + labeled on the server. A junior and a senior
// attempt on the same DATE are DISTINCT groups (keyed on track+date), so `track`
// identifies which one this is (absent = senior).
export type ArticleGroup = {
  date: string;
  track?: "junior";
  dateLabel: string;
  title: string;
  attempts: Session[];
};

// The modal-only heavy fields, fetched straight from the session's Blob JSON
// when Details is opened (the browser already holds blobUrl — it's the same URL
// the Delete button sends). Only what the modal renders beyond the slim row.
type SessionDetail = {
  transcript?: Turn[];
  report?: Report | null;
};

// Track-aware hrefs — junior lives under a /junior prefix (senior unchanged).
const readingHref = (track: string | undefined, date: string) =>
  track === "junior" ? `/junior/reading/${date}` : `/reading/${date}`;
const resumeHref = (track: string | undefined, date: string) =>
  track === "junior" ? `/junior?resume=${date}` : `/?resume=${date}`;

/**
 * Format an ISO timestamp in the *viewer's* local timezone. Done client-side
 * (the server runs in UTC), so we guard with `mounted`: the first render — both
 * on the server and during hydration — shows a deterministic date slice, then
 * we upgrade to the full local date+time after mount. This keeps server and
 * client markup identical at hydration (no mismatch) while still showing the
 * viewer their own local time.
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
  parentView = false,
  viewerUser,
  showParent = false,
}: {
  groups: ArticleGroup[];
  // Only the OWNER may delete attempts; a regular parent views their classroom
  // read-only (and a student sees their own sessions read-only too). Distinct
  // from parentView: a parent sees the classroom but gets no Delete column.
  canDelete: boolean;
  // The viewer is a parent/owner looking at classroom data (not a student
  // viewing their own scores). Gates parent-only informational bits like the
  // "Resumed N times" note — shown to any parent, whether or not they can delete.
  parentView?: boolean;
  // The logged-in viewer — an in-progress attempt shows its Continue button
  // only to the user who owns it (a parent sees it as informational).
  viewerUser?: string | null;
  // Show a Parent column naming each attempt's parent — only the OWNER's
  // unified view (every classroom in one table) needs it; a regular parent /
  // student sees a single classroom, so the column would be redundant.
  showParent?: boolean;
}) {
  // Which attempt's detail is open in the modal (null = closed). A single
  // "Details" link per attempt opens the full combined view — feedback +
  // recording + transcript, all in one modal.
  const [session, setSession] = useState<Session | null>(null);

  // The heavy fields (feedback narrative + transcript), fetched from the
  // session's own Blob JSON when the modal opens. Keyed by blobUrl so a slow
  // response for a closed modal can never paint into a newer one; `data: null`
  // = still loading, `error` = fetch/parse failed.
  const [detail, setDetail] = useState<{
    url: string;
    data: SessionDetail | null;
    error: boolean;
  } | null>(null);
  const detailUrlRef = useRef<string | null>(null);

  const openDetails = (s: Session) => {
    setSession(s);
    setDetail({ url: s.blobUrl, data: null, error: false });
    detailUrlRef.current = s.blobUrl;
    // The in-progress slot is overwritten in place, so bust the CDN edge cache
    // for a current read; a finished record is immutable (random-suffixed key),
    // so its plain URL is fine and can be served from the edge.
    const url = s.inProgress ? `${s.blobUrl}?v=${Date.now()}` : s.blobUrl;
    fetch(url, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SessionDetail>;
      })
      .then((data) => {
        if (detailUrlRef.current !== s.blobUrl) return;
        setDetail({ url: s.blobUrl, data, error: false });
      })
      .catch(() => {
        if (detailUrlRef.current !== s.blobUrl) return;
        setDetail({ url: s.blobUrl, data: null, error: true });
      });
  };

  // The open modal's fetched detail (null while loading / on error).
  const sessionDetail =
    session && detail?.url === session.blobUrl ? detail.data : null;
  const detailFailed =
    !!session && detail?.url === session.blobUrl && detail.error;
  const detailLoading = !!session && !sessionDetail && !detailFailed;

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
      <div className="mt-6 overflow-x-auto border-[3px] border-[#0a0a0a] bg-white">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[#0a0a0a] text-left font-mono text-[10px] font-bold uppercase tracking-[.12em] text-white">
              <th className="px-3 py-2.5 font-semibold">Date</th>
              <th className="px-3 py-2.5 font-semibold">Article</th>
              {/* The "Attempts" cell holds a sub-grid (one line per attempt). These
                  labels use the SAME widths + px-1 + gap-2 as the attempt rows
                  below, and since they're in the same table column they line up.
                  Data columns are right-aligned to match the values; Details holds
                  a single link that opens the combined detail modal, then a final
                  Delete column (owner only). The sub-columns are kept tight and
                  the admin route widens the page (app/admin/layout.tsx) so the
                  whole line — through the last Delete column — fits without
                  clipping on desktop. */}
              <th className="px-3 py-2.5 font-semibold">
                <div className="flex items-end gap-2 px-1">
                  <span className="w-20 text-right">Student</span>
                  {showParent && (
                    <span className="w-24 text-right">Parent</span>
                  )}
                  <span className="w-10 text-right">Score</span>
                  <span className="w-8 text-right">Mins</span>
                  <span className="w-32 text-right">Time</span>
                  <span className="w-40 text-right">Details</span>
                  {canDelete && <span className="w-20 text-right">Delete</span>}
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-[#0a0a0a]">
            {groups.map((g) => (
              <tr key={g.date} className="align-top">
                <td className="whitespace-nowrap px-3 py-3 font-mono text-xs font-bold uppercase tracking-[.04em] text-stone-500">
                  {g.dateLabel}
                </td>
                {/* [overflow-wrap:anywhere] lets a very long title word (e.g.
                    "Astrophysicists") break so this column can shrink instead of
                    forcing the whole table wider than max-w-4xl — which would push
                    the last (Delete) column off the right edge on desktop. */}
                <td className="px-3 py-3 [overflow-wrap:anywhere]">
                  <Link
                    href={readingHref(g.track, g.date)}
                    className="font-bold text-[#0a0a0a] hover:bg-[#ffe600]"
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
                      // (resumes the quiz); anyone else (the parent) gets the
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
                          {showParent && (
                            <span className="w-24 shrink-0 truncate text-right text-stone-500">
                              {s.parentName}
                            </span>
                          )}
                          <span className="w-10 shrink-0 whitespace-nowrap text-right font-mono font-bold text-[#0a0a0a]">
                            {s.inProgress ? "—" : fmtScore(score)}
                          </span>
                          <span className="w-8 shrink-0 whitespace-nowrap text-right font-mono text-xs tabular-nums text-stone-500">
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
                            {/* Badges, left-aligned as one group (mr-auto on the
                                wrapper), so the Details/Continue link stays
                                right-aligned even with several badges. junior is
                                orthogonal to the status badges — a junior attempt
                                can also be in-progress/partial/cancelled. */}
                            <span className="mr-auto flex items-center gap-1.5">
                              {s.track === "junior" && (
                                <span className="shrink-0 bg-violet-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-violet-700">
                                  junior
                                </span>
                              )}
                              {s.inProgress && (
                                <span className="shrink-0 bg-sky-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-sky-700">
                                  in progress
                                </span>
                              )}
                              {s.partial && !s.inProgress && (
                                <span className="shrink-0 bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-amber-700">
                                  partial
                                </span>
                              )}
                              {s.cancelled && (
                                <span className="shrink-0 bg-stone-200 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-stone-600">
                                  cancelled
                                </span>
                              )}
                            </span>
                            {ownsInProgress ? (
                              <Link
                                href={resumeHref(s.track, s.date)}
                                className="font-mono text-[11px] font-bold uppercase tracking-[.06em] text-[#0a0a0a] underline decoration-2 underline-offset-2 hover:bg-[#ffe600]"
                              >
                                Continue
                              </Link>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openDetails(s)}
                                className="font-mono text-[11px] font-bold uppercase tracking-[.06em] text-[#0a0a0a] underline decoration-2 underline-offset-2 hover:bg-[#ffe600]"
                              >
                                Details
                              </button>
                            )}
                          </span>
                          {/* Delete is the LAST column — a single per-attempt
                              action (owner only), right-aligned in its own
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
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0a0a0a]/60 p-4 sm:p-6"
          onClick={() => setSession(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="my-4 w-full max-w-2xl border-[3px] border-[#0a0a0a] bg-white shadow-[8px_8px_0_#ffe600,8px_8px_0_3px_#0a0a0a] sm:my-8"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header — who, what, when, and the score. */}
            <div className="flex items-start justify-between gap-4 border-b-2 border-[#0a0a0a] px-6 py-4">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-xl font-normal uppercase text-[#0a0a0a]">
                    {session.studentName}
                  </span>
                  {session.report?.score && (
                    <span className="bg-[#ffe600] px-1.5 font-mono text-lg font-bold text-[#0a0a0a]">
                      {session.report.score}
                    </span>
                  )}
                  {session.track === "junior" && (
                    <span className="bg-violet-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-violet-700">
                      junior
                    </span>
                  )}
                  {session.inProgress && (
                    <span className="bg-sky-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-sky-700">
                      in progress
                    </span>
                  )}
                  {session.partial && !session.inProgress && (
                    <span className="bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-amber-700">
                      partial
                    </span>
                  )}
                  {session.cancelled && (
                    <span className="bg-stone-200 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-stone-600">
                      cancelled
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-sm text-stone-500">
                  <Link
                    href={readingHref(session.track, session.date)}
                    className="hover:bg-[#ffe600] hover:text-[#0a0a0a]"
                  >
                    {session.title}
                  </Link>
                  {session.parentName ? ` · ${session.parentName}` : ""} ·{" "}
                  {fmtLocal(session.endedAt ?? session.updatedAt ?? "", mounted)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSession(null)}
                aria-label="Close"
                className="shrink-0 px-2 py-1 text-lg leading-none text-stone-400 hover:bg-[#0a0a0a] hover:text-[#ffe600]"
              >
                ✕
              </button>
            </div>

            {/* Body — the whole attempt in one scroll: a status banner (if any),
                then the three labeled sections Feedback · Recording · Transcript. */}
            <div className="max-h-[70vh] space-y-6 overflow-y-auto px-6 py-4">
              {session.inProgress && (
                <div className="border-2 border-sky-700 bg-sky-50 px-3 py-2 text-sm text-sky-800">
                  <span className="font-bold">In progress</span> — this quiz
                  hasn’t been finished yet, so it isn’t graded. The transcript and
                  recording cover what’s been done so far.
                  {session.failure?.detail
                    ? ` Last paused after a problem: ${session.failure.detail}`
                    : ""}
                </div>
              )}

              {session.cancelled && (
                <div className="border-2 border-stone-400 bg-stone-100 px-3 py-2 text-sm text-stone-600">
                  <span className="font-bold">Cancelled attempt</span> — the
                  student ended this quiz early, so it wasn’t graded; saved with
                  whatever was recorded up to that point.
                </div>
              )}

              {session.partial && !session.inProgress && (
                <div className="border-2 border-amber-600 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <span className="font-bold">Incomplete attempt</span>
                  {session.failure?.reason ? ` — ${session.failure.reason}` : ""}.{" "}
                  {session.failure?.detail ||
                    "Ended because of (or was abandoned after) a failure; saved with whatever was recorded."}
                </div>
              )}

              {/* Pause-anytime makes a mid-quiz look-something-up detour possible,
                  so the parent gets to SEE that an attempt didn't run in one
                  sitting. Parent-only (parentView, not canDelete — a regular
                  parent can't delete but should still see this). */}
              {parentView && (session.resumeCount ?? 0) > 0 && (
                <p className="text-xs text-stone-500">
                  Resumed {session.resumeCount} time
                  {session.resumeCount === 1 ? "" : "s"} — this attempt was paused
                  and continued later.
                </p>
              )}

              {/* The heavy fields come from the record's own Blob JSON, fetched
                  on open — surface a fetch failure once, above both sections. */}
              {detailFailed && (
                <div className="border-2 border-red-700 bg-red-50 px-3 py-2 text-sm text-red-800">
                  Couldn’t load this attempt’s feedback and transcript — check
                  your connection, then close and reopen Details.
                </div>
              )}

              {/* Feedback */}
              <div>
                <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[.14em] text-[#0a0a0a]">
                  Feedback
                </p>
                {session.inProgress ? (
                  <p className="text-sm text-stone-400">
                    In progress — not yet graded.
                  </p>
                ) : detailLoading ? (
                  <p className="text-sm text-stone-400">Loading…</p>
                ) : hasFeedback(sessionDetail?.report ?? null) ? (
                  <>
                    {sessionDetail?.report?.summary && (
                      <p className="text-sm text-stone-600">
                        {sessionDetail.report.summary}
                      </p>
                    )}
                    {((sessionDetail?.report?.strengths &&
                      sessionDetail.report.strengths.length > 0) ||
                      (sessionDetail?.report?.gaps &&
                        sessionDetail.report.gaps.length > 0)) && (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {sessionDetail?.report?.strengths &&
                          sessionDetail.report.strengths.length > 0 && (
                            <div>
                              <p className="font-mono text-[10px] font-bold uppercase tracking-[.14em] text-emerald-700">
                                Strengths
                              </p>
                              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-stone-700">
                                {sessionDetail.report.strengths.map((x, j) => (
                                  <li key={j}>{x}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        {sessionDetail?.report?.gaps &&
                          sessionDetail.report.gaps.length > 0 && (
                            <div>
                              <p className="font-mono text-[10px] font-bold uppercase tracking-[.14em] text-amber-700">
                                To review
                              </p>
                              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-stone-700">
                                {sessionDetail.report.gaps.map((x, j) => (
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
                    {detailFailed
                      ? "Feedback couldn’t be loaded."
                      : "No feedback was saved for this attempt."}
                  </p>
                )}
              </div>

              {/* Recording */}
              <div>
                <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[.14em] text-[#0a0a0a]">
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
                <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[.14em] text-[#0a0a0a]">
                  Transcript
                </p>
                {detailLoading ? (
                  <p className="text-sm text-stone-400">Loading…</p>
                ) : sessionDetail?.transcript &&
                  sessionDetail.transcript.length > 0 ? (
                  <div className="space-y-1.5">
                    {sessionDetail.transcript.map((t, j) => (
                      <p key={j} className="text-sm">
                        <span
                          className={
                            t.role === "tutor"
                              ? "bg-[#ffe600] px-1 font-bold text-[#0a0a0a]"
                              : "font-bold text-stone-700"
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
                    {detailFailed
                      ? "Transcript couldn’t be loaded."
                      : "No transcript was saved for this attempt."}
                  </p>
                )}
              </div>
            </div>

            {/* Footer — this modal is view-only. Deleting an attempt is a single
                action in the row's last column (owner only), not here. */}
            <div className="flex items-center justify-end gap-3 border-t-2 border-[#0a0a0a] px-6 py-3">
              <button
                type="button"
                onClick={() => setSession(null)}
                className="border-2 border-[#0a0a0a] bg-white px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-[.08em] text-[#0a0a0a] transition hover:bg-[#0a0a0a] hover:text-[#ffe600]"
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
