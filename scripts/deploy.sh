#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/secure-file.sh
source "$SCRIPT_DIR/lib/secure-file.sh"

APP_DIR="${APP_DIR:-/opt/qa-form-creator}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
DB_NAME="${DB_NAME:-qa_form_creator}"
DB_CONTAINER="${DB_CONTAINER:-qa_form_creator_db}"

cd "$APP_DIR"
umask 077

LOCK_FILE="${QORE_LOCK_FILE:-$APP_DIR/.qore-operations.lock}"
exec 9>"$LOCK_FILE"
flock -n 9 || { echo "Another deploy, backup, or restore operation is running."; exit 1; }

if [ ! -e "$ENV_FILE" ] && [ ! -L "$ENV_FILE" ]; then
  DB_OWNER_PASSWORD=$(openssl rand -hex 32)
  DB_APP_PASSWORD=$(openssl rand -hex 32)
  AUTH_SECRET=$(openssl rand -hex 32)
  RATE_LIMIT_HASH_SECRET=$(openssl rand -hex 32)
  cat > "$ENV_FILE" <<EOF
DB_OWNER_USER=qa_owner
DB_OWNER_PASSWORD=${DB_OWNER_PASSWORD}
DB_APP_USER=qa_app
DB_APP_PASSWORD=${DB_APP_PASSWORD}
AUTH_SECRET=${AUTH_SECRET}
RATE_LIMIT_HASH_SECRET=${RATE_LIMIT_HASH_SECRET}
AUTH_URL=${AUTH_URL:-https://CHANGE_ME.example}
LOG_LEVEL=info
BACKUP_ENCRYPTION_KEY_FILE=${APP_DIR}/.backup-key
BACKUP_REMOTE=CHANGE_ME_RCLONE_REMOTE:qore-production
REQUIRE_OFFSITE_BACKUP=true
RETENTION_DAYS=30
MIN_FREE_DISK_MB=2048
SECRET_ROTATION_CONFIRMED=false
SECRET_HISTORY_REMEDIATED=false
INITIAL_DEPLOY=false
EOF
  openssl rand -base64 64 | tr -d '\n' > "${APP_DIR}/.backup-key"
  chmod 600 "$ENV_FILE" "${APP_DIR}/.backup-key"
  echo "$ENV_FILE and an encryption key were created. Set AUTH_URL and BACKUP_REMOTE,"
  echo "copy the backup key to the password manager, then rerun deployment."
  exit 1
fi

validate_secure_operator_file "$ENV_FILE" "environment file" || exit 1
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# One-time compatibility for installations created with the former qa_user role.
# The existing owner remains the migration role; web traffic is moved to qa_app.
if [ -n "${DB_PASSWORD:-}" ] && [ -z "${DB_OWNER_PASSWORD:-}" ]; then
  DB_OWNER_USER="${DB_OWNER_USER:-qa_user}"
  DB_OWNER_PASSWORD="$DB_PASSWORD"
  DB_APP_USER="${DB_APP_USER:-qa_app}"
  DB_APP_PASSWORD="${DB_APP_PASSWORD:-$(openssl rand -hex 32)}"
  {
    echo ""
    echo "# Added by the least-privilege upgrade"
    echo "DB_OWNER_USER=${DB_OWNER_USER}"
    echo "DB_OWNER_PASSWORD=${DB_OWNER_PASSWORD}"
    echo "DB_APP_USER=${DB_APP_USER}"
    echo "DB_APP_PASSWORD=${DB_APP_PASSWORD}"
  } >> "$ENV_FILE"
  export DB_OWNER_USER DB_OWNER_PASSWORD DB_APP_USER DB_APP_PASSWORD
  echo "Legacy database credentials mapped to the migration owner; runtime will use $DB_APP_USER."
fi

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required environment variable: $name"
    exit 1
  fi
}

for name in DB_OWNER_USER DB_OWNER_PASSWORD DB_APP_USER DB_APP_PASSWORD AUTH_SECRET RATE_LIMIT_HASH_SECRET AUTH_URL; do
  require_env "$name"
done

for value in "$DB_OWNER_PASSWORD" "$DB_APP_PASSWORD" "$AUTH_SECRET" "$RATE_LIMIT_HASH_SECRET"; do
  if [[ "$value" == CHANGE_ME* ]]; then
    echo "Production contains placeholder credentials. Replace them before deployment."
    exit 1
  fi
done

if [[ "$DB_OWNER_PASSWORD" =~ [:/@?#] ]] || [[ "$DB_APP_PASSWORD" =~ [:/@?#] ]]; then
  echo "Database passwords must be URL-safe because Prisma receives them in DATABASE_URL."
  echo "Use: openssl rand -hex 32"
  exit 1
fi

for secret_name in DB_OWNER_PASSWORD DB_APP_PASSWORD AUTH_SECRET RATE_LIMIT_HASH_SECRET; do
  if [[ ! "${!secret_name}" =~ ^[a-fA-F0-9]{64}$ ]]; then
    echo "$secret_name must be generated with: openssl rand -hex 32"
    exit 1
  fi
done

if [[ "$AUTH_URL" != https://* ]] || [ "$AUTH_URL" = "https://CHANGE_ME.example" ]; then
  echo "AUTH_URL must be the real production HTTPS hostname."
  exit 1
fi

APP_DIR="$APP_DIR" COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" \
  bash scripts/production-preflight.sh --offline

export IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short=12 HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"
PREVIOUS_IMAGE=$(docker inspect --format='{{.Config.Image}}' qa_form_creator_app 2>/dev/null || true)

echo "Building immutable application and migration images: $IMAGE_TAG"
build_context=$(mktemp -d "${TMPDIR:-/tmp}/qore-build-context.XXXXXX")
cleanup_build_context() {
  [ -z "${build_context:-}" ] || rm -rf -- "$build_context"
}
trap cleanup_build_context EXIT
git archive --format=tar HEAD | tar -xf - -C "$build_context"
docker build --target runner --tag "qa-form-creator:$IMAGE_TAG" "$build_context"
docker build --target migrator --tag "qa-form-creator-migrator:$IMAGE_TAG" "$build_context"
rm -rf -- "$build_context"
build_context=""

echo "Starting PostgreSQL without interrupting the current application"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d db

for attempt in $(seq 1 30); do
  if docker exec "$DB_CONTAINER" pg_isready -U "$DB_OWNER_USER" -d "$DB_NAME" -q; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "Database did not become ready."
    exit 1
  fi
  sleep 1
done

existing_table_count=$(docker exec "$DB_CONTAINER" psql \
  --username "$DB_OWNER_USER" --dbname "$DB_NAME" --tuples-only --no-align \
  --set ON_ERROR_STOP=1 \
  --command "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');")

if [ "$existing_table_count" -gt 0 ]; then
  echo "Validating current production integrity before backup and migration"
  docker exec -i "$DB_CONTAINER" psql \
    --username "$DB_OWNER_USER" --dbname "$DB_NAME" --no-psqlrc \
    --set ON_ERROR_STOP=1 < scripts/sql/verify-data-integrity.sql

  echo "Creating a verified encrypted backup before schema changes"
  backup_result=$(mktemp "${TMPDIR:-/tmp}/qore-backup-result.XXXXXX")
  QORE_LOCK_HELD=true BACKUP_RESULT_FILE="$backup_result" \
    APP_DIR="$APP_DIR" ENV_FILE="$ENV_FILE" bash scripts/backup.sh
  backup_file=$(<"$backup_result")
  rm -f "$backup_result"
  [ -f "$backup_file" ] || { echo "Backup did not return a valid local file."; exit 1; }

  echo "Proving the backup and candidate images in an isolated restore drill"
  QORE_LOCK_HELD=true IMAGE_TAG="$IMAGE_TAG" APP_DIR="$APP_DIR" ENV_FILE="$ENV_FILE" \
    bash scripts/dr-drill.sh "$backup_file"
elif [ "${INITIAL_DEPLOY:-false}" != "true" ]; then
  echo "The database is empty. Set INITIAL_DEPLOY=true explicitly for the first deployment."
  exit 1
else
  echo "Empty database confirmed; INITIAL_DEPLOY=true authorizes the first migration without a backup."
fi

echo "Applying migrations with the owner-only migration image"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" --profile tools run --rm migrator

echo "Provisioning least-privilege runtime grants"
bash scripts/provision-db-roles.sh

echo "Running post-migration integrity and least-privilege gates"
APP_DIR="$APP_DIR" COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" \
  bash scripts/production-preflight.sh --online

rollback_app() {
  if [ -n "$PREVIOUS_IMAGE" ]; then
    local previous_tag="${PREVIOUS_IMAGE##*:}"
    echo "New app failed health checks; restoring prior image $PREVIOUS_IMAGE"
    IMAGE_TAG="$previous_tag" docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-deps app
  fi
}

echo "Replacing only the application container"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --no-deps app

for attempt in $(seq 1 60); do
  status=$(docker inspect --format='{{.State.Health.Status}}' qa_form_creator_app 2>/dev/null || echo "starting")
  if [ "$status" = "healthy" ]; then
    echo "Application is healthy on image qa-form-creator:$IMAGE_TAG"
    break
  fi
  if [ "$status" = "unhealthy" ] || [ "$attempt" -eq 60 ]; then
    docker logs qa_form_creator_app --tail 80 || true
    rollback_app
    exit 1
  fi
  sleep 2
done

APACHE_CONF="/etc/apache2/sites-available/qa-form-creator.conf"
if [ -f "$APP_DIR/config/apache-qa.conf" ]; then
  apache_candidate=$(mktemp /etc/apache2/sites-available/.qa-form-creator.XXXXXX)
  apache_previous=$(mktemp /etc/apache2/sites-available/.qa-form-creator.previous.XXXXXX)
  had_previous=false
  install -m 644 "$APP_DIR/config/apache-qa.conf" "$apache_candidate"
  if [ -f "$APACHE_CONF" ]; then
    cp -a "$APACHE_CONF" "$apache_previous"
    had_previous=true
  else
    rm -f "$apache_previous"
  fi
  mv "$apache_candidate" "$APACHE_CONF"
  if ! a2ensite qa-form-creator; then
    if [ "$had_previous" = "true" ]; then
      mv "$apache_previous" "$APACHE_CONF"
    else
      rm -f "$APACHE_CONF"
    fi
    echo "Apache site activation failed; the prior configuration was restored."
    exit 1
  fi
  if ! apache2ctl configtest; then
    if [ "$had_previous" = "true" ]; then
      mv "$apache_previous" "$APACHE_CONF"
    else
      a2dissite qa-form-creator 2>/dev/null || true
      rm -f "$APACHE_CONF"
    fi
    echo "Apache configuration validation failed; the prior configuration was restored."
    exit 1
  fi
  rm -f "$apache_previous"
  a2dissite 000-default 2>/dev/null || true
  systemctl reload apache2
fi

current_crontab=$(crontab -l 2>/dev/null | grep -Fv "$APP_DIR/scripts/backup.sh" || true)
{
  printf '%s\n' "$current_crontab"
  echo "0 2 * * * PATH=/usr/local/bin:/usr/bin:/bin APP_DIR=$APP_DIR ENV_FILE=$ENV_FILE bash $APP_DIR/scripts/backup.sh >> /var/log/qa-backup.log 2>&1 # qore-managed-backup"
} | sed '/^[[:space:]]*$/d' | crontab -

release_candidate=$(mktemp "$APP_DIR/.deployed-release.XXXXXX")
{
  echo "IMAGE_TAG=$IMAGE_TAG"
  echo "GIT_COMMIT=$(git rev-parse HEAD)"
  echo "APP_IMAGE_ID=$(docker image inspect --format '{{.Id}}' "qa-form-creator:$IMAGE_TAG")"
  echo "MIGRATOR_IMAGE_ID=$(docker image inspect --format '{{.Id}}' "qa-form-creator-migrator:$IMAGE_TAG")"
  echo "DEPLOYED_AT=$(date -u +%FT%TZ)"
} > "$release_candidate"
chmod 600 "$release_candidate"
mv "$release_candidate" "$APP_DIR/.deployed-release"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
echo "Deployment completed. Database migrations ran as $DB_OWNER_USER; the app runs as $DB_APP_USER."
