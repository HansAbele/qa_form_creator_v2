#!/usr/bin/env python3
"""Deploy Qore rename to server."""
import sys
import os
import paramiko

HOST = "192.168.80.243"
USER = "root"
PASS = "T3l3c0m.2026"
REMOTE_ROOT = "/opt/qa-form-creator"
LOCAL_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

FILES = [
    "package.json",
    "src/app/layout.tsx",
    "src/app/login/page.tsx",
    "src/components/brand/logo.tsx",
    "src/server/actions/exports.ts",
    "tests/e2e/auth.spec.ts",
]


def log(msg):
    sys.stdout.buffer.write((msg + "\n").encode("utf-8", errors="replace"))
    sys.stdout.buffer.flush()


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    log(f"Connecting to {HOST}...")
    client.connect(HOST, username=USER, password=PASS, timeout=15)

    sftp = paramiko.SFTPClient.from_transport(client.get_transport())
    for rel in FILES:
        local = os.path.join(LOCAL_ROOT, rel.replace("/", os.sep))
        remote = f"{REMOTE_ROOT}/{rel}"
        log(f"Uploading: {rel} ({os.path.getsize(local)} bytes)")
        sftp.put(local, remote)
    sftp.close()

    log("\nRebuilding...")
    cmd = (
        f"cd {REMOTE_ROOT} && "
        "docker compose -f docker-compose.prod.yml --env-file .env.production build app 2>&1 | tail -12 && "
        "docker compose -f docker-compose.prod.yml --env-file .env.production up -d 2>&1 && "
        "sleep 25 && "
        "docker ps --format 'table {{.Names}}\\t{{.Status}}' | grep qa_ && "
        "echo --- && "
        "curl -sk https://192.168.80.243/api/health && "
        "echo && "
        "curl -sk https://192.168.80.243/login | grep -oE 'Qore|QA Form Creator' | sort -u && "
        "echo BUILD_EXIT=$?"
    )
    stdin, stdout, stderr = client.exec_command(cmd, timeout=1800)
    while not stdout.channel.exit_status_ready():
        if stdout.channel.recv_ready():
            sys.stdout.buffer.write(stdout.channel.recv(4096)); sys.stdout.buffer.flush()
        if stdout.channel.recv_stderr_ready():
            sys.stderr.buffer.write(stdout.channel.recv_stderr(4096)); sys.stderr.buffer.flush()
    sys.stdout.buffer.write(stdout.read()); sys.stderr.buffer.write(stderr.read())
    sys.stdout.buffer.flush(); sys.stderr.buffer.flush()

    exit_code = stdout.channel.recv_exit_status()
    log(f"\nDeploy exit code: {exit_code}")
    client.close()
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
