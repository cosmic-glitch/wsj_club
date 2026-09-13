#!/bin/bash
# Autonomous daily vote opener for the Reading Club — the cron entry, one run
# for BOTH tracks: senior then junior, one after the other, each via
# vote-track.sh (the auto-vote / auto-vote-junior skill).
#   bash .bot/run-auto-vote.sh
#
# Cron fires at BOTH 13:xx and 14:xx UTC; the Pacific-time gate below lets
# exactly one proceed, so it runs at 06:xx America/Los_Angeles year-round
# (Ubuntu cron ignores CRON_TZ, and DST shifts which UTC hour is 6am Pacific).
# The skills are idempotent, so a double-fire is harmless anyway.
#
# Crontab entry (UTC):
#   0 13,14 * * *  $HOME/bin/hc-run wsjclub-auto-vote bash $HOME/wsj_club/.bot/run-auto-vote.sh >> $HOME/wsj_club/.bot/logs/cron.log 2>&1
#
# Controls (flag files in .bot/, box-local, never committed):
#   .bot/OFF-<track>  → that track's autopilot is switched off: its vote AND
#                       publish runs exit 0 without doing anything
# Env overrides for a supervised manual run:
#   AUTOVOTE_FORCE=1  bypass the 6am gate
#   AUTOVOTE_DATE=…   open the votes for a specific date (default: today Pacific)
#   AUTOPILOT_MODEL=… run the sessions on another model (default claude-opus-5[1m])
set -uo pipefail

export PATH="$HOME/.local/bin:$PATH"

if [ $# -ne 0 ]; then
  echo "usage: $0   (no arguments — for one track, run vote-track.sh --track=senior|junior)" >&2
  exit 2
fi

if [ "${AUTOVOTE_FORCE:-}" != "1" ] && [ "$(TZ=America/Los_Angeles date +%H)" != "06" ]; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR" || exit 1

TODAY="${AUTOVOTE_DATE:-$(TZ=America/Los_Angeles date +%F)}"
LOG_DIR="$PROJECT_DIR/.bot/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/run-auto-vote-${TODAY}.log"
log() { echo "[$(date -u +%FT%TZ)] run-auto-vote: $*" >> "$LOG_FILE"; }

# One day-run at a time (the 13:xx/14:xx double-fire, or a manual run during
# the cron's): the children queue on the autopilot lock, so don't pile up.
exec 8>"$LOG_DIR/.vote-day.lock"
if ! flock -n 8; then
  log "a vote run is already in progress; nothing to do"
  exit 0
fi

log "starting (Pacific $(TZ=America/Los_Angeles date +%FT%T), date=${TODAY})"

# Each child takes the autopilot lock, runs its skill and verifies its outcome
# (vote live, or the reading already published); its exit code is its verdict.
# A failed senior run never skips junior.
RESULT=()
RC_ALL=0
for T in senior junior; do
  log "running vote-track.sh --track=${T}"
  rc=0
  bash "$SCRIPT_DIR/vote-track.sh" "--track=${T}" || rc=$?
  RESULT+=("${T} rc=${rc}")
  [ "$rc" -ne 0 ] && RC_ALL=1
done
log "done — ${RESULT[*]} (exit ${RC_ALL})"
# One line to stdout → cron.log and the healthcheck ping body.
echo "run-auto-vote ${TODAY}: ${RESULT[*]}"
exit $RC_ALL
