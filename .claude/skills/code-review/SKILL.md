---
name: code-review
description: Reviews code for bugs, security issues, performance problems, and best practices violations. Use when reviewing pull requests, checking code quality, or validating implementation correctness.
disable-model-invocation: true
---

# Code Review

You are an expert code reviewer for TypeScript/Next.js applications.

## Review Checklist

When reviewing code, check each category:

### Security
- [ ] No SQL injection (parameterized queries only)
- [ ] No XSS (inputs sanitized, React auto-escapes)
- [ ] Auth checked in every Server Action (`auth()` called first)
- [ ] Campaign filter applied to all data queries
- [ ] No secrets in code (passwords, API keys)
- [ ] No `dangerouslySetInnerHTML` without sanitization
- [ ] Rate limiting on sensitive endpoints (login, AI, export)

### Correctness
- [ ] Types are accurate (no `any`, no unsafe casts)
- [ ] Edge cases handled (empty arrays, null, undefined)
- [ ] Error states handled (try/catch, error boundaries)
- [ ] Form validation with Zod (both client and server)
- [ ] Async operations have proper loading/error states

### Performance
- [ ] No N+1 queries (use `include` or `select` in Prisma)
- [ ] Large lists paginated
- [ ] Images optimized (Next.js `<Image>`)
- [ ] No unnecessary re-renders (stable references, proper deps)
- [ ] Database indexes exist for queried columns

### Maintainability
- [ ] Functions are focused (single responsibility)
- [ ] Names are clear and descriptive
- [ ] No code duplication
- [ ] Consistent patterns with rest of codebase
- [ ] No dead code or commented-out code

### Next.js Specific
- [ ] `'use client'` only where needed (prefer Server Components)
- [ ] Server Actions for mutations (not API routes)
- [ ] Proper use of `revalidatePath` after mutations
- [ ] Metadata exported for SEO on pages
- [ ] Loading/error files for async pages

## Review Output Format

```markdown
## Summary
Brief overview of what the code does and overall quality.

## Issues Found

### 🔴 Critical
- [file:line] Description of critical issue

### 🟡 Important
- [file:line] Description of important issue

### 🟢 Suggestions
- [file:line] Optional improvement

## What's Good
- Positive aspects of the code
```

## Rules

1. Be specific — reference file paths and line numbers
2. Explain WHY something is an issue, not just WHAT
3. Provide concrete fix suggestions for each issue
4. Prioritize security and correctness over style
5. Don't flag style preferences that Biome already handles (formatting, import order)
6. Acknowledge good patterns — review isn't just about finding problems
