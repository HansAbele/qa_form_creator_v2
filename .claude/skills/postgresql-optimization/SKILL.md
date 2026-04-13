---
name: postgresql-optimization
description: Assists with PostgreSQL query optimization, indexing strategies, and performance tuning for Prisma-based applications. Use when debugging slow queries, designing indexes, or optimizing analytics queries.
---

# PostgreSQL Optimization

You are an expert in PostgreSQL 16 performance optimization with Prisma ORM.

## Project Context

- **Database:** PostgreSQL 16 in Docker
- **ORM:** Prisma
- **Key tables:** Response (high volume), Answer, Form, Question, Agent, User
- **Critical queries:** Analytics dashboards, agent performance, score aggregations

## Indexing Strategy for This Project

### Already defined in schema
```sql
-- Response table (most queried)
CREATE INDEX idx_response_form_created ON "Response" ("formId", "createdAt");
CREATE INDEX idx_response_agent ON "Response" ("agentId");
CREATE INDEX idx_response_evaluator ON "Response" ("evaluatorId");
CREATE INDEX idx_response_created ON "Response" ("createdAt");

-- Answer table
CREATE INDEX idx_answer_response ON "Answer" ("responseId");
CREATE INDEX idx_answer_question ON "Answer" ("questionId");

-- Question table
CREATE INDEX idx_question_form_order ON "Question" ("formId", "order");
```

### When to add more indexes
- If a query takes >100ms consistently
- If `EXPLAIN ANALYZE` shows Seq Scan on a large table
- On columns used in WHERE with high selectivity
- On columns used in JOIN conditions not covered by FK indexes

## Diagnosing Slow Queries

### Enable Prisma query logging
```typescript
const prisma = new PrismaClient({
  log: [
    { emit: 'stdout', level: 'query' },
    { emit: 'stdout', level: 'warn' },
  ],
})
```

### Use EXPLAIN ANALYZE via Prisma raw query
```typescript
const explain = await prisma.$queryRaw`
  EXPLAIN ANALYZE
  SELECT "agentId", AVG(score) as avg_score
  FROM "Response"
  WHERE "createdAt" >= ${startDate}
  GROUP BY "agentId"
  ORDER BY avg_score DESC
  LIMIT 10
`
```

### Key things to look for in EXPLAIN output
- **Seq Scan** on large tables → needs an index
- **Nested Loop** with high row count → consider JOIN strategy
- **Sort** with high cost → add index matching ORDER BY
- **Hash Aggregate** → normal for GROUP BY, check row count

## Optimization Patterns

### 1. Date range queries (most common in analytics)
```sql
-- Good: index on createdAt enables range scan
WHERE "createdAt" >= '2026-01-01' AND "createdAt" < '2026-02-01'

-- Bad: function on column prevents index use
WHERE DATE_TRUNC('month', "createdAt") = '2026-01-01'
```

### 2. Aggregations with campaign filter
```sql
-- Composite index helps: (campaignId, createdAt) on Form
-- Then join Response through Form
SELECT AVG(r.score)
FROM "Response" r
JOIN "Form" f ON r."formId" = f.id
WHERE f."campaignId" IN ('...', '...')
AND r."createdAt" >= $1
```

### 3. Score distribution (histogram)
```sql
SELECT
  CASE
    WHEN score >= 90 THEN '90-100'
    WHEN score >= 70 THEN '70-89'
    WHEN score >= 50 THEN '50-69'
    ELSE '0-49'
  END AS range,
  COUNT(*) as count
FROM "Response"
WHERE "createdAt" >= $1
GROUP BY range
```

### 4. Top/bottom agents
```sql
-- Use index on (agentId) + aggregate
SELECT "agentId", AVG(score) as avg_score, COUNT(*) as eval_count
FROM "Response"
GROUP BY "agentId"
ORDER BY avg_score DESC
LIMIT 10
```

## Prisma-Specific Optimizations

### Use `select` to reduce data transfer
```typescript
// Bad: fetches all columns
const responses = await prisma.response.findMany({ where: filter })

// Good: only needed columns
const responses = await prisma.response.findMany({
  where: filter,
  select: { id: true, score: true, createdAt: true, agentId: true },
})
```

### Use raw queries for complex analytics
```typescript
// When Prisma's groupBy isn't enough
const results = await prisma.$queryRaw<AgentStats[]>`
  SELECT
    a.name as agent_name,
    AVG(r.score) as avg_score,
    COUNT(*) as total_evals,
    COUNT(CASE WHEN r.score >= 70 THEN 1 END) as passed
  FROM "Response" r
  JOIN "Agent" a ON r."agentId" = a.id
  JOIN "Form" f ON r."formId" = f.id
  WHERE f."campaignId" = ANY(${campaignIds})
  AND r."createdAt" >= ${startDate}
  GROUP BY a.id, a.name
  ORDER BY avg_score DESC
`
```

### Connection pooling
```bash
# In DATABASE_URL for production
DATABASE_URL="postgresql://user:pass@db:5432/qa_form_creator?connection_limit=10"
```

## Performance Targets

- Dashboard load: <2 seconds with 1000+ responses
- Form list: <500ms
- Export: <5 seconds for 10,000 rows
- Any single query: <100ms

## Rules

1. Always use parameterized queries with `$queryRaw` (template literals), never string concatenation
2. Always add indexes in a Prisma migration, never manually
3. Test query performance with realistic data volumes (1000+ responses)
4. Use `EXPLAIN ANALYZE` before and after optimization to verify improvement
5. Consider materialized views only if dashboard consistently exceeds 2s target
