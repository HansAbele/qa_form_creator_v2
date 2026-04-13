---
name: database-migration
description: Assists with database schema migrations using Prisma Migrate. Use when adding new models, modifying existing tables, handling data migrations, or resolving migration conflicts.
disable-model-invocation: true
---

# Database Migration

You are an expert in Prisma Migrate for PostgreSQL schema changes.

## Migration Workflow

### Development (local)
```bash
# 1. Edit prisma/schema.prisma
# 2. Create and apply migration
pnpm prisma migrate dev --name descriptive-name

# 3. If you need to reset (DESTROYS DATA)
pnpm prisma migrate reset
```

### Production (server)
```bash
# Apply pending migrations (never creates new ones)
docker compose exec app pnpm prisma migrate deploy
```

## Migration Naming Convention

Use kebab-case with a verb prefix:
- `add-campaign-model`
- `add-response-indexes`
- `rename-agent-code-field`
- `add-kpi-targets-table`
- `remove-deprecated-columns`

## Common Migration Patterns

### Adding a required field to existing table
```prisma
// 1. Add as optional first
model Form {
  campaignId String?  // nullable initially
}

// 2. Migrate: pnpm prisma migrate dev --name add-campaign-to-form

// 3. Backfill data (in a separate script or migration SQL)
// UPDATE "Form" SET "campaignId" = 'default-campaign-id' WHERE "campaignId" IS NULL

// 4. Make it required
model Form {
  campaignId String  // now required
}

// 5. Migrate again: pnpm prisma migrate dev --name make-campaign-required
```

### Adding an index
```prisma
model Response {
  @@index([formId, createdAt])  // composite index
  @@index([agentId])            // single column
}
```

### Renaming a field
```prisma
// Use @map to rename the DB column without breaking the Prisma API
model Agent {
  agentCode String? @map("agent_code")
}
```

## Custom SQL in Migrations

If Prisma can't express a migration, edit the generated SQL file directly:

```sql
-- prisma/migrations/YYYYMMDD_custom/migration.sql

-- Data migration: backfill campaign IDs
UPDATE "Form" SET "campaignId" = (
  SELECT id FROM "Campaign" WHERE name = 'Default'
) WHERE "campaignId" IS NULL;
```

## Rules

1. Never edit a migration file that's already been applied to production
2. Always test migrations with `migrate reset` in development before deploying
3. For data migrations, write reversible scripts when possible
4. Back up the database before applying migrations in production
5. Name migrations descriptively — you'll read them months later
6. One logical change per migration — don't bundle unrelated changes
