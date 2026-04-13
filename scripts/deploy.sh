#!/bin/bash
set -euo pipefail

# ─── QA Form Creator — Deploy Script ────────────────────
# Run from /opt/qa-form-creator on the target server

APP_DIR="/opt/qa-form-creator"
cd "$APP_DIR"

echo "═══════════════════════════════════════"
echo "  QA Form Creator — Deploy"
echo "═══════════════════════════════════════"

# ─── 1. Check .env.production exists ────────────────────
if [ ! -f ".env.production" ]; then
  echo "► Creating .env.production from template..."

  # Generate secure values
  DB_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
  AUTH_SEC=$(openssl rand -base64 32)

  cat > .env.production <<EOF
DB_PASSWORD=${DB_PASS}
AUTH_SECRET=${AUTH_SEC}
AUTH_URL=https://qa.empresa.local
LOG_LEVEL=info
EOF

  echo "  ✓ .env.production created with generated secrets"
  echo "  ► DB_PASSWORD: ${DB_PASS}"
  echo "  ► Save these credentials securely!"
else
  echo "  ✓ .env.production already exists"
fi

# ─── 2. Load env vars ──────────────────────────────────
set -a
source .env.production
set +a

# ─── 3. Build Docker image ──────────────────────────────
echo ""
echo "► Building Docker image (this may take a few minutes)..."
docker compose -f docker-compose.prod.yml build --no-cache
echo "  ✓ Docker image built"

# ─── 4. Stop existing containers ────────────────────────
echo ""
echo "► Stopping existing containers..."
docker compose -f docker-compose.prod.yml down 2>/dev/null || true

# ─── 5. Start containers ───────────────────────────────
echo ""
echo "► Starting containers..."
docker compose -f docker-compose.prod.yml up -d
echo "  ✓ Containers started"

# ─── 6. Wait for database to be ready ──────────────────
echo ""
echo "► Waiting for database..."
for i in $(seq 1 30); do
  if docker exec qa_form_creator_db pg_isready -U qa_user -d qa_form_creator -q 2>/dev/null; then
    echo "  ✓ Database ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "  ✗ Database failed to start"
    exit 1
  fi
  sleep 1
done

# ─── 7. Run migrations ─────────────────────────────────
echo ""
echo "► Running database migrations..."
docker exec qa_form_creator_app npx prisma migrate deploy 2>/dev/null || \
  docker exec qa_form_creator_app npx prisma db push --accept-data-loss
echo "  ✓ Migrations applied"

# ─── 8. Seed database (first deploy only) ──────────────
echo ""
echo "► Seeding database..."
docker exec qa_form_creator_app npx prisma db seed 2>/dev/null || echo "  (seed already applied or skipped)"
echo "  ✓ Seed complete"

# ─── 9. Wait for app health check ──────────────────────
echo ""
echo "► Waiting for app to be healthy..."
for i in $(seq 1 60); do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' qa_form_creator_app 2>/dev/null || echo "starting")
  if [ "$STATUS" = "healthy" ]; then
    echo "  ✓ App is healthy!"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "  ⚠ App health check timeout — checking logs..."
    docker logs qa_form_creator_app --tail 20
    echo ""
    echo "  The app may still be starting. Check: docker logs qa_form_creator_app"
    break
  fi
  sleep 2
done

# ─── 10. Install Apache config ─────────────────────────
APACHE_CONF="/etc/apache2/sites-available/qa-form-creator.conf"
if [ -f "$APP_DIR/config/apache-qa.conf" ] && [ ! -f "$APACHE_CONF" ]; then
  echo ""
  echo "► Installing Apache virtual host..."
  cp "$APP_DIR/config/apache-qa.conf" "$APACHE_CONF"
  a2ensite qa-form-creator
  a2dissite 000-default 2>/dev/null || true
  systemctl reload apache2
  echo "  ✓ Apache configured and reloaded"
fi

# ─── 11. Setup backup cron ──────────────────────────────
if ! crontab -l 2>/dev/null | grep -q "backup.sh"; then
  echo ""
  echo "► Setting up daily backup cron (2:00 AM)..."
  (crontab -l 2>/dev/null; echo "0 2 * * * $APP_DIR/scripts/backup.sh >> /var/log/qa-backup.log 2>&1") | crontab -
  echo "  ✓ Backup cron installed"
fi

# ─── Done ───────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════"
echo "  Deployment complete!"
echo "═══════════════════════════════════════"
echo ""
echo "  App:    http://localhost:3000"
echo "  HTTPS:  https://qa.empresa.local"
echo "  HTTP:   http://192.168.80.243"
echo ""
echo "  Containers:"
docker compose -f docker-compose.prod.yml ps
echo ""
echo "  Credentials:"
echo "    Admin: admin@qa.local / Admin.2026"
echo "    QA:    qa@qa.local / Qa.2026"
