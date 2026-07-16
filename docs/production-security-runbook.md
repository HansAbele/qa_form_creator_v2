# Production Security Runbook — Qore / QA Form Creator

Last updated: 2026-07-15

This is the production source of truth. Historical one-off deploy, password-reset,
and data-fix scripts are not approved production paths.

## P1 release gates

A production release is allowed only when all of these are true:

- `scripts/verify-repository-secrets.sh` passes on a full clone with every remote
  branch and tag fetched.
- Every exposed credential has been rotated and the old value is rejected by its
  external system. Repository edits alone do not satisfy this gate.
- `.env.production` contains `SECRET_ROTATION_CONFIRMED=true` and
  `SECRET_HISTORY_REMEDIATED=true`, backed by evidence in the change ticket.
- The encrypted off-site backup destination and encryption key pass preflight.
- The candidate app and migrator images successfully restore the newest backup in
  an isolated Docker network and the evidence JSON is attached to the ticket.
- Database integrity, migration status, runtime-role privileges, append-only audit,
  application health, and HTTPS health all pass.
- CI is required on the protected default branch.

`scripts/deploy.sh` enforces these gates and fails closed.

## Security model

- Apache terminates trusted HTTPS and proxies only to `127.0.0.1:3000`.
- The web process uses `qa_app`; migrations use the database owner.
- `qa_app` has no superuser, database/schema creation, temporary-table, role
  management, ownership, inherited-role, or migration-history privileges.
- Runtime table access is a reviewed allowlist. New tables receive no runtime grant
  until `scripts/provision-db-roles.sh` is updated.
- `AuditLog` is append-only. The runtime can read it and insert approved columns,
  but cannot backdate, update, delete, truncate, or disable its triggers.
- Audit actor/campaign foreign keys use `RESTRICT`, preventing cascade rewrites of
  historical evidence.
- Sensitive mutations and their audit events commit in the same transaction.
- Production deploy uses `prisma migrate deploy`; `prisma db push` is prohibited.
- Backups are AES-256 encrypted, checksummed, structurally validated, replicated
  off-site, downloaded again for hash verification, and restore-tested.
- Deploy, backup, and restore share an exclusive operations lock.
- Node and PostgreSQL base images are pinned by immutable multi-architecture digest.

## Required production configuration

Keep these files only on the server, owned by the deploy user, mode `600`, and not
symbolic links:

```text
/opt/qa-form-creator/.env.production
/opt/qa-form-creator/.backup-key
```

Required `.env.production` values:

```bash
DB_OWNER_USER=qa_owner
DB_OWNER_PASSWORD=<openssl-rand-hex-32>
DB_APP_USER=qa_app
DB_APP_PASSWORD=<different-openssl-rand-hex-32>
AUTH_SECRET=<different-openssl-rand-hex-32>
RATE_LIMIT_HASH_SECRET=<different-openssl-rand-hex-32>
AUTH_URL=https://<real-production-host>
LOG_LEVEL=info
BACKUP_ENCRYPTION_KEY_FILE=/opt/qa-form-creator/.backup-key
BACKUP_REMOTE=<rclone-remote>:qore-production
REQUIRE_OFFSITE_BACKUP=true
RETENTION_DAYS=30
MIN_FREE_DISK_MB=2048
SECRET_ROTATION_CONFIRMED=false
SECRET_HISTORY_REMEDIATED=false
INITIAL_DEPLOY=false
```

Generate values without printing them into tickets or chat:

```bash
# Run this four times and assign a distinct value to each hex secret above.
openssl rand -hex 32
# Write one unwrapped Base64 line directly; `openssl enc -pass file:` reads one line.
openssl rand -base64 64 | tr -d '\n' > /opt/qa-form-creator/.backup-key
chmod 600 /opt/qa-form-creator/.backup-key
```

Older deployments may have a two-line key created by `openssl rand -base64 64`.
Do not join those lines: historical backups used only the first line as their
OpenSSL passphrase. Normalize it without changing that passphrase:

```bash
bash scripts/migrate-legacy-backup-key.sh /opt/qa-form-creator/.backup-key
```

The resulting 48-byte legacy passphrase remains cryptographically strong and
keeps old backups readable. Rotate to a new 64-byte key only after the backups
encrypted with the legacy passphrase have expired or been re-encrypted.

`INITIAL_DEPLOY=true` is a one-time authorization. The deploy script accepts it only
when PostgreSQL proves that `public` has zero tables. It must remain `false` for
upgrades.

## Secret incident closure

At the 2026-07-15 audit, local remote-tracking state showed `origin/main` at commit
`b71bc5a`, whose tip tracked `.env` and `odoo.local.env`; commit `f5adf0e` removed
them only on another branch. Treat the incident as open until the hosting provider
confirms the actual remote state is remediated.

Required order:

1. Inventory every system that accepted the exposed database credential,
   `AUTH_SECRET`, or Odoo database password.
2. Generate replacements in the password manager and deploy them.
3. Verify the former values are rejected. Rotating `AUTH_SECRET` revokes existing
   sessions.
4. Rewrite every affected remote branch and tag with the provider-approved
   `git filter-repo` process during a maintenance window.
5. Require collaborators and runners to delete old clones/caches and clone again.
6. Fetch all refs into a clean verification clone and run:

   ```bash
   bash scripts/verify-repository-secrets.sh
   ```

7. Attach revocation evidence, remote ref inventory, rewritten commit IDs, CI secret
   scan, and clean-clone output to the ticket.
8. Only then set both `SECRET_*_CONFIRMED` values to `true` on the server.

Never commit `.env`, `.env.production`, `odoo.local.env`, `*.local.env`, backup keys,
SSH passwords, reset passwords, Odoo credentials, or API keys.

## Pre-deploy verification

On a clean candidate checkout:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:validate
pnpm lint
pnpm typecheck
pnpm test:ci
pnpm build
bash -n scripts/*.sh
bash scripts/verify-repository-secrets.sh
git diff --check
```

On the server, validate Compose without rendering expanded secrets to disk:

```bash
cd /opt/qa-form-creator
chmod 600 .env.production .backup-key
docker compose -f docker-compose.prod.yml --env-file .env.production config --quiet
bash scripts/production-preflight.sh --offline
```

Do not use `docker compose config > /tmp/...`; rendered output contains database and
authentication secrets.

Before the first release that changes QA Manager permissions, preserve the current
campaign-manager inventory in the protected ticket:

```bash
set -a
source .env.production
set +a
DB_NAME=${DB_NAME:-qa_form_creator}
docker exec qa_form_creator_db psql -U "$DB_OWNER_USER" -d "$DB_NAME" -c \
  'COPY (SELECT u.email, uc."campaignId", uc."roleInCampaign" FROM "UserCampaign" uc JOIN "User" u ON u.id = uc."userId" WHERE u.role = '\''QA'\'' AND uc."roleInCampaign" = '\''CAMPAIGN_ADMIN'\'') TO STDOUT WITH CSV HEADER' \
  > campaign-manager-inventory.csv
chmod 600 campaign-manager-inventory.csv
```

The migration records a `legacy_campaign_admin_snapshot` audit event. A QA Manager
must restore only grants confirmed as intentional.

## Production deploy

```bash
ssh root@<server>
cd /opt/qa-form-creator
git pull --ff-only
bash scripts/deploy.sh
```

The script performs, in order:

1. exclusive operation lock and offline preflight;
2. immutable app/migrator image build;
3. pre-migration integrity verification;
4. encrypted, off-site, download-verified backup;
5. isolated restore/migrate/provision/integrity/app-health drill;
6. owner-only production migration;
7. closed runtime-role provisioning and online preflight;
8. app replacement and health check;
9. Apache configuration install, `apache2ctl configtest`, and reload;
10. managed backup cron and `.deployed-release` image manifest.

Verify without bypassing TLS validation:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker logs qa_form_creator_app --tail 80
curl --fail --show-error --silent https://<real-production-host>/api/health
```

If the private CA is not in the host trust store, use its reviewed CA bundle:

```bash
curl --cacert /etc/ssl/certs/<company-ca>.pem --fail --show-error --silent \
  https://<real-production-host>/api/health
```

Never use `curl -k` as deployment evidence.

## Backup policy and restore drill

Operational targets:

- maximum RPO: 24 hours (daily 02:00 encrypted backup);
- target RTO: 4 hours;
- automated restore drill: every production deploy with an existing database;
- independently recorded drill: at least quarterly.

Create a backup and run the same isolated drill manually:

```bash
cd /opt/qa-form-creator
set -a
source .env.production
source .deployed-release
set +a
result=$(mktemp)
BACKUP_RESULT_FILE="$result" bash scripts/backup.sh
backup_file=$(<"$result")
rm -f "$result"
IMAGE_TAG="$IMAGE_TAG" bash scripts/dr-drill.sh "$backup_file"
```

The drill uses an internal network, isolated volume, random container names, no host
ports, the pinned candidate images, and automatic cleanup. Evidence is written under
`backups/dr-evidence/` with backup hash, image IDs, duration, row counts, and app
health. Attach that JSON and the measured RPO/RTO to the change ticket.

Do not store `.backup-key` with replicated backups. Keep the protected recovery copy
in the team password manager.

## Production restore

The restore is interactive, validates the checksum, verifies exact image IDs from
`.deployed-release`, backs up the current database, proves the requested backup in an
isolated drill, and only then stops the application:

```bash
bash scripts/restore.sh /opt/qa-form-creator/backups/<backup>.dump.enc
```

After restore, record HTTPS health, row-count evidence, duration, operator, approver,
and ticket ID.

## Audit maintenance

Normal application and operator activity must never update or delete `AuditLog`.
Exceptional retention/legal remediation requires two-person approval, a scoped SQL
review, a fresh backup/drill, and a ticket. The database owner must use a local marker
inside one transaction:

```sql
BEGIN;
SET LOCAL qore.audit_maintenance = 'enabled';
-- Execute only the exact UPDATE/DELETE/TRUNCATE approved in the ticket.
COMMIT;
```

Never set the marker at role/database level. Record before/after counts and backup
hash outside the table being maintained.

## Password and access recovery

Use the audited QA Manager user-management flow. It applies password policy,
increments `sessionVersion`, revokes prior sessions, and writes audit evidence in the
same transaction.

The removed `reset-password.py`, `reset-pw.py`, `reset-pw-prisma.py`, and
`fix-qa-assignments.py` scripts are prohibited: they bypassed audit and authorization,
embedded production targets, trusted unknown SSH host keys, and could expose secrets.

If no QA Manager can authenticate, open a two-person break-glass incident. Recovery
must be implemented as a reviewed, single-use migration/utility that identifies the
actor and ticket, increments `sessionVersion`, writes a non-secret audit event in the
same transaction, is tested on a restored backup, and is removed immediately after
use. Never place a plaintext password or hash in shell arguments, logs, or tickets.

## Manual migration and rollback

Manual migration, when explicitly approved:

```bash
set -a
source .env.production
source .deployed-release
set +a
docker compose -f docker-compose.prod.yml --env-file .env.production \
  --profile tools run --rm migrator
bash scripts/provision-db-roles.sh
bash scripts/production-preflight.sh --online
```

Never run:

```bash
prisma db push --accept-data-loss
```

Application-only rollback uses a known compatible image. Database rollback requires
the production restore procedure and a verified backup; never use destructive Prisma
commands. A rollback is not complete until internal and trusted-HTTPS health checks
pass and the incident ticket records database compatibility.
