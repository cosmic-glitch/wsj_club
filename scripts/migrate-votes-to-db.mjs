#!/usr/bin/env node
/**
 * One-time (re-runnable) backfill: votes/[junior/]<date>/ polls + ballots →
 * rc_polls + rc_ballots. Idempotent — polls upsert on (track, date), ballots
 * on (poll_id, username). Backfills ALL historical polls (the participation
 * record); at minimum this must run once during Phase 1 so a live poll's
 * ballots have their rc_polls row to shadow into.
 *
 * Usage: node --env-file=.env.local scripts/migrate-votes-to-db.mjs [--dry-run]
 */
import { list } from "@vercel/blob";
import { dbSelect, dbUpsert, fetchBlobJson } from "./db-rest.mjs";

const DRY_RUN = process.argv.includes("--dry-run");

const POLL_RE = /^votes\/(junior\/)?(\d{4}-\d{2}-\d{2})\/poll\.json$/;
const BALLOT_RE = /^votes\/(junior\/)?(\d{4}-\d{2}-\d{2})\/ballots\/[^/]+\.json$/;

const blobs = [];
let cursor;
do {
  const page = await list({ prefix: "votes/", cursor });
  blobs.push(...page.blobs);
  cursor = page.cursor;
} while (cursor);

const polls = blobs.filter((b) => POLL_RE.test(b.pathname));
let ballotCount = 0;

for (const pollBlob of polls) {
  const [, junior, date] = POLL_RE.exec(pollBlob.pathname);
  const track = junior ? "junior" : "senior";
  const poll = await fetchBlobJson(pollBlob.url);
  if (!Array.isArray(poll?.candidates)) {
    console.warn(`skipping malformed poll: ${pollBlob.pathname}`);
    continue;
  }
  if (DRY_RUN) {
    console.log(`would upsert poll ${track} ${date} (${poll.candidates.length} candidates)`);
  } else {
    await dbUpsert(
      "rc_polls",
      {
        track,
        date,
        candidates: poll.candidates,
        ...(poll.openedAt ? { created_at: poll.openedAt } : {}),
      },
      "track,date"
    );
  }

  const ballotBlobs = blobs.filter((b) => {
    const m = BALLOT_RE.exec(b.pathname);
    return m && (m[1] ? "junior" : "senior") === track && m[2] === date;
  });
  if (!ballotBlobs.length) {
    console.log(`✓ poll ${track} ${date} (no ballots)`);
    continue;
  }

  let pollId = null;
  if (!DRY_RUN) {
    const rows = await dbSelect("rc_polls", `?track=eq.${track}&date=eq.${date}&select=id`);
    pollId = rows[0]?.id;
    if (!pollId) throw new Error(`rc_polls row missing after upsert: ${track} ${date}`);
  }

  for (const b of ballotBlobs) {
    const ballot = await fetchBlobJson(b.url).catch(() => null);
    if (typeof ballot?.user !== "string" || typeof ballot?.candidateId !== "string") {
      console.warn(`skipping malformed ballot: ${b.pathname}`);
      continue;
    }
    if (!DRY_RUN) {
      await dbUpsert(
        "rc_ballots",
        {
          poll_id: pollId,
          username: ballot.user,
          candidate_id: ballot.candidateId,
          ...(ballot.votedAt ? { updated_at: ballot.votedAt } : {}),
        },
        "poll_id,username"
      );
    }
    ballotCount++;
  }
  console.log(`✓ poll ${track} ${date} (${ballotBlobs.length} ballots)`);
}

console.log(
  `${DRY_RUN ? "Dry run — would backfill" : "Backfilled"} ${polls.length} polls + ${ballotCount} ballots`
);
