import { dbSelect } from "@/lib/db";
import { getReading, type Track } from "@/lib/content";

/**
 * The daily vote's read side, for /api/vote (the owner's /vote page).
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
  review?: CandidateReview; // OWNER ONLY — /api/vote strips it for anyone else
};

/**
 * The autopilot's reasoning for one candidate (written by .bot/open-vote.mjs;
 * absent on hand-opened polls). Shown only on the owner's /vote page — it
 * replaced the long 6am DM. The ballot is stored in the vote skill's rank
 * order, so the first candidate is its top pick.
 */
export type CandidateReview = {
  rating?: number; // 1–10
  why?: string;
  homepageRank?: number; // Economist homepage position (1 = the lead)
  words?: number;
  fkGrade?: number; // kids: measured reading grade
  ballotNotes?: string; // ballot-wide remarks, stored on the first candidate only (rc_polls has no notes column)
};

/** The track's newest poll, with its DB row id. */
export type DbPoll = { id: string; date: string; candidates: VoteCandidate[] };

/** The poll as anyone but the owner may see it: no reviews, no notes. */
export function publicCandidates(candidates: VoteCandidate[]): VoteCandidate[] {
  return candidates.map((c) => {
    const pub = { ...c };
    delete pub.review;
    return pub;
  });
}

/** The ballot-wide notes (kept on the first candidate's review). */
export function ballotNotesOf(candidates: VoteCandidate[]): string | null {
  return candidates[0]?.review?.ballotNotes ?? null;
}

export type Ballot = { user: string; candidateId: string };

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
