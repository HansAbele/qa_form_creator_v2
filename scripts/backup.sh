#!/bin/bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/backup-key.sh
source "$SCRIPT_DIR/lib/backup-key.sh"
# shellcheck source=scripts/lib/secure-file.sh
source "$SCRIPT_DIR/lib/secure-file.sh"

APP_DIR="${APP_DIR:-/opt/qa-form-creator}"
ENV_FILE="${ENV_FILE:-.env.production}"
if [[ "$ENV_FILE" != /* ]] &&
   { [ -e "$APP_DIR/$ENV_FILE" ] || [ -L "$APP_DIR/$ENV_FILE" ]; }; then
  ENV_FILE="$APP_DIR/$ENV_FILE"
fi
if [ -e "$ENV_FILE" ] || [ -L "$ENV_FILE" ]; then
  validate_secure_operator_file "$ENV_FILE" "environment file" || exit 1
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [ "${QORE_LOCK_HELD:-false}" != "true" ]; then
  LOCK_FILE="${QORE_LOCK_FILE:-$APP_DIR/.qore-operations.lock}"
  exec 9>"$LOCK_FILE"
  flock -n 9 || { echo "Another deploy, backup, or restore operation is running."; exit 1; }
fi

BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
DB_CONTAINER="${DB_CONTAINER:-qa_form_creator_db}"
DB_OWNER_USER="${DB_OWNER_USER:?DB_OWNER_USER is required}"
DB_NAME="${DB_NAME:-qa_form_creator}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
BACKUP_ENCRYPTION_KEY_FILE="${BACKUP_ENCRYPTION_KEY_FILE:?BACKUP_ENCRYPTION_KEY_FILE is required}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"
REQUIRE_OFFSITE_BACKUP="${REQUIRE_OFFSITE_BACKUP:-true}"

[[ "$DB_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || { echo "Unsafe DB_NAME."; exit 1; }
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || { echo "RETENTION_DAYS must be numeric."; exit 1; }
if [ "$REQUIRE_OFFSITE_BACKUP" != "true" ] && [ "$REQUIRE_OFFSITE_BACKUP" != "false" ]; then
  echo "REQUIRE_OFFSITE_BACKUP must be true or false."
  exit 1
fi
validate_secure_operator_file "$BACKUP_ENCRYPTION_KEY_FILE" "backup encryption key" || exit 1
validate_backup_key_material "$BACKUP_ENCRYPTION_KEY_FILE" || exit 1
if [ "$REQUIRE_OFFSITE_BACKUP" = "true" ] &&
   { [ -z "$BACKUP_REMOTE" ] || [[ "$BACKUP_REMOTE" == CHANGE_ME* ]]; }; then
  echo "BACKUP_REMOTE is required by policy. Configure an rclone destination."
  exit 1
fi
if [ -n "$BACKUP_REMOTE" ] && ! command -v rclone >/dev/null 2>&1; then
  echo "rclone is required for off-site backup replication."
  exit 1
fi
if [ -n "$BACKUP_REMOTE" ]; then
  [[ "$BACKUP_REMOTE" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*:.+ ]] || {
    echo "BACKUP_REMOTE must be a configured rclone remote, not a local path."
    exit 1
  }
  remote_name="${BACKUP_REMOTE%%:*}"
  remote_metadata=$(rclone listremotes --json --name "$remote_name" --exact) || {
    echo "Could not inspect BACKUP_REMOTE."
    exit 1
  }
  printf '%s' "$remote_metadata" | grep -Eq '"name"[[:space:]]*:[[:space:]]*"' || {
    echo "BACKUP_REMOTE does not reference a configured rclone remote."
    exit 1
  }
  if printf '%s' "$remote_metadata" \
    | grep -Eq '"type"[[:space:]]*:[[:space:]]*"(local|alias)"'; then
    echo "BACKUP_REMOTE cannot use rclone's local or alias backend."
    exit 1
  fi
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp=$(date -u +"%Y%m%dT%H%M%SZ")
base_name="${DB_NAME}_${timestamp}.dump.enc"
encrypted_file="$BACKUP_DIR/$base_name"
checksum_file="$encrypted_file.sha256"
manifest_file="$encrypted_file.manifest.enc"
manifest_checksum_file="$manifest_file.sha256"
encrypted_partial="$encrypted_file.partial"
checksum_partial="$checksum_file.partial"
manifest_partial="$manifest_file.partial"
manifest_checksum_partial="$manifest_checksum_file.partial"
raw_file=$(mktemp "$BACKUP_DIR/.${DB_NAME}.XXXXXX.dump")
manifest_raw=$(mktemp "$BACKUP_DIR/.${DB_NAME}.XXXXXX.manifest")
backup_complete=false
cleanup() {
  rm -f "$raw_file" "$manifest_raw" "$encrypted_partial" "$checksum_partial" \
    "$manifest_partial" "$manifest_checksum_partial"
  if [ "$backup_complete" != "true" ]; then
    rm -f "$encrypted_file" "$checksum_file" "$manifest_file" "$manifest_checksum_file"
  fi
}
trap cleanup EXIT

snapshot_row_counts() {
  docker exec -i "$DB_CONTAINER" psql \
    --username "$DB_OWNER_USER" --dbname "$DB_NAME" --no-psqlrc \
    --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 \
    < "$APP_DIR/scripts/sql/snapshot-row-counts.sql" | tail -n 1
}

source_counts_before=$(snapshot_row_counts)
[[ "$source_counts_before" = \{*\} ]] || {
  echo "Could not capture source row-count evidence."
  exit 1
}

echo "[$(date -u +%FT%TZ)] Creating PostgreSQL custom-format dump"
docker exec "$DB_CONTAINER" pg_dump \
  --username "$DB_OWNER_USER" \
  --dbname "$DB_NAME" \
  --format=custom \
  --no-owner \
  --no-privileges > "$raw_file"

source_counts_after=$(snapshot_row_counts)
if [ "$source_counts_before" != "$source_counts_after" ]; then
  echo "Source row counts changed during backup; retry during a quiescent window."
  exit 1
fi

if [ "$(stat -c%s "$raw_file")" -lt 100 ]; then
  echo "Backup dump is unexpectedly small."
  exit 1
fi

openssl enc -aes-256-cbc -pbkdf2 -salt \
  -in "$raw_file" \
  -out "$encrypted_partial" \
  -pass "file:$BACKUP_ENCRYPTION_KEY_FILE"
mv "$encrypted_partial" "$encrypted_file"
chmod 600 "$encrypted_file"
(cd "$BACKUP_DIR" && sha256sum "$base_name" > "${base_name}.sha256.partial")
mv "$checksum_partial" "$checksum_file"
chmod 600 "$checksum_file"

backup_hash=$(sha256sum "$encrypted_file" | awk '{ print $1 }')
printf 'backup_sha256=%s\nrow_counts=%s\n' \
  "$backup_hash" "$source_counts_before" > "$manifest_raw"
openssl enc -aes-256-cbc -pbkdf2 -salt \
  -in "$manifest_raw" \
  -out "$manifest_partial" \
  -pass "file:$BACKUP_ENCRYPTION_KEY_FILE"
mv "$manifest_partial" "$manifest_file"
chmod 600 "$manifest_file"
(cd "$BACKUP_DIR" && sha256sum "$(basename "$manifest_file")" \
  > "$(basename "$manifest_checksum_file").partial")
mv "$manifest_checksum_partial" "$manifest_checksum_file"
chmod 600 "$manifest_checksum_file"

openssl enc -d -aes-256-cbc -pbkdf2 \
  -in "$encrypted_file" \
  -pass "file:$BACKUP_ENCRYPTION_KEY_FILE" |
  docker exec -i "$DB_CONTAINER" pg_restore --list >/dev/null

if [ -n "$BACKUP_REMOTE" ]; then
  for artifact in \
    "$encrypted_file" "$checksum_file" "$manifest_file" "$manifest_checksum_file"; do
    remote_file="${BACKUP_REMOTE%/}/$(basename "$artifact")"
    remote_partial="${remote_file}.partial"
    rclone copyto "$artifact" "$remote_partial"
    rclone moveto "$remote_partial" "$remote_file"
    local_hash=$(sha256sum "$artifact" | awk '{ print $1 }')
    remote_hash=$(rclone cat "$remote_file" | sha256sum | awk '{ print $1 }')
    if [ "$local_hash" != "$remote_hash" ]; then
      echo "Off-site backup verification failed for $(basename "$artifact")."
      exit 1
    fi
  done
  echo "Encrypted backup and manifest were replicated and download-verified off-site."
fi

find "$BACKUP_DIR" -type f -name '*.dump.enc*' -mtime "+$RETENTION_DAYS" -delete

backup_complete=true

if [ -n "${BACKUP_RESULT_FILE:-}" ]; then
  printf '%s\n' "$encrypted_file" > "$BACKUP_RESULT_FILE"
  chmod 600 "$BACKUP_RESULT_FILE"
fi

echo "[$(date -u +%FT%TZ)] Backup verified: $encrypted_file"
