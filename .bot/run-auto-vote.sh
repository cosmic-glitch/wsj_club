#!/bin/bash
# Autonomous daily vote opener for the Reading Club — the cron entry. ONE
# claude session (the auto-vote skill) scouts The Economist once, rates every
# candidate for both tracks, splits them into two disjoint ballots and opens
# both votes; this wrapper then checks each track's outcome.
#   bash .bot/run-auto-vote.sh
#
# Cron fires at BOTH 13:xx and 14:xx UTC; the Pacific-time gate below lets
# exactly one proceed, so it runs at 06:xx America/Los_Angeles year-round
# (Ubuntu cron ignores CRON_TZ, and DST shifts which UTC hour is 6am Pacific).
# The skill is idempotent per track, so a double-fire is harmless anyway.
#
# Crontab entry (UTC):
#   0 13,14 * * *  $HOME/bin/hc-run wsjclub-auto-vote bash $HOME/wsj_club/.bot/run-auto-vote.sh >> $HOME/wsj_club/.bot/logs/cron.log 2>&1
#
# The run takes the one autopilot lock and WAITS for it, so the box (2 CPUs,
# ~4 GB) only ever hosts one headed browser + one claude session, and a manual
# run queues behind a cron run instead of colliding with it.
#
# Controls (flag files in .bot/, box-local, never committed):
#   .bot/OFF-<track>  → that track's autopilot is switched off: the skill leaves
#                       its poll alone (the other track still runs); both off →
#                       exit 0 without a session
# Env overrides for a supervised manual run:
#   AUTOVOTE_FORCE=1  bypass the 6am gate (a direct call with it opens the
#                     votes NOW)
#   AUTOVOTE_DATE=…   open the votes for a specific date (default: today Pacific)
#   AUTOVOTE_TRACKS=… limit the run to "senior" or "junior" (default: every
#                     track without an OFF flag) — for re-opening one poll
#   AUTOPILOT_MODEL=… run the session on another model (default claude-opus-5[1m])
set -uo pipefail

export PATH="$HOME/.local/bin:$PATH"   # find `claude`, `node` under cron's minimal PATH

# Which model the agentic session runs on. Pinned here rather than left to the
# box's ~/.claude/settings.json default: a per-model usage limit on that
# ambient default silently kills every run of the day (the session exits
# immediately with "You've reached your … limit"). Override for one run with
# AUTOPILOT_MODEL=… to fall back to another model when this one is capped.
AUTOPILOT_MODEL="${AUTOPILOT_MODEL:-claude-opus-5[1m]}"

if [ $# -ne 0 ]; then
  echo "usage: $0   (no arguments; AUTOVOTE_TRACKS=senior|junior limits it to one track)" >&2
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
mkdir -p "$LOG_DIR" "$PROJECT_DIR/.bot/state"
LOG_FILE="$LOG_DIR/auto-vote-${TODAY}.log"
log() { echo "[$(date -u +%FT%TZ)] auto-vote: $*" >> "$LOG_FILE"; }

# Which tracks this run opens: the requested set minus the OFF flags.
TRACKS=()
for T in ${AUTOVOTE_TRACKS:-senior junior}; do
  case "$T" in
    senior|junior) ;;
    *) echo "AUTOVOTE_TRACKS: unknown track \"$T\" (senior|junior)" >&2; exit 2 ;;
  esac
  if [ -f "$PROJECT_DIR/.bot/OFF-${T}" ]; then
    log "OFF (.bot/OFF-${T} exists) — the ${T} autopilot is switched off; not opening its vote"
  else
    TRACKS+=("$T")
  fi
done
if [ ${#TRACKS[@]} -eq 0 ]; then
  log "every track is off; nothing to do for ${TODAY}"
  echo "run-auto-vote ${TODAY}: all tracks off"
  exit 0
fi
export AUTOVOTE_TRACKS="${TRACKS[*]}"

# Make SUPABASE_DB_URL (and the Blob token) available to every bash call in the
# session, not just those that pass --env-file. Non-fatal if the file is absent.
set -a
# shellcheck source=/dev/null
[ -f "$PROJECT_DIR/.env.local" ] && source "$PROJECT_DIR/.env.local"
set +a

log "starting (Pacific $(TZ=America/Los_Angeles date +%FT%T), date=${TODAY}, tracks=${AUTOVOTE_TRACKS})"

# One autopilot run at a time on this box (see the header). Waits for a run in
# progress rather than skipping, so a manual run queues behind a cron run.
# A 90-minute wait means something is badly stuck: exit 1 → page.
exec 9>"$LOG_DIR/.autopilot.lock"
if ! flock -w 5400 9; then
  log "could not get the autopilot lock within 90 minutes; exiting 1 for healthchecks"
  echo "run-auto-vote ${TODAY}: lock timeout"
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

# One agentic session runs the whole scout → rate → split → open both votes →
# notify flow. Its exit code is not the verdict — the outcome check below is.
CLAUDE_RC=0
"${XVFB[@]}" claude -p "Use the auto-vote skill to open today's Reading Club votes (date ${TODAY}; tracks: ${AUTOVOTE_TRACKS}). Run fully autonomously end to end — never pause for confirmation — and follow the skill's idempotency guards and quality gates exactly." \
  --model "$AUTOPILOT_MODEL" \
  --dangerously-skip-permissions \
  >> "$LOG_FILE" 2>&1 || CLAUDE_RC=$?

log "claude session exited (rc=$CLAUDE_RC)"

# --- Outcome check (the alerting contract) ----------------------------------
# claude -p exits 0 even when the skill's failure path ran (the session can't
# set the CLI's exit code), so success is verified per track from the outcome
# itself: the track's reading is published (vote closed / not needed), or its
# poll is live. Anything else exits non-zero so hc-run pages the owner — the
# skill's failure path is deliberately silent (no WhatsApp), making this the
# only alarm. One `senior rc=… junior rc=…` line goes to stdout → cron.log and
# the healthcheck ping body, so a page names the track.
RESULT=()
RC_ALL=0
for T in "${TRACKS[@]}"; do
  if [ "$T" = "junior" ]; then
    CONTENT_DIR="content/junior"
    VOTE_API="https://dailyreadingclub.com/api/vote?track=junior"
  else
    CONTENT_DIR="content"
    VOTE_API="https://dailyreadingclub.com/api/vote"
  fi
  rc=0
  VOTE_JSON="$(curl -fsS -m 15 "$VOTE_API" || true)"
  if [ -f "$PROJECT_DIR/${CONTENT_DIR}/${TODAY}.json" ]; then
    log "outcome OK — ${T} reading ${TODAY} already published"
  elif echo "$VOTE_JSON" | grep -q '"active":true' && echo "$VOTE_JSON" | grep -q "\"date\":\"${TODAY}\""; then
    log "outcome OK — ${T} vote for ${TODAY} is live"
  else
    log "OUTCOME FAILURE — no ${T} reading and no live ${T} vote for ${TODAY}"
    rc=1
    RC_ALL=1
  fi
  RESULT+=("${T} rc=${rc}")
done
log "done — ${RESULT[*]} (exit ${RC_ALL})"
echo "run-auto-vote ${TODAY}: ${RESULT[*]}"
exit $RC_ALL
