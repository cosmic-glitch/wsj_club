// Compose the commit message for an auto-published day, mirroring the shape of
// the hand-authored days ("<title> (<Source>, <Mon D>)" + a vocab/concepts
// summary line; junior days carry the "Junior: " prefix the hand-authored
// junior commits use). Used by .bot/ship.sh; harmless to run by hand.
//   node .bot/commit-message.mjs <YYYY-MM-DD> [--track=junior]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const date = argv.find((a) => !a.startsWith("--"));
const trackFlag = argv.find((a) => a.startsWith("--track="));
const track = trackFlag ? trackFlag.slice("--track=".length) : "senior";
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (track !== "senior" && track !== "junior")) {
  console.error("usage: node .bot/commit-message.mjs <YYYY-MM-DD> [--track=junior]");
  process.exit(2);
}
const sub = track === "junior" ? "junior/" : "";
const read = (p) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, p), "utf8"));
const day = read(`content/${sub}${date}.json`);
const src = /economist/i.test(day.source || "") ? "Economist" : /wall street|wsj/i.test(day.source || "") ? "WSJ" : day.source || "web";
const [, m, d] = date.split("-").map(Number);
const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
const words = (day.vocab || []).map((v) => v.word).join(", ");
const concepts = (day.concepts || []).map((c) => c.name).join("; ") || "(none)";

let tally = "";
const tallyPath = path.join(REPO_ROOT, ".bot", "state", `${date}-${track === "junior" ? "junior-" : ""}tally.json`);
if (fs.existsSync(tallyPath)) {
  const t = JSON.parse(fs.readFileSync(tallyPath, "utf8"));
  tally = t.ballots ? `Vote winner (${t.winner.votes} of ${t.ballots} ballots; ${t.winnerReason}). ` : `No ballots cast — ${t.winnerReason}. `;
}
const glossPath = path.join(REPO_ROOT, "public", "glossaries", sub, `${date}.json`);
const gloss = fs.existsSync(glossPath) ? `${JSON.parse(fs.readFileSync(glossPath, "utf8")).length}-entry glossary` : "no glossary";

const prefix = track === "junior" ? "Junior: " : "";
const skill = track === "junior" ? "auto-publish-junior" : "auto-publish";
process.stdout.write(
  `${prefix}${day.title} (${src}, ${mon} ${d})\n\n` +
    `${tally}Vocab: ${words}. Concepts: ${concepts}. Article page + ${gloss} + audio.\n\n` +
    `Auto-published by the Reading Club autopilot (${skill} skill, Hetzner cron).\n\n` +
    `Co-Authored-By: Claude <noreply@anthropic.com>\n`,
);
