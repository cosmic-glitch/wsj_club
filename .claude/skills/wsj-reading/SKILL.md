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
  - Also set `pronunciation` — a **plain-English US respelling** (NOT IPA): hyphen-separated syllables with the **primary-stress syllable in CAPS**, e.g. `ubiquitous` → `"yoo-BIK-wih-tus"`, `renaissance` → `"REN-uh-sahns"`, `dire` → `"DYRE"`. It shows on the card **in place of the part of speech** (the ▶ button plays real OpenAI audio; this is the at-a-glance text guide). Still set `partOfSpeech` too — it's no longer shown on the handout but is fed to the voice-quiz tutor.
- **Concepts**: the richer layer the article assumes you already understand — the things a definition alone won't fix. Examples: *hyperscalers, private credit, capital expenditure, quantitative easing, yield curve, vertical integration, moral hazard, loss aversion, zero-sum game, self-selection*. **Every concept must be a general, transferable idea** — something a student can carry into other articles, classes, and life — **not the article's own topic, thesis, or central metaphor.** The test: would this concept still be worth teaching if today's article had never been written? If it only makes sense as "the point this particular piece is making" (e.g. "a city sends a message," "why this company is struggling"), it's the article's subject, not a concept — drop it and teach the underlying general idea instead (e.g. *peer effects*, *loss aversion*). When an article offers both a one-off detail and a transferable idea, always teach the transferable idea. **Each concept must be teachable from scratch to a reader with no background in the topic** — its card has to stand on its own. If honestly explaining a concept would first require teaching *several other* concepts the student doesn't have — a chain of prerequisites (e.g. *seigniorage* only makes sense after bank reserves, the central bank's balance sheet, and the money supply) — it is **too deep**: either pick a more self-contained concept, or scaffold down to the *one* new idea underneath it and teach just that in plain language. One genuinely new hard idea per concept is the right stretch; a stack of assumed background is not. (This should already hold if the article was chosen well — the pick skill gates on it — but enforce it again here at the concept level. If you find the article's concepts *unavoidably* require deep background, don't ship cards a 14-year-old can't follow: say so to the user and pick a different article.) Anchor each concept in the article via its quote, but the explanation should generalize well beyond it. **Ship up to 3 concepts** — the strongest, most transferable ideas the article genuinely supports, and **no more than three**. It's flexible on the low side: take only as many as truly earn their place (a tight 2 beats a padded 3), it's fine to run just 1, and **0 is right for a vocab-rich day with no transferable concepts** — ship an empty `concepts: []` rather than force weak, topic-bound ones (see the empty-concepts handling below). **Never pad to reach three.** The user can override the count. **Unlike vocab, a concept is NOT split into "what it means here" vs "in general"** — it gets a **single, unified explanation** (there is no separate `inContext` step for concepts anymore). Each concept has just two rendered fields:
  1. `articleQuote` — the short segment of the article where the idea appears (the anchor; keep it).
  2. `meaning` — **one clear explanation of the idea, written like Richard Feynman would teach it.** **Name the field the concept belongs to** (owner's standing rule, 2026-07-26) — "Rent-seeking is one of the big ideas in **economics**…", "Measurement error comes from **statistics**…" — in the first sentence or two, before or alongside the hook, so the reader is oriented before the analogy lands. Knowing *where an idea lives* is itself part of the general knowledge the club exists to build: it tells the student what else sits near the idea and which class they'll meet it in again. Do it **whenever the field is obvious**; skip it only when a concept genuinely has no clear home discipline or straddles several — don't force a label. Then: **start from intuition, be concrete and specific, never abstract.** Open with a vivid hook or everyday analogy that makes the idea *click* (a prediction-market price is "a thermometer for likelihood"; astroturfing is "fake grass — AstroTurf — versus real grassroots"; insider trading is "two people bidding on a sealed box, but one already peeked"), then explain how the thing actually **works** in plain language, and **ground it with at least one concrete example** — ideally a situation a teenager pictures instantly (school, sports, social media, money). Prefer a short, memorable example over a long abstract paragraph. The `meaning` may run **multiple paragraphs** (blank-line separated) when the idea needs room. **Inline emphasis is supported**: `**bold**` and `*italic*` in any authored prose field render as real bold/italic on the page (via `lib/rich-text.tsx`), so use them where they genuinely aid comprehension — e.g. bolding the term at the moment you define it, or italicising a word being contrasted. Don't scatter them; the cards read best with a light hand. **Do not** write an `inContext` field for new concepts (it's a legacy field, no longer rendered); fold any article-specific grounding into the `meaning` or leave it to the quote.
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

3. **Capture the day's ARTICLE PAGE (the served, phone-friendly copy) — for EVERY article, paywalled or open.** Every day publishes a **self-contained responsive HTML article page** at `public/articles/YYYY-MM-DD.html`, referenced as `"/articles/YYYY-MM-DD.html"` in the JSON's `articlePageUrl` — the index then shows **one "ARTICLE" button** for the day (in place of the old Web + PDF pair; historical days without `articlePageUrl` keep their legacy Web/PDF buttons, and `public/pdfs/` is now legacy-only — **don't capture PDFs for new days**). The page **reflows to the reader's screen width**, which is the whole point: the old PDFs rendered phone text microscopically because a PDF's lines never re-wrap. **OPEN articles get a page too** (owner's call, 2026-07-25). They used to be skipped — the ARTICLE button just linked to the original — but **the tap-a-word glossary (step 6) only exists on a page we serve**, so skipping the capture silently cost an open-link day its whole word-lookup layer. That's the single biggest study feature on the page, so it outweighs the "why copy a page that's already free?" argument. **So: capture every day, paywalled or open.** (The `noindex` meta + the prominent Source link in the top bar keep it a study copy, not a republication; the hard rule against reproducing *paywalled* text is unchanged, and the source link is what sends readers to the original.) With the article open and the user logged in (from step 2), **rebuild a clean document from the article's own paragraphs *and its real content images***. The rebuilt page keeps the article's **charts, graphs, and photos** (which often carry the substance — an Economist "(see chart)" data viz, a labeled diagram) while dropping the page chrome: it takes the article's `<p>`/heading **text** *plus* only its genuine content images — each fetched at a **sensible ~1000px width (never the 5000px `srcset` monster), inlined as a `data:` URI** so the file is fully self-contained (typically **~50KB–1MB**). **It preserves the original inline typography** — small-caps acronyms (the Economist sets "AI", "IBM", "GPT" in `<small>` small caps), italics, bold, and the drop-cap opening. This matters because the Economist renders those small caps via `text-transform:lowercase` + `font-variant-caps:small-caps`, and `innerText` *applies* the transform, so a plain-text sweep would silently lowercase every acronym ("AI"→"ai") and split the drop cap ("T en years"). The snippet instead reads the **raw text nodes** (which keep the real "AI") and re-wraps `<small>`/`<em>`/`<strong>` with matching CSS — using `font-variant-caps` (a font feature), **not** `text-transform`, so the page's text (and the extracted article text) still holds real uppercase "AI". **One caveat for The Economist:** its maps and data charts are usually **not** `<figure><img>` at all but **`infographics.economist.com` iframe embeds** whose labels/legend are a separate HTML overlay on top of a base "artboard" PNG — so a plain image fetch would drop **every label** (a labels-less map). The snippet's **step 0** handles these by opening each infographic in a throwaway tab and screenshotting the **rendered** widget (base + labels composited, zoomed 2× for resolution), then splicing it into the reading flow. The snippet **also writes the day's plain article text** to `article-text/YYYY-MM-DD.txt` in the same pass (headline + deck first, then the body — the voice-quiz reference; there is no PDF to `pdftotext` anymore), so after it runs you only upload that file to Blob.
   - Make the folders: `mkdir -p public/articles article-text`.
   - With the article page **already open** (loaded past the paywall — the snippet leaves the article tab in place; it opens **throwaway tabs** only to screenshot any Economist infographic embeds and to save the output files, then closes them), use `browser_run_code_unsafe` — **substitute the real date** in `OUT` and `TXT_OUT`, the real publication in `SOURCE_NAME`, and keep `BACK = '/'` (senior); `ORIG_URL` is auto-derived from the open page and renders in the top bar — "Source: <publication>" right-aligned beside the "← Reading Club" link, the publication name being the link to the original. The snippet's sandbox has **no `fs`**, so it saves each file via Playwright's download event (a throwaway tab downloads the string as a Blob and `download.saveAs()` writes it to the repo path):
     ```js
     async (page) => {
       const OUT = '/Users/anuragved/code/wsj_club/public/articles/YYYY-MM-DD.html'; // ← real date
       const TXT_OUT = '/Users/anuragved/code/wsj_club/article-text/YYYY-MM-DD.txt'; // ← real date (voice-quiz text)
       const SOURCE_NAME = 'The Economist'; // ← or 'WSJ' (the short form — the full "The Wall Street Journal" wraps the top bar on phones)
       const BACK = '/'; // ← '/junior' for a junior-track day
       const ORIG_URL = page.url(); // the open article IS the original — no substitution needed
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
       //    NOTE the `.catch(() => {})`: a LEGACY/PLAIN-HTML page (a Paul Graham
       //    essay, an old personal site) has NO <article> and NO <p> at all — its
       //    prose is <br><br>-separated inside a <table>/<font> — so this wait
       //    would time out and abort a perfectly capturable page. Let it lapse and
       //    fall through to the plain-HTML branch below.
       await page.waitForFunction(() => document.querySelectorAll('article p').length > 8, { timeout: 20000 }).catch(() => {});
       const data = await page.evaluate(() => {
         // CONTAINER: <article>/<main> on any modern page; otherwise (legacy table
         // layouts) pick the SMALLEST element that still holds the bulk of the text,
         // which lands on the essay cell rather than <body> and its nav chrome.
         let art = document.querySelector('article') || document.querySelector('main');
         if (!art || (art.innerText || '').trim().length < 400) {
           let best = null, bestLen = 0;
           for (const el of document.querySelectorAll('td, div, font, body')) {
             const t = (el.innerText || '').trim();
             if (t.length < 400) continue;
             if ([...el.querySelectorAll('td, div, font')].some(k => (k.innerText || '').trim().length > t.length * 0.9)) continue;
             if (t.length > bestLen) { bestLen = t.length; best = el; }
           }
           art = best || document.body;
         }
         // A legacy essay page often renders its HEADLINE AS A GIF, so there's no
         // <h1> — document.title is the reliable fallback.
         const title = (document.querySelector('h1')?.innerText || document.title || '').trim();
         const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
         // PRESERVE THE ORIGINAL TYPOGRAPHY. The Economist marks up acronyms as
         // <small>AI</small> — the DOM text is real uppercase "AI", but its CSS
         // (text-transform:lowercase + font-variant-caps:small-caps) RENDERS it as
         // small capitals. `innerText` APPLIES that text-transform and returns "ai"
         // — so a text-only path would lowercase every acronym (AI→ai, IBM→ibm) and
         // split the drop-cap opening ("T"+"EN YEARS" → "T\nen years"). Fix: walk the
         // RAW text nodes (nodeValue keeps "AI") and re-wrap the inline tags we care
         // about, then re-apply small-caps / italics / bold via the page CSS below.
         // We keep real uppercase chars + font-variant-caps (NOT text-transform), so
         // the plain-text extraction still yields "AI" for the voice-quiz article
         // text. Links and other unknown wrappers are unwrapped to plain text.
         const INLINE = { EM:'em', I:'em', CITE:'em', STRONG:'strong', B:'strong', SMALL:'small', ABBR:'small', SUP:'sup', SUB:'sub' };
         const inlineHtml = (node) => {
           let out = '';
           for (const c of node.childNodes) {
             if (c.nodeType === 3) { out += esc(c.nodeValue); continue; }   // text node: RAW case ("AI")
             if (c.nodeType !== 1) continue;
             const cs = getComputedStyle(c);
             if (cs.display === 'none' || cs.visibility === 'hidden' || c.getAttribute('aria-hidden') === 'true') continue;
             const inner = inlineHtml(c);
             if (!inner.trim()) { if (inner) out += ' '; continue; }         // whitespace-only wrapper (Economist emits e.g. "was<i> </i>the"): keep ONE space, or the words glue
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
         // images that sit just after the body) OUT of the page.
         const STOP = /^(This article appeared in|Discover stories from this section|Sign up to|Stay on top of|Get exclusive analysis|Curious about the world|Explore more|To track the trends shaping|Subscribers to The Economist can sign up|(?:Spanish|Russian|Arabic|Japanese|French|German|Chinese|Korean|Italian|Portuguese|Turkish|Hebrew|Polish|Dutch|Persian) Translation)\b/i;
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
         // A bare date line ("April 2007") opens many essays. It's NOT the first
         // body paragraph, so it must not take the drop cap — tag it .dateline.
         const DATELINE = /^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i;
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
             // A figcaption often holds caption + photo credit as separate child
             // elements ("Silent flight" + "Photograph: Getty") — textContent glues
             // them ("flightPhotograph"), so join multi-child captions with a dash.
             const rawCaption = (capEl
               ? (capEl.children.length > 1
                   ? [...capEl.children].map(e => e.textContent.trim()).filter(Boolean).join(' — ')
                   : capEl.textContent)
               : (img.alt || '')).replace(/\s+/g, ' ').trim();
             if (/^listen to this story/i.test(rawCaption)) continue;
             // Keep a caption only when it DESCRIBES the image. Bare credits
             // ("Photograph: Getty", "Chart: The Economist", "MARCO BELLO/REUTERS")
             // are noise — the top bar already links the original. Strip trailing
             // credits from mixed captions; drop credit-only ones entirely.
             let caption = rawCaption
               .replace(/\s*[—–-]+\s*(?:photograph|photo|chart|illustration|image)s?\s*:.*$/i, '')
               .replace(/\s*\bSource:\s.*$/, '')
               .replace(/\s*\/?\s*(?:[A-Z][A-Z'’.&-]*(?:[ /;]+|$)){2,}$/, '')
               .trim();
             if (/^(?:photograph|photo|chart|illustration|image)s?\s*:/i.test(caption)
                 || (/[A-Z]/.test(caption) && !/[a-z]/.test(caption))) caption = '';
             blocks.push({ type: 'img', url, caption });
             continue;
           }
           const t = n.textContent.replace(/\s+/g, ' ').trim();   // raw text (textContent keeps "AI") — for the filters + the plain-text file
           if (!t || t === deckText || SKIP.test(t) || /your browser does not support/i.test(t)) continue;
           if (STOP.test(t)) break;
           if (/\bmin read\b/i.test(t) && t.length < 60) continue;  // dateline
           const html = inlineHtml(n).replace(/\s+/g, ' ').trim();  // formatted text — small-caps/italics kept
           if (!html) continue;
           const isP = n.tagName.toLowerCase() === 'p';
           if (isP && DATELINE.test(t)) { blocks.push({ type: 'text', tag: 'dateline', html, text: t }); continue; }
           blocks.push({ type: 'text', tag: isP ? 'p' : 'h2', html, text: t, lead: isP && firstText }); // lead = first body para → drop cap
           if (isP) firstText = false;
         }
         // PLAIN-HTML FALLBACK — a legacy page with no real <p> markup (prose split
         // by <br><br> inside a table/font, e.g. a Paul Graham essay). Split the
         // container's HTML on double <br>, wrap each chunk in a detached element,
         // and run it through the SAME inlineHtml walker so italics/bold survive.
         // Images are dropped here: on such pages they're headline GIFs and site
         // chrome, never content figures.
         if (!blocks.some(b => b.type === 'text')) {
           const host = document.createElement('div');
           host.innerHTML = art.innerHTML;
           host.querySelectorAll('script,style,map,area,noscript,img').forEach(e => e.remove());
           for (const chunk of host.innerHTML.split(/(?:\s*<br\s*\/?>\s*){2,}/i)) {
             const holder = document.createElement('div');
             holder.innerHTML = chunk.replace(/<br\s*\/?>/gi, ' ');
             const t = (holder.textContent || '').replace(/\s+/g, ' ').trim();
             if (!t || SKIP.test(t)) continue;
             if (STOP.test(t)) break;
             const html = inlineHtml(holder).replace(/\s+/g, ' ').trim();
             if (!html) continue;
             if (DATELINE.test(t)) { blocks.push({ type: 'text', tag: 'dateline', html, text: t }); continue; }
             blocks.push({ type: 'text', tag: 'p', html, text: t, lead: firstText });
             firstText = false;
           }
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
       //    as a data: URI, so the page is fully self-contained. Skip blocks that
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
       // 3) Render text + images into a self-contained RESPONSIVE reading page.
       //    This is the file the club actually reads (the index's ARTICLE button) —
       //    unlike the old PDF it reflows to the phone's width, so text is never
       //    tiny. Text blocks already carry sanitized inline HTML (small-caps/
       //    italics/bold preserved, from inlineHtml); captions are plain text so
       //    still get esc()'d.
       const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
       const deckHtml = data.deckHtml ? `<p class="dek">${data.deckHtml}</p>` : '';
       const body = data.blocks.map(b => {
         if (b.type === 'img') {
           if (b.skip || !b.dataUri) return '';
           const cap = b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : '';
           return `<figure><img src="${b.dataUri}" alt="">${cap}</figure>`;
         }
         if (b.tag === 'dateline') return `<p class="dateline">${b.html}</p>`;
         return b.tag === 'p' ? `<p${b.lead ? ' class="lead"' : ''}>${b.html}</p>` : `<h2>${b.html}</h2>`;
       }).join('\n');
       const html = `<!doctype html>
     <html lang="en"><head>
     <meta charset="utf-8">
     <meta name="viewport" content="width=device-width, initial-scale=1">
     <meta name="robots" content="noindex">
     <title>${esc(data.title)}</title>
     <style>
       html{-webkit-text-size-adjust:100%}
       body{margin:0;background:#fff;color:#111;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.6}
       main{max-width:40rem;margin:0 auto;padding:10px 18px 70px}
       .top{display:flex;justify-content:space-between;align-items:baseline;gap:4px 16px;flex-wrap:wrap;margin-bottom:10px}
       .club{display:inline-block;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#555;text-decoration:none;border-bottom:2px solid #0a0a0a;padding-bottom:2px}
       h1{font-size:clamp(21px,5.5vw,30px);line-height:1.2;margin:.2em 0 .25em}
       .dek{font-size:17px;font-style:italic;color:#333;margin:0 0 .45em}
       .srcline{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#555;text-align:right}
       .rule{border-bottom:1px solid #ddd;margin:10px 0 16px}
       .srcline a{color:#0000ee;text-decoration:underline}
       h2{font-size:21px;line-height:1.3;margin:1.5em 0 .5em}
       p{margin:0 0 1em}
       small{font-size:.85em;letter-spacing:.02em} /* acronyms (AI, IBM, GPT): reduced full caps, real uppercase chars kept. NOT font-variant-caps — Georgia has no small-caps glyphs, so the browser SYNTHESIZES them by scaling caps to ~70%, which stacked on a reduced font-size rendered acronyms shorter than the lowercase around them */
       em,i{font-style:italic}
       strong,b{font-weight:700}
       .lead::first-letter{font-size:3.1em;font-weight:700;line-height:.82;float:left;padding:.04em .09em 0 0} /* Economist-style drop cap */
       .dateline{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#777;margin:0 0 1.1em} /* a bare "April 2007" essay date line */
       figure{margin:1.4em 0;text-align:center}
       figure img{max-width:100%;height:auto}
       figcaption{font-size:13px;color:#666;margin-top:.4em;font-style:italic;text-align:left}
     </style>
     </head><body><main>
     <div class="top"><a class="club" href="${BACK}">&larr; Reading Club</a><span class="srcline">Source: <a href="${ORIG_URL}" rel="noopener noreferrer">${SOURCE_NAME}</a></span></div>
     <h1>${esc(data.title)}</h1>
     ${deckHtml}
     <div class="rule"></div>
     ${body}
     </main></body></html>`;
       // The plain text for the voice quiz — headline + deck first (the standfirst
       // often carries key facts found nowhere in the body), then the body text.
       const txt = [data.title, data.deckText, ...data.blocks.filter(b => b.type === 'text').map(b => b.text)]
         .filter(Boolean).join('\n\n') + '\n';
       // 4) Write both files. The snippet sandbox has no fs, so save via Playwright's
       //    download event: a throwaway tab downloads each string as a Blob and
       //    download.saveAs() writes it to the repo path.
       const saveString = async (content, mime, path) => {
         const tab = await page.context().newPage();
         try {
           await tab.setContent('<html><body></body></html>');
           const [download] = await Promise.all([
             tab.waitForEvent('download', { timeout: 15000 }),
             tab.evaluate(([c, m]) => {
               const a = document.createElement('a');
               a.href = URL.createObjectURL(new Blob([c], { type: m }));
               a.download = 'out';
               document.body.appendChild(a);
               a.click();
             }, [content, mime]),
           ]);
           await download.saveAs(path);
         } finally { await tab.close(); }
       };
       await saveString(html, 'text/html', OUT);
       await saveString(txt, 'text/plain', TXT_OUT);
       const imgs = data.blocks.filter(b => b.type === 'img' && b.dataUri && !b.skip);
       const txtBlocks = data.blocks.filter(b => b.type === 'text').length;
       return 'wrote ' + OUT + ' + ' + TXT_OUT + ' | deck=' + (data.deckHtml ? 'yes' : 'no') + ' | text=' + txtBlocks
         + ' | small-caps=' + (body.match(/<small>/g) || []).length
         + ' | images=' + imgs.length + ' [' + imgs.filter(b => b.url).map(b => (b.url.match(/images\/([^?/]+)/) || [, '?'])[1]).join(', ') + ']'
         + ' | infographics=' + infographics.length;
     }
     ```
     (Set `SOURCE_NAME` at the top = `WSJ` or `The Economist` — the short WSJ form, so the top bar stays one line on phones.) The live article tab is left in place, so a re-run (after fixing a filter, say) needs no re-navigation.
   - **Verify it:** the snippet returns `deck=yes|no` (was the standfirst captured?), a `text=` paragraph count, a **`small-caps=N`** count (acronyms preserved as small caps — expect `N≥1` on any Economist article, which sets AI/IBM/GPT in `<small>`; `0` there means the typography walk missed them), an `images=N [slugs]` list, and an **`infographics=N`** count (Economist iframe maps/charts captured separately in step 0). **Confirm acronym casing survived** into the extracted text — `grep -oE "\\b(AI|ai|IBM|ibm)\\b" article-text/YYYY-MM-DD.txt | sort | uniq -c` should show **uppercase** AI/IBM, not lowercase; lowercase means the `font-variant-caps`/raw-text-node path regressed to `innerText`. Expect `text` **roughly one per paragraph** (≈12–40 for a feature; under ~8 means the `article p`/`<article>` selectors missed the body and you got page chrome — re-check login/selectors), and `images` to roughly match the **real `<figure>` charts/photos** in the body (often 1–4; **`images=0` on an article you know has a chart means the image step failed** — usually a paywall/login issue or the figure markup differs, so don't ship it without checking). **On an Economist day with a map or data chart, confirm `infographics≥1`** — and when you eyeball the page (below), check the map shows **with its labels and legend**; a labels-less map means the widget didn't render (re-run) and a bare-PNG fetch would have that failure mode. For an obituary or feature whose subtitle states a key fact (death date, age, who-did-what), confirm `deck=yes`; if it's `no`, the standfirst didn't match the selectors — grab it from `browser_snapshot` and prepend it to the text by hand. **Check the article's real ending survived AND no footer junk trailed in** — `tail -c 300 article-text/YYYY-MM-DD.txt` should end on the article's actual closing sentence (Economist pieces end with `■`), not a newsletter promo; a promo tail means the page grew a new footer block the `STOP` regex doesn't know — add its opening phrase to `STOP` and re-run. Then `ls -la public/articles/YYYY-MM-DD.html` (expect **~50KB–1MB** with images inlined; **several MB means the image step grabbed something huge** — re-check). **Always render the page and eyeball it at a phone width** — that the text reflows full-width and the charts/photos appear and are legible. `file://` is blocked in the Playwright browser, so serve `public/` for a minute: `cd public && python3 -m http.server 8734` (background it), `browser_resize` to 390×844, `browser_navigate` to `http://localhost:8734/articles/YYYY-MM-DD.html`, screenshot (`fullPage: true`) and look at it; then kill the server (`pkill -f "http.server 8734"`). If `text=0`/near-empty, the paywall wasn't cleared — re-check login or use the manual fallback below.
   - Set `articlePageUrl: "/articles/YYYY-MM-DD.html"` in the JSON (and no `pdfUrl` — that's the legacy field for pre-article-page days). The index row then shows the single **ARTICLE** button. This now applies to **every** day, open or paywalled — only the manual-fallback case below omits it.
   - **Multi-article days** (the `articles[]` shape — see step 5): capture **one page per article**. `browser_navigate` to each article in turn, then run the snippet writing to `public/articles/YYYY-MM-DD-1.html`, `-2.html`, … and `article-text/YYYY-MM-DD-1.txt`, `-2.txt`, … (note the `-N` suffix), and put each page path in that article's own `articlePageUrl` inside `articles[]` — there is no top-level `articlePageUrl`. Concatenate the per-article text files into one `article-text/YYYY-MM-DD.txt` before the Blob upload below.
   - **Manual fallback** (only if auto-capture can't work on an odd page): omit `articlePageUrl` — the index then falls back to the legacy Web link (and a `pdfUrl` if you set one: the user can still hand-save a PDF into the repo-root `PDFs/` drop-zone and you `cp` it to `public/pdfs/YYYY-MM-DD.pdf`).
   - **Upload the full article text (for the voice quiz).** The home-page **Voice quiz** (`voiceQuiz: true`, see step 6) reads much better when the tutor has the *whole* article, not just the handout — it then judges the student's from-memory retelling against the real story. The capture snippet already wrote `article-text/YYYY-MM-DD.txt` (headline + deck first, then the body), so just upload it to **Vercel Blob** (we keep the full text **out of git** — the hard rule is never republish article text — so Blob is its home; `public/articles/` is served, not "republishing to git readers", and carries a `noindex` meta):
     ```sh
     node --env-file=.env.local scripts/upload-article-text.mjs YYYY-MM-DD
     ```
     Needs `BLOB_READ_WRITE_TOKEN` in `.env.local` (`vercel env pull` to get it). Best-effort: if it's skipped or fails, the quiz still works — it just falls back to a handout-only session. The `article-text/` dir is a gitignored drop-zone. The capture in step 3 writes this file for **every** day now, open or paywalled, so there's normally nothing to do by hand. **If the text file was written by hand** (a manual-fallback day), **always include the headline AND the deck/standfirst** (the subtitle line under the headline) at the very top, before the body — the standfirst often carries key facts that appear nowhere in the body (e.g. an obituary's "...died on June 22nd, aged 100"), and dropping it can make the grader wrongly mark a correct student answer as not-in-the-article.

4. **Propose the words and concepts, and get the user's sign-off before generating anything.** This is a required manual checkpoint — **do not write the JSON or generate the quiz until the user approves.** Based on your read of the article:
   - Pick your candidate **3 vocab words** and **up to 3 concepts** (as many strong, transferable ideas as the article genuinely supports, capped at three — fewer is fine, even zero on a vocab-only day; the user can override the count) per the calibration above.
   - Present them to the user as a short proposal: for each word, the word plus the short article quote it comes from and a one-line gloss of why it's worth teaching; for each concept, the concept name plus a one-line description of the idea and why it's broadly useful. Keep it skimmable — this is for the user to react to, not the finished card text.
   - **Multi-article days** (when the user asks to bundle two short articles into one handout): propose **one combined** set of words and concepts drawn from *all* the day's articles, balanced so each article is represented (e.g. ~2 vocab + ~2 concepts per article). It's fine to run slightly higher counts than usual (e.g. 4 vocab / 4 concepts) since there's more source material; note which article each pick comes from. The 5-question quiz still spans the whole bundle.
   - **Discuss and revise.** The user may swap words/concepts in or out, ask for harder or easier picks, or adjust the framing. Iterate until they explicitly give the go-ahead. Treat this as the quality gate: the point is to fix the selection *before* the expensive generation, not after.
   - Only once the user approves the final list do you move on to drafting the full handout (step 5).

5. **Draft the handout content.** Using the approved words and concepts, write the full cards (vocab is still article-first: `articleQuote` → `inContext` → `meaning` → `examples`, plus a `pronunciation` respelling and `partOfSpeech`; concepts are `articleQuote` → a single Feynman-style `meaning` with ≥1 concrete example — no `inContext`) and the 5-question quiz per the calibration above. Pick a clear, descriptive `title` (it can match WSJ's headline or be a plainer version). **Do not invent a subtitle.** Use the article's own headline (or a plainer paraphrase of it); only include a subtitle/colon-tagline if the original article actually has one. Don't append your own "How X did Y"-style subtitle. **No author byline in the `title`** (owner's rule, 2026-07-25) — the headline alone, even for a signed essay by a famous writer. This is a **front-page-list rule, not a general aversion to naming authors**: the `title` is what the index renders in each row, and a trailing `by <Author Name>` bloated the row and read as clutter in a list. An earlier rule did the opposite (append `by <Author Name>` for notable essayists); the four days that carried such a title — 2026-06-13, 07-05, 07-17, 07-25 — were shortened when it was reversed. **Everywhere else, name the author freely and normally** — vocab `inContext`, concept `meaning`, quiz questions and explanations, glossary entries, the article page's `SOURCE:` bar, and the `source` field all keep saying "Graham argues…", "Asimov's characters…". Attribution in the prose is good writing; it's only the list row that stays clean. The pages are intentionally minimal: the handout shows **just the title** at the top (no date, no summary or "big idea" blurb), then the words and concepts; the quiz lives on its own page (`/reading/<date>/quiz`). The index is a **row-list**, one row per day — date · title · boxed action buttons **ARTICLE / HANDOUT / AI QUIZ** (the ARTICLE button → the day's `articlePageUrl`; historical days without one show the legacy **WEB / PDF** pair instead). The self-quiz lives as a CTA at the bottom of each handout (`/reading/<date>/quiz` — every day has one, keep generating the 5-question quiz), and the AI QUIZ button shows for any day with `voiceQuiz: true` (login is checked on click). The way back to the index from any inner page is the header's "RC" monogram; the handout and quiz pages have no inline back-link of their own. Don't estimate reading time either — it varies too much per student, and they're expected to re-read.
   - **Multi-article days:** set `articles: [{ title, articleUrl, articlePageUrl }, …]` instead of the top-level `articleUrl`/`articlePageUrl` (one entry per source, in reading order). The handout `title` is then an **umbrella title** for the bundle (e.g. `"World Cup News"`) — this is the one case where a combined title beats a single headline; each individual article keeps its real WSJ headline inside `articles[]`. The index row shows one button per source (**ARTICLE 1 · ARTICLE 2 · …**, each → that article's `articlePageUrl`). The handout and quiz are unchanged — one combined page. (First example, from the legacy PDF era: `content/2026-06-14.json`.)

6. **Write `content/YYYY-MM-DD.json`** following the schema below exactly (include the `articlePageUrl` from step 3). Validate it's well-formed JSON.
   - **Vote day → `clubPick: true`.** If the day's article was chosen by the club vote (the wsj-open-vote/wsj-check-vote flow — check with `node --env-file=.env.local scripts/check-vote.mjs YYYY-MM-DD`, or just: a poll exists for this date), set `"clubPick": true` so the index row carries the CLUB PICK chip. Publishing the reading is also what **closes** that poll — the home-page vote row disappears once this deploy lands, no extra step. On a non-vote day, omit the field.
   - **Generate pronunciation audio.** Each **vocab word** and **concept name** gets a ▶ "hear it" button on the handout that plays a pre-generated OpenAI-TTS clip (a natural US-English voice, `alloy`). Generate them from the just-written JSON:
     ```sh
     node --env-file=.env.local scripts/gen-pronunciation.mjs YYYY-MM-DD
     ```
     This writes one `public/audio/YYYY-MM-DD/<slug>.mp3` per term (idempotent — skips existing clips; `--force` to redo). Needs `OPENAI_API_KEY` in `.env.local`. The clips are **committed and CDN-served** (like `public/pdfs/`) — so `git add public/audio/YYYY-MM-DD` at commit time (step 8). **There is NO browser-speech fallback** — the handout renders the ▶ button only for terms whose clip exists on disk, so a term that didn't get a clip just shows no button (never a dead one). That makes it important the generator ran for **every** vocab word + concept name; the run prints `made=/skipped=/failed=` and exits non-zero on any failure, so re-run (or `--force`) until `failed=0`. There's **no phonetic respelling text** — the audio is the whole feature.
   - **Author the tap-a-word GLOSSARY (article-page days only).** Every served article page has a pre-baked glossary: tapping any word or phrase on `/articles/YYYY-MM-DD.html` pops up a bottom-sheet explanation (`public/glossary.js`/`.css`, shared site-wide — the page loads `/glossaries/<its-own-name>.json`, no JSON → silent no-op). **You author the day's glossary JSON yourself** (no script generates it) at `public/glossaries/YYYY-MM-DD.json` — a JSON array of `{k, t, kind, pron?, forms, text}` entries:
     - `k` unique kebab-case key · `t` display form · `kind` one of `"vocab"` (the day's handout words — copy `pron` from the content JSON's `pronunciation`, weave its `inContext`+`meaning` into one flow) | `"word"` | `"phrase"` | `"name"` · `forms` = surface forms occurring **verbatim in this article's text** (include inflections that appear; first form is the one visually marked) · `text` = **ONE woven explanation** (2–4 sentences) blending the general meaning and the meaning in this article into continuous prose — **NO "In this article:"/"In general:" labels** (that split was explicitly rejected by the owner).
     - **Selection taste** (~35–60 entries per ~1000 words): (1) every handout vocab word appearing in the text; (2) **sense-trap words** — everyday words whose common meaning misleads here ("outfit"=company, "fare"=perform, "compromise"=break into) — the highest-value category; (3) **idioms/multi-word phrases** ("crib sheet", "on the fly") — kids know each word but miss the whole; (4) genuinely hard general vocab for grades 8–10; (5) a few `"name"` one-liners for proper nouns/jargon needed to follow the story. Don't pad with words the band obviously knows. The exemplar the owner approved is `public/glossaries/2026-07-23.json`.
     - **Validate + wire up:** `node scripts/check-glossary.mjs YYYY-MM-DD` must print `ok` (it checks every entry's forms actually occur in the page text), then `node scripts/add-glossary-tags.mjs public/articles/YYYY-MM-DD.html` injects the two shared tags into the captured page (idempotent). Commit the JSON with the page (step 8). **Every day gets a glossary now** — including open-link days, which is the whole reason open articles are captured at all (2026-07-25). The only exception is a manual-fallback day with no captured page. **Multi-article days:** one glossary per page (`YYYY-MM-DD-1.json`, `-2.json`, …), each validated against its own page.

7. **Build to verify:** run `npm run build`. It must succeed. If a new file breaks the build, it's almost always malformed JSON — fix it.

8. **Commit, push, and share the links.** Stage the new content, article page, glossary, and audio — `git add content/YYYY-MM-DD.json public/articles/YYYY-MM-DD.html public/glossaries/YYYY-MM-DD.json public/audio/YYYY-MM-DD` (add any other changed files too) — commit, and `git push origin main`. **Pushing is shipping:** the push auto-deploys to Vercel production at `wsjclub.vercel.app` (no `vercel --prod` step). Once the deploy lands, give the user today's links: `https://wsjclub.vercel.app/reading/YYYY-MM-DD` (handout) and `https://wsjclub.vercel.app/reading/YYYY-MM-DD/quiz` (quiz).

## Content file schema

`content/YYYY-MM-DD.json`:

```json
{
  "date": "2026-06-09",
  "title": "A clear, descriptive title",
  "articleUrl": "https://www.wsj.com/...the real article link...",
  "articlePageUrl": "/articles/2026-06-09.html",
  "voiceQuiz": true,
  "source": "The Wall Street Journal",
  "vocab": [
    {
      "word": "voracious",
      "partOfSpeech": "adjective",
      "pronunciation": "vuh-RAY-shus",
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
      "meaning": "ONE Feynman-style explanation: name the field it belongs to (economics, statistics, …) when obvious, open with an intuitive hook/analogy, explain how it works in plain language, and ground it with at least one concrete example. No separate inContext field."
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
- `clubPick`: set `"clubPick": true` **only when the day's article won the club vote** (see step 6) — it renders the CLUB PICK chip on the index row. Omit on normal days.
- `articlePageUrl` is the served path under `public/` (i.e. `/articles/YYYY-MM-DD.html`), **not** a filesystem path — set it on **every** new day, open-link or paywalled (2026-07-25: open articles are captured too, so their pages can carry the tap-a-word glossary). Keep `articleUrl` too — it's the source-of-record link to the original. A day with neither `articlePageUrl` nor `pdfUrl` still works — the ARTICLE button links straight to `articleUrl` — but that's now only the manual-fallback case. (`pdfUrl` is a legacy field from the pre-article-page days — don't set it on new days; days that have it keep the old Web/PDF pair.)
- `answerIndex` is **0-based** (0 = first option). Double-check it points at the correct option.
- `vocab` has **exactly 3 words** (a multi-article day may run ~4); each `examples` array has **exactly 2** sentences.
- All `articleQuote` fields are short (one sentence/phrase) and taken from the actual article.
- Keep 4 options per quiz question.
- **Multi-article days:** replace the top-level `"articleUrl"`/`"articlePageUrl"` with an `"articles"` array — `"articles": [{ "title": "First WSJ headline", "articleUrl": "https://www.wsj.com/…", "articlePageUrl": "/articles/YYYY-MM-DD-1.html" }, { "title": "Second WSJ headline", "articleUrl": "…", "articlePageUrl": "/articles/YYYY-MM-DD-2.html" }]`. Keep one combined `vocab`/`concepts`/`quiz`. (The pre-article-page example `content/2026-06-14.json` uses the legacy `pdfUrl` shape.)

The TypeScript types backing this live in `lib/content.ts` — if you change the schema, update that file and the page components too (`app/reading/[date]/page.tsx` for words/concepts, `app/reading/[date]/quiz/page.tsx` for the quiz).

## Deployment

The site auto-deploys from GitHub (`cosmic-glitch/wsj_club`): **`git push origin main` ships to Vercel production** at `wsjclub.vercel.app`. There is no manual `vercel --prod` step in the daily flow.

- **Daily:** commit the new `content/YYYY-MM-DD.json` and `public/pdfs/YYYY-MM-DD.pdf`, then `git push origin main`. Vercel builds and deploys from the push; the local `npm run build` (step 6) is the pre-flight that catches malformed JSON before you push.
- **Fallback only:** if the Git auto-deploy is ever unavailable, `vercel --prod` from the repo root deploys the working tree directly (first-time setup needs `vercel link` once).

After the deploy lands, share the live links to today's reading with the user.

## If the user asks for changes

- "make the quiz harder / longer", "add more words", "the definition for X is off" → edit that day's JSON and redeploy.
- Design/layout changes (colors, sections, new field) → edit `app/`, `components/`, `lib/content.ts`, then build and redeploy.
