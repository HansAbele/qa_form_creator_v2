# Production Security Runbook - Qore / QA Form Creator

Last updated: 2026-05-13

This runbook is the source of truth for production deploy and security checks for Qore. It replaces older one-off deploy notes when there is a conflict.

## Current Security Posture

Repo-side controls completed:

- Production Docker binding is local-only: `127.0.0.1:3000:3000`.
- Apache reverse proxy terminates HTTPS and forwards to `127.0.0.1:3000`.
- Auth cookies are secure in production via `useSecureCookies: process.env.NODE_ENV === "production"`.
- Production deploy uses `prisma migrate deploy`; no `db push --accept-data-loss` path is allowed.
- `.env`, `.env.production`, `odoo.local.env`, and `*.local.env` are ignored by Git.
- `.env` and `odoo.local.env` were removed from Git tracking on 2026-05-13. The local files remain on the machine.
- Docker build context excludes env files, local worktrees, scripts, markdown, tests, and build artifacts.
- `pnpm db:push` is guarded and refuses non-local or production database URLs unless `ALLOW_PRISMA_DB_PUSH=true` is set explicitly.

Operator-side controls still required outside Git:

- Rotate any secret that was ever committed or copied through chat/docs/scripts.
- Store production credentials only in the team password manager.
- Prefer SSH keys over password-based SSH for deploy scripts.
- Keep `/opt/qa-form-creator/.env.production` mode `600`.

## Required Production Secrets

The production `.env.production` file must live only on the server:

```bash
/opt/qa-form-creator/.env.production
```

Required keys:

```bash
DB_PASSWORD=<strong database password>
AUTH_SECRET=<openssl rand -base64 32>
AUTH_URL=https://<real production host>
LOG_LEVEL=info
```

Generate new values:

```bash
openssl rand -base64 32
openssl rand -base64 48
```

Never commit `.env.production`, `.env`, `odoo.local.env`, SSH passwords, Odoo credentials, reset passwords, or API keys.

## Pre-Deploy Validation

Run locally before deploying:

```bash
pnpm lint
pnpm test
pnpm build
pnpm exec prisma validate
git diff --check
```

Check for dangerous deploy paths:

```bash
rg -n "db push|accept-data-loss|0\.0\.0\.0:3000|PASS\s*=|password=" scripts docs docker-compose.prod.yml src -S
```

Expected:

- No production deploy script uses `prisma db push`.
- No real password, token, SSH credential, Odoo credential, or API key appears in tracked files.
- Any `password=` result should read from environment variables or be generic documentation only.

Check tracked env files:

```bash
git ls-files .env .env.production .env.local odoo.local.env "*.local.env"
```

Expected output:

```text
```

## Server Deploy Procedure

Run on the production server:

```bash
ssh root@<server>
cd /opt/qa-form-creator
git pull --ff-only
chmod 600 .env.production
```

Confirm required keys without printing secret values:

```bash
awk -F= '/^(DB_PASSWORD|AUTH_SECRET|AUTH_URL|LOG_LEVEL)=/ { print $1"=<set>" }' .env.production
```

Validate compose config:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production config >/tmp/qore-compose.validated.yml
```

Deploy:

```bash
bash scripts/deploy.sh
```

Do not use old one-off deploy scripts for normal production releases. Files such as `scripts/deploy-settings.py`, `scripts/deploy-schema-v2.py`, `scripts/deploy-logo.py`, and similar historical scripts were created for narrow past changes and can bypass the current full deploy path.

Health checks:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker logs qa_form_creator_app --tail 80
curl -k https://<real production host>/api/health
```

## Manual Migration Check

If you need to run only migrations:

```bash
docker exec qa_form_creator_app npx --yes prisma@6.19.3 migrate deploy --schema /app/prisma/schema.prisma
```

Never run this in production:

```bash
prisma db push --accept-data-loss
```

## Secret Rotation Procedure

Use this when a secret may have been committed, pasted in chat, exposed in logs, or shared outside the password manager.

1. Generate replacement secrets.
2. Update the password manager first.
3. Update `/opt/qa-form-creator/.env.production` on the server.
4. Run `chmod 600 .env.production`.
5. Restart with `bash scripts/deploy.sh`.
6. Confirm health checks.
7. Revoke the old secret where applicable.

Rotate at minimum:

- `DB_PASSWORD` if any database connection string or env file was tracked.
- `AUTH_SECRET` if `.env` or `.env.production` was tracked.
- Odoo credentials if `odoo.local.env` was tracked.
- SSH password used by `QORE_SSH_PASSWORD`; preferably replace password auth with SSH keys.
- Any reset/import passwords such as `QORE_RESET_PASSWORD` or `QORE_INITIAL_PASSWORD`.

## Rollback

If deploy fails after containers start:

```bash
cd /opt/qa-form-creator
git log --oneline -5
git checkout <known-good-commit>
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker exec qa_form_creator_app npx --yes prisma@6.19.3 migrate deploy --schema /app/prisma/schema.prisma
curl -k https://<real production host>/api/health
```

Only roll back database state from a verified backup. Do not use destructive Prisma commands.
