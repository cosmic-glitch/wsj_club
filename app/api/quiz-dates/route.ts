import { currentUser } from "@/lib/auth";
import { loadSessions } from "@/lib/sessions";
import { loadMarksFor, bankDates } from "@/lib/marks";
import type { Track } from "@/lib/content";

/**
 * GET /api/quiz-dates?track= — the dates whose words are in the CALLER's
 * word bank on a track: readings they've completed the voice quiz on OR
 * marked the handout done (a silver medal — reading the handout is what
 * earns its words). The Word Bank page's personal filter.
 *
 * Identity always comes from the cookie — there is no way to request another
 * user's dates. `track` is just a label (default senior at the boundary, like
 * every quiz route). "Completed" mirrors the student's own Reports view:
 * terminal attempts (graded or legacy-partial) count; a `cancelled` attempt
 * doesn't (the student was told it won't count), nor does an `inProgress`
 * slot (the quiz isn't done — its words join the bank when it is). The rule
 * itself is lib/marks.ts bankDates, shared with the word-quiz round builder.
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

  const [sessions, marks] = await Promise.all([loadSessions(), loadMarksFor(user, track)]);
  if (!Array.isArray(sessions)) {
    return Response.json({ error: sessions.error }, { status: 500 });
  }

  const dates = [...bankDates(sessions, marks ?? [], user, track)].sort();

  return Response.json({ dates });
}
