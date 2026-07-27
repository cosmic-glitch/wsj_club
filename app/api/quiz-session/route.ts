import { del } from "@vercel/blob";
import { currentUser, isAdmin, isOwner } from "@/lib/auth";
import { listStudents } from "@/lib/users";
import { dbDelete, dbSelect } from "@/lib/db";
import { deleteSlotBlobs, safeNameOf } from "@/lib/session-io";
import type { Track } from "@/lib/content";

/**
 * A saved voice-quiz session, by DB row id:
 *
 *   GET ?id=  — the modal-only heavy fields ({transcript, report}) for the
 *               Details modal, AUTH-SCOPED server-side: owner → any; parent →
 *               own classroom; student → own, non-cancelled.
 *   DELETE    — remove a whole attempt: the DB row plus its Blob audio (and,
 *               for pre-migration rows, the archived session JSON at
 *               source_blob). `{id}` is the DB row id — a uuid for a terminal
 *               session, or the serialized `slot:<login>:<track>:<date>` for
 *               an in-progress slot.
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

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const id = (body.id ?? "").trim();
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
      // Blob first (flushed WAV + any legacy JSON), then the row — a blob
      // failure keeps both intact.
      await deleteSlotBlobs(track, date, safeNameOf(login));
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
    // Pre-migration rows: the archived session JSON by pathname (source_blob);
    // every row: the audio by URL.
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
