---
name: refactor
description: Assists with refactoring code for improved readability, maintainability, and performance. Use when reorganizing code, extracting functions, simplifying complex logic, or improving type safety.
disable-model-invocation: true
---

# Code Refactoring

You are an expert in TypeScript and Next.js code refactoring.

## Refactoring Checklist

When asked to refactor, follow this process:

### 1. Analyze
- Read the target code completely
- Identify code smells: duplication, long functions, deep nesting, unclear naming
- Check for type safety issues: `any` types, missing return types, unsafe casts
- Look for performance issues: unnecessary re-renders, missing memoization, N+1 queries

### 2. Plan
- List specific changes before making them
- Prioritize: correctness > readability > performance
- Ensure changes don't break existing functionality
- Consider impact on imports and dependents

### 3. Execute
- Make one type of change at a time
- Preserve existing tests (update if API changes)
- Keep commits atomic and descriptive

## Common Refactoring Patterns

### Extract shared logic into utilities
```typescript
// Before: duplicated in multiple server actions
const session = await auth()
if (!session?.user) throw new Error('Unauthorized')
const filter = session.user.role === 'ADMIN'
  ? {}
  : { campaignId: { in: session.user.campaignIds } }

// After: extracted to getCampaignFilter()
const filter = await getCampaignFilter()
```

### Replace conditionals with polymorphism
```typescript
// Before
function renderQuestion(question) {
  if (question.type === 'TEXT') return <TextInput />
  if (question.type === 'RATING') return <RatingInput />
  if (question.type === 'SELECT') return <SelectInput />
}

// After
const questionRenderers: Record<QuestionType, ComponentType> = {
  TEXT: TextInput,
  RATING: RatingInput,
  SELECT: SelectInput,
  RADIO: RadioInput,
}

function renderQuestion(question) {
  const Renderer = questionRenderers[question.type]
  return <Renderer {...question} />
}
```

### Simplify complex queries
```typescript
// Before: inline query logic
const data = await prisma.response.findMany({
  where: {
    form: { campaignId: { in: session.user.campaignIds } },
    createdAt: { gte: startDate, lte: endDate },
  },
  include: { agent: true, form: true },
})

// After: named query function
const data = await getResponsesForCampaigns(session.user.campaignIds, dateRange)
```

## Rules

1. Never refactor and add features in the same step
2. Run tests after each refactoring step
3. Don't over-abstract — three similar lines are better than a premature abstraction
4. Keep function names descriptive: verb + noun (`calculateScore`, `getCampaignFilter`)
5. Prefer explicit types over inferred when the type isn't obvious
6. Don't add comments to explain what — use better names. Add comments only for why.
