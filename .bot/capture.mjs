// Capture the day's article page + plain text on the Hetzner box — the
// autonomous runner for scripts/capture-article.js (the ONE capture snippet;
// see its header). Opens the article in the saved, logged-in, HEADED Economist
// session (run under xvfb-run — see lib.mjs), refuses a teaser/paywalled read,
// then hands the page to the shared snippet, which writes:
//   public/articles/<date>.html   (junior: public/articles/junior/<date>.html)
//   article-text/<date>.txt       (junior: article-text/junior/<date>.txt)
//
//   node --env-file=.bot/.env .bot/capture.mjs <url> <YYYY-MM-DD> [--source="The Economist"] [--track=junior]
//
// Prints the snippet's verification line, then a JSON summary on stdout:
//   { out, txtOut, words, paragraphs, summary, acronymCheck }
// Exit 2 = the page read as a teaser / bot challenge (nothing written);
// exit 3 = the snippet ran but the output looks wrong (too little text).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureEconSession, extractArticle } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const SNIPPET = path.join(REPO_ROOT, "scripts", "capture-article.js");

const argv = process.argv.slice(2);
const [url, date] = argv.filter((a) => !a.startsWith("--"));
const sourceFlag = argv.find((a) => a.startsWith("--source="));
const trackFlag = argv.find((a) => a.startsWith("--track="));
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

  process.stdout.write(JSON.stringify({ out, txtOut, words, paragraphs, summary, acronymCheck }, null, 2) + "\n");
} finally {
  await browser.close();
}
