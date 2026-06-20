import { del } from "@vercel/blob";
import { currentUser, isAdmin } from "@/lib/auth";

/**
 * Delete a saved voice-quiz session (teacher-only).
 *
 * The admin page passes the blob URL of the session JSON plus, when present, the
 * audio recording's URL — both are deleted. Guarded to the `quiz-sessions/`
 * prefix so a stray/forged request can't delete unrelated blobs.
 */
export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!isAdmin(user)) {
    return Response.json({ error: "Not authorized." }, { status: 403 });
  }

  let body: { url?: string; audioUrl?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  // Only allow deleting blobs under quiz-sessions/ — never arbitrary URLs.
  const isSessionBlob = (u: string) => {
    try {
      return new URL(u).pathname.includes("/quiz-sessions/");
    } catch {
      return false;
    }
  };

  const urls = [body.url, body.audioUrl]
    .map((u) => (u ?? "").trim())
    .filter((u) => u && isSessionBlob(u));

  if (urls.length === 0) {
    return Response.json({ error: "Nothing to delete." }, { status: 400 });
  }

  try {
    await del(urls);
  } catch (err) {
    console.error("Deleting quiz session from Blob failed:", err);
    return Response.json({ error: "Delete failed." }, { status: 500 });
  }

  return Response.json({ ok: true });
}
