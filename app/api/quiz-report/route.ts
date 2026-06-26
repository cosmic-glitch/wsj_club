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
    partial?: boolean;
    failure?: SessionFailure | null;
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
  // A partial attempt: the quiz ended because of (or was abandoned after) a
  // transcription/tutor failure. We still save whatever was captured — the
  // recording + transcript so far — but flag it so the teacher knows it's
  // incomplete and why. `failure` is sanitized + length-capped (it's free text
  // from the client).
  const partial = body.partial === true;
  const failure: SessionFailure | null =
    body.failure && typeof body.failure === "object"
      ? {
          reason: String(body.failure.reason ?? "unknown").slice(0, 200),
          detail: String(body.failure.detail ?? "").slice(0, 2000),
        }
      : null;
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
  if (studentTurns.length === 0) {
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
    transcript,
    report,
    audioUrl,
    partial,
    failure,
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
