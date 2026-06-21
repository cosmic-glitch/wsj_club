import { currentUser } from "@/lib/auth";

// The speech-to-text model for the student's spoken answers. `whisper-1` is the
// robust default (it's what the realtime session used for input transcription);
// env-overridable to gpt-4o-transcribe / gpt-4o-mini-transcribe.
const STT_MODEL = process.env.STT_MODEL || "whisper-1";

/**
 * Transcribes one recorded student answer to text. The browser POSTs a small
 * `multipart/form-data` body with the turn's audio under `file`; we forward it to
 * OpenAI and return `{ text }`.
 *
 * Per-turn clips are a few seconds — far under Vercel's ~4.5MB request-body
 * limit — so routing the audio through this function is fine here (unlike the
 * full-length teacher recording, which is uploaded straight to Blob via
 * /api/quiz-audio to dodge that limit). Login-gated; the OpenAI key stays server
 * side.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "Server is missing OPENAI_API_KEY." }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return Response.json({ error: "No audio." }, { status: 400 });
  }

  const name = file instanceof File && file.name ? file.name : "answer.webm";

  try {
    const upstream = new FormData();
    // OpenAI keys off the filename extension to detect the format, so pass a
    // sensible name (the client sends one matching the recorder's container).
    upstream.append("file", file, name);
    upstream.append("model", STT_MODEL);
    upstream.append("response_format", "json");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: upstream,
    });
    if (!res.ok) {
      // Log the student so a reported failure is traceable, plus the clip's
      // size/name and OpenAI's reason (an empty/malformed clip 400s here).
      console.error(
        "Transcription failed:",
        res.status,
        "user:",
        user,
        "file:",
        name,
        file.size,
        await res.text()
      );
      return Response.json({ error: "Could not transcribe the answer." }, { status: 502 });
    }
    const data = await res.json();
    return Response.json({ text: (data.text ?? "").trim() });
  } catch (err) {
    console.error("Transcription error for user:", user, "file:", name, file.size, err);
    return Response.json({ error: "Could not transcribe the answer." }, { status: 502 });
  }
}
