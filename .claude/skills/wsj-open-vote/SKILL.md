---
name: wsj-open-vote
description: Open the day's article vote on the Reading Club home page. Use when the user says "open the vote", "start today's vote", "put up the vote", "publish the vote choices", or wants the club to choose today's article — including the JUNIOR track ("open the junior vote"). Senior ballot = 7 news picks (via the wsj-pick-article workflow) + 3 enrichment picks (via wsj-pick-enrichment); junior ballot = 5 news picks (via wsj-pick-article-junior). Gets the user's sign-off on the candidates and their kid-friendly pitches, then publishes the poll to the database; it appears at the top of the track's index immediately, no deploy.
---

# WSJ Reading Club — open the day's vote

You are opening the **daily article vote**: instead of the owner picking today's article alone, the club (kids + parents, each with a site login) votes among the day's candidates on the home page. The poll shows as the **"TODAY'S READ — YOU DECIDE"** row at the top of the track's index — `https://dailyreadingclub.com` (senior) or `https://dailyreadingclub.com/junior` (junior) — a compact row whose VOTE button opens the ballot modal; it closes by itself when that track's reading for the date is published (no close step). See "The daily vote" in CLAUDE.md for the architecture.

**The vote is per-track.** Default is **senior**; the user saying "open the junior vote" / "junior vote" selects the **junior** track, which changes three things: the candidate source (the junior picker), the ballot composition (5 news, no enrichment), and `--track=junior` on the script. The two tracks' polls are fully independent — one of each can be live at once.

This skill only opens the poll. The companion flow is: **wsj-check-vote** later reads the tally, and the winner goes into **wsj-reading** (senior) / **wsj-reading-junior** (junior) exactly as usual (publishing the reading is what closes that track's poll).

## The ballot

**Senior (default): 10 candidates in two sections, one unified poll.**

- **7 news picks** — from the day's WSJ + Economist scouting (`wsj-pick-article`'s workflow).
- **3 enrichment picks** — timeless-wisdom reads from the broader free pool (`wsj-pick-enrichment`'s workflow).

The sections are **presentation only** — the voting modal shows light "The day's news" / "Enrichment — timeless reads" labels, but it is ONE poll with ONE vote across all 10. The `kind` field on each candidate (`"news"` / `"enrichment"`) is what drives the grouping.

**Junior: 5 news picks, no enrichment section.** All candidates come from `wsj-pick-article-junior`'s ranked field (top 5); omit `kind` (all news, so the modal shows no section labels). There is no junior enrichment picker — keep the junior ballot news-only unless the user supplies enrichment candidates themselves.

The user can override the counts on either track (2–12 total is supported end-to-end).

## Workflow

1. **Get the candidate field(s).**
   - **Senior news:** if the day's picking **already happened in this conversation** (the user just ran `wsj-pick-article`), reuse that ranked field; otherwise **run the `wsj-pick-article` skill's full workflow** (criteria, coverage check, browse both homepages via Playwright, read the shortlist in full). All its rules apply — especially the prerequisite-load gate and the login checks. Take the **top 7** of the ranked field as the news candidates.
   - **Senior enrichment:** likewise reuse a `wsj-pick-enrichment` run from this conversation, or **run that skill's full workflow** (its source tiers, the ≤2,000-word hard rule, the already-used-URL exclusion). Take its **top 3** as the enrichment candidates.
   - **Junior:** reuse a `wsj-pick-article-junior` run from this conversation, or **run that skill's full workflow** (grades 5–7 calibration, the 11-year-old prerequisite gate, junior coverage check). Take its **top 5** as the whole ballot.

2. **Propose the ballot.** For each candidate, write a **pitch**: 1–2 sentences, written for the kids (**grades 8–10** for senior, **grades 5–7** for junior — shorter, plainer sentences), that sells why the piece is worth reading **without spoiling it and without ranking it** — the pitches must be *equally enthusiastic* so they don't steer the vote. Every candidate needs its real `articleUrl` (many families subscribe; the READ IT link is part of the ballot — the enrichment sources are free/open anyway). Tag each with its **source label** (`WSJ` / `Economist` for news; the enrichment source's name — e.g. `Farnam Street`, `Paul Graham` — for enrichment) and — senior only — its **`kind`** (`news` / `enrichment`).

3. **WAIT for the user's explicit go-ahead** on the candidate list and pitches (same manual gate as wsj-reading). Revise as asked.

4. **Publish the poll.** Write the approved candidates to a scratchpad temp file as a JSON array of `{ "title", "source", "pitch", "articleUrl", "kind" }` (omit `kind` on junior), then:

   ```bash
   node --env-file=.env.local scripts/open-vote.mjs <YYYY-MM-DD> <that-file.json>            # senior
   node --env-file=.env.local scripts/open-vote.mjs <YYYY-MM-DD> <that-file.json> --track=junior
   ```

   The date is **today** (the vote is always for today's read — never tomorrow). The script refuses if the track's `content/[junior/]<date>.json` already exists, and warns when overwriting a poll that already has ballots (candidate ids are title slugs — keep titles unchanged when revising, or already-cast votes for them are orphaned).

5. **Verify it's live:** `curl -s https://dailyreadingclub.com/api/vote` (senior) or `curl -s "https://dailyreadingclub.com/api/vote?track=junior"` should return `"active": true` with the candidates. (The poll is read live from the database — no build, no commit, no deploy for this step; there is nothing to push.)

6. **Remind the user** to announce the voting window in the group chat — the site deliberately shows **no deadline** (the owner's message is the deadline; publishing the reading is what actually closes the poll).

## Hard rules

- **The user is the validation layer** — never publish a poll they haven't explicitly approved.
- Candidate pitches must be **spoiler-free, honest, and non-steering** (no "my favorite", no quality ranking visible to voters).
- Votes are advisory: ties and vetoes are the owner's call, made silently at publish time. Don't build any of that into the poll.
