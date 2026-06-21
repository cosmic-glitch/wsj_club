import { del } from "@vercel/blob";
import { currentUser } from "@/lib/auth";

// The speech-to-text model for the student's spoken answers. `whisper-1` is the
// robust default (it's what the realtime session used for input transcription);
// env-overridable to gpt-4o-transcribe / gpt-4o-mini-transcribe.
const STT_MODEL = process.env.STT_MODEL || "whisper-1";

/**
 * Transcribes one recorded student answer to text.
 *
 * The browser uploads the answer clip DIRECTLY to Vercel Blob (via the
 * /api/quiz-audio client-upload token) and POSTs us just `{ blobUrl }`; we fetch
 * the bytes back from Blob and forward them to OpenAI. Earlier this route took
 * the audio as a `multipart/form-data` body, but a long answer exceeded Vercel's
 * ~4.5MB request-body limit and was rejected with a 413 BEFORE the function even
 * ran (the per-turn key-ideas retelling can be minutes long — an uncompressed
 * iOS WAV blows past 4.5MB in ~2.3 min). Routing the bytes through Blob — the
 * same dodge the full-length teacher recording uses — sidesteps that limit. The
 * clip is transient: we delete it once we've read it. Login-gated; the OpenAI
 * key stays server side.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "Server is missing OPENAI_API_KEY." }, { status: 500 });
  }

  let blobUrl: string;
  try {
    const body = (await request.json()) as { blobUrl?: string };
    blobUrl = (body?.blobUrl ?? "").trim();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  // Validate it's one of OUR transient per-turn clips, not an arbitrary
  // server-side fetch target. This route is reachable by any logged-in student
  // AND it DELETES the clip when done, so the guard is deliberately narrow:
  // require the Vercel Blob host and the `quiz-sessions/<date>/turns/` prefix the
  // client uploads to — never the bare `quiz-sessions/` prefix, so a forged URL
  // can't make us fetch or delete a teacher recording or a saved session JSON.
  let parsed: URL;
  try {
    parsed = new URL(blobUrl);
  } catch {
    return Response.json({ error: "No audio." }, { status: 400 });
  }
  if (
    !parsed.hostname.endsWith(".blob.vercel-storage.com") ||
    !/\/quiz-sessions\/[^/]+\/turns\//.test(parsed.pathname)
  ) {
    return Response.json({ error: "Unexpected audio location." }, { status: 400 });
  }

  const name = parsed.pathname.split("/").pop() || "answer.webm";

  try {
    // Pull the clip back from Blob, then forward it to OpenAI.
    const audioRes = await fetch(blobUrl);
    if (!audioRes.ok) {
      console.error(
        "Transcription couldn't read clip from Blob:",
        audioRes.status,
        "user:",
        user,
        "url:",
        blobUrl
      );
      return Response.json({ error: "Could not read the recording." }, { status: 502 });
    }
    const audioBlob = await audioRes.blob();

    const upstream = new FormData();
    // OpenAI keys off the filename extension to detect the format, so pass a
    // sensible name (the stored object keeps the recorder's container extension).
    upstream.append("file", audioBlob, name);
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
        audioBlob.size,
        await res.text()
      );
      return Response.json({ error: "Could not transcribe the answer." }, { status: 502 });
    }
    const data = await res.json();
    return Response.json({ text: (data.text ?? "").trim() });
  } catch (err) {
    console.error("Transcription error for user:", user, "url:", blobUrl, err);
    return Response.json({ error: "Could not transcribe the answer." }, { status: 502 });
  } finally {
    // The per-turn clip is transient — only needed long enough to transcribe.
    // Delete it best-effort so these don't pile up in the store (the permanent
    // teacher recording is the separately-stitched WAV built at End quiz).
    void del(blobUrl).catch(() => {});
  }
}
