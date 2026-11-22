// The elementary track's (internal id "kids") sources — shared by
// scout-kids.mjs and capture-kids.mjs. measureDoc and tfkPrep run IN THE PAGE
// (page.evaluate on their toString()), so they must stay self-contained.
//
// The same calibration lives in the wsj-pick-article-elementary skill for the
// interactive (Playwright MCP) flow; keep them in step.
//
// Length is a hard gate (owner's rule): an elementary reading is 400–800
// words. TIME for Kids' current pages carry only about one such piece a week,
// so the scout also walks a rotating slice of its Grades 3–4 archive (back to
// late 2021; about one piece in six fits, mostly on level) and News for Kids (current
// news, nearly every piece 500–700 words, about a grade harder).

export const MIN_WORDS = 400;
export const MAX_WORDS = 800;

export const SOURCES = {
  tfk: {
    name: "TIME for Kids",
    origin: "https://www.timeforkids.com",
    // Fresh: the newest pages, every day. Archive: ARCHIVE_PAGES of the older
    // index pages (4..archiveLast), a different slice each day.
    fresh: ["/g34/", "/g34/page/2/", "/g34/page/3/"],
    // Page 4 ≈ two months back, page 60 ≈ late 2021; deeper is pandemic-era news.
    archiveFirst: 4,
    archiveLast: 60,
    archivePages: 10,
    archivePath: (n) => `/g34/page/${n}/`,
    article: /^https:\/\/www\.timeforkids\.com\/g34\/(?!page\/|topics\/)[a-z0-9-]+\/?$/,
    body: ".article-show__content-article",
    // Removed before measuring and capturing: the hidden power-word
    // definitions (they leak "(noun) …" into the text).
    strip: ".powerword .definition",
  },
  nfk: {
    name: "News for Kids",
    origin: "https://newsforkids.net",
    fresh: ["/", "/page/2/", "/page/3/"],
    archivePages: 0,
    article: /^https:\/\/newsforkids\.net\/articles\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/?$/,
    // The first .post-content is the story; the related-story teasers below it
    // reuse the class with .relatedSummary.
    body: ".post-content:not(.relatedSummary)",
    // Cookie-blocked embed notices, the (Map) link, the sources/map tabs and
    // the share bar all sit inside the body.
    strip: ".nocc, .maplink, .tab-content, [class^='post-sources'], .nfk_social_block, .heateor_sss_sharing_container, input",
  },
};

/** The source key for an article URL, or null. */
export function sourceOf(url) {
  for (const [key, s] of Object.entries(SOURCES)) if (s.article.test(cleanUrl(url))) return key;
  return null;
}

/** An article URL without its query (TFK's `?rl=…`) or hash, slash-terminated. */
export function cleanUrl(url) {
  const u = new URL(url);
  return `${u.origin}${u.pathname.replace(/\/?$/, "/")}`;
}

/**
 * The archive pages to sweep on a given day: `count` pages spread across
 * first..last, shifted by the day so a fortnight covers the whole archive and
 * a re-run on the same day sees the same field.
 */
export function archivePagesFor(date, s) {
  if (!s.archivePages) return [];
  const span = s.archiveLast - s.archiveFirst + 1;
  const day = Math.floor(Date.parse(`${date}T12:00:00Z`) / 86400000);
  const stride = Math.floor(span / s.archivePages);
  const out = [];
  for (let k = 0; k < s.archivePages; k++) {
    out.push(s.archivePath(s.archiveFirst + ((day * 7 + k * stride) % span)));
  }
  return out;
}

/**
 * Measure an article document: words, sentence length, a Flesch–Kincaid grade
 * (runs about one grade high on kids' text), TFK's own power words, and a
 * paywall hint. Captions, credits and `strip` are removed first (left in, they
 * inflate the count and the grade). Runs in the page:
 * `measureDoc(doc, bodySelector, stripSelector)` with a live or DOMParser'd
 * Document.
 */
export function measureDoc(doc, bodySel, stripSel) {
  const found = doc.querySelector(bodySel);
  if (!found) return { error: "no article body" };
  const body = found.cloneNode(true);
  const powerWords = [...body.querySelectorAll(".powerword .title")].map((e) => e.textContent.trim());
  if (stripSel) body.querySelectorAll(stripSel).forEach((e) => e.remove());
  body.querySelectorAll(".definition, figcaption, .wp-caption-text, p.caption, cite").forEach((e) => e.remove());
  const paras = [...body.querySelectorAll("p")]
    .map((p) => p.textContent.replace(/\s+/g, " ").trim())
    .filter((t) => t.split(/\s+/).length > 3);
  const text = paras.join(" ");
  const words = text.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
  if (!words.length) return { error: "empty article body" };
  const sentences = Math.max(1, (text.match(/[.!?]+["”’)]*(\s|$)/g) || []).length);
  const syl = (w) => {
    w = w.toLowerCase().replace(/[^a-z]/g, "");
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
    const m = w.match(/[aeiouy]{1,2}/g);
    return m ? m.length : 1;
  };
  const sy = words.map(syl);
  const wps = words.length / sentences;
  const spw = sy.reduce((a, b) => a + b, 0) / words.length;
  const meta = (p) => doc.querySelector(`meta[property="${p}"]`)?.getAttribute("content") || "";
  const title = meta("og:title") || doc.querySelector("h1")?.textContent.trim() || doc.title;
  // TFK carries article:published_time; News for Kids dates its URLs.
  const urlDate = (meta("og:url") || doc.querySelector('link[rel="canonical"]')?.href || "").match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
  return {
    title,
    published: (meta("article:published_time") || "").slice(0, 10) || (urlDate ? urlDate.slice(1).join("-") : ""),
    words: words.length,
    wordsPerSentence: +wps.toFixed(1),
    fkGrade: +(0.39 * wps + 11.8 * spw - 15.59).toFixed(1),
    hardWordPct: +((100 * sy.filter((n) => n >= 3).length) / words.length).toFixed(1),
    powerWords,
    paywallHint: /subscribe to read|log in to read|sign in to read|subscribers only/i.test(found.textContent),
    opening: paras.slice(0, 2).join(" ").slice(0, 400),
    text: paras.join("\n\n"),
  };
}

/**
 * Prepare a live TFK article page for the shared capture snippet: rewrap each
 * top-level `.image` div into a <figure> (its <img> plus a <figcaption> from
 * the following p.caption; the trailing <cite> photo credit dropped). Without
 * this the snippet's walk loses the photos. Returns the figure count.
 * (News for Kids already uses <figure>/<figcaption>; it needs no prep.)
 */
export function tfkPrep() {
  const body = document.querySelector(".article-show__content-article");
  if (!body) return -1;
  let n = 0;
  for (const div of [...body.querySelectorAll(":scope > .image")]) {
    const img = div.querySelector("img");
    if (!img) continue;
    const fig = document.createElement("figure");
    fig.appendChild(img);
    let next = div.nextElementSibling;
    if (next && next.matches("p.caption")) {
      const cap = document.createElement("figcaption");
      cap.textContent = next.textContent.replace(/\s+/g, " ").trim();
      fig.appendChild(cap);
      const after = next.nextElementSibling;
      next.remove();
      next = after;
    }
    if (next && next.tagName === "CITE") next.remove();
    div.replaceWith(fig);
    n++;
  }
  return n;
}
