// Scout The Economist for the day's candidate news articles — ONE sweep for
// both tracks. Walks the homepage first (the editors' own ranking of the day),
// then every section hub either track draws from, and prints a deduped JSON
// array on stdout for the auto-vote skill to read, rate and split into the
// two ballots:
//   { url, headline, section, published, tracks, homepageRank, homepageZone, hubs }
//
//   node --env-file=.bot/.env .bot/scout.mjs
//
// Editorial placement (what the skill weighs):
//   homepageRank  1-based position on the homepage in the order the editors laid
//                 the page out (1 = the lead); null when the piece is only on a
//                 hub. Sorted output follows it, so the top of the file is the
//                 top of the paper.
//   homepageZone  the homepage block the piece sits in — "front" for the
//                 editors' lead spread and the news blocks, otherwise the
//                 block's own heading lowercased ("stories most read by
//                 subscribers", "discover more", "in brief").
//   hubs          which hubs also list it ("" = the homepage). Hubs are
//                 reverse-chronological, so a hub-only piece is one the editors
//                 did not front today; `published` (from the URL) says how old.
//   tracks        which ballots the piece is eligible for by section:
//                 ["senior"] or ["senior","junior"]. Leaders, Briefing, Finance,
//                 By Invitation, 1843 and Obituary are senior-only (argument
//                 pieces, 3,000-word briefings and markets coverage — see the
//                 junior picker's length and register gates).
// Only lists candidates (works even logged-out); reading bodies is read.mjs.
import { ensureEconSession } from "./lib.mjs";
import { loadPublished, publishedMatch, recentReadings } from "./published.mjs";

if (process.argv.slice(2).some((a) => a.startsWith("--track="))) {
  console.error("scout: --track is gone — one sweep now covers both tracks (each candidate carries `tracks`)");
  process.exit(1);
}

// Homepage first (it sets homepageRank), then the union of both tracks' hubs:
// the argument-driven, payload-rich sections senior draws from and the
// story-first sections (science, culture, the regional hubs) junior draws from.
const SECTIONS = [
  "", // homepage — the editors' ranking of the day
  "leaders",
  "briefing",
  "finance-and-economics",
  "business",
  "science-and-technology",
  "international",
  "culture",
  "united-states",
  "europe",
  "britain",
  "asia",
  "china",
  "the-americas",
  "middle-east-and-africa",
];
// Dated article path: /section/YYYY/MM/DD/slug. Skip non-text formats.
const ARTICLE_RE = /economist\.com\/([a-z0-9-]+)\/(20\d\d)\/(\d{2})\/(\d{2})\/[a-z0-9-]+/i;
// Never handout material on either track: non-text formats, chart-only stubs,
// letters, the daily digest.
const SKIP_SECTIONS = new Set(["podcasts", "films", "interactive", "newsletters", "graphic-detail", "letters", "the-world-in-brief"]);
// Senior-only sections (see the header).
const SENIOR_ONLY = new Set(["leaders", "briefing", "finance-and-economics", "by-invitation", "1843", "obituary"]);

const { browser, ctx } = await ensureEconSession();
const page = await ctx.newPage();
const byUrl = new Map();

for (const s of SECTIONS) {
  const url = s ? `https://www.economist.com/${s}` : "https://www.economist.com/";
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);
    // Links in document order — on the homepage that IS the editors' order.
    // `zone` is the enclosing <section>'s own heading, if it has one — "world
    // news", "stories most read by subscribers", "weekly edition | …"; the lead
    // spread has none (its first heading is the lead story's own linked
    // headline, which is skipped), so it comes out as "front" below.
    const found = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map((a) => {
        const sec = a.closest("section");
        const h = sec && Array.from(sec.querySelectorAll("h1,h2,h3")).find((el) => !el.closest("a[href]"));
        return {
          href: a.href,
          text: (a.innerText || a.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(),
          zone: h ? h.innerText.replace(/\s+/g, " ").trim().toLowerCase() : "",
        };
      }),
    );
    let pos = 0;
    for (const { href, text, zone } of found) {
      const m = href.match(ARTICLE_RE);
      if (!m) continue;
      const section = m[1];
      if (SKIP_SECTIONS.has(section)) continue;
      const clean = href.split("?")[0].split("#")[0];
      const headline = text && text.length > 8 ? text : slugToTitle(clean);
      let c = byUrl.get(clean);
      if (!c) {
        c = {
          url: clean,
          headline,
          section,
          published: `${m[2]}-${m[3]}-${m[4]}`,
          tracks: SENIOR_ONLY.has(section) ? ["senior"] : ["senior", "junior"],
          homepageRank: null,
          homepageZone: null,
          hubs: [],
        };
        byUrl.set(clean, c);
      } else if (c.headline.length < 8 && headline.length > 8) {
        c.headline = headline;
      }
      if (c.hubs.includes(s)) continue; // the same link repeated on one page
      pos++;
      c.hubs.push(s);
      if (s === "") {
        c.homepageRank = pos;
        c.homepageZone = zone || "front";
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
const dropped = [];
const out = all
  .filter((c) => {
    const hit = publishedMatch(published, { url: c.url, title: c.headline });
    if (hit) dropped.push({ c, hit });
    return !hit;
  })
  // The editors' order: homepage pieces by rank, then hub-only pieces newest first.
  .sort((a, b) => (a.homepageRank ?? Infinity) - (b.homepageRank ?? Infinity) || b.published.localeCompare(a.published));
if (dropped.length) {
  console.error(`scout: dropped ${dropped.length} already-published: ${dropped.filter((d) => d.hit.exact).map((d) => d.c.url).join(", ")}`);
  for (const d of dropped.filter((d) => !d.hit.exact)) {
    console.error(`scout: dropped as a re-slugged/re-headlined repeat of "${d.hit.title}": ${d.c.url}`);
  }
}
const onHome = out.filter((c) => c.homepageRank !== null).length;
const juniorOk = out.filter((c) => c.tracks.includes("junior")).length;
console.error(
  `scout: ${out.length} Economist candidates across the homepage + ${SECTIONS.length - 1} hubs — ${onHome} on the homepage, ${juniorOk} junior-eligible (${published.count} published readings excluded)`,
);
for (const track of ["senior", "junior"]) {
  const recent = recentReadings(track, 10);
  if (recent.length) {
    console.error(`scout: the club's last ${recent.length} ${track} readings, newest first:\n  ${recent.join("\n  ")}`);
  }
}
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
