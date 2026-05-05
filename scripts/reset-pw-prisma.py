#!/usr/bin/env python3
"""Reset a user's password via SQL, using SFTP to avoid shell escaping."""
import sys
import os
import paramiko

HOST = "192.168.80.243"
USER = "root"
PASS = os.environ["QORE_SSH_PASSWORD"]

EMAIL = "aperalta@tnoutsourcing.com"
NEW_PASSWORD = os.environ["QORE_RESET_PASSWORD"]


def run(client, cmd, label=""):
    _, stdout, stderr = client.exec_command(cmd, timeout=60)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if label:
        print(f"[{label}] {out}")
    if err and "WARNING" not in err:
        print(f"  stderr: {err[-300:]}")
    return out


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS, timeout=15)

    # Step 1: Check current user status
    print("Checking user...")
    run(client,
        'docker exec qa_form_creator_db psql -U qa_user -d qa_form_creator -t -A '
        '''-c "SELECT email, active, length(password) FROM \\"User\\" WHERE email='aperalta@tnoutsourcing.com'"''',
        "user")

    # Step 2: Generate hash in a temp node container (has bcryptjs built-in)
    # Write a node script via SFTP to /tmp on the HOST
    node_script = """
const { execSync } = require('child_process');
execSync('npm i -s bcryptjs 2>/dev/null', { cwd: '/hostdata' });
const bcryptjs = require('bcryptjs');
const hash = bcryptjs.hashSync('""" + NEW_PASSWORD + """', 10);
const ok = bcryptjs.compareSync('""" + NEW_PASSWORD + """', hash);
console.log(JSON.stringify({ hash, len: hash.length, verify: ok }));
"""

    transport = client.get_transport()
    sftp = paramiko.SFTPClient.from_transport(transport)
    with sftp.open("/tmp/genhash.js", "w") as f:
        f.write(node_script)

    print("Generating bcrypt hash in temp container...")
    result = run(client,
                 "docker run --rm -v /tmp:/hostdata node:20-slim node /hostdata/genhash.js",
                 "hash")

    if not result:
        print("ERROR: No output from hash generation")
        sftp.close()
        client.close()
        sys.exit(1)

    import json
    data = json.loads(result.split("\n")[-1])  # last line is JSON
    hash_val = data["hash"]
    print(f"  Hash: {hash_val[:25]}... (len={data['len']}, verify={data['verify']})")

    if not data["verify"]:
        print("ERROR: Hash self-verification failed!")
        sys.exit(1)

    # Step 3: Write SQL file via SFTP (avoids ALL shell escaping)
    sql = f"""UPDATE "User" SET password = '{hash_val}' WHERE email = '{EMAIL}';"""
    with sftp.open("/tmp/reset-pw.sql", "w") as f:
        f.write(sql)
    sftp.close()

    # Step 4: Copy SQL into db container and execute
    print("Updating password in DB...")
    run(client,
        "docker cp /tmp/reset-pw.sql qa_form_creator_db:/tmp/reset-pw.sql",
        "copy")
    run(client,
        "docker exec qa_form_creator_db psql -U qa_user -d qa_form_creator -f /tmp/reset-pw.sql",
        "sql")

    # Step 5: Verify stored hash
    print("Verifying stored hash...")
    stored = run(client,
        'docker exec qa_form_creator_db psql -U qa_user -d qa_form_creator -t -A '
        '''-c "SELECT password FROM \\"User\\" WHERE email='aperalta@tnoutsourcing.com'"''',
        "stored")

    if stored == hash_val:
        print("  Hash matches exactly!")
    else:
        print(f"  WARNING: Stored hash differs!")
        print(f"  Expected: {hash_val}")
        print(f"  Got:      {stored}")
        print(f"  Expected len: {len(hash_val)}, Got len: {len(stored)}")

    # Step 6: Verify bcrypt compare works with the stored hash
    verify_script = f"""
const {{ execSync }} = require('child_process');
execSync('npm i -s bcryptjs 2>/dev/null', {{ cwd: '/hostdata' }});
const bcryptjs = require('bcryptjs');
const stored = '{stored}';
const ok = bcryptjs.compareSync('{NEW_PASSWORD}', stored);
console.log(JSON.stringify({{ verify: ok, storedLen: stored.length }}));
"""
    with sftp.open("/tmp/verifyhash.js", "w") as f:
        f.write(verify_script)

    # Reopen SFTP since we closed it
    transport = client.get_transport()
    sftp = paramiko.SFTPClient.from_transport(transport)
    with sftp.open("/tmp/verifyhash.js", "w") as f:
        f.write(verify_script)
    sftp.close()

    print("Verifying compare works...")
    run(client,
        "docker run --rm -v /tmp:/hostdata node:20-slim node /hostdata/verifyhash.js",
        "verify")

    # Cleanup
    run(client, "rm -f /tmp/genhash.js /tmp/reset-pw.sql /tmp/verifyhash.js")
    run(client, "docker exec qa_form_creator_db rm -f /tmp/reset-pw.sql")

    client.close()
    print("\nDone! Try logging in with the password from QORE_RESET_PASSWORD.")


if __name__ == "__main__":
    main()
