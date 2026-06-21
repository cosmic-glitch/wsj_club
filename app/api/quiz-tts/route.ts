import { currentUser } from "@/lib/auth";

// The text-to-speech model + voice for the tutor. Env-overridable in case OpenAI
// renames them. `gpt-4o-mini-tts` is the current quality TTS model and accepts a
// tone `instructions` string; `onyx` is a warm, deep male voice (echoing the old
// realtime "cedar"). Other voices: alloy/echo/fable/onyx (male-ish),
// nova/shimmer/coral/sage (female-ish), ash/ballad/verse. Falls back cleanly —
// if speech can't be generated, the client still SHOWS the tutor's text.
const TTS_MODEL = process.env.TTS_MODEL || "gpt-4o-mini-tts";
const TTS_VOICE = process.env.TTS_VOICE || "onyx";

/**
 * Turns the tutor's next line into spoken audio (mp3) for the browser to play.
 * Login-gated; the real OpenAI key stays on the server. Each call is one short
 * utterance, so the audio is small. Best-effort on the client side: a failure
 * here just means the student reads the question instead of hearing it.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "Server is missing OPENAI_API_KEY." }, { status: 500 });
  }

  let body: { text?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  if (!text) {
    return Response.json({ error: "No text to speak." }, { status: 400 });
  }

  // `instructions` (tone steering) is a gpt-4o-mini-tts feature; the older tts-1
  // models reject it, so only send it for the gpt-4o family.
  const payload: Record<string, unknown> = {
    model: TTS_MODEL,
    voice: TTS_VOICE,
    input: text,
    response_format: "mp3",
    // `speed` is honored by the tts-1 models (ignored by gpt-4o-mini-tts, which
    // takes its pace from `instructions` below) — 1.3 ≈ 30% faster than default.
    speed: 1.3,
  };
  if (TTS_MODEL.includes("gpt-4o")) {
    payload.instructions =
      "Speak as a warm, friendly, encouraging tutor talking to a teenager. " +
      "Speak at a brisk, lively pace — clearly faster than an unhurried read " +
      "(about 30% quicker), while still sounding natural. Clear and plain.";
  }

  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("TTS failed:", res.status, await res.text());
      return Response.json({ error: "Could not generate speech." }, { status: 502 });
    }
    const audio = await res.arrayBuffer();
    return new Response(audio, {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("TTS error:", err);
    return Response.json({ error: "Could not generate speech." }, { status: 502 });
  }
}
