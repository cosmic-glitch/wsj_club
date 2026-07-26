import { currentUser } from "@/lib/auth";
import { loadSessions } from "@/lib/sessions";
import type { Track } from "@/lib/content";

/**
 * GET /api/quiz-completions?track= — for each reading date on a track, the
 * accounts that have completed the AI quiz on it. Feeds the index rows'
 * "Completed by …" tag (the peer nudge: "arjun and samaira already did it").
 *
 * Login-gated: the club's usernames aren't shown to the logged-out public.
 * Deliberately names-only, no totals — the club mixes regulars with
 * occasional participants, so "N of M" would be a made-up denominator.
 * "Completed" mirrors quiz-dates: terminal attempts (graded or
 * legacy-partial) count; `cancelled` and `inProgress` don't.
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
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

  const completions: Record<string, string[]> = {};
  for (const [date, names] of byDate) {
    completions[date] = [...names].sort();
  }

  return Response.json({ completions });
}
