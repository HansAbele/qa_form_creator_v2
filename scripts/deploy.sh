#!/bin/bash
set -euo pipefail

# QA Form Creator production deploy.
# Run from /opt/qa-form-creator on the target server.

APP_DIR="${APP_DIR:-/opt/qa-form-creator}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
PRISMA_VERSION="${PRISMA_VERSION:-6.19.3}"

cd "$APP_DIR"

echo "========================================"
echo "  QA Form Creator - Deploy"
echo "========================================"

if [ ! -f ".env.production" ]; then
  echo "Creating .env.production from template..."

  DB_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
  AUTH_SEC=$(openssl rand -base64 32)

  umask 077
  cat > .env.production <<EOF
DB_PASSWORD=${DB_PASS}
AUTH_SECRET=${AUTH_SEC}
AUTH_URL=https://qa.empresa.local
LOG_LEVEL=info
EOF

  echo ".env.production created with generated secrets."
  echo "Store the generated credentials in the team password manager."
else
  echo ".env.production already exists"
  chmod 600 .env.production 2>/dev/null || true
fi

set -a
source .env.production
set +a

echo ""
echo "Building Docker image..."
docker compose -f "$COMPOSE_FILE" build --no-cache

echo ""
echo "Stopping existing containers..."
docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true

echo ""
echo "Starting containers..."
docker compose -f "$COMPOSE_FILE" up -d

echo ""
echo "Waiting for database..."
for i in $(seq 1 30); do
  if docker exec qa_form_creator_db pg_isready -U qa_user -d qa_form_creator -q 2>/dev/null; then
    echo "Database ready"
    break
  fi

  if [ "$i" -eq 30 ]; then
    echo "Database failed to start"
    exit 1
  fi

  sleep 1
done

echo ""
echo "Running database migrations..."
docker exec qa_form_creator_app npx --yes "prisma@${PRISMA_VERSION}" migrate deploy --schema /app/prisma/schema.prisma
echo "Migrations applied"

echo ""
if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "Seeding database..."
  docker exec qa_form_creator_app npx --yes "prisma@${PRISMA_VERSION}" db seed --schema /app/prisma/schema.prisma
  echo "Seed complete"
else
  echo "Seed skipped. Set RUN_SEED=true to run it explicitly."
fi

echo ""
echo "Waiting for app to be healthy..."
for i in $(seq 1 60); do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' qa_form_creator_app 2>/dev/null || echo "starting")
  if [ "$STATUS" = "healthy" ]; then
    echo "App is healthy"
    break
  fi

  if [ "$i" -eq 60 ]; then
    echo "App health check timeout. Recent logs:"
    docker logs qa_form_creator_app --tail 20
    break
  fi

  sleep 2
done

APACHE_CONF="/etc/apache2/sites-available/qa-form-creator.conf"
if [ -f "$APP_DIR/config/apache-qa.conf" ] && [ ! -f "$APACHE_CONF" ]; then
  echo ""
  echo "Installing Apache virtual host..."
  cp "$APP_DIR/config/apache-qa.conf" "$APACHE_CONF"
  a2ensite qa-form-creator
  a2dissite 000-default 2>/dev/null || true
  systemctl reload apache2
  echo "Apache configured and reloaded"
fi

if ! crontab -l 2>/dev/null | grep -q "backup.sh"; then
  echo ""
  echo "Setting up daily backup cron at 2:00 AM..."
  (crontab -l 2>/dev/null; echo "0 2 * * * $APP_DIR/scripts/backup.sh >> /var/log/qa-backup.log 2>&1") | crontab -
  echo "Backup cron installed"
fi

echo ""
echo "========================================"
echo "  Deployment complete"
echo "========================================"
echo ""
echo "  App through Apache: http://192.168.80.243"
echo "  Local app binding: http://127.0.0.1:3000"
echo ""
echo "  Containers:"
docker compose -f "$COMPOSE_FILE" ps
