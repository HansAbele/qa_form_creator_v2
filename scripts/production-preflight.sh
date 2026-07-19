#!/bin/bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/backup-key.sh
source "$SCRIPT_DIR/lib/backup-key.sh"
# shellcheck source=scripts/lib/secure-file.sh
source "$SCRIPT_DIR/lib/secure-file.sh"

fail() {
  echo "PREFLIGHT FAILED: $*" >&2
  exit 1
}

remote_probe=""
cleanup() {
  if [ -n "$remote_probe" ] && command -v rclone >/dev/null 2>&1; then
    rclone deletefile "$remote_probe" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [ "$#" -ne 1 ] || { [ "$1" != "--offline" ] && [ "$1" != "--online" ]; }; then
  echo "Usage: $0 --offline|--online" >&2
  exit 1
fi
MODE="$1"

APP_DIR="${APP_DIR:-/opt/qa-form-creator}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
DB_CONTAINER="${DB_CONTAINER:-qa_form_creator_db}"
DB_NAME="${DB_NAME:-qa_form_creator}"
MIN_FREE_DISK_MB="${MIN_FREE_DISK_MB:-2048}"
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

require_env() {
  local name="$1"
  [ -n "${!name:-}" ] || fail "missing required environment variable: $name"
}

for name in \
  DB_OWNER_USER DB_OWNER_PASSWORD DB_APP_USER DB_APP_PASSWORD AUTH_SECRET \
  RATE_LIMIT_HASH_SECRET AUTH_URL OPERATIONAL_TIME_ZONE ERROR_REPORTING_WEBHOOK_URL \
  ERROR_REPORTING_WEBHOOK_TOKEN BACKUP_ENCRYPTION_KEY_FILE BACKUP_REMOTE \
  SECRET_ROTATION_CONFIRMED SECRET_HISTORY_REMEDIATED; do
  require_env "$name"
done

[[ "$DB_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || fail "unsafe DB_NAME"
[[ "$DB_OWNER_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || fail "unsafe DB_OWNER_USER"
[[ "$DB_APP_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || fail "unsafe DB_APP_USER"
[ "$DB_OWNER_USER" != "$DB_APP_USER" ] || fail "database owner and runtime role must differ"
for secret_name in DB_OWNER_PASSWORD DB_APP_PASSWORD AUTH_SECRET RATE_LIMIT_HASH_SECRET; do
  [[ "${!secret_name}" =~ ^[a-fA-F0-9]{64}$ ]] \
    || fail "$secret_name must be exactly 64 hexadecimal characters (openssl rand -hex 32)"
done
[ "$DB_OWNER_PASSWORD" != "$DB_APP_PASSWORD" ] \
  && [ "$DB_OWNER_PASSWORD" != "$AUTH_SECRET" ] \
  && [ "$DB_OWNER_PASSWORD" != "$RATE_LIMIT_HASH_SECRET" ] \
  && [ "$DB_APP_PASSWORD" != "$AUTH_SECRET" ] \
  && [ "$DB_APP_PASSWORD" != "$RATE_LIMIT_HASH_SECRET" ] \
  && [ "$AUTH_SECRET" != "$RATE_LIMIT_HASH_SECRET" ] \
  || fail "all database and application secrets must be distinct"
[[ "$AUTH_URL" = https://* ]] || fail "AUTH_URL must use HTTPS"
[ "$AUTH_URL" != "https://CHANGE_ME.example" ] || fail "AUTH_URL is still a placeholder"
[[ "$ERROR_REPORTING_WEBHOOK_URL" = https://* ]] \
  || fail "ERROR_REPORTING_WEBHOOK_URL must use HTTPS"
[[ "$ERROR_REPORTING_WEBHOOK_URL" != *CHANGE_ME* ]] \
  || fail "ERROR_REPORTING_WEBHOOK_URL is still a placeholder"
[ "${#ERROR_REPORTING_WEBHOOK_TOKEN}" -ge 32 ] \
  || fail "ERROR_REPORTING_WEBHOOK_TOKEN must contain at least 32 characters"
[[ "$ERROR_REPORTING_WEBHOOK_TOKEN" != CHANGE_ME* ]] \
  || fail "ERROR_REPORTING_WEBHOOK_TOKEN is still a placeholder"
[[ "$OPERATIONAL_TIME_ZONE" != *".."* ]] \
  && [[ "$OPERATIONAL_TIME_ZONE" =~ ^[A-Za-z][A-Za-z0-9._+-]*(/[A-Za-z0-9][A-Za-z0-9._+-]*)*$ ]] \
  && [ -f "/usr/share/zoneinfo/$OPERATIONAL_TIME_ZONE" ] \
  || fail "OPERATIONAL_TIME_ZONE must be a valid IANA time zone"

validate_export_limit() {
  local name="$1" minimum="$2" maximum="$3" fallback="$4" value
  value="${!name:-$fallback}"
  [[ "$value" =~ ^[0-9]+$ ]] \
    && [ "$value" -ge "$minimum" ] \
    && [ "$value" -le "$maximum" ] \
    || fail "$name must be an integer between $minimum and $maximum"
}

validate_export_limit EXPORT_MAX_EVALUATIONS 1 2500 1000
validate_export_limit EXPORT_MAX_ANSWER_ROWS 1 25000 10000
validate_export_limit EXPORT_MAX_QUESTION_COLUMNS 1 200 100
validate_export_limit EXPORT_MAX_CELLS 1 250000 100000
validate_export_limit EXPORT_MAX_TEXT_BYTES 1 16000000 8000000
validate_export_limit EXPORT_MAX_REQUESTS_PER_MINUTE 1 60 4
validate_export_limit EXPORT_MAX_CONCURRENT_PER_USER 1 2 1
validate_export_limit EXPORT_MAX_CONCURRENT_GLOBAL 1 4 2
validate_export_limit EXPORT_LEASE_TIMEOUT_SECONDS 60 3600 900
[[ "$BACKUP_REMOTE" != CHANGE_ME* ]] || fail "BACKUP_REMOTE is still a placeholder"
[[ "$BACKUP_REMOTE" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*:.+ ]] \
  || fail "BACKUP_REMOTE must be a configured rclone remote, not a local path"
[ "${REQUIRE_OFFSITE_BACKUP:-true}" = "true" ] || fail "REQUIRE_OFFSITE_BACKUP must be true in production"
[ "$SECRET_ROTATION_CONFIRMED" = "true" ] || fail "secret rotation/revocation has not been attested"
[ "$SECRET_HISTORY_REMEDIATED" = "true" ] || fail "repository history remediation has not been attested"

validate_secure_operator_file "$BACKUP_ENCRYPTION_KEY_FILE" "backup encryption key" \
  || fail "backup key file security validation failed"
validate_backup_key_material "$BACKUP_ENCRYPTION_KEY_FILE" \
  || fail "backup key is not stable single-line Base64 key material"

for command_name in docker git flock openssl rclone sha256sum stat tar; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command is unavailable: $command_name"
done
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is unavailable"

[[ "$MIN_FREE_DISK_MB" =~ ^[0-9]+$ ]] || fail "MIN_FREE_DISK_MB must be numeric"
available_kb=$(df -Pk "$APP_DIR" | awk 'NR == 2 { print $4 }')
[ -n "$available_kb" ] || fail "could not determine free disk space"
[ "$available_kb" -ge "$((MIN_FREE_DISK_MB * 1024))" ] || fail "less than ${MIN_FREE_DISK_MB} MiB is free"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "APP_DIR is not a Git worktree"
[ -z "$(git status --porcelain --untracked-files=all)" ] \
  || fail "production worktree contains tracked changes or untracked files"
bash scripts/verify-repository-secrets.sh \
  || fail "repository secret/history gate did not pass"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_PATH" config --quiet \
  || fail "production Compose configuration is invalid"
remote_name="${BACKUP_REMOTE%%:*}"
remote_metadata=$(rclone listremotes --json --name "$remote_name" --exact) \
  || fail "could not inspect the configured backup remote"
printf '%s' "$remote_metadata" | grep -Eq '"name"[[:space:]]*:[[:space:]]*"' \
  || fail "BACKUP_REMOTE does not reference a configured rclone remote"
if printf '%s' "$remote_metadata" \
  | grep -Eq '"type"[[:space:]]*:[[:space:]]*"(local|alias)"'; then
  fail "BACKUP_REMOTE cannot use rclone's local or alias backend"
fi

probe_value=$(openssl rand -hex 32)
probe_hash=$(printf '%s' "$probe_value" | sha256sum | awk '{ print $1 }')
remote_probe="${BACKUP_REMOTE%/}/.qore-preflight-$(date +%s)-$$-$RANDOM"
printf '%s' "$probe_value" | rclone rcat "$remote_probe" \
  || fail "off-site backup destination is not writable"
downloaded_probe_hash=$(rclone cat "$remote_probe" | sha256sum | awk '{ print $1 }')
[ "$downloaded_probe_hash" = "$probe_hash" ] \
  || fail "off-site backup destination failed write/read verification"
rclone deletefile "$remote_probe" \
  || fail "off-site backup destination failed cleanup verification"
remote_probe=""

if [ "$MODE" = "--offline" ]; then
  echo "Production offline preflight passed for commit $(git rev-parse --short=12 HEAD)."
  exit 0
fi

docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || fail "database container is unavailable"
docker exec "$DB_CONTAINER" pg_isready -U "$DB_OWNER_USER" -d "$DB_NAME" -q \
  || fail "database is not ready"

read -r db_network db_host < <(docker inspect --format \
  '{{range $name, $network := .NetworkSettings.Networks}}{{$name}} {{$network.IPAddress}}{{println}}{{end}}' \
  "$DB_CONTAINER" | head -n 1)
[ -n "${db_network:-}" ] && [ -n "${db_host:-}" ] \
  || fail "database container has no addressable Docker network"

server_version=$(docker exec "$DB_CONTAINER" psql \
  --username "$DB_OWNER_USER" --dbname "$DB_NAME" --tuples-only --no-align \
  --set ON_ERROR_STOP=1 --command "SHOW server_version_num")
[[ "$server_version" =~ ^16[0-9]{4}$ ]] || fail "PostgreSQL 16 is required; server reported $server_version"

role_policy_ok=$(docker exec -i "$DB_CONTAINER" psql \
  --username "$DB_OWNER_USER" --dbname "$DB_NAME" --tuples-only --no-align \
  --set ON_ERROR_STOP=1 --set app_user="$DB_APP_USER" --set owner_user="$DB_OWNER_USER" \
  --set db_name="$DB_NAME" <<'SQL'
WITH runtime_role AS (
  SELECT * FROM pg_roles WHERE rolname = :'app_user'
), allowed_audit_column(column_name) AS (
  VALUES
    ('id'), ('userId'), ('campaignId'), ('module'), ('action'),
    ('entityType'), ('entityId'), ('beforeValue'), ('afterValue'), ('impact'),
    ('createdAt')
), application_table(table_name) AS (
  VALUES
    ('Account'), ('Session'), ('VerificationToken'), ('User'), ('Campaign'),
    ('UserCampaign'), ('Team'), ('DispositionCategory'), ('Disposition'),
    ('Agent'), ('Form'), ('Question'), ('QACategory'), ('FormCategory'),
    ('Response'), ('Answer'), ('AppSetting'), ('CampaignScoringSettings'),
    ('LoginRateLimit')
)
SELECT
  EXISTS (
    SELECT 1 FROM runtime_role
    WHERE rolcanlogin
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls
      AND rolconfig IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_auth_members membership
    JOIN pg_roles member_role ON member_role.oid = membership.member
    WHERE member_role.rolname = :'app_user'
  )
  AND has_database_privilege(:'app_user', :'db_name', 'CONNECT')
  AND NOT has_database_privilege(:'app_user', :'db_name', 'CREATE')
  AND NOT has_database_privilege(:'app_user', :'db_name', 'TEMPORARY')
  AND has_schema_privilege(:'app_user', 'public', 'USAGE')
  AND NOT has_schema_privilege(:'app_user', 'public', 'CREATE')
  AND NOT has_parameter_privilege(:'app_user', 'session_replication_role', 'SET')
  AND NOT has_parameter_privilege(:'app_user', 'session_replication_role', 'ALTER SYSTEM')
  AND current_setting('password_encryption') = 'scram-sha-256'
  AND (
    SELECT rolpassword LIKE 'SCRAM-SHA-256$%'
    FROM pg_authid
    WHERE rolname = :'app_user'
  )
  AND (
    SELECT rolpassword LIKE 'SCRAM-SHA-256$%'
    FROM pg_authid
    WHERE rolname = :'owner_user'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_hba_file_rules
    WHERE error IS NOT NULL
       OR (
         type LIKE 'host%'
         AND auth_method NOT IN ('scram-sha-256', 'cert', 'reject')
         AND COALESCE(address, '') NOT IN ('127.0.0.1', '::1')
       )
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relowner = (SELECT oid FROM runtime_role)
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proowner = (SELECT oid FROM runtime_role)
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspowner = (SELECT oid FROM runtime_role)
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datdba = (SELECT oid FROM runtime_role)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_shdepend ownership_dependency
    WHERE ownership_dependency.refclassid = 'pg_authid'::regclass
      AND ownership_dependency.refobjid = (SELECT oid FROM runtime_role)
      AND ownership_dependency.deptype = 'o'
      AND (
        ownership_dependency.dbid = 0
        OR ownership_dependency.dbid = (
          SELECT oid FROM pg_database WHERE datname = current_database()
        )
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM application_table
    WHERE NOT has_table_privilege(:'app_user', format('public.%I', table_name), 'SELECT')
       OR NOT has_table_privilege(:'app_user', format('public.%I', table_name), 'INSERT')
       OR NOT has_table_privilege(:'app_user', format('public.%I', table_name), 'UPDATE')
       OR NOT has_table_privilege(:'app_user', format('public.%I', table_name), 'DELETE')
  )
  AND has_table_privilege(:'app_user', 'public."AuditLog"', 'SELECT')
  AND NOT has_table_privilege(:'app_user', 'public."AuditLog"', 'UPDATE')
  AND NOT has_table_privilege(:'app_user', 'public."AuditLog"', 'DELETE')
  AND NOT has_table_privilege(:'app_user', 'public."AuditLog"', 'TRUNCATE')
  AND NOT has_table_privilege(:'app_user', 'public."AuditLog"', 'REFERENCES')
  AND NOT has_table_privilege(:'app_user', 'public."AuditLog"', 'TRIGGER')
  AND NOT EXISTS (
    SELECT 1 FROM allowed_audit_column
    WHERE NOT has_column_privilege(
      :'app_user', 'public."AuditLog"', column_name, 'INSERT'
    )
  )
  AND NOT has_table_privilege(:'app_user', 'public._prisma_migrations', 'SELECT')
  AND NOT has_table_privilege(:'app_user', 'public._prisma_migrations', 'INSERT')
  AND NOT has_table_privilege(:'app_user', 'public._prisma_migrations', 'UPDATE')
  AND NOT has_table_privilege(:'app_user', 'public._prisma_migrations', 'DELETE')
  AND NOT has_table_privilege(:'app_user', 'public._prisma_migrations', 'TRUNCATE')
  AND has_table_privilege(:'app_user', 'public."LoginRateLimitReservation"', 'SELECT')
  AND has_table_privilege(:'app_user', 'public."LoginRateLimitReservation"', 'INSERT')
  AND has_table_privilege(:'app_user', 'public."LoginRateLimitReservation"', 'DELETE')
  AND NOT has_table_privilege(:'app_user', 'public."LoginRateLimitReservation"', 'UPDATE')
  AND NOT has_table_privilege(:'app_user', 'public."LoginRateLimitReservation"', 'TRUNCATE')
  AND NOT has_table_privilege(:'app_user', 'public."LoginRateLimitReservation"', 'REFERENCES')
  AND NOT has_table_privilege(:'app_user', 'public."LoginRateLimitReservation"', 'TRIGGER')
  AND has_function_privilege(
    :'app_user',
    'public.qa_reserve_login_attempt(text,text,uuid,timestamp without time zone)'::regprocedure,
    'EXECUTE'
  )
  AND has_function_privilege(
    :'app_user',
    'public.qa_complete_login_attempt(uuid,text,timestamp without time zone)'::regprocedure,
    'EXECUTE'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_proc function_object
    JOIN pg_namespace function_schema ON function_schema.oid = function_object.pronamespace
    WHERE function_schema.nspname = 'public'
      AND function_object.proname NOT IN (
        'qa_reserve_login_attempt',
        'qa_complete_login_attempt'
      )
      AND has_function_privilege(:'app_user', function_object.oid, 'EXECUTE')
  )
  AND (
    SELECT count(*) = 2
    FROM pg_constraint constraint_object
    WHERE constraint_object.conrelid = 'public."AuditLog"'::regclass
      AND constraint_object.contype = 'f'
      AND constraint_object.convalidated
      AND constraint_object.confupdtype = 'r'
      AND constraint_object.confdeltype = 'r'
      AND (
        (
          constraint_object.conname = 'AuditLog_userId_fkey'
          AND constraint_object.confrelid = 'public."User"'::regclass
          AND (
            SELECT array_agg(attribute.attname::text ORDER BY key_column.ordinality)
            FROM unnest(constraint_object.conkey) WITH ORDINALITY key_column(attnum, ordinality)
            JOIN pg_attribute attribute
              ON attribute.attrelid = constraint_object.conrelid
             AND attribute.attnum = key_column.attnum
          ) = ARRAY['userId']
        )
        OR (
          constraint_object.conname = 'AuditLog_campaignId_fkey'
          AND constraint_object.confrelid = 'public."Campaign"'::regclass
          AND (
            SELECT array_agg(attribute.attname::text ORDER BY key_column.ordinality)
            FROM unnest(constraint_object.conkey) WITH ORDINALITY key_column(attnum, ordinality)
            JOIN pg_attribute attribute
              ON attribute.attrelid = constraint_object.conrelid
             AND attribute.attnum = key_column.attnum
          ) = ARRAY['campaignId']
        )
      )
      AND (
        SELECT array_agg(attribute.attname::text ORDER BY key_column.ordinality)
        FROM unnest(constraint_object.confkey) WITH ORDINALITY key_column(attnum, ordinality)
        JOIN pg_attribute attribute
          ON attribute.attrelid = constraint_object.confrelid
         AND attribute.attnum = key_column.attnum
      ) = ARRAY['id']
  )
  AND (
    SELECT md5(prosrc) = '763b104c6ad98daa25a9df0845fb1d96'
      AND proconfig = ARRAY['search_path=pg_catalog']
      AND NOT prosecdef
      AND provolatile = 'v'
      AND NOT proleakproof
      AND pronargs = 0
      AND prorettype = 'trigger'::regtype
      AND proowner = (SELECT oid FROM pg_roles WHERE rolname = :'owner_user')
    FROM pg_proc
    WHERE oid = 'public.qa_protect_audit_log()'::regprocedure
  )
  AND (
    SELECT count(*) = 3
    FROM pg_trigger trigger_object
    WHERE trigger_object.tgrelid = 'public."AuditLog"'::regclass
      AND NOT trigger_object.tgisinternal
  )
  AND (
    SELECT count(*) = 3
    FROM pg_trigger trigger_object
    WHERE trigger_object.tgrelid = 'public."AuditLog"'::regclass
      AND trigger_object.tgname IN (
        'AuditLog_stamp_created_at',
        'AuditLog_block_mutation',
        'AuditLog_block_truncate'
      )
      AND trigger_object.tgenabled = 'A'
      AND trigger_object.tgfoid = 'public.qa_protect_audit_log()'::regprocedure
  );
SQL
)
[ "$role_policy_ok" = "t" ] || fail "runtime role, audit trigger, or migration-table policy is invalid"

integrity_objects_ok=$(docker exec -i "$DB_CONTAINER" psql \
  --username "$DB_OWNER_USER" --dbname "$DB_NAME" --tuples-only --no-align \
  --set ON_ERROR_STOP=1 --set owner_user="$DB_OWNER_USER" \
  < "$SCRIPT_DIR/sql/verify-security-objects.sql")
[ "$integrity_objects_ok" = "t" ] \
  || fail "cross-campaign trigger/function/index policy is invalid"

runtime_psql=(docker run --rm --network "$db_network" -e "PGPASSWORD=$DB_APP_PASSWORD"
  "$POSTGRES_IMAGE" psql --host "$db_host" --username "$DB_APP_USER" --dbname "$DB_NAME"
  --no-psqlrc --set ON_ERROR_STOP=1)

if ! docker run --rm --network "$db_network" -e "PGPASSWORD=$DB_OWNER_PASSWORD" \
  "$POSTGRES_IMAGE" psql --host "$db_host" --username "$DB_OWNER_USER" --dbname "$DB_NAME" \
  --no-psqlrc --set ON_ERROR_STOP=1 --command 'SELECT 1' >/dev/null 2>&1; then
  fail "database owner cannot authenticate with SCRAM from the application network"
fi
if docker run --rm --network "$db_network" -e 'PGPASSWORD=definitely-wrong-p1-password' \
  "$POSTGRES_IMAGE" psql --host "$db_host" --username "$DB_APP_USER" --dbname "$DB_NAME" \
  --no-psqlrc --set ON_ERROR_STOP=1 --command 'SELECT 1' >/dev/null 2>&1; then
  fail "database accepted an invalid runtime password from the application network"
fi

"${runtime_psql[@]}" --command 'SELECT count(*) FROM "AuditLog"' >/dev/null \
  || fail "runtime role cannot perform its allowed audit read"
smoke_id="preflight-$(date +%s)-$$"
"${runtime_psql[@]}" --command "BEGIN; INSERT INTO \"AuditLog\" (id, module, action) VALUES ('$smoke_id', 'security', 'preflight'); ROLLBACK;" >/dev/null \
  || fail "runtime role cannot append audit evidence"

expect_runtime_denied() {
  local description="$1"
  local sql="$2"
  if "${runtime_psql[@]}" --command "$sql" >/dev/null 2>&1; then
    fail "runtime role unexpectedly succeeded: $description"
  fi
}

stamp_ok=$("${runtime_psql[@]}" --quiet --tuples-only --no-align --command \
  "BEGIN; INSERT INTO \"AuditLog\" (id, module, action, \"createdAt\") VALUES ('${smoke_id}-dated', 'security', 'preflight', '2000-01-01T00:00:00Z') RETURNING \"createdAt\" > now() - interval '1 minute'; ROLLBACK;")
[ "$stamp_ok" = "t" ] || fail "AuditLog insert trigger did not replace a client-supplied timestamp"
expect_runtime_denied "update AuditLog" 'UPDATE "AuditLog" SET action = action WHERE false'
expect_runtime_denied "delete AuditLog" 'DELETE FROM "AuditLog" WHERE false'
expect_runtime_denied "truncate AuditLog" 'TRUNCATE TABLE "AuditLog"'
expect_runtime_denied "disable database triggers" 'SET session_replication_role = replica'
expect_runtime_denied "read Prisma migration history" 'SELECT 1 FROM _prisma_migrations LIMIT 1'
expect_runtime_denied "create a persistent table" 'CREATE TABLE public.preflight_forbidden(id integer)'
expect_runtime_denied "create a temporary table" 'CREATE TEMPORARY TABLE preflight_forbidden(id integer)'

owner_probe_id="owner-preflight-$(date +%s)-$$"
if docker exec "$DB_CONTAINER" psql \
  --username "$DB_OWNER_USER" --dbname "$DB_NAME" --no-psqlrc --set ON_ERROR_STOP=1 \
  --command "BEGIN; INSERT INTO \"AuditLog\" (id, module, action) VALUES ('$owner_probe_id', 'security', 'preflight'); UPDATE \"AuditLog\" SET action = 'forbidden' WHERE id = '$owner_probe_id'; ROLLBACK;" \
  >/dev/null 2>&1; then
  fail "AuditLog trigger allowed owner mutation without an approved maintenance transaction"
fi

docker exec -i "$DB_CONTAINER" psql \
  --username "$DB_OWNER_USER" --dbname "$DB_NAME" --no-psqlrc \
  --set ON_ERROR_STOP=1 < scripts/sql/verify-data-integrity.sql

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_PATH" --profile tools run \
  --rm --no-deps migrator pnpm exec prisma migrate status --schema /app/prisma/schema.prisma

echo "Production online preflight passed: migrations, integrity, role isolation, and append-only audit controls are active."
