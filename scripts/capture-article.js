// The article-page CAPTURE snippet — the ONE implementation both flows run
// (CLAUDE.md: "the fragile snippet is single-sourced"). It rebuilds a clean,
// self-contained, responsive reading page from the open article's own
// paragraphs and real content images, and writes the plain article text for
// the voice quiz in the same pass. Nothing else captures articles.
//
// It is a bare `async (page) => {…}` EXPRESSION (not a module — no imports, no
// exports, no `process`), because one of its runtimes is the Playwright MCP's
// vm sandbox, which has no `fs` and no dynamic import:
//
//   • INTERACTIVE (the wsj-reading / wsj-reading-junior skills, Playwright MCP):
//       browser_evaluate  → set window.__captureOpts = { out, txtOut, sourceName, back }
//       browser_run_code_unsafe { filename: "<repo>/scripts/capture-article.js" }
//     (`filename` loads this file verbatim; the MCP only allows files under the
//     repo root, which is why it lives here and not in .bot/.)
//   • AUTONOMOUS (the auto-publish skill on the Hetzner box): .bot/capture.mjs
//     sets the same window.__captureOpts on its own logged-in page, `eval`s this
//     file to get the function, and awaits it.
//
// Options (read from window.__captureOpts on the OPEN article page — every field
// required; absolute paths):
//   out        → public/articles/<date>.html          (junior: public/articles/junior/<date>.html)
//   txtOut     → article-text/<date>.txt              (junior: article-text/junior/<date>.txt)
//   sourceName → 'The Economist' | 'WSJ'  (the short WSJ form — the full name wraps the top bar on phones)
//   back       → '/' (senior) | '/junior'  (the page's "← Reading Club" link)
// The original URL is auto-derived from the open page (it IS the original) and
// renders as the top bar's "Source: <publication>" link.
//
// Output: both files (written via Playwright's download event, which works in
// both runtimes) and a one-line verification summary the caller must check:
//   deck=yes|no · text=<paragraphs> · small-caps=<n> · images=<n> [slugs] · infographics=<n>
// The article tab is left in place; throwaway tabs (infographic screenshots,
// file saves) are closed. Edit this file ONLY — never re-inline it in a skill.
async (page) => {
  const OPTS = await page.evaluate(() => window.__captureOpts || null);
  for (const k of ['out', 'txtOut', 'sourceName', 'back']) {
    if (!OPTS || typeof OPTS[k] !== 'string' || !OPTS[k]) throw new Error('capture: window.__captureOpts.' + k + ' is missing — set { out, txtOut, sourceName, back } on the article page first');
  }
  const OUT = OPTS.out;               // absolute path of the served article page
  const TXT_OUT = OPTS.txtOut;        // absolute path of the plain article text (voice-quiz reference)
  const SOURCE_NAME = OPTS.sourceName;
  const BACK = OPTS.back;
  const ORIG_URL = page.url(); // the open article IS the original — no substitution needed
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
    const STOP = /^(This article appeared in|Discover stories from this section|Sign up to|Stay on top of|Get exclusive analysis|Curious about the world|Explore more|To track the trends shaping|Subscribers to The Economist can sign up|For more on the latest books|For subscribers only|(?:Spanish|Russian|Arabic|Japanese|French|German|Chinese|Korean|Italian|Portuguese|Turkish|Hebrew|Polish|Dutch|Persian) Translation)\b/i;
    const SKIP = /^(Save|Share|Listen to this story|Video:|Delivered to your inbox|0:00|Advertisement|Read the rest of our cover package)\b/i;
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
    for (const n of art.querySelectorAll('p, h2, h3, figure, iframe')) {
      // ECONOMIST INFOGRAPHIC MAPS/CHARTS are `infographics.economist.com` IFRAMES
      // (ai2html widgets), NOT <figure><img> — record a placeholder AT THIS SPOT so
      // the screenshot (taken in step 1b, after this walk) lands at the chart's own
      // position in the reading flow, beside the paragraph that references it (an
      // earlier build spliced them all after the 2nd paragraph, scrambling the
      // order). WSJ / no-chart days find no such iframe and skip this entirely.
      if (n.tagName.toLowerCase() === 'iframe') {
        const src = n.src || '';
        if (/infographics\.economist\.com/.test(src)) blocks.push({ type: 'img', infographic: src, caption: '' });
        continue;
      }
      if (n.tagName.toLowerCase() === 'figure') {
        const vid = n.querySelector('video');
        if (vid) {                                         // video-led figure: its poster FRAME is the day's art — keep it (skipping these shipped hero-less pages twice)
          const pUrl = vid.poster || vid.getAttribute('poster') || '';
          if (/^https?:\/\//.test(pUrl) && !seen.has(pUrl)) { seen.add(pUrl); blocks.push({ type: 'img', url: pUrl, caption: '' }); }
          continue;
        }
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
  // 1b) Screenshot each infographic placeholder IN PLACE. The widget's artboard PNG
  //     is only the BASE art — its labels + legend are a separate HTML overlay — so
  //     fetching the raw PNG would yield a chart with NO text. Instead open each in a
  //     THROWAWAY TAB and screenshot the RENDERED widget (base + labels composited),
  //     zoomed 2x so the ~1400px artboard is captured crisp, clipped to the drawn bounds.
  for (const b of data.blocks) {
    if (!b.infographic) continue;
    const tab = await page.context().newPage();
    try {
      await tab.setViewportSize({ width: 1700, height: 1900 });
      await tab.goto(b.infographic, { waitUntil: 'networkidle' });
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
      b.dataUri = 'data:image/png;base64,' + buf.toString('base64');
    } catch { b.skip = true; }   // best-effort: a chart that won't capture is just skipped
    finally { await tab.close(); }
  }
  // 2) Fetch each kept image through the *authenticated browser context*
  //    (page.request shares cookies and is not subject to CORS) and inline it
  //    as a data: URI, so the page is fully self-contained. Skip blocks that
  //    already carry a dataUri — those are the infographics we just screenshotted.
  for (const b of data.blocks) {
    if (b.type !== 'img' || b.dataUri || !b.url) continue;
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
  //    it reflows to the phone's width, so text is never
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
    + ' | infographics=' + data.blocks.filter(b => b.infographic && b.dataUri).length;
}
