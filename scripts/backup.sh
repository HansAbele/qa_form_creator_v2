#!/bin/bash
# ─── PostgreSQL Backup Script ─────────────────────────
# Usage: ./scripts/backup.sh
# Cron:  0 2 * * * /opt/qa-form-creator/scripts/backup.sh

set -euo pipefail

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/opt/qa-form-creator/backups}"
DB_CONTAINER="${DB_CONTAINER:-qa_form_creator_db}"
DB_USER="${DB_USER:-qa_user}"
DB_NAME="${DB_NAME:-qa_form_creator}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Generate filename with timestamp
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"

echo "[$(date)] Starting backup..."

# Dump and compress
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges | gzip > "$BACKUP_FILE"

# Verify backup is not empty
FILESIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE" 2>/dev/null)
if [ "$FILESIZE" -lt 100 ]; then
  echo "[$(date)] ERROR: Backup file is too small ($FILESIZE bytes)"
  rm -f "$BACKUP_FILE"
  exit 1
fi

echo "[$(date)] Backup created: $BACKUP_FILE ($FILESIZE bytes)"

# Remove old backups
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete
echo "[$(date)] Cleaned backups older than $RETENTION_DAYS days"

echo "[$(date)] Backup completed successfully"
