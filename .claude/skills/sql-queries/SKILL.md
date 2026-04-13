---
name: sql-queries
description: Assists with writing complex SQL queries and translating them to Prisma for analytics, reports, and dashboard data. Use when building analytics queries, optimizing database performance, or writing raw SQL for Prisma.
---

# SQL Queries for Analytics

You are an expert in PostgreSQL SQL and Prisma query building for analytics dashboards.

## Project Context

- **Database:** PostgreSQL 16
- **ORM:** Prisma with raw query support
- **Key tables:** Response, Answer, Form, Question, Agent, User, Campaign
- **Score range:** 0-100 (Decimal 5,2)
- **Pass threshold:** score >= 70

## Common Analytics Queries

### Overview stats
```sql
SELECT
  COUNT(DISTINCT f.id) as total_forms,
  COUNT(r.id) as total_responses,
  ROUND(AVG(r.score), 2) as avg_score,
  COUNT(CASE WHEN r.score >= 70 THEN 1 END) as passed,
  COUNT(CASE WHEN r.score < 70 THEN 1 END) as failed
FROM "Response" r
JOIN "Form" f ON r."formId" = f.id
WHERE f."campaignId" = ANY($1::text[])
AND r."createdAt" BETWEEN $2 AND $3
```

### Daily response trends
```sql
SELECT
  DATE_TRUNC('day', r."createdAt") as date,
  COUNT(*) as response_count,
  ROUND(AVG(r.score), 2) as avg_score
FROM "Response" r
JOIN "Form" f ON r."formId" = f.id
WHERE f."campaignId" = ANY($1::text[])
AND r."createdAt" BETWEEN $2 AND $3
GROUP BY DATE_TRUNC('day', r."createdAt")
ORDER BY date ASC
```

### Score distribution histogram
```sql
SELECT
  CASE
    WHEN r.score >= 90 THEN '90-100'
    WHEN r.score >= 70 THEN '70-89'
    WHEN r.score >= 50 THEN '50-69'
    ELSE '0-49'
  END as score_range,
  COUNT(*) as count
FROM "Response" r
JOIN "Form" f ON r."formId" = f.id
WHERE f."campaignId" = ANY($1::text[])
GROUP BY score_range
ORDER BY score_range DESC
```

### Top agents by average score
```sql
SELECT
  a.id,
  a.name as agent_name,
  ROUND(AVG(r.score), 2) as avg_score,
  COUNT(*) as eval_count,
  MIN(r.score) as min_score,
  MAX(r.score) as max_score,
  ROUND(
    COUNT(CASE WHEN r.score >= 70 THEN 1 END)::numeric / COUNT(*)::numeric * 100, 1
  ) as pass_rate
FROM "Response" r
JOIN "Agent" a ON r."agentId" = a.id
JOIN "Form" f ON r."formId" = f.id
WHERE f."campaignId" = ANY($1::text[])
AND r."createdAt" BETWEEN $2 AND $3
GROUP BY a.id, a.name
HAVING COUNT(*) >= 3  -- minimum evaluations for ranking
ORDER BY avg_score DESC
LIMIT $4
```

### Agent performance over time (trends)
```sql
SELECT
  a.name as agent_name,
  DATE_TRUNC('week', r."createdAt") as week,
  ROUND(AVG(r.score), 2) as avg_score
FROM "Response" r
JOIN "Agent" a ON r."agentId" = a.id
JOIN "Form" f ON r."formId" = f.id
WHERE a.id = ANY($1::text[])
AND f."campaignId" = ANY($2::text[])
GROUP BY a.name, DATE_TRUNC('week', r."createdAt")
ORDER BY week ASC
```

### Evaluator activity
```sql
SELECT
  u.name as evaluator_name,
  COUNT(*) as eval_count,
  ROUND(AVG(r.score), 2) as avg_score_given,
  DATE(MAX(r."createdAt")) as last_eval_date
FROM "Response" r
JOIN "User" u ON r."evaluatorId" = u.id
JOIN "Form" f ON r."formId" = f.id
WHERE f."campaignId" = ANY($1::text[])
GROUP BY u.id, u.name
ORDER BY eval_count DESC
```

## Using Raw Queries in Prisma

```typescript
// Always use tagged template literals for parameterized queries
const stats = await prisma.$queryRaw<OverviewStats[]>`
  SELECT COUNT(*) as total, ROUND(AVG(score), 2) as avg_score
  FROM "Response" r
  JOIN "Form" f ON r."formId" = f.id
  WHERE f."campaignId" = ANY(${campaignIds}::text[])
  AND r."createdAt" >= ${startDate}
`

// NEVER do string concatenation (SQL injection risk):
// prisma.$queryRawUnsafe(`SELECT * FROM ... WHERE id = '${id}'`) ← WRONG
```

## Prisma ORM Equivalents

When possible, prefer Prisma's type-safe API over raw SQL:

```typescript
// groupBy
const byAgent = await prisma.response.groupBy({
  by: ['agentId'],
  where: { form: { campaignId: { in: campaignIds } } },
  _avg: { score: true },
  _count: true,
  orderBy: { _avg: { score: 'desc' } },
  take: 10,
})

// aggregate
const totals = await prisma.response.aggregate({
  where: { form: { campaignId: { in: campaignIds } } },
  _avg: { score: true },
  _count: true,
  _min: { score: true },
  _max: { score: true },
})
```

## Rules

1. Always use parameterized queries — never concatenate user input
2. Always filter by campaignId(s) for data isolation
3. Use `DATE_TRUNC` for time-series grouping, not string formatting
4. Cast arrays with `::text[]` when using `= ANY($1)`
5. Add `HAVING COUNT(*) >= N` for meaningful averages
6. Use raw SQL only when Prisma's API can't express the query
7. Always type the result: `prisma.$queryRaw<MyType[]>`
