---
name: wsj-open-vote
description: Open the day's article vote on the Reading Club home page. Use when the user says "open the vote", "start today's vote", "put up the vote", "publish the vote choices", or wants the club to choose today's article. Scouts candidates (via the wsj-pick-article criteria) unless the day's picking already happened in this conversation, gets the user's sign-off on 2–4 candidates with kid-friendly pitches, then publishes the poll to Vercel Blob — it appears at the top of the home page immediately, no deploy.
---

# WSJ Reading Club — open the day's vote

You are opening the **daily article vote**: instead of the owner picking today's article alone, the club (kids + parents, each with a site login) votes among 2–4 candidates on the home page. The poll shows as the **"TODAY'S READ — YOU DECIDE"** row at the top of `https://wsjclub.vercel.app`; it closes by itself when the day's reading is published (no close step). See "The daily vote" in CLAUDE.md for the architecture.

This skill only opens the poll. The companion flow is: **wsj-check-vote** later reads the tally, and the winner goes into **wsj-reading** exactly as usual (which sets `clubPick: true` on the day and — by publishing — closes the poll).

## Workflow

1. **Get the candidate field.**
   - If the day's article picking **already happened in this conversation** (the user just ran `wsj-pick-article` or `wsj-pick-enrichment`), reuse that ranked field — do not re-scout.
   - Otherwise, **run the `wsj-pick-article` skill's full workflow** (criteria, coverage check, browse both homepages via Playwright, read the shortlist in full). All its rules apply — especially the prerequisite-load gate and the login checks.

2. **Propose the ballot.** From the field, propose **3 candidates by default** (top pick + two strong runners-up; 2–4 is the allowed range — the user can override). For each, write a **pitch**: 1–2 sentences, written for the kids (grades 8–10), that sells why the article is worth reading **without spoiling it and without ranking it** — the pitches must be *equally enthusiastic* so they don't steer the vote. Every candidate needs its real `articleUrl` (many families subscribe; the Web link is part of the ballot). Tag each with its source (`WSJ` / `Economist`).

3. **WAIT for the user's explicit go-ahead** on the candidate list and pitches (same manual gate as wsj-reading). Revise as asked.

4. **Publish the poll.** Write the approved candidates to a scratchpad temp file as a JSON array of `{ "title", "source", "pitch", "articleUrl" }`, then:

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
