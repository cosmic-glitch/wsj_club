---
name: auto-publish-junior
description: AUTONOMOUS daily JUNIOR publisher for the Reading Club (US grades 5–7), run UNATTENDED from the Hetzner box by cron, queued behind the senior auto-publish at 11am Pacific — the afternoon half of the junior autopilot (auto-vote-junior opens the ballot at 6am). Tallies the day's junior vote, captures the winning Economist article via the saved session in .bot/, authors the full junior handout (3 words, ≤2 concepts, quiz, glossary, audio) to the wsj-reading-junior calibration WITHOUT a human sign-off, ships it to main (= deploys; publishing is what closes the junior vote) via .bot/ship.sh --track=junior; the cron wrapper then verifies the deploy and announces it to the club's WhatsApp group in one fixed line. Junior track only. Do NOT invoke this by hand for the normal interactive flow — use wsj-check-vote + wsj-reading-junior for that; this exists so the cron can run tally→author→publish with no human in the loop.
---

# Reading Club — autonomous daily JUNIOR publish (Hetzner cron)

You are running **unattended** on the Hetzner box (`run-auto-publish.sh --track=junior`, queued behind the senior publish at 11am Pacific). Your job: turn the day's **junior** vote into the day's published **junior** reading with no human in the loop; the cron wrapper then verifies the deploy and announces it to the club's WhatsApp group (you never message anyone). There is **no approval step** — you are the author *and* the reviewer, so the quality gates below are strict and mechanical wherever a script can check them. The owner reviews **after** the fact and fixes anything they dislike interactively; a weak card is a re-push, but a **wrong** one (a quote that isn't in the article, a broken page, a half-shipped day) is the failure to avoid.

This is the junior sibling of **`auto-publish`** (identical mechanics) and the autonomous cousin of **`wsj-check-vote` + `wsj-reading-junior`**. **`wsj-reading-junior/SKILL.md` stays the single source of truth for everything editorial** — the grades 5–7 calibration (its "audience calibration" section: the junior vocab register, concrete-before-abstract concepts, the literal-verbs rule, the tone), the card recipes, the content schema, the junior output paths. **Read that section and its steps 4–6 before authoring.** This skill lists only what differs from the interactive junior flow:

1. **Inputs come from the junior tally**, not the user (Step 1). The winner is whatever the junior club voted for; you don't re-pick.
2. **Capture goes through `.bot/capture.mjs --track=junior`** (the box's own Playwright + saved Economist session), never the Playwright MCP. It runs the very same `scripts/capture-article.js` snippet the interactive skill uses, with the junior paths and back-link set for you.
3. **No sign-off.** The manual checkpoint is replaced by a written self-review (Step 4) plus `scripts/check-content.mjs --track=junior`, which verifies every quote against the captured text mechanically.
4. **Git goes through `.bot/ship.sh --track=junior`** — never drive `git commit`/`push` yourself.
5. **Junior track, Economist only** (the ballot never carries WSJ). Every path carries the `junior/` segment; every `scripts/` CLI takes its junior form (`--track=junior` or `junior/<date>` — each is spelled out below). **Getting a path or flag wrong silently writes into the senior track**, so copy the commands exactly.

All commands run from the repo root (`~/wsj_club`). `.bot/` browsing scripts take `node --env-file=.bot/.env …`; the `scripts/` CLIs take `node --env-file=.env.local …`. `AUTOPUBLISH_DATE`, `AUTOPUBLISH_DRY_RUN` and `AUTOPUBLISH_TRACK=junior` are set by the wrapper.

**Time budget:** a full day takes 20–40 minutes (glossary and audio dominate). That is expected — never trim the glossary or skip audio to finish faster.

## Step 0 — Date, mode, guards

1. `TODAY="${AUTOPUBLISH_DATE:-$(TZ=America/Los_Angeles date +%F)}"`; `MODE` is **dry-run** if `AUTOPUBLISH_DRY_RUN=1`, else **live**.
2. If `content/junior/${TODAY}.json` exists → the owner published by hand. **Exit 0 without doing or sending anything.** (`content/${TODAY}.json` is the *senior* day — its existence is expected and irrelevant.)
3. `git status --porcelain` (ignoring `article-text/`) must be empty and the branch `main` — the wrapper guarantees this; if not, STOP with the failure path (never author on top of leftovers).

## Step 1 — Tally the junior vote → the winner

```bash
mkdir -p .bot/state
node --env-file=.env.local .bot/tally.mjs "$TODAY" --track=junior > ".bot/state/${TODAY}-junior-tally.json"
```

The human tally (with voter names — owner-side only, never repeat names anywhere public) prints on stderr; the JSON verdict is in the file: `winner {title, articleUrl, source, votes}`, `ballots`, `runnerUp`, `winnerReason`.

- Exit **1** = no junior poll for today → there is no junior autopilot day (the morning run didn't open a vote, or the owner is doing it by hand). **STOP via the failure path** (no notification; the wrapper's outcome check alerts).
- Exit **2** = the junior reading is already published → exit 0 silently.
- **The script decides the winner; don't second-guess it.** Most votes wins; a tie is broken by the morning run's own ratings (`.bot/state/${TODAY}-junior-field.json`, written by `auto-vote-junior`); zero ballots falls back to the morning's top pick. The vote is the club's choice and the fallbacks are deliberate.
- Sanity: the winner's URL/title must not match any published reading on either track (`grep -il` its title in `content/*.json content/junior/*.json`). A match means something upstream is wrong → STOP.

## Step 2 — Capture the article page + text (junior paths)

```bash
mkdir -p public/articles/junior article-text/junior
node --env-file=.bot/.env .bot/capture.mjs "<winner.articleUrl>" "$TODAY" --source="The Economist" --track=junior > /tmp/junior-capture.json
```

It writes `public/articles/junior/${TODAY}.html` (back-link `/junior`) and `article-text/junior/${TODAY}.txt`, prints the snippet's verification line on stderr, and a JSON summary (`words`, `paragraphs`, `summary`, `acronymCheck`, `lengthCheck`) on stdout.

- Exit **2** = the page read as a teaser / bot challenge (nothing written). Refresh the session once — `xvfb-run -a node --env-file=.bot/.env .bot/refresh-session.mjs` — and retry once. Still failing → STOP via the failure path (`.bot/RECOVERY.md` explains the headed-browser requirement; it is not a credentials problem).
- **Verify exactly as `wsj-reading` step 3 does:** `deck=yes` (or a genuine no-standfirst page), `text` ≈ one per paragraph (**≥ 8**, else the selectors grabbed chrome — a short piece can legitimately come in at 6–7: confirm by reading the file), `small-caps ≥ 1` on an Economist piece, `acronymCheck` not `SUSPECT`, `images`/`infographics` counts plausible. `tail -5 article-text/junior/${TODAY}.txt` must end on body prose, not footer promos. If anything is off, fix the cause and re-run; never ship a page that is mostly chrome or a text file that is a teaser.
- **Read the `dropped=` list in the summary line — every entry must be chrome** (bare `Save`/`Share` labels, "Listen to this story", the `STOP at "This article appeared in…"` footer boundary). A dropped entry that reads like body prose means a filter misfired — a bug in `scripts/capture-article.js`, not something to work around: STOP via the failure path.
- **`lengthCheck`** compares the captured word count with the morning run's read of the same URL (`words` in `.bot/state/${TODAY}-junior-field.json`). `ok` or `no morning count` → proceed. **`SHORT` (exit 3)** → look at `dropped=` and at `tail` of the text file; if every dropped paragraph is chrome and the file ends on the article's real last paragraph (a false alarm), re-run with `--allow-short`; otherwise it is the failure path.
- Upload the text for the voice quiz (best-effort — log a failure and continue; the quiz falls back to handout-only). **The `--track=junior` is what puts it under the junior Blob key:**
  ```bash
  node --env-file=.env.local scripts/upload-article-text.mjs "$TODAY" --track=junior
  ```

## Step 3 — Read the article, properly

`cat article-text/junior/${TODAY}.txt` and **read the whole thing.** This file is the only text you draw on for the day — every quote, fact, and framing comes from **this** file, never from memory of the morning's scouting (a different process) and never from the senior day authored an hour ago in a different session. The mechanical quote check in Step 5 exists because cross-article contamination actually shipped once.

## Step 4 — Propose, then SELF-REVIEW at the junior calibration (this replaces the owner's sign-off)

Pick the roster exactly as `wsj-reading-junior` step 4 prescribes: **3 vocab words** one band below SAT tier (the *reluctant / abundant / deliberate / fragile* register: plausibly unknown to a sharp 10–13-year-old, worth knowing, will recur in good middle-school reading — not "increase", not *untenable*) and **the 2 most important concepts** (fewer is fine; **never pad to 2**, and `[]` on a vocab-only day is handled everywhere). Then, **before drafting anything**, write the review the owner would give, in your output:

- **Per word:** the verbatim quote — confirm it mechanically: `grep -F -c "<a distinctive fragment>" article-text/junior/${TODAY}.txt` must be ≥ 1. Is the word in the junior sweet spot? Has the junior track taught it already? `grep -il "\"word\": \"<word>\"" content/junior/*.json` — a repeat is allowed only if it is clearly the article's best word; otherwise pick a fresh one. (A word the *senior* track has taught is fine — different kids.)
- **Per concept:** concrete before abstract — **if the article is full of institutions, legal categories, measurements, or physical distinctions a 5th–7th grader flatly doesn't know, those beat a general mental model**; is it a durable piece of the world that recurs beyond this story (never the article's own topic or thesis); can it be taught from scratch in one card to an 11-year-old with **one** new idea; its name is the crisp 1–3-word term a reader would look up; its quote greps too.
- **Restate the final list with totals** ("3 words: a, b, c · 2 concepts: X, Y"). That restated list is what you draft — no drift between proposal and cards.

## Step 5 — Draft and write `content/junior/${TODAY}.json`

Write the full cards and the 5-question quiz per `wsj-reading-junior` steps 5–6 and its schema — sentences short, examples in a 10–13-year-old's world (school, sports, friends, games, home), **literal verbs for things without minds**, one kid-sized example developed all the way through, the takeaway last — with: `date`, `title` = the article's own headline (no invented subtitle, **no byline**), `articleUrl` = the winner's URL, `articlePageUrl: "/articles/junior/${TODAY}.html"`, `voiceQuiz: true`, `source: "The Economist"`, `pronunciation` respellings, exactly 2 `examples` per word, `answerIndex` 0-based, and **no `inContext`** (legacy). Then:

```bash
node scripts/check-content.mjs "$TODAY" --track=junior --no-audio
```

must print `ok`. Fix **every** ERROR: a quote it can't find is a quote you misremembered — correct the quote from the text file (never edit the text file), or swap the word.

## Step 6 — Audio and the glossary (junior paths)

1. Pronunciation clips + the quiz opening (`quiz-intro.mp3`) into `public/audio/junior/${TODAY}/`:
   ```bash
   node --env-file=.env.local scripts/gen-pronunciation.mjs "$TODAY" --track=junior
   ```
   Re-run until it reports `failed=0` — the handout hides the ▶ button for a missing clip, so a missed term silently loses its audio.
2. **Author the tap-a-word glossary** at `public/glossaries/junior/${TODAY}.json` exactly per `wsj-reading`'s step-6 glossary bullet — `{k, t, kind, pron?, forms, text}` entries, every handout vocab word first (kind `vocab`, `pron` copied from the content JSON), then sense-trap words, idioms/set phrases (`phrase` only for genuinely frequent standard-English collocations), names/terms of art; `forms` verbatim from this article; `text` one woven 2–4 sentence explanation, **plain text, no markdown markers** — at the **junior register**: simpler sentences, and **include the easier words a 5th–6th grader wouldn't know even if an 8th grader would**, so it runs **40–60 entries per ~1,000 words**. Then:
   ```bash
   node scripts/check-glossary.mjs "junior/${TODAY}"                          # must print ok
   node scripts/add-glossary-tags.mjs "public/articles/junior/${TODAY}.html"
   node --env-file=.env.local scripts/gen-glossary-audio.mjs "junior/${TODAY}"   # until failed=0
   ```
3. `node scripts/check-content.mjs "$TODAY" --track=junior` (audio included now) must print `ok`.

## Step 7 — Build

`npm run build` must succeed (it validates every content file). A failure on a new day is almost always malformed JSON — fix and re-run. Never ship without a passing build.

## Step 8 — Ship, then stop

```bash
.bot/ship.sh "$TODAY" --track=junior              # live
.bot/ship.sh "$TODAY" --track=junior --dry-run    # when AUTOPUBLISH_DRY_RUN=1
```

Live: commits the junior day's files on `main`, rebases on `origin/main`, pushes (= deploys) and **returns right after the push** — well under a minute; it does not wait for Vercel. Dry run: the same commit goes to branch `auto/junior/${TODAY}` (pushed; `main` untouched; Vercel builds a preview of the branch) and the tree returns to `main`.

**Run it in the foreground as a plain Bash call and wait for its exit code. Never run it in the background**, and never end your turn while it is running: this is a `claude -p` session — the moment you stop, the session exits and anything still running in the background is killed with it.

- Exit **0** → pushed. `ship.sh` dropped `.bot/state/${TODAY}-junior-pushed`; the wrapper takes it from here (Step 9). Finish your output with the run summary and stop.
- Exit **3** → `origin/main` already had the junior day (the owner published by hand while you worked). Your commit was dropped. **Exit 0 silently.**
- Exit **4** → nothing pushed (credential/network). Failure path.

## Step 9 — The wrapper announces (you send nothing)

After your session ends, `run-auto-publish.sh` polls `https://dailyreadingclub.com/junior/reading/${TODAY}` for up to 12 minutes and, once it serves, sends the club group its one fixed line — `Today's junior-track article is up ("<title>").  dailyreadingclub.com/junior` — built from the content JSON's `title`. The dry-run note and the pushed-but-not-serving warning go to the owner's DM the same way, and every message is gated on the marker from Step 8, so a junior day the owner published by hand is never announced by the autopilot. **You never call `notify.mjs` in this skill** — no message to the group, none to the owner. The owner's window into what you chose and why is the commit and the log; **voter names never go in either.**

## Failure handling

- **Any hard failure before Step 8 ships** (no junior poll, capture refused twice, the checks won't pass, the build fails) → **do not notify.** End your output with a clear `AUTO-PUBLISH-JUNIOR FAILED: <reason>` line and exit non-zero. The wrapper stashes whatever you wrote (`git stash list` on the box recovers it), realigns `main` with origin, and its outcome check pages the owner through the cron's healthcheck. A silent no-reading beats a broken one; the owner can still publish by hand.
- **Never** write to `main` except through `ship.sh`; never push a partial day; never invent or "fix" a quote by editing the article text; never pad concepts; never re-pick the winner; **never write a junior day into a senior path** (a missing `junior/` segment or `--track=junior` is a hard failure the moment you notice it — delete the stray file and redo the step).
- If you finish the cards but a *script* keeps failing on something environmental (OpenAI down, Blob down), treat it as a hard failure — a day without its audio or glossary isn't the day the club expects.
