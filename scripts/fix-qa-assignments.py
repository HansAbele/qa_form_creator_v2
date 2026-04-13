#!/usr/bin/env python3
"""
fix-qa-assignments.py
=====================
Corrects UserCampaign assignments for QA users based on Odoo department data.

Logic:
  - QA users with a specific operational department in Odoo
    -> assigned ONLY to that campaign in Qore
  - QA users sitting in the generic "QA" department (dept_id=25)
    -> kept as-is (all campaigns) — requires manual review
  - ADMIN users
    -> kept as-is (all campaigns)

Run after migrate-from-odoo.py to fix the cross-join over-assignment.
"""
import sys
import re
import psycopg2
import psycopg2.extras
import paramiko

ODOO = dict(host="192.168.80.240", port=5432,
            dbname="dbodoo", user="wfm", password="T3l3c0mwfm")

SSH_HOST     = "192.168.80.243"
SSH_USER     = "root"
SSH_PASS     = "T3l3c0m.2026"
DB_CONTAINER = "qa_form_creator_db"
DB_USER      = "qa_user"
DB_NAME      = "qa_form_creator"

# Odoo dept_id for the generic "QA" department (no operational assignment)
QA_DEPT_ID = 25

# job_title substrings that map to ADMIN role in Qore
ADMIN_KW = ["qa manager", "workforce manager", "workforce systems", "workforce ai"]
QA_EXACT = {"qa", "qa agent"}

# Departments excluded from campaigns (must match migrate-from-odoo.py)
INTERNAL_DEPTS = {
    "QA", "IT", "Human Resources", "Workforce Management",
    "Executive/Operations/Study Fetch", "Finances", "Recruitment",
    "Marketing", "Operations", "Site Management", "Concierge", "EOR", "FBM",
}


def odoo_str(val) -> str:
    if isinstance(val, dict):
        return val.get("en_US") or val.get("es_ES") or next(iter(val.values()), "") or ""
    return str(val or "").strip()


def classify(title: str) -> str:
    t = (title or "").lower().strip()
    if any(kw in t for kw in ADMIN_KW):
        return "ADMIN"
    if t in QA_EXACT:
        return "QA"
    return "AGENT"


def log(msg):
    print(msg, flush=True)


def fetch_qa_with_dept():
    """Return QA users who have a specific operational department (not the QA dept)."""
    log("Connecting to Odoo DB...")
    conn = psycopg2.connect(**ODOO)
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute("""
        SELECT e.id, e.name, e.job_title, e.work_email, e.department_id,
               d.name AS dept_name
        FROM   hr_employee e
        JOIN   hr_department d ON d.id = e.department_id
        WHERE  e.active = true AND e.company_id = 1
    """)
    rows = cur.fetchall()
    conn.close()

    result = []
    for r in rows:
        title = odoo_str(r["job_title"])
        role  = classify(title)
        if role != "QA":
            continue
        dept_id = r["department_id"]
        if dept_id == QA_DEPT_ID:
            continue  # Generic QA dept — skip (keep all campaigns)
        dept_name = odoo_str(r["dept_name"])
        if dept_name in INTERNAL_DEPTS:
            continue  # Internal dept — skip
        email = str(r["work_email"] or "").lower().strip()
        if not email or "@" not in email:
            log(f"  SKIP (no email): {odoo_str(r['name'])}")
            continue
        result.append({
            "name":      odoo_str(r["name"]),
            "email":     email,
            "dept_name": dept_name,
        })

    return result


def build_fix_sql(qa_assignments: list) -> str:
    lines = ["BEGIN;", ""]
    lines.append("-- Fix: remove over-assigned campaigns for QA users with specific departments")
    lines.append("")

    for qa in qa_assignments:
        email     = qa["email"].replace("'", "''")
        dept_name = qa["dept_name"].replace("'", "''")
        name      = qa["name"]

        lines.append(f"-- {name} -> only: {dept_name}")

        # Delete all UserCampaign entries for this user EXCEPT the correct campaign
        lines.append(
            f'DELETE FROM "UserCampaign" uc '
            f'USING "User" u '
            f'WHERE uc."userId" = u.id '
            f"AND u.email = '{email}' "
            f'AND uc."campaignId" NOT IN ('
            f'  SELECT id FROM "Campaign" WHERE name = \'{dept_name}\''
            f');'
        )
        lines.append("")

    lines.append("COMMIT;")
    return "\n".join(lines)


def run_sql(sql: str) -> None:
    log("\nConnecting to Qore server via SSH...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(SSH_HOST, username=SSH_USER, password=SSH_PASS, timeout=15)

    cmd = f"docker exec -i {DB_CONTAINER} psql -U {DB_USER} -d {DB_NAME}"
    log(f"Applying fix SQL ({len(sql)} bytes)...")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=60)
    stdin.write(sql.encode())
    stdin.channel.shutdown_write()

    out  = stdout.read().decode()
    err  = stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    client.close()

    if out.strip():
        log(out)
    if err.strip():
        log(f"STDERR:\n{err}")
    if code != 0:
        sys.exit(f"psql exited {code}")
    log("Fix applied successfully!")


def main():
    log("=" * 56)
    log("  Fix QA Campaign Assignments")
    log("=" * 56)

    log("\n[1/3] Reading QA employees with specific dept from Odoo...")
    qa_assignments = fetch_qa_with_dept()

    if not qa_assignments:
        log("  No QA users with specific dept found. Nothing to fix.")
        sys.exit(0)

    log(f"\n  Found {len(qa_assignments)} QA users with specific campaign assignment:")
    for qa in qa_assignments:
        log(f"    {qa['name']} ({qa['email']})  ->  {qa['dept_name']}")

    log("\n[2/3] Building fix SQL...")
    sql = build_fix_sql(qa_assignments)

    log("\n[3/3] Applying to production...")
    run_sql(sql)

    log("\n" + "=" * 56)
    log("Done! QA users with specific dept now have 1 campaign assigned.")
    log("")
    log("Remaining (in generic QA dept — still have all campaigns):")
    log("  Dalyn Suriel, Loryan Lozano, Mery Michel,")
    log("  Patty Acosta, Ronaldi Fernandez, Sheila De Los Santos")
    log("  -> Assign manually in the UI or provide their campaigns.")
    log("=" * 56)


if __name__ == "__main__":
    main()
