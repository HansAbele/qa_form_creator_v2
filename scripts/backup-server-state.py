"""
Download the current deployed source code from the production server
to create a git backup before deploying new changes.
"""
import paramiko
import os
import stat

SERVER = "192.168.80.243"
USER = "root"
PASSWORD = os.environ["QORE_SSH_PASSWORD"]
REMOTE_ROOT = "/opt/qa-form-creator"
LOCAL_BACKUP = os.path.join(os.path.dirname(os.path.dirname(__file__)), "_server_backup")

# Directories/files to download from server
DOWNLOAD_PATHS = [
    "prisma/schema.prisma",
    "src",
    "package.json",
    "next.config.ts",
    "Dockerfile",
    "docker-compose.prod.yml",
    "tsconfig.json",
    "biome.json",
    "components.json",
    "postcss.config.mjs",
]

# Directories/files to skip
SKIP = {".next", "node_modules", ".git", "__pycache__"}


def download_dir(sftp, remote_path, local_path):
    """Recursively download a remote directory."""
    os.makedirs(local_path, exist_ok=True)
    try:
        items = sftp.listdir_attr(remote_path)
    except FileNotFoundError:
        print(f"  [SKIP] {remote_path} not found on server")
        return

    for item in items:
        if item.filename in SKIP:
            continue
        remote_item = f"{remote_path}/{item.filename}"
        local_item = os.path.join(local_path, item.filename)

        if stat.S_ISDIR(item.st_mode):
            download_dir(sftp, remote_item, local_item)
        else:
            try:
                sftp.get(remote_item, local_item)
            except Exception as e:
                print(f"  [WARN] Could not download {remote_item}: {e}")


def main():
    print(f"Connecting to {SERVER}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SERVER, username=USER, password=PASSWORD, timeout=10)
    sftp = ssh.open_sftp()
    print("Connected. Downloading server source code...\n")

    # Clean old backup
    if os.path.exists(LOCAL_BACKUP):
        import shutil
        shutil.rmtree(LOCAL_BACKUP)

    os.makedirs(LOCAL_BACKUP, exist_ok=True)

    for path in DOWNLOAD_PATHS:
        remote = f"{REMOTE_ROOT}/{path}"
        local = os.path.join(LOCAL_BACKUP, path)

        try:
            attr = sftp.stat(remote)
            if stat.S_ISDIR(attr.st_mode):
                print(f"  [DIR]  {path}/")
                download_dir(sftp, remote, local)
            else:
                print(f"  [FILE] {path}")
                os.makedirs(os.path.dirname(local), exist_ok=True)
                sftp.get(remote, local)
        except FileNotFoundError:
            print(f"  [SKIP] {path} not found on server")

    sftp.close()
    ssh.close()
    print(f"\nDone. Server source code saved to: {LOCAL_BACKUP}")


if __name__ == "__main__":
    main()
