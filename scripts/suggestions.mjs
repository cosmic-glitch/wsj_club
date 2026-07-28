#!/usr/bin/env node
/**
 * Club article suggestions — the owner-side view of what members proposed via
 * the site's "Suggest" link (app/api/suggestions). This is the script the
 * wsj-pick-article / wsj-pick-article-junior skills run at the top of their
 * workflow: every OPEN suggestion goes into the day's candidate field and is
 * read and judged on the same criteria as the ones the skill scouts itself.
 *
 * Usage:
 *   node --env-file=.env.local scripts/suggestions.mjs [--track=junior] [--all]
 *   node --env-file=.env.local scripts/suggestions.mjs --used=<id>
 *   node --env-file=.env.local scripts/suggestions.mjs --declined=<id>
 *
 * <id> is the short id printed by the listing (a unique prefix of the row's
 * uuid is enough). Resolving is what takes a suggestion out of the queue —
 * "used" when it became a reading (or a vote candidate that won), "declined"
 * when the club looked and passed. Nothing expires on its own: an unresolved
 * suggestion keeps coming back to the picker until you say otherwise.
 */
import fs from "node:fs";
import path from "node:path";
import { dbSelect, dbUpdate } from "./db-rest.mjs";

const argv = process.argv.slice(2);
const flag = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const usage =
  "Usage: node --env-file=.env.local scripts/suggestions.mjs [--track=junior] [--all]\n" +
  "       node --env-file=.env.local scripts/suggestions.mjs --used=<id> | --declined=<id>";

const track = flag("track");
const showAll = argv.includes("--all");
const used = flag("used");
const declined = flag("declined");

if (track && track !== "senior" && track !== "junior") {
  console.error(`Unknown track "${track}" — use --track=senior or --track=junior.`);
  process.exit(1);
}
if (used && declined) {
  console.error("Pick one: --used or --declined.\n" + usage);
  process.exit(1);
}

const rows = await dbSelect(
  "rc_suggestions",
  "?select=id,track,url,username,status,created_at,resolved_at&order=created_at.asc"
);

// ---- resolve mode -----------------------------------------------------------

if (used || declined) {
  const prefix = (used ?? declined).toLowerCase();
  const matches = rows.filter((r) => r.id.startsWith(prefix));
  if (matches.length === 0) {
    console.error(`No suggestion whose id starts with "${prefix}".`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`"${prefix}" matches ${matches.length} suggestions — use a longer id.`);
    process.exit(1);
  }
  const row = matches[0];
  const status = used ? "used" : "declined";
  const now = new Date().toISOString();
  await dbUpdate("rc_suggestions", `?id=eq.${row.id}`, {
    status,
    resolved_at: now,
    updated_at: now,
  });
  console.log(`${status}: [${row.track}] ${row.url}  (from ${row.username})`);
  process.exit(0);
}

// ---- listing ----------------------------------------------------------------

/** A URL reduced to host+path, lowercased, no query/hash/trailing slash — enough to spot "we already read this". */
function normalize(u) {
  try {
    const url = new URL(u);
    return (url.hostname.replace(/^www\./, "") + url.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

/** Every articleUrl already published, per track → so a suggestion we've read shows as such. */
function publishedUrls() {
  const seen = new Map();
  for (const [t, dir] of [
    ["senior", "content"],
    ["junior", "content/junior"],
  ]) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(file)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        if (data.articleUrl) seen.set(normalize(data.articleUrl), `${t} ${data.date}`);
      } catch {
        // A malformed content file is the build's problem, not this listing's.
      }
    }
  }
  return seen;
}

const published = publishedUrls();

/** "3 days ago" / "today" from an ISO timestamp. */
function age(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

const shown = rows
  .filter((r) => (showAll ? true : r.status === "open"))
  .filter((r) => (track ? r.track === track : true));

if (shown.length === 0) {
  console.log(
    `No ${showAll ? "" : "open "}suggestions${track ? ` for the ${track} track` : ""}.`
  );
  process.exit(0);
}

for (const t of ["senior", "junior"]) {
  const group = shown.filter((r) => r.track === t);
  if (group.length === 0) continue;
  console.log(`\n${t.toUpperCase()} — ${group.length} suggestion(s)\n`);
  for (const r of group) {
    const hit = published.get(normalize(r.url));
    const tags = [
      r.status !== "open" ? r.status.toUpperCase() : null,
      hit ? `ALREADY READ (${hit})` : null,
    ].filter(Boolean);
    console.log(
      `  ${r.id.slice(0, 8)}  ${r.username} · ${age(r.created_at)}${
        tags.length ? `  [${tags.join(" · ")}]` : ""
      }`
    );
    console.log(`      ${r.url}\n`);
  }
}

console.log(
  "Read every open suggestion in full and rank it in the day's field alongside your own candidates.\n" +
    "Resolve each one afterwards:  scripts/suggestions.mjs --used=<id>  |  --declined=<id>"
);
