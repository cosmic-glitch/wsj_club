---
name: auto-publish
description: AUTONOMOUS daily publisher for the Reading Club, run UNATTENDED from the Hetzner box by cron at 11am Pacific — the afternoon half of the autopilot (auto-vote opens the ballot at 6am). Tallies the day's senior vote, captures the winning Economist article via the saved session in .bot/, authors the full handout (vocab, concepts, quiz, glossary, audio) to the wsj-reading calibration WITHOUT a human sign-off, ships it to main (= deploys; publishing is what closes the vote) via .bot/ship.sh, and announces it to the club's WhatsApp group over nanoclaw in one fixed line. Senior track only. Do NOT invoke this by hand for the normal interactive flow — use wsj-check-vote + wsj-reading for that; this exists so the cron can run tally→author→publish with no human in the loop.
---

# Reading Club — autonomous daily publish (Hetzner cron)

You are running **unattended** on the Hetzner box (`run-auto-publish.sh` fired at 11am Pacific). Your job: turn the day's vote into the day's published reading with no human in the loop, then announce it to the club's WhatsApp group. There is **no approval step** — you are the author *and* the reviewer, so the quality gates below are strict and mechanical wherever a script can check them. The owner reviews **after** the fact and fixes anything they dislike interactively; a weak card is a re-push, but a **wrong** one (a quote that isn't in the article, a broken page, a half-shipped day) is the failure to avoid.

This is the autonomous cousin of **`wsj-check-vote` + `wsj-reading`**. **`wsj-reading/SKILL.md` stays the single source of truth for everything editorial** — the audience calibration, the card recipes (vocab article-first, concepts Feynman-style and concrete-before-abstract, the 5-question quiz), the content schema, the glossary rules. **Read those sections of it before authoring** (its "audience calibration", "Hard rules", steps 4–6, "Content file schema"); this skill lists only what differs:

1. **Inputs come from the tally**, not the user (Step 1). The winner is whatever the club voted for; you don't re-pick.
2. **Capture goes through `.bot/capture.mjs`** (the box's own Playwright + saved Economist session), never the Playwright MCP (not available here). It runs the very same `scripts/capture-article.js` snippet the interactive skill uses.
3. **No sign-off.** The manual checkpoint is replaced by a written self-review (Step 4) plus `scripts/check-content.mjs`, which verifies every quote against the captured text mechanically.
4. **Git goes through `.bot/ship.sh`** — never drive `git commit`/`push` yourself. It stages exactly the day's files, rebases, refuses to stomp a hand-published day, pushes, and waits for the deploy.
5. **Senior track, Economist only** (the box is IP-blocked by WSJ; the ballot never carries WSJ). Junior and enrichment stay interactive.

All commands run from the repo root (`~/wsj_club`). `.bot/` browsing scripts take `node --env-file=.bot/.env …`; the `scripts/` CLIs take `node --env-file=.env.local …` (the wrapper also exports both env files into the session, but keep the explicit form). `AUTOPUBLISH_DATE` and `AUTOPUBLISH_DRY_RUN` are set by the wrapper.

**Time budget:** a full day takes 20–40 minutes (glossary and audio dominate). That is expected — never trim the glossary or skip audio to finish faster.

## Step 0 — Date, mode, guards

1. `TODAY="${AUTOPUBLISH_DATE:-$(TZ=America/Los_Angeles date +%F)}"`; `MODE` is **dry-run** if `AUTOPUBLISH_DRY_RUN=1`, else **live**.
2. If `content/${TODAY}.json` exists → the owner published by hand. **Exit 0 without doing or sending anything.**
3. `git status --porcelain` (ignoring `article-text/`) must be empty and the branch `main` — the wrapper guarantees this; if not, STOP with the failure path (never author on top of leftovers).

## Step 1 — Tally the vote → the winner

```bash
mkdir -p .bot/state
node --env-file=.env.local .bot/tally.mjs "$TODAY" > ".bot/state/${TODAY}-tally.json"
```

The human tally (with voter names — owner-side only, never repeat names anywhere public) prints on stderr; the JSON verdict is in the file: `winner {title, articleUrl, source, votes}`, `ballots`, `runnerUp`, `winnerReason`.

- Exit **1** = no poll for today → there is no autopilot day (the morning run didn't open a vote, or the owner is doing it by hand). **STOP via the failure path** (no notification; the wrapper's outcome check alerts).
- Exit **2** = the reading is already published → exit 0 silently.
- **The script decides the winner; don't second-guess it.** Most votes wins; a tie is broken by the morning run's own ratings (`.bot/state/${TODAY}-field.json`, written by `auto-vote`); zero ballots falls back to the morning's top pick. The vote is the club's choice and the fallbacks are deliberate — your judgment went into the ballot, not into overriding the result.
- Sanity: the winner's URL/title must not match any published reading (`grep -il` its title in `content/*.json content/junior/*.json`). A match means something upstream is wrong → STOP.

## Step 2 — Capture the article page + text

```bash
mkdir -p public/articles article-text
node --env-file=.bot/.env .bot/capture.mjs "<winner.articleUrl>" "$TODAY" --source="The Economist" > /tmp/capture.json
```

(`--source` is the top bar's publication label: the ballot's `"Economist"` → `"The Economist"`.) It writes `public/articles/${TODAY}.html` and `article-text/${TODAY}.txt`, prints the snippet's verification line on stderr, and a JSON summary (`words`, `paragraphs`, `summary`, `acronymCheck`) on stdout.

- Exit **2** = the page read as a teaser / bot challenge (nothing written). Refresh the session once — `xvfb-run -a node --env-file=.bot/.env .bot/refresh-session.mjs` — and retry once. Still failing → STOP via the failure path (`.bot/RECOVERY.md` explains the headed-browser requirement; it is not a credentials problem).
- **Verify exactly as `wsj-reading` step 3 does:** `deck=yes` (or a genuine no-standfirst page), `text` ≈ one per paragraph (**≥ 8**, else the selectors grabbed chrome — a short leader can legitimately come in at 6–7: confirm by reading the file), `small-caps ≥ 1` on an Economist piece, `acronymCheck` not `SUSPECT`, `images`/`infographics` counts plausible for the article. `tail -5 article-text/${TODAY}.txt` must end on body prose, not footer promos. If anything is off, fix the cause and re-run; never ship a page that is mostly chrome or a text file that is a teaser.
- **Read the `dropped=` list in the summary line — every entry must be chrome.** It names each paragraph the filters removed: bare `Save`/`Share` labels, "Listen to this story", and the `STOP at "This article appeared in…"` footer boundary (with a sample of what sat after it). A dropped entry that reads like body prose — a paragraph opening "Share prices…", a real paragraph after the STOP point — means a filter misfired. That is a bug in `scripts/capture-article.js`, not something to work around: STOP via the failure path (the owner fixes the filter), never ship a day with a hole in the article.
- **`lengthCheck` compares the captured word count with the morning run's own read of the same URL** (`words` in `.bot/state/${TODAY}-field.json`). `ok` or `no morning count` → proceed. **`SHORT` (exit 3)** → the capture is materially shorter than the page was this morning: look at `dropped=` and at `tail` of the text file. If every dropped paragraph is chrome and the text file ends on the article's real last paragraph (a false alarm — e.g. the page's footer promos changed), re-run with `--allow-short`; otherwise it is the failure path.
- Upload the text for the voice quiz (best-effort — log a failure and continue; the quiz falls back to handout-only):
  ```bash
  node --env-file=.env.local scripts/upload-article-text.mjs "$TODAY"
  ```

## Step 3 — Read the article, properly

`cat article-text/${TODAY}.txt` and **read the whole thing.** This file is the only text you draw on for the day — the morning's scouting happened in a different process, so nothing else is in your head, but the rule stands: every quote, fact, and framing comes from **this** file. (Cross-article contamination is the classic failure of a session that has read several pieces; the mechanical quote check in Step 5 exists because it actually shipped once.)

## Step 4 — Propose, then SELF-REVIEW (this replaces the owner's sign-off)

Pick the roster exactly as `wsj-reading` step 4 prescribes: **3 vocab words** (SAT-sweet-spot: plausibly unknown, worth knowing, will recur in serious journalism) and **2 concepts** (a third only when it genuinely shouts, hard cap 3; fewer is fine — `[]` on a vocab-only day is handled everywhere). Then, **before drafting anything**, write the review the owner would give, in your output:

- **Per word:** the verbatim quote — confirm it mechanically: `grep -F -c "<a distinctive fragment>" article-text/${TODAY}.txt` must be ≥ 1. Is the word in the sweet spot (not "increase", not a word they'll never see again)? Has the club taught it already? `grep -il "\"word\": \"<word>\"" content/*.json` — a repeat is allowed only if it is clearly the article's best word; otherwise pick a fresh one.
- **Per concept:** the concrete-before-abstract check (**if the article is full of institutions, legal categories, measurements, or physical distinctions the reader doesn't know, those beat a general mental model**); can it be taught from scratch in one card; is it what the article is actually *about*; its quote greps too.
- **Restate the final list with totals** ("3 words: a, b, c · 2 concepts: X, Y"). That restated list is what you draft — no drift between proposal and cards.

## Step 5 — Draft and write `content/${TODAY}.json`

Write the full cards and the 5-question quiz per `wsj-reading` steps 5–6 and its schema, with: `date`, `title` = the article's own headline (no invented subtitle, **no byline**), `articleUrl` = the winner's URL, `articlePageUrl: "/articles/${TODAY}.html"`, `voiceQuiz: true`, `source: "The Economist"`, `pronunciation` respellings, exactly 2 `examples` per word, `answerIndex` 0-based, and **no `inContext`** (legacy). Then:

```bash
node scripts/check-content.mjs "$TODAY" --no-audio
```

must print `ok`. Fix **every** ERROR: a quote it can't find is a quote you misremembered — correct the quote from the text file (never edit the text file), or swap the word.

## Step 6 — Audio and the glossary

1. Pronunciation clips + the quiz opening (`quiz-intro.mp3`):
   ```bash
   node --env-file=.env.local scripts/gen-pronunciation.mjs "$TODAY"
   ```
   Re-run until it reports `failed=0` — the handout hides the ▶ button for a missing clip, so a missed term silently loses its audio.
2. **Author the tap-a-word glossary** at `public/glossaries/${TODAY}.json` exactly per `wsj-reading` step 6 (its "Author the tap-a-word GLOSSARY" bullet): `{k, t, kind, pron?, forms, text}` entries, **35–60 per ~1,000 words**, every handout vocab word first (kind `vocab`, `pron` copied from the content JSON), then sense-trap words, idioms/set phrases (`phrase` only for genuinely frequent standard-English collocations), names/terms of art; `forms` verbatim from this article; `text` one woven 2–4 sentence explanation, **plain text, no markdown markers**. Then:
   ```bash
   node scripts/check-glossary.mjs "$TODAY"                       # must print ok
   node scripts/add-glossary-tags.mjs public/articles/${TODAY}.html
   node --env-file=.env.local scripts/gen-glossary-audio.mjs "$TODAY"   # until failed=0
   ```
3. `node scripts/check-content.mjs "$TODAY"` (audio included now) must print `ok`.

## Step 7 — Build

`npm run build` must succeed (it validates every content file). A failure on a new day is almost always malformed JSON — fix and re-run. Never ship without a passing build.

## Step 8 — Ship

```bash
.bot/ship.sh "$TODAY"              # live
.bot/ship.sh "$TODAY" --dry-run    # when AUTOPUBLISH_DRY_RUN=1
```

Live: commits the day's files on `main`, rebases on `origin/main`, pushes (= deploys), and waits until `https://dailyreadingclub.com/reading/${TODAY}` serves. Dry run: the same commit goes to branch `auto/${TODAY}` (pushed; `main` untouched; Vercel builds a preview of the branch) and the tree returns to `main`.

- Exit **0** → shipped (or dry-run branch pushed). Continue to Step 9.
- Exit **3** → `origin/main` already had the day (the owner published by hand while you worked). Your commit was dropped. **Exit 0 silently** — nothing to announce.
- Exit **4** → nothing pushed (credential/network). Failure path.
- Exit **5** → pushed to `main`, but the site hadn't served the handout after 12 minutes. The commit **is** on main, but the reading is not verifiably up, so **do not announce to the group** — DM the owner instead (Step 9's warning form); the wrapper's outcome check will also flag it.

## Step 9 — Announce to the club group

**Live run, ship exit 0:** one WhatsApp message to the **club group**, always this exact shape and nothing more — no links, no vote stats, no word list, no emoji, no date:

```
Today's article is up ("<title>").
```

`<title>` is the content JSON's `title` verbatim (the article's own headline) inside straight double quotes, then a period after the closing parenthesis. Write it to a file (the heredoc is single-quoted, so apostrophes in the title are safe) and send with `--to=group`:

```bash
cat > /tmp/publish-notify.txt <<'MSG'
Today's article is up ("<title>").
MSG
node --env-file=.bot/.env .bot/notify.mjs --to=group --file /tmp/publish-notify.txt
```

The group JID is `NANOCLAW_GROUP_JID` in `.bot/.env`; if it is unset, `notify.mjs` sends the same line to the owner's DM with a note saying so — never skip the send.

**Everything else goes to the owner's DM (default target), never the group:**

- Dry run: `🧪 Reading Club DRY RUN — <TODAY> (nothing published): "<title>" → branch auto/<TODAY> pushed, main untouched; delete .bot/DRY_RUN on the box to go live.`
- Ship exit 5: `⚠️ Reading Club — <TODAY> "<title>" is on main but the site hadn't served it after 12 min — check Vercel. The group was NOT told; announce by hand once it's live.`

The owner's window into what you chose and why is the commit and the log, not the message — **voter names never go in any message.**

Then stop.

## Failure handling

- **Any hard failure before Step 8 ships** (no poll, capture refused twice, the checks won't pass, the build fails) → **do not notify.** End your output with a clear `AUTO-PUBLISH FAILED: <reason>` line and exit non-zero. The wrapper stashes whatever you wrote (`git stash list` on the box recovers it), realigns `main` with origin, and its outcome check pages the owner through the cron's healthcheck. A silent no-reading beats a broken one; the owner can still publish by hand.
- **Never** write to `main` except through `ship.sh`; never push a partial day; never invent or "fix" a quote by editing the article text; never pad concepts; never re-pick the winner.
- If you finish the cards but a *script* keeps failing on something environmental (OpenAI down, Blob down), treat it as a hard failure — a day without its audio or glossary isn't the day the club expects.
