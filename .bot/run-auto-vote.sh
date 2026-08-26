#!/bin/bash
# Autonomous daily vote opener for the Reading Club. Cron fires this at BOTH
# 13:00 and 14:00 UTC; the Pacific-time gate below lets exactly one of them
# proceed, so it runs at 06:00 America/Los_Angeles year-round (Ubuntu cron
# ignores CRON_TZ, and DST shifts which UTC hour is 6am Pacific). The skill is
# itself idempotent, so a double-fire is harmless anyway.
#
# Crontab entry (UTC):
#   0 13,14 * * *  $HOME/wsj_club/.bot/run-auto-vote.sh
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"   # find `claude`, `node` under cron's minimal PATH

# --- Pacific 6am gate -------------------------------------------------------
# AUTOVOTE_FORCE=1 bypasses the gate (for a supervised manual test run).
if [ "${AUTOVOTE_FORCE:-}" != "1" ] && [ "$(TZ=America/Los_Angeles date +%H)" != "06" ]; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Make SUPABASE_DB_URL (and the Blob token) available to every bash call in the
# session, not just those that pass --env-file. Non-fatal if the file is absent.
set -a
# shellcheck source=/dev/null
[ -f "$PROJECT_DIR/.env.local" ] && source "$PROJECT_DIR/.env.local"
set +a

LOG_DIR="$PROJECT_DIR/.bot/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/auto-vote-$(TZ=America/Los_Angeles date +%F).log"

echo "[$(date -u +%FT%TZ)] auto-vote: starting (Pacific $(TZ=America/Los_Angeles date +%FT%T))" >> "$LOG_FILE"

# Self-sync the committed parts (skill + .bot/ code; secrets stay box-local) so
# edits pushed to main propagate without manual SSH. Non-fatal.
if git pull --ff-only origin main >> "$LOG_FILE" 2>&1; then
  echo "[$(date -u +%FT%TZ)] auto-vote: git pull OK at $(git rev-parse --short HEAD)" >> "$LOG_FILE"
else
  echo "[$(date -u +%FT%TZ)] auto-vote: git pull failed at $(git rev-parse --short HEAD); proceeding" >> "$LOG_FILE"
fi

# One agentic session runs the whole pick → open-vote → notify flow. Don't let
# set -e abort on a non-zero exit — the outcome check below is the verdict.
CLAUDE_RC=0
claude -p "Use the auto-vote skill to open today's Reading Club senior vote. Run fully autonomously end to end — never pause for confirmation — and follow the skill's idempotency guard and quality gates exactly." \
  --dangerously-skip-permissions \
  >> "$LOG_FILE" 2>&1 || CLAUDE_RC=$?

echo "[$(date -u +%FT%TZ)] auto-vote: claude session exited (rc=$CLAUDE_RC)" >> "$LOG_FILE"

# --- Outcome check (the alerting contract) ----------------------------------
# claude -p exits 0 even when the skill's failure path ran (the session can't
# set the CLI's exit code), so success is verified from the outcome itself:
# today's reading is published (vote closed / not needed), or today's poll is
# live. Anything else exits non-zero so hc-run pages the owner — the skill's
# failure path is deliberately silent (no WhatsApp), making this the only alarm.
TODAY="${AUTOVOTE_DATE:-$(TZ=America/Los_Angeles date +%F)}"
VOTE_JSON="$(curl -fsS -m 15 https://dailyreadingclub.com/api/vote || true)"
if [ -f "$PROJECT_DIR/content/${TODAY}.json" ]; then
  echo "[$(date -u +%FT%TZ)] auto-vote: outcome OK — reading ${TODAY} already published" >> "$LOG_FILE"
elif echo "$VOTE_JSON" | grep -q '"active":true' && echo "$VOTE_JSON" | grep -q "\"date\":\"${TODAY}\""; then
  echo "[$(date -u +%FT%TZ)] auto-vote: outcome OK — vote for ${TODAY} is live" >> "$LOG_FILE"
else
  echo "[$(date -u +%FT%TZ)] auto-vote: OUTCOME FAILURE — no reading and no live vote for ${TODAY}; exiting 1 for healthchecks" >> "$LOG_FILE"
  exit 1
fi
