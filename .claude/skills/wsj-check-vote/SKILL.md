---
name: wsj-check-vote
description: Check the day's article vote for the Reading Club. Use when the user says "check the vote", "what's the tally", "who won the vote", "which article won", or wants the result of the poll opened with wsj-open-vote — including the JUNIOR track ("check the junior vote"). Reads the poll and every ballot from Vercel Blob, presents the tally with voter names (owner-only view), and hands over the winning article's link ready for the wsj-reading (or wsj-reading-junior) skill.
---

# WSJ Reading Club — check the day's vote

You are reading back the **daily article vote** that `wsj-open-vote` opened (see "The daily vote" in CLAUDE.md). This is the owner-side view: unlike the website (which shows counts only), the tally here includes **who voted for what**, so the user can see participation.

**The vote is per-track:** default senior; "check the junior vote" means the **junior** poll (`--track=junior`). The two tracks' polls are independent — check the one the user asked about.

## Workflow

1. **Run the tally script:**

   ```bash
   node --env-file=.env.local scripts/check-vote.mjs                  # senior
   node --env-file=.env.local scripts/check-vote.mjs --track=junior   # junior
   ```

   (It defaults to the track's newest poll; pass `<YYYY-MM-DD>` to check a specific one.)

2. **Present the result:** per-candidate counts with voter names, total ballots, and the winner with its article link. On a **tie** (or zero votes), say so plainly — the user breaks it by just picking; the vote is advisory and the site never claims "the winner was X".

3. **Hand off, don't proceed.** The next step is the user invoking **wsj-reading** (senior) / **wsj-reading-junior** (junior) with the winning (or chosen) link — wait for them to say so (they may just say "go with the winner", in which case run the track's reading skill with that URL). Publishing the reading is what closes that track's poll — the poll row disappears on its own and the published day carries the CLUB PICK chip (`clubPick: true`, which the reading skill sets when a poll exists for the date).

Checking the tally does NOT close the poll — people can keep voting until the reading is published, so it's fine to peek mid-window.
