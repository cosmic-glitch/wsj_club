// Capture an elementary-track (internal id "kids") article page + plain text on
// the Hetzner box — capture.mjs's TIME for Kids sibling. Opens the article in a
// plain browser (TFK needs no login), rewraps its photos into <figure>s
// (tfk.mjs tfkPrep), then hands the page to the ONE shared capture snippet
// (scripts/capture-article.js) with TFK's body container and its hidden
// power-word definitions stripped. Writes:
//   public/articles/kids/<date>.html
//   article-text/kids/<date>.txt
//
//   node .bot/capture-kids.mjs <url> <YYYY-MM-DD> [--allow-short]
//
// Prints the snippet's verification line, then a JSON summary on stdout:
//   { out, txtOut, url, words, paragraphs, figures, summary, lengthCheck }
// `url` is the clean article URL (TFK's ?rl= tracking param dropped) — use it
// as the day's articleUrl. lengthCheck compares the captured words with the
// count the morning scout measured (.bot/state/<date>-kids-field.json).
// Exit 2 = no article body / a paywall prompt (nothing written); exit 3 = the
// output looks wrong (too little text, definition fragments leaked, or SHORT
// vs the morning count — pass --allow-short after checking the dropped= list).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib.mjs";
import { normalizeUrl } from "./published.mjs";
import { TFK_BODY, cleanTfkUrl, measureDoc, tfkPrep } from "./tfk.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const SNIPPET = path.join(REPO_ROOT, "scripts", "capture-article.js");

const argv = process.argv.slice(2);
const [rawUrl, date] = argv.filter((a) => !a.startsWith("--"));
const allowShort = argv.includes("--allow-short");
if (!rawUrl || !/^https:\/\/www\.timeforkids\.com\//.test(rawUrl) || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("usage: node .bot/capture-kids.mjs <https://www.timeforkids.com/…> <YYYY-MM-DD> [--allow-short]");
  process.exit(1);
}
const url = cleanTfkUrl(rawUrl);

const out = path.join(REPO_ROOT, "public", "articles", "kids", `${date}.html`);
const txtOut = path.join(REPO_ROOT, "article-text", "kids", `${date}.txt`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.mkdirSync(path.dirname(txtOut), { recursive: true });

const captureArticle = (0, eval)(fs.readFileSync(SNIPPET, "utf8"));
if (typeof captureArticle !== "function") {
  console.error(`capture-kids: ${SNIPPET} did not evaluate to a function`);
  process.exit(1);
}

const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);

  // Gate: the article body must be there and must not be a subscribe prompt.
  const { text: _body, ...probe } = await page.evaluate(`(${measureDoc.toString()})(document)`);
  if (probe.error || probe.paywallHint) {
    console.error(`capture-kids: REFUSING — ${probe.error || "the body shows a subscribe/log-in prompt"} (${url})`);
    process.exit(2);
  }

  const figures = await page.evaluate(`(${tfkPrep.toString()})()`);
  await page.evaluate((o) => { window.__captureOpts = o; }, {
    out,
    txtOut,
    sourceName: "TIME for Kids",
    back: "/elementary",
    container: TFK_BODY,
    strip: ".powerword .definition",
  });
  const summary = await captureArticle(page);
  console.error(`capture-kids: ${summary}`);

  if (!fs.existsSync(out) || !fs.existsSync(txtOut)) {
    console.error("capture-kids: the snippet returned but an output file is missing");
    process.exit(3);
  }
  const txt = fs.readFileSync(txtOut, "utf8");
  const words = txt.split(/\s+/).filter(Boolean).length;
  const paragraphs = txt.split(/\n\n+/).filter(Boolean).length;
  const result = () => JSON.stringify({ out, txtOut, url, words, paragraphs, figures, summary, lengthCheck }, null, 2) + "\n";
  let lengthCheck = "no morning count for this URL";

  if (words < 100 || paragraphs < 3) {
    console.error(`capture-kids: output too thin (${words} words, ${paragraphs} paragraphs) — the body selector probably missed`);
    process.exit(3);
  }
  // The hidden definitions must not leak into the tutor's text.
  if (/\((noun|verb|adjective|adverb)\)/i.test(txt)) {
    console.error("capture-kids: power-word definition fragments leaked into the text (\"(noun)\" etc.) — the strip selector missed");
    process.exit(3);
  }

  // Length cross-check against the morning scout's measurement of this URL.
  // The scout counts body paragraphs only; the capture adds the headline and
  // deck, so the capture normally runs a little LONGER. Much shorter = lost body.
  const fieldPath = path.join(HERE, "state", `${date}-kids-field.json`);
  if (fs.existsSync(fieldPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(fieldPath, "utf8"));
      const ranked = Array.isArray(parsed) ? parsed : parsed.ranked;
      const hit = (ranked || []).find((f) => (f.articleUrl || f.url) && normalizeUrl(f.articleUrl || f.url) === normalizeUrl(url));
      if (hit && Number.isFinite(+hit.words) && +hit.words > 0) {
        const ratio = words / +hit.words;
        const detail = `${words} captured vs ${hit.words} measured this morning (${ratio.toFixed(2)}×)`;
        lengthCheck = ratio < 0.85 ? `SHORT — ${detail}` : `ok — ${detail}`;
      }
    } catch {
      lengthCheck = "morning field file unreadable";
    }
  }
  if (lengthCheck.startsWith("SHORT")) {
    console.error(`capture-kids: length check ${lengthCheck} — inspect the dropped= list above; re-run with --allow-short only if every dropped paragraph is chrome`);
    if (!allowShort) {
      process.stdout.write(result());
      process.exit(3);
    }
  }
  process.stdout.write(result());
} finally {
  await browser.close();
}
