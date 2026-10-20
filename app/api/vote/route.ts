import { currentUser } from "@/lib/auth";
import { dbUpsert } from "@/lib/db";
import { type Track } from "@/lib/content";
import { activePoll, readBallots, tallyOf, totalOf } from "@/lib/polls";

/**
 * The daily article vote — the TODAY'S READ — YOU DECIDE row
 * (components/VotePoll.tsx) on BOTH track indexes ("/" and "/junior").
 *
 *   GET  — the active poll (public) with the TOTAL ballots-cast count (public
 *          to everyone — participation, not preference), plus — for a
 *          logged-in caller — their own ballot and, once they've voted, the
 *          per-candidate tally. Counts only, never voter names (names are
 *          owner-side, via scripts/check-vote.mjs).
 *   POST — cast or change the caller's vote (login-gated; one login = one
 *          ballot, overwritten in place to change).
 *
 * Storage (Postgres): rc_polls holds the poll definition (written by
 * scripts/open-vote.mjs, never by this route); rc_ballots holds one row per
 * (poll, voter) — the PK, so one login = one vote and a change is an upsert.
 * Identity ALWAYS comes from the cookie, never the body.
 *
 * `track` is a LABEL from the request (GET `?track=`, POST body; default
 *  senior at this API boundary, like the quiz routes) — never identity. A
 *  forged track only points the caller at the junior poll, which any login may
 *  vote in anyway. The two tracks' polls are fully independent: each track's
 *  index shows only its own poll, and each closes on its own reading.
 *
 * Which poll is live (derived, never a flag) lives in lib/polls.ts, shared
 * with the index pages' server render of the vote row.
 */

/** "senior" | "junior" from an untrusted request value (default senior — the same boundary rule as the quiz routes). */
function parseTrack(v: unknown): Track {
  return v === "junior" ? "junior" : "senior";
}

export async function GET(request: Request) {
  try {
    const track = parseTrack(new URL(request.url).searchParams.get("track"));
    const poll = await activePoll(track);
    if (!poll) return Response.json({ active: false });

    const user = await currentUser();
    // The TOTAL ballots-cast count is public — everyone (logged in or not)
    // sees participation. The PER-CANDIDATE tally stays hidden until the
    // caller has voted (keeps the first vote un-herded): a bare total can't
    // herd anyone toward a candidate.
    const ballots = await readBallots(poll.id);
    const tally = tallyOf(poll, ballots);
    const totalVotes = totalOf(tally);
    const yourVote = user
      ? (ballots.find((b) => b.user === user)?.candidateId ?? null)
      : null;

    return Response.json({
      active: true,
      date: poll.date,
      candidates: poll.candidates,
      user,
      yourVote,
      totalVotes,
      ...(yourVote ? { tally } : {}),
    });
  } catch (err) {
    // The vote row is progressive enhancement on a static page — degrade to
    // "no poll" rather than erroring the home page's fetch.
    console.error("Loading the vote failed:", err);
    return Response.json({ active: false });
  }
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
  }

  let body: { date?: unknown; candidateId?: unknown; track?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const track = parseTrack(body.track);
  const date = String(body.date ?? "").trim();
  const candidateId = String(body.candidateId ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !candidateId) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    // Votable = this exact date is the track's live poll. Publishing the
    // reading (or a newer poll superseding this one) closes it — reject a
    // straggler cleanly.
    const poll = await activePoll(track);
    if (!poll || poll.date !== date) {
      return Response.json(
        { error: "Voting is closed for this poll." },
        { status: 409 }
      );
    }
    if (!poll.candidates.some((c) => c.id === candidateId)) {
      return Response.json({ error: "Unknown candidate." }, { status: 400 });
    }

    // Upsert on (poll_id, username) — change-vote overwrites in place.
    const ok = await dbUpsert(
      "rc_ballots",
      {
        poll_id: poll.id,
        username: user,
        candidate_id: candidateId,
        updated_at: new Date().toISOString(),
      },
      "poll_id,username"
    );
    if (!ok) {
      return Response.json(
        { error: "Could not save your vote." },
        { status: 502 }
      );
    }

    // Return the fresh tally so the UI can show it immediately.
    const ballots = await readBallots(poll.id);
    const tally = tallyOf(poll, ballots);
    return Response.json({
      ok: true,
      yourVote: candidateId,
      tally,
      totalVotes: totalOf(tally),
    });
  } catch (err) {
    console.error("Casting a vote failed:", err, "user:", user);
    return Response.json({ error: "Could not save your vote." }, { status: 502 });
  }
}
