#!/usr/bin/env python3
"""
deploy-settings.py
==================
Deploys the new Settings feature to production.

Scope:
  - New AppSetting model (Prisma) + migration with default seed
  - Central settings helper lib with unstable_cache + defaults
  - Server actions: readSettings / updateSettings / resetSettings
  - Server actions: getMyProfile / updateMyName / changeMyPassword
  - Analytics queries refactored to read passThreshold from DB
  - New /settings page with "Mi Cuenta" + "Scoring" tabs
  - Dashboard / KPIs / Agents pages consume settings dynamically
  - Sidebar: new "Configuración" item (all users)

Steps:
  1. Upload schema + migration + all new/modified files
  2. Apply migration via psql (CREATE TABLE + seed)
  3. Register migration in _prisma_migrations
  4. Rebuild + restart app container
"""
import sys
import os
import hashlib
import paramiko

HOST        = "192.168.80.243"
USER        = "root"
PASS        = "T3l3c0m.2026"
REMOTE_ROOT = "/opt/qa-form-creator"

DB_CONTAINER = "qa_form_creator_db"
DB_USER      = "qa_user"
DB_NAME      = "qa_form_creator"

LOCAL_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

MIGRATION_NAME = "20260410000000_app_settings"

# Files to upload (relative to repo root, using forward slashes)
FILES = [
    # Schema + migration
    "prisma/schema.prisma",
    f"prisma/migrations/{MIGRATION_NAME}/migration.sql",

    # New lib + server actions
    "src/lib/settings.ts",
    "src/server/actions/settings.ts",
    "src/server/actions/profile.ts",

    # Refactored analytics (uses getPassThreshold)
    "src/server/queries/analytics.ts",

    # New Settings page
    "src/app/(dashboard)/settings/page.tsx",
    "src/app/(dashboard)/settings/settings-client.tsx",

    # Pages + clients that consume settings
    "src/app/(dashboard)/page.tsx",
    "src/app/(dashboard)/dashboard-client.tsx",
    "src/app/(dashboard)/kpis/page.tsx",
    "src/app/(dashboard)/kpis/kpis-client.tsx",
    "src/app/(dashboard)/analytics/agents/page.tsx",
    "src/app/(dashboard)/analytics/agents/agents-client.tsx",

    # Sidebar: new menu item
    "src/components/layout/sidebar.tsx",
]


def log(msg):
    sys.stdout.buffer.write((msg + "\n").encode("utf-8", errors="replace"))
    sys.stdout.buffer.flush()


def ensure_remote_dir(sftp, path):
    """Recursively create remote directories if they don't exist."""
    parts = path.strip("/").split("/")
    current = ""
    for p in parts:
        current = f"{current}/{p}" if current else f"/{p}"
        try:
            sftp.stat(current)
        except FileNotFoundError:
            sftp.mkdir(current)


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    log(f"Connecting to {HOST}...")
    client.connect(HOST, username=USER, password=PASS, timeout=15)

    transport = client.get_transport()
    if transport is None:
        sys.exit("SSH transport unavailable")
    sftp = paramiko.SFTPClient.from_transport(transport)

    # ── 1. Upload files ────────────────────────────────────────────────────
    log("\n[1/4] Uploading files...")
    for rel in FILES:
        local = os.path.join(LOCAL_ROOT, rel.replace("/", os.sep))
        remote = f"{REMOTE_ROOT}/{rel}"
        remote_dir = remote.rsplit("/", 1)[0]
        ensure_remote_dir(sftp, remote_dir)
        size = os.path.getsize(local)
        log(f"  [OK] {rel}  ({size:,} bytes)")
        sftp.put(local, remote)
    sftp.close()

    # ── 2. Apply migration (CREATE TABLE + seed) ───────────────────────────
    log("\n[2/4] Applying migration (CREATE TABLE + seed defaults)...")
    local_sql = os.path.join(
        LOCAL_ROOT,
        "prisma", "migrations", MIGRATION_NAME, "migration.sql",
    )
    with open(local_sql, "r", encoding="utf-8") as f:
        migration_sql = f.read()

    # Pipe the SQL into psql via stdin to avoid escaping issues
    apply_cmd = (
        f"docker exec -i {DB_CONTAINER} psql -U {DB_USER} -d {DB_NAME} -v ON_ERROR_STOP=0"
    )
    stdin, stdout, stderr = client.exec_command(apply_cmd, timeout=60)
    stdin.write(migration_sql)
    stdin.channel.shutdown_write()
    out_txt = stdout.read().decode().strip()
    err_txt = stderr.read().decode().strip()
    if out_txt:
        log(f"  {out_txt}")
    if err_txt:
        # Tolerate "already exists" on re-runs
        if "already exists" in err_txt.lower():
            log(f"  (idempotent) {err_txt.splitlines()[0]}")
        else:
            log(f"  STDERR: {err_txt}")

    # ── 3. Register in _prisma_migrations ──────────────────────────────────
    log("\n[3/4] Registering migration in _prisma_migrations...")
    checksum = hashlib.sha256(migration_sql.encode()).hexdigest()
    register_sql = (
        "INSERT INTO _prisma_migrations "
        "(id, checksum, finished_at, migration_name, logs, rolled_back_at, "
        "started_at, applied_steps_count) "
        f"VALUES (gen_random_uuid()::text, '{checksum}', NOW(), "
        f"'{MIGRATION_NAME}', NULL, NULL, NOW(), 1) "
        "ON CONFLICT DO NOTHING;"
    )
    reg_cmd = (
        f"docker exec {DB_CONTAINER} psql -U {DB_USER} -d {DB_NAME} "
        f"-c \"{register_sql}\""
    )
    _, out, err = client.exec_command(reg_cmd)
    out_txt = out.read().decode().strip()
    err_txt = err.read().decode().strip()
    if out_txt:
        log(f"  {out_txt}")
    if err_txt:
        log(f"  STDERR: {err_txt}")

    # ── 4. Rebuild + restart app container ─────────────────────────────────
    log("\n[4/4] Rebuilding + restarting app container...")
    build_cmd = (
        f"cd {REMOTE_ROOT} && "
        "docker compose -f docker-compose.prod.yml --env-file .env.production "
        "build app 2>&1 | tail -20 && "
        "echo --- && "
        "docker compose -f docker-compose.prod.yml --env-file .env.production "
        "up -d 2>&1 && "
        "sleep 18 && "
        "docker ps --format 'table {{.Names}}\\t{{.Status}}' | grep qa_ && "
        "echo --- && "
        "curl -sk https://192.168.80.243/api/health"
    )
    stdin, stdout, stderr = client.exec_command(build_cmd, timeout=1800)
    while not stdout.channel.exit_status_ready():
        if stdout.channel.recv_ready():
            sys.stdout.buffer.write(stdout.channel.recv(4096))
            sys.stdout.buffer.flush()
        if stdout.channel.recv_stderr_ready():
            sys.stderr.buffer.write(stdout.channel.recv_stderr(4096))
            sys.stderr.buffer.flush()
    sys.stdout.buffer.write(stdout.read())
    sys.stderr.buffer.write(stderr.read())
    sys.stdout.buffer.flush()
    sys.stderr.buffer.flush()

    code = stdout.channel.recv_exit_status()
    client.close()
    log(f"\nDeploy exit code: {code}")
    sys.exit(code)


if __name__ == "__main__":
    main()
