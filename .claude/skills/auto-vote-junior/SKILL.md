---
name: auto-vote-junior
description: AUTONOMOUS daily JUNIOR vote opener for the Reading Club (US grades 5–7), run UNATTENDED from the Hetzner box by cron, queued right behind the senior auto-vote at 6am Pacific — NOT the interactive picker. Scouts The Economist's story-first sections (via the saved session in .bot/), ranks candidates against the junior picker's gates (the 11-year-old prerequisite test, story first, stricter appropriateness, length, register) WITHOUT waiting for human sign-off, opens the day's junior vote (5 news picks) via .bot/open-vote.mjs --track=junior, and texts the owner over nanoclaw. Never uses WSJ. Do NOT invoke this by hand for the normal interactive flow — use wsj-open-vote ("open the junior vote") for that; this exists so the cron can run the whole junior pick→vote step with no human in the loop.
---

# Reading Club — autonomous daily JUNIOR vote (Hetzner cron)

You are running **unattended** on the Hetzner box (`run-auto-vote.sh --track=junior`, queued behind the senior run at 6am Pacific). Your job: pick the day's **junior** candidates and **open the junior vote** with no human in the loop, then text the owner. There is **no approval step** — you are the picker and the validation layer, so apply the gates strictly (nobody screens the ballot before ten-year-olds see it). The vote is a soft output (a weak candidate just loses), but a **too-hard or inappropriate** candidate reaching the junior ballot is the failure to avoid — and the appropriateness bar is a 5th-grader's parent, not a 9th-grader's.

This is the junior sibling of **`auto-vote`** (identical mechanics — read it if anything below is unclear) and the autonomous cousin of **`wsj-pick-article-junior`** (the calibration — **read its "What makes a good JUNIOR pick" section before ranking**; the gates below are the load-bearing summary). What differs from the interactive junior picker: **(1) no WSJ ever** (the box is IP-blocked by WSJ; The Economist is the only source); **(2) no interactive sign-off**; **(3) browsing goes through the `.bot/` node scripts, not the Playwright MCP**; **(4) member suggestions are not read** (the box has no PostgREST keys for `scripts/suggestions.mjs`; the owner handles junior suggestions interactively).

All commands run from the repo root (`~/wsj_club`). `.bot/` browsing scripts take `node --env-file=.bot/.env …` so an expired Economist session can self-refresh.

## Step 0 — Today's date and the idempotency guard

1. `TODAY="${AUTOVOTE_DATE:-$(TZ=America/Los_Angeles date +%F)}"` — the vote is **always for today** (Pacific).
2. **Bail if the work is already done:**
   - If `content/junior/${TODAY}.json` exists → today's junior reading is already published. **Exit without opening or notifying.**
   - `curl -s "https://dailyreadingclub.com/api/vote?track=junior"` → `"active": true` for a poll dated `${TODAY}` means the junior vote is already open. **Exit without re-opening or notifying.**
   - Only if neither is true do you proceed. (The senior poll is a different poll — its state is irrelevant here.)

## The gates (every candidate, strictly — junior calibration)

1. **The 11-year-old prerequisite gate — a hard veto.** Could a curious **11-year-old with no background** follow the article's core story or argument, given the handout teaches only **2 concepts** from scratch? One genuinely new idea, taught concretely, is the stretch we want. Anything that assumes a stack of background — or that *drops* deep ideas with one-sentence token explanations and then builds on them — is **disqualified, however good.** Run the **restate test** on each idea the piece introduces-and-builds-on: could the 11-year-old restate it from what the article gives? Every idea that fails counts as assumed background; more than one and the piece is out. Payload never overrides this.
2. **Story first.** Pick by the story, not the argument: narrative, characters, a concrete situation, a question a 10–13-year-old would actually ask. Abstract argument pieces — Leaders, columns, "what X means for Y" analysis — are senior material even when beautifully written. The junior sweet spot: science and nature, animals, space, sports, food, games and entertainment, inventions and how-things-are-made, everyday money (prices, allowances, why things cost what they do), school, exploration, a vivid human-interest feature from a regional section.
3. **Appropriate for a 10-year-old's handout.** No stories centred on violence, sexual content, drugs/addiction, suicide or self-harm, abuse, or bleak-without-payoff subjects. Geopolitics and hard news are fine when the value is understanding, but the bar sits well below senior's — when in doubt, leave it off the ballot.
4. **Length and stamina.** Prefer **600–1,200 words**; over ~1,500 is a pass unless it is exceptional (`read.mjs` reports `words`). Briefings, 1843 long-reads, multi-part essays and Christmas specials are out.
5. **Literal readers.** Prefer reported features over columns (Bagehot, Lexington, Charlemagne, Banyan, Chaguan, Schumpeter, Buttonwood, Free exchange, Johnson) and over anything built on sustained irony, satire, or allusion — a 10-year-old reads irony literally, and every allusion is a prerequisite in disguise. Paragraphs that are mostly numbers and percentages count against too. Articulation at this band means **clarity and concreteness**: a plainer piece beats a more elegant one.
6. **A real, full-text article** — not a video-led page, live blog, chart-only *Graphic detail* stub, or podcast — that carries **3 words worth teaching one band below SAT tier** (the *reluctant / abundant / deliberate / fragile* register — real growth for grades 5–7, not obscure) and **2 concrete, durable, transferable concepts** (fewer is fine; the authoring caps at 2).
7. **Worldly-wisdom lean, junior edition.** The club's standing bias — general knowledge, money, how the world works, modern forces like AI — still applies, expressed through concrete stories rather than markets minutiae. Variety is only a mild tiebreaker; overlap with the **senior** track's topics is **not** a strike (different kids, different depth) — only a repeat *article* is banned.

## Step 1 — The do-not-repeat list (a hard gate) + junior coverage awareness

- **Build the do-not-repeat list from EVERY published reading, both tracks:** `grep -h '"title"' content/*.json content/junior/*.json` and `grep -rhoE '"articleUrl":\s*"[^"]+"' content/*.json content/junior/*.json`. **A candidate matching any published reading by URL or by title (case-insensitive; lightly reworded headlines count) is disqualified — no exceptions.** Section hubs resurface weeks of articles; `scout.mjs` filters published ones and `open-vote.mjs` refuses them, but a reworded title or variant URL can slip past string matching, so check the shortlist against the published *titles* yourself before reading.
- **Junior coverage (soft):** `ls content/junior/` and skim the recent titles/concepts. A repeat *domain* is fine if it's the best story; never force rotation.

## Step 2 — Junior news candidates (The Economist)

1. `node --env-file=.bot/.env .bot/scout.mjs --track=junior > /tmp/econ-junior-candidates.json` — `[{url, headline, section}]` swept across the homepage + the story-first sections (science, culture, international, the regional sections, business), minus already-published readings. It auto-refreshes the login if the session expired; its stderr names any candidates dropped as already-read.
2. On the **headlines**, shortlist the **~10 most promising** against the gates (favor Science & technology, Culture, and the regional sections' human-interest features; down-weight anything that looks like a column, an argument piece, a markets story, or a video/chart-led page).
3. Read those ~10 in full: `node --env-file=.bot/.env .bot/read.mjs <url1> <url2> …` → `[{url,title,words,wall,text}]`. **Decide on the real text, not the headline.** For each, judge: the 11-year-old gate (the veto — apply it first), the story hook, 3 junior-register words, 2 concrete concepts, length, register, appropriateness. A piece that comes back with very few words / `wall:true` is a dud — drop it and read a replacement from the shortlist, so you finish having genuinely read ~8.
4. Rank them, **recording per article a rating (1–10) and a one-line "why it fits" verdict** — the same opinionated read the interactive junior picker gives the owner (the story hook, the words/concepts you found, the domain, any reservation, and explicitly *why it clears the 11-year-old gate*). **An article that fails a hard gate (1, 3, 4, 6) is capped low and never balloted, whatever its payload.** Take the **top 5** as the candidates (`source: "Economist"`, no `kind` — the junior ballot is news only, so the modal shows no section labels).
5. **Persist the ranked field for the afternoon run.** `mkdir -p .bot/state` and write `.bot/state/${TODAY}-junior-field.json` for the 5 balloted candidates, in rank order:
   ```json
   { "date": "<TODAY>", "track": "junior", "generatedAt": "<ISO timestamp>",
     "ranked": [ { "rank": 1, "rating": 8, "title": "<exact ballot title>", "articleUrl": "<url>", "source": "Economist", "words": <read.mjs word count>, "why": "<the one-line verdict>" }, … ] }
   ```
   `auto-publish-junior`'s tally (`.bot/tally.mjs --track=junior`) reads it to break a tied vote and to pick when nobody voted; `capture.mjs --track=junior` cross-checks its word count against `words` (an independent read of the same page — it catches a capture that silently dropped body text). A missing file degrades both — don't skip it. (`.bot/state/` is box-local and gitignored; the senior run writes `${TODAY}-field.json`, a different file.)

## Step 3 — Write the ballot and open the junior vote

1. For every candidate write a **pitch**: 1–2 **short, plain sentences for grades 5–7**, **spoiler-free, honest, and equally enthusiastic across all five** (they must not steer the vote — no "my favorite", no visible ranking).
2. Write the 5 to a temp JSON array of `{title, source, pitch, articleUrl}` (no `kind`):
   ```bash
   # /tmp/junior-ballot.json — 5 news candidates
   ```
3. Open the poll on the **junior** track with the box-local opener (`scripts/open-vote.mjs` can't run here — no PostgREST keys):
   ```bash
   node --env-file=.env.local .bot/open-vote.mjs "${TODAY}" /tmp/junior-ballot.json --track=junior
   ```
   It refuses if `content/junior/${TODAY}.json` exists, refuses any candidate matching an already-published reading on either track, and upserts idempotently on `(track,date)` otherwise. Add `--dry-run` to validate without writing. **Never omit `--track=junior`** — without it the ballot overwrites the senior poll.
4. **Verify live:** `curl -s "https://dailyreadingclub.com/api/vote?track=junior"` should show `"active": true` with your candidates for `${TODAY}`. If it doesn't, do **not** notify — log the failure and stop.

## Step 4 — Notify the owner (your ranked verdict, with reasoning)

Text the owner your **ranked assessment** — the opinionated field the interactive picker gives, **not** a bare title list and **not** the kids' pitches. This is the owner's whole window into your judgment, so it must explain *why*: for each candidate, the story hook, the words/concepts, and how it clears the 11-year-old gate. **Every candidate line MUST end with its article link.**

Compose one WhatsApp message (mind the length; concise verdicts):
- **Header:** the **junior** vote is open, `${TODAY}`, the junior vote link, and the fixed close (11:00am Pacific; `auto-publish-junior` tallies and publishes the winner once the senior day has shipped).
- **Top pick** (1–2 sentences + its link): title, rating, and the real case.
- **Ranked** (5 lines): `N. [Economist] title — R/10 — <why it fits> — <url>`.
- **Dropped:** one line on the notable cuts and why (especially anything cut on the 11-year-old gate or appropriateness), so the owner sees the judgment calls.

Write the message to a temp file and send with `--file`:

```bash
cat > /tmp/junior-vote-notify.txt <<'MSG'
🗳️ JUNIOR Reading Club vote is open — <TODAY>
Vote: https://dailyreadingclub.com/junior
Closes 11:00am PT — the winner auto-publishes after the senior day

⭐ TOP PICK [Economist] <title> (R/10)
<1–2 sentence case: story hook, words/concepts, why an 11-year-old can follow it>
<url>

JUNIOR BALLOT
1. [Economist] <title> — R/10 — <why it fits> — <url>
2. …(through 5, each with its url)

Dropped: <notable cuts + why>
MSG
node --env-file=.bot/.env .bot/notify.mjs --file /tmp/junior-vote-notify.txt
```

(`<TODAY>` must be the real date — write the literal value; the heredoc is single-quoted.) The message goes to the owner's DM (the default target) — **never to the club group**.

Keep the **ballot pitches** (Step 3) exactly as written — spoiler-free and non-steering, for the kids. Your ranking and opinion live **only** in this owner notification.

Then stop. Do **not** author the reading — the club votes until **11:00am Pacific**; `auto-publish-junior` (`run-auto-publish.sh --track=junior`) tallies the poll and publishes the winner, which is what closes it. The owner can still publish by hand before then with `wsj-reading-junior`; the afternoon run then finds the day published and does nothing.

## Failure handling

- Any hard failure before the poll is open (scout throws, fewer than 2 articles clear the gates, open-vote errors) → **do not notify**; write the reason to the log and exit non-zero so the cron log shows it. A silent no-vote beats a broken or half-open ballot.
- **A thin field is not a reason to lower the gates.** If only 2–4 articles genuinely clear them, ballot those (the opener accepts 2–12) rather than padding with a piece that fails the 11-year-old test or the appropriateness bar.
- Never publish a poll you didn't actually assemble from articles you read. No placeholder candidates.
