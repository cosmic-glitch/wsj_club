import { copy } from "@vercel/blob";
import { currentUser } from "@/lib/auth";
import { getUser } from "@/lib/users";
import { getReading, type Track } from "@/lib/content";
import {
  deleteSlotBlobs,
  deleteSlotRow,
  getSlotRecord,
  safeNameOf,
  sanitizeDiag,
  sanitizeDurationMs,
  sanitizeFailure,
  sanitizeResumeCount,
  sanitizeTranscript,
  saveSessionRow,
  sessionPrefix,
  slotAudioPathname,
  upsertSlotRecord,
} from "@/lib/session-io";

/**
 * The in-progress slot API (pause & resume — see PLAN-continue-voice-quiz.md):
 *
 *   POST   — checkpoint: upsert the caller's slot with the transcript so far.
 *            Called by the client after every answer/tutor turn. NEVER grades,
 *            never calls a model — the slot always has `report: null`.
 *   GET    — load the caller's OWN slot (the launcher's chooser probe + the
 *            actual resume). Identity comes entirely from the cookie: there is
 *            no way to request another user's slot (in-progress transcripts are
 *            as private as finished ones).
 *   DELETE — "Start over": archive the caller's slot as an ungraded, parent-
 *            only `cancelled` record (nothing a student did is ever silently
 *            discarded — same philosophy as Cancel), then delete the slot.
 */

// The one validation both identity-bearing handlers share: a logged-in caller
// and a known (track, date) reading. Track is a label from the client (POST:
// body; GET/DELETE: query param), defaulting to senior — identity always comes
// from the cookie, never the body.
async function callerAndDate(
  request: Request,
  fromBody?: { date?: string; track?: string }
): Promise<{ user: string; date: string; track: Track } | Response> {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const date = (fromBody?.date ?? params.get("date") ?? "").trim();
  const track: Track =
    (fromBody?.track ?? params.get("track")) === "junior" ? "junior" : "senior";
  if (!getReading(date, track)) {
    return Response.json({ error: "Unknown reading." }, { status: 404 });
  }
  return { user, date, track };
}

export async function POST(request: Request) {
  let body: {
    date?: string;
    track?: string;
    transcript?: unknown;
    tutorDone?: unknown;
    resumeCount?: unknown;
    audioUrl?: unknown;
    durationMs?: unknown;
    failure?: unknown;
    sessionId?: unknown;
    mountId?: unknown;
    breadcrumbs?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const ctx = await callerAndDate(request, {
    date: String(body.date ?? ""),
    track: typeof body.track === "string" ? body.track : undefined,
  });
  if (ctx instanceof Response) return ctx;
  const { user, date, track } = ctx;
  const reading = getReading(date, track)!;
  const safeName = safeNameOf(user);

  const transcript = sanitizeTranscript(body.transcript);
  // A quiz where the student never spoke resumes identically to a fresh start
  // (the opening is a fixed script), so there is nothing worth saving — and
  // rejecting it keeps junk slots out of the Reports page.
  if (!transcript.some((t) => t.role === "student" && t.text.trim())) {
    return Response.json({ error: "Nothing to save yet." }, { status: 400 });
  }

  // The slot's audio is the client's best-effort pause-time flush, uploaded to
  // the caller's own stable slot-WAV key (the client bakes a ?v= cache-buster
  // into the stored URL). Accept only that URL — anything else is dropped, so a
  // crafted body can't link someone else's blob into this student's record.
  let audioUrl: string | undefined;
  const rawAudio = typeof body.audioUrl === "string" ? body.audioUrl.trim() : "";
  if (rawAudio) {
    try {
      const pathname = new URL(rawAudio).pathname;
      if (pathname.endsWith(`/${slotAudioPathname(track, date, safeName)}`)) {
        audioUrl = rawAudio;
      }
    } catch {
      // not a URL → dropped
    }
  }

  // Stored under the legacy `teacherId` field name (see quiz-report) so slot
  // records stay uniform with the existing saved sessions.
  const parentId = (await getUser(user))?.parentId;

  const session = {
    date,
    // Junior slots carry track: "junior" so the Reports page shows the junior
    // badge and its Continue points at /junior?resume=. Senior omits it (absent
    // means senior — no backfill of the existing records).
    ...(track === "junior" ? { track } : {}),
    title: reading.title,
    studentName: user,
    loginUser: user,
    teacherId: parentId,
    // The explicit in-progress marker the Reports UI keys off (NOT inferred from
    // partial/report — legacy failure-partials whose grading errored also have
    // report: null, and they must not grow a broken Continue button).
    inProgress: true,
    partial: true,
    cancelled: false,
    report: null,
    updatedAt: new Date().toISOString(),
    transcript,
    tutorDone: body.tutorDone === true,
    resumeCount: sanitizeResumeCount(body.resumeCount),
    ...(audioUrl
      ? { audioUrl, durationMs: sanitizeDurationMs(body.durationMs) }
      : {}),
    // Why the quiz last paused (set on a failure pause; null on a clean leave) —
    // shown to the parent on the in-progress entry's detail view.
    failure: sanitizeFailure(body.failure),
    diag: sanitizeDiag(body),
  };

  try {
    await upsertSlotRecord(user, track, date, session);
  } catch (err) {
    console.error("Checkpointing quiz progress failed:", err, "user:", user);
    return Response.json({ error: "Could not save progress." }, { status: 502 });
  }
  return Response.json({ ok: true });
}

export async function GET(request: Request) {
  const ctx = await callerAndDate(request);
  if (ctx instanceof Response) return ctx;
  const { user, date, track } = ctx;

  try {
    const session = await getSlotRecord(user, track, date);
    if (!session) return Response.json({ exists: false });
    return Response.json({ exists: true, session });
  } catch (err) {
    console.error("Loading in-progress quiz failed:", err, "user:", user);
    return Response.json(
      { error: "Could not load the saved quiz." },
      { status: 502 }
    );
  }
}

export async function DELETE(request: Request) {
  const ctx = await callerAndDate(request);
  if (ctx instanceof Response) return ctx;
  const { user, date, track } = ctx;
  const safeName = safeNameOf(user);
  const prefix = sessionPrefix(track, date);

  try {
    const slot = await getSlotRecord(user, track, date);
    if (slot) {
      // Archive before deleting. The slot's audio (if flushed) lives at the
      // stable slot key that's about to be deleted, so copy it to a permanent
      // key first — best-effort; if the copy fails the archive just has no
      // recording.
      let audioUrl: string | undefined;
      if (slot.audioUrl) {
        try {
          const copied = await copy(
            slotAudioPathname(track, date, safeName),
            `quiz-sessions/${prefix}/${safeName}-${Date.now()}.wav`,
            { access: "public", addRandomSuffix: true, contentType: "audio/wav" }
          );
          audioUrl = copied.url;
        } catch (err) {
          console.error("Copying slot audio for start-over archive failed:", err);
        }
      }
      const archived = {
        ...slot,
        inProgress: false,
        partial: false,
        cancelled: true,
        endedAt: new Date().toISOString(),
        audioUrl,
        report: {
          score: "—",
          summary:
            "Cancelled — the student started this quiz over, so this earlier attempt wasn't graded.",
          strengths: [],
          gaps: [],
          keyIdeas: "Not assessed — the attempt was restarted.",
          vocab: "Not assessed — the attempt was restarted.",
          concepts: "Not assessed — the attempt was restarted.",
        },
        failure: {
          reason: "superseded",
          detail: "The student chose Start over; this is the earlier, unfinished attempt.",
        },
        diag: { ...(slot.diag ?? {}), endReason: "start-over" },
      };
      // Archive first, delete second — a failed archive must keep the slot
      // (nothing a student did is ever silently discarded).
      if (!(await saveSessionRow(archived))) {
        return Response.json({ error: "Could not start over." }, { status: 502 });
      }
    }
    await deleteSlotBlobs(track, date, safeName);
    if (!(await deleteSlotRow(user, track, date))) {
      return Response.json({ error: "Could not start over." }, { status: 502 });
    }
    console.log(
      "Voice-quiz start-over:",
      JSON.stringify({ user, date, hadSlot: !!slot })
    );
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Start-over failed:", err, "user:", user);
    return Response.json({ error: "Could not start over." }, { status: 502 });
  }
}
