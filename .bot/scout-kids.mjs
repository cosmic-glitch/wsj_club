// Scout the elementary track's (internal id "kids") sources for the vote —
// the auto-vote skill's kids field. Per source (kids-sources.mjs): walk the
// fresh index pages plus the day's slice of the archive, drop anything already
// published on any track, MEASURE every remaining article (words, sentence
// length, Flesch–Kincaid grade, power words) and keep only the ones inside the
// hard 400–800 word band. Prints a JSON array on stdout, newest first:
//   { url, source, sourceName, fresh, title, published, words,
//     wordsPerSentence, fkGrade, hardWordPct, powerWords, paywallHint,
//     opening, text }
// `fresh` = found on a current index page (vs the archive slice). `text` is
// the body (captions and hidden definitions stripped), so the ballot can be
// judged on the full read without a second fetch.
//
//   node .bot/scout-kids.mjs [YYYY-MM-DD]     (date picks the archive slice; default today, Pacific)
//
// No login: both sources are free and server-rendered. Measuring fetches each
// article from inside one of that source's pages (same origin) and parses it
// there — one browser page per source.
import { launch } from "./lib.mjs";
import { loadPublished, publishedMatch, recentReadings } from "./published.mjs";
import { SOURCES, MIN_WORDS, MAX_WORDS, measureDoc, cleanUrl, archivePagesFor } from "./kids-sources.mjs";

// Per source, so one source never crowds out the other (a TFK sweep finds
// ~150 links; measuring them all takes under a minute).
const MAX_PER_SOURCE = 250;
const date =
  process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ||
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const published = loadPublished();

const browser = await launch();
const all = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  const page = await ctx.newPage();

  for (const [key, s] of Object.entries(SOURCES)) {
    // 1. Collect article URLs from the index pages, in index order.
    const seen = new Map(); // clean url -> fresh?
    const indexes = [...s.fresh.map((p) => [p, true]), ...archivePagesFor(date, s).map((p) => [p, false])];
    let loaded = 0;
    for (const [idx, fresh] of indexes) {
      try {
        await page.goto(s.origin + idx, { waitUntil: "domcontentloaded", timeout: 45000 });
        loaded++;
      } catch (e) {
        console.error(`scout-kids: ${key} ${idx} failed to load (${e.message.split("\n")[0]})`);
        continue;
      }
      const links = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => a.href));
      let n = 0;
      for (const href of links) {
        let url;
        try { url = cleanUrl(href); } catch { continue; }
        if (!s.article.test(url) || seen.has(url)) continue;
        seen.set(url, fresh);
        n++;
      }
      console.error(`scout-kids: ${key} ${idx} → ${n} new article link(s)`);
    }
    if (!loaded) continue;

    // 2. Drop what any track already published.
    const pool = [...seen].filter(([url]) => !publishedMatch(published, { url })).slice(0, MAX_PER_SOURCE);
    console.error(`scout-kids: ${key} ${seen.size} links, ${pool.length} unpublished to measure`);

    // 3. Measure each, inside the page (fetch + DOMParser). The page is still
    //    on one of this source's index pages, so every fetch is same-origin.
    const measured = await page.evaluate(
      async ({ pool, measureSrc, body, strip }) => {
        const measureDoc = (0, eval)(`(${measureSrc})`);
        const out = [];
        for (const [url, fresh] of pool) {
          try {
            const res = await fetch(url, { credentials: "omit" });
            if (!res.ok) { out.push({ url, fresh, error: `HTTP ${res.status}` }); continue; }
            const doc = new DOMParser().parseFromString(await res.text(), "text/html");
            out.push({ url, fresh, ...measureDoc(doc, body, strip) });
          } catch (e) {
            out.push({ url, fresh, error: String(e) });
          }
        }
        return out;
      },
      { pool, measureSrc: measureDoc.toString(), body: s.body, strip: s.strip },
    );

    for (const m of measured.filter((m) => m.error)) console.error(`scout-kids: skipped ${m.url} (${m.error})`);
    const ok = measured.filter((m) => !m.error);
    const short = ok.filter((m) => m.words < MIN_WORDS).length;
    const long = ok.filter((m) => m.words > MAX_WORDS).length;
    const fit = ok.filter((m) => m.words >= MIN_WORDS && m.words <= MAX_WORDS);
    console.error(
      `scout-kids: ${key} ${fit.length} in ${MIN_WORDS}–${MAX_WORDS} words (dropped ${short} short, ${long} long)`,
    );
    for (const m of fit) {
      const urlDate = m.url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
      all.push({
        url: m.url,
        source: key,
        sourceName: s.name,
        ...m,
        published: m.published || (urlDate ? urlDate.slice(1).join("-") : ""),
      });
    }
  }

  all.sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  console.error(`scout-kids: ${all.length} measured candidates (${all.filter((m) => m.fresh).length} fresh)`);
  console.error("Recent elementary readings (newest first):\n" + recentReadings("kids", 10).join("\n"));
  process.stdout.write(JSON.stringify(all, null, 2) + "\n");
} finally {
  await browser.close();
}
