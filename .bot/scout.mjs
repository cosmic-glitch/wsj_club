// Scout The Economist for the day's candidate news articles.
// Sweeps the homepage + a handful of section hubs, returns a deduped JSON array
// of { url, headline, section } on stdout for the auto-vote skill to rank.
//   node --env-file=.bot/.env .bot/scout.mjs
// Only lists candidates (works even logged-out); reading bodies is read.mjs.
import { ensureEconSession } from "./lib.mjs";

const SECTIONS = [
  "", // homepage — surfaces most of the day's spread
  "leaders",
  "briefing",
  "finance-and-economics",
  "business",
  "science-and-technology",
  "international",
  "culture",
  "united-states",
];
// Dated article path: /section/YYYY/MM/DD/slug. Skip non-text formats.
const ARTICLE_RE = /economist\.com\/([a-z0-9-]+)\/(20\d\d)\/\d{2}\/\d{2}\/[a-z0-9-]+/i;
const SKIP_SECTIONS = new Set(["podcasts", "films", "interactive", "newsletters"]);

const { browser, ctx } = await ensureEconSession();
const page = await ctx.newPage();
const byUrl = new Map();

for (const s of SECTIONS) {
  const url = s ? `https://www.economist.com/${s}` : "https://www.economist.com/";
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);
    const found = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map((a) => ({
        href: a.href,
        text: (a.innerText || a.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(),
      })),
    );
    for (const { href, text } of found) {
      const m = href.match(ARTICLE_RE);
      if (!m) continue;
      const section = m[1];
      if (SKIP_SECTIONS.has(section)) continue;
      const clean = href.split("?")[0].split("#")[0];
      const headline = text && text.length > 8 ? text : slugToTitle(clean);
      if (!byUrl.has(clean) || (byUrl.get(clean).headline.length < 8 && headline.length > 8)) {
        byUrl.set(clean, { url: clean, headline, section });
      }
    }
  } catch (e) {
    console.error(`scout: ${url} failed — ${String(e).split("\n")[0]}`);
  }
}

await browser.close();

function slugToTitle(url) {
  const slug = url.split("/").pop() || "";
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const out = [...byUrl.values()];
console.error(`scout: ${out.length} Economist candidates across ${SECTIONS.length} sections`);
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
