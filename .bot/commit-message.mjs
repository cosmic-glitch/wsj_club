// Compose the commit message for an auto-published day, mirroring the shape of
// the hand-authored days ("<title> (<Source>, <Mon D>)" + a vocab/concepts
// summary line). Used by .bot/ship.sh; harmless to run by hand.
//   node .bot/commit-message.mjs <YYYY-MM-DD>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const date = process.argv[2];
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("usage: node .bot/commit-message.mjs <YYYY-MM-DD>");
  process.exit(2);
}
const read = (p) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, p), "utf8"));
const day = read(`content/${date}.json`);
const src = /economist/i.test(day.source || "") ? "Economist" : /wall street|wsj/i.test(day.source || "") ? "WSJ" : day.source || "web";
const [, m, d] = date.split("-").map(Number);
const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
const words = (day.vocab || []).map((v) => v.word).join(", ");
const concepts = (day.concepts || []).map((c) => c.name).join("; ") || "(none)";

let tally = "";
const tallyPath = path.join(REPO_ROOT, ".bot", "state", `${date}-tally.json`);
if (fs.existsSync(tallyPath)) {
  const t = JSON.parse(fs.readFileSync(tallyPath, "utf8"));
  tally = t.ballots ? `Vote winner (${t.winner.votes} of ${t.ballots} ballots; ${t.winnerReason}). ` : `No ballots cast — ${t.winnerReason}. `;
}
const glossPath = path.join(REPO_ROOT, "public", "glossaries", `${date}.json`);
const gloss = fs.existsSync(glossPath) ? `${JSON.parse(fs.readFileSync(glossPath, "utf8")).length}-entry glossary` : "no glossary";

process.stdout.write(
  `${day.title} (${src}, ${mon} ${d})\n\n` +
    `${tally}Vocab: ${words}. Concepts: ${concepts}. Article page + ${gloss} + audio.\n\n` +
    `Auto-published by the Reading Club autopilot (auto-publish skill, Hetzner cron).\n\n` +
    `Co-Authored-By: Claude <noreply@anthropic.com>\n`,
);
