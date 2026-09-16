import { currentUserRecord } from "@/lib/auth";
import { getAllReadings, getReading, type Track } from "@/lib/content";
import { loadSessions } from "@/lib/sessions";
import { loadMarksFor, medalsOf, recordMark } from "@/lib/marks";
import { streakOf, type MarkLevel } from "@/lib/medals";
import { classroomOf } from "@/lib/users";

/**
 * The daily medals API — for EVERY active login: parents read too (the
 * Activity page already shows them), so a parent earns medals and a streak
 * exactly like a student; their marks are stamped to their own classroom.
 *
 *   GET  /api/medals?track=&today=  → the CALLER's per-date medal map on a
 *                                     track + their streak.
 *   POST /api/medals                → record an attestation {track, date,
 *                                     level: 1 (read the article) | 2 (read
 *                                     the handout), today}; replies with the
 *                                     same map + streak so the page can update
 *                                     in place.
 *
 * Identity always comes from the signed cookie; `track` is only a label.
 * `today` is the viewer's LOCAL date (the streak rule skips today's untaken
 * reading — the server can't know the viewer's timezone); it's validated and
 * falls back to the club's Pacific date. Gold is never written here — it's a
 * completed voice-quiz session, joined in by lib/marks.
 */

const trackOf = (v: unknown): Track => (v === "junior" ? "junior" : "senior");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayOf(v: unknown): string {
  if (typeof v === "string" && DATE_RE.test(v)) return v;
  // Club-local fallback: the Pacific date.
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

async function viewer() {
  const record = await currentUserRecord();
  if (!record || record.active === false) {
    return { error: Response.json({ error: "Not logged in." }, { status: 401 }) };
  }
  return { record };
}

async function payload(username: string, track: Track, today: string) {
  const [sessions, marks] = await Promise.all([loadSessions(), loadMarksFor(username, track)]);
  if (!Array.isArray(sessions)) {
    return Response.json({ error: sessions.error }, { status: 500 });
  }
  if (!marks) {
    return Response.json({ error: "Couldn't load your medals." }, { status: 500 });
  }
  const medals = medalsOf(marks, sessions, username, track);
  const dates = getAllReadings(track).map((r) => r.date);
  return Response.json({ medals, streak: streakOf(dates, medals, today) });
}

export async function GET(request: Request) {
  const got = await viewer();
  if ("error" in got) return got.error;
  const params = new URL(request.url).searchParams;
  return payload(got.record.username, trackOf(params.get("track")), todayOf(params.get("today")));
}

export async function POST(request: Request) {
  const got = await viewer();
  if ("error" in got) return got.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  const track = trackOf(body.track);
  const date = typeof body.date === "string" && DATE_RE.test(body.date) ? body.date : null;
  const level: MarkLevel | null = body.level === 2 ? 2 : body.level === 1 ? 1 : null;
  if (!date || !level || !getReading(date, track)) {
    return Response.json({ error: "No such reading." }, { status: 400 });
  }

  const { record } = got;
  const held = await recordMark(
    { username: record.username, parentId: classroomOf(record) },
    track,
    date,
    level,
  );
  if (held === null) {
    return Response.json({ error: "Couldn't save that — try again." }, { status: 500 });
  }
  return payload(record.username, track, todayOf(body.today));
}
