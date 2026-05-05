#!/usr/bin/env python3
"""
deploy-select-fix.py
====================
Fixes SelectValue showing raw IDs instead of labels.

Root cause: @base-ui/react's Select.Value renders the raw value by default.
Fix: pass a children render function that maps value -> label from the
data source (campaigns, forms, agents, question types, roles).

Affected files: 7
"""
import os
import sys
import paramiko

HOST = "192.168.80.243"
USER = "root"
PASS = os.environ["QORE_SSH_PASSWORD"]
REMOTE_ROOT = "/opt/qa-form-creator"
LOCAL_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

FILES = [
    "src/app/(dashboard)/admin/agents/agents-client.tsx",
    "src/components/admin/agent-form.tsx",
    "src/components/admin/user-form.tsx",
    "src/components/forms/form-builder.tsx",
    "src/components/forms/form-viewer.tsx",
    "src/components/forms/question-card.tsx",
    "src/app/(dashboard)/analytics/export/export-client.tsx",
    "src/app/(dashboard)/reports/reports-client.tsx",
]


def log(msg):
    sys.stdout.buffer.write((msg + "\n").encode("utf-8", errors="replace"))
    sys.stdout.buffer.flush()


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    log(f"Connecting to {HOST}...")
    client.connect(HOST, username=USER, password=PASS, timeout=15)

    transport = client.get_transport()
    if transport is None:
        sys.exit("SSH transport unavailable")
    sftp = paramiko.SFTPClient.from_transport(transport)

    log("\n[1/2] Uploading files...")
    for rel in FILES:
        local = os.path.join(LOCAL_ROOT, rel.replace("/", os.sep))
        remote = f"{REMOTE_ROOT}/{rel}"
        size = os.path.getsize(local)
        log(f"  [OK] {rel}  ({size:,} bytes)")
        sftp.put(local, remote)
    sftp.close()

    log("\n[2/2] Rebuilding + restarting app container...")
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
