import { loadSessions } from "@/lib/sessions";
import type { Track } from "@/lib/content";

/**
 * GET /api/quiz-completions?track= — for each reading date on a track, how
 * many accounts have completed the AI quiz on it. Feeds the index rows'
 * "Completed by N" tag (the peer nudge).
 *
 * PUBLIC (no login gate) — a bare count is participation, not identity, the
 * same call as the vote's public totalVotes; names are deliberately NOT
 * returned (owner, 2026-07-26). Also no "of M" denominator — the club mixes
 * regulars with occasional participants, so a total would be made up.
 * "Completed" mirrors quiz-dates: terminal attempts (graded or
 * legacy-partial) count; `cancelled` and `inProgress` don't.
 */
export async function GET(request: Request) {
  const track: Track =
    new URL(request.url).searchParams.get("track") === "junior"
      ? "junior"
      : "senior";

  const sessions = await loadSessions();
  if (!Array.isArray(sessions)) {
    return Response.json({ error: sessions.error }, { status: 500 });
  }

  const byDate = new Map<string, Set<string>>();
  for (const s of sessions) {
    if (s.cancelled || s.inProgress) continue;
    if ((s.track === "junior") !== (track === "junior")) continue;
    const account = s.loginUser ?? s.studentName;
    if (!account || !s.date) continue;
    (byDate.get(s.date) ?? byDate.set(s.date, new Set()).get(s.date)!).add(
      account,
    );
  }

  const counts: Record<string, number> = {};
  for (const [date, accounts] of byDate) {
    counts[date] = accounts.size;
  }

  return Response.json({ counts });
}
