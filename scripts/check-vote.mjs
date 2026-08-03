#!/usr/bin/env node
/**
 * Check the day's article vote: read the poll and every ballot from the DB
 * (rc_polls / rc_ballots) and print the tally — per-candidate counts WITH
 * voter names (owner-side only; the website shows counts, never names) — and
 * the winner with its article link, ready to hand to the wsj-reading (or
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
import { dbSelect } from "./db-rest.mjs";

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

const filter = arg ? `&date=eq.${arg}` : "";
const polls = await dbSelect(
  "rc_polls",
  `?track=eq.${track}${filter}&select=id,date,candidates&order=date.desc&limit=1`
);
const poll = polls[0];
if (!poll) {
  console.error(
    arg
      ? `No ${track} poll found for ${arg}.`
      : `No ${track} polls found. Open one with scripts/open-vote.mjs first.`
  );
  process.exit(1);
}
const date = poll.date;

const ballots = (
  await dbSelect(
    "rc_ballots",
    `?poll_id=eq.${poll.id}&select=username,candidate_id`
  )
).map((r) => ({ user: r.username, candidateId: r.candidate_id }));

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
  console.log(`\nNext: run the ${readingSkill} skill with that link (publishing closes the poll).`);
} else if (winners.length > 1) {
  console.log(`TIE at ${top} vote(s) between: ${winners.map((c) => c.title).join(" / ")}`);
  console.log(`You break the tie — just pick one and run ${readingSkill} with its link.`);
} else {
  console.log("No votes cast yet.");
}
