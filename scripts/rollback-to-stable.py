#!/usr/bin/env python3
"""
rollback-to-stable.py
=====================
Rolls back the production server to the 'stable' branch state.

Steps:
  1. Upload all modified files (stable versions) via SFTP
  2. Delete new files that only exist in master
  3. Drop new DB tables/columns that were added
  4. Rebuild + restart app container
"""
import sys
import os
import subprocess
import paramiko

HOST        = "192.168.80.243"
USER        = "root"
PASS        = os.environ["QORE_SSH_PASSWORD"]
REMOTE_ROOT = "/opt/qa-form-creator"

DB_CONTAINER = "qa_form_creator_db"
DB_USER      = "qa_user"
DB_NAME      = "qa_form_creator"

LOCAL_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# Files modified in master that need to be reverted to stable versions
MODIFIED_FILES = [
    "prisma/schema.prisma",
    "src/app/(dashboard)/dashboard-client.tsx",
    "src/app/(dashboard)/forms/[id]/edit/page.tsx",
    "src/app/(dashboard)/forms/new/page.tsx",
    "src/app/(dashboard)/forms/page.tsx",
    "src/components/forms/form-viewer.tsx",
    "src/components/layout/header.tsx",
    "src/components/layout/sidebar.tsx",
    "src/server/actions/agents.ts",
    "src/server/actions/forms.ts",
    "src/server/actions/responses.ts",
    "src/server/queries/analytics.ts",
]

# Files that only exist in master and need to be deleted from server
NEW_FILES = [
    "src/app/(dashboard)/admin/dispositions/dispositions-client.tsx",
    "src/app/(dashboard)/admin/dispositions/page.tsx",
    "src/app/(dashboard)/admin/teams/page.tsx",
    "src/app/(dashboard)/admin/teams/teams-client.tsx",
    "src/app/(dashboard)/analytics/agents/[agentId]/agent-detail-client.tsx",
    "src/app/(dashboard)/analytics/agents/[agentId]/page.tsx",
    "src/app/(dashboard)/analytics/dispositions/dispositions-analytics-client.tsx",
    "src/app/(dashboard)/analytics/dispositions/page.tsx",
    "src/app/(dashboard)/analytics/evaluators/[userId]/evaluator-detail-client.tsx",
    "src/app/(dashboard)/analytics/evaluators/[userId]/page.tsx",
    "src/app/(dashboard)/analytics/teams/[teamId]/page.tsx",
    "src/app/(dashboard)/analytics/teams/[teamId]/team-detail-client.tsx",
    "src/app/(dashboard)/analytics/teams/page.tsx",
    "src/app/(dashboard)/analytics/teams/teams-analytics-client.tsx",
    "src/components/admin/disposition-form.tsx",
    "src/components/admin/team-form.tsx",
    "src/components/forms/disposition-combobox.tsx",
    "src/server/actions/dispositions.ts",
    "src/server/actions/teams.ts",
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


def get_stable_file(rel_path):
    """Extract file content from the 'stable' git branch."""
    git_path = rel_path.replace("\\", "/")
    result = subprocess.run(
        ["git", "show", f"stable:{git_path}"],
        capture_output=True, cwd=LOCAL_ROOT,
    )
    if result.returncode != 0:
        return None
    return result.stdout


def main():
    log("=== ROLLBACK TO STABLE ===\n")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    log(f"Connecting to {HOST}...")
    client.connect(HOST, username=USER, password=PASS, timeout=15)

    transport = client.get_transport()
    if transport is None:
        sys.exit("SSH transport unavailable")
    sftp = paramiko.SFTPClient.from_transport(transport)

    # -- 1. Upload stable versions of modified files ---------------------------
    log("\n[1/4] Reverting modified files to stable versions...")
    for rel in MODIFIED_FILES:
        content = get_stable_file(rel)
        if content is None:
            log(f"  [SKIP] {rel} (not in stable branch)")
            continue
        remote = f"{REMOTE_ROOT}/{rel}"
        remote_dir = remote.rsplit("/", 1)[0]
        ensure_remote_dir(sftp, remote_dir)

        # Write via temp file
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False, suffix=".tmp") as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        sftp.put(tmp_path, remote)
        os.unlink(tmp_path)
        log(f"  [REVERTED] {rel}  ({len(content):,} bytes)")

    # -- 2. Delete new files from server ---------------------------------------
    log("\n[2/4] Deleting new files that were added by analytics feature...")
    for rel in NEW_FILES:
        remote = f"{REMOTE_ROOT}/{rel}"
        try:
            sftp.remove(remote)
            log(f"  [DELETED] {rel}")
        except FileNotFoundError:
            log(f"  [SKIP] {rel} (not found)")

    # Also try to remove empty directories
    dirs_to_clean = [
        "src/app/(dashboard)/admin/dispositions",
        "src/app/(dashboard)/admin/teams",
        "src/app/(dashboard)/analytics/agents/[agentId]",
        "src/app/(dashboard)/analytics/dispositions",
        "src/app/(dashboard)/analytics/evaluators/[userId]",
        "src/app/(dashboard)/analytics/evaluators",
        "src/app/(dashboard)/analytics/teams/[teamId]",
        "src/app/(dashboard)/analytics/teams",
    ]
    for d in dirs_to_clean:
        remote_dir = f"{REMOTE_ROOT}/{d}"
        try:
            sftp.rmdir(remote_dir)
            log(f"  [RMDIR] {d}/")
        except Exception:
            pass  # Not empty or doesn't exist

    sftp.close()

    # -- 3. Rollback database schema -------------------------------------------
    log("\n[3/4] Rolling back database schema...")

    # Drop new columns first (foreign keys), then tables
    rollback_sql = """
-- Drop foreign key columns added by analytics feature
ALTER TABLE "Agent" DROP COLUMN IF EXISTS "teamId";
ALTER TABLE "Response" DROP COLUMN IF EXISTS "dispositionId";

-- Drop new tables
DROP TABLE IF EXISTS "Disposition" CASCADE;
DROP TABLE IF EXISTS "DispositionCategory" CASCADE;
DROP TABLE IF EXISTS "Team" CASCADE;
"""
    apply_cmd = (
        f"docker exec -i {DB_CONTAINER} psql -U {DB_USER} -d {DB_NAME} -v ON_ERROR_STOP=0"
    )
    stdin, stdout, stderr = client.exec_command(apply_cmd, timeout=60)
    stdin.write(rollback_sql)
    stdin.channel.shutdown_write()
    out_txt = stdout.read().decode().strip()
    err_txt = stderr.read().decode().strip()
    if out_txt:
        log(f"  {out_txt}")
    if err_txt:
        log(f"  STDERR: {err_txt}")

    # -- 4. Rebuild + restart app container ------------------------------------
    log("\n[4/4] Rebuilding + restarting app container...")
    build_cmd = (
        f"cd {REMOTE_ROOT} && "
        "docker compose -f docker-compose.prod.yml --env-file .env.production "
        "build --no-cache app 2>&1 | tail -20 && "
        "echo '--- BUILD DONE ---' && "
        "docker compose -f docker-compose.prod.yml --env-file .env.production "
        "up -d 2>&1 && "
        "echo '--- RESTARTING... ---' && "
        "sleep 20 && "
        "docker ps --format 'table {{.Names}}\\t{{.Status}}' | grep qa_ && "
        "echo '---' && "
        "curl -sk https://192.168.80.243/api/health || echo 'Health check pending'"
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

    log(f"\nRollback exit code: {code}")
    if code == 0:
        log("\nRollback completed successfully!")
        log("  Server is now running the stable version.")
    else:
        log("\nRollback had issues. Check container logs:")
        log(f"  ssh root@{HOST} 'docker logs qa_form_creator_app --tail 50'")

    sys.exit(code)


if __name__ == "__main__":
    main()
