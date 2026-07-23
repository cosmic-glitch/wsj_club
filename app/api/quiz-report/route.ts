import { copy, put } from "@vercel/blob";
import { currentUser } from "@/lib/auth";
import { getUser } from "@/lib/users";
import { getReading, type Track } from "@/lib/content";
import { getArticleText } from "@/lib/article-text";
import { buildReportPrompt } from "@/lib/quiz-prompt";
import { applyLeniency } from "@/lib/score";
import {
  deleteSlot,
  readSlot,
  safeNameOf,
  sanitizeDiag,
  sanitizeDurationMs,
  sanitizeFailure,
  sanitizeResumeCount,
  sessionPrefix,
  slotAudioPathname,
  type SessionFailure,
  type Turn,
} from "@/lib/session-io";

const REPORT_MODEL = process.env.REPORT_MODEL || "gpt-5.5";

function transcriptToText(transcript: Turn[]): string {
  return transcript
    .map((t) => `${t.role === "student" ? "Student" : "Tutor"}: ${t.text}`)
    .join("\n");
}

/**
 * Takes a finished quiz transcript, asks a text model to grade it into a report
 * card, and saves the whole session (transcript + report) to Vercel Blob so the
 * parent can review it on /admin. Returns the report card to show the student.
 *
 * This is the TERMINAL save (End and Cancel both land here) — after a
 * successful save it also deletes the caller's in-progress slot (the pause &
 * resume checkpoint; see PLAN-continue-voice-quiz.md), so a stale "Continue"
 * can't linger for a finished quiz. Grading happens ONLY here, only for a
 * completed (non-cancelled, non-partial) attempt — a paused/incomplete session
 * always has `report: null`.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
  }

  let body: {
    date?: string;
    track?: string;
    studentName?: string;
    transcript?: Turn[];
    audioUrl?: string;
    durationMs?: number;
    partial?: boolean;
    cancelled?: boolean;
    failure?: SessionFailure | null;
    resumeCount?: number;
    // Client diagnostics (logging only) — see VoiceQuiz.tsx "Diagnostics" refs.
    sessionId?: string;
    mountId?: string;
    endReason?: string;
    phaseAtEnd?: string;
    breadcrumbs?: { t?: number; ev?: string; info?: string }[];
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const date = (body.date ?? "").trim();
  // Track is a client label (default senior); identity stays cookie-derived.
  const track: Track = body.track === "junior" ? "junior" : "senior";
  const studentName = (body.studentName ?? "").trim() || user;
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  const audioUrl = (body.audioUrl ?? "").trim() || undefined;
  // How long the quiz took (start → "End quiz"), measured client-side.
  const durationMs = sanitizeDurationMs(body.durationMs);
  // A partial attempt: kept for backward-compatibility only. The client no
  // longer finalizes on a failure (it PAUSES instead — the attempt stays
  // continuable), so nothing should send partial: true anymore; if something
  // does, the record is saved but never graded (see below).
  const partial = body.partial === true;
  // The student pressed Cancel: the attempt is still saved for the parent (the
  // /admin page hides it from the student's own Scores view) but never graded.
  const cancelled = body.cancelled === true;
  const failure = sanitizeFailure(body.failure);
  // How many times this attempt was paused and continued (surfaced to the
  // parent — pause-anytime makes a look-up-the-answer detour possible, and the
  // parent should be able to see that an attempt didn't run in one sitting).
  const resumeCount = sanitizeResumeCount(body.resumeCount);
  const diag = sanitizeDiag(body);

  const reading = getReading(date, track);
  if (!reading) {
    return Response.json({ error: "Unknown reading." }, { status: 404 });
  }

  // Only the student's OWN answers are gradable. A transcript can be non-empty
  // while holding nothing but the tutor's greeting (e.g. the student ended the
  // quiz before speaking). Grading that would let the model invent a score from
  // the article/handout reference — so when there are no real student turns we
  // skip the model and record an honest "nothing to grade" card instead.
  const studentTurns = transcript.filter((t) => t.role === "student" && t.text.trim());

  let report: unknown = null;
  if (cancelled) {
    // A cancelled attempt is never graded: the student chose to stop early, a
    // score for half a quiz would be misleading, and the student never sees
    // this entry anyway. The transcript + recording are what the parent reviews.
    report = {
      score: "—",
      summary:
        "Cancelled — the student ended this quiz early, so it wasn't graded.",
      strengths: [],
      gaps: [],
      keyIdeas: "Not assessed — the quiz was cancelled.",
      vocab: "Not assessed — the quiz was cancelled.",
      concepts: "Not assessed — the quiz was cancelled.",
    };
  } else if (studentTurns.length === 0) {
    report = {
      score: "—",
      summary:
        "No answers to grade — the student didn't respond during this session (it looks like the quiz ended before they spoke).",
      strengths: [],
      gaps: ["Re-take the quiz and answer the tutor's questions out loud."],
      keyIdeas: "Not assessed — the student didn't speak.",
      vocab: "Not assessed — the student didn't speak.",
      concepts: "Not assessed — the student didn't speak.",
    };
  } else if (partial) {
    // Grade only on End: an incomplete attempt is never sent to the model.
    // (Defensive — the client pauses on failure instead of finalizing a partial,
    // so this shouldn't be reached; report stays null, like a paused slot's.)
  } else if (process.env.OPENAI_API_KEY) {
    // Generate the report card from the transcript (best-effort).
    const articleText = await getArticleText(date, track);
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: REPORT_MODEL,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content: buildReportPrompt(
                reading,
                transcriptToText(transcript),
                articleText,
                track
              ),
            },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) report = JSON.parse(content);
      } else {
        console.error("Report generation failed:", res.status, "user:", user, await res.text());
      }
    } catch (err) {
      console.error("Report generation error for user:", user, err);
    }
  }

  // Leniency: bump the grader's numeric score by +1 (clipped to 10) before it is
  // saved and returned. The no-answers card's "—" is passed through untouched.
  if (report && typeof report === "object" && "score" in report) {
    const r = report as { score?: unknown };
    r.score = applyLeniency(r.score);
  }

  // Stamp the owning parent so /admin can scope each parent to their own
  // classroom by a direct field match (rather than re-deriving from the roster
  // every load). Looked up from the student's record; undefined if the taker is
  // a parent quizzing themselves or an un-migrated user (the /admin filter then
  // falls back to roster membership). Saved under the legacy `teacherId` field
  // name so the stored session JSON stays uniform with existing records
  // (lib/sessions.ts normalizes it back to parentId on read).
  const parentId = (await getUser(user))?.parentId;

  // This terminal record replaces any in-progress slot. If the client sent no
  // recording — a resumed quiz normally stitches the slot's flushed WAV into
  // its own upload (the client fetches + prepends it on resume, Phase 2), so
  // this is the fallback for when that fetch/stitch/upload failed — salvage the
  // slot's flushed audio by copying it to a permanent key BEFORE the slot (and
  // its stable-key audio) is deleted below. Otherwise a completed, graded quiz
  // could end up with no recording at all even though one was captured. The
  // slot key derives from the COOKIE user (matching what /api/quiz-progress
  // wrote), not from the client-sent studentName.
  const slotName = safeNameOf(user);
  let finalAudioUrl = audioUrl;
  let finalDurationMs = durationMs;
  if (!finalAudioUrl) {
    try {
      const slot = await readSlot(track, date, slotName);
      if (slot?.session.audioUrl) {
        const copied = await copy(
          slotAudioPathname(track, date, slotName),
          `quiz-sessions/${sessionPrefix(track, date)}/${slotName}-${Date.now()}.wav`,
          { access: "public", addRandomSuffix: true, contentType: "audio/wav" }
        );
        finalAudioUrl = copied.url;
        finalDurationMs = finalDurationMs ?? sanitizeDurationMs(slot.session.durationMs);
      }
    } catch (err) {
      console.error("Salvaging slot audio failed:", err, "user:", user);
    }
  }

  const session = {
    date,
    // Stamp track only for junior (absent means senior — no backfill of the
    // existing senior records). This is what shows the junior badge on Scores
    // and never silently compares a junior 8/10 against a senior 8/10.
    ...(track === "junior" ? { track } : {}),
    title: reading.title,
    studentName,
    loginUser: user,
    teacherId: parentId,
    endedAt: new Date().toISOString(),
    durationMs: finalDurationMs,
    transcript,
    report,
    audioUrl: finalAudioUrl,
    partial,
    cancelled,
    failure,
    resumeCount,
    diag,
  };

  // A failure ended this session — log it WITH the student and how far they got
  // (answers recorded, whether a recording was saved), so a reported problem is
  // traceable from the runtime logs even though the per-turn failures already
  // logged above.
  if (partial) {
    console.error(
      "Voice-quiz partial session saved:",
      JSON.stringify({
        user,
        studentName,
        date,
        reason: failure?.reason ?? "unknown",
        detail: failure?.detail ?? "",
        studentAnswers: studentTurns.length,
        totalTurns: transcript.length,
        audioSaved: !!finalAudioUrl,
      })
    );
  }

  // Every save — partial or clean — logs one concise diagnostic line (the
  // partial branch above adds the failure detail). This is the server-side
  // counterpart to the breadcrumbs and survives even if the Blob record is later
  // deleted, so a double-save shows up as two of these lines with the SAME
  // sessionId. console.log (info), not error — a normal save isn't an error.
  console.log(
    "Voice-quiz session saved:",
    JSON.stringify({
      user,
      sessionId: diag.sessionId,
      mountId: diag.mountId,
      endReason: diag.endReason,
      phaseAtEnd: diag.phaseAtEnd,
      studentAnswers: studentTurns.length,
      totalTurns: transcript.length,
      partial,
      cancelled,
      resumeCount,
      audioSaved: !!finalAudioUrl,
      durationMs: finalDurationMs,
    })
  );

  // Save to Blob (best-effort — don't fail the student's session if storage hiccups).
  try {
    const safeName = safeNameOf(studentName);
    await put(
      `quiz-sessions/${sessionPrefix(track, date)}/${safeName}-${Date.now()}.json`,
      JSON.stringify(session, null, 2),
      { access: "public", addRandomSuffix: true, contentType: "application/json" }
    );
    // The terminal save succeeded — now (and only now) remove the in-progress
    // slot, so a storage hiccup above keeps Continue alive rather than losing
    // the attempt. Best-effort + idempotent; a quiz that never checkpointed
    // simply has no slot to remove.
    try {
      await deleteSlot(track, date, slotName);
    } catch (err) {
      console.error("Deleting in-progress slot failed:", err, "user:", user);
    }
  } catch (err) {
    console.error("Saving quiz session to Blob failed:", err);
  }

  return Response.json({ report });
}
