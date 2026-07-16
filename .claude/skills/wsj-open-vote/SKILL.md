---
name: wsj-open-vote
description: Open the day's article vote on the Reading Club home page. Use when the user says "open the vote", "start today's vote", "put up the vote", "publish the vote choices", or wants the club to choose today's article. Builds a ~10-candidate ballot — 7 news picks (via the wsj-pick-article workflow) + 3 enrichment picks (via the wsj-pick-enrichment workflow) — gets the user's sign-off on the candidates and their kid-friendly pitches, then publishes the poll to Vercel Blob; it appears at the top of the home page immediately, no deploy.
---

# WSJ Reading Club — open the day's vote

You are opening the **daily article vote**: instead of the owner picking today's article alone, the club (kids + parents, each with a site login) votes among the day's candidates on the home page. The poll shows as the **"TODAY'S READ — YOU DECIDE"** row at the top of `https://wsjclub.vercel.app` — a compact row whose VOTE button opens the ballot modal; it closes by itself when the day's reading is published (no close step). See "The daily vote" in CLAUDE.md for the architecture.

This skill only opens the poll. The companion flow is: **wsj-check-vote** later reads the tally, and the winner goes into **wsj-reading** exactly as usual (which sets `clubPick: true` on the day and — by publishing — closes the poll).

## The ballot: 7 news + 3 enrichment (one unified poll)

The default ballot is **10 candidates in two sections**:

- **7 news picks** — from the day's WSJ + Economist scouting (`wsj-pick-article`'s workflow).
- **3 enrichment picks** — timeless-wisdom reads from the broader free pool (`wsj-pick-enrichment`'s workflow).

The sections are **presentation only** — the voting modal shows light "The day's news" / "Enrichment — timeless reads" labels, but it is ONE poll with ONE vote across all 10. The `kind` field on each candidate (`"news"` / `"enrichment"`) is what drives the grouping. The user can override the counts (2–12 total is supported end-to-end).

## Workflow

1. **Get the candidate fields.**
   - **News:** if the day's picking **already happened in this conversation** (the user just ran `wsj-pick-article`), reuse that ranked field; otherwise **run the `wsj-pick-article` skill's full workflow** (criteria, coverage check, browse both homepages via Playwright, read the shortlist in full). All its rules apply — especially the prerequisite-load gate and the login checks. Take the **top 7** of the ranked field as the news candidates.
   - **Enrichment:** likewise reuse a `wsj-pick-enrichment` run from this conversation, or **run that skill's full workflow** (its source tiers, the ≤2,000-word hard rule, the already-used-URL exclusion). Take its **top 3** as the enrichment candidates.

2. **Propose the ballot.** For each of the ~10, write a **pitch**: 1–2 sentences, written for the kids (grades 8–10), that sells why the piece is worth reading **without spoiling it and without ranking it** — the pitches must be *equally enthusiastic* so they don't steer the vote. Every candidate needs its real `articleUrl` (many families subscribe; the READ IT link is part of the ballot — the enrichment sources are free/open anyway). Tag each with its **source label** (`WSJ` / `Economist` for news; the enrichment source's name — e.g. `Farnam Street`, `Morgan Housel` — for enrichment) and its **`kind`** (`news` / `enrichment`).

3. **WAIT for the user's explicit go-ahead** on the candidate list and pitches (same manual gate as wsj-reading). Revise as asked.

4. **Publish the poll.** Write the approved candidates to a scratchpad temp file as a JSON array of `{ "title", "source", "pitch", "articleUrl", "kind" }`, then:

   ```bash
   node --env-file=.env.local scripts/open-vote.mjs <YYYY-MM-DD> <that-file.json>
   ```

   The date is **today** (the vote is always for today's read — never tomorrow). The script refuses if `content/<date>.json` already exists, and warns when overwriting a poll that already has ballots (candidate ids are title slugs — keep titles unchanged when revising, or already-cast votes for them are orphaned).

5. **Verify it's live:** `curl -s https://wsjclub.vercel.app/api/vote` should return `"active": true` with the candidates. (Blob is read live — no build, no commit, no deploy for this step; there is nothing to push.)

6. **Remind the user** to announce the voting window in the group chat — the site deliberately shows **no deadline** (the owner's message is the deadline; publishing the reading is what actually closes the poll).

## Hard rules

- **The user is the validation layer** — never publish a poll they haven't explicitly approved.
- Candidate pitches must be **spoiler-free, honest, and non-steering** (no "my favorite", no quality ranking visible to voters).
- Votes are advisory: ties and vetoes are the owner's call, made silently at publish time. Don't build any of that into the poll.
