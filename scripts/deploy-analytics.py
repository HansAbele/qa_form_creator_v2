#!/usr/bin/env python3
"""
deploy-analytics.py
===================
Deploys the analytics + dispositions + teams feature set to production.

Scope:
  - New Prisma models: Team, DispositionCategory, Disposition
  - Agent.teamId + Response.dispositionId fields
  - Disposition combobox with fuzzy matching and inline creation
  - Admin CRUD pages for teams and dispositions (+ bulk import)
  - QA role expanded: create/edit forms, agents, dispositions
  - 5 new analytics queries + 5 drill-down pages
  - Dashboard: 2 new charts + all charts clickable for drill-down
  - Sidebar: Equipos + Disposiciones navigation

Steps:
  1. Upload all changed/new files via SFTP
  2. Run prisma db push inside Docker to sync schema
  3. Rebuild + restart app container
"""
import sys
import os
import paramiko

HOST        = "192.168.80.243"
USER        = "root"
PASS        = os.environ["QORE_SSH_PASSWORD"]
REMOTE_ROOT = "/opt/qa-form-creator"

DB_CONTAINER = "qa_form_creator_db"
DB_USER      = "qa_user"
DB_NAME      = "qa_form_creator"

LOCAL_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# All files changed between stable and master (git diff --name-only stable..master)
FILES = [
    # Schema
    "prisma/schema.prisma",

    # Admin pages — teams
    "src/app/(dashboard)/admin/teams/page.tsx",
    "src/app/(dashboard)/admin/teams/teams-client.tsx",

    # Admin pages — dispositions
    "src/app/(dashboard)/admin/dispositions/page.tsx",
    "src/app/(dashboard)/admin/dispositions/dispositions-client.tsx",

    # Analytics — agent drill-down
    "src/app/(dashboard)/analytics/agents/[agentId]/page.tsx",
    "src/app/(dashboard)/analytics/agents/[agentId]/agent-detail-client.tsx",

    # Analytics — evaluator drill-down
    "src/app/(dashboard)/analytics/evaluators/[userId]/page.tsx",
    "src/app/(dashboard)/analytics/evaluators/[userId]/evaluator-detail-client.tsx",

    # Analytics — team drill-down
    "src/app/(dashboard)/analytics/teams/[teamId]/page.tsx",
    "src/app/(dashboard)/analytics/teams/[teamId]/team-detail-client.tsx",

    # Analytics — teams overview
    "src/app/(dashboard)/analytics/teams/page.tsx",
    "src/app/(dashboard)/analytics/teams/teams-analytics-client.tsx",

    # Analytics — dispositions overview
    "src/app/(dashboard)/analytics/dispositions/page.tsx",
    "src/app/(dashboard)/analytics/dispositions/dispositions-analytics-client.tsx",

    # Dashboard (new charts + click-through)
    "src/app/(dashboard)/dashboard-client.tsx",

    # Forms pages (QA role expansion)
    "src/app/(dashboard)/forms/page.tsx",
    "src/app/(dashboard)/forms/new/page.tsx",
    "src/app/(dashboard)/forms/[id]/edit/page.tsx",

    # New components
    "src/components/admin/team-form.tsx",
    "src/components/admin/disposition-form.tsx",
    "src/components/forms/disposition-combobox.tsx",

    # Modified components
    "src/components/forms/form-viewer.tsx",
    "src/components/layout/sidebar.tsx",
    "src/components/layout/header.tsx",

    # Server actions (new + modified)
    "src/server/actions/teams.ts",
    "src/server/actions/dispositions.ts",
    "src/server/actions/agents.ts",
    "src/server/actions/forms.ts",
    "src/server/actions/responses.ts",

    # Analytics queries
    "src/server/queries/analytics.ts",
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

    # -- 1. Upload files -------------------------------------------------------
    log("\n[1/3] Uploading files...")
    uploaded = 0
    for rel in FILES:
        local = os.path.join(LOCAL_ROOT, rel.replace("/", os.sep))
        if not os.path.exists(local):
            log(f"  [SKIP] {rel} (not found locally)")
            continue
        remote = f"{REMOTE_ROOT}/{rel}"
        remote_dir = remote.rsplit("/", 1)[0]
        ensure_remote_dir(sftp, remote_dir)
        size = os.path.getsize(local)
        sftp.put(local, remote)
        log(f"  [OK] {rel}  ({size:,} bytes)")
        uploaded += 1
    sftp.close()
    log(f"\n  Uploaded {uploaded}/{len(FILES)} files.")

    # -- 2. Prisma db push (sync schema) ---------------------------------------
    log("\n[2/3] Running prisma db push inside Docker container...")
    # We need to run prisma db push inside the app container
    # First check if app container exists and get its name
    _, stdout, _ = client.exec_command(
        "docker ps --format '{{.Names}}' | grep -i qa_form_creator_app || "
        "docker ps --format '{{.Names}}' | grep -i qa.*app"
    )
    app_container = stdout.read().decode().strip().split("\n")[0]
    if not app_container:
        app_container = "qa_form_creator_app"
    log(f"  App container: {app_container}")

    # Run prisma db push directly against the database URL
    # Since schema is uploaded to the host, we use npx prisma from the app container
    push_cmd = (
        f"cd {REMOTE_ROOT} && "
        f"docker exec {app_container} npx prisma db push --skip-generate 2>&1 || "
        # Fallback: if app container doesn't have prisma CLI, use a temporary container
        f"docker run --rm --network qa_form_creator_network "
        f"-v {REMOTE_ROOT}/prisma:/app/prisma "
        f"-e DATABASE_URL=\"$(grep DATABASE_URL {REMOTE_ROOT}/.env.production | cut -d= -f2-)\" "
        f"node:20-slim sh -c 'cd /app && npm i -g prisma@6 && prisma db push --skip-generate' 2>&1"
    )
    stdin, stdout, stderr = client.exec_command(push_cmd, timeout=120)
    out_txt = stdout.read().decode().strip()
    err_txt = stderr.read().decode().strip()
    if out_txt:
        log(f"  {out_txt}")
    if err_txt:
        log(f"  STDERR: {err_txt}")

    # -- 3. Rebuild + restart app container ------------------------------------
    log("\n[3/3] Rebuilding + restarting app container...")
    build_cmd = (
        f"cd {REMOTE_ROOT} && "
        "docker compose -f docker-compose.prod.yml --env-file .env.production "
        "build app 2>&1 | tail -25 && "
        "echo '--- BUILD DONE ---' && "
        "docker compose -f docker-compose.prod.yml --env-file .env.production "
        "up -d 2>&1 && "
        "echo '--- UP DONE, waiting for health check... ---' && "
        "sleep 20 && "
        "docker ps --format 'table {{.Names}}\\t{{.Status}}' | grep qa_ && "
        "echo '---' && "
        "curl -sk https://192.168.80.243/api/health || echo 'Health check failed (may need more time)'"
    )
    stdin, stdout, stderr = client.exec_command(build_cmd, timeout=1800)

    # Stream output in real-time
    while not stdout.channel.exit_status_ready():
        if stdout.channel.recv_ready():
            sys.stdout.buffer.write(stdout.channel.recv(4096))
            sys.stdout.buffer.flush()
        if stdout.channel.recv_stderr_ready():
            sys.stderr.buffer.write(stdout.channel.recv_stderr(4096))
            sys.stderr.buffer.flush()
    # Flush remaining
    sys.stdout.buffer.write(stdout.read())
    sys.stderr.buffer.write(stderr.read())
    sys.stdout.buffer.flush()
    sys.stderr.buffer.flush()

    code = stdout.channel.recv_exit_status()
    client.close()

    log(f"\nDeploy exit code: {code}")
    if code == 0:
        log("\nDeploy completed successfully!")
        log("  Rollback: git checkout stable")
        log("  Then re-deploy the stable versions of files.")
    else:
        log("\nDeploy had warnings. Check container logs:")
        log(f"  ssh root@{HOST} 'docker logs qa_form_creator_app --tail 50'")

    sys.exit(code)


if __name__ == "__main__":
    main()
