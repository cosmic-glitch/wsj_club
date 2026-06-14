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

2. **Read the article in the browser.** Use the Playwright browser tools:
   - `browser_navigate` to the URL.
   - WSJ requires login. Tell the user: *"I've opened the article — please log into WSJ in the browser window, then tell me when you're in."* Wait for them. Do **not** ask for or store their password; they log in themselves.
   - Once past the paywall, read the full article (`browser_snapshot`, or scroll and read). Capture: the real headline, the byline/section if useful, and the substance — main argument, key facts, and any jargon a teenager would trip on.

3. **Capture the day's PDF automatically — but only for sign-in/paywalled articles.** The PDF exists so the club can still read paywalled WSJ pieces. **If the article is on a freely open link that needs no login** (e.g. a public essay or open-access page), **skip the PDF entirely** — don't capture one, omit `pdfUrl` from the JSON, and the index will show just the Web link. Only do the capture below when the source sits behind a sign-in/paywall. With the article open and the user logged in (from step 2), save the page **straight to the served path** — no manual print/save step. Capture it **text-focused**: isolate the `<article>`, drop the images, and print with `printBackground:false`. **Why:** `page.pdf()` emulates *print* media, where Chromium picks the **largest `srcset` candidate** for every `<img>` (WSJ photos go up to ~5000px) and also keeps the page's endless "recommended" feed — left in, a short article balloons to **40–50MB**. Stripping images first lands it at **~100KB** of clean, complete text, which is all the club needs. Only `public/` is served by Next, so the PDF must end up at `public/pdfs/YYYY-MM-DD.pdf` and is referenced as `"/pdfs/YYYY-MM-DD.pdf"` in the JSON's `pdfUrl`.
   - Make the folder: `mkdir -p public/pdfs`.
   - Use `browser_run_code_unsafe` — **substitute the real date** in `OUT`:
     ```js
     async (page) => {
       const OUT = '/Users/anuragved/code/wsj_club/public/pdfs/YYYY-MM-DD.pdf'; // ← real date
       // 1) Isolate the article: remove only the siblings along its ancestor chain,
       //    so nav, the endless "recommended" feed, and the footer all go away.
       await page.evaluate(() => {
         const art = document.querySelector('article') || document.querySelector('main');
         let node = art;
         while (node && node.parentElement && node !== document.body) {
           const parent = node.parentElement;
           for (const sib of Array.from(parent.children)) if (sib !== node) sib.remove();
           node = parent;
         }
       });
       // 2) Nudge-scroll the (now short) article so its lazy text settles.
       await page.evaluate(() => new Promise(res => {
         let i = 0; (function step(){ window.scrollBy(0, innerHeight); i++;
           if (i < 10 && (window.scrollY + innerHeight) < document.body.scrollHeight) setTimeout(step, 150);
           else { scrollTo(0, 0); setTimeout(res, 500); } })();
       }));
       // 3) Drop every image (see "Why" above), then print without backgrounds.
       await page.evaluate(() => { for (const i of Array.from(document.images)) i.remove(); });
       await page.pdf({ path: OUT, format: 'Letter', printBackground: false,
         margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' } });
       return 'wrote ' + OUT;
     }
     ```
   - **Verify it:** `ls -la public/pdfs/YYYY-MM-DD.pdf` (expect ~80KB to a few hundred KB and several pages) and `file public/pdfs/YYYY-MM-DD.pdf` (expect `PDF document`). If it's a few KB / near-empty, the paywall wasn't cleared or the `<article>` selector missed — re-check login or use the manual fallback below. If it's tens of MB, the image-strip step didn't run.
   - Set `pdfUrl: "/pdfs/YYYY-MM-DD.pdf"` in the JSON. (To skip the PDF entirely, omit `pdfUrl` — the page then shows only the Web link.)
   - **Multi-article days** (the `articles[]` shape — see step 5): capture **one PDF per article**. `browser_navigate` to each article in turn, write it to `public/pdfs/YYYY-MM-DD-1.pdf`, `-2.pdf`, … (note the `-N` suffix), and put each path in that article's own `pdfUrl` inside `articles[]` — there is no top-level `pdfUrl`.
   - **Manual fallback** (only if auto-capture looks wrong): the user saves the article as a PDF by hand into the `PDFs/` drop-zone at the repo root (gitignored, raw WSJ filename), and you copy it over: `cp "PDFs/<that file>.pdf" public/pdfs/YYYY-MM-DD.pdf`. The `public/pdfs/` copy is what gets committed and deployed.

4. **Propose the words and concepts, and get the user's sign-off before generating anything.** This is a required manual checkpoint — **do not write the JSON or generate the quiz until the user approves.** Based on your read of the article:
   - Pick your candidate **3 vocab words** and **3–5 concepts** per the calibration above.
   - Present them to the user as a short proposal: for each word, the word plus the short article quote it comes from and a one-line gloss of why it's worth teaching; for each concept, the concept name plus a one-line description of the idea and why it's broadly useful. Keep it skimmable — this is for the user to react to, not the finished card text.
   - **Multi-article days** (when the user asks to bundle two short articles into one handout): propose **one combined** set of words and concepts drawn from *all* the day's articles, balanced so each article is represented (e.g. ~2 vocab + ~2 concepts per article). It's fine to run slightly higher counts than usual (e.g. 4 vocab / 4 concepts) since there's more source material; note which article each pick comes from. The 5-question quiz still spans the whole bundle.
   - **Discuss and revise.** The user may swap words/concepts in or out, ask for harder or easier picks, or adjust the framing. Iterate until they explicitly give the go-ahead. Treat this as the quality gate: the point is to fix the selection *before* the expensive generation, not after.
   - Only once the user approves the final list do you move on to drafting the full handout (step 5).

5. **Draft the handout content.** Using the approved words and concepts, write the full article-first cards (`articleQuote` → `inContext` → `meaning` → `examples` for vocab; `articleQuote` → `inContext` → `meaning` for concepts) and the 5-question quiz per the calibration above. Pick a clear, descriptive `title` (it can match WSJ's headline or be a plainer version). **Do not invent a subtitle.** Use the article's own headline (or a plainer paraphrase of it); only include a subtitle/colon-tagline if the original article actually has one. Don't append your own "How X did Y"-style subtitle. **Crediting the author:** for standard media articles (WSJ news stories, etc.), use the headline alone — no byline. But when the piece is an **essay or written work by a notable named author** (e.g. a Paul Graham essay), append `by <Author Name>` to the title — e.g. `"Cities and Ambition by Paul Graham"`. Use this only for such attributed works, not routine reportage. The pages are intentionally minimal: the handout shows **just the title** at the top (no date, no summary or "big idea" blurb), then the words and concepts; the quiz lives on its own page (`/reading/<date>/quiz`). The index is a stack of one panel per day (date · title · four steps); the article links appear only there, in the first step — **Read the article (PDF version)** (the word "article" → `articleUrl`, "PDF version" → `pdfUrl`; the title itself is plain text, not a link). The only "← All readings" link is in the global header bar (`app/layout.tsx`); the handout and quiz pages have no inline back-link of their own. Don't estimate reading time either — it varies too much per student, and they're expected to re-read.
   - **Multi-article days:** set `articles: [{ title, articleUrl, pdfUrl }, …]` instead of the top-level `articleUrl`/`pdfUrl` (one entry per source, in reading order). The handout `title` is then an **umbrella title** for the bundle (e.g. `"World Cup News"`) — this is the one case where a combined title beats a single headline; each individual article keeps its real WSJ headline inside `articles[]`. The index automatically expands the first step into one **Read the _first/second_ article — _Headline_ (_PDF version_)** step per article (each article's headline is the link), so a two-article day shows five numbered steps. The handout and quiz are unchanged — one combined page. (First example: `content/2026-06-14.json`.)

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
