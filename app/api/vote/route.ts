import { list, put } from "@vercel/blob";
import { currentUser } from "@/lib/auth";
import { getReading } from "@/lib/content";
import { safeNameOf } from "@/lib/session-io";

/**
 * The daily article vote ("club pick") — the home page's TODAY'S READ — YOU
 * DECIDE row (components/VotePoll.tsx).
 *
 *   GET  — the active poll (public), plus — for a logged-in caller — their own
 *          ballot and, once they've voted, the tally. Counts only, never voter
 *          names (names are owner-side, via scripts/check-vote.mjs).
 *   POST — cast or change the caller's vote (login-gated; one login = one
 *          ballot, overwritten in place to change).
 *
 * Storage (Vercel Blob, same store as the quiz sessions):
 *   votes/<date>/poll.json               — the poll definition (written by
 *                                          scripts/open-vote.mjs, never by this
 *                                          route)
 *   votes/<date>/ballots/<safeName>.json — one blob per voter. Identity ALWAYS
 *                                          comes from the cookie — the pathname
 *                                          is overwritable, so a body-derived
 *                                          name could stomp another voter.
 *
 * "Active" is derived, never a flag: the NEWEST poll is live iff no senior
 * reading is published for its date. Publishing the day's reading (a push →
 * deploy) is what closes the vote — there is no close step to forget. A poll
 * for a day that never got published is simply superseded by the next day's.
 */

type VoteCandidate = {
  id: string;
  title: string;
  source: string; // "WSJ" | "Economist" — a display label, not an enum
  pitch: string;
  articleUrl: string;
};

type VotePoll = { date: string; openedAt?: string; candidates: VoteCandidate[] };

type Ballot = { user: string; candidateId: string; votedAt?: string };

function pollPathname(date: string): string {
  return `votes/${date}/poll.json`;
}

function ballotPrefix(date: string): string {
  return `votes/${date}/ballots/`;
}

/**
 * Fetch a vote blob's JSON, forcing a CDN miss with a unique `?v=` per read.
 * Both the poll (re-run of open-vote.mjs) and the ballots (a changed vote) are
 * overwritten in place, and the public Blob URL is edge-cached — a plain
 * `no-store` fetch can serve the pre-overwrite copy (same lesson as
 * lib/session-io.ts's readSlot). Vote reads are light, so skipping the CDN
 * costs nothing.
 */
async function fetchVoteJson<T>(url: string): Promise<T> {
  const res = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`vote blob fetch failed (${res.status})`);
  return (await res.json()) as T;
}

/** The date of the newest poll ever opened, or null. Folded list → one folder per poll day, so this stays one cheap call as polls accumulate. */
async function newestPollDate(): Promise<string | null> {
  const { folders } = await list({ prefix: "votes/", mode: "folded" });
  const dates = (folders ?? [])
    .map((f) => /votes\/(\d{4}-\d{2}-\d{2})\/$/.exec(f)?.[1])
    .filter((d): d is string => Boolean(d));
  return dates.sort().pop() ?? null;
}

async function readPoll(date: string): Promise<VotePoll | null> {
  const target = pollPathname(date);
  const { blobs } = await list({ prefix: target });
  const blob = blobs.find((b) => b.pathname === target);
  if (!blob) return null;
  const poll = await fetchVoteJson<VotePoll>(blob.url);
  if (!Array.isArray(poll?.candidates) || poll.candidates.length === 0) return null;
  return poll;
}

async function readBallots(date: string): Promise<Ballot[]> {
  const { blobs } = await list({ prefix: ballotPrefix(date) });
  const ballots = await Promise.all(
    blobs.map(async (b) => {
      try {
        const ballot = await fetchVoteJson<Ballot>(b.url);
        return typeof ballot?.user === "string" &&
          typeof ballot?.candidateId === "string"
          ? ballot
          : null;
      } catch {
        return null; // one corrupt ballot must not blank the poll
      }
    })
  );
  return ballots.filter((b): b is Ballot => b !== null);
}

/** Per-candidate counts (every candidate present, so the UI needn't null-check). Ballots for removed candidate ids are ignored. */
function tallyOf(poll: VotePoll, ballots: Ballot[]): Record<string, number> {
  const tally = Object.fromEntries(poll.candidates.map((c) => [c.id, 0]));
  for (const b of ballots) {
    if (b.candidateId in tally) tally[b.candidateId] += 1;
  }
  return tally;
}

/** The newest poll if it's live (no published senior reading on its date). */
async function activePoll(): Promise<VotePoll | null> {
  const date = await newestPollDate();
  if (!date || getReading(date)) return null;
  return readPoll(date);
}

export async function GET() {
  try {
    const poll = await activePoll();
    if (!poll) return Response.json({ active: false });

    const user = await currentUser();
    let yourVote: string | null = null;
    let tally: Record<string, number> | undefined;
    if (user) {
      // The tally is shown only once the caller has voted (keeps the first
      // vote un-herded), so ballots are read only for a voter.
      const ballots = await readBallots(poll.date);
      yourVote = ballots.find((b) => b.user === user)?.candidateId ?? null;
      if (yourVote) tally = tallyOf(poll, ballots);
    }

    return Response.json({
      active: true,
      date: poll.date,
      candidates: poll.candidates,
      user,
      yourVote,
      ...(tally ? { tally } : {}),
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

  let body: { date?: unknown; candidateId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const date = String(body.date ?? "").trim();
  const candidateId = String(body.candidateId ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !candidateId) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    // Votable = this exact date is the live poll. Publishing the reading (or a
    // newer poll superseding this one) closes it — reject a straggler cleanly.
    const poll = await activePoll();
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
      `${ballotPrefix(date)}${safeNameOf(user)}.json`,
      JSON.stringify(ballot, null, 2),
      {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      }
    );

    // Return the fresh tally so the UI can show it immediately. list() can lag
    // a just-created blob by a few seconds, so overlay the caller's own ballot
    // in case the listing hasn't caught up yet.
    const ballots = (await readBallots(date)).filter((b) => b.user !== user);
    ballots.push(ballot);
    return Response.json({
      ok: true,
      yourVote: candidateId,
      tally: tallyOf(poll, ballots),
    });
  } catch (err) {
    console.error("Casting a vote failed:", err, "user:", user);
    return Response.json({ error: "Could not save your vote." }, { status: 502 });
  }
}
