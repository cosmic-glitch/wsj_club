// Scout TIME for Kids for the elementary track's (internal id "kids") vote —
// the auto-vote skill's kids field. Walks the Grades 3–4 and Grade 2 indexes,
// drops anything already published on any track and any brief under 120
// words, MEASURES every remaining article (words, sentence length, Flesch–Kincaid grade, power words) and
// prints a JSON array on stdout, newest first:
//   { url, edition, title, published, words, wordsPerSentence, fkGrade,
//     hardWordPct, powerWords, paywallHint, opening, text }
// `text` is the body (captions and hidden definitions stripped), so the
// ballot can be judged on the full read without a second fetch.
//
//   node .bot/scout-kids.mjs
//
// No login and no Economist session: TFK's article pages are server-rendered
// and free. Measuring fetches each article from inside a TFK page (same
// origin) and parses it there — one browser page for the whole sweep.
import { launch } from "./lib.mjs";
import { loadPublished, publishedMatch, recentReadings } from "./published.mjs";
import { TFK_ORIGIN, TFK_INDEXES, measureDoc, cleanTfkUrl } from "./tfk.mjs";

// Per edition, so the Grade 2 field is never crowded out by Grades 3–4.
const MAX_PER_EDITION = 35;
// Shorter than this can't carry three words and a concept (news briefs).
const MIN_WORDS = 120;
const published = loadPublished();

const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  const page = await ctx.newPage();

  // 1. Collect article URLs from the edition indexes, in index order.
  const seen = new Map(); // clean url -> edition
  for (const idx of TFK_INDEXES) {
    try {
      await page.goto(TFK_ORIGIN + idx, { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch (e) {
      console.error(`scout-kids: ${idx} failed to load (${e.message.split("\n")[0]})`);
      continue;
    }
    const links = await page.evaluate(() =>
      [...document.querySelectorAll("a[href]")].map((a) => a.href),
    );
    const edition = idx.startsWith("/g2/") ? "g2" : "g34";
    let n = 0;
    for (const href of links) {
      const m = href.match(/^https:\/\/www\.timeforkids\.com\/(g34|g2)\/([a-z0-9-]+)\/?(\?.*)?$/);
      if (!m || m[1] !== edition || m[2] === "page" || m[2] === "topics") continue;
      const url = cleanTfkUrl(href);
      if (!seen.has(url)) { seen.set(url, edition); n++; }
    }
    console.error(`scout-kids: ${idx} → ${n} new article link(s)`);
  }

  // 2. Drop what any track already published.
  const unpublished = [...seen].filter(([url]) => !publishedMatch(published, { url }));
  const pool = ["g34", "g2"].flatMap((ed) => unpublished.filter(([, e]) => e === ed).slice(0, MAX_PER_EDITION));
  console.error(`scout-kids: ${seen.size} links, ${pool.length} unpublished to measure`);

  // 3. Measure each, inside the page (fetch + DOMParser).
  const measured = await page.evaluate(
    async ({ pool, measureSrc }) => {
      const measureDoc = (0, eval)(`(${measureSrc})`);
      const out = [];
      for (const [url, edition] of pool) {
        try {
          const res = await fetch(url, { credentials: "omit" });
          if (!res.ok) { out.push({ url, edition, error: `HTTP ${res.status}` }); continue; }
          const doc = new DOMParser().parseFromString(await res.text(), "text/html");
          out.push({ url, edition, ...measureDoc(doc) });
        } catch (e) {
          out.push({ url, edition, error: String(e) });
        }
      }
      return out;
    },
    { pool, measureSrc: measureDoc.toString() },
  );

  const ok = measured.filter((m) => !m.error && m.words >= MIN_WORDS);
  for (const m of measured.filter((m) => m.error)) console.error(`scout-kids: skipped ${m.url} (${m.error})`);
  const brief = measured.filter((m) => !m.error && m.words < MIN_WORDS).length;
  if (brief) console.error(`scout-kids: dropped ${brief} brief(s) under ${MIN_WORDS} words`);
  ok.sort((a, b) => (b.published || "").localeCompare(a.published || ""));

  console.error(`scout-kids: ${ok.length} measured candidates`);
  console.error("Recent elementary readings (newest first):\n" + recentReadings("kids", 10).join("\n"));
  process.stdout.write(JSON.stringify(ok, null, 2) + "\n");
} finally {
  await browser.close();
}
