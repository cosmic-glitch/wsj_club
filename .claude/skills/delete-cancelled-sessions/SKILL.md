---
name: delete-cancelled-sessions
description: Delete all cancelled voice-quiz sessions from Vercel Blob. Use when the user says "delete cancelled sessions", "clear out the cancelled quizzes", "clean up cancelled attempts", or wants to remove the ungraded student-cancelled attempts. Runs a prepackaged script that finds every session saved with `cancelled: true` and removes its JSON + audio recording.
---

# Delete cancelled voice-quiz sessions

This skill runs a prepackaged script that deletes every **cancelled** voice-quiz session from Vercel Blob. A cancelled session is one saved with `cancelled: true` — the student pressed **Cancel quiz**, so it ended early and was never graded (score `"—"`). They're safe cleanup targets, but **deletion is irreversible** (it removes the session JSON *and* its stitched audio recording from Blob — the same two blobs the admin Delete button removes).

The script lives next to this file: `.claude/skills/delete-cancelled-sessions/delete-cancelled-sessions.mjs`. Don't rewrite it inline — run it.

## How to run it

Always run from the **repo root** (so Node can resolve `@vercel/blob`) and pass the Blob token via `--env-file=.env.local` (it needs `BLOB_READ_WRITE_TOKEN`, which lives in the gitignored `.env.local`).

The script is **dry-run by default** — with no flag it only lists what it *would* delete and removes nothing. Deleting requires the `--yes` flag. Use this two-step flow:

1. **Preview.** Run the dry run and show the user the list:
   ```bash
   node --env-file=.env.local .claude/skills/delete-cancelled-sessions/delete-cancelled-sessions.mjs
   ```
   It prints each cancelled session (`date · student · endedAt · ±audio`) and how many blobs would be removed. If it reports zero, stop — there's nothing to delete.

2. **Confirm, then delete.** Show the user the list and get an explicit go-ahead (deletion is irreversible). Then run with `--yes`:
   ```bash
   node --env-file=.env.local .claude/skills/delete-cancelled-sessions/delete-cancelled-sessions.mjs --yes
   ```
   It deletes each cancelled session's JSON + audio and prints the final count.

## Notes

- **Only `cancelled: true` sessions are touched.** Completed attempts, `partial` (failure/hang) attempts, and `inProgress` (paused) slots are left alone.
- Nothing to build, deploy, or commit — this only mutates Blob data, not the site or the repo. There's no need to push after running it.
- If it errors with `BLOB_READ_WRITE_TOKEN is not set`, the `--env-file=.env.local` flag was missing or you ran it from outside the repo root. For a fresh checkout, `vercel env pull` (or recreate `.env.local`) to get the token.
