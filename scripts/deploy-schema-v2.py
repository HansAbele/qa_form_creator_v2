#!/usr/bin/env python3
"""
deploy-schema-v2.py
===================
Deploys the nullable-password schema change to production.

Steps:
  1. Upload updated prisma/schema.prisma and migration SQL
  2. Apply ALTER TABLE via psql in the DB container
  3. Register migration in _prisma_migrations (idempotent)
  4. Rebuild + restart app container with new schema
"""
import sys
import os
import hashlib
import paramiko

HOST       = "192.168.80.243"
USER       = "root"
PASS       = "T3l3c0m.2026"
REMOTE_ROOT = "/opt/qa-form-creator"

DB_CONTAINER = "qa_form_creator_db"
DB_USER      = "qa_user"
DB_NAME      = "qa_form_creator"

LOCAL_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

MIGRATION_NAME = "20260409000000_nullable_password"
MIGRATION_SQL  = 'ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;'

FILES = [
    "prisma/schema.prisma",
    f"prisma/migrations/{MIGRATION_NAME}/migration.sql",
    "src/lib/auth.config.ts",
]


def log(msg):
    sys.stdout.buffer.write((msg + "\n").encode("utf-8", errors="replace"))
    sys.stdout.buffer.flush()


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    log(f"Connecting to {HOST}...")
    client.connect(HOST, username=USER, password=PASS, timeout=15)

    # ── 1. Upload files ────────────────────────────────────────────────────────
    sftp = paramiko.SFTPClient.from_transport(client.get_transport())
    for rel in FILES:
        local  = os.path.join(LOCAL_ROOT, rel.replace("/", os.sep))
        remote = f"{REMOTE_ROOT}/{rel}"
        # Ensure remote directory exists
        remote_dir = remote.rsplit("/", 1)[0]
        try:
            sftp.stat(remote_dir)
        except FileNotFoundError:
            sftp.mkdir(remote_dir)
        log(f"Uploading: {rel} ({os.path.getsize(local)} bytes)")
        sftp.put(local, remote)
    sftp.close()

    # ── 2. Apply migration SQL ─────────────────────────────────────────────────
    log("\nApplying schema migration...")
    apply_cmd = (
        f"docker exec {DB_CONTAINER} psql -U {DB_USER} -d {DB_NAME} "
        f"-c '{MIGRATION_SQL}'"
    )
    _, out, err = client.exec_command(apply_cmd)
    out_txt = out.read().decode().strip()
    err_txt = err.read().decode().strip()
    if out_txt:
        log(f"  {out_txt}")
    if err_txt and "already exists" not in err_txt:
        log(f"  STDERR: {err_txt}")

    # ── 3. Register in _prisma_migrations ──────────────────────────────────────
    migration_file_content = (
        "-- AlterTable: make password nullable to support Microsoft OAuth (passwordless SSO)\n"
        f"{MIGRATION_SQL}\n"
    )
    checksum = hashlib.sha256(migration_file_content.encode()).hexdigest()

    register_sql = (
        f"INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, "
        f"logs, rolled_back_at, started_at, applied_steps_count) "
        f"VALUES (gen_random_uuid()::text, '{checksum}', NOW(), '{MIGRATION_NAME}', "
        f"NULL, NULL, NOW(), 1) "
        f"ON CONFLICT DO NOTHING;"
    )
    reg_cmd = (
        f"docker exec {DB_CONTAINER} psql -U {DB_USER} -d {DB_NAME} "
        f"-c \"{register_sql}\""
    )
    _, out, err = client.exec_command(reg_cmd)
    out_txt = out.read().decode().strip()
    if out_txt:
        log(f"  Migration registered: {out_txt}")

    # ── 4. Rebuild app with updated schema ─────────────────────────────────────
    log("\nRebuilding app with updated schema...")
    rebuild_cmd = (
        f"cd {REMOTE_ROOT} && "
        "docker compose -f docker-compose.prod.yml --env-file .env.production build app 2>&1 | tail -8 && "
        "docker compose -f docker-compose.prod.yml --env-file .env.production up -d 2>&1 && "
        "sleep 20 && "
        "docker ps --format 'table {{.Names}}\\t{{.Status}}' | grep qa_ && "
        "echo --- && "
        "curl -sk https://192.168.80.243/api/health && "
        "echo BUILD_EXIT=$?"
    )
    stdin, stdout, stderr = client.exec_command(rebuild_cmd, timeout=600)
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

    exit_code = stdout.channel.recv_exit_status()
    log(f"\nDeploy exit code: {exit_code}")
    client.close()
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
