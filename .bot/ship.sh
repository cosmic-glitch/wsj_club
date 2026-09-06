#!/bin/bash
# Ship one day's reading from the Hetzner box: stage exactly the day's files,
# commit, rebase on main, push (= deploy), and wait for the live site to serve
# the handout. The git sequence is deterministic on purpose — the auto-publish
# skills call this instead of driving git themselves.
#
#   .bot/ship.sh <YYYY-MM-DD> [--track=junior] [--dry-run]
#
# The track picks the paths: senior = content/<date>.json + public/articles/,
# public/glossaries/, public/audio/ under the bare date; junior = the same four
# under a junior/ segment, with /junior/reading/<date> as the live URL.
#
# LIVE (default): commit on main → `git pull --rebase origin main` → refuse if
#   main already carries the day (the owner published by hand meanwhile) →
#   `git push origin main`. Returns as soon as the push lands (well under a
#   minute) — it does NOT wait for Vercel. The cron wrapper
#   (run-auto-publish.sh) polls the live URL and sends the announcement; this
#   split is deliberate: the agentic session must never sit on a long wait
#   (it backgrounds it and exits, and the announcement dies with it).
# DRY RUN: the same commit goes to branch auto/[junior/]<date> (force-pushed;
#   Vercel builds a preview of it, main is untouched) and the tree returns to main.
#
# A successful push (either mode) drops `.bot/state/<date>[-junior]-pushed`
# holding the SHA — the wrapper announces only when that marker exists, so a
# day the owner published by hand while the run worked is never announced.
#
# Exit codes: 0 pushed · 2 nothing to ship / bad args · 3 main already has the
# day (aborted, tree reset) · 4 push failed.
# Needs a push credential on the box (deploy key, see RECOVERY.md).
set -uo pipefail

DATE=""
MODE="live"
TRACK="senior"
for a in "$@"; do
  case "$a" in
    --dry-run) MODE="dry-run" ;;
    --track=senior|--track=junior) TRACK="${a#--track=}" ;;
    --*) echo "usage: .bot/ship.sh <YYYY-MM-DD> [--track=junior] [--dry-run]" >&2; exit 2 ;;
    *) DATE="$a" ;;
  esac
done
if ! [[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "usage: .bot/ship.sh <YYYY-MM-DD> [--track=junior] [--dry-run]" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$(dirname "$SCRIPT_DIR")" || exit 2

SUB=""
SUFFIX=""
if [ "$TRACK" = "junior" ]; then SUB="junior/"; SUFFIX="-junior"; fi
MARK=".bot/state/${DATE}${SUFFIX}-pushed"
CONTENT="content/${SUB}${DATE}.json"
PAGE="public/articles/${SUB}${DATE}.html"
GLOSS="public/glossaries/${SUB}${DATE}.json"
AUDIO="public/audio/${SUB}${DATE}"
if [ ! -f "$CONTENT" ]; then
  echo "ship: $CONTENT does not exist — nothing to ship" >&2
  exit 2
fi

# Identity: the box's git config if set, else a fixed autopilot identity.
GIT=(git)
[ -z "$(git config user.name)" ] && GIT+=(-c user.name="Reading Club autopilot")
[ -z "$(git config user.email)" ] && GIT+=(-c user.email="autopilot@dailyreadingclub.com")

# --- Commit message (same shape as the hand-authored days) ------------------
MSG="$(node .bot/commit-message.mjs "$DATE" --track="$TRACK")" || { echo "ship: could not compose the commit message" >&2; exit 2; }

# --- Stage exactly the day's files ----------------------------------------------
"${GIT[@]}" add -- "$CONTENT" "$PAGE" 2>/dev/null
[ -f "$GLOSS" ] && "${GIT[@]}" add -- "$GLOSS"
[ -d "$AUDIO" ] && "${GIT[@]}" add -- "$AUDIO"
if [ -z "$(git diff --cached --name-only)" ]; then
  echo "ship: nothing staged for $DATE (already committed?)" >&2
  exit 2
fi
OTHER="$(git status --porcelain | grep -v -E " (${CONTENT}|${PAGE}|${GLOSS}|${AUDIO}/)" | grep -v '^\?\? article-text/' || true)"
[ -n "$OTHER" ] && echo "ship: NOTE — leaving these unrelated changes unstaged:"$'\n'"$OTHER" >&2

if [ "$MODE" = "dry-run" ]; then
  BRANCH="auto/${SUB}${DATE}"
  "${GIT[@]}" checkout -q -B "$BRANCH" || exit 4
  "${GIT[@]}" commit -q -m "$MSG" || { git checkout -q main; exit 4; }
  if "${GIT[@]}" push -f -q origin "$BRANCH"; then
    mkdir -p .bot/state && echo "dry-run $BRANCH $(git rev-parse --short HEAD)" > "$MARK"
    echo "ship: DRY RUN — committed $(git rev-parse --short HEAD) on $BRANCH and pushed it (main untouched; Vercel builds a preview of the branch)."
    RC=0
  else
    echo "ship: DRY RUN — committed on $BRANCH locally but the push FAILED (check the deploy key)." >&2
    RC=4
  fi
  git checkout -q main
  exit $RC
fi

# --- LIVE -------------------------------------------------------------------
"${GIT[@]}" commit -q -m "$MSG" || exit 4
SHA="$(git rev-parse --short HEAD)"
if ! "${GIT[@]}" pull --rebase -q origin main; then
  git rebase --abort 2>/dev/null
  echo "ship: rebase onto origin/main failed — resetting to origin/main, nothing pushed" >&2
  git reset -q --hard origin/main
  exit 3
fi
# If the owner published this day by hand in the meantime, ours must not stomp it.
if git cat-file -e "origin/main:${CONTENT}" 2>/dev/null; then
  echo "ship: origin/main already has $CONTENT (published by hand?) — dropping our commit, nothing pushed" >&2
  git reset -q --hard origin/main
  exit 3
fi
if ! "${GIT[@]}" push -q origin main; then
  echo "ship: push FAILED (deploy key? network?) — commit $SHA stays on local main; the next run's pull will see it" >&2
  exit 4
fi
mkdir -p .bot/state && echo "live main $(git rev-parse --short HEAD)" > "$MARK"
echo "ship: pushed $(git rev-parse --short HEAD) to main — Vercel is deploying; the wrapper waits for https://dailyreadingclub.com/${SUB}reading/${DATE} and announces"
exit 0
