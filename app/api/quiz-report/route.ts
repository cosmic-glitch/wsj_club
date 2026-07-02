import { put } from "@vercel/blob";
import { currentUser } from "@/lib/auth";
import { getReading } from "@/lib/content";
import { getArticleText } from "@/lib/article-text";
import { buildReportPrompt } from "@/lib/quiz-prompt";
import { applyLeniency } from "@/lib/score";

const REPORT_MODEL = process.env.REPORT_MODEL || "gpt-5.5";

type Turn = { role: "student" | "tutor"; text: string };

// A failure recorded during the quiz (transcription / tutor unreachable). When
// present, the session is saved as a PARTIAL attempt rather than being lost.
type SessionFailure = { reason: string; detail: string };

function transcriptToText(transcript: Turn[]): string {
  return transcript
    .map((t) => `${t.role === "student" ? "Student" : "Tutor"}: ${t.text}`)
    .join("\n");
}

/**
 * Takes a finished quiz transcript, asks a text model to grade it into a report
 * card, and saves the whole session (transcript + report) to Vercel Blob so the
 * teacher can review it on /admin. Returns the report card to show the student.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
  }

  let body: {
    date?: string;
    studentName?: string;
    transcript?: Turn[];
    audioUrl?: string;
    durationMs?: number;
    partial?: boolean;
    cancelled?: boolean;
    failure?: SessionFailure | null;
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
  const studentName = (body.studentName ?? "").trim() || user;
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  const audioUrl = (body.audioUrl ?? "").trim() || undefined;
  // How long the quiz took (start → "End quiz"), measured client-side. Validate
  // it's a sane non-negative number and cap it (6h) against a bad client value.
  const durationMs =
    typeof body.durationMs === "number" &&
    Number.isFinite(body.durationMs) &&
    body.durationMs >= 0
      ? Math.min(Math.round(body.durationMs), 6 * 60 * 60 * 1000)
      : undefined;
  // A partial attempt: the quiz ended because of (or was abandoned after) a
  // transcription/tutor failure. We still save whatever was captured — the
  // recording + transcript so far — but flag it so the teacher knows it's
  // incomplete and why. `failure` is sanitized + length-capped (it's free text
  // from the client).
  const partial = body.partial === true;
  // The student pressed Cancel: the attempt is still saved for the teacher (the
  // /admin page hides it from the student's own Scores view) but never graded.
  const cancelled = body.cancelled === true;
  const failure: SessionFailure | null =
    body.failure && typeof body.failure === "object"
      ? {
          reason: String(body.failure.reason ?? "unknown").slice(0, 200),
          detail: String(body.failure.detail ?? "").slice(0, 2000),
        }
      : null;

  // Client diagnostics (logging only): a stable per-quiz `sessionId` + per-mount
  // `mountId`, the end trigger + phase, and an ordered breadcrumb trail. These
  // make a recurrence of the "one quiz saved as two records" bug self-explaining
  // (e.g. the same sessionId on two records ⇒ a double-save). All free text from
  // the client, so sanitize + length/count-cap everything.
  const str = (v: unknown, n: number) =>
    typeof v === "string" && v.trim() ? v.slice(0, n) : undefined;
  const diag = {
    sessionId: str(body.sessionId, 64),
    mountId: str(body.mountId, 64),
    endReason: str(body.endReason, 64),
    phaseAtEnd: str(body.phaseAtEnd, 32),
    breadcrumbs: Array.isArray(body.breadcrumbs)
      ? body.breadcrumbs.slice(0, 400).map((e) => ({
          t: typeof e?.t === "number" && Number.isFinite(e.t) ? Math.round(e.t) : 0,
          ev: String(e?.ev ?? "").slice(0, 48),
          ...(e?.info ? { info: String(e.info).slice(0, 200) } : {}),
        }))
      : undefined,
  };

  const reading = getReading(date);
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
    // this entry anyway. The transcript + recording are what the teacher reviews.
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
  } else if (process.env.OPENAI_API_KEY) {
    // Generate the report card from the transcript (best-effort).
    const articleText = await getArticleText(date);
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
                articleText
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

  const session = {
    date,
    title: reading.title,
    studentName,
    loginUser: user,
    endedAt: new Date().toISOString(),
    durationMs,
    transcript,
    report,
    audioUrl,
    partial,
    cancelled,
    failure,
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
        audioSaved: !!audioUrl,
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
      audioSaved: !!audioUrl,
      durationMs,
    })
  );

  // Save to Blob (best-effort — don't fail the student's session if storage hiccups).
  try {
    const safeName = studentName.replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase();
    await put(
      `quiz-sessions/${date}/${safeName}-${Date.now()}.json`,
      JSON.stringify(session, null, 2),
      { access: "public", addRandomSuffix: true, contentType: "application/json" }
    );
  } catch (err) {
    console.error("Saving quiz session to Blob failed:", err);
  }

  return Response.json({ report });
}
