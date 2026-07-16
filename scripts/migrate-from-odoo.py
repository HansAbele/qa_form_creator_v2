#!/usr/bin/env python3
"""
migrate-from-odoo.py
====================
Imports departments and employees from Odoo Postgres into Qore production DB.

Reads:    Odoo Postgres @ 192.168.80.240 / dbodoo  (user: wfm)
Applies:  SQL via SSH to 192.168.80.243, piped into qa_form_creator_db psql

Role mapping (hr_employee.job_title, case-insensitive):
  ADMIN  <- contains: "qa manager" | "workforce manager" |
             "workforce systems" | "workforce ai"
  QA     <- exactly:  "qa" | "qa agent"
  Agent  <- everything else (Agent, Team Leader, Program Manager, etc.)

Campaigns = hr_departments that have at least one Agent/TL employee.
Internal departments (QA, IT, HR, etc.) are excluded from campaigns.

QA users are linked only to their operational department when it maps to a
campaign. Generic/internal QA users remain unassigned for manual review.
Global ADMIN users do not receive redundant campaign assignments.
Agents are linked only to their own department/campaign.

Idempotent: safe to run multiple times without duplicates.
Imported users are created without a password. An administrator must assign an
individual credential later through the audited user-management flow.

Usage:
    pip install psycopg2-binary paramiko
    python scripts/migrate-from-odoo.py
"""

from __future__ import annotations
import sys
import os
import re
import shlex
import uuid
import hashlib
from urllib.parse import unquote, urlparse

import psycopg2
import psycopg2.extras
import paramiko


# ─── Configuration ────────────────────────────────────────────────────────────

def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"ERROR: {name} is required.")
    return value


ODOO = dict(
    host="192.168.80.240",
    port=5432,
    dbname="dbodoo",
    user="wfm",
    password=require_env("ODOO_DB_PASSWORD"),
)

SSH_HOST     = "192.168.80.243"
SSH_USER     = "root"
SSH_PASS     = require_env("QORE_SSH_PASSWORD")
DB_CONTAINER = "qa_form_creator_db"

EMAIL_DOMAIN = "@tnoutsourcing.com"

# job_title substrings that map to ADMIN role in Qore
ADMIN_KW = [
    "qa manager",
    "workforce manager",
    "workforce systems",
    "workforce ai",
]

# job_title exact matches that map to QA role in Qore
QA_EXACT = {"qa", "qa agent"}

# Departments excluded from campaign creation (internal / non-operational teams)
INTERNAL_DEPTS = {
    "QA",
    "IT",
    "Human Resources",
    "Workforce Management",
    "Executive/Operations/Study Fetch",
    "Finances",
    "Recruitment",
    "Marketing",
    "Operations",
    "Site Management",
    "Concierge",
    "EOR",
    "FBM",
}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def odoo_str(val) -> str:
    """
    Odoo stores some fields (name, job_title) as JSONB translation dicts
    in newer versions: {"en_US": "Bayada", "es_ES": "Bayada"}.
    This helper always returns a plain string.
    """
    if isinstance(val, dict):
        # Prefer English, then Spanish, then first available value
        return (
            val.get("en_US")
            or val.get("es_ES")
            or next(iter(val.values()), "")
            or ""
        )
    return str(val or "").strip()


def classify(title: str) -> str:
    """Return 'ADMIN', 'QA', or 'AGENT' based on job title."""
    t = (title or "").lower().strip()
    if any(kw in t for kw in ADMIN_KW):
        return "ADMIN"
    if t in QA_EXACT:
        return "QA"
    return "AGENT"


def esc(v: str) -> str:
    """Escape a value for SQL single-quote literals."""
    return (v or "").replace("'", "''")


def derive_email(name: str) -> str:
    """Generate a work email from employee name when none is set."""
    parts = (name or "").lower().strip().split()
    slug  = ".".join(p.replace("'", "").replace("-", "") for p in parts[:2])
    return slug + EMAIL_DOMAIN


def campaign_id_for(dept_name: str) -> str:
    """
    Deterministic campaign ID derived from department name.
    Same name always produces the same ID -> idempotent inserts.
    """
    h = hashlib.sha256(f"qore:campaign:{dept_name}".encode()).hexdigest()
    return "c" + h[:23]


def rand_id() -> str:
    """Random cuid-style ID for users and agents."""
    return "c" + uuid.uuid4().hex[:23]


def log(msg: str) -> None:
    print(msg, flush=True)


# ─── Odoo data fetch ──────────────────────────────────────────────────────────

def fetch_odoo() -> tuple[dict, list]:
    log("Connecting to Odoo DB...")
    conn = psycopg2.connect(**ODOO)
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # All active departments under TN Outsourcing
    cur.execute("""
        SELECT id, name
        FROM   hr_department
        WHERE  active = true AND company_id = 1
        ORDER  BY name
    """)
    # Normalize name field (may be JSONB translation dict in newer Odoo)
    depts = {
        r["id"]: {"id": r["id"], "name": odoo_str(r["name"])}
        for r in cur.fetchall()
    }

    # All active employees under TN Outsourcing
    cur.execute("""
        SELECT e.id,
               e.name,
               COALESCE(e.job_title, '')                  AS job_title,
               LOWER(TRIM(COALESCE(e.work_email, '')))    AS work_email,
               e.department_id
        FROM   hr_employee e
        WHERE  e.active = true AND e.company_id = 1
        ORDER  BY e.name
    """)
    employees = [
        {
            "id":            r["id"],
            "name":          odoo_str(r["name"]),
            "job_title":     odoo_str(r["job_title"]),
            "work_email":    str(r["work_email"] or "").lower().strip(),
            "department_id": r["department_id"],
        }
        for r in cur.fetchall()
    ]
    conn.close()

    log(f"  Departments : {len(depts)}")
    log(f"  Employees   : {len(employees)}")
    return depts, employees


# ─── SQL builder ──────────────────────────────────────────────────────────────

def build_sql(depts: dict, employees: list) -> str:
    by_role: dict[str, list] = {"ADMIN": [], "QA": [], "AGENT": []}
    for e in employees:
        by_role[classify(e["job_title"])].append(e)

    log(f"  ADMIN users : {len(by_role['ADMIN'])}")
    log(f"  QA users    : {len(by_role['QA'])}")
    log(f"  Agents      : {len(by_role['AGENT'])}")

    # Only departments that have at least one agent employee become campaigns
    agent_dept_ids = {e["department_id"] for e in by_role["AGENT"] if e["department_id"]}
    camp_depts = {
        did: d for did, d in depts.items()
        if did in agent_dept_ids and d["name"] not in INTERNAL_DEPTS
    }
    log(f"  Campaigns   : {len(camp_depts)}")

    sql: list[str] = [
        "-- Qore migration from Odoo",
        "-- Idempotent: safe to re-run",
        "",
        "BEGIN;",
        "",
    ]

    # ── Campaigns ──────────────────────────────────────────────────────────────
    sql.append("-- ── Campaigns (from hr_department) ──────────────────────────────────")
    camp_id_map: dict[int, str] = {}

    for did, d in sorted(camp_depts.items(), key=lambda x: x[1]["name"]):
        cid = campaign_id_for(d["name"])
        camp_id_map[did] = cid
        sql.append(
            f'INSERT INTO "Campaign" (id, name, active, "createdAt", "updatedAt") '
            f"VALUES ('{cid}', '{esc(d['name'])}', true, NOW(), NOW()) "
            f"ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, active = true;"
        )

    # ── Users (login accounts) ─────────────────────────────────────────────────
    sql += ["", "-- ── Users (ADMIN + QA login accounts) ──────────────────────────────────"]
    qa_assignments: list[tuple[str, str]] = []
    unassigned_qa = 0

    for e in by_role["ADMIN"] + by_role["QA"]:
        role  = classify(e["job_title"])
        raw   = e["work_email"] or ""
        email = raw if "@" in raw else derive_email(e["name"])
        uid   = rand_id()
        if role == "QA":
            campaign_id = camp_id_map.get(e["department_id"])
            if campaign_id:
                qa_assignments.append((email, campaign_id))
            else:
                unassigned_qa += 1
        sql.append(
            f'INSERT INTO "User" '
            f'(id, email, name, password, role, active, "createdAt", "updatedAt") '
            f"VALUES ("
            f"'{uid}', "
            f"'{esc(email)}', "
            f"'{esc(e['name'])}', "
            f"NULL, "
            f"'{role}'::\"Role\", "
            f"true, NOW(), NOW()) "
            f"ON CONFLICT (email) DO UPDATE SET "
            f"name = EXCLUDED.name, "
            f"role = EXCLUDED.role, "
            f'"sessionVersion" = CASE '
            f'WHEN "User".role IS DISTINCT FROM EXCLUDED.role '
            f'THEN "User"."sessionVersion" + 1 '
            f'ELSE "User"."sessionVersion" END;'
        )

    # QA access is campaign-scoped and explicitly least-privileged. Global ADMIN
    # users do not need UserCampaign rows because their application role already
    # grants global access.
    if qa_assignments:
        sql += ["", "-- QA campaign access (operational department only)"]
        for email, campaign_id in qa_assignments:
            safe_email = esc(email)
            sql.append(
                f'INSERT INTO "UserCampaign" ('
                f'"userId", "campaignId", "assignedAt", "roleInCampaign", '
                f'"canViewDashboard", "canViewKPIs", "canViewForms", '
                f'"canCreateForms", "canEditForms", "canPublishForms", '
                f'"canEvaluate", "canEditEvaluations", "canViewReports", '
                f'"canExport", "canManageAgents", "canManageDispositions", '
                f'"canManageCampaignScoring", "canViewAudit") '
                f'SELECT u.id, \'{campaign_id}\', NOW(), \'EVALUATOR\'::"CampaignAccessLevel", '
                f'true, false, true, false, false, false, true, false, false, '
                f'false, false, false, false, false '
                f'FROM "User" u WHERE u.email = \'{safe_email}\' '
                f'ON CONFLICT ("userId", "campaignId") DO NOTHING;'
            )

    log(f"  QA assignments: {len(qa_assignments)} campaign-scoped")
    if unassigned_qa:
        log(f"  QA requiring manual campaign assignment: {unassigned_qa}")

    # ── Agents ────────────────────────────────────────────────────────────────
    sql += ["", "-- ── Agents (from hr_employee) ───────────────────────────────────────────"]
    skipped = 0

    for e in by_role["AGENT"]:
        did = e["department_id"]
        if did not in camp_id_map:
            skipped += 1
            continue
        aid  = rand_id()
        code = str(e["id"])  # Odoo employee ID as stable agent code
        sql.append(
            f'INSERT INTO "Agent" '
            f'(id, name, "agentCode", "campaignId", active, "createdAt") '
            f"VALUES ("
            f"'{aid}', "
            f"'{esc(e['name'])}', "
            f"'{code}', "
            f"'{camp_id_map[did]}', "
            f"true, NOW()) "
            f'ON CONFLICT ("agentCode", "campaignId") DO UPDATE SET '
            f"name = EXCLUDED.name, active = true;"
        )

    if skipped:
        log(f"  Skipped {skipped} agents (their dept is not an operational campaign)")

    sql += ["", "COMMIT;", ""]
    return "\n".join(sql)


# ─── SSH execution ────────────────────────────────────────────────────────────

def detect_qore_db(client: paramiko.SSHClient) -> tuple[str, str]:
    """Read DATABASE_URL from .env.production to get DB user and name."""
    _, out, _ = client.exec_command(
        "grep DATABASE_URL /opt/qa-form-creator/.env.production 2>/dev/null | head -1"
    )
    line = out.read().decode().strip()
    value = line.partition("=")[2].strip().strip("'\"")
    parsed = urlparse(value)
    db_user = unquote(parsed.username or "")
    db_name = unquote(parsed.path.lstrip("/").split("?", 1)[0])
    identifier = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
    if identifier.fullmatch(db_user) and identifier.fullmatch(db_name):
        return db_user, db_name

    db_user = os.environ.get("QORE_DB_USER", "qa_user")
    db_name = os.environ.get("QORE_DB_NAME", "qa_form_creator")
    if identifier.fullmatch(db_user) and identifier.fullmatch(db_name):
        return db_user, db_name
    raise RuntimeError("QORE_DB_USER and QORE_DB_NAME must be safe PostgreSQL identifiers.")


def apply_sql(sql: str) -> None:
    log("\nConnecting to Qore server via SSH...")
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect(SSH_HOST, username=SSH_USER, password=SSH_PASS, timeout=15)

    db_user, db_name = detect_qore_db(client)
    log(f"  DB: {db_name}   user: {db_user}")
    log(f"  Piping SQL ({len(sql):,} bytes) into {DB_CONTAINER}...")

    cmd = (
        f"docker exec -i {shlex.quote(DB_CONTAINER)} psql -v ON_ERROR_STOP=1 "
        f"-U {shlex.quote(db_user)} -d {shlex.quote(db_name)}"
    )
    stdin, stdout, stderr = client.exec_command(cmd, timeout=180)
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
        sys.exit(f"psql exited with code {code}")

    log("Migration applied successfully!")


# ─── Entry point ──────────────────────────────────────────────────────────────

def main() -> None:
    log("=" * 60)
    log("  Odoo -> Qore Migration")
    log("=" * 60)

    log("\n[1/4] Reading Odoo data...")
    depts, employees = fetch_odoo()

    if by_role := [employee for employee in employees if classify(employee["job_title"]) == "ADMIN"]:
        if os.environ.get("QORE_ALLOW_ADMIN_IMPORT") != "true":
            sys.exit(
                f"ERROR: source contains {len(by_role)} ADMIN account(s); "
                "set QORE_ALLOW_ADMIN_IMPORT=true only after explicit review."
            )

    log("\n[2/4] Building SQL...")
    sql = build_sql(depts, employees)

    sql_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "migration.sql")
    descriptor = os.open(sql_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as f:
        f.write(sql)
    log(f"\n  SQL saved to  scripts/migration.sql  ({len(sql):,} bytes)")
    log("  Open it to review before applying.")

    confirm = input("\n[3/4] Apply to production now? [y/N]: ").strip().lower()
    if confirm != "y":
        log("Aborted. The SQL file is saved — run again or apply manually when ready.")
        sys.exit(0)

    apply_sql(sql)

    log("\n" + "=" * 60)
    log("  Migration complete. New login accounts have no password.")
    log("  Assign each user an individual credential through the audited admin flow.")
    log("=" * 60)


if __name__ == "__main__":
    main()
