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

# Self-sync the committed parts (skill + scripts) so edits pushed to main
# propagate without manual SSH. Non-fatal. (.bot/ is gitignored and box-local.)
if git pull --ff-only origin main >> "$LOG_FILE" 2>&1; then
  echo "[$(date -u +%FT%TZ)] auto-vote: git pull OK at $(git rev-parse --short HEAD)" >> "$LOG_FILE"
else
  echo "[$(date -u +%FT%TZ)] auto-vote: git pull failed at $(git rev-parse --short HEAD); proceeding" >> "$LOG_FILE"
fi

# One agentic session runs the whole pick → open-vote → notify flow.
claude -p "Use the auto-vote skill to open today's Reading Club senior vote. Run fully autonomously end to end — never pause for confirmation — and follow the skill's idempotency guard and quality gates exactly." \
  --dangerously-skip-permissions \
  >> "$LOG_FILE" 2>&1

echo "[$(date -u +%FT%TZ)] auto-vote: claude session exited" >> "$LOG_FILE"
