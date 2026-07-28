---
name: delete-cancelled-sessions
description: Delete all cancelled voice-quiz sessions — the Supabase rc_quiz_sessions rows (what production reads) plus their Vercel Blob JSON + audio. Use when the user says "delete cancelled sessions", "clear out the cancelled quizzes", "clean up cancelled attempts", or wants to remove the ungraded student-cancelled attempts. Runs a prepackaged script that finds every session saved with `cancelled: true` and removes it from both stores.
---

# Delete cancelled voice-quiz sessions

This skill runs a prepackaged script that deletes every **cancelled** voice-quiz session. A cancelled session is one saved with `cancelled: true` — the student pressed **Cancel quiz**, so it ended early and was never graded (score `"—"`). They're safe cleanup targets, but **deletion is irreversible**.

Since the Supabase read-flip, production reads sessions from the `rc_quiz_sessions` table, so the script is **DB-first**: it lists cancelled sessions from the DB, deletes each one's blobs (the session JSON via `source_blob`, the stitched audio via `audio_url`), then deletes the DB row — the same order and targets as the admin Delete button (`app/api/quiz-session/route.ts`). Deleting only from Blob leaves the attempts visible on the Reports page.

The script lives next to this file: `.claude/skills/delete-cancelled-sessions/delete-cancelled-sessions.mjs`. Don't rewrite it inline — run it.

## How to run it

Always run from the **repo root** (so Node can resolve `@vercel/blob`) and pass the env via `--env-file=.env.local` (it needs `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `BLOB_READ_WRITE_TOKEN`, all in the gitignored `.env.local`).

The script is **dry-run by default** — with no flag it only lists what it *would* delete and removes nothing. Deleting requires the `--yes` flag. Use this two-step flow:

1. **Preview.** Run the dry run and show the user the list:
   ```bash
   node --env-file=.env.local .claude/skills/delete-cancelled-sessions/delete-cancelled-sessions.mjs
   ```
   It prints each cancelled session (`date · track · student · endedAt · ±audio`). If it reports zero, stop — there's nothing to delete.

2. **Confirm, then delete.** Show the user the list and get an explicit go-ahead (deletion is irreversible). Then run with `--yes`:
   ```bash
   node --env-file=.env.local .claude/skills/delete-cancelled-sessions/delete-cancelled-sessions.mjs --yes
   ```
   For each session it deletes the blobs then the row (a blob failure keeps that session's row so nothing dangles), and prints the final count.

## Notes

- **Only `cancelled: true` sessions are touched.** Completed attempts, `partial` (failure/hang) attempts, and `inProgress` (paused) slots are left alone.
- Nothing to build, deploy, or commit — this only mutates data, not the site or the repo. There's no need to push after running it.
- If it errors about missing env vars, the `--env-file=.env.local` flag was missing or you ran it from outside the repo root. Sensitive values aren't `vercel env pull`-able — recreate `.env.local` by hand on a fresh checkout.
