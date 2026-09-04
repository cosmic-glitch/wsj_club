#!/bin/bash
# Autonomous daily PUBLISH for the Reading Club — the afternoon cousin of
# run-auto-vote.sh. Cron fires this at BOTH 18:00 and 19:00 UTC; the Pacific
# gate lets exactly one proceed, so it runs at 11:00 America/Los_Angeles
# year-round. Publishing the reading is what closes the vote — this IS the
# close, so 11am Pacific is the club's fixed voting deadline.
#
# Crontab entry (UTC):
#   0 18,19 * * *  bash $HOME/wsj_club/.bot/run-auto-publish.sh >> $HOME/wsj_club/.bot/logs/cron.log 2>&1
#
# Controls (flag files in .bot/, box-local, never committed):
#   .bot/PAUSE    → skip today's run entirely (log a line, exit 0)
#   .bot/DRY_RUN  → do everything but ship to branch auto/<date> instead of
#                   main — the rollout mode; delete the file to go live
# Env overrides for a supervised manual run:
#   AUTOPUBLISH_FORCE=1      bypass the 11am gate
#   AUTOPUBLISH_DATE=…       publish a specific poll date (default: today Pacific)
#   AUTOPUBLISH_DRY_RUN=1    same as the DRY_RUN flag file
set -uo pipefail

export PATH="$HOME/.local/bin:$PATH"   # `claude`, `node` under cron's minimal PATH

if [ "${AUTOPUBLISH_FORCE:-}" != "1" ] && [ "$(TZ=America/Los_Angeles date +%H)" != "11" ]; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR" || exit 1

LOG_DIR="$PROJECT_DIR/.bot/logs"
mkdir -p "$LOG_DIR" "$PROJECT_DIR/.bot/state"
TODAY="${AUTOPUBLISH_DATE:-$(TZ=America/Los_Angeles date +%F)}"
LOG_FILE="$LOG_DIR/auto-publish-${TODAY}.log"
log() { echo "[$(date -u +%FT%TZ)] auto-publish: $*" >> "$LOG_FILE"; }

# One run at a time (a manual test must not overlap the cron's run).
exec 9>"$LOG_DIR/.auto-publish.lock"
if ! flock -n 9; then
  log "another run holds the lock; exiting"
  exit 0
fi

if [ -f "$PROJECT_DIR/.bot/PAUSE" ]; then
  log "PAUSED (.bot/PAUSE exists) — skipping ${TODAY}"
  exit 0
fi
MODE="live"
if [ -f "$PROJECT_DIR/.bot/DRY_RUN" ] || [ "${AUTOPUBLISH_DRY_RUN:-}" = "1" ]; then
  MODE="dry-run"
  export AUTOPUBLISH_DRY_RUN=1
fi
export AUTOPUBLISH_DATE="$TODAY"

log "starting (Pacific $(TZ=America/Los_Angeles date +%FT%T), mode=${MODE}, date=${TODAY})"

# Secrets for every command in the session: SUPABASE_DB_URL, BLOB_READ_WRITE_TOKEN,
# OPENAI_API_KEY from .env.local; ECON_* + NANOCLAW_CHATJID from .bot/.env.
set -a
# shellcheck source=/dev/null
[ -f "$PROJECT_DIR/.env.local" ] && source "$PROJECT_DIR/.env.local"
# shellcheck source=/dev/null
[ -f "$PROJECT_DIR/.bot/.env" ] && source "$PROJECT_DIR/.bot/.env"
set +a

# A clean tree on main is the precondition — this box is a runtime, not a
# workspace. Leftovers (a crashed earlier run) go to a stash, recoverable with
# `git stash list`, never deleted.
if [ -n "$(git status --porcelain | grep -v '^?? article-text/')" ]; then
  log "working tree is dirty — stashing leftovers before starting:"
  git status --porcelain >> "$LOG_FILE"
  git stash push -u -q -m "auto-publish leftovers before ${TODAY}" >> "$LOG_FILE" 2>&1
fi
git checkout -q main 2>> "$LOG_FILE"
if git pull --ff-only origin main >> "$LOG_FILE" 2>&1; then
  log "git pull OK at $(git rev-parse --short HEAD)"
else
  log "git pull failed at $(git rev-parse --short HEAD); proceeding"
fi

if [ -f "$PROJECT_DIR/content/${TODAY}.json" ]; then
  log "outcome OK — reading ${TODAY} already published (by hand); nothing to do"
  exit 0
fi

# Headed browser under a virtual display — the Economist's bot challenge is
# only solved headed (see lib.mjs); the capture runs inside this session.
XVFB=()
if command -v xvfb-run >/dev/null 2>&1; then
  XVFB=(xvfb-run -a --server-args="-screen 0 1440x900x24")
else
  log "WARNING xvfb-run not found; running headless, the capture will likely be bot-blocked"
fi

# One agentic session runs tally → capture → author → ship → notify. Same
# invocation shape as run-auto-vote.sh (unattended, so no permission prompts).
CLAUDE_RC=0
"${XVFB[@]}" claude -p "Use the auto-publish skill to publish today's Reading Club senior reading (date ${TODAY}, mode ${MODE}). Run fully autonomously end to end — never pause for confirmation — and follow the skill's guards, quality gates, and failure handling exactly." \
  --dangerously-skip-permissions \
  >> "$LOG_FILE" 2>&1 || CLAUDE_RC=$?
log "claude session exited (rc=$CLAUDE_RC)"

# --- Outcome check (the alerting contract) ----------------------------------
# claude -p exits 0 even when the skill's failure path ran, so success is
# verified from the outcome: LIVE = the day is on origin/main AND the site
# serves it; DRY RUN = origin has auto/<date>. Anything else exits 1 so the
# cron's healthcheck pages the owner (the skill's failure path is silent).
git fetch -q origin >> "$LOG_FILE" 2>&1
if [ "$MODE" = "dry-run" ]; then
  if git rev-parse -q --verify "origin/auto/${TODAY}" >/dev/null; then
    log "outcome OK — dry run landed on origin/auto/${TODAY}"
    RC=0
  else
    log "OUTCOME FAILURE — no origin/auto/${TODAY} branch after the dry run"
    RC=1
  fi
else
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 20 "https://dailyreadingclub.com/reading/${TODAY}" || echo 000)"
  if git cat-file -e "origin/main:content/${TODAY}.json" 2>/dev/null && [ "$CODE" = "200" ]; then
    log "outcome OK — reading ${TODAY} is on main and live"
    RC=0
  elif git cat-file -e "origin/main:content/${TODAY}.json" 2>/dev/null; then
    log "OUTCOME PARTIAL — ${TODAY} is on origin/main but the site returns HTTP ${CODE}; check the Vercel deploy"
    RC=1
  else
    log "OUTCOME FAILURE — ${TODAY} is not on origin/main (site HTTP ${CODE})"
    RC=1
  fi
fi

# Leave the tree clean on main for tomorrow. A failed run's half-made files go
# to a stash (never deleted); local main is then realigned with origin.
git checkout -q main 2>> "$LOG_FILE"
if [ -n "$(git status --porcelain | grep -v '^?? article-text/')" ]; then
  log "stashing the run's leftover files (git stash list to inspect)"
  git stash push -u -q -m "auto-publish ${TODAY} leftovers (rc=${RC})" >> "$LOG_FILE" 2>&1
fi
git reset -q --hard origin/main >> "$LOG_FILE" 2>&1
exit $RC
