#!/bin/bash
# Ship one day's reading from the Hetzner box: stage exactly the day's files,
# commit, rebase on main, push (= deploy), and wait for the live site to serve
# the handout. The git sequence is deterministic on purpose — the auto-publish
# skill calls this instead of driving git itself.
#
#   .bot/ship.sh <YYYY-MM-DD> [--dry-run]
#
# LIVE (default): commit on main → `git pull --rebase origin main` → refuse if
#   main already carries the day (the owner published by hand meanwhile) →
#   `git push origin main` → poll https://dailyreadingclub.com/reading/<date>
#   until it serves (Vercel builds the push), up to ~12 minutes.
# DRY RUN: the same commit goes to branch auto/<date> (force-pushed; Vercel
#   builds a preview of it, main is untouched) and the tree returns to main.
#
# Exit codes: 0 shipped · 2 nothing to ship / bad args · 3 main already has the
# day (aborted, tree reset) · 4 push failed · 5 pushed but the site never served
# the handout in time (deploy still probably lands — check Vercel).
# Needs a push credential on the box (deploy key, see RECOVERY.md).
set -uo pipefail

DATE="${1:-}"
MODE="live"
[ "${2:-}" = "--dry-run" ] && MODE="dry-run"
if ! [[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "usage: .bot/ship.sh <YYYY-MM-DD> [--dry-run]" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$(dirname "$SCRIPT_DIR")" || exit 2

CONTENT="content/${DATE}.json"
PAGE="public/articles/${DATE}.html"
GLOSS="public/glossaries/${DATE}.json"
AUDIO="public/audio/${DATE}"
if [ ! -f "$CONTENT" ]; then
  echo "ship: $CONTENT does not exist — nothing to ship" >&2
  exit 2
fi

# Identity: the box's git config if set, else a fixed autopilot identity.
GIT=(git)
[ -z "$(git config user.name)" ] && GIT+=(-c user.name="Reading Club autopilot")
[ -z "$(git config user.email)" ] && GIT+=(-c user.email="autopilot@dailyreadingclub.com")

# --- Commit message (same shape as the hand-authored days) ------------------
MSG="$(node .bot/commit-message.mjs "$DATE")" || { echo "ship: could not compose the commit message" >&2; exit 2; }

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
  BRANCH="auto/${DATE}"
  "${GIT[@]}" checkout -q -B "$BRANCH" || exit 4
  "${GIT[@]}" commit -q -m "$MSG" || { git checkout -q main; exit 4; }
  if "${GIT[@]}" push -f -q origin "$BRANCH"; then
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
echo "ship: pushed $(git rev-parse --short HEAD) to main — Vercel is deploying"

# --- Wait for the deploy: the handout route serves only once the build lands ---
URL="https://dailyreadingclub.com/reading/${DATE}"
for i in $(seq 1 36); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$URL" || echo 000)"
  if [ "$CODE" = "200" ]; then
    echo "ship: LIVE — $URL (after ~$((i * 20))s)"
    exit 0
  fi
  sleep 20
done
echo "ship: pushed, but $URL still isn't serving after 12 minutes (last HTTP $CODE) — check the Vercel deploy" >&2
exit 5
