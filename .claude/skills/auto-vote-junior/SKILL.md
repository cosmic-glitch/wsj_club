---
name: auto-vote-junior
description: AUTONOMOUS daily JUNIOR vote opener for the Reading Club (US grades 5–7), run UNATTENDED from the Hetzner box by cron right after the senior auto-vote at 6am Pacific — NOT the interactive picker. Scouts The Economist's story-first sections via the saved session in .bot/, picks the day's 5 junior candidates with no human sign-off, opens the junior vote via .bot/open-vote.mjs --track=junior, and texts the owner over nanoclaw. Never uses WSJ. Do NOT invoke this by hand for the normal interactive flow — use wsj-open-vote ("open the junior vote") for that.
---

# Reading Club — autonomous daily JUNIOR vote (Hetzner cron)

You are running unattended on the Hetzner box: `run-auto-vote.sh` ran `vote-track.sh --track=junior` right after the senior run at 6am Pacific. Pick the day's 5 junior candidates, open the junior vote, text the owner. Nobody screens the ballot before ten-year-olds see it, so you are the validation layer. A weak candidate just loses the vote; a too-hard or inappropriate one is the failure to avoid.

Same mechanics as `auto-vote` (Economist only, news only, `.bot/` scripts, run from `~/wsj_club` with `node --env-file=.bot/.env …`). The senior poll is a different poll; its state is irrelevant here.

## Step 0 — Date and idempotency

`TODAY="${AUTOVOTE_DATE:-$(TZ=America/Los_Angeles date +%F)}"` (the override is for supervised test runs only). Exit without opening or notifying if either is true: `content/junior/${TODAY}.json` exists, or `curl -s "https://dailyreadingclub.com/api/vote?track=junior"` shows `"active": true` for `${TODAY}`.

## Who this is for

The readers are sharp US students in grades 5–7, ages 10 to 13. The handout will teach three words one band below SAT tier (the *reluctant / abundant / deliberate / fragile* register) and at most two concepts from scratch; everything else the article assumes, the reader must already hold. Pick what a good teacher would hand this class today: a full-text article a curious 11-year-old with no background can follow, told as a story rather than an argument. Things a 10-year-old cannot do: lean on abstraction, read irony or satire literally, catch a columnist's allusions, or hold an article much past 1,200 words (`read.mjs` reports `words`; over 1,500 is a pass unless exceptional, and Briefings, 1843 long-reads and multi-part essays are out). Appropriateness is a 5th-grader's parent's call: nothing centred on violence, sexual content, drugs, self-harm, abuse, or bleak-without-payoff subjects; hard news and geopolitics are fine when the value is understanding, and when in doubt leave it off. The scout prints the junior track's last ten readings so you know what they have seen lately; overlap with the senior track's topics is not a strike.

## Step 1 — Candidates

1. `node --env-file=.bot/.env .bot/scout.mjs --track=junior > /tmp/econ-junior-candidates.json` → `[{url, headline, section}]` from the homepage and the story-first sections, minus already-published readings. Its stderr lists the last ten junior readings and any candidates dropped as already read.
2. Shortlist about 10 by headline. Read them in full: `node --env-file=.bot/.env .bot/read.mjs <url…>` → `[{url,title,words,wall,text}]`. Judge on the text. A piece with very few words or `wall:true` is a dud; replace it so you finish having read about 8.
3. Check the shortlist against published titles yourself (`grep -h '"title"' content/*.json content/junior/*.json`). The scout and the opener both filter duplicates by URL and title, but a reworded headline can slip past string matching, and a repeat article on either track is disqualified however strong.
4. Rank them with a 1–10 rating and a one-line verdict each, saying why an 11-year-old can follow it. Take the top 5 (`source: "Economist"`, no `kind`).
5. Write `.bot/state/${TODAY}-junior-field.json` (`mkdir -p .bot/state`), in rank order:
   ```json
   { "date": "<TODAY>", "track": "junior", "generatedAt": "<ISO timestamp>",
     "ranked": [ { "rank": 1, "rating": 8, "title": "<exact ballot title>", "articleUrl": "<url>", "source": "Economist", "words": <read.mjs word count>, "why": "<verdict>" }, … ] }
   ```
   The junior publish run's tally uses it to break ties and to pick when nobody voted; its capture cross-checks `words` against its own count. Don't skip it. (The senior run writes `${TODAY}-field.json`, a different file.)

## Step 2 — Open the junior vote

1. Write a pitch per candidate: 1–2 short, plain sentences for grades 5–7, spoiler-free, equally enthusiastic across all 5, no visible ranking.
2. Write the 5 as a JSON array of `{title, source, pitch, articleUrl}` (no `kind`) to `/tmp/junior-ballot.json`.
3. `node --env-file=.env.local .bot/open-vote.mjs "${TODAY}" /tmp/junior-ballot.json --track=junior` (`--dry-run` validates without writing). It refuses a published day or a duplicate candidate on either track and upserts idempotently on `(track,date)`. **Never omit `--track=junior`**: without it the ballot overwrites the senior poll.
4. Verify: `curl -s "https://dailyreadingclub.com/api/vote?track=junior"` shows `"active": true` with your candidates. If not, log and stop without notifying.

## Step 3 — Notify the owner

The DM is the owner's only window into your judgment, so it carries your ranking and reasons, never the kids' pitches. Every candidate line ends with its link. Write it to a file and send with `--file`, with the real date filled in. It goes to the owner's DM (the default target), never to the club group.

```bash
cat > /tmp/junior-vote-notify.txt <<'MSG'
🗳️ JUNIOR Reading Club vote is open — <TODAY>
Vote: https://dailyreadingclub.com/junior
Closes 9:00am PT once both tracks have a vote (noon at the latest) — the winner auto-publishes after the senior day

⭐ TOP PICK [Economist] <title> (R/10)
<1–2 sentence case: the story, the words and concepts, why an 11-year-old can follow it>
<url>

JUNIOR BALLOT
1. [Economist] <title> — R/10 — <why it fits> — <url>
2. …(through 5)

Dropped: <notable cuts + why>
MSG
node --env-file=.bot/.env .bot/notify.mjs --file /tmp/junior-vote-notify.txt
```

Then stop. Do not author the reading; the junior publish run tallies and publishes the winner right after the senior day ships, which closes the vote. If the owner publishes by hand first, that run finds the day published and does nothing.

## Failure handling

A hard failure before the poll is open (scout throws, fewer than 2 articles fit, opener errors): do not notify, write the reason to the log, exit non-zero. A thin field is not a reason to lower the bar: if only 2–4 articles genuinely fit, ballot those (the opener accepts 2–12) rather than padding. Never open a poll built from articles you did not read; no placeholder candidates.
