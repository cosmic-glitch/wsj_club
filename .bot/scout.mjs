// Scout The Economist for the day's candidate news articles.
// Sweeps the homepage + a handful of section hubs, returns a deduped JSON array
// of { url, headline, section } on stdout for the auto-vote skills to rank.
//   node --env-file=.bot/.env .bot/scout.mjs                  # senior sections
//   node --env-file=.bot/.env .bot/scout.mjs --track=junior   # junior sections
// Only lists candidates (works even logged-out); reading bodies is read.mjs.
import { ensureEconSession } from "./lib.mjs";
import { loadPublished, isPublished } from "./published.mjs";

const trackFlag = process.argv.find((a) => a.startsWith("--track="));
const track = trackFlag ? trackFlag.slice("--track=".length) : "senior";
if (track !== "senior" && track !== "junior") {
  console.error(`scout: unknown track "${track}" (senior|junior)`);
  process.exit(1);
}

// Senior: where the argument-driven, payload-rich pieces live.
const SENIOR_SECTIONS = [
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
// Junior (grades 5–7): story-first pieces — science, culture, and the regional
// sections' human-interest features. Leaders, Briefing and Finance are left
// out on purpose: argument pieces, 3,000-word briefings and markets coverage
// are senior material (see wsj-pick-article-junior's length and register gates).
const JUNIOR_SECTIONS = [
  "",
  "science-and-technology",
  "culture",
  "international",
  "united-states",
  "europe",
  "britain",
  "asia",
  "china",
  "the-americas",
  "middle-east-and-africa",
  "business",
];
const SECTIONS = track === "junior" ? JUNIOR_SECTIONS : SENIOR_SECTIONS;
// Dated article path: /section/YYYY/MM/DD/slug. Skip non-text formats.
const ARTICLE_RE = /economist\.com\/([a-z0-9-]+)\/(20\d\d)\/\d{2}\/\d{2}\/[a-z0-9-]+/i;
// Never handout material on either track: non-text formats, chart-only stubs,
// letters, the daily digest. Junior additionally skips the argument-driven and
// long-form sections the homepage links to (they are senior material — see the
// junior picker's length and register gates).
const SKIP_SECTIONS = new Set([
  "podcasts", "films", "interactive", "newsletters", "graphic-detail", "letters", "the-world-in-brief",
  ...(track === "junior" ? ["leaders", "briefing", "finance-and-economics", "by-invitation", "1843", "obituary"] : []),
]);

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

// Drop anything the club has already read — section hubs surface weeks of
// articles, so past picks reliably resurface here looking fresh.
const published = loadPublished();
const all = [...byUrl.values()];
const out = all.filter((c) => !isPublished(published, { url: c.url, title: c.headline }));
const dropped = all.filter((c) => !out.includes(c));
if (dropped.length) {
  console.error(`scout: dropped ${dropped.length} already-published: ${dropped.map((c) => c.url).join(", ")}`);
}
console.error(`scout: ${out.length} Economist candidates across ${SECTIONS.length} ${track} sections (${published.count} published readings excluded)`);
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
