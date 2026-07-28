---
name: wsj-reading-junior
description: Create a JUNIOR (US grades 5–7) Reading Club handout at /junior. Use when the user gives an article link for the junior track (or says "junior reading", "add a junior article", "/junior reading"). Same handout format as the main club — vocabulary, concepts, a 5-question self-quiz, and an AI voice quiz — but recalibrated for grades 5–7 and published under the junior/ track. The user supplies the link (directly, from a wsj-pick-article-junior recommendation, or as the junior vote's winner). Reads the article in the browser, generates the content, writes it as content/junior/YYYY-MM-DD.json, builds, and deploys.
---

# WSJ Reading Club — JUNIOR handout (grades 5–7)

You are producing one day's study handout for the **Junior Reading Club**: younger kids in **US grades 5–7**. This is a **second track** alongside the main (senior, grades 8–10) club — it shares the same site, the same logins, and the same Scores page, but lives under **`/junior`** and publishes into a **`junior/` path segment everywhere** (see the paths below). It's **occasional**, not daily, and **additive** — a junior day does not replace that day's senior reading.

**This is a sharp cohort, not a remedial one.** "Kids are sharp." Aim to grow their vocabulary, general knowledge, and conceptual understanding — just calibrated a couple of grades lower than the senior club. The mechanics (article-first vocab, Feynman-style concepts, a 5-question quiz, pronunciation audio, the AI voice quiz) are identical; only the **audience calibration** and the **output paths** differ.

The website is already built. Your job is **only to produce one content file** (plus its article page, audio, and article text) and deploy. Do not hand-write HTML or touch the page components unless the user asks for a design change.

## The audience calibration (this is the whole point — get it right for grades 5–7)

Everything you write is for a sharp **10–13 year old**. Not a finance professional, not a high-schooler, and **not a little kid** — a bright middle-schooler who can handle a real idea explained well.

- **Vocabulary**: pick **exactly 3 words** by default (the user can override the count). Choose **real words worth learning** that *this* reader plausibly does **not** know yet but *should* — one grade-band simpler than the senior club's SAT-tier picks. Skip words they certainly know ("increase", "happy") and words so obscure they'll never see them again. The sweet spot for grades 5–7: words that show up in good middle-school reading and serious-but-accessible journalism — *reluctant, abundant, tremendous, rival, sturdy, vivid, generous, deliberate, fragile, hesitate, dominate, remote*. Still real vocabulary growth, just more common than *voracious/untenable/capitulate*. **Present each word article-first**, in this order:
  1. `articleQuote` — a short real quote/sentence from the article containing the word.
  2. `inContext` — what the word means right *there*, in the article's situation.
  3. `meaning` — the broader, everyday definition.
  4. `examples` — **two more** example sentences (beyond the article), in situations a 10–13 year old relates to (school, sports, friends, games, home).
  - Also set `pronunciation` — a **plain-English US respelling** (NOT IPA): hyphen-separated syllables with the **primary-stress syllable in CAPS**, e.g. `reluctant` → `"rih-LUK-tunt"`, `abundant` → `"uh-BUN-dunt"`. It shows on the card **in place of the part of speech** (the ▶ button plays real OpenAI audio; this is the at-a-glance text guide). Still set `partOfSpeech` too — it's no longer shown on the handout but is fed to the voice-quiz tutor.
- **Concepts**: the richer layer the article assumes you already understand. **Every concept must be a general, transferable idea** — something a student can carry into other articles, classes, and life — **not the article's own topic, thesis, or central metaphor.** The test: would this concept still be worth teaching if today's article had never been written? Pick **exactly the 2 most important concepts** by default (the user can override the count) — the two ideas with the biggest transferable payoff. Junior deliberately runs fewer concepts than the senior club's 3–5: two ideas taught deeply beat four taught thinly at this age, and most articles honestly support only two great ones. **A concept gets a single, unified explanation** (`articleQuote` → `meaning`, no separate `inContext`). **For grades 5–7 the "keep it concrete" rule matters MORE, not less:** a 5th–7th grader can't lean on abstraction, so the Feynman method is the whole game —
  1. `articleQuote` — the short segment of the article where the idea appears (the anchor).
  2. `meaning` — **one clear explanation, written the way you'd explain it to a curious 11-year-old.** **Name the field the concept comes from** (owner's standing rule, 2026-07-26) — "This is an idea from **economics**…", "Scientists who study weather call this…" — in the first sentence or two, whenever the field is obvious (skip it only if the idea has no clear home, or if naming it would cost a 5th-grader more than it gives). Knowing where an idea *lives* is part of the general knowledge the club builds. Then **open with a vivid, everyday hook or analogy that makes the idea *click*** (a prediction-market price is "a thermometer for how likely something is"; supply and demand is "one ice-cream truck at a packed beach can charge more"), then explain how the thing actually **works** in plain, short sentences, and **ground it with at least one concrete example a kid pictures instantly** (recess, a video game, allowance money, a sports team, a group chat). Prefer a short, memorable example over a long abstract paragraph — even more than for the senior club. Keep sentences short. The `meaning` may run **multiple paragraphs** (blank-line separated) when the idea needs room, but don't pad. **Inline emphasis is supported**: `**bold**` and `*italic*` in any authored prose field render as real bold/italic on the page (via `lib/rich-text.tsx`), so use them where they genuinely aid comprehension — e.g. bolding the term at the moment you define it, or italicising a word being contrasted. Don't scatter them; the cards read best with a light hand. **Do not** write an `inContext` field for new concepts (legacy, no longer rendered).
  - **If the article is vocab-rich but thin on genuinely transferable, concretely-teachable concepts, it's fine to run FEWER concepts — or ship `concepts: []` (a vocabulary-only day)** rather than force weak, topic-bound concepts. The handout and voice quiz handle an empty concepts list. Never pad up to 2 — the default is a ceiling as much as a target.
  - **If a concept honestly needs several layers of background a middle-schooler doesn't have, it's too deep** — pick a more self-contained concept, or scaffold down to the *one* new idea underneath it and teach just that. One genuinely new idea per concept is the right stretch.
- **Quiz**: exactly **5 multiple-choice questions**. Mix comprehension of the article with the vocabulary/concepts above. Make wrong options plausible, not silly, but keep the reading level accessible. Every question gets a one-sentence explanation. Keep 4 options each.
- **Tone**: clear, warm, encouraging. Plain sentences. Examples use situations a 10–13 year old relates to.

**One honest constraint of this track:** WSJ and The Economist have **no easier tier** — the *prose* of a source article is often grade 10–11 even when the *story* isn't. That's fine: the handout is what carries a sharp middle-schooler through it. Pick articles whose **story** is engaging and low-prerequisite (narrative, characters, a concrete situation) even if the sentences are advanced, and let the vocab/concepts/quiz do the bridging.

## Hard rules

- **Don't republish the article.** Short quotes for study only — each `articleQuote` is **one sentence or phrase**, the minimum to show the word/idea in context. Everything else is **original** (your context explanations, definitions, examples, quiz). Never reproduce large chunks or the whole article. Always link to it.
- **One file per day, in the junior dir.** Filename is the date under `content/junior/`: `content/junior/YYYY-MM-DD.json`. If the user gives a different date, use that.
- Don't invent facts about the article. If something is unclear, open the page and read it.
- **The user supplies the link.** It may come from anywhere — pasted directly, chosen from a `wsj-pick-article-junior` recommendation, or the winner of a **junior vote** (`wsj-open-vote`/`wsj-check-vote` with `--track=junior`). This skill never picks the article itself; if no URL was given, ask for it.

## Junior output paths (the ONLY structural difference from the senior skill)

Everything the senior `wsj-reading` skill writes to a bare path, the junior track writes under a `junior/` segment:

| Artifact | Junior path |
| --- | --- |
| Content file | `content/junior/YYYY-MM-DD.json` |
| Served article page | `public/articles/junior/YYYY-MM-DD.html` |
| Pronunciation audio | `public/audio/junior/YYYY-MM-DD/<slug>.mp3` (via `gen-pronunciation.mjs … --track=junior`) |
| Article-page glossary | `public/glossaries/junior/YYYY-MM-DD.json` (check with `check-glossary.mjs junior/YYYY-MM-DD`) |
| Article text (Blob) | `article-text/junior/YYYY-MM-DD.txt` (via `upload-article-text.mjs … --track=junior`) |
| Handout URL | `/junior/reading/YYYY-MM-DD` |
| Self-quiz URL | `/junior/reading/YYYY-MM-DD/quiz` |

`articlePageUrl` in the JSON is `"/articles/junior/YYYY-MM-DD.html"` (the served path). The `voiceQuiz`, `articleUrl`, and content-shape fields are exactly as in the senior schema. (don't set them on new days.)

## Daily workflow

1. **Get the inputs.** The user supplies the article URL (pasted directly, picked from `wsj-pick-article-junior`'s recommendations, or the junior vote's winner). Confirm the date (default to today). If no URL was pasted, ask for it.

2. **Read the article in the browser.** Identical to the senior skill — use the **Playwright** browser tools (`mcp__plugin_playwright_playwright__browser_*`), **never the `claude-in-chrome` extension** (its safety classifier blocks `wsj.com`/`economist.com`). Navigate, have the **user log in themselves** (never ask for or store a password), then read the full article: the real headline, the deck/standfirst, and the substance (main argument, key facts, jargon a middle-schooler would trip on). See `wsj-reading`'s SKILL.md step 2 for the full detail.

3. **Capture the day's ARTICLE PAGE (paywalled/sign-in articles) → the JUNIOR paths, and upload the article text.** **Open/free articles need no page of our own** — omit `articlePageUrl`; the /junior index's ARTICLE button then links straight to the original (`articleUrl`). You still need the article text for the voice quiz (run the snippet anyway and `rm` the unused page file, or save the text by hand with headline + deck at the top).
   - `mkdir -p public/articles/junior article-text/junior`.
   - Use the **exact article-page capture `browser_run_code_unsafe` snippet from the senior `wsj-reading` skill's step 3** (the rebuild-a-clean-responsive-page-from-the-article's-own-paragraphs-and-real-content-images approach — it reflows on phones, preserves charts, small-caps acronyms, italics, and the drop cap, and writes the plain article text in the same pass). **The only changes for junior are the output paths and the back-link:**
     ```js
     const OUT = '/Users/anuragved/code/wsj_club/public/articles/junior/YYYY-MM-DD.html'; // ← junior dir + real date
     const TXT_OUT = '/Users/anuragved/code/wsj_club/article-text/junior/YYYY-MM-DD.txt'; // ← junior dir + real date
     const SOURCE_NAME = 'The Wall Street Journal'; // ← or 'The Economist'
     const BACK = '/junior'; // ← the page's "← Reading Club" link returns to the junior index
     ```
     (`ORIG_URL` is auto-derived from the open page — it becomes the top bar's right-aligned "Source: <publication>" link, beside the "← Reading Club" link.)
     Do not re-derive the snippet here — copy it from the senior skill so the two stay in lockstep. Verify it the same way (the returned `deck=/text=/small-caps=/images=/infographics=` counts; check the text file's tail for footer junk; serve `public/` locally and eyeball the page at a 390px viewport; expect ~50KB–1MB).
   - Set `articlePageUrl: "/articles/junior/YYYY-MM-DD.html"` in the JSON.
   - **Manual fallback** (only if auto-capture can't work): omit `articlePageUrl` — the ARTICLE button then links straight to `articleUrl`. The day loses its glossary, so treat this as a last resort.
   - **Upload the full article text for the voice quiz** (keeps the tutor able to judge the retelling against the real story). The capture snippet already wrote `article-text/junior/YYYY-MM-DD.txt` (headline + deck first, then the body), so just upload:
     ```sh
     node --env-file=.env.local scripts/upload-article-text.mjs YYYY-MM-DD --track=junior
     ```
     Needs `BLOB_READ_WRITE_TOKEN` in `.env.local`. Best-effort — the quiz degrades to handout-only if skipped. **If the text file was written by hand** (fallback days), **always put the headline AND the deck/standfirst at the top** before the body (the standfirst often carries a key fact found nowhere else).

4. **Propose the words and concepts, and get the user's sign-off before generating anything.** Required manual checkpoint — **do not write the JSON or generate the quiz until the user approves.** Based on your read:
   - Pick candidate **3 vocab words** and the **2 most important concepts** per the grades 5–7 calibration above (or fewer/zero concepts if the article is vocab-rich but concept-thin — see the calibration). It helps to shortlist 3–4 concept candidates and say which two you'd keep and why, so the user can trade one out.
   - Present them as a short, skimmable proposal: each word with its article quote + a one-line "why it's worth teaching (at this level)"; each concept with a one-line description + why it's broadly useful and how you'd make it concrete.
   - **Discuss and revise** until the user explicitly gives the go-ahead. This is the quality gate — fix the selection *before* the expensive generation.

5. **Draft the handout content.** Using the approved list, write the full cards (vocab article-first: `articleQuote` → `inContext` → `meaning` → `examples`, plus `pronunciation` + `partOfSpeech`; concepts: `articleQuote` → a single, concrete, Feynman-style `meaning` — no `inContext`) and the 5-question quiz, all at the grades 5–7 level. Pick a clear, descriptive `title`. **Do not invent a subtitle** — use the article's own headline (or a plainer paraphrase); only include a subtitle if the original actually has one. **No author byline in the `title`** (owner's rule, 2026-07-25) — the headline alone, even for a signed essay by a famous writer, because the `title` is what the index row renders and a trailing `by <Author>` clutters the list. Name the author freely **everywhere else** (concept/vocab text, quiz, glossary, the page's `SOURCE:` bar, the `source` field) — this is a list-row rule, not a general one. The junior handout is the same minimal shape as senior (just the title, then words + concepts, then the self-quiz CTA).

6. **Write `content/junior/YYYY-MM-DD.json`** following the schema below (it's the same `Reading` schema as senior — set `voiceQuiz: true`; include the `articlePageUrl` from step 3). `mkdir -p content/junior` first. Validate it's well-formed JSON.
   - **Vote day → `clubPick: true`.** If the day's article was chosen by the junior club vote (the wsj-open-vote/wsj-check-vote flow with `--track=junior` — check with `node --env-file=.env.local scripts/check-vote.mjs YYYY-MM-DD --track=junior`, or just: a junior poll exists for this date), set `"clubPick": true` so the index row carries the CLUB PICK chip. Publishing this reading is also what **closes** that poll — the /junior vote row disappears once the deploy lands, no extra step. On a non-vote day, omit the field.
   - **Generate pronunciation audio** for each vocab word + concept name → the junior audio dir:
     ```sh
     node --env-file=.env.local scripts/gen-pronunciation.mjs YYYY-MM-DD --track=junior
     ```
     Writes `public/audio/junior/YYYY-MM-DD/<slug>.mp3` per term, plus the day's AI-quiz spoken opening `quiz-intro.mp3` (the tutor voice naming the article title — same run, no extra step). Idempotent; `--force` to redo; needs `OPENAI_API_KEY`. Committed + CDN-served — re-run until `failed=0`. There's no browser-speech fallback, so the ▶ button only shows for terms whose clip exists — make sure every term got one.
   - **Author the tap-a-word GLOSSARY** for the served article page, exactly per the senior `wsj-reading` skill's step-6 glossary bullet (same `{k, t, kind, pron?, forms, text}` format, same selection taste, same ONE-woven-explanation rule) with two junior differences: (a) the paths — write `public/glossaries/junior/YYYY-MM-DD.json`, validate with `node scripts/check-glossary.mjs junior/YYYY-MM-DD`, tag with `node scripts/add-glossary-tags.mjs public/articles/junior/YYYY-MM-DD.html`; (b) the register — grades 5–7: simpler sentences, and include easier words a 5th–6th grader wouldn't know even if an 8th grader would (~40–60 entries per ~1000 words).
   - **Generate the glossary's pronunciation clips** (after the JSON validates — the script reads it): `node --env-file=.env.local scripts/gen-glossary-audio.mjs junior/YYYY-MM-DD` — every entry gets a TTS clip at `public/audio/junior/YYYY-MM-DD/gloss/<k>.mp3` and the script stamps `audio: true` on each entry (that flag is what shows the bottom sheet's speaker button — re-run until `failed=0`, and re-stage the glossary JSON since the script rewrites it).

7. **Build to verify:** `npm run build`. It must succeed (a break is almost always malformed JSON).

8. **Commit, push, and share the links.** Stage the junior content, article page, glossary, and audio — `git add content/junior/YYYY-MM-DD.json public/articles/junior/YYYY-MM-DD.html public/glossaries/junior/YYYY-MM-DD.json public/audio/junior/YYYY-MM-DD` (plus any other changed files) — commit, and `git push origin main`. **Pushing is shipping** (auto-deploys to `dailyreadingclub.com`). Then give the user the junior links: `https://dailyreadingclub.com/junior/reading/YYYY-MM-DD` (handout) and `https://dailyreadingclub.com/junior/reading/YYYY-MM-DD/quiz` (quiz).

## Content file schema

Same `Reading` schema as the senior track (backed by `lib/content.ts`) — the only difference is the file lives at `content/junior/YYYY-MM-DD.json` and its `articlePageUrl` points under `/articles/junior/`. The `track` is implied by the file's location, so it is **NOT** a field in the JSON.

```json
{
  "date": "2026-07-16",
  "title": "A clear, descriptive title",
  "articleUrl": "https://www.wsj.com/...the real article link...",
  "articlePageUrl": "/articles/junior/2026-07-16.html",
  "voiceQuiz": true,
  "source": "The Wall Street Journal",
  "vocab": [
    {
      "word": "reluctant",
      "partOfSpeech": "adjective",
      "pronunciation": "rih-LUK-tunt",
      "articleQuote": "Short real quote/sentence from the article containing the word.",
      "inContext": "What the word means right there, in the article's situation.",
      "meaning": "The broader, everyday definition.",
      "examples": [
        "First extra example sentence a 10–13 year old would relate to.",
        "Second extra example sentence."
      ]
    }
  ],
  "concepts": [
    {
      "name": "Supply and demand",
      "articleQuote": "Short segment of the article where the idea appears.",
      "meaning": "ONE concrete, Feynman-style explanation for an 11-year-old: name the field it comes from when obvious, then an everyday hook/analogy, how it works in plain short sentences, and a concrete kid-sized example. No separate inContext field."
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
- `voiceQuiz`: set `true` on every new junior day (turns on the AI oral quiz; pair with the article-text upload in step 3).
- `articlePageUrl` is the served path `"/articles/junior/YYYY-MM-DD.html"` — set it on **every** new day, open-link or paywalled (2026-07-25: open articles get a captured page too, so their pages can carry the tap-a-word glossary; see the senior skill's step 3). Keep `articleUrl` too (the original link).
- `answerIndex` is **0-based**; double-check it.
- `vocab` has **exactly 3 words** by default; each `examples` array has **exactly 2** sentences. `concepts` is **exactly 2** by default (the user can override), or fewer/`[]` for a concept-thin or vocabulary-only day.
- `concepts` may be empty (`[]`); the handout omits the Concepts section and the voice quiz skips its concepts stage.
- `clubPick`: set `"clubPick": true` **only when the day's article won the junior club vote** (see step 6) — it renders the CLUB PICK chip on the /junior index row. Omit on normal days.

## Deployment

Same as the senior track: **`git push origin main` ships to Vercel production** at `dailyreadingclub.com` (no manual `vercel --prod`). The local `npm run build` (step 7) is the pre-flight. After the deploy lands, share the `/junior/reading/…` links.

## If the user asks for changes

- "make the quiz harder/easier", "add a word", "the definition for X is off" → edit `content/junior/YYYY-MM-DD.json` and redeploy.
- Design/layout changes affect BOTH tracks (the pages are shared components — `LandingIndex`, `Handout`, `SelfQuiz`) → edit `app/`/`components/`/`lib/content.ts`, build, redeploy.
