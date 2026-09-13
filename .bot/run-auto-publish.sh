#!/bin/bash
# Autonomous daily PUBLISH for the Reading Club — the cron entry, one run for
# BOTH tracks. From 9am Pacific it checks, once an hour, whether every track's
# vote has at least one ballot; the first hour that holds it publishes the day
# — senior then junior, each via publish-track.sh — and at noon it publishes
# regardless (a track with no ballots gets the morning's top-rated pick,
# tally.mjs's own fallback). Every hold texts the owner.
#   bash .bot/run-auto-publish.sh
#
# Cron fires at 16:00–20:00 UTC; the Pacific gate lets the 09–12 firings
# through year-round (DST shifts which UTC hours those are). So the club's
# vote deadline on both tracks is 9am Pacific once everyone has voted, and
# noon at the latest. Publishing the reading is what closes the vote.
#
# The hold is JOINT: if either track still has no ballot, neither publishes
# (the club votes on both at once, and the group hears about the day as one).
# Not waited on: a track already published (by hand), paused, or switched off;
# and a track with no poll at all (the vote run failed) — nothing can change
# by waiting, its publish run then fails at the tally and the healthcheck pages.
#
# Crontab entry (UTC):
#   0 16,17,18,19,20 * * *  $HOME/bin/hc-run wsjclub-auto-publish bash $HOME/wsj_club/.bot/run-auto-publish.sh >> $HOME/wsj_club/.bot/logs/cron.log 2>&1
#
# Controls (flag files in .bot/, box-local, never committed):
#   .bot/PAUSE            → skip today's publish run on every track (the vote still opens)
#   .bot/PAUSE-<track>    → the same for one track only
#   .bot/DRY_RUN          → do everything but ship to branch auto/[junior/]<date>
#                           instead of main — the rollout mode; delete the file to go live
#   .bot/DRY_RUN-<track>  → the same for one track only (roll a track out alone)
#   .bot/OFF-<track>      → that track's autopilot is switched off entirely (vote + publish)
# Env overrides for a supervised manual run:
#   AUTOPUBLISH_FORCE=1      publish NOW: bypass the hour gate AND the vote hold
#   AUTOPUBLISH_HOUR=09      pretend it is this Pacific hour (exercise the gate and the hold)
#   AUTOPUBLISH_DATE=…       publish a specific poll date (default: today Pacific)
#   AUTOPILOT_MODEL=…        run the sessions on another model (default claude-opus-5[1m])
#   AUTOPUBLISH_DRY_RUN=1    same as the DRY_RUN flag file
set -uo pipefail

export PATH="$HOME/.local/bin:$PATH"   # `node` under cron's minimal PATH

if [ $# -ne 0 ]; then
  echo "usage: $0   (no arguments — for one track, run publish-track.sh --track=senior|junior)" >&2
  exit 2
fi

FORCE="${AUTOPUBLISH_FORCE:-0}"
HOUR="${AUTOPUBLISH_HOUR:-$(TZ=America/Los_Angeles date +%H)}"
if [ "$FORCE" != "1" ]; then
  case "$HOUR" in
    09|10|11|12) ;;
    *) exit 0 ;;
  esac
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR" || exit 1

TODAY="${AUTOPUBLISH_DATE:-$(TZ=America/Los_Angeles date +%F)}"
LOG_DIR="$PROJECT_DIR/.bot/logs"
mkdir -p "$LOG_DIR" "$PROJECT_DIR/.bot/state"
LOG_FILE="$LOG_DIR/run-auto-publish-${TODAY}.log"
log() { echo "[$(date -u +%FT%TZ)] run-auto-publish: $*" >> "$LOG_FILE"; }
notify() { # notify <text> — the owner's DM only; the group lines are the children's
  if printf '%s' "$1" | node .bot/notify.mjs --to=owner --stdin >> "$LOG_FILE" 2>&1; then
    log "notified owner: $1"
  else
    log "WARNING notify.mjs failed (see above); the message was: $1"
  fi
}

# SUPABASE_DB_URL for the ballot check, NANOCLAW_* for the DM. The children
# source both files again for their own sessions.
set -a
# shellcheck source=/dev/null
[ -f "$PROJECT_DIR/.env.local" ] && source "$PROJECT_DIR/.env.local"
# shellcheck source=/dev/null
[ -f "$PROJECT_DIR/.bot/.env" ] && source "$PROJECT_DIR/.bot/.env"
set +a

# One day-run at a time: the hourly firings must not pile up behind a run
# still authoring (the children take the shared autopilot lock and would just
# queue). Non-blocking — a firing that finds a run in progress is done.
exec 8>"$LOG_DIR/.publish-day.lock"
if ! flock -n 8; then
  log "a publish run is already in progress (Pacific hour ${HOUR}); nothing to do"
  exit 0
fi

log "starting (Pacific $(TZ=America/Los_Angeles date +%FT%T), hour=${HOUR}, date=${TODAY}, force=${FORCE})"

# --- The vote hold ----------------------------------------------------------
# Per track: off / paused / published / no poll / N ballot(s). "published" is
# read off origin/main (a fetch, not a pull — the children own the tree).
git fetch -q origin >> "$LOG_FILE" 2>&1 || log "WARNING git fetch failed; reading 'published' from the local tree"
SENIOR_POLL=0; SENIOR_BALLOTS=0; JUNIOR_POLL=0; JUNIOR_BALLOTS=0
CHECK_OK=1
if BALLOT_LINE="$(node .bot/ballots.mjs "$TODAY" 2>> "$LOG_FILE")" && [ -n "$BALLOT_LINE" ]; then
  eval "$BALLOT_LINE"   # numbers only, by construction (see ballots.mjs)
  log "ballots: ${BALLOT_LINE}"
else
  CHECK_OK=0
  log "WARNING the ballot check failed (see above)"
fi

WAITING=()
STATUS=()
for T in senior junior; do
  if [ "$T" = "junior" ]; then
    CONTENT="content/junior/${TODAY}.json"; POLL="$JUNIOR_POLL"; BALLOTS="$JUNIOR_BALLOTS"
  else
    CONTENT="content/${TODAY}.json"; POLL="$SENIOR_POLL"; BALLOTS="$SENIOR_BALLOTS"
  fi
  if [ -f "$PROJECT_DIR/.bot/OFF-${T}" ]; then
    S="off"
  elif [ -f "$PROJECT_DIR/.bot/PAUSE" ] || [ -f "$PROJECT_DIR/.bot/PAUSE-${T}" ]; then
    S="paused"
  elif git cat-file -e "origin/main:${CONTENT}" 2>/dev/null || [ -f "$PROJECT_DIR/$CONTENT" ]; then
    S="published"
  elif [ "$CHECK_OK" != "1" ]; then
    S="unknown"
  elif [ "$POLL" != "1" ]; then
    S="no poll"
  elif [ "$BALLOTS" = "0" ]; then
    S="0 ballots"; WAITING+=("$T")
  elif [ "$BALLOTS" = "1" ]; then
    S="1 ballot"
  else
    S="${BALLOTS} ballots"
  fi
  STATUS+=("${T}: ${S}")
done
SUMMARY="${STATUS[0]}, ${STATUS[1]}"
log "tracks — ${SUMMARY}"

case "$HOUR" in 09) NEXT="10:00am" ;; 10) NEXT="11:00am" ;; *) NEXT="12:00pm" ;; esac
BEFORE_NOON=0; [ "$((10#$HOUR))" -lt 12 ] && BEFORE_NOON=1

if [ "$FORCE" = "1" ]; then
  log "FORCE — publishing now regardless of the ballots"
elif [ "$CHECK_OK" != "1" ] && [ "$BEFORE_NOON" = "1" ]; then
  # Can't tell whether the votes are in: don't publish on a guess, retry next
  # hour, and page (a broken DB check is a real failure).
  notify "⚠️ Reading Club ${TODAY} — the ballot check failed (${SUMMARY}); not publishing this hour, retrying at ${NEXT} Pacific. See .bot/logs/run-auto-publish-${TODAY}.log on the box."
  exit 1
elif [ "$CHECK_OK" != "1" ]; then
  notify "⚠️ Reading Club ${TODAY} — the ballot check failed at noon (${SUMMARY}); publishing anyway, the tally decides."
elif [ ${#WAITING[@]} -gt 0 ] && [ "$BEFORE_NOON" = "1" ]; then
  notify "⏳ Reading Club ${TODAY} — votes not in yet (${SUMMARY}). Holding the publish; next check at ${NEXT} Pacific."
  log "HOLD — waiting for ${WAITING[*]}; exiting 0"
  exit 0
elif [ ${#WAITING[@]} -gt 0 ]; then
  notify "⏳ Reading Club ${TODAY} — still no votes at noon (${SUMMARY}). Publishing anyway; a track with no ballots gets the morning's top-rated pick."
fi

# --- Publish: senior, then junior ------------------------------------------
# Each child takes the autopilot lock, runs its skill, verifies its outcome and
# sends its own messages; its exit code is its verdict (0 = the day is live,
# already published, paused, or off). A failed senior run never skips junior.
RESULT=()
RC_ALL=0
for T in senior junior; do
  log "running publish-track.sh --track=${T}"
  rc=0
  bash "$SCRIPT_DIR/publish-track.sh" "--track=${T}" || rc=$?
  RESULT+=("${T} rc=${rc}")
  [ "$rc" -ne 0 ] && RC_ALL=1
done
log "done — ${RESULT[*]} (exit ${RC_ALL})"
# One line to stdout → cron.log and the healthcheck ping body, so a page says
# which track failed without opening the logs.
echo "run-auto-publish ${TODAY}: ${RESULT[*]}"
exit $RC_ALL
