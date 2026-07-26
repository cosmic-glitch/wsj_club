import { del } from "@vercel/blob";
import { currentUser, isAdmin, isOwner } from "@/lib/auth";
import { listStudents } from "@/lib/users";
import { dbDelete, dbSelect } from "@/lib/db";
import { deleteSlot, safeNameOf } from "@/lib/session-io";
import {
  shadowDeleteSessionByBlob,
  shadowDeleteSlotBySafeName,
} from "@/lib/shadow";
import type { Track } from "@/lib/content";

/**
 * A saved voice-quiz session, by DB row id (the Phase 3 read flip —
 * PLAN-supabase.md):
 *
 *   GET ?id=  — the modal-only heavy fields ({transcript, report}) for the
 *               Details modal, AUTH-SCOPED server-side: owner → any; parent →
 *               own classroom; student → own, non-cancelled. This replaced the
 *               modal fetching the session's public-but-unguessable blob URL —
 *               transcripts are now properly auth-gated.
 *   DELETE    — remove a whole attempt: the DB row AND its Blob record + audio
 *               (Blob is still dual-written until Phase 4, so both must go).
 *               `{id}` is the DB row id — a uuid for a terminal session, or
 *               the serialized `slot:<login>:<track>:<date>` for an
 *               in-progress slot. A legacy `{url, audioUrl}` body (a stale
 *               pre-flip client tab) still works via the old blob-URL path.
 *
 * Scoping: the OWNER may touch ANY classroom's session; a regular parent only
 * their own classroom's; a student only their own (and never a cancelled one,
 * which their Scores view hides). DELETE additionally requires a parent
 * (isAdmin), as before.
 */

const SLOT_ID_RE = /^slot:([^:]+):(senior|junior):(\d{4}-\d{2}-\d{2})$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ScopeRow = {
  login_user?: unknown;
  student_name?: unknown;
  parent_id?: unknown;
  cancelled?: unknown;
};

/** May `user` see/touch this row? (See the scoping rules above.) */
async function mayAccess(
  user: string,
  admin: boolean,
  owner: boolean,
  row: ScopeRow
): Promise<boolean> {
  const rowOwner = String(row.login_user ?? row.student_name ?? "");
  if (owner) return true;
  if (admin) {
    if (row.parent_id === user || rowOwner === user) return true;
    const mine = new Set((await listStudents(user)).map((s) => s.username));
    return mine.has(rowOwner);
  }
  return rowOwner === user && row.cancelled !== true;
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
  }
  const id = (new URL(request.url).searchParams.get("id") ?? "").trim();
  const admin = await isAdmin(user);
  const owner = isOwner(user);

  const slot = SLOT_ID_RE.exec(id);
  if (slot) {
    const rows = await dbSelect(
      "rc_quiz_slots",
      `?login_user=eq.${encodeURIComponent(slot[1])}&track=eq.${slot[2]}&date=eq.${slot[3]}&select=login_user,student_name,parent_id,transcript`
    );
    if (rows === null) {
      return Response.json({ error: "Could not load." }, { status: 502 });
    }
    const r = rows[0];
    if (!r) return Response.json({ error: "Not found." }, { status: 404 });
    if (!(await mayAccess(user, admin, owner, r))) {
      return Response.json({ error: "Not authorized." }, { status: 403 });
    }
    return Response.json({ transcript: r.transcript ?? [], report: null });
  }

  if (!UUID_RE.test(id)) {
    return Response.json({ error: "Invalid id." }, { status: 400 });
  }
  const rows = await dbSelect(
    "rc_quiz_sessions",
    `?id=eq.${id}&select=login_user,student_name,parent_id,cancelled,transcript,report`
  );
  if (rows === null) {
    return Response.json({ error: "Could not load." }, { status: 502 });
  }
  const r = rows[0];
  if (!r) return Response.json({ error: "Not found." }, { status: 404 });
  if (!(await mayAccess(user, admin, owner, r))) {
    return Response.json({ error: "Not authorized." }, { status: 403 });
  }
  return Response.json({
    transcript: r.transcript ?? [],
    report: r.report ?? null,
  });
}

/** Strip a stored audio URL's query (?v= cache-buster) for the Blob delete. */
function bareUrl(u: unknown): string | null {
  if (typeof u !== "string" || !u) return null;
  try {
    const parsed = new URL(u);
    return parsed.pathname.includes("/quiz-sessions/")
      ? `${parsed.origin}${parsed.pathname}`
      : null;
  } catch {
    return null;
  }
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!(await isAdmin(user))) {
    return Response.json({ error: "Not authorized." }, { status: 403 });
  }
  const owner = isOwner(user);

  let body: { id?: string; url?: string; audioUrl?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const id = (body.id ?? "").trim();
  if (id) {
    const slot = SLOT_ID_RE.exec(id);
    if (slot) {
      const [, login, trackRaw, date] = slot;
      const track = trackRaw as Track;
      const rows = await dbSelect(
        "rc_quiz_slots",
        `?login_user=eq.${encodeURIComponent(login)}&track=eq.${track}&date=eq.${date}&select=login_user,student_name,parent_id`
      );
      if (rows === null) {
        return Response.json({ error: "Could not load." }, { status: 502 });
      }
      const r = rows[0];
      if (!r) return Response.json({ error: "Not found." }, { status: 404 });
      if (!(await mayAccess(user!, true, owner, r))) {
        return Response.json({ error: "Not authorized." }, { status: 403 });
      }
      try {
        // Blob first (JSON + flushed WAV), then the row — same order as the
        // legacy path; a blob failure keeps both stores intact.
        await deleteSlot(track, date, safeNameOf(login));
      } catch (err) {
        console.error("Deleting slot blobs failed:", err);
        return Response.json({ error: "Delete failed." }, { status: 500 });
      }
      const ok = await dbDelete(
        "rc_quiz_slots",
        `?login_user=eq.${encodeURIComponent(login)}&track=eq.${track}&date=eq.${date}`
      );
      if (!ok) {
        return Response.json(
          { error: "Removed the recording but not the row — try again." },
          { status: 500 }
        );
      }
      return Response.json({ ok: true });
    }

    if (!UUID_RE.test(id)) {
      return Response.json({ error: "Invalid id." }, { status: 400 });
    }
    const rows = await dbSelect(
      "rc_quiz_sessions",
      `?id=eq.${id}&select=login_user,student_name,parent_id,source_blob,audio_url`
    );
    if (rows === null) {
      return Response.json({ error: "Could not load." }, { status: 502 });
    }
    const r = rows[0];
    if (!r) return Response.json({ error: "Not found." }, { status: 404 });
    if (!(await mayAccess(user!, true, owner, r))) {
      return Response.json({ error: "Not authorized." }, { status: 403 });
    }
    try {
      // The session JSON by pathname (source_blob), the audio by URL.
      const targets = [
        typeof r.source_blob === "string" ? r.source_blob : null,
        bareUrl(r.audio_url),
      ].filter((u): u is string => Boolean(u));
      if (targets.length) await del(targets);
    } catch (err) {
      console.error("Deleting session blobs failed:", err);
      return Response.json({ error: "Delete failed." }, { status: 500 });
    }
    const ok = await dbDelete("rc_quiz_sessions", `?id=eq.${id}`);
    if (!ok) {
      return Response.json(
        { error: "Removed the recording but not the row — try again." },
        { status: 500 }
      );
    }
    return Response.json({ ok: true });
  }

  // ---- Legacy body: {url, audioUrl} (a stale pre-flip client tab) -----------

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
  if (!owner) {
    try {
      const res = await fetch(sessionUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const session = (await res.json()) as {
        teacherId?: string;
        loginUser?: string;
        studentName?: string;
      };
      const sessionOwner = session.loginUser ?? session.studentName ?? "";
      const mine = new Set((await listStudents(user!)).map((s) => s.username));
      const allowed =
        session.teacherId === user ||
        sessionOwner === user ||
        mine.has(sessionOwner);
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

  // Mirror the deletion into the DB so the row can't linger past the flip.
  try {
    const pathname = decodeURIComponent(new URL(sessionUrl).pathname).replace(
      /^\/+/,
      ""
    );
    const slot = /^quiz-sessions\/(junior\/)?(\d{4}-\d{2}-\d{2})\/(.+)-inprogress\.json$/.exec(
      pathname
    );
    if (slot) {
      const track: Track = slot[1] ? "junior" : "senior";
      await shadowDeleteSlotBySafeName(track, slot[2], slot[3]);
    } else {
      await shadowDeleteSessionByBlob(pathname);
    }
  } catch (err) {
    console.error("Shadow delete failed:", err);
  }

  return Response.json({ ok: true });
}
