import { currentUser } from "@/lib/auth";
import { getReading } from "@/lib/content";
import { getArticleText } from "@/lib/article-text";
import { buildInstructions } from "@/lib/quiz-prompt";

// The Realtime model + voice. Env-overridable so we can adjust if OpenAI
// renames them without touching code.
const REALTIME_MODEL = process.env.REALTIME_MODEL || "gpt-realtime-2";
const REALTIME_VOICE = process.env.REALTIME_VOICE || "cedar";

// How eager the tutor is to take its turn. "auto" lets OpenAI adapt the
// turn-taking to the conversation — snappy on short answers (vocab/concepts) but
// still willing to wait through thinking pauses — which beats the uniformly
// patient "low" that felt sluggish on short Q&A. Override per-deploy with
// REALTIME_VAD_EAGERNESS (low | medium | high | auto). (OpenAI semantic_vad.)
const VAD_EAGERNESS = process.env.REALTIME_VAD_EAGERNESS || "auto";

/**
 * Mints a short-lived OpenAI Realtime ephemeral key for the browser to open a
 * WebRTC voice session. This is the choke point that keeps the paid API gated:
 * it requires a valid login, and the real OpenAI key never leaves the server.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "Please log in to start a quiz." }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "Server is missing OPENAI_API_KEY." }, { status: 500 });
  }

  let body: { date?: string; studentName?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const date = (body.date ?? "").trim();
  const studentName = (body.studentName ?? "").trim() || user;
  const reading = getReading(date);
  if (!reading) {
    return Response.json({ error: "Unknown reading." }, { status: 404 });
  }

  // The full article text (private Blob) lets the tutor judge the student's
  // from-memory retelling against the real story. Null for days without it →
  // the tutor falls back to a handout-only quiz.
  const articleText = await getArticleText(date);
  const instructions = buildInstructions(reading, studentName, articleText);

  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: REALTIME_MODEL,
        instructions,
        audio: {
          input: {
            transcription: { model: "whisper-1" },
            // semantic_vad waits until the student's *words* signal they're done,
            // not just on silence — so it doesn't cut in during thinking pauses.
            turn_detection: { type: "semantic_vad", eagerness: VAD_EAGERNESS },
          },
          output: { voice: REALTIME_VOICE },
        },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("Realtime client_secrets failed:", res.status, detail);
    return Response.json(
      { error: "Could not start the voice session." },
      { status: 502 }
    );
  }

  const data = await res.json();
  // GA shape: { value: "ek_...", expires_at }. Fall back to the older nested shape.
  const value = data.value ?? data.client_secret?.value;
  if (!value) {
    console.error("Realtime client_secrets: no token in response", data);
    return Response.json({ error: "Could not start the voice session." }, { status: 502 });
  }

  return Response.json({ value, model: REALTIME_MODEL });
}
