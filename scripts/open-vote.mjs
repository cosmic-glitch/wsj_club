#!/usr/bin/env node
/**
 * Open the day's article vote: upsert the poll into rc_polls, which makes the
 * "TODAY'S READ — YOU DECIDE" row appear at the top of that track's index
 * immediately (no deploy — /api/vote reads the DB live). Part of the
 * wsj-open-vote skill; the companion scripts/check-vote.mjs reads the result.
 *
 * The poll closes by itself when the day's reading is published ON ITS TRACK
 * (the API treats a poll as live only while no reading on that track exists
 * for its date) — there is no close step. The two tracks' polls are fully
 * independent — both can be live at once.
 *
 * Usage:
 *   node --env-file=.env.local scripts/open-vote.mjs <YYYY-MM-DD> [candidates.json] [--track=junior]
 *   ... | node --env-file=.env.local scripts/open-vote.mjs <YYYY-MM-DD> [--track=junior]
 *
 * The candidates file (or stdin) is a JSON array of 2–12 entries (typical
 * senior ballot: 7 news + 3 enrichment; typical junior ballot: 5 news):
 *   [{ "title": "...", "source": "WSJ" | "Economist" | an enrichment source name,
 *      "pitch": "...", "articleUrl": "https://...",
 *      "kind": "news" | "enrichment"  (optional; absent = news) }, ...]
 *
 * `kind` drives the ballot's section labels ("The day's news" / "Enrichment —
 * timeless reads") in the voting modal — grouping only; it stays ONE unified
 * poll with one vote across all candidates.
 *
 * Candidate ids are slugs derived from the titles, so re-running with the same
 * titles keeps already-cast ballots valid (ballots reference candidate ids;
 * a ballot for a removed id is simply not counted).
 */
import fs from "node:fs";
import { dbSelect, dbUpsert } from "./db-rest.mjs";

const argv = process.argv.slice(2);
const [date, file] = argv.filter((a) => !a.startsWith("--"));
const trackFlag = argv.find((a) => a.startsWith("--track="));
const track = trackFlag ? trackFlag.slice("--track=".length) : "senior";

if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("Usage: node --env-file=.env.local scripts/open-vote.mjs <YYYY-MM-DD> [candidates.json] [--track=junior]");
  process.exit(1);
}
if (track !== "senior" && track !== "junior") {
  console.error(`Unknown track "${track}" — use --track=junior (or omit for senior).`);
  process.exit(1);
}
const junior = track === "junior";
const contentPath = junior ? `content/junior/${date}.json` : `content/${date}.json`;

// A poll for a date whose reading is already published would be born closed.
if (fs.existsSync(contentPath)) {
  console.error(`${contentPath} already exists — the ${date} ${track} reading is published, so this poll would never show. Refusing.`);
  process.exit(1);
}

// Must match slugify() in lib/handout-audio.ts (same convention, no need to be identical — just stable).
function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function readCandidates() {
  const path = file && file !== "-" ? file : null;
  const raw = path ? fs.readFileSync(path, "utf8") : fs.readFileSync(0, "utf8");
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
    for (const field of ["title", "source", "pitch", "articleUrl"]) {
      if (typeof c[field] !== "string" || !c[field].trim()) {
        console.error(`Candidate ${i + 1} is missing "${field}".`);
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
      console.error(`Candidate ${i + 1} has an invalid kind "${c.kind}" (use "news" or "enrichment", or omit).`);
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

// Re-opening an existing poll is allowed (revising candidates), but warn when
// ballots were already cast — a changed title changes the id and orphans them.
const existing = await dbSelect("rc_polls", `?track=eq.${track}&date=eq.${date}&select=id`);
if (existing.length > 0) {
  const ballots = await dbSelect("rc_ballots", `?poll_id=eq.${existing[0].id}&select=username`);
  console.warn(`A ${track} poll for ${date} already exists — overwriting it.`);
  if (ballots.length > 0) {
    console.warn(`⚠ ${ballots.length} ballot(s) already cast. They stay valid only for candidates whose titles (→ ids) are unchanged; a vote for a removed/renamed candidate won't be counted.`);
  }
}

// The upsert (on track,date) keeps the poll's row id — and so its ballots —
// across a re-open.
await dbUpsert("rc_polls", { track, date, candidates }, "track,date");

const trackTag = junior ? " (junior)" : "";
console.log(`Vote for ${date}${trackTag} is LIVE with ${candidates.length} candidates:`);
for (const c of candidates)
  console.log(`  [${c.source}${c.kind === "enrichment" ? " · enrichment" : ""}] ${c.title}  (id: ${c.id})`);
console.log(`\nThe poll shows at the top of https://dailyreadingclub.com${junior ? "/junior" : ""} until the day's ${track} reading is published.`);
console.log("Announce the voting window in the group chat (the site shows no deadline).");
console.log(`Tally later with: node --env-file=.env.local scripts/check-vote.mjs ${date}${junior ? " --track=junior" : ""}`);
