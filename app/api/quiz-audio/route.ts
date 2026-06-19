import { put } from "@vercel/blob";
import { currentUser } from "@/lib/auth";
import { getReading } from "@/lib/content";

/**
 * Saves a finished voice-quiz audio recording (the mixed student + tutor stream,
 * recorded client-side) to Vercel Blob and returns its public URL, which the
 * client then attaches to the session JSON via /api/quiz-report. Login-gated;
 * best-effort, like the rest of the save path.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const audio = form.get("audio");
  const date = (form.get("date")?.toString() ?? "").trim();
  const studentName = (form.get("studentName")?.toString() ?? "").trim() || user;

  if (!(audio instanceof Blob) || audio.size === 0) {
    return Response.json({ error: "No audio." }, { status: 400 });
  }
  if (!getReading(date)) {
    return Response.json({ error: "Unknown reading." }, { status: 404 });
  }

  const ext = audio.type.includes("mp4") ? "mp4" : "webm";
  const safeName = studentName.replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase();
  try {
    const blob = await put(
      `quiz-sessions/${date}/${safeName}-${Date.now()}.${ext}`,
      audio,
      { access: "public", addRandomSuffix: true, contentType: audio.type || "audio/webm" }
    );
    return Response.json({ url: blob.url });
  } catch (err) {
    console.error("Saving quiz audio to Blob failed:", err);
    return Response.json({ error: "Could not save audio." }, { status: 502 });
  }
}
