// How many ballots each track's poll has for a date — the input to the publish
// driver's vote hold (run-auto-publish.sh). Reads rc_polls / rc_ballots
// directly over SUPABASE_DB_URL like tally.mjs (the box has no PostgREST keys).
// Writes nothing.
//
//   node --env-file=.env.local .bot/ballots.mjs [YYYY-MM-DD]   (default: today Pacific)
//
// stdout is one shell-evalable line, numbers only, for the driver:
//   SENIOR_POLL=1 SENIOR_BALLOTS=3 JUNIOR_POLL=1 JUNIOR_BALLOTS=0
// (POLL=0 → no poll exists for that track+date, so BALLOTS is 0 too.)
// A human-readable version goes to stderr. Exits 1 on any failure (no
// connection string, query error) — the driver treats that as "can't tell".
import pg from "pg";

const argv = process.argv.slice(2);
const dateArg = argv.find((a) => !a.startsWith("--"));
if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  console.error("Usage: node --env-file=.env.local .bot/ballots.mjs [YYYY-MM-DD]");
  process.exit(1);
}
const date =
  dateArg ??
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const conn = process.env.SUPABASE_DB_URL;
if (!conn) {
  console.error("SUPABASE_DB_URL not set (run with --env-file=.env.local).");
  process.exit(1);
}

const client = new pg.Client({ connectionString: conn });
let rows;
try {
  await client.connect();
  ({ rows } = await client.query(
    "select p.track, count(b.username)::int as ballots from rc_polls p left join rc_ballots b on b.poll_id = p.id where p.date = $1 group by p.track",
    [date],
  ));
} catch (e) {
  console.error(`ballots: ${e.message}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}

const out = [];
for (const track of ["senior", "junior"]) {
  const hit = rows.find((r) => r.track === track);
  const key = track.toUpperCase();
  out.push(`${key}_POLL=${hit ? 1 : 0}`, `${key}_BALLOTS=${hit ? hit.ballots : 0}`);
  console.error(`${date} ${track}: ${hit ? `${hit.ballots} ballot(s)` : "no poll"}`);
}
process.stdout.write(out.join(" ") + "\n");
