#!/bin/bash
# Daily Vercel Blob backup (cron wrapper) — see scripts/backup-blob.mjs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_DIR/backups"
RETENTION_DAYS=30

mkdir -p "$BACKUP_DIR"

# Skip if a previous run is still going (big-store day / slow network)
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || { echo "$(date): previous backup still running, skipping"; exit 0; }

# Source credentials (export them so the node child process sees them)
set -a
source "$PROJECT_DIR/.env.local"
set +a

echo "$(date): Starting blob backup"
node "$SCRIPT_DIR/backup-blob.mjs"
echo "$(date): Backup complete"

# Clean up old snapshots (hardlinks keep shared data alive in newer ones)
find "$BACKUP_DIR" -maxdepth 1 -type d -name '20*-*-*' -mtime +$RETENTION_DAYS -exec rm -rf {} + 2>/dev/null || true

echo "$(date): Cleaned up backups older than $RETENTION_DAYS days"
