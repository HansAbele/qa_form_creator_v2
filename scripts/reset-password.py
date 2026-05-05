#!/usr/bin/env python3
"""Reset a user's password in production."""
import sys
import os
import paramiko

HOST = "192.168.80.243"
USER = "root"
PASS = os.environ["QORE_SSH_PASSWORD"]

EMAIL = "aperalta@tnoutsourcing.com"
NEW_PASSWORD = os.environ["QORE_RESET_PASSWORD"]


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASS, timeout=15)

    # Step 1: Generate bcryptjs hash inside the app container
    print("Generating hash inside app container...")
    gen_cmd = (
        'docker exec qa_form_creator_app node -e '
        '"const b=require(\'bcryptjs\');console.log(b.hashSync(\'' + NEW_PASSWORD + '\',10))"'
    )
    _, stdout, stderr = client.exec_command(gen_cmd)
    hash_val = stdout.read().decode().strip()
    err = stderr.read().decode().strip()

    if not hash_val or not hash_val.startswith("$"):
        print(f"Failed to generate hash. Output: {hash_val}")
        if err:
            print(f"Error: {err}")
        sys.exit(1)

    print(f"Hash: {hash_val[:25]}...")

    # Step 2: Write a temp SQL file inside db container to avoid shell escaping
    sql = f"UPDATE \"User\" SET password = '{hash_val}' WHERE email = '{EMAIL}';"
    write_sql = f"docker exec qa_form_creator_db bash -c 'cat > /tmp/pw.sql << EOSQL\n{sql}\nEOSQL'"
    client.exec_command(write_sql)

    # Step 3: Execute the SQL file
    exec_cmd = "docker exec qa_form_creator_db psql -U qa_user -d qa_form_creator -f /tmp/pw.sql"
    _, stdout, stderr = client.exec_command(exec_cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    print(f"Result: {out}")
    if err:
        print(f"Stderr: {err}")

    # Step 4: Verify
    verify_cmd = (
        'docker exec qa_form_creator_app node -e '
        '"const b=require(\'bcryptjs\');"'
        '"const{PrismaClient}=require(\'@prisma/client\');"'
        '"const p=new PrismaClient();"'
        '"(async()=>{const u=await p.user.findUnique({where:{email:\'' + EMAIL + '\'}});"'
        '"const ok=b.compareSync(\'' + NEW_PASSWORD + '\',u.password);"'
        '"console.log(\'Verify:\',ok);await p.$disconnect();})()"'
    )
    _, stdout, _ = client.exec_command(verify_cmd)
    print(stdout.read().decode().strip())

    # Cleanup
    client.exec_command("docker exec qa_form_creator_db rm -f /tmp/pw.sql")
    client.close()


if __name__ == "__main__":
    main()
