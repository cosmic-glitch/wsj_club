import { put } from "@vercel/blob";
import { currentUser } from "@/lib/auth";
import { getReading } from "@/lib/content";
import { getArticleText } from "@/lib/article-text";
import { buildReportPrompt } from "@/lib/quiz-prompt";

const REPORT_MODEL = process.env.REPORT_MODEL || "gpt-4o-mini";

type Turn = { role: "student" | "tutor"; text: string };

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

  let body: { date?: string; studentName?: string; transcript?: Turn[]; audioUrl?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const date = (body.date ?? "").trim();
  const studentName = (body.studentName ?? "").trim() || user;
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  const audioUrl = (body.audioUrl ?? "").trim() || undefined;
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
                studentName,
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
        console.error("Report generation failed:", res.status, await res.text());
      }
    } catch (err) {
      console.error("Report generation error:", err);
    }
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
  };

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
