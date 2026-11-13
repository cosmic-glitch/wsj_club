---
name: auto-publish-kids
description: AUTONOMOUS daily ELEMENTARY publisher for the Reading Club (track id "kids", shown as Elementary at /elementary; a precocious early reader at about a US grade 3 level), run UNATTENDED from the Hetzner box by cron, right after the middle-school (junior) auto-publish. Tallies the day's kids vote, captures the winning TIME for Kids article with .bot/capture-kids.mjs, authors the full elementary handout (3 words, at most 1 concept, quiz, glossary, audio) WITHOUT a human sign-off, ships it to main (= deploys; publishing is what closes the kids vote) via .bot/ship.sh --track=kids. The driver then sends the club one combined WhatsApp message once every track is live. Kids track only. Do NOT invoke this by hand for the normal interactive flow — use wsj-check-vote --track=kids + the wsj-pick-article-elementary skill's Publishing section for that.
---

# Reading Club — autonomous daily ELEMENTARY publish (Hetzner cron)

You are running **unattended** on the Hetzner box (`publish-track.sh --track=kids`, run by the `run-auto-publish.sh` driver after the high-school and middle-school publishes). Your job: turn the day's **kids** vote into the day's published **elementary** reading with no human in the loop. You never message anyone. There is **no approval step** — you are the author *and* the reviewer, so the gates below are strict and mechanical wherever a script can check them. The owner reviews after the fact; a weak card is a re-push, but a **wrong** one (a quote that isn't in the article, a broken page, a half-shipped day, anything unfit for a 6-year-old) is the failure to avoid.

Names: the track id is `kids` in every path, flag and file; people see it as **Elementary** at `/elementary`.

This is the kids sibling of **`auto-publish-junior`** — same mechanics (tally → capture → read → self-review → draft → audio + glossary → build → ship), with these differences:

1. **Source is TIME for Kids**, never the Economist. Capture goes through **`.bot/capture-kids.mjs`** (a plain browser, no login; it rewraps TFK's photos and strips its hidden power-word definitions), which runs the same shared `scripts/capture-article.js` snippet.
2. **Calibration is elementary** (below): exactly 3 words, **at most 1 concept**, everything readable by a bright 7-year-old.
3. **Every path carries `kids/`** and every CLI its kids form (`--track=kids` or `kids/<date>`). **A missing `kids/` segment or `--track=kids` silently writes into the high-school track** — copy the commands exactly.

The house model for an elementary day is the first one: `content/kids/2026-11-12.json` and `public/glossaries/kids/2026-11-12.json`. **Read both before drafting** — match their register, length and shape.

All commands run from the repo root (`~/wsj_club`). The `scripts/` CLIs take `node --env-file=.env.local …`. `AUTOPUBLISH_DATE`, `AUTOPUBLISH_DRY_RUN` and `AUTOPUBLISH_TRACK=kids` are set by the wrapper.

**Time budget:** 15–30 minutes. Never trim the glossary or skip audio to finish faster.

## Who this is for (the calibration)

A precocious first or second grader reading at about a **US grade 3 level** (ages 6 to 8): sharp and curious, still an early reader. Everything you write is read by that child, so:

- **Short sentences** (mostly under 12 words), common words, one idea per sentence, literal language. No idioms you don't explain, no irony, no em dashes, no markdown bold or italics.
- **Examples from a young child's world:** home, family, pets, school, the playground, toys, snacks, the park.
- **Nothing scary.** If the article touches something a 6-year-old's parent wouldn't want explained in detail, don't dwell on it in any card, question or gloss.

## Step 0 — Date, mode, guards

1. `TODAY="${AUTOPUBLISH_DATE:-$(TZ=America/Los_Angeles date +%F)}"`; `MODE` is **dry-run** if `AUTOPUBLISH_DRY_RUN=1`, else **live**.
2. If `content/kids/${TODAY}.json` exists → published by hand. **Exit 0 without doing anything.** (`content/${TODAY}.json` and `content/junior/${TODAY}.json` are the other tracks' days — expected and irrelevant.)
3. `git status --porcelain` (ignoring `article-text/`) must be empty and the branch `main` — else STOP via the failure path.

## Step 1 — Tally the kids vote → the winner

```bash
mkdir -p .bot/state
node --env-file=.env.local .bot/tally.mjs "$TODAY" --track=kids > ".bot/state/${TODAY}-kids-tally.json"
```

The human tally (with voter names — owner-side only, never repeat names anywhere) prints on stderr; the JSON verdict is in the file: `winner {title, articleUrl, source, votes}`, `ballots`, `runnerUp`, `winnerReason`.

- Exit **1** = no kids poll for today → STOP via the failure path.
- Exit **2** = already published → exit 0 silently.
- **The script decides the winner; don't second-guess it** (most votes; a tie broken by the morning ratings in `.bot/state/${TODAY}-kids-field.json`; zero ballots → the morning's top pick).
- Sanity: the winner's URL must not be in any published day (`grep -l "<url path>" content/*.json content/*/*.json`) → a match means something upstream is wrong: STOP.

## Step 2 — Capture the article page + text

```bash
mkdir -p public/articles/kids article-text/kids
node .bot/capture-kids.mjs "<winner.articleUrl>" "$TODAY" > /tmp/kids-capture.json
```

It writes `public/articles/kids/${TODAY}.html` (back-link `/elementary`) and `article-text/kids/${TODAY}.txt`, prints the snippet's verification line on stderr, and a JSON summary on stdout: `url` (the clean article URL — **use it as `articleUrl`**), `words`, `paragraphs`, `figures`, `summary`, `lengthCheck`.

- Exit **2** = no article body or a subscribe prompt → retry once after 30 seconds; still failing → failure path.
- Exit **3** = thin output, leaked definition fragments, or `lengthCheck: SHORT`. For SHORT only: if the `dropped=` list is all chrome and `tail -5 article-text/kids/${TODAY}.txt` ends on the article's real last paragraph, re-run with `--allow-short`; otherwise failure path.
- Check the summary line: `images` should match `figures` (TFK pieces usually carry several photos), and every `dropped=` entry must be chrome.
- Upload the text for the voice quiz (best-effort — log a failure and continue):
  ```bash
  node --env-file=.env.local scripts/upload-article-text.mjs "$TODAY" --track=kids
  ```

## Step 3 — Read the article, properly

`cat article-text/kids/${TODAY}.txt` and **read the whole thing.** It is the only text you draw on: every quote, fact and framing comes from this file, never from memory of the morning scouting or from the other tracks' days authored earlier in other sessions.

## Step 4 — Propose, then SELF-REVIEW (this replaces the owner's sign-off)

Pick **3 vocab words** in the grade-3 "stretch" register — words a bright 7-year-old has likely heard but can't define, worth knowing, common in good children's books: *curious, enormous, protect, rare, journey, gather, examine, transparent*. Not sight-level words (*big, happy*), not middle-school ones (*reluctant, untenable*). TFK's own power words (bold in the article) are a good starting list, not binding.

Pick **at most 1 concept**: a durable piece of the world the article leans on that a young child can learn in one card (what a species is, what a habitat is, what gravity does, what a national park is). Never the article's own topic or thesis; **never pad** — `[]` is fine when nothing fits.

Then write the review, in your output:

- **Per word:** the verbatim quote, confirmed mechanically: `grep -F -c "<distinctive fragment>" article-text/kids/${TODAY}.txt` ≥ 1. Is it in the stretch register? Taught already on this track? `grep -il "\"word\": \"<word>\"" content/kids/*.json` — a repeat only if it is clearly the article's best word. (Words the other tracks taught are fine.)
- **Per concept:** one new idea, teachable from scratch to a 7-year-old, with a quote that greps.
- **Restate the final list** ("3 words: a, b, c · concept: X") — that is what you draft.

## Step 5 — Draft and write `content/kids/${TODAY}.json`

Follow the house model's shape exactly:

- `date`; `title` = a short plain-English headline that says what happened (the model's "A robot finds 57 new sea animals" for TFK's "Canyon Creatures" — TFK's own titles are often puns a 7-year-old won't decode); no byline. `articleUrl` = the capture's clean `url`; `articlePageUrl: "/articles/kids/${TODAY}.html"`; `voiceQuiz: true`; `source: "TIME for Kids"`.
- **Each word:** `partOfSpeech`, `pronunciation` (respelled, stressed syllable in caps), `articleQuote` (verbatim), `meaning` (3 short sentences: what it means, how you'd notice it, what it means in this article), exactly 2 `examples` from a young child's world. No `inContext`.
- **The concept (if any):** `name`, `articleQuote`, `meaning` in 3–4 short paragraphs: the hook from the article, what the idea is with an everyday example (house cat vs lion), how it works, a one-line takeaway.
- **Quiz:** exactly 5 multiple-choice questions, 4 options each, short and literal; mostly what happened in the article, one on a vocab word, one on the concept. Vary `answerIndex` (0-based) across the five; each `explanation` one or two short sentences.

```bash
node scripts/check-content.mjs "$TODAY" --track=kids --no-audio
```

must print `ok`. Fix every ERROR — a quote it can't find is one you misremembered: correct it from the text file (never edit the text file), or swap the word.

## Step 6 — Audio and the glossary

1. Pronunciation clips + the quiz opening into `public/audio/kids/${TODAY}/`:
   ```bash
   node --env-file=.env.local scripts/gen-pronunciation.mjs "$TODAY" --track=kids
   ```
   Re-run until `failed=0`.
2. **Author the tap-a-word glossary** at `public/glossaries/kids/${TODAY}.json` per `wsj-reading`'s step-6 glossary bullet (`{k, t, kind, pron?, forms, text}`; the 3 handout words first as kind `vocab` with `pron` copied from the content JSON; `forms` verbatim from this article; `text` plain, no markdown) at the **grade 2–4 register**: one to three very short sentences each; gloss everyday-but-unfamiliar words, sense traps ("dove" = went under water, not the bird), set phrases ("the chat exploded"), and **every proper noun a 7-year-old needs** (places, organisations, people, characters). About **35–45 entries per ~550 words** — see the house model. Then:
   ```bash
   node scripts/check-glossary.mjs "kids/${TODAY}"                          # must print ok
   node scripts/add-glossary-tags.mjs "public/articles/kids/${TODAY}.html"
   node --env-file=.env.local scripts/gen-glossary-audio.mjs "kids/${TODAY}"   # until failed=0
   ```
3. `node scripts/check-content.mjs "$TODAY" --track=kids` (audio included now) must print `ok`.

## Step 7 — Build

`npm run build` must succeed. A failure on a new day is almost always malformed JSON — fix and re-run. Never ship without a passing build.

## Step 8 — Ship, then stop

```bash
.bot/ship.sh "$TODAY" --track=kids              # live
.bot/ship.sh "$TODAY" --track=kids --dry-run    # when AUTOPUBLISH_DRY_RUN=1
```

Live: commits the day's files on `main`, rebases, pushes (= deploys) and returns right after the push. Dry run: the same commit goes to branch `auto/kids/${TODAY}`; `main` untouched.

**Run it in the foreground and wait for its exit code — never in the background**, never end your turn while it runs (this is a `claude -p` session; anything left running dies with it).

- Exit **0** → pushed; `.bot/state/${TODAY}-kids-pushed` exists. Finish with the run summary and stop.
- Exit **3** → `origin/main` already had the day (published by hand). **Exit 0 silently.**
- Exit **4** → nothing pushed. Failure path.

**You never call `notify.mjs`.** After every track's run, the driver checks the site serves each day and sends the club group one combined message. Voter names never go in the commit or the log.

## Failure handling

- **Any hard failure before Step 8 ships** → do not notify. End your output with `AUTO-PUBLISH-KIDS FAILED: <reason>` and exit non-zero. The wrapper stashes your files, realigns `main`, and the healthcheck pages the owner.
- **Never** write to `main` except through `ship.sh`; never push a partial day; never edit the article text to fit a quote; never pad the concept; never re-pick the winner; **never write a kids day into another track's path**.
- An environmental failure that keeps a script from finishing (OpenAI or Blob down) is a hard failure — a day without its audio or glossary isn't the day the club expects.
