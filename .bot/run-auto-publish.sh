#!/bin/bash
# Autonomous daily PUBLISH for the Reading Club — the mid-morning cousin of
# run-auto-vote.sh, one wrapper for both tracks. The agentic session inside it
# tallies, captures, authors and pushes (via ship.sh); THIS script then waits
# for Vercel to serve the day and sends the WhatsApp messages — the model never
# sits on a long wait or messages anyone (a `claude -p` session ends the moment
# the model ends its turn, and anything it left in the background dies with it).
#   bash .bot/run-auto-publish.sh                 # senior (default): the auto-publish skill
#   bash .bot/run-auto-publish.sh --track=junior  # junior: the auto-publish-junior skill
#
# Cron fires each track at BOTH 16:xx and 17:xx UTC; the Pacific gate lets
# exactly one proceed, so it runs at 09:xx America/Los_Angeles year-round.
# Publishing the reading is what closes the vote — this IS the close, so 9am
# Pacific is the club's fixed voting deadline on both tracks. The junior cron
# fires 10 minutes after the senior one and waits for the shared autopilot
# lock, so the junior tally happens once the senior day has shipped (typically
# 9:30–9:45; a junior ballot cast in that window still counts).
#
# The club group gets ONE message a day, from the junior run once both tracks
# are live — "Today's articles are up." + a Regular line + a Junior line. The
# senior run hands its title over via state/<date>-senior-live; the junior
# wrapper folds it in, or sends the senior line alone if the junior day didn't
# ship (see the announcement helpers below).
#
# Crontab entries (UTC):
#   0  16,17 * * *  bash $HOME/wsj_club/.bot/run-auto-publish.sh                 >> $HOME/wsj_club/.bot/logs/cron.log 2>&1
#   10 16,17 * * *  bash $HOME/wsj_club/.bot/run-auto-publish.sh --track=junior  >> $HOME/wsj_club/.bot/logs/cron.log 2>&1
#
# Controls (flag files in .bot/, box-local, never committed):
#   .bot/PAUSE            → skip today's publish run on every track (log a line, exit 0)
#   .bot/PAUSE-<track>    → the same for one track only
#   .bot/DRY_RUN          → do everything but ship to branch auto/[junior/]<date>
#                           instead of main — the rollout mode; delete the file to go live
#   .bot/DRY_RUN-<track>  → the same for one track only (roll a track out alone)
#   .bot/OFF-<track>      → that track's autopilot is switched off entirely (vote + publish)
#   (the publish wrapper reads these once it holds the autopilot lock — for the
#   junior run, only after the senior one has finished; see below)
# Env overrides for a supervised manual run:
#   AUTOPUBLISH_FORCE=1      bypass the 9am gate
#   AUTOPUBLISH_DATE=…       publish a specific poll date (default: today Pacific)
#   AUTOPILOT_MODEL=…        run the session on another model (default claude-opus-5[1m])
#   AUTOPUBLISH_DRY_RUN=1    same as the DRY_RUN flag file
set -uo pipefail

export PATH="$HOME/.local/bin:$PATH"   # `claude`, `node` under cron's minimal PATH

# Which model the agentic session runs on. Pinned here rather than left to the
# box's ~/.claude/settings.json default: a per-model usage limit on that
# ambient default silently kills every run of the day (the session exits
# immediately with "You've reached your … limit"). Override for one run with
# AUTOPILOT_MODEL=… to fall back to another model when this one is capped.
AUTOPILOT_MODEL="${AUTOPILOT_MODEL:-claude-opus-5[1m]}"

TRACK="senior"
for a in "$@"; do
  case "$a" in
    --track=senior|--track=junior) TRACK="${a#--track=}" ;;
    *) echo "usage: $0 [--track=senior|junior]" >&2; exit 2 ;;
  esac
done

if [ "${AUTOPUBLISH_FORCE:-}" != "1" ] && [ "$(TZ=America/Los_Angeles date +%H)" != "09" ]; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR" || exit 1

# Per-track knobs: the skill, the content path, the branch a dry run lands on,
# and the URL that proves the day is serving.
TODAY="${AUTOPUBLISH_DATE:-$(TZ=America/Los_Angeles date +%F)}"
# MARK is dropped by ship.sh after a successful push — the announcement is
# gated on it, so a day the owner published by hand while the run worked is
# never announced by us.
if [ "$TRACK" = "junior" ]; then
  NAME="auto-publish-junior"
  CONTENT="content/junior/${TODAY}.json"
  DRY_BRANCH="auto/junior/${TODAY}"
  READING_URL="https://dailyreadingclub.com/junior/reading/${TODAY}"
  MARK=".bot/state/${TODAY}-junior-pushed"
  TRACK_LABEL="JUNIOR "
else
  NAME="auto-publish"
  CONTENT="content/${TODAY}.json"
  DRY_BRANCH="auto/${TODAY}"
  READING_URL="https://dailyreadingclub.com/reading/${TODAY}"
  MARK=".bot/state/${TODAY}-pushed"
  TRACK_LABEL=""
fi
# The senior run's hand-off to the junior one: the senior title, written when
# the senior day is live but a junior run is still to come. Consumed (and
# removed) by the junior wrapper — see the announcement helpers below.
DEFER=".bot/state/${TODAY}-senior-live"

LOG_DIR="$PROJECT_DIR/.bot/logs"
mkdir -p "$LOG_DIR" "$PROJECT_DIR/.bot/state"
LOG_FILE="$LOG_DIR/${NAME}-${TODAY}.log"
log() { echo "[$(date -u +%FT%TZ)] ${NAME}: $*" >> "$LOG_FILE"; }
notify() { # notify <owner|group> <text> — NANOCLAW_* come from .bot/.env, sourced below
  if printf '%s' "$2" | node .bot/notify.mjs --to="$1" --stdin >> "$LOG_FILE" 2>&1; then
    log "notified ${1}: ${2//$'\n'/ | }"
  else
    log "WARNING notify.mjs --to=${1} failed (see above); the message was: ${2//$'\n'/ | }"
  fi
}

# --- The club-group announcement: ONE message a day --------------------------
# Sent by the junior run once both tracks are live:
#   Today's articles are up.
#   Regular: "<senior title>"  dailyreadingclub.com
#   Junior: "<junior title>"  dailyreadingclub.com/junior
# So the senior run stays quiet when a junior run is still to come and leaves
# its title in DEFER; the junior wrapper folds it in — or, if the junior day
# didn't ship (failed, paused or hand-published meanwhile, dry run), sends the
# senior line alone, so a shipped senior day is never left unannounced. When no
# junior run will follow, the senior run announces itself. A track that shipped
# alone gets its own one-liner. Every group message is gated on the run's MARK
# (ship.sh pushed it in THIS run) — a hand-published day is never announced.
junior_run_pending() { # senior only: will a junior run still ship (and announce) after us today?
  [ "$TRACK" = "senior" ] || return 1
  local f
  for f in OFF-junior PAUSE PAUSE-junior DRY_RUN DRY_RUN-junior; do
    [ -f "$PROJECT_DIR/.bot/$f" ] && return 1
  done
  ! git cat-file -e "origin/main:content/junior/${TODAY}.json" 2>/dev/null
}
announce_senior_alone() { # junior only: flush a deferred senior announcement on its own
  [ -f "$DEFER" ] || return 0
  log "the senior day was handed to this run and the junior day isn't live — announcing the senior line alone"
  notify group "Today's article is up (\"$(cat "$DEFER")\").  dailyreadingclub.com"
  rm -f "$DEFER"
}

MODE="live"
if [ -f "$PROJECT_DIR/.bot/DRY_RUN" ] || [ -f "$PROJECT_DIR/.bot/DRY_RUN-${TRACK}" ] || [ "${AUTOPUBLISH_DRY_RUN:-}" = "1" ]; then
  MODE="dry-run"
  export AUTOPUBLISH_DRY_RUN=1
fi
export AUTOPUBLISH_DATE="$TODAY"
export AUTOPUBLISH_TRACK="$TRACK"

log "starting (Pacific $(TZ=America/Los_Angeles date +%FT%T), track=${TRACK}, mode=${MODE}, date=${TODAY})"

# One autopilot run at a time on this box — the tree, the build and the browser
# are all shared. Waits rather than skips: that is how the junior run queues
# behind the senior one (and a manual test queues behind the cron). Two hours
# of waiting means something is badly stuck: exit 1 → the healthcheck pages.
exec 9>"$LOG_DIR/.autopilot.lock"
if ! flock -w 7200 9; then
  log "could not get the autopilot lock within 2 hours; exiting 1 for healthchecks"
  exit 1
fi

# Secrets for every command in the session: SUPABASE_DB_URL, BLOB_READ_WRITE_TOKEN,
# OPENAI_API_KEY from .env.local; ECON_* + NANOCLAW_CHATJID (owner DM) +
# NANOCLAW_GROUP_JID (the club group, for the announcement) from .bot/.env.
set -a
# shellcheck source=/dev/null
[ -f "$PROJECT_DIR/.env.local" ] && source "$PROJECT_DIR/.env.local"
# shellcheck source=/dev/null
[ -f "$PROJECT_DIR/.bot/.env" ] && source "$PROJECT_DIR/.bot/.env"
set +a

# The flag files are read here, once we hold the lock, so the junior wrapper
# always outlives the senior one: whatever the senior run left in DEFER, this
# run sees it — a paused or switched-off junior day still sends the senior line.
if [ -f "$PROJECT_DIR/.bot/OFF-${TRACK}" ]; then
  log "OFF (.bot/OFF-${TRACK} exists) — the ${TRACK} autopilot is switched off; skipping ${TODAY}"
  [ "$TRACK" = "junior" ] && announce_senior_alone
  exit 0
fi
if [ -f "$PROJECT_DIR/.bot/PAUSE" ] || [ -f "$PROJECT_DIR/.bot/PAUSE-${TRACK}" ]; then
  log "PAUSED (.bot/PAUSE or .bot/PAUSE-${TRACK} exists) — skipping ${TODAY}"
  [ "$TRACK" = "junior" ] && announce_senior_alone
  exit 0
fi

# A clean tree on main is the precondition — this box is a runtime, not a
# workspace. Leftovers (a crashed earlier run) go to a stash, recoverable with
# `git stash list`, never deleted.
if [ -n "$(git status --porcelain | grep -v '^?? article-text/')" ]; then
  log "working tree is dirty — stashing leftovers before starting:"
  git status --porcelain >> "$LOG_FILE"
  git stash push -u -q -m "${NAME} leftovers before ${TODAY}" >> "$LOG_FILE" 2>&1
fi
git checkout -q main 2>> "$LOG_FILE"
if git pull --ff-only origin main >> "$LOG_FILE" 2>&1; then
  log "git pull OK at $(git rev-parse --short HEAD)"
else
  log "git pull failed at $(git rev-parse --short HEAD); proceeding"
fi

if [ -f "$PROJECT_DIR/$CONTENT" ]; then
  log "outcome OK — ${TRACK} reading ${TODAY} already published (by hand); nothing to do"
  [ "$TRACK" = "junior" ] && announce_senior_alone
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

# One agentic session runs tally → capture → author → ship (the push only).
# Same invocation shape as run-auto-vote.sh (unattended, so no permission
# prompts). A stale marker from an earlier attempt must not gate today's send.
rm -f "$MARK"
[ "$TRACK" = "senior" ] && rm -f "$DEFER"
CLAUDE_RC=0
"${XVFB[@]}" claude -p "Use the ${NAME} skill to publish today's Reading Club ${TRACK} reading (date ${TODAY}, mode ${MODE}). Run fully autonomously end to end — never pause for confirmation — and follow the skill's guards, quality gates, and failure handling exactly." \
  --model "$AUTOPILOT_MODEL" \
  --dangerously-skip-permissions \
  >> "$LOG_FILE" 2>&1 || CLAUDE_RC=$?
log "claude session exited (rc=$CLAUDE_RC)"

# --- Outcome check + messages (the alerting contract) -----------------------
# claude -p exits 0 even when the skill's failure path ran, so success is
# verified from the outcome: LIVE = the day is on origin/main AND the site
# serves it — polled for up to ~12 minutes, since ship.sh returns right after
# the push and Vercel builds it afterwards; DRY RUN = origin has the dry-run
# branch. Anything else exits 1 so the cron's healthcheck pages the owner (the
# skill's failure path is silent).
# The messages are sent from here, never from the skill, and only when MARK
# exists (ship.sh pushed in THIS run): the club group gets the day's one
# announcement (the helpers above) for a verified-live day; the owner's DM gets
# the dry-run note or the pushed-but-not-serving warning.
git fetch -q origin >> "$LOG_FILE" 2>&1
title_of() { # title_of <git object, e.g. origin/main:content/2026-09-06.json>
  git show "$1" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).title||""))}catch{}})'
}
if [ "$MODE" = "dry-run" ]; then
  if git rev-parse -q --verify "origin/${DRY_BRANCH}" >/dev/null; then
    log "outcome OK — dry run landed on origin/${DRY_BRANCH}"
    RC=0
    if [ -f "$MARK" ]; then
      notify owner "🧪 ${TRACK_LABEL}Reading Club DRY RUN — ${TODAY} (nothing published): \"$(title_of "origin/${DRY_BRANCH}:${CONTENT}")\" → branch ${DRY_BRANCH} pushed, main untouched; delete .bot/DRY_RUN (or DRY_RUN-${TRACK}) on the box to go live."
    fi
  else
    log "OUTCOME FAILURE — no origin/${DRY_BRANCH} branch after the dry run"
    RC=1
  fi
elif git cat-file -e "origin/main:${CONTENT}" 2>/dev/null; then
  CODE=000
  for i in $(seq 1 36); do
    CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$READING_URL" || echo 000)"
    [ "$CODE" = "200" ] && break
    sleep 20
  done
  TITLE="$(title_of "origin/main:${CONTENT}")"
  if [ "$CODE" = "200" ]; then
    log "outcome OK — ${TRACK} reading ${TODAY} is on main and live (poll ${i})"
    RC=0
    if [ ! -f "$MARK" ]; then
      log "not announcing — no ${MARK}, so this run didn't push it (published by hand meanwhile)"
    elif [ "$TRACK" = "senior" ]; then
      if junior_run_pending; then
        printf '%s' "$TITLE" > "$DEFER"
        log "a junior run is still to come — leaving the announcement to it (${DEFER})"
      else
        notify group "Today's article is up (\"${TITLE}\").  dailyreadingclub.com"
      fi
    elif [ -f "$DEFER" ]; then
      notify group "Today's articles are up.
Regular: \"$(cat "$DEFER")\"  dailyreadingclub.com
Junior: \"${TITLE}\"  dailyreadingclub.com/junior"
      rm -f "$DEFER"
    else
      notify group "Today's junior-track article is up (\"${TITLE}\").  dailyreadingclub.com/junior"
    fi
  else
    log "OUTCOME PARTIAL — ${TRACK} ${TODAY} is on origin/main but the site still returns HTTP ${CODE} after 12 minutes; check the Vercel deploy"
    RC=1
    [ -f "$MARK" ] && notify owner "⚠️ ${TRACK_LABEL}Reading Club — ${TODAY} \"${TITLE}\" is on main but the site hadn't served it after 12 min — check Vercel. The group was NOT told; announce by hand once it's live."
  fi
else
  log "OUTCOME FAILURE — ${TRACK} ${TODAY} is not on origin/main"
  RC=1
fi
# Whatever happened to the junior day, a senior day handed to this run must not
# go unannounced (a no-op when the combined message above consumed it).
[ "$TRACK" = "junior" ] && announce_senior_alone

# Leave the tree clean on main for the next run. A failed run's half-made files
# go to a stash (never deleted); local main is then realigned with origin.
git checkout -q main 2>> "$LOG_FILE"
if [ -n "$(git status --porcelain | grep -v '^?? article-text/')" ]; then
  log "stashing the run's leftover files (git stash list to inspect)"
  git stash push -u -q -m "${NAME} ${TODAY} leftovers (rc=${RC})" >> "$LOG_FILE" 2>&1
fi
git reset -q --hard origin/main >> "$LOG_FILE" 2>&1
exit $RC
