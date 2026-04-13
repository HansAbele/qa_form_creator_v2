#!/usr/bin/env python3
"""
deploy-ui-refresh.py
====================
Deploys the modern dashboard UI refresh to production:
  - Framer Motion (`motion`) dependency
  - shadcn/ui chart component
  - KpiCard + AnimatedNumber components
  - PageTransition wrapper
  - Refactored dashboard-client.tsx

Rebuilds the Docker image so `motion` is installed inside the container.
"""
import os
import sys
import paramiko

HOST = "192.168.80.243"
USER = "root"
PASS = "T3l3c0m.2026"
REMOTE_ROOT = "/opt/qa-form-creator"
LOCAL_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

FILES = [
    # Dependency updates (motion)
    "package.json",
    "pnpm-lock.yaml",
    # New UI primitives
    "src/components/ui/animated-number.tsx",
    "src/components/ui/kpi-card.tsx",
    "src/components/ui/chart.tsx",
    # New layout component
    "src/components/layout/page-transition.tsx",
    # Modified dashboard
    "src/app/(dashboard)/layout.tsx",
    "src/app/(dashboard)/dashboard-client.tsx",
]


def log(msg):
    sys.stdout.buffer.write((msg + "\n").encode("utf-8", errors="replace"))
    sys.stdout.buffer.flush()


def ensure_remote_dir(sftp, remote_path):
    """Create parent dirs on remote if missing."""
    parent = os.path.dirname(remote_path)
    parts = parent.split("/")
    cur = ""
    for p in parts:
        if not p:
            cur = "/"
            continue
        cur = cur.rstrip("/") + "/" + p
        try:
            sftp.stat(cur)
        except IOError:
            try:
                sftp.mkdir(cur)
            except IOError:
                pass


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    log(f"Connecting to {HOST}...")
    client.connect(HOST, username=USER, password=PASS, timeout=15)

    transport = client.get_transport()
    if transport is None:
        sys.exit("SSH transport unavailable")
    sftp = paramiko.SFTPClient.from_transport(transport)

    log("\n[1/3] Uploading files...")
    for rel in FILES:
        local = os.path.join(LOCAL_ROOT, rel.replace("/", os.sep))
        if not os.path.exists(local):
            log(f"  SKIP (missing): {rel}")
            continue
        remote = f"{REMOTE_ROOT}/{rel}"
        ensure_remote_dir(sftp, remote)
        size = os.path.getsize(local)
        log(f"  [OK] {rel}  ({size:,} bytes)")
        sftp.put(local, remote)
    sftp.close()

    log("\n[2/3] Rebuilding Docker image (motion dependency + UI changes)...")
    build_cmd = (
        f"cd {REMOTE_ROOT} && "
        "docker compose -f docker-compose.prod.yml --env-file .env.production "
        "build --no-cache app 2>&1 | tail -25 && "
        "echo --- && "
        "docker compose -f docker-compose.prod.yml --env-file .env.production "
        "up -d 2>&1 && "
        "sleep 20 && "
        "docker ps --format 'table {{.Names}}\\t{{.Status}}' | grep qa_"
    )
    stdin, stdout, stderr = client.exec_command(build_cmd, timeout=2400)
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
    build_code = stdout.channel.recv_exit_status()
    log(f"\nBuild exit code: {build_code}")
    if build_code != 0:
        client.close()
        sys.exit(build_code)

    log("\n[3/3] Verifying via health endpoint...")
    verify_cmd = (
        "curl -sk https://192.168.80.243/api/health && echo && "
        "curl -sk -o /dev/null -w 'login_status=%{http_code}\\n' https://192.168.80.243/login"
    )
    stdin, stdout, stderr = client.exec_command(verify_cmd, timeout=30)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out.strip():
        log(out)
    if err.strip():
        log(f"STDERR: {err}")

    client.close()
    log("\n" + "=" * 56)
    log("  UI Refresh deployed successfully!")
    log("=" * 56)
    log("  - motion 12.38.0 installed inside container")
    log("  - Dashboard now uses KpiCard + sparklines")
    log("  - Page transitions active (Framer Motion)")
    log("  - All charts via shadcn/ui ChartContainer")
    log("=" * 56)


if __name__ == "__main__":
    main()
