---
name: wsj-reading
description: Create the daily WSJ Reading Club handout. Use when the user gives a Wall Street Journal article link (or says "today's reading", "new WSJ reading", "add today's article"). Reads the article in the browser, then generates a vocabulary list, a concepts section, and a 5-question self-quiz calibrated for US grade 8-10 students, writes it as a content JSON file, builds, and deploys to Vercel.
---

# WSJ Reading Club — daily handout

You are producing one day's study handout for the **WSJ Reading Club**: a small group of four kids in US grades 8–10, all reasonably strong students with SAT verbal roughly in the late-500s to late-600s range. The goal is to grow their general knowledge of the world, their vocabulary, and their conceptual understanding — using one Wall Street Journal article a day.

The website is already built (Next.js in this repo). Your job each day is **only to produce one content file** and deploy. The site renders it; the index updates itself. Do not hand-write HTML or touch the page components unless the user asks for a design change.

## The audience calibration (this is the whole point — get it right)

Everything you write is for a sharp 13–16 year old, not a finance professional and not a child. Concretely:

- **Vocabulary**: pick **exactly 3 words** — the strongest, most useful ones, not a long list. Choose words *this* reader plausibly does **not** know yet but *should*. Skip words they certainly know (e.g. "increase", "company"). Skip words so obscure they'll never see them again. The sweet spot is the kind of word that shows up on the SAT and in serious journalism: *voracious, ostensibly, incumbent, scrutiny, untenable, proliferate, mitigate, capitulate*. **Present each word article-first**, in this order:
  1. `articleQuote` — how the word actually appears in the article (a short real quote/sentence containing the word).
  2. `inContext` — what the word means right *there*, in the article's situation.
  3. `meaning` — generalize to the broader, everyday definition.
  4. `examples` — **two more** example sentences (beyond the article), in situations a teenager relates to.
- **Concepts**: the richer layer the article assumes you already understand — the things a definition alone won't fix. Examples: *hyperscalers, private credit, capital expenditure, quantitative easing, yield curve, vertical integration, moral hazard*. Aim for **3–5 concepts**, and present each one article-first too:
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

3. **Place the day's PDF.** The user saves the WSJ article as a PDF into the `PDFs/` drop-zone at the repo root (raw WSJ filename, e.g. `Wall Street Is Rushing… - WSJ.pdf`). Copy it to the served, date-named path: `cp "PDFs/<that file>.pdf" public/pdfs/YYYY-MM-DD.pdf` (run `mkdir -p public/pdfs` first if needed). Only `public/` is served by Next, so the PDF **must** live under `public/pdfs/`. You'll reference it as `"/pdfs/YYYY-MM-DD.pdf"` in the JSON's `pdfUrl`. If the user hasn't dropped a PDF, ask for it (or omit `pdfUrl` — the page then shows only the Web link). The raw `PDFs/` drop-zone is gitignored; the `public/pdfs/` copy is what gets committed and deployed.

4. **Draft the handout content.** Decide the words, concepts, and quiz per the calibration above. Pick a clear, descriptive `title` (it can match WSJ's headline or be a plainer version). The pages are intentionally minimal: the handout shows **just the title** at the top (no date, no summary or "big idea" blurb), then the words and concepts; the quiz lives on its own page (`/reading/<date>/quiz`). The index is a stack of one panel per day (date · title · four steps); the article links appear only there, in the first step — **Read the article: Web · PDF** (Web → `articleUrl`, PDF → `pdfUrl`; the title itself is plain text, not a link). The only "← All readings" link is in the global header bar (`app/layout.tsx`); the handout and quiz pages have no inline back-link of their own. Don't estimate reading time either — it varies too much per student, and they're expected to re-read.

5. **Write `content/YYYY-MM-DD.json`** following the schema below exactly (include `pdfUrl` if you placed a PDF). Validate it's well-formed JSON.

6. **Build to verify:** run `npm run build`. It must succeed. If a new file breaks the build, it's almost always malformed JSON — fix it.

7. **Deploy to Vercel** (see Deployment below) and give the user the live URL for today's reading: `<site>/reading/YYYY-MM-DD` (the quiz is at `<site>/reading/YYYY-MM-DD/quiz`).

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
- `vocab` has **exactly 3 words**; each `examples` array has **exactly 2** sentences.
- All `articleQuote` fields are short (one sentence/phrase) and taken from the actual article.
- Keep 4 options per quiz question.

The TypeScript types backing this live in `lib/content.ts` — if you change the schema, update that file and the page components too (`app/reading/[date]/page.tsx` for words/concepts, `app/reading/[date]/quiz/page.tsx` for the quiz).

## Deployment

The site deploys to Vercel as a static Next.js app.

- **First time only:** link the project with `vercel link` (or `vercel` and follow prompts), then deploy with `vercel --prod`. Alternatively use the Vercel MCP `deploy_to_vercel` tool. Record the production URL.
- **Every day after:** `vercel --prod` from the repo root pushes the new content live. (If the project is later connected to a Git repo, a `git push` will auto-deploy instead — use whichever is set up.)

After deploying, share the live link to today's reading with the user.

## If the user asks for changes

- "make the quiz harder / longer", "add more words", "the definition for X is off" → edit that day's JSON and redeploy.
- Design/layout changes (colors, sections, new field) → edit `app/`, `components/`, `lib/content.ts`, then build and redeploy.
