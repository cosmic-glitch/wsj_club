---
name: auto-vote
description: AUTONOMOUS daily vote opener for the Reading Club, run UNATTENDED from the Hetzner box by cron at 6am Pacific — NOT the interactive picker. Scouts The Economist via the saved session in .bot/, picks the day's 7 senior candidates with no human sign-off, opens the vote via .bot/open-vote.mjs, and texts the owner over nanoclaw. Never uses WSJ. Do NOT invoke this by hand for the normal interactive flow — use wsj-open-vote for that.
---

# Reading Club — autonomous daily vote (Hetzner cron)

You are running unattended on the Hetzner box: `run-auto-vote.sh` fired at 6am Pacific and ran `vote-track.sh` for the senior track. Pick the day's 7 candidates, open the senior vote, text the owner. Nobody screens the ballot before the club sees it, so you are the validation layer. A weak candidate just loses the vote; an inappropriate one is the failure to avoid.

Economist only (WSJ blocks this box), news only (enrichment is interactive), browsing through the `.bot/` scripts (no Playwright MCP here). Run everything from `~/wsj_club`; invoke `.bot/` scripts with `node --env-file=.bot/.env …` so an expired session can self-refresh. The junior track has its own sibling, `auto-vote-junior`; nothing here touches the junior poll.

## Step 0 — Date and idempotency

`TODAY="${AUTOVOTE_DATE:-$(TZ=America/Los_Angeles date +%F)}"` (the override is for supervised test runs only). Exit without opening or notifying if either is true: `content/${TODAY}.json` exists (the day is published, a poll would be born closed), or `curl -s https://dailyreadingclub.com/api/vote` shows `"active": true` for `${TODAY}`.

## Who this is for

The readers are sharp US students in grades 8–10. The handout will teach three vocabulary words and about three concepts from scratch; everything else the article assumes, the reader must already hold. Pick what a good teacher would hand this class today: a well-written, full-text article that a curious 14-year-old with no background in the topic can follow, and that is fit to hand a 13-year-old (war and politics are fine, gore and sexual content are not). The scout prints the club's last ten readings so you know what they have seen lately.

## Step 1 — Candidates

1. `node --env-file=.bot/.env .bot/scout.mjs > /tmp/econ-candidates.json` → `[{url, headline, section}]` from the homepage and main sections, minus already-published readings. Its stderr lists the last ten published readings and any candidates it dropped as already read.
2. Shortlist about 12 by headline. Read them in full: `node --env-file=.bot/.env .bot/read.mjs <url…>` → `[{url,title,words,wall,text}]`. Judge on the text. A piece with very few words or `wall:true` is a dud; replace it so you finish having read about 10.
3. Check the shortlist against published titles yourself (`grep -h '"title"' content/*.json content/junior/*.json`). The scout and the opener both filter duplicates by URL and title, but a reworded headline can slip past string matching, and a repeat article is disqualified however strong.
4. Rank them with a 1–10 rating and a one-line verdict each. Take the top 7 (`kind: "news"`, `source: "Economist"`).
5. Write `.bot/state/${TODAY}-field.json` (`mkdir -p .bot/state`), in rank order:
   ```json
   { "date": "<TODAY>", "generatedAt": "<ISO timestamp>",
     "ranked": [ { "rank": 1, "rating": 8, "title": "<exact ballot title>", "articleUrl": "<url>", "source": "Economist", "words": <read.mjs word count>, "why": "<verdict>" }, … ] }
   ```
   The publish run's tally uses it to break ties and to pick when nobody voted; its capture cross-checks `words` against its own count. Don't skip it.

## Step 2 — Open the vote

1. Write a pitch per candidate: 1–2 sentences for the kids, spoiler-free, equally enthusiastic across all 7, no visible ranking.
2. Write the 7 as a JSON array of `{title, source, pitch, articleUrl, kind}` to `/tmp/ballot.json`.
3. `node --env-file=.env.local .bot/open-vote.mjs "${TODAY}" /tmp/ballot.json` (the box-local opener over `SUPABASE_DB_URL`; `--dry-run` validates without writing). It refuses a published day or a duplicate candidate and upserts idempotently on `(track,date)`.
4. Verify: `curl -s https://dailyreadingclub.com/api/vote` shows `"active": true` with your candidates. If not, log and stop without notifying.

## Step 3 — Notify the owner

The DM is the owner's only window into your judgment, so it carries your ranking and reasons, never the kids' pitches. Every candidate line ends with its link. Write it to a file and send with `--file`, with the real date filled in:

```bash
cat > /tmp/vote-notify.txt <<'MSG'
🗳️ Reading Club vote is open — <TODAY>
Vote: https://dailyreadingclub.com
Closes 9:00am PT once both tracks have a vote (noon at the latest) — the winner auto-publishes then

⭐ TOP PICK [Economist] <title> (R/10)
<1–2 sentence case: concepts, hook, why it leads the field>
<url>

NEWS
1. [Economist] <title> — R/10 — <why it fits> — <url>
2. …(through 7)

Dropped: <notable cuts + why>
MSG
node --env-file=.bot/.env .bot/notify.mjs --file /tmp/vote-notify.txt
```

Then stop. Do not author the reading; the publish run tallies and publishes the winner, which closes the vote. If the owner publishes by hand first, that run finds the day published and does nothing.

## Failure handling

A hard failure before the poll is open (scout throws, nothing readable, opener errors): do not notify, write the reason to the log, exit non-zero. Never open a poll built from articles you did not read; no placeholder candidates.
