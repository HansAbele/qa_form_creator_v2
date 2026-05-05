#!/usr/bin/env python3
"""
deploy-analytics-v2.py
=======================
Deploys analytics v2: teams, dispositions, drill-down, dashboard charts.
NO sidebar changes — all analytics accessed via dashboard drill-down.

Steps:
  1. Upload all changed/new files via SFTP
  2. Run prisma db push via temp container (Prisma 6) on Docker network
  3. Rebuild + restart app container
  4. Cleanup Docker build cache and orphan images (non-fatal)
"""
import sys
import os
import paramiko

HOST        = "192.168.80.243"
USER        = "root"
PASS        = os.environ["QORE_SSH_PASSWORD"]
REMOTE_ROOT = "/opt/qa-form-creator"
DOCKER_NET  = "qa-form-creator_default"

LOCAL_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

FILES = [
    # Schema
    "prisma/schema.prisma",

    # Dashboard (enhanced + userRole prop)
    "src/app/(dashboard)/page.tsx",
    "src/app/(dashboard)/dashboard-client.tsx",

    # Analytics — agent drill-down
    "src/app/(dashboard)/analytics/agents/page.tsx",
    "src/app/(dashboard)/analytics/agents/agents-client.tsx",
    "src/app/(dashboard)/analytics/agents/[agentId]/page.tsx",
    "src/app/(dashboard)/analytics/agents/[agentId]/agent-detail-client.tsx",

    # Analytics — evaluator drill-down
    "src/app/(dashboard)/analytics/evaluators/[userId]/page.tsx",
    "src/app/(dashboard)/analytics/evaluators/[userId]/evaluator-detail-client.tsx",

    # Analytics — team drill-down + overview
    "src/app/(dashboard)/analytics/teams/page.tsx",
    "src/app/(dashboard)/analytics/teams/teams-analytics-client.tsx",
    "src/app/(dashboard)/analytics/teams/[teamId]/page.tsx",
    "src/app/(dashboard)/analytics/teams/[teamId]/team-detail-client.tsx",

    # Analytics — dispositions overview
    "src/app/(dashboard)/analytics/dispositions/page.tsx",
    "src/app/(dashboard)/analytics/dispositions/dispositions-analytics-client.tsx",

    # Analytics — disposition drill-down (new)
    "src/app/(dashboard)/analytics/dispositions/[dispositionId]/page.tsx",
    "src/app/(dashboard)/analytics/dispositions/[dispositionId]/disposition-detail-client.tsx",

    # Analytics — response drill-down (new)
    "src/app/(dashboard)/analytics/responses/[responseId]/page.tsx",
    "src/app/(dashboard)/analytics/responses/[responseId]/response-detail-client.tsx",

    # Analytics — responses filtered list (new)
    "src/app/(dashboard)/analytics/responses/page.tsx",
    "src/app/(dashboard)/analytics/responses/responses-list-client.tsx",

    # Analytics — export
    "src/app/(dashboard)/analytics/export/page.tsx",
    "src/app/(dashboard)/analytics/export/export-client.tsx",

    # Campaign admin (tabs: Teams + Dispositions)
    "src/app/(dashboard)/admin/campaigns/page.tsx",
    "src/app/(dashboard)/admin/campaigns/campaigns-client.tsx",

    # Admin — teams
    "src/app/(dashboard)/admin/teams/page.tsx",
    "src/app/(dashboard)/admin/teams/teams-client.tsx",

    # Admin — agents (team assignment)
    "src/app/(dashboard)/admin/agents/page.tsx",
    "src/app/(dashboard)/admin/agents/agents-client.tsx",
    "src/components/admin/agent-form.tsx",

    # Admin — dispositions
    "src/app/(dashboard)/admin/dispositions/page.tsx",
    "src/app/(dashboard)/admin/dispositions/dispositions-client.tsx",

    # Forms pages (QA role expansion)
    "src/app/(dashboard)/forms/page.tsx",
    "src/app/(dashboard)/forms/new/page.tsx",
    "src/app/(dashboard)/forms/[id]/edit/page.tsx",

    # KPIs page
    "src/app/(dashboard)/kpis/kpis-client.tsx",

    # Components — new
    "src/components/admin/team-form.tsx",
    "src/components/admin/disposition-form.tsx",
    "src/components/forms/disposition-combobox.tsx",

    # Components — modified
    "src/components/forms/form-viewer.tsx",
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

    # -- 2. Prisma db push (temp container with Prisma 6) ----------------------
    log("\n[2/3] Running prisma db push (Prisma 6 temp container)...")
    push_cmd = (
        f"docker run --rm --network {DOCKER_NET} "
        f"-v {REMOTE_ROOT}/prisma:/app/prisma "
        f"-w /app "
        f"-e DATABASE_URL='postgresql://qa_user:IDhEcK6wozgE2WDrFVzl9hrFmKSh7I2m@db:5432/qa_form_creator' "
        f"node:20-slim sh -c '"
        f"npm i -g prisma@6 2>/dev/null && prisma db push --skip-generate 2>&1"
        f"'"
    )
    _, stdout, stderr = client.exec_command(push_cmd, timeout=120)
    out_txt = stdout.read().decode().strip()
    err_txt = stderr.read().decode().strip()
    if out_txt:
        for line in out_txt.split("\n"):
            log(f"  {line}")
    if err_txt:
        log(f"  STDERR: {err_txt}")

    # -- 3. Rebuild + restart app container ------------------------------------
    log("\n[3/4] Rebuilding + restarting app container...")
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
    _, stdout, stderr = client.exec_command(build_cmd, timeout=1800)

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

    # -- 4. Cleanup Docker cache + orphan images (non-fatal) ------------------
    # This deletes the build cache from BuildKit and any dangling images (<none>
    # tags). It does NOT touch running containers, volumes (DB data), or the
    # currently-used images. Safe to run live, no downtime.
    log("\n[4/4] Cleanup: Docker build cache + orphan images...")
    cleanup_cmd = (
        "echo '--- disk before ---' && "
        "df -h / | tail -1 && "
        "echo '--- cleaning build cache ---' && "
        "docker builder prune -a -f 2>&1 | tail -3 && "
        "echo '--- cleaning orphan images ---' && "
        "docker image prune -a -f 2>&1 | tail -3 && "
        "echo '--- disk after ---' && "
        "df -h / | tail -1"
    )
    try:
        _, stdout, stderr = client.exec_command(cleanup_cmd, timeout=180)
        out_txt = stdout.read().decode(errors="replace").strip()
        err_txt = stderr.read().decode(errors="replace").strip()
        if out_txt:
            for line in out_txt.split("\n"):
                log(f"  {line}")
        if err_txt:
            log(f"  (cleanup stderr, non-fatal): {err_txt[-300:]}")
    except Exception as e:
        log(f"  Cleanup step failed (non-fatal): {e}")

    client.close()

    log(f"\nDeploy exit code: {code}")
    if code == 0:
        log("\nDeploy completed successfully!")
    else:
        log("\nDeploy had warnings. Check container logs:")
        log(f"  ssh root@{HOST} 'docker logs qa_form_creator_app --tail 50'")

    sys.exit(code)


if __name__ == "__main__":
    main()
