#!/usr/bin/env bash
# Daily Postgres backup for Rizzotto: pg_dump → gzip → local rotation → off-site copy.
#
# Off-site matters because the local copy under /var/backups/rizzotto shares its fate with the
# server. It is useless for exactly the scenario a backup is for — losing the box. The upload is
# best-effort per run but its failure is reported: a silently broken backup is worse than none,
# so a failed upload exits non-zero and systemd's OnFailure= posts to Discord.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/rizzotto}"
CONTAINER="${PG_CONTAINER:-rizzotto-postgres}"
PG_USER="${PG_USER:-rizzotto}"
PG_DB="${PG_DB:-rizzotto}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
# Set to an rclone remote:path (e.g. r2:rizzotto-backups) to enable the off-site copy.
# Credentials come from RCLONE_CONFIG_* vars in /etc/rizzotto/env/backup.env — see deploy/README.md.
REMOTE="${BACKUP_REMOTE:-}"

mkdir -p "$BACKUP_DIR"
stamp=$(date +%F-%H%M)
target="$BACKUP_DIR/db-$stamp.sql.gz"

echo "=== Dumping $PG_DB from container $CONTAINER ==="
# Pipe through a temp file first: with `docker exec … | gzip > final` a mid-dump failure leaves a
# truncated file that still looks like a valid backup.
docker exec "$CONTAINER" pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$target.partial"
mv "$target.partial" "$target"
echo "Wrote $(du -h "$target" | cut -f1) → $target"

echo "=== Rotating local copies older than ${KEEP_DAYS}d ==="
find "$BACKUP_DIR" -name 'db-*.sql.gz' -mtime "+$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'db-*.sql.gz.partial' -mtime +1 -delete

if [ -z "$REMOTE" ]; then
  echo "=== Off-site upload SKIPPED (BACKUP_REMOTE unset) ==="
  exit 0
fi

echo "=== Uploading to $REMOTE ==="
rclone copyto --s3-no-check-bucket "$target" "$REMOTE/db-$stamp.sql.gz"
# Prove the object is actually there rather than trusting the exit code alone.
rclone lsf "$REMOTE/db-$stamp.sql.gz" >/dev/null
echo "Off-site copy verified: $REMOTE/db-$stamp.sql.gz"
