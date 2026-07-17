#!/usr/bin/env node
/**
 * Check the day's article vote: read `votes/[junior/]<date>/poll.json` plus
 * every ballot from Vercel Blob and print the tally — per-candidate counts
 * WITH voter names (owner-side only; the website shows counts, never names) —
 * and the winner with its article link, ready to hand to the wsj-reading (or
 * wsj-reading-junior) skill. Part of the wsj-check-vote skill;
 * scripts/open-vote.mjs opens the poll.
 *
 * Usage:
 *   node --env-file=.env.local scripts/check-vote.mjs [YYYY-MM-DD] [--track=junior]
 *
 * With no date it checks the track's newest poll. Ties are listed for the
 * owner to break by just picking one (the vote is advisory by construction).
 */
import fs from "node:fs";
import { list } from "@vercel/blob";

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("Missing BLOB_READ_WRITE_TOKEN. Run with: node --env-file=.env.local scripts/check-vote.mjs ...");
  process.exit(1);
}

const argv = process.argv.slice(2);
const trackFlag = argv.find((a) => a.startsWith("--track="));
const track = trackFlag ? trackFlag.slice("--track=".length) : "senior";
const arg = argv.find((a) => !a.startsWith("--"));

if (arg && !/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
  console.error("Usage: node --env-file=.env.local scripts/check-vote.mjs [YYYY-MM-DD] [--track=junior]");
  process.exit(1);
}
if (track !== "senior" && track !== "junior") {
  console.error(`Unknown track "${track}" — use --track=junior (or omit for senior).`);
  process.exit(1);
}

const junior = track === "junior";
// The junior/ path segment, in lockstep with open-vote.mjs / app/api/vote.
const votesBase = junior ? "votes/junior/" : "votes/";

let date = arg;
if (!date) {
  const { folders } = await list({ prefix: votesBase, mode: "folded" });
  // Anchored to the base so the senior listing never reads the votes/junior/
  // folder (no date in it anyway) as a poll.
  const re = new RegExp(`^${votesBase}(\\d{4}-\\d{2}-\\d{2})/$`);
  date = (folders ?? [])
    .map((f) => re.exec(f)?.[1])
    .filter(Boolean)
    .sort()
    .pop();
  if (!date) {
    console.error(`No ${track} polls found in Blob. Open one with scripts/open-vote.mjs first.`);
    process.exit(1);
  }
}

// Blob URLs are CDN-cached and these blobs are overwritten in place, so every
// read gets a unique ?v= buster (same recipe as lib/session-io.ts's readSlot).
async function fetchJson(url) {
  const res = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch failed (${res.status}) for ${url}`);
  return res.json();
}

const votesDir = `${votesBase}${date}/`;
const { blobs } = await list({ prefix: votesDir });
const pollBlob = blobs.find((b) => b.pathname === `${votesDir}poll.json`);
if (!pollBlob) {
  console.error(`No ${track} poll found for ${date}.`);
  process.exit(1);
}
const poll = await fetchJson(pollBlob.url);

const ballots = (
  await Promise.all(
    blobs
      .filter((b) => b.pathname.startsWith(`${votesDir}ballots/`))
      .map(async (b) => {
        try {
          const ballot = await fetchJson(b.url);
          return typeof ballot?.user === "string" && typeof ballot?.candidateId === "string"
            ? ballot
            : null;
        } catch {
          return null;
        }
      })
  )
).filter(Boolean);

const published = fs.existsSync(
  junior ? `content/junior/${date}.json` : `content/${date}.json`
);
console.log(`Vote for ${date}${junior ? " (junior)" : ""} — ${published ? "CLOSED (reading published)" : "still live"}`);
console.log(`${ballots.length} ballot(s) cast\n`);

const byCandidate = new Map(poll.candidates.map((c) => [c.id, []]));
const orphans = [];
for (const b of ballots) {
  (byCandidate.get(b.candidateId) ?? orphans).push(b.user);
}

const ranked = poll.candidates
  .map((c) => ({ ...c, voters: byCandidate.get(c.id) }))
  .sort((a, b) => b.voters.length - a.voters.length);

for (const c of ranked) {
  console.log(`  ${String(c.voters.length).padStart(2)}  [${c.source}${c.kind === "enrichment" ? " · enrichment" : ""}] ${c.title}`);
  console.log(`      ${c.articleUrl}`);
  console.log(`      voters: ${c.voters.length ? c.voters.sort().join(", ") : "—"}\n`);
}
if (orphans.length) {
  console.log(`  (${orphans.length} ballot(s) for candidates no longer in the poll: ${orphans.sort().join(", ")})\n`);
}

const top = ranked[0]?.voters.length ?? 0;
const winners = ranked.filter((c) => c.voters.length === top && top > 0);
const readingSkill = junior ? "wsj-reading-junior" : "wsj-reading";
if (winners.length === 1) {
  console.log(`WINNER: [${winners[0].source}${winners[0].kind === "enrichment" ? " · enrichment" : ""}] ${winners[0].title}`);
  console.log(`  ${winners[0].articleUrl}`);
  console.log(`\nNext: run the ${readingSkill} skill with that link (it sets clubPick: true itself; publishing closes the poll).`);
} else if (winners.length > 1) {
  console.log(`TIE at ${top} vote(s) between: ${winners.map((c) => c.title).join(" / ")}`);
  console.log(`You break the tie — just pick one and run ${readingSkill} with its link.`);
} else {
  console.log("No votes cast yet.");
}
