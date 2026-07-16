#!/bin/bash
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-qa_form_creator_db}"
DB_NAME="${DB_NAME:-qa_form_creator}"
DB_OWNER_USER="${DB_OWNER_USER:?DB_OWNER_USER is required}"
DB_APP_USER="${DB_APP_USER:-qa_app}"
DB_APP_PASSWORD="${DB_APP_PASSWORD:?DB_APP_PASSWORD is required}"

if [[ ! "$DB_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] ||
   [[ ! "$DB_OWNER_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] ||
   [[ ! "$DB_APP_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
  echo "Database and role names may contain only letters, digits, and underscores."
  exit 1
fi
if [ "$DB_OWNER_USER" = "$DB_APP_USER" ]; then
  echo "DB_APP_USER must be different from DB_OWNER_USER."
  exit 1
fi
if [[ ! "$DB_APP_PASSWORD" =~ ^[a-fA-F0-9]{64}$ ]]; then
  echo "DB_APP_PASSWORD must be exactly 64 hexadecimal characters (openssl rand -hex 32)."
  exit 1
fi

{
  cat <<'SQL'
BEGIN;

SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'app_user'
)
\gexec
SELECT format('ALTER ROLE %I RESET ALL', :'app_user')
\gexec

-- Remove inherited privilege paths and normalize any ownership left by an
-- older deployment before applying the closed runtime allowlist.
SELECT format('REVOKE %I FROM %I', parent.rolname, member_role.rolname)
FROM pg_auth_members membership
JOIN pg_roles parent ON parent.oid = membership.roleid
JOIN pg_roles member_role ON member_role.oid = membership.member
WHERE member_role.rolname = :'app_user'
\gexec
SELECT format('REASSIGN OWNED BY %I TO %I', :'app_user', :'owner_user')
\gexec

SELECT format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', :'db_name')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I', :'db_name', :'app_user')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db_name', :'app_user')
\gexec

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I', :'app_user')
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_user')
\gexec

SELECT format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', :'app_user')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', :'app_user')
\gexec
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;

-- A delegated SET on session_replication_role disables ordinary triggers.
-- Remove direct and PUBLIC grants so legacy ACLs cannot bypass audit or
-- cross-campaign integrity controls. Remove any other parameter ACL granted
-- directly to the runtime role as part of the same closed-role reset.
SELECT format(
  'REVOKE ALL PRIVILEGES ON PARAMETER %I FROM %I',
  parameter_acl.parname,
  :'app_user'
)
FROM pg_parameter_acl parameter_acl
WHERE EXISTS (
  SELECT 1
  FROM aclexplode(COALESCE(parameter_acl.paracl, '{}'::aclitem[])) privilege
  WHERE privilege.grantee = (SELECT oid FROM pg_roles WHERE rolname = :'app_user')
)
\gexec
REVOKE ALL PRIVILEGES ON PARAMETER session_replication_role FROM PUBLIC;
SELECT format(
  'REVOKE ALL PRIVILEGES ON PARAMETER session_replication_role FROM %I',
  :'app_user'
)
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM %I',
  :'owner_user',
  :'app_user'
)
\gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC',
  :'owner_user'
)
\gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
  :'owner_user',
  :'app_user'
)
\gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC',
  :'owner_user'
)
\gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
  :'owner_user'
)
\gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I',
  :'owner_user',
  :'app_user'
)
\gexec

-- Public functions are also closed by default. Only the two SECURITY INVOKER
-- rate-limit entrypoints are callable by the web role.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
SELECT format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I', :'app_user')
\gexec

DO $$
DECLARE
  unexpected_functions text;
BEGIN
  SELECT string_agg(function_object.proname, ', ' ORDER BY function_object.proname)
  INTO unexpected_functions
  FROM pg_proc function_object
  JOIN pg_namespace function_schema ON function_schema.oid = function_object.pronamespace
  WHERE function_schema.nspname = 'public'
    AND function_object.proname NOT IN (
      'qa_protect_audit_log',
      'qa_validate_reference_integrity',
      'qa_reserve_login_attempt',
      'qa_complete_login_attempt'
    );

  IF unexpected_functions IS NOT NULL THEN
    RAISE EXCEPTION 'New public functions require an explicit runtime access decision: %',
      unexpected_functions;
  END IF;
END $$;

SELECT format(
  'GRANT EXECUTE ON FUNCTION public.qa_reserve_login_attempt(text, text, uuid, timestamp without time zone) TO %I',
  :'app_user'
)
\gexec
SELECT format(
  'GRANT EXECUTE ON FUNCTION public.qa_complete_login_attempt(uuid, text, timestamp without time zone) TO %I',
  :'app_user'
)
\gexec

-- A newly migrated table remains inaccessible until it is deliberately added
-- here. That makes schema changes fail closed instead of silently expanding
-- the web process's authority.
DO $$
DECLARE
  missing_tables text;
  unexpected_tables text;
BEGIN
  SELECT string_agg(expected.table_name, ', ' ORDER BY expected.table_name)
  INTO missing_tables
  FROM (
    VALUES
      ('Account'), ('Session'), ('VerificationToken'), ('User'), ('Campaign'),
      ('UserCampaign'), ('Team'), ('DispositionCategory'), ('Disposition'),
      ('Agent'), ('Form'), ('Question'), ('QACategory'), ('FormCategory'),
      ('Response'), ('Answer'), ('AppSetting'), ('CampaignScoringSettings'),
      ('LoginRateLimit'), ('LoginRateLimitReservation'),
      ('Notification'), ('NotificationPreference'), ('AuditLog')
  ) AS expected(table_name)
  LEFT JOIN pg_class table_object
    ON table_object.relname = expected.table_name
   AND table_object.relnamespace = 'public'::regnamespace
   AND table_object.relkind IN ('r', 'p')
  WHERE table_object.oid IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Runtime allowlist references missing tables: %', missing_tables;
  END IF;

  SELECT string_agg(table_object.relname, ', ' ORDER BY table_object.relname)
  INTO unexpected_tables
  FROM pg_class table_object
  JOIN pg_namespace namespace_object ON namespace_object.oid = table_object.relnamespace
  WHERE namespace_object.nspname = 'public'
    AND table_object.relkind IN ('r', 'p')
    AND table_object.relname <> '_prisma_migrations'
    AND table_object.relname NOT IN (
      'Account', 'Session', 'VerificationToken', 'User', 'Campaign',
      'UserCampaign', 'Team', 'DispositionCategory', 'Disposition',
      'Agent', 'Form', 'Question', 'QACategory', 'FormCategory',
      'Response', 'Answer', 'AppSetting', 'CampaignScoringSettings',
      'LoginRateLimit', 'LoginRateLimitReservation',
      'Notification', 'NotificationPreference', 'AuditLog'
    );

  IF unexpected_tables IS NOT NULL THEN
    RAISE EXCEPTION 'New application tables require an explicit runtime access decision: %', unexpected_tables;
  END IF;
END $$;

SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO %I',
  allowed.table_name,
  :'app_user'
)
FROM (
  VALUES
    ('Account'), ('Session'), ('VerificationToken'), ('User'), ('Campaign'),
    ('UserCampaign'), ('Team'), ('DispositionCategory'), ('Disposition'),
    ('Agent'), ('Form'), ('Question'), ('QACategory'), ('FormCategory'),
    ('Response'), ('Answer'), ('AppSetting'), ('CampaignScoringSettings'),
    ('LoginRateLimit'), ('Notification'), ('NotificationPreference')
) AS allowed(table_name)
\gexec

-- Reservations are immutable admission tokens. The runtime can create, read,
-- and consume them, but cannot rewrite one into a different account or IP.
SELECT format(
  'GRANT SELECT, INSERT, DELETE ON TABLE public."LoginRateLimitReservation" TO %I',
  :'app_user'
)
\gexec

-- Audit rows can be read and appended. The insert trigger overwrites createdAt
-- with database time so a compromised runtime cannot backdate evidence.
REVOKE ALL PRIVILEGES ON TABLE "AuditLog" FROM PUBLIC;
SELECT format('GRANT SELECT ON TABLE public."AuditLog" TO %I', :'app_user')
\gexec
SELECT format(
  'GRANT INSERT ("id", "userId", "campaignId", "module", "action", "entityType", "entityId", "beforeValue", "afterValue", "impact", "createdAt") ON TABLE public."AuditLog" TO %I',
  :'app_user'
)
\gexec

-- Prisma migration state is migrator-only evidence.
SELECT format('REVOKE ALL PRIVILEGES ON TABLE public._prisma_migrations FROM %I', :'app_user')
WHERE to_regclass('public._prisma_migrations') IS NOT NULL
\gexec

DO $$
DECLARE
  unexpected_sequences text;
BEGIN
  SELECT string_agg(sequencename, ', ' ORDER BY sequencename)
  INTO unexpected_sequences
  FROM pg_sequences
  WHERE schemaname = 'public';

  IF unexpected_sequences IS NOT NULL THEN
    RAISE EXCEPTION 'New sequences require an explicit runtime access decision: %', unexpected_sequences;
  END IF;
END $$;

COMMIT;
SQL
} | docker exec -i "$DB_CONTAINER" psql \
  --username "$DB_OWNER_USER" \
  --dbname "$DB_NAME" \
  --set ON_ERROR_STOP=1 \
  --set app_user="$DB_APP_USER" \
  --set owner_user="$DB_OWNER_USER" \
  --set db_name="$DB_NAME"

password_encryption=$(docker exec "$DB_CONTAINER" psql \
  --username "$DB_OWNER_USER" --dbname "$DB_NAME" --tuples-only --no-align \
  --set ON_ERROR_STOP=1 --command "SHOW password_encryption")
[ "$password_encryption" = "scram-sha-256" ] || {
  echo "PostgreSQL password_encryption must be scram-sha-256."
  exit 1
}

# psql's \password hashes client-side, so cleartext is not sent in an ALTER
# ROLE statement that could be captured by PostgreSQL statement logs.
printf '%s\n%s\n' "$DB_APP_PASSWORD" "$DB_APP_PASSWORD" | \
  docker exec -i "$DB_CONTAINER" psql \
    --username "$DB_OWNER_USER" --dbname "$DB_NAME" --set ON_ERROR_STOP=1 \
    --command "\\password $DB_APP_USER"

echo "Runtime role '$DB_APP_USER' provisioned from a closed allowlist; AuditLog is append-only and migration state is owner-only."
