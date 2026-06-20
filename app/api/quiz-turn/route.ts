import { currentUser } from "@/lib/auth";
import { getReading } from "@/lib/content";
import { getArticleText } from "@/lib/article-text";
import { buildInstructions } from "@/lib/quiz-prompt";

// The chat model that plays the tutor, turn by turn. Same family as the grader
// (REPORT_MODEL) and confirmed working with our chat/completions request this
// build. Env-overridable; bump to the full model (e.g. gpt-5.4) for stronger
// Socratic judgment if ever needed — volume is tiny.
const TUTOR_MODEL = process.env.TUTOR_MODEL || "gpt-5.4-mini";

type Turn = { role: "student" | "tutor"; text: string };

/**
 * The turn-by-turn brain of the voice quiz. Given the running transcript so far,
 * it returns the tutor's NEXT spoken line (a question, a follow-up, or the
 * wrap-up). The browser speaks it with TTS, records the student's answer,
 * transcribes it, appends both turns, and calls this again — a discrete loop
 * that replaced the old realtime speech-to-speech session, so turn-taking is
 * fully under the student's control (Start/Stop buttons), never the model's.
 *
 * Login-gated, and the real OpenAI key never reaches the browser. The day's full
 * article text + handout answer key are injected as the system prompt (the same
 * `buildInstructions` the realtime session used), so the tutor judges answers
 * against the real story.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "Please log in to start a quiz." }, { status: 401 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "Server is missing OPENAI_API_KEY." }, { status: 500 });
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

  const articleText = await getArticleText(date);
  const instructions = buildInstructions(reading, studentName, articleText);

  // The tutor's instructions are the system prompt; the running transcript maps
  // into chat turns (tutor → assistant, student → user). On the very first call
  // the transcript is empty, so a tiny kickoff message asks for the greeting +
  // first question.
  const messages: { role: "system" | "assistant" | "user"; content: string }[] = [
    { role: "system", content: instructions },
  ];
  for (const t of transcript) {
    if (t.text?.trim()) {
      messages.push({ role: t.role === "tutor" ? "assistant" : "user", content: t.text });
    }
  }
  if (messages.length === 1) {
    messages.push({
      role: "user",
      content: "[The student just started the quiz. Greet them and ask your first question now.]",
    });
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: TUTOR_MODEL, messages }),
    });
    if (!res.ok) {
      console.error("Tutor turn failed:", res.status, await res.text());
      return Response.json({ error: "Could not get the next question." }, { status: 502 });
    }
    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content ?? "").trim();
    if (!text) {
      console.error("Tutor turn: empty response", data);
      return Response.json({ error: "Could not get the next question." }, { status: 502 });
    }
    return Response.json({ text });
  } catch (err) {
    console.error("Tutor turn error:", err);
    return Response.json({ error: "Could not get the next question." }, { status: 502 });
  }
}
