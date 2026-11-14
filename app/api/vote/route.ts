import { currentUser, isOwner } from "@/lib/auth";
import { dbUpsert } from "@/lib/db";
import { parseTrack } from "@/lib/track";
import { activePoll, ballotNotesOf, publicCandidates, readBallots, tallyOf, totalOf } from "@/lib/polls";

/**
 * The daily article vote — OWNER ONLY (owner's rule: nobody else voted, so
 * the vote left the home page). The owner votes on /vote
 * (components/OwnerVote.tsx), linked from the 6am autopilot DM.
 *
 *   GET  — the track's live poll: `active`, `date`, `candidates` for anyone
 *          (the autopilot's outcome check and the vote skills read it to
 *          confirm a poll opened; the site shows it to nobody), with each
 *          candidate's `review` stripped. The owner also gets the reviews,
 *          the ballot notes, their own ballot and the tally.
 *   POST — cast or change the owner's vote (one ballot per poll, overwritten
 *          in place). Anyone else gets 403.
 *
 * Storage (Postgres): rc_polls holds the poll definition (written by
 * scripts/open-vote.mjs / .bot/open-vote.mjs, never by this route); rc_ballots
 * one row per (poll, voter) — the PK. The tally scripts count every ballot;
 * the owner's is the only one this route accepts now. Identity ALWAYS comes
 * from the cookie, never the body; `track` is only a label.
 *
 * Which poll is live (derived, never a flag) lives in lib/polls.ts.
 */

export async function GET(request: Request) {
  try {
    const track = parseTrack(new URL(request.url).searchParams.get("track"));
    const poll = await activePoll(track);
    if (!poll) return Response.json({ active: false });

    const user = await currentUser();
    if (!isOwner(user)) {
      return Response.json({ active: true, date: poll.date, candidates: publicCandidates(poll.candidates) });
    }
    const ballots = await readBallots(poll.id);
    const tally = tallyOf(poll, ballots);
    return Response.json({
      active: true,
      date: poll.date,
      candidates: poll.candidates,
      notes: ballotNotesOf(poll.candidates),
      user,
      yourVote: ballots.find((b) => b.user === user)?.candidateId ?? null,
      tally,
      totalVotes: totalOf(tally),
    });
  } catch (err) {
    // Degrade to "no poll" rather than erroring.
    console.error("Loading the vote failed:", err);
    return Response.json({ active: false });
  }
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
  }
  if (!isOwner(user)) {
    return Response.json({ error: "Only the club owner votes." }, { status: 403 });
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
