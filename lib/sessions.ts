import { dbSelect } from "@/lib/db";
import type { Session } from "@/components/AdminSessions";

/**
 * Load every voice-quiz session for the Scores page / Students roster /
 * quiz-dates — from Postgres since the Phase 3 read flip (PLAN-supabase.md):
 * one slim select over rc_quiz_sessions (no transcript/report/diag — the
 * modal-only heavy fields are served by GET /api/quiz-session?id= on open)
 * plus the rc_quiz_slots rows mapped to the inProgress shape, preserving the
 * old contract where the Scores page sees slots as sessions. This replaced
 * one blob fetch PER SESSION (~130 and growing, the page's whole latency)
 * with two queries.
 *
 * Writers still dual-write Blob + DB (until Phase 4), so reverting the flip
 * loses nothing. Each record's `id` is the DB row id (sessions: uuid; slots:
 * the serialized composite key) — the handle for Details and Delete.
 */

/** The serialized id of a slot row (slots have a composite PK, not a uuid). */
export function slotId(loginUser: string, track: string, date: string): string {
  return `slot:${loginUser}:${track}:${date}`;
}

const iso = (v: unknown): string | undefined => {
  if (typeof v !== "string" || !v) return undefined;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? undefined : t.toISOString();
};
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

export async function loadSessions(): Promise<Session[] | { error: string }> {
  const [rows, slots] = await Promise.all([
    dbSelect(
      "rc_quiz_sessions",
      "?select=id,date,track,title,student_name,login_user,parent_id,ended_at,duration_ms,score,audio_url,partial,cancelled,failure,resume_count&order=ended_at.desc"
    ),
    dbSelect(
      "rc_quiz_slots",
      "?select=login_user,track,date,title,student_name,parent_id,failure,audio_url,duration_ms,resume_count,updated_at"
    ),
  ]);
  if (rows === null || slots === null) {
    return { error: "Could not load sessions (database unavailable)." };
  }

  const sessions: Session[] = rows.map((r) => ({
    id: String(r.id),
    date: str(r.date) ?? "",
    ...(r.track === "junior" ? { track: "junior" as const } : {}),
    title: str(r.title) ?? "",
    studentName: str(r.student_name) ?? "",
    ...(str(r.login_user) ? { loginUser: str(r.login_user) } : {}),
    ...(str(r.parent_id) ? { parentId: str(r.parent_id) } : {}),
    endedAt: iso(r.ended_at) ?? "",
    ...(num(r.duration_ms) != null ? { durationMs: num(r.duration_ms) } : {}),
    // Score only — the summary/strengths/gaps narrative is modal-only.
    report: str(r.score) ? { score: str(r.score) } : null,
    ...(str(r.audio_url) ? { audioUrl: str(r.audio_url) } : {}),
    ...(r.partial === true ? { partial: true } : {}),
    ...(r.failure ? { failure: r.failure as Session["failure"] } : {}),
    ...(r.cancelled === true ? { cancelled: true } : {}),
    ...(num(r.resume_count) ? { resumeCount: num(r.resume_count) } : {}),
  }));

  for (const r of slots) {
    const login = str(r.login_user) ?? "";
    const track = r.track === "junior" ? "junior" : "senior";
    const date = str(r.date) ?? "";
    sessions.push({
      id: slotId(login, track, date),
      date,
      ...(track === "junior" ? { track: "junior" as const } : {}),
      title: str(r.title) ?? "",
      studentName: str(r.student_name) ?? login,
      loginUser: login,
      ...(str(r.parent_id) ? { parentId: str(r.parent_id) } : {}),
      report: null,
      ...(str(r.audio_url) ? { audioUrl: str(r.audio_url) } : {}),
      partial: true,
      ...(r.failure ? { failure: r.failure as Session["failure"] } : {}),
      inProgress: true,
      ...(iso(r.updated_at) ? { updatedAt: iso(r.updated_at) } : {}),
      ...(num(r.resume_count) ? { resumeCount: num(r.resume_count) } : {}),
    });
  }

  return sessions;
}
