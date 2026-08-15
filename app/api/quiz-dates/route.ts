import { currentUser } from "@/lib/auth";
import { loadSessions } from "@/lib/sessions";
import { completedQuizDates } from "@/lib/word-quiz";
import type { Track } from "@/lib/content";

/**
 * GET /api/quiz-dates?track= — the dates of the CALLER's own completed
 * voice-quiz sessions on a track, for the Word Bank (a student's bank holds
 * only the words from readings they've actually quizzed on).
 *
 * Identity always comes from the cookie — there is no way to request another
 * user's dates. `track` is just a label (default senior at the boundary, like
 * every quiz route). "Completed" mirrors the student's own Reports view:
 * terminal attempts (graded or legacy-partial) count; a `cancelled` attempt
 * doesn't (the student was told it won't count), nor does an `inProgress`
 * slot (the quiz isn't done — its words join the bank when it is).
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

  const dates = [...completedQuizDates(sessions, user, track)].sort();

  return Response.json({ dates });
}
