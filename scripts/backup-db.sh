#!/bin/bash
# Nightly Supabase Postgres backup (cron wrapper, runs on the Hetzner VM next
# to backup-blob.sh): pg_dump of ONLY the rc_* tables — the project is shared
# with whisper-anywhere, whose data has its own backup story — into dated
# gzipped snapshots under backups/db/. Also keeps the free-tier project from
# idling.
#
# Needs SUPABASE_DB_URL (the direct Postgres connection string — the pooler
# host; see PLAN-supabase.md) in .env.local.
#
# Cron (06:05, just before the blob backup):
#   5 6 * * * /root/wsj_club/scripts/backup-db.sh >> /root/wsj_club/backups/db/backup.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_DIR/backups/db"
RETENTION_DAYS=30

mkdir -p "$BACKUP_DIR"

# Skip if a previous run is still going
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || { echo "$(date): previous db backup still running, skipping"; exit 0; }

set -a
source "$PROJECT_DIR/.env.local"
set +a

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "$(date): SUPABASE_DB_URL is not set in .env.local" >&2
  exit 1
fi

STAMP="$(date +%F)"
OUT="$BACKUP_DIR/$STAMP.sql.gz"

echo "$(date): Starting db backup"
pg_dump "$SUPABASE_DB_URL" \
  --table='rc_*' \
  --no-owner --no-privileges \
  | gzip > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
echo "$(date): Backup complete: $OUT ($(du -h "$OUT" | cut -f1))"

find "$BACKUP_DIR" -maxdepth 1 -type f -name '20*.sql.gz' -mtime +$RETENTION_DAYS -delete 2>/dev/null || true

echo "$(date): Cleaned up db backups older than $RETENTION_DAYS days"
