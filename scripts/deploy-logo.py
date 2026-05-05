#!/usr/bin/env python3
"""Deploy real TNO logo PNG + updated Logo component + middleware fix."""
import sys
import os
import paramiko

HOST = "192.168.80.243"
USER = "root"
PASS = os.environ["QORE_SSH_PASSWORD"]
REMOTE_ROOT = "/opt/qa-form-creator"
LOCAL_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

FILES = [
    "public/tno-logo.png",
    "src/components/brand/logo.tsx",
    "src/middleware.ts",
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
        if not os.path.exists(local):
            log(f"MISSING local file: {local}")
            continue
        log(f"Uploading: {rel} ({os.path.getsize(local)} bytes)")
        sftp.put(local, remote)

    # Remove obsolete SVG placeholder on server
    try:
        sftp.remove(f"{REMOTE_ROOT}/public/tno-logo.svg")
        log("Removed obsolete: public/tno-logo.svg")
    except FileNotFoundError:
        log("No stale SVG to remove (already absent)")

    sftp.close()
    log("All files uploaded.\n")

    # Rebuild
    log("Starting rebuild on server...")
    cmd = (
        f"cd {REMOTE_ROOT} && "
        "docker compose -f docker-compose.prod.yml --env-file .env.production build app 2>&1 | tail -15 && "
        "echo '--- Restarting containers ---' && "
        "docker compose -f docker-compose.prod.yml --env-file .env.production up -d 2>&1 && "
        "sleep 25 && "
        "docker ps --format 'table {{.Names}}\\t{{.Status}}' | grep qa_ && "
        "echo --- && "
        "curl -sk https://192.168.80.243/api/health && "
        "echo && "
        "curl -sIk https://192.168.80.243/tno-logo.png | head -5 && "
        "echo BUILD_EXIT=$?"
    )
    stdin, stdout, stderr = client.exec_command(cmd, timeout=1800)

    while not stdout.channel.exit_status_ready():
        if stdout.channel.recv_ready():
            data = stdout.channel.recv(4096)
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
        if stdout.channel.recv_stderr_ready():
            data = stdout.channel.recv_stderr(4096)
            sys.stderr.buffer.write(data)
            sys.stderr.buffer.flush()

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
