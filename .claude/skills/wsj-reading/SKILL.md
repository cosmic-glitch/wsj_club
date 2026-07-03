---
name: wsj-reading
description: Create the daily WSJ Reading Club handout. Use when the user gives a Wall Street Journal article link (or says "today's reading", "new WSJ reading", "add today's article"). Reads the article in the browser, then generates a vocabulary list, a concepts section, and a 5-question self-quiz calibrated for US grade 8-10 students, writes it as a content JSON file, builds, and deploys to Vercel.
---

# WSJ Reading Club — daily handout

You are producing one day's study handout for the **WSJ Reading Club**: a small group of four kids in US grades 8–10, all reasonably strong students with SAT verbal roughly in the 600 to 680 range. The goal is to grow their general knowledge of the world, their vocabulary, and their conceptual understanding — using one Wall Street Journal article a day.

The website is already built (Next.js in this repo). Your job each day is **only to produce one content file** and deploy. The site renders it; the index updates itself. Do not hand-write HTML or touch the page components unless the user asks for a design change.

## The audience calibration (this is the whole point — get it right)

Everything you write is for a sharp 13–16 year old, not a finance professional and not a child. Concretely:

- **Vocabulary**: pick **exactly 3 words** — the strongest, most useful ones, not a long list. Choose words *this* reader plausibly does **not** know yet but *should*. Skip words they certainly know (e.g. "increase", "company"). Skip words so obscure they'll never see them again. The sweet spot is the kind of word that shows up on the SAT and in serious journalism: *voracious, ostensibly, incumbent, scrutiny, untenable, proliferate, mitigate, capitulate*. **Present each word article-first**, in this order:
  1. `articleQuote` — how the word actually appears in the article (a short real quote/sentence containing the word).
  2. `inContext` — what the word means right *there*, in the article's situation.
  3. `meaning` — generalize to the broader, everyday definition.
  4. `examples` — **two more** example sentences (beyond the article), in situations a teenager relates to.
- **Concepts**: the richer layer the article assumes you already understand — the things a definition alone won't fix. Examples: *hyperscalers, private credit, capital expenditure, quantitative easing, yield curve, vertical integration, moral hazard, loss aversion, zero-sum game, self-selection*. **Every concept must be a general, transferable idea** — something a student can carry into other articles, classes, and life — **not the article's own topic, thesis, or central metaphor.** The test: would this concept still be worth teaching if today's article had never been written? If it only makes sense as "the point this particular piece is making" (e.g. "a city sends a message," "why this company is struggling"), it's the article's subject, not a concept — drop it and teach the underlying general idea instead (e.g. *peer effects*, *loss aversion*). When an article offers both a one-off detail and a transferable idea, always teach the transferable idea. Anchor each concept in the article via its quote, but the `meaning` should generalize well beyond it. Aim for **3–5 concepts**, and present each one article-first too:
  1. `articleQuote` — the segment of the article where the idea appears.
  2. `inContext` — what it means in that specific context.
  3. `meaning` — generalize to the broader meaning, explaining how the thing actually **works** in plain language.
- **Quiz**: exactly **5 multiple-choice questions**. Mix comprehension of the article with the vocabulary/concepts above. Make wrong options plausible, not silly. Every question gets a one-sentence explanation.
- **Tone**: clear, respectful, a little warm. Examples should use situations a teenager relates to (school, sports, friends, games) — not abstract finance.

## Hard rules

- **Don't republish the article.** WSJ is paywalled subscription content. Short quotes for study are fine — the `articleQuote` fields should be **one sentence or phrase each**, the minimum needed to show the word/idea in context. Everything else is **original**: your own context explanations, broader meanings, extra examples, and quiz questions. Never reproduce large chunks or the whole article. Always link to it.
- **One file per day.** Filename is the date: `content/YYYY-MM-DD.json`. If the user gives a different date, use that.
- Don't invent facts about the article. If something is unclear, open the page and read it rather than guessing.

## Daily workflow

1. **Get the inputs.** You need the article URL. Confirm the date (default to today). If the user didn't paste a URL, ask for it.

2. **Read the article in the browser.** Use the **Playwright** browser tools (`mcp__plugin_playwright_playwright__browser_*`) for everything here — **never the `claude-in-chrome` extension**, whose server-side safety classifier blocks `wsj.com`/`economist.com` with *"not allowed due to safety restrictions"* (Playwright isn't subject to that and is what every prior day used):
   - `browser_navigate` to the URL.
   - WSJ requires login. Tell the user: *"I've opened the article — please log into WSJ in the browser window, then tell me when you're in."* Wait for them. Do **not** ask for or store their password; they log in themselves.
   - Once past the paywall, read the full article (`browser_snapshot`, or scroll and read). Capture: the real headline, the byline/section if useful, and the substance — main argument, key facts, and any jargon a teenager would trip on.

3. **Capture the day's PDF automatically — but only for sign-in/paywalled articles.** The PDF exists so the club can still read paywalled WSJ/Economist pieces. **If the article is on a freely open link that needs no login** (e.g. a public essay, an `archive.ph` capture, or an open-access page), **skip the PDF entirely** — don't capture one, omit `pdfUrl` from the JSON, and the index will show just the Web link. Only do the capture below when the source sits behind a sign-in/paywall. With the article open and the user logged in (from step 2), **don't print the live page** — instead **rebuild a clean document from the article's own paragraphs *and its real content images* and print that**. The rebuilt doc keeps the article's **charts, graphs, and photos** (which often carry the substance — an Economist "(see chart)" data viz, a labeled diagram) while dropping the page chrome. **Why rebuild instead of printing the live page:** running `page.pdf()` on the live DOM goes wrong three ways: (a) Chromium's *print* emulation picks the **largest `srcset` candidate** for every `<img>` (WSJ photos go up to ~5000px); (b) it leaves behind **empty ad placeholders and `<video>`/poster images** that a plain `document.images` strip doesn't catch — together these bloat a short article to **tens of MB across a dozen-plus mostly-blank pages**; and (c) those tall, unbreakable blocks force awkward page breaks that **slice lines of text in half at page boundaries**. The rebuild fixes all three: it takes the article's `<p>`/heading **text** *plus* only its genuine content images — each fetched at a **sensible ~1000px width (never the 5000px monster), inlined as a `data:` URI, and capped in height so it fits one page** — into a fresh, plainly-styled doc. That lands at **~150–500KB** (a few hundred KB per image, not tens of MB), **paginates line-by-line with no slicing** (images get `break-inside:avoid`), and **keeps the charts the club needs**. **Earlier this skill stripped images entirely (text-only); that dropped critical charts/graphs, so it now includes them.** **It also preserves the original inline typography** — small-caps acronyms (the Economist sets "AI", "IBM", "GPT" in `<small>` small caps), italics, bold, and the drop-cap opening. This matters because the Economist renders those small caps via `text-transform:lowercase` + `font-variant-caps:small-caps`, and `innerText` *applies* the transform, so a plain-text sweep would silently lowercase every acronym ("AI"→"ai") and split the drop cap ("T en years"). The snippet instead reads the **raw text nodes** (which keep the real "AI") and re-wraps `<small>`/`<em>`/`<strong>` with matching print CSS — using `font-variant-caps` (a font feature), **not** `text-transform`, so the PDF's text layer still holds real uppercase and `pdftotext` extracts "AI" for the voice-quiz article text. **One caveat for The Economist:** its maps and data charts are usually **not** `<figure><img>` at all but **`infographics.economist.com` iframe embeds** whose labels/legend are a separate HTML overlay on top of a base "artboard" PNG — so a plain image fetch would drop **every label** (a labels-less map). The snippet's **step 0** handles these by opening each infographic in a throwaway tab and screenshotting the **rendered** widget (base + labels composited, zoomed 2× for resolution), then splicing it into the reading flow. Only `public/` is served by Next, so the PDF must end up at `public/pdfs/YYYY-MM-DD.pdf` and is referenced as `"/pdfs/YYYY-MM-DD.pdf"` in the JSON's `pdfUrl`.
   - Make the folder: `mkdir -p public/pdfs`.
   - With the article page **already open** (loaded past the paywall — the snippet leaves the article tab in place; it opens a **throwaway tab** only to screenshot any Economist infographic embeds, then closes it), use `browser_run_code_unsafe` — **substitute the real date** in `OUT` and the real publication in `SOURCE_NAME`:
     ```js
     async (page) => {
       const OUT = '/Users/anuragved/code/wsj_club/public/pdfs/YYYY-MM-DD.pdf'; // ← real date
       const SOURCE_NAME = 'The Economist'; // ← or 'The Wall Street Journal'
       // 0) ECONOMIST INFOGRAPHIC MAPS/CHARTS are embedded as `infographics.economist.com`
       //    IFRAMES (ai2html widgets), NOT as <figure><img>, so the figure walk below misses
       //    them. And the widget's artboard PNG is only the BASE art — its labels + legend are
       //    a separate HTML overlay — so fetching the raw PNG yields a map with NO text. The fix:
       //    open each infographic in a THROWAWAY TAB and screenshot the RENDERED widget (base +
       //    labels composited), zoomed 2x so the ~1400px artboard is captured crisp, clipped to
       //    the drawn bounds. WSJ / no-chart days find no such iframe and skip this entirely.
       const infographicUrls = await page.evaluate(() =>
         [...document.querySelectorAll('iframe')].map(f => f.src).filter(s => /infographics\.economist\.com/.test(s || ''))
       );
       const infographics = [];
       for (const src of infographicUrls) {
         const tab = await page.context().newPage();
         try {
           await tab.setViewportSize({ width: 1700, height: 1900 });
           await tab.goto(src, { waitUntil: 'networkidle' });
           await tab.waitForFunction(() => { const i = [...document.images]; return i.length > 0 && i.every(x => x.complete); }, { timeout: 15000 }).catch(() => {});
           await tab.evaluate(() => { document.documentElement.style.zoom = '2'; }); // render the 1400px artboard at native res
           await tab.waitForTimeout(400);
           const clip = await tab.evaluate(() => {
             const vis = [...document.querySelectorAll('.g-artboard')].find(a => getComputedStyle(a).display !== 'none') || document.body;
             let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
             const add = r => { if (r.width > 0 && r.height > 0) { x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); } };
             add(vis.getBoundingClientRect());                                            // the base art …
             [...vis.querySelectorAll('*')].forEach(e => { if ((e.innerText || '').trim()) add(e.getBoundingClientRect()); }); // … plus every text label
             const p = 6; return { x: Math.max(0, x0 - p), y: Math.max(0, y0 - p), width: (x1 - x0) + p * 2, height: (y1 - y0) + p * 2 };
           });
           const buf = await tab.screenshot({ clip });
           infographics.push({ type: 'img', dataUri: 'data:image/png;base64,' + buf.toString('base64'), caption: '' });
         } catch { /* best-effort: a chart that won't capture is just skipped */ }
         finally { await tab.close(); }
       }
       // 1) Wait for the (often client-rendered) body, then walk the article in
       //    document order, collecting paragraph/heading text (WITH its inline
       //    typography — small-caps acronyms, italics, bold, drop cap; see the
       //    inlineHtml walker) *and* the real content images (charts/photos) —
       //    stopping at the end-of-article footer so related-article thumbnails
       //    and ads are excluded.
       await page.waitForFunction(() => document.querySelectorAll('article p').length > 8, { timeout: 20000 });
       const data = await page.evaluate(() => {
         const art = document.querySelector('article') || document.querySelector('main');
         const title = (document.querySelector('h1')?.innerText || document.title || '').trim();
         const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
         // PRESERVE THE ORIGINAL TYPOGRAPHY. The Economist marks up acronyms as
         // <small>AI</small> — the DOM text is real uppercase "AI", but its CSS
         // (text-transform:lowercase + font-variant-caps:small-caps) RENDERS it as
         // small capitals. `innerText` APPLIES that text-transform and returns "ai"
         // — so the old text-only path lowercased every acronym (AI→ai, IBM→ibm) and
         // split the drop-cap opening ("T"+"EN YEARS" → "T\nen years"). Fix: walk the
         // RAW text nodes (nodeValue keeps "AI") and re-wrap the inline tags we care
         // about, then re-apply small-caps / italics / bold via the print CSS below.
         // We keep real uppercase chars + font-variant-caps (NOT text-transform), so
         // `pdftotext` still extracts "AI" for the voice-quiz article text. Links and
         // other unknown wrappers are unwrapped to plain text.
         const INLINE = { EM:'em', I:'em', CITE:'em', STRONG:'strong', B:'strong', SMALL:'small', ABBR:'small', SUP:'sup', SUB:'sub' };
         const inlineHtml = (node) => {
           let out = '';
           for (const c of node.childNodes) {
             if (c.nodeType === 3) { out += esc(c.nodeValue); continue; }   // text node: RAW case ("AI")
             if (c.nodeType !== 1) continue;
             const cs = getComputedStyle(c);
             if (cs.display === 'none' || cs.visibility === 'hidden' || c.getAttribute('aria-hidden') === 'true') continue;
             const inner = inlineHtml(c);
             if (!inner.trim()) continue;
             const tag = INLINE[c.tagName];
             out += tag ? `<${tag}>${inner}</${tag}>` : inner;              // unwrap span / <a> / drop-cap
           }
           return out;
         };
         // The DECK / STANDFIRST — the subtitle line right under the headline.
         // It frequently carries LOAD-BEARING facts that appear NOWHERE in the
         // body (e.g. an obituary's "...died on June 22nd, aged 100"), so capture
         // it explicitly: a plain `article p` sweep drops it, which once made the
         // tutor/grader miss a fact the student correctly recalled.
         const deckEl = document.querySelector(
           '[class*="standfirst"], [class*="sub-head"], [class*="subhead"], [class*="dek"], [class*="rubric"], [data-testid*="standfirst"], [data-testid*="subhead"], h1 ~ h2, h1 + p'
         );
         let deckText = deckEl ? deckEl.textContent.replace(/\s+/g, ' ').trim() : '';
         let deckHtml = deckEl ? inlineHtml(deckEl).replace(/\s+/g, ' ').trim() : '';
         if (deckText && (deckText === title || deckText.length > 320)) { deckText = ''; deckHtml = ''; } // guard: don't grab a body paragraph
         // STOP marks the end of the article body. Breaking here is what keeps the
         // footer's "more from this section" thumbnails (and the espresso/promo
         // images that sit just after the body) OUT of the PDF.
         const STOP = /^(This article appeared in|Discover stories from this section|Sign up to|Stay on top of|Get exclusive analysis)\b/i;
         const SKIP = /^(Save|Share|Listen to this story|Video:|Delivered to your inbox|0:00|Advertisement)\b/i;
         const JUNK_SRC = /\/newsletters\/|\/ident|\bsponsor|\badvert|\.svg(\?|$)/i; // logos, idents, ad pixels
         // Pick a sensible-resolution image (never the 5000px monster, never a tiny
         // placeholder). NOTE: srcset URLs can themselves contain commas (Cloudflare
         // "width=360,quality=80,…"), so DON'T split on commas — match "https://… NNNw"
         // pairs directly, else you get invalid fragment URLs that fail to fetch.
         const pickSrc = (img) => {
           const MAX = 1200, cands = [];
           if (img.srcset) {
             const re = /(https?:\/\/[^\s]+)\s+(\d+)w/g; let m;
             while ((m = re.exec(img.srcset))) cands.push({ url: m[1], w: +m[2] });
           }
           const usable = cands.filter(c => c.w >= 320);
           const under = usable.filter(c => c.w <= MAX).sort((a, b) => b.w - a.w);
           const over  = usable.slice().sort((a, b) => a.w - b.w);
           const chosen = under[0] || over[0];
           const url = chosen ? chosen.url : (img.currentSrc || img.src || '');
           return /^https?:\/\//.test(url) ? url : (img.currentSrc || img.src || '');
         };
         const blocks = [], seen = new Set(); let firstText = true;
         for (const n of art.querySelectorAll('p, h2, h3, figure')) {
           if (n.tagName.toLowerCase() === 'figure') {
             if (n.querySelector('video')) continue;            // video poster, not a real figure
             const img = n.querySelector('img');
             if (!img) continue;                                // audio player / pull-quote
             const url = pickSrc(img);
             if (!url || JUNK_SRC.test(url)) continue;
             const key = (url.match(/images\/[^?]+|[^/?]+\.(?:jpe?g|png|webp|gif)/i) || [url])[0];
             if (seen.has(key)) continue; seen.add(key);        // dedupe (some imgs repeat at sizes)
             const capEl = n.querySelector('figcaption');
             const caption = (capEl ? capEl.textContent : (img.alt || '')).replace(/\s+/g, ' ').trim();
             if (/^listen to this story/i.test(caption)) continue;
             blocks.push({ type: 'img', url, caption });
             continue;
           }
           const t = n.textContent.replace(/\s+/g, ' ').trim();   // raw text — for the filters below
           if (!t || t === deckText || SKIP.test(t) || /your browser does not support/i.test(t)) continue;
           if (STOP.test(t)) break;
           if (/\bmin read\b/i.test(t) && t.length < 60) continue;  // dateline
           const html = inlineHtml(n).replace(/\s+/g, ' ').trim();  // formatted text — small-caps/italics kept
           if (!html) continue;
           const isP = n.tagName.toLowerCase() === 'p';
           blocks.push({ type: 'text', tag: isP ? 'p' : 'h2', html, lead: isP && firstText }); // lead = first body para → drop cap
           if (isP) firstText = false;
         }
         return { title, deckText, deckHtml, blocks };
       });
       // 1b) Splice the captured infographic(s) into the reading flow. Default: just after the
       //     2nd body paragraph (near where Economist runs its lead chart). Move the anchor if a
       //     different spot reads better — e.g. after the paragraph that references the chart.
       if (infographics.length) {
         let at = data.blocks.findIndex((b, i) => b.type === 'text' && i >= 2);
         if (at === -1) at = data.blocks.length - 1;
         data.blocks.splice(at + 1, 0, ...infographics);
       }
       // 2) Fetch each kept image through the *authenticated browser context*
       //    (page.request shares cookies and is not subject to CORS) and inline it
       //    as a data: URI, so the printed doc is fully self-contained. Skip blocks that
       //    already carry a dataUri — those are the infographics we just screenshotted.
       for (const b of data.blocks) {
         if (b.type !== 'img' || b.dataUri) continue;
         try {
           const resp = await page.request.get(b.url, { timeout: 25000 });
           if (!resp.ok()) { b.skip = true; continue; }
           const buf = await resp.body();
           if (buf.length > 6_000_000) { b.skip = true; continue; }   // safety cap per image
           const ct = (resp.headers()['content-type'] || 'image/jpeg').split(';')[0];
           b.dataUri = `data:${ct};base64,${buf.toString('base64')}`;
         } catch { b.skip = true; }
       }
       // 3) Render text + images into a clean, plainly-styled doc and print THAT.
       //    Text blocks already carry sanitized inline HTML (small-caps/italics/bold
       //    preserved, from inlineHtml); captions are plain text so still get esc()'d.
       const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
       const deckHtml = data.deckHtml ? `<p class="dek">${data.deckHtml}</p>` : '';
       const body = data.blocks.map(b => {
         if (b.type === 'img') {
           if (b.skip || !b.dataUri) return '';
           const cap = b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : '';
           return `<figure><img src="${b.dataUri}">${cap}</figure>`;
         }
         return b.tag === 'p' ? `<p${b.lead ? ' class="lead"' : ''}>${b.html}</p>` : `<h2>${b.html}</h2>`;
       }).join('\n');
       const html = `<!doctype html><html><head><meta charset="utf-8"><style>
         html,body{margin:0;padding:0}
         body{font-family:Georgia,'Times New Roman',serif;font-size:12pt;line-height:1.5;color:#111}
         h1{font-size:20pt;line-height:1.25;margin:0 0 .25em}
         .dek{font-size:13pt;font-style:italic;color:#333;margin:.1em 0 .6em}
         .src{color:#555;font-size:10pt;margin:0 0 1.2em}
         h2{font-size:13pt;margin:1.3em 0 .35em;break-after:avoid}
         p{margin:0 0 .8em;orphans:2;widows:2}
         small{font-size:.92em;font-variant-caps:all-small-caps;letter-spacing:.02em} /* acronyms (AI, IBM, GPT) as small caps — real uppercase chars kept, so pdftotext still reads "AI" */
         em,i{font-style:italic}
         strong,b{font-weight:700}
         .lead::first-letter{font-size:3.1em;font-weight:700;line-height:.82;float:left;padding:.02em .09em 0 0} /* Economist-style drop cap on the first paragraph */
         figure{margin:1.1em 0;break-inside:avoid;text-align:center}      /* keep image+caption together */
         figure img{max-width:100%;max-height:7.5in;height:auto;display:block;margin:0 auto} /* fit one page */
         figcaption{font-size:9.5pt;color:#666;margin-top:.3em;font-style:italic;text-align:left}
       </style></head><body><h1>${esc(data.title)}</h1>${deckHtml}<div class="src">${SOURCE_NAME}</div>${body}</body></html>`;
       await page.setContent(html, { waitUntil: 'load' });
       await page.pdf({ path: OUT, format: 'Letter', printBackground: false,
         margin: { top: '0.6in', bottom: '0.6in', left: '0.7in', right: '0.7in' } });
       const imgs = data.blocks.filter(b => b.type === 'img' && b.dataUri && !b.skip);
       const txt = data.blocks.filter(b => b.type === 'text').length;
       return 'wrote ' + OUT + ' | deck=' + (data.deckHtml ? 'yes' : 'no') + ' | text=' + txt
         + ' | small-caps=' + (body.match(/<small>/g) || []).length
         + ' | images=' + imgs.length + ' [' + imgs.filter(b => b.url).map(b => (b.url.match(/images\/([^?/]+)/) || [, '?'])[1]).join(', ') + ']'
         + ' | infographics=' + infographics.length;
     }
     ```
     (Set `SOURCE_NAME` at the top = `The Wall Street Journal` or `The Economist`.) `page.setContent` *replaces* the live page with the clean doc before printing — that's intended.
   - **Verify it:** the snippet returns `deck=yes|no` (was the standfirst captured?), a `text=` paragraph count, a **`small-caps=N`** count (acronyms preserved as small caps — expect `N≥1` on any Economist article, which sets AI/IBM/GPT in `<small>`; `0` there means the typography walk missed them), an `images=N [slugs]` list, and an **`infographics=N`** count (Economist iframe maps/charts captured separately in step 0). **Confirm acronym casing survived** into the extracted text — `grep -oE "\\b(AI|ai|IBM|ibm)\\b" article-text/YYYY-MM-DD.txt | sort | uniq -c` should show **uppercase** AI/IBM, not lowercase; lowercase means the `font-variant-caps`/raw-text-node path regressed to `innerText`. Expect `text` **roughly one per paragraph** (≈20–40 for a feature; under ~8 means the `article p`/`<article>` selectors missed the body and you got page chrome — re-check login/selectors), and `images` to roughly match the **real `<figure>` charts/photos** in the body (often 1–4; **`images=0` on an article you know has a chart means the image step failed** — usually a paywall/login issue or the figure markup differs, so don't ship it without checking). **On an Economist day with a map or data chart, confirm `infographics≥1`** — and when you eyeball the pages (below), check the map shows **with its labels and legend**; a labels-less map means the widget didn't render (re-run) and a bare-PNG fetch would have that failure mode. For an obituary or feature whose subtitle states a key fact (death date, age, who-did-what), confirm `deck=yes`; if it's `no`, the standfirst didn't match the selectors — grab it from `browser_snapshot` and prepend it to the text by hand. Then `ls -la public/pdfs/YYYY-MM-DD.pdf` (expect **~150–500KB and a few pages** now that images are embedded; **tens of MB means the image step grabbed something huge** — re-check) and `file public/pdfs/YYYY-MM-DD.pdf` (expect `PDF document`). **Always render the pages and eyeball them** — both that text isn't sliced at page breaks AND that the charts/photos actually appear and the charts are legible: `pdftoppm -png -r 90 public/pdfs/YYYY-MM-DD.pdf /tmp/pg` then view the `/tmp/pg-*.png` pages. If `text=0`/near-empty, the paywall wasn't cleared — re-check login or use the manual fallback below.
   - Set `pdfUrl: "/pdfs/YYYY-MM-DD.pdf"` in the JSON. (To skip the PDF entirely, omit `pdfUrl` — the page then shows only the Web link.)
   - **Multi-article days** (the `articles[]` shape — see step 5): capture **one PDF per article**. `browser_navigate` to each article in turn, then run the snippet writing to `public/pdfs/YYYY-MM-DD-1.pdf`, `-2.pdf`, … (note the `-N` suffix), and put each path in that article's own `pdfUrl` inside `articles[]` — there is no top-level `pdfUrl`.
   - **Manual fallback** (only if auto-capture looks wrong): the user saves the article as a PDF by hand into the `PDFs/` drop-zone at the repo root (gitignored, raw WSJ filename), and you copy it over: `cp "PDFs/<that file>.pdf" public/pdfs/YYYY-MM-DD.pdf`. The `public/pdfs/` copy is what gets committed and deployed.
   - **Upload the full article text (for the voice quiz).** The home-page **Voice quiz** (`voiceQuiz: true`, see step 6) reads much better when the tutor has the *whole* article, not just the handout — it then judges the student's from-memory retelling against the real story. Once the PDF is captured, extract its text and upload it to **Vercel Blob** (we keep the full text **out of git** — the hard rule is never republish article text — so Blob is its home):
     ```sh
     mkdir -p article-text   # gitignored drop-zone; may not exist on a fresh checkout
     pdftotext public/pdfs/YYYY-MM-DD.pdf article-text/YYYY-MM-DD.txt
     node --env-file=.env.local scripts/upload-article-text.mjs YYYY-MM-DD
     ```
     Needs `BLOB_READ_WRITE_TOKEN` in `.env.local` (`vercel env pull` to get it). Best-effort: if it's skipped or fails, the quiz still works — it just falls back to a handout-only session. The `article-text/` dir is a gitignored drop-zone. **Multi-article days:** run `pdftotext` on each PDF and concatenate them into one `article-text/YYYY-MM-DD.txt` before uploading. **Open/free articles with no PDF:** save the article text to `article-text/YYYY-MM-DD.txt` by hand (or skip — the quiz degrades to handout-only). **Always include the headline AND the deck/standfirst** (the subtitle line under the headline) at the very top, before the body. This path has no extraction snippet to grab the standfirst for you, and the standfirst often carries key facts that appear nowhere in the body — e.g. an obituary's "...died on June 22nd, aged 100." Dropping it hides those facts from the tutor and the grader, which can make the grader wrongly mark a correct student answer as not-in-the-article.

4. **Propose the words and concepts, and get the user's sign-off before generating anything.** This is a required manual checkpoint — **do not write the JSON or generate the quiz until the user approves.** Based on your read of the article:
   - Pick your candidate **3 vocab words** and **3–5 concepts** per the calibration above.
   - Present them to the user as a short proposal: for each word, the word plus the short article quote it comes from and a one-line gloss of why it's worth teaching; for each concept, the concept name plus a one-line description of the idea and why it's broadly useful. Keep it skimmable — this is for the user to react to, not the finished card text.
   - **Multi-article days** (when the user asks to bundle two short articles into one handout): propose **one combined** set of words and concepts drawn from *all* the day's articles, balanced so each article is represented (e.g. ~2 vocab + ~2 concepts per article). It's fine to run slightly higher counts than usual (e.g. 4 vocab / 4 concepts) since there's more source material; note which article each pick comes from. The 5-question quiz still spans the whole bundle.
   - **Discuss and revise.** The user may swap words/concepts in or out, ask for harder or easier picks, or adjust the framing. Iterate until they explicitly give the go-ahead. Treat this as the quality gate: the point is to fix the selection *before* the expensive generation, not after.
   - Only once the user approves the final list do you move on to drafting the full handout (step 5).

5. **Draft the handout content.** Using the approved words and concepts, write the full article-first cards (`articleQuote` → `inContext` → `meaning` → `examples` for vocab; `articleQuote` → `inContext` → `meaning` for concepts) and the 5-question quiz per the calibration above. Pick a clear, descriptive `title` (it can match WSJ's headline or be a plainer version). **Do not invent a subtitle.** Use the article's own headline (or a plainer paraphrase of it); only include a subtitle/colon-tagline if the original article actually has one. Don't append your own "How X did Y"-style subtitle. **Crediting the author:** for standard media articles (WSJ news stories, etc.), use the headline alone — no byline. But when the piece is an **essay or written work by a notable named author** (e.g. a Paul Graham essay), append `by <Author Name>` to the title — e.g. `"Cities and Ambition by Paul Graham"`. Use this only for such attributed works, not routine reportage. The pages are intentionally minimal: the handout shows **just the title** at the top (no date, no summary or "big idea" blurb), then the words and concepts; the quiz lives on its own page (`/reading/<date>/quiz`). The index is a **table**, one row per day — **Date · Title · Article · Handout · Self-quiz · Voice quiz**; the article link(s) live in the Article column (single-article days show **Article · PDF**, the word "Article" → `articleUrl`, "PDF" → `pdfUrl`). The **Self-quiz** column links to `/reading/<date>/quiz` (every day has one — keep generating the 5-question quiz). The **Voice quiz** column is hidden from logged-out visitors and, once logged in, shows the AI-oral-quiz launcher only for days with `voiceQuiz: true`; older days are blank there. The only "← All readings" link is in the global header bar (`app/layout.tsx`); the handout and quiz pages have no inline back-link of their own. Don't estimate reading time either — it varies too much per student, and they're expected to re-read.
   - **Multi-article days:** set `articles: [{ title, articleUrl, pdfUrl }, …]` instead of the top-level `articleUrl`/`pdfUrl` (one entry per source, in reading order). The handout `title` is then an **umbrella title** for the bundle (e.g. `"World Cup News"`) — this is the one case where a combined title beats a single headline; each individual article keeps its real WSJ headline inside `articles[]`. The index's Article column lists each one (**Article 1 · PDF**, **Article 2 · PDF**, …, each link → that article's `articleUrl`/`pdfUrl`). The handout and quiz are unchanged — one combined page. (First example: `content/2026-06-14.json`.)

6. **Write `content/YYYY-MM-DD.json`** following the schema below exactly (include `pdfUrl` if you placed a PDF). Validate it's well-formed JSON.

7. **Build to verify:** run `npm run build`. It must succeed. If a new file breaks the build, it's almost always malformed JSON — fix it.

8. **Commit, push, and share the links.** Stage the new content and PDF — `git add content/YYYY-MM-DD.json public/pdfs/YYYY-MM-DD.pdf` (add any other changed files too) — commit, and `git push origin main`. **Pushing is shipping:** the push auto-deploys to Vercel production at `wsjclub.vercel.app` (no `vercel --prod` step). Once the deploy lands, give the user today's links: `https://wsjclub.vercel.app/reading/YYYY-MM-DD` (handout) and `https://wsjclub.vercel.app/reading/YYYY-MM-DD/quiz` (quiz).

## Content file schema

`content/YYYY-MM-DD.json`:

```json
{
  "date": "2026-06-09",
  "title": "A clear, descriptive title",
  "articleUrl": "https://www.wsj.com/...the real article link...",
  "pdfUrl": "/pdfs/2026-06-09.pdf",
  "voiceQuiz": true,
  "source": "The Wall Street Journal",
  "vocab": [
    {
      "word": "voracious",
      "partOfSpeech": "adjective",
      "articleQuote": "Short real quote/sentence from the article containing the word.",
      "inContext": "What the word means right there, in the article's situation.",
      "meaning": "The broader, everyday definition.",
      "examples": [
        "First extra example sentence a teenager would relate to.",
        "Second extra example sentence."
      ]
    }
  ],
  "concepts": [
    {
      "name": "Hyperscalers",
      "articleQuote": "Short segment of the article where the idea appears.",
      "inContext": "What it means in that specific context.",
      "meaning": "The broader meaning — how the thing actually works, in plain language."
    }
  ],
  "quiz": [
    {
      "question": "A clear question.",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answerIndex": 1,
      "explanation": "One sentence on why that's the answer."
    }
  ]
}
```

Field notes:
- `voiceQuiz`: set `"voiceQuiz": true` on **every new day**. It turns on the home-page **Voice quiz** launcher — the AI oral quiz that automates the 1-1. (Older days from before the feature omit it, so their Voice quiz column stays empty.) Pair it with the article-text upload in step 3 so the tutor gets the full article.
- `pdfUrl` is the served path under `public/` (i.e. `/pdfs/YYYY-MM-DD.pdf`), **not** a filesystem path and **not** the raw `PDFs/` drop-zone. Omit the field entirely if there's no PDF for the day.
- `answerIndex` is **0-based** (0 = first option). Double-check it points at the correct option.
- `vocab` has **exactly 3 words** (a multi-article day may run ~4); each `examples` array has **exactly 2** sentences.
- All `articleQuote` fields are short (one sentence/phrase) and taken from the actual article.
- Keep 4 options per quiz question.
- **Multi-article days:** replace the top-level `"articleUrl"`/`"pdfUrl"` with an `"articles"` array — `"articles": [{ "title": "First WSJ headline", "articleUrl": "https://www.wsj.com/…", "pdfUrl": "/pdfs/YYYY-MM-DD-1.pdf" }, { "title": "Second WSJ headline", "articleUrl": "…", "pdfUrl": "/pdfs/YYYY-MM-DD-2.pdf" }]`. Keep one combined `vocab`/`concepts`/`quiz`. See `content/2026-06-14.json`.

The TypeScript types backing this live in `lib/content.ts` — if you change the schema, update that file and the page components too (`app/reading/[date]/page.tsx` for words/concepts, `app/reading/[date]/quiz/page.tsx` for the quiz).

## Deployment

The site auto-deploys from GitHub (`cosmic-glitch/wsj_club`): **`git push origin main` ships to Vercel production** at `wsjclub.vercel.app`. There is no manual `vercel --prod` step in the daily flow.

- **Daily:** commit the new `content/YYYY-MM-DD.json` and `public/pdfs/YYYY-MM-DD.pdf`, then `git push origin main`. Vercel builds and deploys from the push; the local `npm run build` (step 6) is the pre-flight that catches malformed JSON before you push.
- **Fallback only:** if the Git auto-deploy is ever unavailable, `vercel --prod` from the repo root deploys the working tree directly (first-time setup needs `vercel link` once).

After the deploy lands, share the live links to today's reading with the user.

## If the user asks for changes

- "make the quiz harder / longer", "add more words", "the definition for X is off" → edit that day's JSON and redeploy.
- Design/layout changes (colors, sections, new field) → edit `app/`, `components/`, `lib/content.ts`, then build and redeploy.
