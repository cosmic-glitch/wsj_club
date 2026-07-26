import { put } from "@vercel/blob";
import { currentUser } from "@/lib/auth";
import { dbSelect, dbUpsert } from "@/lib/db";
import { getReading, type Track } from "@/lib/content";
import { safeNameOf } from "@/lib/session-io";

/**
 * The daily article vote ("club pick") — the TODAY'S READ — YOU DECIDE row
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
 * Storage (Vercel Blob, same store as the quiz sessions), track-prefixed the
 * same way as everything else junior (only junior takes a path segment):
 *   votes/[junior/]<date>/poll.json      — the poll definition (written by
 *                                          scripts/open-vote.mjs, never by this
 *                                          route)
 *   votes/[junior/]<date>/ballots/<safeName>.json
 *                                        — one blob per voter. Identity ALWAYS
 *                                          comes from the cookie — the pathname
 *                                          is overwritable, so a body-derived
 *                                          name could stomp another voter.
 *
 * `track` is a LABEL from the request (GET `?track=`, POST body; default
 *  senior at this API boundary, like the quiz routes) — never identity. A
 *  forged track only points the caller at the junior poll, which any login may
 *  vote in anyway. The two tracks' polls are fully independent: each track's
 *  index shows only its own poll, and each closes on its own reading.
 *
 * "Active" is derived, never a flag: the track's NEWEST poll is live iff no
 * reading ON THAT TRACK is published for its date. Publishing the day's
 * reading (a push → deploy) is what closes the vote — there is no close step
 * to forget. A poll for a day that never got published is simply superseded by
 * the next one. (The senior folded list is blind to junior polls: they live a
 * level deeper, so folding `votes/` shows them only as one `votes/junior/`
 * folder, which the date regex ignores.)
 */

type VoteCandidate = {
  id: string;
  title: string;
  source: string; // "WSJ" | "Economist" | an enrichment source name — a display label, not an enum
  pitch: string;
  articleUrl: string;
  kind?: "news" | "enrichment"; // ballot section (absent = news); the modal groups by it but the poll stays ONE unified vote
};

type VotePoll = { date: string; openedAt?: string; candidates: VoteCandidate[] };

type Ballot = { user: string; candidateId: string; votedAt?: string };

/** "senior" | "junior" from an untrusted request value (default senior — the same boundary rule as the quiz routes). */
function parseTrack(v: unknown): Track {
  return v === "junior" ? "junior" : "senior";
}

/**
 * The track's vote directory in Blob. `track` is REQUIRED on this and every
 * helper below (no "senior" default) — the sessionPrefix rule: a defaulted
 * helper would silently compute the senior path at a junior call site.
 */
function votesDir(track: Track, date: string): string {
  return track === "junior" ? `votes/junior/${date}/` : `votes/${date}/`;
}

function ballotPrefix(track: Track, date: string): string {
  return `${votesDir(track, date)}ballots/`;
}

// Phase 3 read flip (PLAN-supabase.md): polls + ballots are READ from
// rc_polls / rc_ballots (single queries, consistent reads — the vote-blob
// CDN cache-busting died here). The ballot WRITE below still dual-targets:
// the Blob ballot first (Blob stays the store of record until Phase 4), then
// the rc_ballots upsert the tally reads.

/** The track's newest poll, with its DB row id. */
type DbPoll = VotePoll & { id: string };

async function readBallots(pollId: string): Promise<Ballot[]> {
  const rows = await dbSelect(
    "rc_ballots",
    `?poll_id=eq.${encodeURIComponent(pollId)}&select=username,candidate_id`
  );
  if (rows === null) throw new Error("ballot DB read failed");
  return rows.map((r) => ({
    user: String(r.username),
    candidateId: String(r.candidate_id),
  }));
}

/** Per-candidate counts (every candidate present, so the UI needn't null-check). Ballots for removed candidate ids are ignored. */
function tallyOf(poll: VotePoll, ballots: Ballot[]): Record<string, number> {
  const tally = Object.fromEntries(poll.candidates.map((c) => [c.id, 0]));
  for (const b of ballots) {
    if (b.candidateId in tally) tally[b.candidateId] += 1;
  }
  return tally;
}

/** The track's newest poll if it's live (no published reading on that track for its date). */
async function activePoll(track: Track): Promise<DbPoll | null> {
  const rows = await dbSelect(
    "rc_polls",
    `?track=eq.${track}&select=id,date,candidates&order=date.desc&limit=1`
  );
  if (rows === null) throw new Error("poll DB read failed");
  const r = rows[0];
  if (!r) return null;
  const date = String(r.date);
  if (getReading(date, track)) return null;
  const candidates = r.candidates as VoteCandidate[];
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return { id: String(r.id), date, candidates };
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
    const totalVotes = Object.values(tally).reduce((a, b) => a + b, 0);
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

    const ballot: Ballot = {
      user,
      candidateId,
      votedAt: new Date().toISOString(),
    };
    await put(
      `${ballotPrefix(track, date)}${safeNameOf(user)}.json`,
      JSON.stringify(ballot, null, 2),
      {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      }
    );
    // Mirror the ballot into rc_ballots — the store the tally reads. Upsert on
    // (poll_id, username), so change-vote overwrites in place. Best-effort:
    // the overlay below covers the response even if this write failed.
    await dbUpsert(
      "rc_ballots",
      {
        poll_id: poll.id,
        username: user,
        candidate_id: candidateId,
        updated_at: ballot.votedAt,
      },
      "poll_id,username"
    );

    // Return the fresh tally so the UI can show it immediately, overlaying the
    // caller's own ballot in case the upsert above failed or lagged.
    const ballots = (await readBallots(poll.id)).filter(
      (b) => b.user !== user
    );
    ballots.push(ballot);
    const tally = tallyOf(poll, ballots);
    return Response.json({
      ok: true,
      yourVote: candidateId,
      tally,
      totalVotes: Object.values(tally).reduce((a, b) => a + b, 0),
    });
  } catch (err) {
    console.error("Casting a vote failed:", err, "user:", user);
    return Response.json({ error: "Could not save your vote." }, { status: 502 });
  }
}
