#!/bin/bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/backup-key.sh
source "$SCRIPT_DIR/lib/backup-key.sh"
# shellcheck source=scripts/lib/secure-file.sh
source "$SCRIPT_DIR/lib/secure-file.sh"

fail() {
  echo "DR DRILL FAILED: $*" >&2
  exit 1
}

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <backup.dump.enc>" >&2
  exit 1
fi

APP_DIR="${APP_DIR:-/opt/qa-form-creator}"
ENV_FILE="${ENV_FILE:-.env.production}"
DB_NAME="${DB_NAME:-qa_form_creator}"
IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required}"
BACKUP_FILE="$1"
POSTGRES_IMAGE="postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777"

cd "$APP_DIR"
if [[ "$ENV_FILE" = /* ]]; then
  ENV_PATH="$ENV_FILE"
else
  ENV_PATH="$APP_DIR/$ENV_FILE"
fi
validate_secure_operator_file "$ENV_PATH" "environment file" \
  || fail "environment file security validation failed"
set -a
# shellcheck disable=SC1090
source "$ENV_PATH"
set +a

BACKUP_ENCRYPTION_KEY_FILE="${BACKUP_ENCRYPTION_KEY_FILE:?BACKUP_ENCRYPTION_KEY_FILE is required}"
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
MANIFEST_FILE="${BACKUP_FILE}.manifest.enc"
MANIFEST_CHECKSUM_FILE="${MANIFEST_FILE}.sha256"
[[ "$DB_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || fail "unsafe DB_NAME"
[[ "$IMAGE_TAG" =~ ^[a-zA-Z0-9._-]+$ ]] || fail "unsafe IMAGE_TAG"
[ -f "$BACKUP_FILE" ] && [ ! -L "$BACKUP_FILE" ] || fail "encrypted backup must be a regular non-symlink file"
[ -f "$CHECKSUM_FILE" ] && [ ! -L "$CHECKSUM_FILE" ] || fail "checksum must be a regular non-symlink file"
[ -f "$MANIFEST_FILE" ] && [ ! -L "$MANIFEST_FILE" ] || fail "encrypted backup manifest is missing"
[ -f "$MANIFEST_CHECKSUM_FILE" ] && [ ! -L "$MANIFEST_CHECKSUM_FILE" ] \
  || fail "backup manifest checksum is missing"
[ "$(stat -c '%a' "$BACKUP_FILE")" = "600" ] || fail "encrypted backup mode must be 600"
[ "$(stat -c '%a' "$CHECKSUM_FILE")" = "600" ] || fail "checksum mode must be 600"
[ "$(stat -c '%a' "$MANIFEST_FILE")" = "600" ] || fail "backup manifest mode must be 600"
[ "$(stat -c '%a' "$MANIFEST_CHECKSUM_FILE")" = "600" ] \
  || fail "backup manifest checksum mode must be 600"
validate_secure_operator_file "$BACKUP_ENCRYPTION_KEY_FILE" "backup encryption key" \
  || fail "backup key file security validation failed"
validate_backup_key_material "$BACKUP_ENCRYPTION_KEY_FILE" \
  || fail "backup key is not stable single-line Base64 key material"

checksum_target=$(awk 'NR == 1 { sub(/^\*/, "", $2); print $2 }' "$CHECKSUM_FILE")
[ "$(wc -l < "$CHECKSUM_FILE")" -eq 1 ] || fail "checksum file must contain exactly one entry"
[ "$checksum_target" = "$(basename "$BACKUP_FILE")" ] || fail "checksum entry does not name the requested backup"
manifest_checksum_target=$(awk 'NR == 1 { sub(/^\*/, "", $2); print $2 }' "$MANIFEST_CHECKSUM_FILE")
[ "$(wc -l < "$MANIFEST_CHECKSUM_FILE")" -eq 1 ] \
  || fail "manifest checksum file must contain exactly one entry"
[ "$manifest_checksum_target" = "$(basename "$MANIFEST_FILE")" ] \
  || fail "manifest checksum entry does not name the requested manifest"

app_image="qa-form-creator:$IMAGE_TAG"
migrator_image="qa-form-creator-migrator:$IMAGE_TAG"
docker image inspect "$app_image" >/dev/null 2>&1 || fail "candidate app image is missing: $app_image"
docker image inspect "$migrator_image" >/dev/null 2>&1 || fail "candidate migrator image is missing: $migrator_image"
docker image inspect "$POSTGRES_IMAGE" >/dev/null 2>&1 || fail "pinned PostgreSQL image is unavailable"

(cd "$(dirname "$BACKUP_FILE")" && sha256sum --check "$(basename "$CHECKSUM_FILE")")
(cd "$(dirname "$MANIFEST_FILE")" && sha256sum --check "$(basename "$MANIFEST_CHECKSUM_FILE")")
raw_file=$(mktemp "${TMPDIR:-/tmp}/${DB_NAME}.dr-drill.XXXXXX.dump")
manifest_raw=$(mktemp "${TMPDIR:-/tmp}/${DB_NAME}.dr-drill.XXXXXX.manifest")
network_name=""
volume_name=""
db_container=""
app_container=""
dr_succeeded=false
cleanup() {
  rm -f "$raw_file" "$manifest_raw"
  if [ "$dr_succeeded" != "true" ] && [ -n "$db_container" ]; then
    echo "Isolated PostgreSQL logs at drill failure:" >&2
    docker logs "$db_container" --tail 80 >&2 || true
  fi
  [ -z "$app_container" ] || docker rm -f "$app_container" >/dev/null 2>&1 || true
  [ -z "$db_container" ] || docker rm -f "$db_container" >/dev/null 2>&1 || true
  [ -z "$network_name" ] || docker network rm "$network_name" >/dev/null 2>&1 || true
  [ -z "$volume_name" ] || docker volume rm "$volume_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

openssl enc -d -aes-256-cbc -pbkdf2 \
  -in "$BACKUP_FILE" \
  -out "$raw_file" \
  -pass "file:$BACKUP_ENCRYPTION_KEY_FILE"
openssl enc -d -aes-256-cbc -pbkdf2 \
  -in "$MANIFEST_FILE" \
  -out "$manifest_raw" \
  -pass "file:$BACKUP_ENCRYPTION_KEY_FILE"

[ "$(wc -l < "$manifest_raw")" -eq 2 ] || fail "backup manifest has an invalid format"
manifest_backup_hash=$(sed -n 's/^backup_sha256=//p' "$manifest_raw")
expected_snapshot_counts=$(sed -n 's/^row_counts=//p' "$manifest_raw")
[[ "$manifest_backup_hash" =~ ^[a-f0-9]{64}$ ]] || fail "backup manifest hash is invalid"
[[ "$expected_snapshot_counts" = \{*\} ]] || fail "backup manifest row counts are invalid"
[ "$manifest_backup_hash" = "$(sha256sum "$BACKUP_FILE" | awk '{ print $1 }')" ] \
  || fail "backup manifest is not bound to the requested encrypted dump"
docker run --rm -i "$POSTGRES_IMAGE" pg_restore --list < "$raw_file" >/dev/null

suffix="$(date -u +%Y%m%d%H%M%S)-$$-$RANDOM"
network_name="qore-dr-$suffix"
volume_name="qore-dr-$suffix"
db_container="qore-dr-db-$suffix"
app_container="qore-dr-app-$suffix"
dr_owner="qore_dr_owner"
dr_app="qore_dr_app"
dr_owner_password=$(openssl rand -hex 32)
dr_app_password=$(openssl rand -hex 32)
started_at=$(date +%s)

docker network create --internal --label qore.purpose=dr-drill "$network_name" >/dev/null
docker volume create --label qore.purpose=dr-drill "$volume_name" >/dev/null
docker run -d \
  --name "$db_container" \
  --network "$network_name" \
  --label qore.purpose=dr-drill \
  --env "POSTGRES_USER=$dr_owner" \
  --env "POSTGRES_PASSWORD=$dr_owner_password" \
  --env "POSTGRES_DB=$DB_NAME" \
  --volume "$volume_name:/var/lib/postgresql/data" \
  "$POSTGRES_IMAGE" >/dev/null

for attempt in $(seq 1 60); do
  if docker logs "$db_container" 2>&1 \
       | grep -F 'PostgreSQL init process complete; ready for start up.' >/dev/null &&
     docker exec "$db_container" pg_isready -U "$dr_owner" -d "$DB_NAME" -q; then
    break
  fi
  [ "$attempt" -lt 60 ] || fail "isolated PostgreSQL did not become ready"
  sleep 1
done

docker exec -i "$db_container" pg_restore \
  --username "$dr_owner" \
  --dbname "$DB_NAME" \
  --no-owner \
  --no-privileges \
  --exit-on-error < "$raw_file"

restored_snapshot_counts=$(docker exec -i "$db_container" psql \
  --username "$dr_owner" --dbname "$DB_NAME" --no-psqlrc \
  --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 \
  < scripts/sql/snapshot-row-counts.sql | tail -n 1)
[ "$restored_snapshot_counts" = "$expected_snapshot_counts" ] \
  || fail "restored row counts do not match the encrypted source manifest"

owner_url="postgresql://${dr_owner}:${dr_owner_password}@${db_container}:5432/${DB_NAME}?schema=public"
docker run --rm \
  --network "$network_name" \
  --label qore.purpose=dr-drill \
  --env "DATABASE_URL=$owner_url" \
  "$migrator_image"

DB_CONTAINER="$db_container" \
DB_OWNER_USER="$dr_owner" \
DB_APP_USER="$dr_app" \
DB_APP_PASSWORD="$dr_app_password" \
DB_NAME="$DB_NAME" \
QORE_EPHEMERAL_DB=true \
  bash scripts/test-db-security.sh

verified_counts=$(docker exec -i "$db_container" psql \
  --username "$dr_owner" --dbname "$DB_NAME" --no-psqlrc \
  --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 \
  < scripts/sql/verify-data-integrity.sql | tail -n 1)
[[ "$verified_counts" = \{*\} ]] || fail "integrity verification did not return row-count evidence"

runtime_psql=(docker run --rm --network "$network_name" -e "PGPASSWORD=$dr_app_password"
  "$POSTGRES_IMAGE" psql --host "$db_container" --username "$dr_app" --dbname "$DB_NAME"
  --no-psqlrc --set ON_ERROR_STOP=1)
"${runtime_psql[@]}" --command 'SELECT count(*) FROM "AuditLog"' >/dev/null \
  || fail "restored runtime role cannot read AuditLog"

stamp_probe="dr-stamp-${suffix}"
stamp_ok=$("${runtime_psql[@]}" --quiet --tuples-only --no-align --command \
  "BEGIN; INSERT INTO \"AuditLog\" (id, module, action, \"createdAt\") VALUES ('$stamp_probe', 'security', 'dr_timestamp_probe', '2000-01-01T00:00:00Z') RETURNING \"createdAt\" > now() - interval '1 minute'; ROLLBACK;")
[[ "$stamp_ok" == "t" ]] || fail "restored AuditLog does not replace client-supplied timestamps"

if "${runtime_psql[@]}" --command 'UPDATE "AuditLog" SET action = action WHERE false' >/dev/null 2>&1; then
  fail "restored runtime role can update AuditLog"
fi
if "${runtime_psql[@]}" --command 'SELECT 1 FROM _prisma_migrations LIMIT 1' >/dev/null 2>&1; then
  fail "restored runtime role can read migration history"
fi
if "${runtime_psql[@]}" --command 'CREATE TEMP TABLE forbidden(id integer)' >/dev/null 2>&1; then
  fail "restored runtime role can create temporary tables"
fi

app_url="postgresql://${dr_app}:${dr_app_password}@${db_container}:5432/${DB_NAME}?schema=public"
docker run -d \
  --name "$app_container" \
  --network "$network_name" \
  --label qore.purpose=dr-drill \
  --env "DATABASE_URL=$app_url" \
  --env "AUTH_SECRET=$AUTH_SECRET" \
  --env "RATE_LIMIT_HASH_SECRET=$RATE_LIMIT_HASH_SECRET" \
  --env "AUTH_URL=http://127.0.0.1:3000" \
  --env AUTH_TRUST_HOST=true \
  "$app_image" >/dev/null

for attempt in $(seq 1 60); do
  if docker exec "$app_container" wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 60 ]; then
    docker logs "$app_container" --tail 80 >&2 || true
    fail "candidate application did not become healthy against the restored database"
  fi
  sleep 2
done

docker exec "$app_container" node -e '
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
prisma.auditLog
  .create({ data: { module: "security", action: "dr_prisma_append_probe" } })
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
' >/dev/null || fail "candidate Prisma client cannot append audit evidence with runtime grants"

finished_at=$(date +%s)
evidence_dir="${DR_EVIDENCE_DIR:-$APP_DIR/backups/dr-evidence}"
mkdir -p "$evidence_dir"
chmod 700 "$evidence_dir"
evidence_file="$evidence_dir/dr-drill-${suffix}.json"
backup_hash=$(sha256sum "$BACKUP_FILE" | awk '{ print $1 }')
app_image_id=$(docker image inspect --format '{{.Id}}' "$app_image")
migrator_image_id=$(docker image inspect --format '{{.Id}}' "$migrator_image")
printf '{\n  "completedAt": "%s",\n  "durationSeconds": %s,\n  "backupSha256": "%s",\n  "imageTag": "%s",\n  "appImageId": "%s",\n  "migratorImageId": "%s",\n  "sourceSnapshotRowCounts": %s,\n  "rowCounts": %s,\n  "applicationHealth": "passed"\n}\n' \
  "$(date -u +%FT%TZ)" \
  "$((finished_at - started_at))" \
  "$backup_hash" \
  "$IMAGE_TAG" \
  "$app_image_id" \
  "$migrator_image_id" \
  "$expected_snapshot_counts" \
  "$verified_counts" > "$evidence_file"
chmod 600 "$evidence_file"

dr_succeeded=true
echo "Isolated restore drill passed. Evidence: $evidence_file"
