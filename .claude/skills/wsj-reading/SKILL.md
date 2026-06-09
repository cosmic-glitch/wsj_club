---
name: wsj-reading
description: Create the daily WSJ Reading Club handout. Use when the user gives a Wall Street Journal article link (or says "today's reading", "new WSJ reading", "add today's article"). Reads the article in the browser, then generates a vocabulary list, a concepts section, and a 5-question self-quiz calibrated for US grade 8-10 students, writes it as a content JSON file, builds, and deploys to Vercel.
---

# WSJ Reading Club — daily handout

You are producing one day's study handout for the **WSJ Reading Club**: a small group of four kids in US grades 8–10, all reasonably strong students with SAT verbal roughly in the late-500s to late-600s range. The goal is to grow their general knowledge of the world, their vocabulary, and their conceptual understanding — using one Wall Street Journal article a day.

The website is already built (Next.js in this repo). Your job each day is **only to produce one content file** and deploy. The site renders it; the index updates itself. Do not hand-write HTML or touch the page components unless the user asks for a design change.

## The audience calibration (this is the whole point — get it right)

Everything you write is for a sharp 13–16 year old, not a finance professional and not a child. Concretely:

- **Vocabulary**: choose words *this* reader plausibly does **not** know yet but *should*. Skip words they certainly know (e.g. "increase", "company"). Skip words so obscure they'll never see them again. The sweet spot is the kind of word that shows up on the SAT and in serious journalism: *voracious, ostensibly, incumbent, scrutiny, untenable, proliferate, mitigate, capitulate*. Aim for **5–8 words**.
- **Concepts**: the richer layer the article assumes you already understand — the things a definition alone won't fix. Examples: *hyperscalers, private credit, capital expenditure, quantitative easing, yield curve, vertical integration, moral hazard*. Explain how the thing actually **works**, in plain language, then why it matters in the world. Aim for **3–5 concepts**.
- **Quiz**: exactly **5 multiple-choice questions**. Mix comprehension of the article with the vocabulary/concepts above. Make wrong options plausible, not silly. Every question gets a one-sentence explanation.
- **Tone**: clear, respectful, a little warm. Examples should use situations a teenager relates to (school, sports, friends, games) — not abstract finance.

## Hard rules

- **Never republish WSJ's article text.** WSJ is paywalled subscription content. Write **original** material: your own definitions, your own concept explanations, your own quiz questions. Link to the article; don't reproduce it. A short paraphrased "in the article" note per word is fine.
- **One file per day.** Filename is the date: `content/YYYY-MM-DD.json`. If the user gives a different date, use that.
- Don't invent facts about the article. If something is unclear, open the page and read it rather than guessing.

## Daily workflow

1. **Get the inputs.** You need the article URL. Confirm the date (default to today). If the user didn't paste a URL, ask for it.

2. **Read the article in the browser.** Use the Playwright browser tools:
   - `browser_navigate` to the URL.
   - WSJ requires login. Tell the user: *"I've opened the article — please log into WSJ in the browser window, then tell me when you're in."* Wait for them. Do **not** ask for or store their password; they log in themselves.
   - Once past the paywall, read the full article (`browser_snapshot`, or scroll and read). Capture: the real headline, the byline/section if useful, and the substance — main argument, key facts, and any jargon a teenager would trip on.

3. **Draft the handout content.** Decide the words, concepts, and quiz per the calibration above. Pick a clear, descriptive `title` (it can match WSJ's headline or be a plainer version). Keep the handout page itself brief — no summary or "big idea" blurb; the title plus the WSJ link is enough orientation before the words/concepts/quiz. (Don't estimate reading time either — it varies too much per student, and they're expected to re-read.)

4. **Write `content/YYYY-MM-DD.json`** following the schema below exactly. Validate it's well-formed JSON.

5. **Build to verify:** run `npm run build`. It must succeed. If a new file breaks the build, it's almost always malformed JSON — fix it.

6. **Deploy to Vercel** (see Deployment below) and give the user the live URL for today's reading: `<site>/reading/YYYY-MM-DD`.

## Content file schema

`content/YYYY-MM-DD.json`:

```json
{
  "date": "2026-06-09",
  "title": "A clear, descriptive title",
  "articleUrl": "https://www.wsj.com/...the real article link...",
  "source": "The Wall Street Journal",
  "vocab": [
    {
      "word": "voracious",
      "partOfSpeech": "adjective",
      "definition": "Plain, kid-friendly definition.",
      "example": "A sentence a teenager would relate to.",
      "inContext": "Optional: how the idea showed up in the article, paraphrased."
    }
  ],
  "concepts": [
    {
      "name": "Hyperscalers",
      "explanation": "How the thing actually works, in plain language.",
      "whyItMatters": "How it connects to the article and the wider world."
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
- `answerIndex` is **0-based** (0 = first option). Double-check it points at the correct option.
- `inContext` is optional but nice to include.
- Keep 4 options per quiz question.

The TypeScript types backing this live in `lib/content.ts` — if you change the schema, update that file and the page components too.

## Deployment

The site deploys to Vercel as a static Next.js app.

- **First time only:** link the project with `vercel link` (or `vercel` and follow prompts), then deploy with `vercel --prod`. Alternatively use the Vercel MCP `deploy_to_vercel` tool. Record the production URL.
- **Every day after:** `vercel --prod` from the repo root pushes the new content live. (If the project is later connected to a Git repo, a `git push` will auto-deploy instead — use whichever is set up.)

After deploying, share the live link to today's reading with the user.

## If the user asks for changes

- "make the quiz harder / longer", "add more words", "the definition for X is off" → edit that day's JSON and redeploy.
- Design/layout changes (colors, sections, new field) → edit `app/`, `components/`, `lib/content.ts`, then build and redeploy.
