import { currentUser } from "@/lib/auth";
import { getReading } from "@/lib/content";
import { buildInstructions } from "@/lib/quiz-prompt";

// The Realtime model + voice. Env-overridable so we can adjust if OpenAI
// renames them without touching code.
const REALTIME_MODEL = process.env.REALTIME_MODEL || "gpt-realtime-2";
const REALTIME_VOICE = process.env.REALTIME_VOICE || "marin";

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

  const instructions = buildInstructions(reading, studentName);

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
            turn_detection: { type: "server_vad" },
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
