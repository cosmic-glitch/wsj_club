import { del } from "@vercel/blob";
import { currentUser, isAdmin, isOwner } from "@/lib/auth";
import { listStudents } from "@/lib/users";

/**
 * Delete a saved voice-quiz session.
 *
 * The admin page passes the blob URL of the session JSON plus, when present, the
 * audio recording's URL — both are deleted. Two guards: the URLs must be under
 * the `quiz-sessions/` prefix (so a stray/forged request can't delete unrelated
 * blobs), AND — for a regular parent — the session must belong to their own
 * classroom (so one parent can't delete another classroom's attempt with a
 * hand-crafted URL). The OWNER is exempt from the classroom check: they may
 * delete ANY classroom's attempt (Delete is owner-only in the UI, and the owner
 * curates every classroom's Scores).
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

  // The owner may delete ANY classroom's attempt, so it skips the ownership
  // check entirely. A regular parent must own the session's classroom: fetch the
  // session JSON and check its stamped parent (the stored `teacherId` field —
  // the legacy name) / owning student, failing closed if it can't be read or
  // doesn't belong to the caller.
  if (!isOwner(user)) {
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
      return Response.json(
        { error: "Could not verify session." },
        { status: 400 }
      );
    }
  }

  try {
    await del(urls);
  } catch (err) {
    console.error("Deleting quiz session from Blob failed:", err);
    return Response.json({ error: "Delete failed." }, { status: 500 });
  }

  return Response.json({ ok: true });
}
