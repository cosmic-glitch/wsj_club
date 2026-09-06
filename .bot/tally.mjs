// Read the day's vote from the Hetzner box and decide the winner — the
// autonomous cousin of scripts/check-vote.mjs. Writes nothing; reads rc_polls /
// rc_ballots directly over SUPABASE_DB_URL (the box has no PostgREST keys, the
// same reason .bot/open-vote.mjs exists).
//
//   node --env-file=.env.local .bot/tally.mjs [YYYY-MM-DD] [--track=senior] [--field=<path>]
//
// Human-readable tally (WITH voter names — owner-side only) goes to stderr;
// a JSON verdict goes to stdout for the auto-publish skill to consume:
//   { track, date, pollId, published, ballots, candidates: [{ id, title, source,
//     articleUrl, votes, voters }], winner: { id, title, source, articleUrl, votes },
//     winnerReason }
//
// Winner rules (the vote is advisory, so ties need a deterministic breaker):
//   1. most ballots wins;
//   2. a tie is broken by the auto-vote run's own ratings — the ranked field it
//      saved to .bot/state/<date>-field.json (junior: <date>-junior-field.json;
//      --field overrides the path) —
//      highest-rated tied candidate wins;
//   3. no ballots at all → the field's top-rated candidate (the morning's TOP
//      PICK); with no field file, ballot order (which IS the bot's rank order).
// Exits 1 if there is no poll for the date, 2 if the reading is already
// published (the poll is closed — nothing to publish).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { normalizeUrl, normalizeTitle } from "./published.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

const argv = process.argv.slice(2);
const dateArg = argv.find((a) => !a.startsWith("--"));
const trackFlag = argv.find((a) => a.startsWith("--track="));
const track = trackFlag ? trackFlag.slice("--track=".length) : "senior";
const fieldFlag = argv.find((a) => a.startsWith("--field="));

if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  console.error("Usage: node --env-file=.env.local .bot/tally.mjs [YYYY-MM-DD] [--track=junior] [--field=<ranked-field.json>]");
  process.exit(1);
}
if (track !== "senior" && track !== "junior") {
  console.error(`Unknown track "${track}".`);
  process.exit(1);
}

const conn = process.env.SUPABASE_DB_URL;
if (!conn) {
  console.error("SUPABASE_DB_URL not set (run with --env-file=.env.local).");
  process.exit(1);
}

const client = new pg.Client({ connectionString: conn });
await client.connect();
let poll, ballots;
try {
  const polls = await client.query(
    dateArg
      ? "select id, date::text as date, candidates from rc_polls where track=$1 and date=$2 order by date desc limit 1"
      : "select id, date::text as date, candidates from rc_polls where track=$1 order by date desc limit 1",
    dateArg ? [track, dateArg] : [track],
  );
  poll = polls.rows[0];
  if (!poll) {
    console.error(dateArg ? `No ${track} poll found for ${dateArg}.` : `No ${track} polls found.`);
    process.exit(1);
  }
  ballots = (await client.query("select username, candidate_id from rc_ballots where poll_id=$1", [poll.id])).rows;
} finally {
  await client.end();
}

const date = poll.date;
const contentPath = path.join(REPO_ROOT, track === "junior" ? `content/junior/${date}.json` : `content/${date}.json`);
const published = fs.existsSync(contentPath);

const byCandidate = new Map(poll.candidates.map((c) => [c.id, []]));
const orphans = [];
for (const b of ballots) (byCandidate.get(b.candidate_id) ?? orphans).push(b.username);

// The morning run's ranked field (ratings), matched by URL then title.
const fieldPath = fieldFlag ? fieldFlag.slice("--field=".length) : path.join(HERE, "state", `${date}-${track === "junior" ? "junior-" : ""}field.json`);
let field = null;
if (fs.existsSync(fieldPath)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(fieldPath, "utf8"));
    field = Array.isArray(parsed) ? parsed : parsed.ranked;
    if (!Array.isArray(field)) field = null;
  } catch {
    field = null;
  }
}
const ratingOf = (c) => {
  if (!field) return null;
  const hit = field.find(
    (f) => (f.articleUrl && normalizeUrl(f.articleUrl) === normalizeUrl(c.articleUrl)) || (f.title && normalizeTitle(f.title) === normalizeTitle(c.title)),
  );
  return hit && Number.isFinite(+hit.rating) ? +hit.rating : null;
};

const candidates = poll.candidates.map((c, i) => ({
  id: c.id,
  title: c.title,
  source: c.source,
  articleUrl: c.articleUrl,
  kind: c.kind ?? "news",
  order: i,
  rating: ratingOf(c),
  voters: (byCandidate.get(c.id) ?? []).slice().sort(),
  votes: (byCandidate.get(c.id) ?? []).length,
}));

// Sort: votes desc, then rating desc (nulls last), then ballot order.
const ranked = candidates.slice().sort((a, b) => b.votes - a.votes || (b.rating ?? -1) - (a.rating ?? -1) || a.order - b.order);
const top = ranked[0];
const tied = ranked.filter((c) => c.votes === top.votes);
let winnerReason;
if (ballots.length === 0) {
  winnerReason = field ? "no ballots — the morning run's top-rated pick" : "no ballots — first candidate on the ballot";
} else if (tied.length > 1) {
  const hasRatings = tied.some((c) => c.rating !== null);
  winnerReason = hasRatings
    ? `tie at ${top.votes} among ${tied.length} — broken by the morning run's rating (${top.rating}/10)`
    : `tie at ${top.votes} among ${tied.length} — broken by ballot order (no ratings file)`;
} else {
  winnerReason = `most votes (${top.votes} of ${ballots.length})`;
}

// --- Human tally → stderr (voter names: owner-side only) -------------------
console.error(`Vote for ${date}${track === "junior" ? " (junior)" : ""} — ${published ? "CLOSED (reading published)" : "still live"}`);
console.error(`${ballots.length} ballot(s) cast${field ? "" : " · no ranked-field file (" + path.relative(REPO_ROOT, fieldPath) + ")"}\n`);
for (const c of ranked) {
  console.error(`  ${String(c.votes).padStart(2)}  [${c.source}] ${c.title}${c.rating !== null ? `  (bot ${c.rating}/10)` : ""}`);
  console.error(`      ${c.articleUrl}`);
  console.error(`      voters: ${c.voters.length ? c.voters.join(", ") : "—"}\n`);
}
if (orphans.length) console.error(`  (${orphans.length} ballot(s) for candidates no longer in the poll: ${orphans.sort().join(", ")})\n`);
console.error(`WINNER: [${top.source}] ${top.title} — ${winnerReason}\n${top.articleUrl}`);

// --- JSON verdict → stdout ---------------------------------------------------
process.stdout.write(
  JSON.stringify(
    {
      track,
      date,
      pollId: poll.id,
      published,
      ballots: ballots.length,
      candidates: ranked.map(({ order, ...c }) => c),
      winner: { id: top.id, title: top.title, source: top.source, articleUrl: top.articleUrl, votes: top.votes, rating: top.rating },
      runnerUp: ranked[1] ? { title: ranked[1].title, votes: ranked[1].votes } : null,
      winnerReason,
    },
    null,
    2,
  ) + "\n",
);
if (published) process.exit(2);
