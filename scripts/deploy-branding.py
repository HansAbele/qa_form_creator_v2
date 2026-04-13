#!/usr/bin/env python3
"""One-shot deploy: upload TNO branding files + rebuild Docker on server."""
import sys
import os
import paramiko

HOST = "192.168.80.243"
USER = "root"
PASS = "T3l3c0m.2026"
REMOTE_ROOT = "/opt/qa-form-creator"
LOCAL_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

FILES = [
    "src/app/globals.css",
    "src/app/layout.tsx",
    "src/app/login/page.tsx",
    "src/app/(dashboard)/dashboard-client.tsx",
    "src/app/(dashboard)/kpis/kpis-client.tsx",
    "src/app/(dashboard)/analytics/agents/agents-client.tsx",
    "src/components/layout/sidebar.tsx",
    "src/components/brand/logo.tsx",
    "public/tno-logo.svg",
]

REMOTE_DIRS_TO_ENSURE = [
    "src/components/brand",
]


def log(msg):
    sys.stdout.buffer.write((msg + "\n").encode("utf-8", errors="replace"))
    sys.stdout.buffer.flush()


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    log(f"Connecting to {HOST}...")
    client.connect(HOST, username=USER, password=PASS, timeout=15)

    # SFTP upload
    transport = client.get_transport()
    sftp = paramiko.SFTPClient.from_transport(transport)

    for rel in REMOTE_DIRS_TO_ENSURE:
        remote_dir = f"{REMOTE_ROOT}/{rel}"
        try:
            sftp.stat(remote_dir)
        except FileNotFoundError:
            log(f"Creating dir: {remote_dir}")
            # mkdir -p equivalent
            parts = rel.split("/")
            cur = REMOTE_ROOT
            for p in parts:
                cur = f"{cur}/{p}"
                try:
                    sftp.stat(cur)
                except FileNotFoundError:
                    sftp.mkdir(cur)

    for rel in FILES:
        local = os.path.join(LOCAL_ROOT, rel.replace("/", os.sep))
        remote = f"{REMOTE_ROOT}/{rel}"
        if not os.path.exists(local):
            log(f"MISSING local file: {local}")
            continue
        log(f"Uploading: {rel}")
        sftp.put(local, remote)

    sftp.close()
    log("All files uploaded.")

    # Rebuild Docker
    log("\nStarting rebuild on server...")
    cmd = (
        f"cd {REMOTE_ROOT} && "
        "docker compose -f docker-compose.prod.yml build --no-cache app 2>&1 | tail -30 && "
        "echo '--- Restarting containers ---' && "
        "docker compose -f docker-compose.prod.yml up -d 2>&1 && "
        "echo BUILD_EXIT=$?"
    )
    stdin, stdout, stderr = client.exec_command(cmd, timeout=1800)

    # Stream output
    while not stdout.channel.exit_status_ready():
        if stdout.channel.recv_ready():
            data = stdout.channel.recv(4096)
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
        if stdout.channel.recv_stderr_ready():
            data = stdout.channel.recv_stderr(4096)
            sys.stderr.buffer.write(data)
            sys.stderr.buffer.flush()

    # Drain remaining
    rem_out = stdout.read()
    rem_err = stderr.read()
    if rem_out:
        sys.stdout.buffer.write(rem_out)
    if rem_err:
        sys.stderr.buffer.write(rem_err)
    sys.stdout.buffer.flush()
    sys.stderr.buffer.flush()

    exit_code = stdout.channel.recv_exit_status()
    log(f"\nDeploy exit code: {exit_code}")
    client.close()
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
