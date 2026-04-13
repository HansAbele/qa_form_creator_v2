#!/bin/bash
# ─── PostgreSQL Restore Script ────────────────────────
# Usage: ./scripts/restore.sh <backup_file.sql.gz>

set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: $0 <backup_file.sql.gz>"
  echo ""
  echo "Available backups:"
  ls -lh "${BACKUP_DIR:-/opt/qa-form-creator/backups}"/*.sql.gz 2>/dev/null || echo "  No backups found"
  exit 1
fi

BACKUP_FILE="$1"
DB_CONTAINER="${DB_CONTAINER:-qa_form_creator_db}"
DB_USER="${DB_USER:-qa_user}"
DB_NAME="${DB_NAME:-qa_form_creator}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: File not found: $BACKUP_FILE"
  exit 1
fi

echo "[$(date)] WARNING: This will overwrite the database '$DB_NAME'"
read -p "Are you sure? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

echo "[$(date)] Restoring from: $BACKUP_FILE"

# Drop and recreate database
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME};"
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE ${DB_NAME};"

# Restore
gunzip -c "$BACKUP_FILE" | docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME"

echo "[$(date)] Restore completed successfully"
echo "[$(date)] Run 'npx prisma migrate deploy' if needed"
