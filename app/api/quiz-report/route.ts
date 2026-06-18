import { put } from "@vercel/blob";
import { currentUser } from "@/lib/auth";
import { getReading } from "@/lib/content";
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

  let body: { date?: string; studentName?: string; transcript?: Turn[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const date = (body.date ?? "").trim();
  const studentName = (body.studentName ?? "").trim() || user;
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  const reading = getReading(date);
  if (!reading) {
    return Response.json({ error: "Unknown reading." }, { status: 404 });
  }

  // Generate the report card from the transcript (best-effort).
  let report: unknown = null;
  if (transcript.length > 0 && process.env.OPENAI_API_KEY) {
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
              content: buildReportPrompt(reading, studentName, transcriptToText(transcript)),
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
