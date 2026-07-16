#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

[ "${QORE_EPHEMERAL_DB:-false}" = "true" ] || {
  echo "This destructive security integration test requires QORE_EPHEMERAL_DB=true."
  exit 1
}

DB_CONTAINER="${DB_CONTAINER:?DB_CONTAINER is required}"
DB_NAME="${DB_NAME:-qa_form_creator}"
DB_OWNER_USER="${DB_OWNER_USER:?DB_OWNER_USER is required}"
DB_APP_USER="${DB_APP_USER:-qa_app_test}"
DB_APP_PASSWORD="${DB_APP_PASSWORD:?DB_APP_PASSWORD is required}"
POSTGRES_IMAGE="postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777"

DB_CONTAINER="$DB_CONTAINER" DB_NAME="$DB_NAME" DB_OWNER_USER="$DB_OWNER_USER" \
DB_APP_USER="$DB_APP_USER" DB_APP_PASSWORD="$DB_APP_PASSWORD" \
  bash scripts/provision-db-roles.sh

owner_psql=(docker exec "$DB_CONTAINER" psql --username "$DB_OWNER_USER" --dbname "$DB_NAME"
  --no-psqlrc --set ON_ERROR_STOP=1)

# Simulate dangerous privileges/defaults left by an older deployment, then
# prove that provisioning removes them. This runs only behind the ephemeral-DB
# guard above because the PUBLIC grant is intentionally hostile test state.
"${owner_psql[@]}" --command \
  "GRANT SET ON PARAMETER session_replication_role TO PUBLIC; GRANT SET ON PARAMETER session_replication_role TO \"$DB_APP_USER\"; GRANT EXECUTE ON FUNCTION qa_validate_reference_integrity() TO PUBLIC, \"$DB_APP_USER\"; ALTER ROLE \"$DB_APP_USER\" SET statement_timeout = '1ms'; ALTER TYPE \"Role\" OWNER TO \"$DB_APP_USER\";" \
  >/dev/null
DB_CONTAINER="$DB_CONTAINER" DB_NAME="$DB_NAME" DB_OWNER_USER="$DB_OWNER_USER" \
DB_APP_USER="$DB_APP_USER" DB_APP_PASSWORD="$DB_APP_PASSWORD" \
  bash scripts/provision-db-roles.sh

read -r db_network db_host < <(docker inspect --format \
  '{{range $name, $network := .NetworkSettings.Networks}}{{$name}} {{$network.IPAddress}}{{println}}{{end}}' \
  "$DB_CONTAINER" | head -n 1)
[ -n "${db_network:-}" ] && [ -n "${db_host:-}" ] || {
  echo "Database container has no addressable Docker network."
  exit 1
}
runtime_psql=(docker run --rm --network "$db_network" -e "PGPASSWORD=$DB_APP_PASSWORD"
  "$POSTGRES_IMAGE" psql --host "$db_host" --username "$DB_APP_USER" --dbname "$DB_NAME"
  --no-psqlrc --set ON_ERROR_STOP=1)

policy_ok=$(docker exec -i "$DB_CONTAINER" psql \
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
  AND has_table_privilege(:'app_user', 'public."AuditLog"', 'SELECT')
  AND NOT has_table_privilege(:'app_user', 'public."AuditLog"', 'UPDATE')
  AND NOT has_table_privilege(:'app_user', 'public."AuditLog"', 'DELETE')
  AND NOT has_table_privilege(:'app_user', 'public."AuditLog"', 'TRUNCATE')
  AND NOT EXISTS (
    SELECT 1 FROM allowed_audit_column
    WHERE NOT has_column_privilege(
      :'app_user', 'public."AuditLog"', column_name, 'INSERT'
    )
  )
  AND NOT has_table_privilege(:'app_user', 'public._prisma_migrations', 'SELECT')
  AND NOT has_table_privilege(:'app_user', 'public._prisma_migrations', 'UPDATE')
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
    FROM pg_trigger
    WHERE tgrelid = 'public."AuditLog"'::regclass
      AND NOT tgisinternal
  )
  AND (
    SELECT count(*) = 3
    FROM pg_trigger
    WHERE tgrelid = 'public."AuditLog"'::regclass
      AND tgname IN (
        'AuditLog_stamp_created_at',
        'AuditLog_block_mutation',
        'AuditLog_block_truncate'
      )
      AND tgenabled = 'A'
      AND tgfoid = 'public.qa_protect_audit_log()'::regprocedure
  );
SQL
)
[ "$policy_ok" = "t" ] || { echo "Database security policy assertion failed."; exit 1; }

integrity_objects_ok=$(docker exec -i "$DB_CONTAINER" psql \
  --username "$DB_OWNER_USER" --dbname "$DB_NAME" --tuples-only --no-align \
  --set ON_ERROR_STOP=1 --set owner_user="$DB_OWNER_USER" \
  < "$SCRIPT_DIR/sql/verify-security-objects.sql")
[ "$integrity_objects_ok" = "t" ] || {
  echo "Cross-campaign trigger/function/index policy assertion failed."
  exit 1
}

if docker run --rm --network "$db_network" -e 'PGPASSWORD=definitely-wrong-p1-password' \
  "$POSTGRES_IMAGE" psql --host "$db_host" --username "$DB_APP_USER" --dbname "$DB_NAME" \
  --no-psqlrc --set ON_ERROR_STOP=1 --command 'SELECT 1' >/dev/null 2>&1; then
  echo "Database accepted an invalid runtime password from the application network."
  exit 1
fi

"${runtime_psql[@]}" --command 'SELECT count(*) FROM "AuditLog"' >/dev/null
runtime_probe="runtime-security-$RANDOM-$$"
"${runtime_psql[@]}" --command \
  "BEGIN; INSERT INTO \"AuditLog\" (id, module, action) VALUES ('$runtime_probe', 'security', 'ci_probe'); ROLLBACK;" \
  >/dev/null

expect_runtime_denied() {
  local label="$1"
  local sql="$2"
  if "${runtime_psql[@]}" --command "$sql" >/dev/null 2>&1; then
    echo "Runtime operation should have been denied: $label"
    exit 1
  fi
}

expect_owner_denied() {
  local label="$1"
  local sql="$2"
  if "${owner_psql[@]}" --command "$sql" >/dev/null 2>&1; then
    echo "Owner operation should have been denied: $label"
    exit 1
  fi
}

stamp_ok=$("${runtime_psql[@]}" --quiet --tuples-only --no-align --command \
  "BEGIN; INSERT INTO \"AuditLog\" (id, module, action, \"createdAt\") VALUES ('${runtime_probe}-dated', 'security', 'ci_probe', '2000-01-01T00:00:00Z') RETURNING \"createdAt\" > now() - interval '1 minute'; ROLLBACK;")
[ "$stamp_ok" = "t" ] || { echo "Audit timestamp was not stamped by PostgreSQL."; exit 1; }
expect_runtime_denied "audit update" 'UPDATE "AuditLog" SET action = action WHERE false'
expect_runtime_denied "audit delete" 'DELETE FROM "AuditLog" WHERE false'
expect_runtime_denied "audit truncate" 'TRUNCATE TABLE "AuditLog"'
expect_runtime_denied "disable database triggers" 'SET session_replication_role = replica'
expect_runtime_denied "migration history read" 'SELECT 1 FROM _prisma_migrations LIMIT 1'
expect_runtime_denied "persistent DDL" 'CREATE TABLE public.runtime_forbidden(id integer)'
expect_runtime_denied "temporary DDL" 'CREATE TEMPORARY TABLE runtime_forbidden(id integer)'

fixture="security-$RANDOM-$$"
fixture_email="${fixture}@example.invalid"
"${owner_psql[@]}" --command \
  "INSERT INTO \"User\" (id, email, name, role, active, \"updatedAt\") VALUES ('${fixture}-user', '$fixture_email', 'Security Fixture', 'QA', true, now()); INSERT INTO \"Campaign\" (id, name, \"updatedAt\") VALUES ('${fixture}-campaign', '$fixture', now()); INSERT INTO \"AuditLog\" (id, \"userId\", \"campaignId\", module, action) VALUES ('${fixture}-audit', '${fixture}-user', '${fixture}-campaign', 'security', 'ci_fixture');" \
  >/dev/null

expect_runtime_denied "delete an audited actor" \
  "DELETE FROM \"User\" WHERE id = '${fixture}-user'"
expect_runtime_denied "delete an audited campaign" \
  "DELETE FROM \"Campaign\" WHERE id = '${fixture}-campaign'"
expect_owner_denied "mutate audit without maintenance marker" \
  "UPDATE \"AuditLog\" SET action = 'forbidden' WHERE id = '${fixture}-audit'"
expect_owner_denied "truncate audit without maintenance marker" 'TRUNCATE TABLE "AuditLog"'

"${owner_psql[@]}" --command 'CREATE TABLE public."SecurityFutureTable" (id integer)' >/dev/null
expect_runtime_denied "access a newly migrated table before allowlisting" \
  'SELECT * FROM public."SecurityFutureTable"'
"${owner_psql[@]}" --command 'DROP TABLE public."SecurityFutureTable"' >/dev/null

"${owner_psql[@]}" --command \
  "BEGIN; SET LOCAL qore.audit_maintenance = 'enabled'; UPDATE \"AuditLog\" SET action = 'maintenance_verified' WHERE id = '${fixture}-audit'; DELETE FROM \"AuditLog\" WHERE id = '${fixture}-audit'; COMMIT; DELETE FROM \"User\" WHERE id = '${fixture}-user'; DELETE FROM \"Campaign\" WHERE id = '${fixture}-campaign';" \
  >/dev/null

echo "Database runtime isolation and append-only audit integration tests passed."
