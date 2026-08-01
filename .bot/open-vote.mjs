// Open (or re-open) the day's senior vote from the Hetzner box, writing to
// Postgres directly via SUPABASE_DB_URL — the box's minimal ops env has no
// PostgREST keys, so the canonical scripts/open-vote.mjs can't run here. This
// mirrors that script's validation, slugify, and upsert semantics exactly.
//   node --env-file=.env.local .bot/open-vote.mjs <YYYY-MM-DD> <candidates.json> [--dry-run]
import fs from "node:fs";
import pg from "pg";

const argv = process.argv.slice(2);
const [date, file] = argv.filter((a) => !a.startsWith("--"));
const dryRun = argv.includes("--dry-run");
const trackFlag = argv.find((a) => a.startsWith("--track="));
const track = trackFlag ? trackFlag.slice("--track=".length) : "senior";

if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("Usage: node --env-file=.env.local .bot/open-vote.mjs <YYYY-MM-DD> <candidates.json> [--track=junior] [--dry-run]");
  process.exit(1);
}
if (track !== "senior" && track !== "junior") {
  console.error(`Unknown track "${track}".`);
  process.exit(1);
}
const contentPath = track === "junior" ? `content/junior/${date}.json` : `content/${date}.json`;
if (fs.existsSync(contentPath)) {
  console.error(`${contentPath} already exists — the ${date} ${track} reading is published, so this poll would never show. Refusing.`);
  process.exit(1);
}

// Must stay stable (candidate ids are title slugs, so re-runs keep ballots).
function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function readCandidates() {
  const raw = file && file !== "-" ? fs.readFileSync(file, "utf8") : fs.readFileSync(0, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`Candidates are not valid JSON: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(parsed) || parsed.length < 2 || parsed.length > 12) {
    console.error("Expected a JSON array of 2–12 candidates.");
    process.exit(1);
  }
  return parsed.map((c, i) => {
    for (const f of ["title", "source", "pitch", "articleUrl"]) {
      if (typeof c[f] !== "string" || !c[f].trim()) {
        console.error(`Candidate ${i + 1} is missing "${f}".`);
        process.exit(1);
      }
    }
    try {
      new URL(c.articleUrl);
    } catch {
      console.error(`Candidate ${i + 1} has an invalid articleUrl: ${c.articleUrl}`);
      process.exit(1);
    }
    if (c.kind !== undefined && c.kind !== "news" && c.kind !== "enrichment") {
      console.error(`Candidate ${i + 1} has an invalid kind "${c.kind}".`);
      process.exit(1);
    }
    return {
      id: slugify(c.title) || `candidate-${i + 1}`,
      title: c.title.trim(),
      source: c.source.trim(),
      pitch: c.pitch.trim(),
      articleUrl: c.articleUrl.trim(),
      ...(c.kind ? { kind: c.kind } : {}),
    };
  });
}

const candidates = readCandidates();
if (new Set(candidates.map((c) => c.id)).size !== candidates.length) {
  console.error("Two candidates slugified to the same id — give them more distinct titles.");
  process.exit(1);
}

const conn = process.env.SUPABASE_DB_URL;
if (!conn) {
  console.error("SUPABASE_DB_URL not set (run with --env-file=.env.local).");
  process.exit(1);
}
const client = new pg.Client({ connectionString: conn });
await client.connect();
try {
  const existing = await client.query("select id from rc_polls where track=$1 and date=$2", [track, date]);
  if (existing.rows.length > 0) {
    const ballots = await client.query("select count(*)::int as n from rc_ballots where poll_id=$1", [existing.rows[0].id]);
    console.warn(`A ${track} poll for ${date} already exists — will overwrite it.`);
    if (ballots.rows[0].n > 0) {
      console.warn(`⚠ ${ballots.rows[0].n} ballot(s) already cast — they stay valid only for candidates whose titles (→ ids) are unchanged.`);
    }
  }

  if (dryRun) {
    console.log(`[dry-run] would upsert ${track} poll for ${date} with ${candidates.length} candidates:`);
    for (const c of candidates) console.log(`  [${c.source}${c.kind === "enrichment" ? " · enrichment" : ""}] ${c.title}  (id: ${c.id})`);
    console.log("[dry-run] no write performed.");
  } else {
    // Upsert on (track,date) keeps the row id — and its ballots — across a re-open.
    await client.query(
      "insert into rc_polls (track, date, candidates) values ($1,$2,$3::jsonb) on conflict (track,date) do update set candidates = excluded.candidates",
      [track, date, JSON.stringify(candidates)],
    );
    console.log(`Vote for ${date} (${track}) is LIVE with ${candidates.length} candidates:`);
    for (const c of candidates) console.log(`  [${c.source}${c.kind === "enrichment" ? " · enrichment" : ""}] ${c.title}  (id: ${c.id})`);
    console.log(`\nShows at the top of https://dailyreadingclub.com${track === "junior" ? "/junior" : ""} until the day's ${track} reading is published.`);
  }
} finally {
  await client.end();
}
