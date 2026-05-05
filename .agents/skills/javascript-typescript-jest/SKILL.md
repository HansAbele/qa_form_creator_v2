---
name: javascript-typescript-jest
description: Assists with writing unit tests using Vitest (Jest-compatible API) for TypeScript in Next.js projects. Use when creating unit tests, testing server actions, testing utility functions, or testing business logic.
---

# Unit Testing with Vitest

You are an expert in Vitest (Jest-compatible) unit testing for TypeScript and Next.js.

## Project Context

- **Test runner:** Vitest (not Jest — but same API)
- **Framework:** Next.js 15 with TypeScript
- **Key test targets:** Server actions, utility functions, scoring logic, campaign filters

## Vitest Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
```

## Test File Naming and Location

Place tests next to the code they test:
```
src/
  server/
    actions/
      forms.ts
      forms.test.ts       # ← tests here
    queries/
      analytics.ts
      analytics.test.ts
  lib/
    utils.ts
    utils.test.ts
```

## Testing Patterns

### Business logic (scoring)
```typescript
import { describe, it, expect } from 'vitest'
import { calculateScore } from '@/lib/scoring'

describe('calculateScore', () => {
  it('should calculate average of rating answers as percentage', () => {
    const answers = [
      { type: 'RATING', value: '5' }, // 100%
      { type: 'RATING', value: '3' }, // 60%
      { type: 'RATING', value: '4' }, // 80%
    ]
    expect(calculateScore(answers)).toBe(80) // (100+60+80)/3
  })

  it('should ignore non-rating answers', () => {
    const answers = [
      { type: 'RATING', value: '5' },
      { type: 'TEXT', value: 'Good job' },
      { type: 'SELECT', value: 'Yes' },
    ]
    expect(calculateScore(answers)).toBe(100)
  })

  it('should return 0 when no rating answers', () => {
    const answers = [{ type: 'TEXT', value: 'Note' }]
    expect(calculateScore(answers)).toBe(0)
  })
})
```

### Campaign filter (RBAC)
```typescript
import { describe, it, expect } from 'vitest'
import { getCampaignFilter } from '@/server/queries/campaign-filter'

describe('getCampaignFilter', () => {
  it('should return empty filter for ADMIN', () => {
    const session = { user: { role: 'ADMIN', campaignIds: ['a', 'b'] } }
    expect(getCampaignFilter(session)).toEqual({})
  })

  it('should return campaignId filter for QA', () => {
    const session = { user: { role: 'QA', campaignIds: ['camp1', 'camp2'] } }
    expect(getCampaignFilter(session)).toEqual({
      campaignId: { in: ['camp1', 'camp2'] },
    })
  })
})
```

### Mocking Prisma
```typescript
import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    form: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    response: {
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}))

describe('getForms', () => {
  it('should return forms filtered by campaign', async () => {
    vi.mocked(prisma.form.findMany).mockResolvedValue([
      { id: '1', title: 'Test Form', campaignId: 'camp1' },
    ])

    const result = await getForms({ campaignId: { in: ['camp1'] } })
    expect(result).toHaveLength(1)
    expect(prisma.form.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { campaignId: { in: ['camp1'] } } })
    )
  })
})
```

### Mocking Auth Session
```typescript
import { vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: {
      id: 'user1',
      role: 'QA',
      campaignIds: ['camp1'],
    },
  }),
}))
```

## Rules

1. Test business logic in isolation — mock DB and auth
2. Use `describe` blocks to group related tests
3. Test edge cases: empty arrays, null values, boundary scores (0, 70, 100)
4. Use `toBe` for primitives, `toEqual` for objects/arrays
5. Name tests with "should" + expected behavior
6. Keep tests focused — one assertion per test when possible
7. Use `vi.mock()` for module mocking, `vi.fn()` for function mocking
