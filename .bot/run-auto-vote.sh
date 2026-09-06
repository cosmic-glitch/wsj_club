#!/bin/bash
# Autonomous daily vote opener for the Reading Club — one wrapper, two tracks.
#   bash .bot/run-auto-vote.sh                 # senior (default): the auto-vote skill
#   bash .bot/run-auto-vote.sh --track=junior  # junior: the auto-vote-junior skill
#
# Cron fires each track at BOTH 13:xx and 14:xx UTC; the Pacific-time gate below
# lets exactly one proceed, so it runs at 06:xx America/Los_Angeles year-round
# (Ubuntu cron ignores CRON_TZ, and DST shifts which UTC hour is 6am Pacific).
# The skills are idempotent, so a double-fire is harmless anyway.
#
# The tracks never run concurrently: both wrappers (and both publish wrappers)
# take the one autopilot lock, and the junior cron fires 10 minutes after the
# senior one and WAITS for the lock — so senior always goes first and the box
# (2 CPUs, ~4 GB) only ever hosts one headed browser + one claude session.
#
# Crontab entries (UTC):
#   0  13,14 * * *  $HOME/wsj_club/.bot/run-auto-vote.sh
#   10 13,14 * * *  $HOME/wsj_club/.bot/run-auto-vote.sh --track=junior
#
# Controls (flag files in .bot/, box-local, never committed):
#   .bot/OFF-<track>  → that track's autopilot is switched off: this run AND the
#                       publish run exit 0 without doing anything (the junior
#                       kill switch; delete the file to re-arm)
# Env overrides for a supervised manual run:
#   AUTOVOTE_FORCE=1  bypass the 6am gate
#   AUTOVOTE_DATE=…   open the vote for a specific date (default: today Pacific)
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"   # find `claude`, `node` under cron's minimal PATH

TRACK="senior"
for a in "$@"; do
  case "$a" in
    --track=senior|--track=junior) TRACK="${a#--track=}" ;;
    *) echo "usage: $0 [--track=senior|junior]" >&2; exit 2 ;;
  esac
done

# --- Pacific 6am gate -------------------------------------------------------
if [ "${AUTOVOTE_FORCE:-}" != "1" ] && [ "$(TZ=America/Los_Angeles date +%H)" != "06" ]; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Per-track knobs: where the reading lands, which skill runs, which poll to check.
if [ "$TRACK" = "junior" ]; then
  NAME="auto-vote-junior"
  CONTENT_DIR="content/junior"
  VOTE_API="https://dailyreadingclub.com/api/vote?track=junior"
else
  NAME="auto-vote"
  CONTENT_DIR="content"
  VOTE_API="https://dailyreadingclub.com/api/vote"
fi
export AUTOVOTE_TRACK="$TRACK"

# Make SUPABASE_DB_URL (and the Blob token) available to every bash call in the
# session, not just those that pass --env-file. Non-fatal if the file is absent.
set -a
# shellcheck source=/dev/null
[ -f "$PROJECT_DIR/.env.local" ] && source "$PROJECT_DIR/.env.local"
set +a

LOG_DIR="$PROJECT_DIR/.bot/logs"
mkdir -p "$LOG_DIR" "$PROJECT_DIR/.bot/state"
TODAY="${AUTOVOTE_DATE:-$(TZ=America/Los_Angeles date +%F)}"
LOG_FILE="$LOG_DIR/${NAME}-${TODAY}.log"
log() { echo "[$(date -u +%FT%TZ)] ${NAME}: $*" >> "$LOG_FILE"; }

if [ -f "$PROJECT_DIR/.bot/OFF-${TRACK}" ]; then
  log "OFF (.bot/OFF-${TRACK} exists) — the ${TRACK} autopilot is switched off; skipping ${TODAY}"
  exit 0
fi

log "starting (Pacific $(TZ=America/Los_Angeles date +%FT%T), track=${TRACK}, date=${TODAY})"

# One autopilot run at a time on this box (see the header). Waits for a run in
# progress rather than skipping — that is how the junior run queues behind the
# senior one. A 90-minute wait means something is badly stuck: exit 1 → page.
exec 9>"$LOG_DIR/.autopilot.lock"
if ! flock -w 5400 9; then
  log "could not get the autopilot lock within 90 minutes; exiting 1 for healthchecks"
  exit 1
fi

# Self-sync the committed parts (skill + .bot/ code; secrets stay box-local) so
# edits pushed to main propagate without manual SSH. Non-fatal.
if git pull --ff-only origin main >> "$LOG_FILE" 2>&1; then
  log "git pull OK at $(git rev-parse --short HEAD)"
else
  log "git pull failed at $(git rev-parse --short HEAD); proceeding"
fi

# The Economist's bot challenge is only solved by a HEADED browser (see the
# header comment in .bot/lib.mjs), and cron has no display — so the whole
# session runs under a virtual one. Every child process inherits DISPLAY, which
# is what flips `launch()` in lib.mjs out of headless. Without xvfb the run
# still proceeds, just headless, and article reads will fail the same way.
XVFB=()
if command -v xvfb-run >/dev/null 2>&1; then
  XVFB=(xvfb-run -a --server-args="-screen 0 1440x900x24")
else
  log "WARNING xvfb-run not found; running headless, article reads will likely be bot-blocked"
fi

# One agentic session runs the whole pick → open-vote → notify flow. Don't let
# set -e abort on a non-zero exit — the outcome check below is the verdict.
CLAUDE_RC=0
"${XVFB[@]}" claude -p "Use the ${NAME} skill to open today's Reading Club ${TRACK} vote (date ${TODAY}). Run fully autonomously end to end — never pause for confirmation — and follow the skill's idempotency guard and quality gates exactly." \
  --dangerously-skip-permissions \
  >> "$LOG_FILE" 2>&1 || CLAUDE_RC=$?

log "claude session exited (rc=$CLAUDE_RC)"

# --- Outcome check (the alerting contract) ----------------------------------
# claude -p exits 0 even when the skill's failure path ran (the session can't
# set the CLI's exit code), so success is verified from the outcome itself:
# today's reading is published (vote closed / not needed), or today's poll is
# live. Anything else exits non-zero so hc-run pages the owner — the skill's
# failure path is deliberately silent (no WhatsApp), making this the only alarm.
VOTE_JSON="$(curl -fsS -m 15 "$VOTE_API" || true)"
if [ -f "$PROJECT_DIR/${CONTENT_DIR}/${TODAY}.json" ]; then
  log "outcome OK — ${TRACK} reading ${TODAY} already published"
elif echo "$VOTE_JSON" | grep -q '"active":true' && echo "$VOTE_JSON" | grep -q "\"date\":\"${TODAY}\""; then
  log "outcome OK — ${TRACK} vote for ${TODAY} is live"
else
  log "OUTCOME FAILURE — no ${TRACK} reading and no live ${TRACK} vote for ${TODAY}; exiting 1 for healthchecks"
  exit 1
fi
