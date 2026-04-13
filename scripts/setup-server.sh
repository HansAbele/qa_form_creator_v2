#!/bin/bash
set -euo pipefail

# ─── QA Form Creator — Server Setup (Debian 12) ─────────
# Run as root on the target server
# This script installs Docker, Apache, and configures the environment

echo "═══════════════════════════════════════"
echo "  QA Form Creator — Server Setup"
echo "═══════════════════════════════════════"

# ─── 1. System updates ──────────────────────────────────
echo ""
echo "► Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# ─── 2. Install Docker ──────────────────────────────────
if ! command -v docker &> /dev/null; then
  echo "► Installing Docker..."
  apt-get install -y -qq ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable docker
  systemctl start docker
  echo "  ✓ Docker installed"
else
  echo "  ✓ Docker already installed ($(docker --version))"
fi

# ─── 3. Install Apache ──────────────────────────────────
if ! command -v apache2 &> /dev/null; then
  echo "► Installing Apache..."
  apt-get install -y -qq apache2
  a2enmod proxy proxy_http proxy_wss headers rewrite ssl
  systemctl enable apache2
  echo "  ✓ Apache installed"
else
  echo "  ✓ Apache already installed"
  a2enmod proxy proxy_http proxy_wss headers rewrite ssl 2>/dev/null || true
fi

# ─── 4. Create app directory ────────────────────────────
APP_DIR="/opt/qa-form-creator"
mkdir -p "$APP_DIR"
echo "  ✓ App directory: $APP_DIR"

# ─── 5. Generate self-signed SSL cert (intranet) ────────
CERT_DIR="/etc/ssl/qa-form-creator"
if [ ! -f "$CERT_DIR/cert.pem" ]; then
  echo "► Generating self-signed SSL certificate..."
  mkdir -p "$CERT_DIR"
  openssl req -x509 -nodes -days 3650 \
    -newkey rsa:2048 \
    -keyout "$CERT_DIR/key.pem" \
    -out "$CERT_DIR/cert.pem" \
    -subj "/C=DO/ST=DN/L=SantoDomingo/O=PX/CN=qa.empresa.local" \
    -addext "subjectAltName=DNS:qa.empresa.local,IP:192.168.80.243"
  echo "  ✓ SSL certificate generated"
else
  echo "  ✓ SSL certificate already exists"
fi

# ─── 6. Create backup directory ─────────────────────────
mkdir -p /opt/qa-form-creator/backups
echo "  ✓ Backup directory ready"

# ─── 7. Configure firewall (if ufw is available) ────────
if command -v ufw &> /dev/null; then
  ufw allow 80/tcp 2>/dev/null || true
  ufw allow 443/tcp 2>/dev/null || true
  echo "  ✓ Firewall ports 80/443 opened"
fi

echo ""
echo "═══════════════════════════════════════"
echo "  Server setup complete!"
echo "═══════════════════════════════════════"
echo ""
echo "Next: copy project files to $APP_DIR and run deploy.sh"
