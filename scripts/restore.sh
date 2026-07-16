#!/bin/bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/backup-key.sh
source "$SCRIPT_DIR/lib/backup-key.sh"
# shellcheck source=scripts/lib/secure-file.sh
source "$SCRIPT_DIR/lib/secure-file.sh"

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <backup.dump.enc>"
  exit 1
fi

APP_DIR="${APP_DIR:-/opt/qa-form-creator}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
cd "$APP_DIR"

LOCK_FILE="${QORE_LOCK_FILE:-$APP_DIR/.qore-operations.lock}"
exec 9>"$LOCK_FILE"
flock -n 9 || { echo "Another deploy, backup, or restore operation is running."; exit 1; }

validate_secure_operator_file "$ENV_FILE" "environment file" || exit 1
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

RELEASE_FILE="$APP_DIR/.deployed-release"
if [ ! -f "$RELEASE_FILE" ] || [ -L "$RELEASE_FILE" ]; then
  echo "A trusted .deployed-release manifest is required for restore."
  exit 1
fi
if [ "$(stat -c '%a' "$RELEASE_FILE")" != "600" ] ||
   [ "$(stat -c '%u' "$RELEASE_FILE")" != "$(id -u)" ]; then
  echo ".deployed-release must be owned by the restore operator with mode 600."
  exit 1
fi
# shellcheck disable=SC1090
source "$RELEASE_FILE"
IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is missing from .deployed-release}"
APP_IMAGE_ID="${APP_IMAGE_ID:?APP_IMAGE_ID is missing from .deployed-release}"
MIGRATOR_IMAGE_ID="${MIGRATOR_IMAGE_ID:?MIGRATOR_IMAGE_ID is missing from .deployed-release}"
export IMAGE_TAG

actual_app_image_id=$(docker image inspect --format '{{.Id}}' "qa-form-creator:$IMAGE_TAG" 2>/dev/null || true)
actual_migrator_image_id=$(docker image inspect --format '{{.Id}}' "qa-form-creator-migrator:$IMAGE_TAG" 2>/dev/null || true)
if [ "$actual_app_image_id" != "$APP_IMAGE_ID" ] || [ "$actual_migrator_image_id" != "$MIGRATOR_IMAGE_ID" ]; then
  echo "Pinned restore images do not match the deployed release manifest."
  exit 1
fi

APP_DIR="$APP_DIR" COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" \
  bash scripts/production-preflight.sh --offline

BACKUP_FILE="$1"
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
DB_CONTAINER="${DB_CONTAINER:-qa_form_creator_db}"
DB_NAME="${DB_NAME:-qa_form_creator}"
DB_OWNER_USER="${DB_OWNER_USER:?DB_OWNER_USER is required}"
BACKUP_ENCRYPTION_KEY_FILE="${BACKUP_ENCRYPTION_KEY_FILE:?BACKUP_ENCRYPTION_KEY_FILE is required}"

if [ ! -f "$BACKUP_FILE" ] || [ -L "$BACKUP_FILE" ] ||
   [ ! -f "$CHECKSUM_FILE" ] || [ -L "$CHECKSUM_FILE" ]; then
  echo "Encrypted backup and matching .sha256 file are both required."
  exit 1
fi
if [ "$(stat -c '%a' "$BACKUP_FILE")" != "600" ] ||
   [ "$(stat -c '%a' "$CHECKSUM_FILE")" != "600" ]; then
  echo "Encrypted backup and checksum must both have mode 600."
  exit 1
fi
validate_secure_operator_file "$BACKUP_ENCRYPTION_KEY_FILE" "backup encryption key" || exit 1
validate_backup_key_material "$BACKUP_ENCRYPTION_KEY_FILE" || exit 1
if [[ ! "$DB_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
  echo "Unsafe database name."
  exit 1
fi

checksum_target=$(awk 'NR == 1 { sub(/^\*/, "", $2); print $2 }' "$CHECKSUM_FILE")
if [ "$(wc -l < "$CHECKSUM_FILE")" -ne 1 ] ||
   [ "$checksum_target" != "$(basename "$BACKUP_FILE")" ]; then
  echo "Checksum file must contain exactly the requested backup filename."
  exit 1
fi

(cd "$(dirname "$BACKUP_FILE")" && sha256sum --check "$(basename "$CHECKSUM_FILE")")

raw_file=$(mktemp "${TMPDIR:-/tmp}/${DB_NAME}.restore.XXXXXX.dump")
cleanup() { rm -f "$raw_file"; }
trap cleanup EXIT

openssl enc -d -aes-256-cbc -pbkdf2 \
  -in "$BACKUP_FILE" \
  -out "$raw_file" \
  -pass "file:$BACKUP_ENCRYPTION_KEY_FILE"
docker exec -i "$DB_CONTAINER" pg_restore --list < "$raw_file" >/dev/null

if [ "${AUTO_APPROVE_RESTORE:-false}" != "true" ]; then
  echo "This will replace database '$DB_NAME' and temporarily stop the application."
  read -r -p "Type RESTORE to continue: " confirmation
  [ "$confirmation" = "RESTORE" ] || { echo "Restore cancelled."; exit 1; }
fi

echo "Creating a final encrypted backup of the current database"
QORE_LOCK_HELD=true APP_DIR="$APP_DIR" ENV_FILE="$ENV_FILE" bash scripts/backup.sh

echo "Proving the requested backup in an isolated environment before replacing production"
QORE_LOCK_HELD=true IMAGE_TAG="$IMAGE_TAG" APP_DIR="$APP_DIR" ENV_FILE="$ENV_FILE" \
  bash scripts/dr-drill.sh "$BACKUP_FILE"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" stop app

docker exec "$DB_CONTAINER" psql \
  --username "$DB_OWNER_USER" --dbname postgres --set ON_ERROR_STOP=1 \
  --command "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE);"
docker exec "$DB_CONTAINER" psql \
  --username "$DB_OWNER_USER" --dbname postgres --set ON_ERROR_STOP=1 \
  --command "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_OWNER_USER\";"

docker exec -i "$DB_CONTAINER" pg_restore \
  --username "$DB_OWNER_USER" \
  --dbname "$DB_NAME" \
  --no-owner \
  --no-privileges \
  --exit-on-error < "$raw_file"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" --profile tools run --rm migrator
bash scripts/provision-db-roles.sh
APP_DIR="$APP_DIR" COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" \
  bash scripts/production-preflight.sh --online
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-deps app

for attempt in $(seq 1 60); do
  status=$(docker inspect --format='{{.State.Health.Status}}' qa_form_creator_app 2>/dev/null || echo "starting")
  if [ "$status" = "healthy" ]; then
    echo "Restore completed and application health check passed."
    exit 0
  fi
  if [ "$status" = "unhealthy" ] || [ "$attempt" -eq 60 ]; then
    docker logs qa_form_creator_app --tail 80 || true
    echo "Restore completed, but the app is not healthy. It remains unavailable for investigation."
    exit 1
  fi
  sleep 2
done
