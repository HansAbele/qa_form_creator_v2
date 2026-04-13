---
name: prisma-database-setup
description: Assists with Prisma ORM setup, schema design, migrations, seeding, and client usage in Next.js projects with PostgreSQL. Use when working with database models, creating migrations, writing seed scripts, or configuring Prisma client.
---

# Prisma Database Setup

You are an expert in Prisma ORM with PostgreSQL. Follow these guidelines when working with Prisma in this project.

## Project Context

- **ORM:** Prisma with PostgreSQL 16
- **Framework:** Next.js 15 (App Router)
- **Schema location:** `prisma/schema.prisma`
- **Seed script:** `prisma/seed.ts`
- **Client singleton:** `src/lib/prisma.ts`

## Schema Design Rules

1. Always use `cuid()` for IDs: `id String @id @default(cuid())`
2. Include `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt` on all models
3. Use enums for fixed values (`Role`, `QuestionType`)
4. Define explicit indexes on columns used in WHERE, ORDER BY, and GROUP BY
5. Use `@db.Decimal(5, 2)` for score fields
6. Use `Json` type for question options
7. Always define `onDelete` behavior on relations (`Cascade` for owned entities, `Restrict` for references)
8. Add `@@index` for frequently queried columns

## Migration Workflow

```bash
# Create migration after schema changes
pnpm prisma migrate dev --name <descriptive-name>

# Apply migrations in production
pnpm prisma migrate deploy

# Reset database (development only)
pnpm prisma migrate reset

# Generate client after schema changes
pnpm prisma generate
```

## Prisma Client Singleton

Always use a singleton pattern to avoid multiple client instances in development:

```typescript
// src/lib/prisma.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

## Seed Script Pattern

```typescript
// prisma/seed.ts
import { prisma } from '../src/lib/prisma'
import { hash } from 'bcryptjs'

async function main() {
  // Use upsert to make seed idempotent
  const admin = await prisma.user.upsert({
    where: { email: 'admin@empresa.local' },
    update: {},
    create: {
      email: 'admin@empresa.local',
      name: 'Admin QA',
      password: await hash('cambiar123', 12),
      role: 'ADMIN',
    },
  })
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e)
    prisma.$disconnect()
    process.exit(1)
  })
```

## Common Query Patterns for This Project

### Filtered by campaign (RBAC)
```typescript
const forms = await prisma.form.findMany({
  where: getCampaignFilter(session), // { campaignId: { in: [...] } }
  include: { questions: { orderBy: { order: 'asc' } } },
})
```

### Aggregations for analytics
```typescript
const stats = await prisma.response.aggregate({
  where: { ...campaignFilter, createdAt: { gte: startDate, lte: endDate } },
  _avg: { score: true },
  _count: true,
})
```

### GroupBy for charts
```typescript
const daily = await prisma.response.groupBy({
  by: ['createdAt'],
  where: campaignFilter,
  _avg: { score: true },
  _count: true,
  orderBy: { createdAt: 'asc' },
})
```

## Naming Conventions

- Models: PascalCase singular (`User`, `Form`, `Response`)
- Fields: camelCase (`createdAt`, `agentId`, `formId`)
- Enums: UPPER_CASE values (`ADMIN`, `QA`, `TEXT`, `RATING`)
- Migration names: kebab-case descriptive (`add-campaign-model`, `add-response-indexes`)

## Common Mistakes to Avoid

1. Never import `PrismaClient` directly in components — use the singleton from `src/lib/prisma.ts`
2. Never use `prisma.$executeRaw` without parameterized queries (SQL injection risk)
3. Never skip `prisma generate` after schema changes
4. Always use transactions for operations that modify multiple tables
5. Use `select` or `include` to avoid over-fetching data
