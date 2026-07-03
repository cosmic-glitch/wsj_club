import { del } from "@vercel/blob";
import { currentUser, isAdmin } from "@/lib/auth";
import { listStudents } from "@/lib/users";

/**
 * Delete a saved voice-quiz session (teacher-only, own classroom only).
 *
 * The admin page passes the blob URL of the session JSON plus, when present, the
 * audio recording's URL — both are deleted. Two guards: the URLs must be under
 * the `quiz-sessions/` prefix (so a stray/forged request can't delete unrelated
 * blobs), AND the session must belong to the calling teacher's classroom (so one
 * teacher can't delete another classroom's attempt with a hand-crafted URL).
 */
export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!(await isAdmin(user))) {
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

  const sessionUrl = (body.url ?? "").trim();
  const urls = [body.url, body.audioUrl]
    .map((u) => (u ?? "").trim())
    .filter((u) => u && isSessionBlob(u));

  if (!sessionUrl || !isSessionBlob(sessionUrl) || urls.length === 0) {
    return Response.json({ error: "Nothing to delete." }, { status: 400 });
  }

  // Verify the session belongs to the calling teacher's classroom before
  // deleting. Fetch the session JSON and check its teacherId / owning student;
  // fail closed if it can't be read or doesn't belong to the caller. (The owner
  // isn't exempt — it manages its own students only.)
  try {
    const res = await fetch(sessionUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const session = (await res.json()) as {
      teacherId?: string;
      loginUser?: string;
      studentName?: string;
    };
    const owner = session.loginUser ?? session.studentName ?? "";
    const mine = new Set((await listStudents(user!)).map((s) => s.username));
    const allowed =
      session.teacherId === user || owner === user || mine.has(owner);
    if (!allowed) {
      return Response.json({ error: "Not authorized." }, { status: 403 });
    }
  } catch (err) {
    console.error("Could not verify session ownership for delete:", err);
    return Response.json({ error: "Could not verify session." }, { status: 400 });
  }

  try {
    await del(urls);
  } catch (err) {
    console.error("Deleting quiz session from Blob failed:", err);
    return Response.json({ error: "Delete failed." }, { status: 500 });
  }

  return Response.json({ ok: true });
}
