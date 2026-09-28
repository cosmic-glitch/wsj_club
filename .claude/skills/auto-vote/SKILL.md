---
name: auto-vote
description: AUTONOMOUS daily vote opener for the Reading Club, BOTH tracks in one run, executed UNATTENDED from the Hetzner box by cron at 6am Pacific — NOT the interactive picker. Scouts The Economist once via the saved session in .bot/, rates every candidate for the senior (grades 8–10) and junior (grades 5–7) tracks together, splits them into two disjoint ballots (7 senior, 5 junior — no article on both), opens both votes via .bot/open-vote.mjs, and texts the owner one summary over nanoclaw. Never uses WSJ. Do NOT invoke this by hand for the normal interactive flow — use wsj-open-vote for that.
---

# Reading Club — autonomous daily vote, both tracks (Hetzner cron)

You are running unattended on the Hetzner box: `run-auto-vote.sh` fired at 6am Pacific. In one pass, pick the day's 7 senior candidates and 5 junior candidates from the same scouted field, open both votes, text the owner once. Nobody screens the ballots before the club sees them, so you are the validation layer. A weak candidate just loses the vote; an inappropriate one (or, for junior, a too-hard one) is the failure to avoid.

Economist only (WSJ blocks this box), news only (enrichment is interactive), browsing through the `.bot/` scripts (no Playwright MCP here). Run everything from `~/wsj_club`; invoke `.bot/` scripts with `node --env-file=.bot/.env …` so an expired session can self-refresh.

## Step 0 — Date, tracks, idempotency

`TODAY="${AUTOVOTE_DATE:-$(TZ=America/Los_Angeles date +%F)}"` (the override is for supervised test runs only). `AUTOVOTE_TRACKS` (set by the wrapper; default `senior junior`) lists the tracks this run may touch — a track not in it is switched off and you leave its poll alone.

A track is **done** (skip opening it, never notify about it) if its reading is published — `content/${TODAY}.json` (senior) / `content/junior/${TODAY}.json` — or its vote is already live: `curl -s https://dailyreadingclub.com/api/vote` (senior) / `curl -s "https://dailyreadingclub.com/api/vote?track=junior"` shows `"active": true` for `${TODAY}`. Remove done tracks from the set. If no track is left, exit quietly. Otherwise proceed for the remaining track(s) — but **read the live ballot of a done track** (from that `/api/vote` response) so you don't put one of its articles on the other track's ballot.

## Who this is for

**Senior (`/`, US grades 8–10).** The handout will teach three vocabulary words and about three concepts from scratch; everything else the article assumes, the reader must already hold. Pick what a good teacher would hand this class today: a well-written, full-text article that a curious 14-year-old with no background in the topic can follow, and that is fit to hand a 13-year-old (war and politics are fine, gore and sexual content are not).

**Junior (`/junior`, US grades 5–7, ages 10 to 13).** The handout will teach three words one band below SAT tier (the *reluctant / abundant / deliberate / fragile* register) and at most two concepts from scratch; everything else the article assumes, the reader must already hold. Pick what a good teacher would hand this class today: a full-text article a curious 11-year-old with no background can follow, told as a story rather than an argument. Things a 10-year-old cannot do: lean on abstraction, read irony or satire literally, catch a columnist's allusions, or hold an article much past 1,200 words (`read.mjs` reports `words`; over 1,500 is a pass unless exceptional, and Briefings, 1843 long-reads and multi-part essays are out). Appropriateness is a 5th-grader's parent's call: nothing centred on violence, sexual content, drugs, self-harm, abuse, or bleak-without-payoff subjects; hard news and geopolitics are fine when the value is understanding, and when in doubt leave it off.

The scout prints each track's last ten readings so you know what they have seen lately; overlap in topic between the tracks is not a strike, but the same article is never on both ballots (see Step 2).

## Step 1 — Scout and read

1. `node --env-file=.bot/.env .bot/scout.mjs > /tmp/econ-candidates.json` → one array for both tracks, sorted in the editors' order, minus already-published readings on either track. Each candidate: `{url, headline, section, published, tracks, homepageRank, homepageZone, hubs}` — `tracks` says which ballots the piece is eligible for by section (Leaders, Briefing, Finance, By Invitation, 1843, Obituary are senior-only). Its stderr lists both tracks' last ten readings and any candidates dropped as already read.
2. **Weigh the editors' placement.** The Economist's editors have already ranked the day, and their ranking counts: `homepageRank` is the position on the homepage in the order they laid it out (1 = the lead; the first dozen or so are the day's lead spread, `homepageZone: "front"`); a piece in `"stories most read by subscribers"` is one readers are choosing; a hub-only piece (`homepageRank: null`) is one the editors did not front today — the hubs are reverse-chronological, and `published` says how old it is. Placement is not a substitute for reading, but it sets the order of the shortlist and lifts a rating: between two pieces of equal merit the fronted one ranks higher, a homepage lead that you leave off a ballot needs a stated reason, and a hub-only piece needs a specific reason to make a ballot over a fronted one.
3. Shortlist about 16 by headline, working down the placement order with both audiences in mind — roughly 10 with senior eyes and 6 with junior eyes (junior-eligible pieces that read as stories), the day's lead spread first. Read them in full in one call: `node --env-file=.bot/.env .bot/read.mjs <url…>` → `[{url,title,words,wall,text}]`. Judge on the text. A piece with very few words or `wall:true` is a dud; replace it so you finish having read about 14.
4. Check the shortlist against published titles yourself (`grep -h '"title"' content/*.json content/junior/*.json`). The scout and the opener both filter duplicates by URL and title, but a reworded headline can slip past string matching, and a repeat article on either track is disqualified however strong.

## Step 2 — Rate for both tracks, then split

1. Give every article you read a 1–10 rating **per track it is eligible for**, with a one-line verdict each (for junior, say why an 11-year-old can follow it). An article that is wrong for a track (too long, too abstract, senior-only section, inappropriate) simply gets no rating there.
2. **One article, one ballot.** Allocate so the two ballots share no article — and never the top pick: a piece that leads both fields cannot appear on both. When a piece fits both tracks, give it to the track where it is the stronger candidate relative to that track's own field (where dropping it costs more); a genuine toss-up goes to **junior**, whose fit pieces on The Economist are scarcer. Fill senior with the best 7 remaining senior-rated pieces, junior with the best 5 remaining junior-rated pieces. A done or switched-off track keeps its live ballot (from Step 0) out of the other's; you still allocate only the open track(s).
3. Write the field files (`mkdir -p .bot/state`), each in that track's rank order. Senior → `.bot/state/${TODAY}-field.json`, junior → `.bot/state/${TODAY}-junior-field.json` (skip a track you are not opening):
   ```json
   { "date": "<TODAY>", "track": "senior|junior", "generatedAt": "<ISO timestamp>",
     "ranked": [ { "rank": 1, "rating": 8, "title": "<exact ballot title>", "articleUrl": "<url>", "source": "Economist", "words": <read.mjs word count>, "homepageRank": <number or null>, "why": "<verdict>" }, … ] }
   ```
   The publish run's tally uses them to break ties and to pick when nobody voted; its capture cross-checks `words` against its own count. Don't skip them.

## Step 3 — Open the vote(s)

For each track you are opening:

1. Write a pitch per candidate: 1–2 sentences for the kids (senior: grades 8–10; junior: short, plain sentences for grades 5–7), spoiler-free, equally enthusiastic across the ballot, no visible ranking.
2. Write the ballot as a JSON array of `{title, source, pitch, articleUrl, kind}` — senior gets `kind: "news"`, junior omits `kind` — to `/tmp/ballot.json` (senior) / `/tmp/junior-ballot.json`.
3. Open it (the box-local opener over `SUPABASE_DB_URL`; `--dry-run` validates without writing). It refuses a published day or a duplicate candidate on either track and upserts idempotently on `(track,date)`:
   ```bash
   node --env-file=.env.local .bot/open-vote.mjs "${TODAY}" /tmp/ballot.json
   node --env-file=.env.local .bot/open-vote.mjs "${TODAY}" /tmp/junior-ballot.json --track=junior
   ```
   **Never omit `--track=junior` on the junior ballot**: without it the ballot overwrites the senior poll.
4. Verify: that track's `/api/vote` (Step 0's URLs) shows `"active": true` with your candidates. If not, log it and do not mention that track in the DM; if neither track verified, stop without notifying.

## Step 4 — Notify the owner, once

The DM is the owner's only window into your judgment, so it carries your rankings and reasons — never the kids' pitches — for both tracks in one message; leave out a track you did not open. Every candidate line ends with its link. Write it to a file and send with `--file`, with the real date filled in:

```bash
cat > /tmp/vote-notify.txt <<'MSG'
🗳️ Reading Club votes are open — <TODAY>
Vote: https://dailyreadingclub.com · junior: https://dailyreadingclub.com/junior
Close 9:00am PT once both tracks have a vote (noon at the latest) — the winners auto-publish then

⭐ SENIOR TOP PICK [Economist] <title> (R/10, homepage #<n>)
<1–2 sentence case: concepts, hook, why it leads the field>
<url>

SENIOR BALLOT
1. [Economist] <title> — R/10 — <why it fits> — <url>
2. …(through 7)

⭐ JUNIOR TOP PICK [Economist] <title> (R/10, homepage #<n>)
<1–2 sentence case: the story, the words and concepts, why an 11-year-old can follow it>
<url>

JUNIOR BALLOT
1. [Economist] <title> — R/10 — <why it fits> — <url>
2. …(through 5)

Split: <any piece that fit both tracks and where it went, in a line>
Dropped: <notable cuts + why, including any homepage lead left off>
MSG
node --env-file=.bot/.env .bot/notify.mjs --file /tmp/vote-notify.txt
```

Then stop. Do not author the readings; the publish run tallies and publishes each winner, which closes that track's vote. If the owner publishes a track by hand first, that run finds the day published and does nothing.

## Failure handling

A hard failure before a poll is open (scout throws, nothing readable, opener errors): do not notify, write the reason to the log, exit non-zero. A thin junior field is not a reason to lower the bar: if only 2–4 articles genuinely fit junior, ballot those (the opener accepts 2–12) rather than padding; fewer than 2 means no junior poll today. One track failing never stops you from opening the other. Never open a poll built from articles you did not read; no placeholder candidates.
