import { loadSessions } from "@/lib/sessions";
import { currentUser, isOwner } from "@/lib/auth";
import type { Track } from "@/lib/content";

/**
 * GET /api/quiz-completions?track= — for each reading date on a track, how
 * many accounts have completed the AI quiz on it. Feeds the index rows'
 * "Completed by N" tag.
 *
 * OWNER-ONLY (owner's rule, 2026-07-31) — the tag started life as a public
 * peer nudge (a bare count, no names, no "of M" denominator), but the owner
 * ruled the count itself shouldn't be club-visible; it's now a
 * participation dashboard for them alone. 403 for everyone else — the client
 * leaf treats any non-OK response as "leave the tags off", so members' index
 * rows simply don't show the tag. Names are still never returned.
 * "Completed" mirrors quiz-dates: terminal attempts (graded or
 * legacy-partial) count; `cancelled` and `inProgress` don't.
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || !isOwner(user)) {
    return Response.json({ error: "Not allowed." }, { status: 403 });
  }

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
