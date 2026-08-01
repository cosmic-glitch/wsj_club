# Reading Club auto-vote bot — recovery (Hetzner-only)

`.bot/` is the box-local runtime for the `auto-vote` skill (`.claude/skills/auto-vote/`).
The **code here is committed**; the **secrets are not**. If the Hetzner box is
lost, restore the working state on a fresh box as follows.

Everything runs from the repo root (`~/wsj_club`). Paths below assume that.

## Prerequisites
- `~/wsj_club` cloned, Node ≥ 20 on PATH.
- nanoclaw installed and running on the box (for the WhatsApp notification).

## Steps

1. **Install deps + browser** (node_modules and the Playwright binaries are not in git):
   ```bash
   cd ~/wsj_club/.bot
   npm install
   npx playwright install --with-deps chromium
   ```

2. **Recreate the secret files** (never in git):
   - `~/wsj_club/.bot/.env` — `chmod 600`:
     ```
     ECON_EMAIL='...'                          # Economist login (owner has the password)
     ECON_PASS='...'
     NANOCLAW_CHATJID='<number>@s.whatsapp.net' # owner's WhatsApp DM
     ```
   - `~/wsj_club/.env.local` — must contain at least `SUPABASE_DB_URL` (from Vercel)
     and `BLOB_READ_WRITE_TOKEN`. The bot does **not** need `SUPABASE_URL`/
     `SUPABASE_SERVICE_KEY` (it writes via `.bot/open-vote.mjs` over psql).

3. **Regenerate the Economist session** (creates `econ-state.json`):
   ```bash
   node --env-file=.bot/.env .bot/refresh-session.mjs
   ```

4. **Smoke-test** the pieces:
   ```bash
   node --env-file=.bot/.env .bot/scout.mjs | head          # Economist candidates
   node --env-file=.bot/.env .bot/notify.mjs "recovery test" # should hit WhatsApp
   ```

5. **Re-arm the cron** (opens the daily senior vote at 6am Pacific; fires at
   13:00 & 14:00 UTC and the script's Pacific gate lets exactly one proceed):
   ```
   0 13,14 * * *  bash $HOME/wsj_club/.bot/run-auto-vote.sh >> $HOME/wsj_club/.bot/logs/cron.log 2>&1
   ```

## Manual run (test any date without waiting for 6am)
```bash
AUTOVOTE_FORCE=1 AUTOVOTE_DATE=YYYY-MM-DD bash ~/wsj_club/.bot/run-auto-vote.sh
```

## What each file does
- `lib.mjs` — browser + session helpers; login check = "can I read a full article",
  auto-refresh via `.env`.
- `scout.mjs` — sweep the Economist for candidate news articles.
- `read.mjs` — full article text + word count (also sizes the enrichment ≤2,000 gate).
- `refresh-session.mjs` — re-login and overwrite `econ-state.json`.
- `open-vote.mjs` — psql/`pg` upsert into `rc_polls` (box has no PostgREST keys).
- `notify.mjs` — drop a nanoclaw IPC message → owner's WhatsApp.
- `run-auto-vote.sh` — cron entrypoint (Pacific gate → `git pull` → `claude -p`).
