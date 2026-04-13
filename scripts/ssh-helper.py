#!/usr/bin/env python3
"""SSH helper for deploying to remote server via paramiko."""
import sys
import paramiko
import os
import time

HOST = "192.168.80.243"
USER = "root"
PASS = "T3l3c0m.2026"

def ssh_exec(cmd, timeout=600):
    """Execute a command via SSH and stream output."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS, timeout=10)

    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)

    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    exit_code = stdout.channel.recv_exit_status()

    client.close()

    if out:
        sys.stdout.buffer.write(out.encode("utf-8", errors="replace"))
        sys.stdout.buffer.flush()
    if err:
        sys.stderr.buffer.write(err.encode("utf-8", errors="replace"))
        sys.stderr.buffer.flush()

    return exit_code

def scp_upload(local_path, remote_path):
    """Upload a file via SFTP."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS, timeout=10)

    transport = client.get_transport()
    sftp = paramiko.SFTPClient.from_transport(transport)
    local_path = os.path.abspath(local_path)
    sftp.put(local_path, remote_path)
    sftp.close()
    client.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: ssh-helper.py <command>")
        print("       ssh-helper.py upload <local> <remote>")
        sys.exit(1)

    if sys.argv[1] == "upload":
        scp_upload(sys.argv[2], sys.argv[3])
        print(f"Uploaded {sys.argv[2]} -> {sys.argv[3]}")
    else:
        cmd = " ".join(sys.argv[1:])
        exit_code = ssh_exec(cmd)
        sys.exit(exit_code)
