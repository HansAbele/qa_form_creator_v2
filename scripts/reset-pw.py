import paramiko
import os

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.80.243", username="root", password=os.environ["QORE_SSH_PASSWORD"], timeout=15)

# Step 1: Write a Node.js script via SFTP
reset_password = os.environ["QORE_RESET_PASSWORD"]
escaped_password = reset_password.replace("\\", "\\\\").replace('"', '\\"')
node_script = """
const { execSync } = require("child_process");
execSync("npm i -s bcryptjs 2>/dev/null", { cwd: "/tmp" });
process.chdir("/tmp");
const bcryptjs = require("bcryptjs");
const hash = bcryptjs.hashSync("__RESET_PASSWORD__", 10);
const fs = require("fs");
const sql = `UPDATE "User" SET password = '${hash}' WHERE email = 'aperalta@tnoutsourcing.com';`;
fs.writeFileSync("/hostdata/pw.sql", sql);
console.log("OK:" + hash.substring(0, 10));
""".replace("__RESET_PASSWORD__", escaped_password)

transport = c.get_transport()
sftp = paramiko.SFTPClient.from_transport(transport)
with sftp.open("/tmp/genhash.js", "w") as f:
    f.write(node_script)
sftp.close()

# Step 2: Run in temp container
print("Generating hash...")
_, stdout, stderr = c.exec_command(
    "docker run --rm -v /tmp:/hostdata node:20-slim node /hostdata/genhash.js",
    timeout=60,
)
print(stdout.read().decode().strip())
err = stderr.read().decode().strip()
if err:
    print("WARN:", err[-200:])

# Step 3: Execute SQL
print("Updating DB...")
_, stdout, _ = c.exec_command(
    "docker cp /tmp/pw.sql qa_form_creator_db:/tmp/pw.sql && "
    "docker exec qa_form_creator_db psql -U qa_user -d qa_form_creator -f /tmp/pw.sql"
)
print(stdout.read().decode().strip())

# Step 4: Verify stored hash looks right
_, stdout, _ = c.exec_command(
    "docker exec qa_form_creator_db psql -U qa_user -d qa_form_creator -t -A "
    """-c "SELECT length(password), substring(password,1,10) FROM \\"User\\" WHERE email='aperalta@tnoutsourcing.com'" """
)
print("Verify:", stdout.read().decode().strip())

c.close()
print("Done!")
