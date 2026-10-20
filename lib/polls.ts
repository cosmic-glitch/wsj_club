import { dbSelect } from "@/lib/db";
import { getReading, type Track } from "@/lib/content";

/**
 * The daily vote's read side, shared by /api/vote (fresh, per request) and the
 * track index pages (ISR — `publicPoll` renders the live poll into the static
 * page so the vote row is there from the first paint instead of popping in
 * above the readings after a client fetch).
 *
 * "Active" is derived, never a flag: the track's NEWEST poll is live iff no
 * reading ON THAT TRACK is published for its date. Publishing the day's
 * reading (a push → deploy) is what closes the vote — there is no close step
 * to forget. A poll for a day that never got published is simply superseded
 * by the next one.
 */

export type VoteCandidate = {
  id: string;
  title: string;
  source: string; // "WSJ" | "Economist" | an enrichment source name — a display label, not an enum
  pitch: string;
  articleUrl: string;
  kind?: "news" | "enrichment"; // ballot section (absent = news); the modal groups by it but the poll stays ONE unified vote
};

/** The track's newest poll, with its DB row id. */
export type DbPoll = { id: string; date: string; candidates: VoteCandidate[] };

export type Ballot = { user: string; candidateId: string };

/** The public face of a live poll — what anyone, logged in or not, may see. */
export type PublicPoll = {
  date: string;
  candidates: VoteCandidate[];
  totalVotes: number;
};

type ReadOpts = { revalidate?: number };

export async function readBallots(
  pollId: string,
  opts: ReadOpts = {}
): Promise<Ballot[]> {
  const rows = await dbSelect(
    "rc_ballots",
    `?poll_id=eq.${encodeURIComponent(pollId)}&select=username,candidate_id`,
    opts
  );
  if (rows === null) throw new Error("ballot DB read failed");
  return rows.map((r) => ({
    user: String(r.username),
    candidateId: String(r.candidate_id),
  }));
}

/** Per-candidate counts (every candidate present, so the UI needn't null-check). Ballots for removed candidate ids are ignored. */
export function tallyOf(
  poll: DbPoll,
  ballots: Ballot[]
): Record<string, number> {
  const tally = Object.fromEntries(poll.candidates.map((c) => [c.id, 0]));
  for (const b of ballots) {
    if (b.candidateId in tally) tally[b.candidateId] += 1;
  }
  return tally;
}

export function totalOf(tally: Record<string, number>): number {
  return Object.values(tally).reduce((a, b) => a + b, 0);
}

/** The track's newest poll if it's live (no published reading on that track for its date). */
export async function activePoll(
  track: Track,
  opts: ReadOpts = {}
): Promise<DbPoll | null> {
  const rows = await dbSelect(
    "rc_polls",
    `?track=eq.${track}&select=id,date,candidates&order=date.desc&limit=1`,
    opts
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

/**
 * The live poll's public fields for an ISR render (cached `revalidate`
 * seconds, matching the page's own window). Never throws: a failed read
 * renders the page without the row, and VotePoll's client fetch still
 * brings it in.
 */
export async function publicPoll(
  track: Track,
  revalidate: number
): Promise<PublicPoll | null> {
  try {
    const poll = await activePoll(track, { revalidate });
    if (!poll) return null;
    const ballots = await readBallots(poll.id, { revalidate });
    return {
      date: poll.date,
      candidates: poll.candidates,
      totalVotes: totalOf(tallyOf(poll, ballots)),
    };
  } catch (err) {
    console.error("Rendering the vote row failed:", err);
    return null;
  }
}
