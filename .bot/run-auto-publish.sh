#!/bin/bash
# Autonomous daily PUBLISH for the Reading Club — the cron entry, one run for
# ALL THREE tracks (senior = High School, junior = Middle School, kids =
# Elementary). From 9am Pacific it checks, every half hour, whether every
# track's vote has at least one ballot; the first check that finds it publishes
# the day — senior, junior, then kids, each via publish-track.sh — and at noon
# it publishes regardless (a track with no ballots gets the morning's top-rated
# pick, tally.mjs's own fallback). Every hold texts the owner.
#
# Then ONE message to the club's WhatsApp group, sent only once every track
# that should publish today is live AND was pushed by the autopilot (see the
# announcement block at the end); anything less goes to the owner's DM as a
# ready-to-forward text instead. The owner controls what reaches the club.
#   bash .bot/run-auto-publish.sh
#
# Cron fires on the hour and half hour, 16:00–20:30 UTC; the Pacific gate lets
# the 09:00–12:00 firings through year-round (DST shifts which UTC hours those
# are; 12:30 is outside, so a failed noon run isn't retried). So the club's
# vote deadline on both tracks is 9am Pacific once everyone has voted, and
# noon at the latest. Publishing the reading is what closes the vote.
#
# The hold is JOINT: if any track still has no ballot, none publishes (the
# owner votes on every track every day, and the group hears about the day as
# one message).
# Not waited on: a track already published (by hand), paused, or switched off;
# and a track with no poll at all (the vote run failed) — nothing can change
# by waiting, its publish run then fails at the tally and the healthcheck pages.
#
# Crontab entry (UTC):
#   0,30 16-20 * * *  $HOME/bin/hc-run wsjclub-auto-publish bash $HOME/wsj_club/.bot/run-auto-publish.sh >> $HOME/wsj_club/.bot/logs/cron.log 2>&1
#
# Controls (flag files in .bot/, box-local, never committed):
#   .bot/PAUSE            → skip today's publish run on every track (the vote still opens)
#   .bot/PAUSE-<track>    → the same for one track only
#   .bot/DRY_RUN          → do everything but ship to branch auto/[junior/]<date>
#                           instead of main — the rollout mode; delete the file to go live
#   .bot/DRY_RUN-<track>  → the same for one track only (roll a track out alone)
#                           (dry-run branches: auto/<date>, auto/junior/<date>, auto/kids/<date>)
#   .bot/OFF-<track>      → that track's autopilot is switched off entirely (vote + publish)
# Env overrides for a supervised manual run:
#   AUTOPUBLISH_FORCE=1      publish NOW: bypass the time gate AND the vote hold
#   AUTOPUBLISH_TIME=09:30   pretend it is this Pacific time (exercise the gate and the hold)
#   AUTOPUBLISH_DATE=…       publish a specific poll date (default: today Pacific)
#   AUTOPILOT_MODEL=…        run the sessions on another model (default claude-sonnet-5-5[1m])
#   AUTOPUBLISH_DRY_RUN=1    same as the DRY_RUN flag file
set -uo pipefail

export PATH="$HOME/.local/bin:$PATH"   # `node` under cron's minimal PATH

if [ $# -ne 0 ]; then
  echo "usage: $0   (no arguments — for one track, run publish-track.sh --track=senior|junior)" >&2
  exit 2
fi

FORCE="${AUTOPUBLISH_FORCE:-0}"
# The half-hour slot this firing belongs to, as HH:MM (cron can start a few
# seconds late, so the minute is rounded down to :00 or :30).
NOW="${AUTOPUBLISH_TIME:-$(TZ=America/Los_Angeles date +%H:%M)}"
HOUR="${NOW%%:*}"; MIN="${NOW##*:}"
if [ "$((10#$MIN))" -lt 30 ]; then MIN=00; else MIN=30; fi
SLOT="${HOUR}:${MIN}"
if [ "$FORCE" != "1" ]; then
  case "$SLOT" in
    09:00|09:30|10:00|10:30|11:00|11:30|12:00) ;;
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

# One day-run at a time: the half-hourly firings must not pile up behind a run
# still authoring (the children take the shared autopilot lock and would just
# queue). Non-blocking — a firing that finds a run in progress is done.
exec 8>"$LOG_DIR/.publish-day.lock"
if ! flock -n 8; then
  log "a publish run is already in progress (Pacific ${SLOT}); nothing to do"
  exit 0
fi

log "starting (Pacific $(TZ=America/Los_Angeles date +%FT%T), slot=${SLOT}, date=${TODAY}, force=${FORCE})"

# --- The vote hold ----------------------------------------------------------
# Per track: off / paused / published / no poll / N ballot(s). "published" is
# read off origin/main (a fetch, not a pull — the children own the tree).
git fetch -q origin >> "$LOG_FILE" 2>&1 || log "WARNING git fetch failed; reading 'published' from the local tree"
SENIOR_POLL=0; SENIOR_BALLOTS=0; JUNIOR_POLL=0; JUNIOR_BALLOTS=0; KIDS_POLL=0; KIDS_BALLOTS=0
CHECK_OK=1
if BALLOT_LINE="$(node .bot/ballots.mjs "$TODAY" 2>> "$LOG_FILE")" && [ -n "$BALLOT_LINE" ]; then
  eval "$BALLOT_LINE"   # numbers only, by construction (see ballots.mjs)
  log "ballots: ${BALLOT_LINE}"
else
  CHECK_OK=0
  log "WARNING the ballot check failed (see above)"
fi

TRACKS=(senior junior kids)
content_of() { [ "$1" = "senior" ] && echo "content/${TODAY}.json" || echo "content/$1/${TODAY}.json"; }
WAITING=()
STATUS=()
PENDING=0   # tracks that still have something to publish
for T in "${TRACKS[@]}"; do
  CONTENT="$(content_of "$T")"
  case "$T" in
    junior) POLL="$JUNIOR_POLL"; BALLOTS="$JUNIOR_BALLOTS" ;;
    kids)   POLL="$KIDS_POLL";   BALLOTS="$KIDS_BALLOTS" ;;
    *)      POLL="$SENIOR_POLL"; BALLOTS="$SENIOR_BALLOTS" ;;
  esac
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
  case "$S" in off|paused|published) ;; *) PENDING=$((PENDING + 1)) ;; esac
done
SUMMARY="$(IFS=,; echo "${STATUS[*]}" | sed 's/,/, /g')"
log "tracks — ${SUMMARY}"

case "$SLOT" in
  09:00) NEXT="9:30am" ;;  09:30) NEXT="10:00am" ;;
  10:00) NEXT="10:30am" ;; 10:30) NEXT="11:00am" ;;
  11:00) NEXT="11:30am" ;; *) NEXT="12:00pm" ;;
esac
BEFORE_NOON=0; [ "$((10#$HOUR))" -lt 12 ] && BEFORE_NOON=1

if [ "$FORCE" = "1" ]; then
  log "FORCE — publishing now regardless of the ballots"
elif [ "$CHECK_OK" != "1" ] && [ "$BEFORE_NOON" = "1" ]; then
  # Can't tell whether the votes are in: don't publish on a guess, retry at
  # the next check, and page (a broken DB check is a real failure).
  notify "⚠️ Reading Club ${TODAY} — the ballot check failed (${SUMMARY}); not publishing now, retrying at ${NEXT} Pacific. See .bot/logs/run-auto-publish-${TODAY}.log on the box."
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

# --- Publish: senior, junior, then kids ---------------------------------------
# Each child takes the autopilot lock, runs its skill, verifies its outcome and
# sends its own owner DMs; its exit code is its verdict (0 = the day is live,
# already published, paused, or off). A failed run never skips the next track.
# A firing after the day is done (every track published, paused or off) skips
# straight to the announcement check, which is once-only.
RESULT=()
RC_ALL=0
if [ "$PENDING" -eq 0 ] && [ "$FORCE" != "1" ]; then
  log "every track is published, paused or off — nothing to publish"
else
  for T in "${TRACKS[@]}"; do
    log "running publish-track.sh --track=${T}"
    rc=0
    bash "$SCRIPT_DIR/publish-track.sh" "--track=${T}" || rc=$?
    RESULT+=("${T} rc=${rc}")
    [ "$rc" -ne 0 ] && RC_ALL=1
  done
fi

# --- The one group message ----------------------------------------------------
# Sent ONCE per day (.bot/state/<date>-announced), and only when every track
# that should publish today (not off, not paused) is on origin/main AND this
# autopilot pushed it and saw it serve (publish-track.sh's -live marker, which
# holds the title). Otherwise — a track failed, went to a dry-run branch, or
# was published by hand — the owner's DM gets the ready-to-forward text and
# the reason, and nothing reaches the group. A dry-run day sends nothing.
#   Today's readings:
#   High school: *<title>* (dailyreadingclub.com)
#   Middle school: *<title>* (dailyreadingclub.com/middle-school)
#   Elementary: *<title>* (dailyreadingclub.com/elementary)
# (*…* is WhatsApp bold.) Nothing else ever goes to the group.
ANNOUNCED=".bot/state/${TODAY}-announced"
git fetch -q origin >> "$LOG_FILE" 2>&1
title_of() { # title_of <git object>
  git show "$1" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).title||""))}catch{}})'
}
if [ -f "$ANNOUNCED" ]; then
  log "group message already handled today ($(cat "$ANNOUNCED"))"
else
  LINES=()
  HELD=()
  EXPECTED=0
  DRY=0
  for T in "${TRACKS[@]}"; do
    [ -f "$PROJECT_DIR/.bot/OFF-${T}" ] && continue
    { [ -f "$PROJECT_DIR/.bot/PAUSE" ] || [ -f "$PROJECT_DIR/.bot/PAUSE-${T}" ]; } && continue
    EXPECTED=$((EXPECTED + 1))
    { [ -f "$PROJECT_DIR/.bot/DRY_RUN" ] || [ -f "$PROJECT_DIR/.bot/DRY_RUN-${T}" ] || [ "${AUTOPUBLISH_DRY_RUN:-}" = "1" ]; } && DRY=1
    case "$T" in
      junior) LABEL="Middle school"; SITE="dailyreadingclub.com/middle-school"; LIVE=".bot/state/${TODAY}-junior-live" ;;
      kids)   LABEL="Elementary";    SITE="dailyreadingclub.com/elementary";    LIVE=".bot/state/${TODAY}-kids-live" ;;
      *)      LABEL="High school";   SITE="dailyreadingclub.com";               LIVE=".bot/state/${TODAY}-live" ;;
    esac
    CONTENT="$(content_of "$T")"
    if git cat-file -e "origin/main:${CONTENT}" 2>/dev/null; then
      LINES+=("${LABEL}: *$(title_of "origin/main:${CONTENT}")* (${SITE})")
      [ -f "$LIVE" ] || HELD+=("${T} was published by hand")
    else
      HELD+=("${T} is not live")
    fi
  done
  if [ "$EXPECTED" -eq 0 ] || [ "$DRY" = "1" ]; then
    log "no group message (every track off/paused, or a dry run)"
  elif [ ${#HELD[@]} -eq 0 ]; then
    MSG="Today's readings:"$'\n'"$(printf '%s\n' "${LINES[@]}")"
    if printf '%s' "$MSG" | node .bot/notify.mjs --to=group --stdin >> "$LOG_FILE" 2>&1; then
      log "announced to the group: ${MSG//$'\n'/ | }"
      echo "group $(date -u +%FT%TZ)" > "$ANNOUNCED"
    else
      log "WARNING notify.mjs --to=group failed; will retry at the next firing"
    fi
  elif [ "$BEFORE_NOON" = "1" ] && [ "$FORCE" != "1" ] && printf '%s\n' "${HELD[@]}" | grep -q "is not live"; then
    # A track still missing before noon may yet publish at a later firing (or
    # by hand): hold quietly, the next firing re-checks.
    log "group message held — ${HELD[*]}; re-checking at the next firing"
  else
    REASON="$(IFS=';'; echo "${HELD[*]}" | sed 's/;/; /g')"
    BODY="Today's readings:"$'\n'"$(printf '%s\n' "${LINES[@]}")"
    notify "📣 Reading Club ${TODAY} — the group message was NOT sent (${REASON}). Ready to forward:"$'\n\n'"${BODY}"
    echo "owner $(date -u +%FT%TZ) (${REASON})" > "$ANNOUNCED"
  fi
fi

[ ${#RESULT[@]} -eq 0 ] && RESULT=("nothing to publish")
log "done — ${RESULT[*]} (exit ${RC_ALL})"
# One line to stdout → cron.log and the healthcheck ping body, so a page says
# which track failed without opening the logs.
echo "run-auto-publish ${TODAY}: ${RESULT[*]}"
exit $RC_ALL
