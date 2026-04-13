---
name: playwright-generate-test
description: Generates Playwright E2E test files for the QA Form Creator application. Use when creating end-to-end tests, testing user flows, or verifying page functionality.
---

# Playwright Test Generator

You are an expert in Playwright E2E testing for Next.js applications.

## Project Context

- **Framework:** Playwright with TypeScript
- **App:** QA Form Creator (Next.js 15)
- **Auth:** Email/password login with Auth.js v5
- **Key flows:** Login, create form, submit evaluation, view dashboard, export data

## Test File Structure

```
tests/
  e2e/
    auth.spec.ts          # Login/logout flows
    forms.spec.ts         # Form CRUD
    evaluation.spec.ts    # Submit evaluations
    dashboard.spec.ts     # Dashboard + charts
    admin.spec.ts         # User/campaign management
    export.spec.ts        # CSV/Excel export
  fixtures/
    auth.ts               # Authentication helpers
  playwright.config.ts
```

## Playwright Configuration

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
})
```

## Authentication Fixture

```typescript
// tests/fixtures/auth.ts
import { test as base, Page } from '@playwright/test'

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /sign in|login/i }).click()
  await page.waitForURL('/')
}

export const test = base.extend<{ adminPage: Page; qaPage: Page }>({
  adminPage: async ({ browser }, use) => {
    const page = await browser.newPage()
    await loginAs(page, 'admin@empresa.local', 'cambiar123')
    await use(page)
    await page.close()
  },
  qaPage: async ({ browser }, use) => {
    const page = await browser.newPage()
    await loginAs(page, 'qa@empresa.local', 'cambiar123')
    await use(page)
    await page.close()
  },
})

export { expect } from '@playwright/test'
```

## Test Patterns

### Login flow
```typescript
test('should login with valid credentials', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('admin@empresa.local')
  await page.getByLabel('Password').fill('cambiar123')
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByText(/dashboard/i)).toBeVisible()
})

test('should reject invalid credentials', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('wrong@test.com')
  await page.getByLabel('Password').fill('wrong')
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page.getByText(/invalid/i)).toBeVisible()
})
```

### Form creation flow
```typescript
test('should create a new form', async ({ adminPage: page }) => {
  await page.goto('/forms/new')
  await page.getByLabel('Title').fill('Test QA Form')
  await page.getByLabel('Description').fill('E2E test form')

  // Add a rating question
  await page.getByRole('button', { name: /add question/i }).click()
  await page.getByLabel('Question text').fill('How was the greeting?')
  await page.getByLabel('Type').selectOption('RATING')

  await page.getByRole('button', { name: /save/i }).click()
  await expect(page.getByText(/form created/i)).toBeVisible()
})
```

### Data export
```typescript
test('should export data as CSV', async ({ adminPage: page }) => {
  await page.goto('/analytics/export')
  const download = await page.waitForEvent('download', async () => {
    await page.getByRole('button', { name: /export csv/i }).click()
  })
  expect(download.suggestedFilename()).toMatch(/\.csv$/)
})
```

## Best Practices

1. Use role-based selectors (`getByRole`, `getByLabel`, `getByText`) over CSS selectors
2. Use `await expect(locator).toBeVisible()` instead of checking `count()`
3. Use fixtures for authenticated pages to avoid repeating login in every test
4. Use `test.describe` to group related tests
5. Add `data-testid` attributes only when semantic selectors aren't possible
6. Test both happy path and error states
7. Use `page.waitForURL()` after navigation actions
