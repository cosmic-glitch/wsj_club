// TIME for Kids helpers for the elementary track (internal id "kids") —
// shared by scout-kids.mjs and capture-kids.mjs. Both functions below run IN
// THE PAGE (page.evaluate), so they must stay self-contained.
//
// The same logic lives in the wsj-pick-article-elementary skill for the
// interactive (Playwright MCP) flow; keep them in step.

export const TFK_ORIGIN = "https://www.timeforkids.com";
// The editions the elementary track draws from (K–1 is below the reader).
export const TFK_INDEXES = ["/g34/", "/g34/page/2/", "/g34/page/3/", "/g2/", "/g2/page/2/"];
export const TFK_BODY = ".article-show__content-article";

/**
 * Measure a TFK article document: words, sentence length, a Flesch–Kincaid
 * grade (runs about one grade high on kids' text), the site's own power words,
 * and a paywall hint. The hidden power-word definitions and photo captions
 * are stripped first (left in, they inflate the count and the grade).
 * Runs in the page: `measureDoc(doc)` with a Document (live or DOMParser'd).
 */
export function measureDoc(doc) {
  const found = doc.querySelector(".article-show__content-article");
  if (!found) return { error: "no article body" };
  const body = found.cloneNode(true);
  const powerWords = [...body.querySelectorAll(".powerword .title")].map((e) => e.textContent.trim());
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
  return {
    title: meta("og:title") || doc.title,
    published: (meta("article:published_time") || "").slice(0, 10),
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

/** A TFK article URL without its tracking query (`?rl=…`), slash-terminated. */
export function cleanTfkUrl(url) {
  const u = new URL(url);
  return `${u.origin}${u.pathname.replace(/\/?$/, "/")}`;
}
