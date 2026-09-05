# Reading Club autopilot — recovery (Hetzner-only)

`.bot/` is the box-local runtime for the two autopilot skills, `auto-vote`
(6am Pacific: scout → ballot → open the vote) and `auto-publish` (11am Pacific:
tally → capture → author → ship). The **code here is committed**; the
**secrets are not**. If the Hetzner box is lost, restore the working state on a
fresh box as follows.

Everything runs from the repo root (`~/wsj_club`). Paths below assume that.

## Prerequisites
- `~/wsj_club` cloned, Node ≥ 20 on PATH, `claude` CLI logged in (the cron runs
  `claude -p`).
- nanoclaw installed and running on the box (for the WhatsApp notifications).
- **`xvfb-run`** (`apt install xvfb`). The Economist's bot challenge is only
  solved by a headed browser, so every browsing command runs under a virtual
  display. Headless silently fails: article pages come back 0 words.
- `ffmpeg` (optional — the audio scripts trim leading silence with it and fall
  back to the raw clip without it).
- Enough RAM for `next build` (the publish run builds before shipping; ~2 GB
  free — add swap on a small box).

## Steps

1. **Install deps + browser.** Two package trees: the repo root (the `scripts/`
   CLIs need `@vercel/blob`; the publish run needs `next build`) and `.bot/`
   (its own Playwright + `pg`):
   ```bash
   cd ~/wsj_club && npm ci
   cd ~/wsj_club/.bot && npm install && npx playwright install --with-deps chromium
   ```

2. **Recreate the secret files** (never in git):
   - `~/wsj_club/.bot/.env` — `chmod 600`:
     ```
     ECON_EMAIL='...'                          # Economist login (owner has the password)
     ECON_PASS='...'
     NANOCLAW_CHATJID='<number>@s.whatsapp.net' # owner's WhatsApp DM: the 6am ranked field, dry-run + warning notes
     NANOCLAW_GROUP_JID='<id>@g.us'             # the club's WhatsApp group: the 11am "Today's article is up" line
     ```
     The group JID is in nanoclaw's chat store (its SQLite `chats` table; group
     JIDs end in `@g.us`). Leave `NANOCLAW_GROUP_JID` unset and the announcement
     falls back to the owner's DM with a note — it is never dropped.
   - `~/wsj_club/.env.local` — must contain `SUPABASE_DB_URL` (from Vercel),
     `BLOB_READ_WRITE_TOKEN` (article-text upload) and `OPENAI_API_KEY`
     (pronunciation + glossary audio). The bot does **not** need `SUPABASE_URL`/
     `SUPABASE_SERVICE_KEY` (it talks to Postgres directly via `.bot/open-vote.mjs`
     and `.bot/tally.mjs`).

3. **Git push access** (the publish run pushes to `main` = deploys). A deploy key
   scoped to this one repo, with write access:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/wsj_club_deploy -N '' -C 'wsj_club autopilot'
   cat ~/.ssh/wsj_club_deploy.pub      # → GitHub → repo Settings → Deploy keys → Add, "Allow write access"
   printf 'Host github.com\n  IdentityFile ~/.ssh/wsj_club_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
   cd ~/wsj_club && git remote set-url origin git@github.com:cosmic-glitch/wsj_club.git
   git config user.name 'Reading Club autopilot' && git config user.email 'autopilot@dailyreadingclub.com'
   ssh -T git@github.com    # "Hi cosmic-glitch/wsj_club! You've successfully authenticated…"
   ```

4. **Regenerate the Economist session** (creates `econ-state.json`) — note the
   `xvfb-run`, without which the login cannot clear the bot challenge:
   ```bash
   xvfb-run -a node --env-file=.bot/.env .bot/refresh-session.mjs
   ```

5. **Smoke-test** the pieces:
   ```bash
   xvfb-run -a node --env-file=.bot/.env .bot/scout.mjs | head            # Economist candidates
   xvfb-run -a node --env-file=.bot/.env .bot/read.mjs <article-url>      # must be >400 words
   xvfb-run -a node --env-file=.bot/.env .bot/capture.mjs <article-url> 1999-01-01   # writes public/articles/1999-01-01.html + article-text/1999-01-01.txt — then delete both
   node --env-file=.env.local .bot/tally.mjs                              # newest senior poll, read-only
   node --env-file=.bot/.env .bot/notify.mjs "recovery test"              # should hit the owner's WhatsApp DM (don't smoke-test --to=group: that is the real club group)
   ```

6. **Re-arm the crons.** Both wrappers fire at two UTC hours and gate on the
   Pacific hour, so each runs exactly once a day year-round:
   ```
   0 13,14 * * *  $HOME/bin/hc-run wsjclub-auto-vote    bash $HOME/wsj_club/.bot/run-auto-vote.sh    >> $HOME/wsj_club/.bot/logs/cron.log 2>&1
   0 18,19 * * *  $HOME/bin/hc-run wsjclub-auto-publish bash $HOME/wsj_club/.bot/run-auto-publish.sh >> $HOME/wsj_club/.bot/logs/cron.log 2>&1
   ```
   `hc-run` (in `~/bin`, from the foliotracker setup) pings healthchecks.io with
   the wrapper's exit code — a non-zero exit is the alert. The checks are
   `wsjclub-auto-vote` and `wsjclub-auto-publish` (period 1 day); a missing
   check can be auto-created by pinging its slug once with `?create=1`. Start
   the publish cron with `touch ~/wsj_club/.bot/DRY_RUN` and remove the file
   once a dry-run day looks right.

## Controls (flag files in `.bot/`, box-local)
- `PAUSE` — the publish run skips the day (the vote still opens).
- `DRY_RUN` — the publish run does everything but ships to branch `auto/<date>`
  (force-pushed; Vercel builds a preview; `main` untouched) and texts a DRY RUN
  summary. Delete it to go live.

## Manual runs (test any date without waiting for the cron)
```bash
AUTOVOTE_FORCE=1   AUTOVOTE_DATE=YYYY-MM-DD   bash ~/wsj_club/.bot/run-auto-vote.sh
AUTOPUBLISH_FORCE=1 AUTOPUBLISH_DATE=YYYY-MM-DD AUTOPUBLISH_DRY_RUN=1 bash ~/wsj_club/.bot/run-auto-publish.sh
```
Logs: `.bot/logs/auto-vote-<date>.log`, `.bot/logs/auto-publish-<date>.log`.
A failed publish run leaves its half-made files in a `git stash` (`git stash
list`), and the tree back on a clean `main`.

## When reads come back empty
Article pages returning 0 words (title `economist.com` or `Just a moment...`)
is a **bot challenge, not a credentials problem** — don't touch `ECON_PASS`.
It means the browser ran headless or with a spoofed user-agent. Check that the
run is wrapped in `xvfb-run` and that `CONTEXT_OPTS` in `lib.mjs` still sets no
`userAgent`; the header comment there explains why both matter. `capture.mjs`
refuses to write a teaser (exit 2) for the same reason.

## What each file does
- `lib.mjs` — browser + session helpers; login check = "can I read a full article"
  (across several, so one challenged page can't fake a failure), auto-refresh via
  `.env`. Goes headed whenever `DISPLAY` is set.
- `scout.mjs` — sweep the Economist for candidate news articles.
- `read.mjs` — full article text + word count.
- `capture.mjs` — the day's article page + plain text, by running the shared
  `scripts/capture-article.js` snippet in the saved session.
- `refresh-session.mjs` — re-login and overwrite `econ-state.json`.
- `published.mjs` — the do-not-repeat set (every published reading, both tracks).
- `open-vote.mjs` — psql/`pg` upsert into `rc_polls` (box has no PostgREST keys).
- `tally.mjs` — read the poll + ballots, decide the winner (ties → the morning
  run's ratings in `state/<date>-field.json`; no ballots → its top pick).
- `commit-message.mjs` — the commit message for an auto-published day.
- `ship.sh` — stage the day's files, commit, rebase, push (or branch on dry
  run), wait for the live URL. The only thing that touches git.
- `notify.mjs` — drop a nanoclaw IPC message → WhatsApp: the owner's DM by
  default, `--to=group` for the club group (the daily announcement).
- `run-auto-vote.sh` / `run-auto-publish.sh` — the cron entrypoints (Pacific
  gate → `git pull` → `xvfb-run claude -p` → outcome check).
- `state/` — box-local hand-off between the two runs (`<date>-field.json`,
  `<date>-tally.json`); `logs/` — per-day logs.
