// Capture the day's article page + plain text on the Hetzner box — the
// autonomous runner for scripts/capture-article.js (the ONE capture snippet;
// see its header). Opens the article in the saved, logged-in, HEADED Economist
// session (run under xvfb-run — see lib.mjs), refuses a teaser/paywalled read,
// then hands the page to the shared snippet, which writes:
//   public/articles/<date>.html   (junior: public/articles/junior/<date>.html)
//   article-text/<date>.txt       (junior: article-text/junior/<date>.txt)
//
//   node --env-file=.bot/.env .bot/capture.mjs <url> <YYYY-MM-DD> [--source="The Economist"] [--track=junior] [--allow-short]
//
// Prints the snippet's verification line (including its `dropped=` list — every
// paragraph the chrome filters removed), then a JSON summary on stdout:
//   { out, txtOut, words, paragraphs, summary, acronymCheck, lengthCheck }
// lengthCheck cross-checks the captured word count against the count the
// morning run (auto-vote → read.mjs) recorded for this URL in
// .bot/state/<date>-field.json (junior: <date>-junior-field.json) — an
// independent second read of the same page,
// so a capture that comes out materially shorter means the filters (or a
// half-rendered page) dropped body text. Exit 2 = the page read as a teaser /
// bot challenge (nothing written); exit 3 = the snippet ran but the output
// looks wrong (too little text, or SHORT vs the morning count — pass
// --allow-short after confirming the `dropped=` list is all chrome).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureEconSession, extractArticle } from "./lib.mjs";
import { normalizeUrl } from "./published.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const SNIPPET = path.join(REPO_ROOT, "scripts", "capture-article.js");

const argv = process.argv.slice(2);
const [url, date] = argv.filter((a) => !a.startsWith("--"));
const sourceFlag = argv.find((a) => a.startsWith("--source="));
const trackFlag = argv.find((a) => a.startsWith("--track="));
const allowShort = argv.includes("--allow-short");
const track = trackFlag ? trackFlag.slice("--track=".length) : "senior";
const sourceName = sourceFlag ? sourceFlag.slice("--source=".length) : "The Economist";

if (!url || !/^https?:\/\//.test(url) || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error('usage: node --env-file=.bot/.env .bot/capture.mjs <url> <YYYY-MM-DD> [--source="The Economist"] [--track=junior]');
  process.exit(1);
}
if (track !== "senior" && track !== "junior") {
  console.error(`Unknown track "${track}".`);
  process.exit(1);
}

const sub = track === "junior" ? "junior/" : "";
const out = path.join(REPO_ROOT, "public", "articles", sub, `${date}.html`);
const txtOut = path.join(REPO_ROOT, "article-text", sub, `${date}.txt`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.mkdirSync(path.dirname(txtOut), { recursive: true });

// The snippet is a bare `async (page) => {…}` expression; evaluating the file
// yields the function. (Indirect eval = global scope, no access to this module.)
const captureArticle = (0, eval)(fs.readFileSync(SNIPPET, "utf8"));
if (typeof captureArticle !== "function") {
  console.error(`capture: ${SNIPPET} did not evaluate to a function`);
  process.exit(1);
}

const { browser, ctx } = await ensureEconSession();
try {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3500);

  // Gate: never capture a logged-out teaser or a bot-challenge stub. The
  // logged-out Economist body is ~130 words; a solved, subscribed page is 400+.
  const probe = await extractArticle(page);
  if (probe.wall || probe.words < 300) {
    console.error(
      `capture: REFUSING — page reads as ${probe.wall ? "paywalled" : "a teaser/challenge"} (${probe.words} words, title "${probe.title}"). ` +
        "Check the session (xvfb-run, no spoofed UA) — see .bot/RECOVERY.md.",
    );
    process.exit(2);
  }

  await page.evaluate((o) => { window.__captureOpts = o; }, { out, txtOut, sourceName, back: track === "junior" ? "/junior" : "/" });
  const summary = await captureArticle(page);
  console.error(`capture: ${summary}`);

  if (!fs.existsSync(out) || !fs.existsSync(txtOut)) {
    console.error("capture: the snippet returned but an output file is missing");
    process.exit(3);
  }
  const txt = fs.readFileSync(txtOut, "utf8");
  const words = txt.split(/\s+/).filter(Boolean).length;
  const paragraphs = txt.split(/\n\n+/).filter(Boolean).length;
  if (words < 300 || paragraphs < 6) {
    console.error(`capture: output too thin (${words} words, ${paragraphs} paragraphs) — selectors probably missed the body`);
    process.exit(3);
  }
  // Acronym casing tripwire: the raw-text-node walk must keep "AI" uppercase.
  const upper = (txt.match(/\b(AI|IBM|GPT|GDP|EU|UN)\b/g) || []).length;
  const lower = (txt.match(/\b(ai|ibm|gpt|gdp)\b/g) || []).length;
  const acronymCheck = lower > 0 && lower >= upper ? `SUSPECT — ${lower} lowercase acronym(s) vs ${upper} uppercase` : `ok (${upper} uppercase, ${lower} lowercase)`;
  if (acronymCheck.startsWith("SUSPECT")) console.error(`capture: acronym check ${acronymCheck}`);

  // Length cross-check against the morning run's independent read of this URL.
  // read.mjs counts body paragraphs INCLUDING the footer promos the capture
  // strips ("This article appeared in…", "Explore more…"), while the capture
  // adds the headline + deck. Measured on real days (2026-09-01..04) the
  // morning count exceeds the capture by a steady 91–104 words (0.87–0.92×).
  // A single dropped body paragraph adds 60–120 words to that gap, so the
  // trigger is the ABSOLUTE gap (a ratio alone misses one paragraph on a long
  // piece); the ratio is a backstop for short leaders.
  const MAX_GAP_WORDS = 160;
  const SHORT_RATIO = 0.85;
  let lengthCheck = "no morning count for this URL";
  const fieldPath = path.join(HERE, "state", `${date}-${track === "junior" ? "junior-" : ""}field.json`);
  if (fs.existsSync(fieldPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(fieldPath, "utf8"));
      const ranked = Array.isArray(parsed) ? parsed : parsed.ranked;
      const hit = (ranked || []).find((f) => f.articleUrl && normalizeUrl(f.articleUrl) === normalizeUrl(url));
      if (hit && Number.isFinite(+hit.words) && +hit.words > 0) {
        const expected = +hit.words;
        const gap = expected - words;
        const ratio = words / expected;
        const detail = `${words} captured vs ${expected} read this morning (gap ${gap}, ${ratio.toFixed(2)}×)`;
        lengthCheck = gap > MAX_GAP_WORDS || ratio < SHORT_RATIO ? `SHORT — ${detail}` : `ok — ${detail}`;
      }
    } catch {
      lengthCheck = "morning field file unreadable";
    }
  }
  if (lengthCheck.startsWith("SHORT")) {
    console.error(`capture: length check ${lengthCheck} — inspect the dropped= list above; re-run with --allow-short only if every dropped paragraph is chrome`);
    if (!allowShort) {
      process.stdout.write(JSON.stringify({ out, txtOut, words, paragraphs, summary, acronymCheck, lengthCheck }, null, 2) + "\n");
      process.exit(3);
    }
  }

  process.stdout.write(JSON.stringify({ out, txtOut, words, paragraphs, summary, acronymCheck, lengthCheck }, null, 2) + "\n");
} finally {
  await browser.close();
}
