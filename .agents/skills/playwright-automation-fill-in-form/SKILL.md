---
name: playwright-automation-fill-in-form
description: Automates filling forms in the QA Form Creator using Playwright. Use when testing form submission, automating evaluation entry, or populating forms with test data programmatically.
---

# Playwright Form Automation

You are an expert in automating form interactions with Playwright for the QA Form Creator.

## Project Context

- **Form types:** Form Builder (create forms), Form Viewer (submit evaluations)
- **Question types:** TEXT, RATING, SELECT, RADIO
- **Dynamic forms:** Questions are rendered dynamically based on DB data
- **Drag-and-drop:** Form Builder uses dnd-kit for question reordering

## Form Viewer — Fill Evaluation

```typescript
import { Page, expect } from '@playwright/test'

interface EvaluationData {
  agentId: string
  answers: Record<string, { type: string; value: string }>
}

async function fillEvaluation(page: Page, formId: string, data: EvaluationData) {
  await page.goto(`/forms/${formId}`)

  // Select agent
  await page.getByLabel(/agent/i).selectOption(data.agentId)

  // Fill each question based on type
  for (const [questionId, answer] of Object.entries(data.answers)) {
    const questionBlock = page.locator(`[data-question-id="${questionId}"]`)

    switch (answer.type) {
      case 'TEXT':
        await questionBlock.getByRole('textbox').fill(answer.value)
        break
      case 'RATING':
        // Click the Nth star (1-5)
        await questionBlock
          .getByRole('button', { name: `${answer.value} star` })
          .click()
        break
      case 'SELECT':
        await questionBlock.getByRole('combobox').selectOption(answer.value)
        break
      case 'RADIO':
        await questionBlock.getByLabel(answer.value).check()
        break
    }
  }

  // Submit
  await page.getByRole('button', { name: /submit/i }).click()
  await expect(page.getByText(/submitted|saved/i)).toBeVisible()
}
```

## Form Builder — Create Form

```typescript
interface QuestionInput {
  type: 'TEXT' | 'RATING' | 'SELECT' | 'RADIO'
  label: string
  required?: boolean
  options?: string[]
}

async function buildForm(
  page: Page,
  title: string,
  campaignId: string,
  questions: QuestionInput[]
) {
  await page.goto('/forms/new')

  await page.getByLabel('Title').fill(title)
  await page.getByLabel(/campaign/i).selectOption(campaignId)

  for (const q of questions) {
    await page.getByRole('button', { name: /add question/i }).click()

    // Fill the last question card (newest)
    const cards = page.locator('[data-testid="question-card"]')
    const lastCard = cards.last()

    await lastCard.getByLabel(/question text|label/i).fill(q.label)
    await lastCard.getByLabel(/type/i).selectOption(q.type)

    if (q.required) {
      await lastCard.getByLabel(/required/i).check()
    }

    if (q.options && (q.type === 'SELECT' || q.type === 'RADIO')) {
      for (const opt of q.options) {
        await lastCard.getByRole('button', { name: /add option/i }).click()
        const optionInputs = lastCard.getByPlaceholder(/option/i)
        await optionInputs.last().fill(opt)
      }
    }
  }

  await page.getByRole('button', { name: /save|create/i }).click()
  await expect(page.getByText(/created|saved/i)).toBeVisible()
}
```

## Drag-and-Drop (dnd-kit) Reordering

```typescript
async function reorderQuestion(page: Page, fromIndex: number, toIndex: number) {
  const cards = page.locator('[data-testid="question-card"]')
  const source = cards.nth(fromIndex).locator('[data-testid="drag-handle"]')
  const target = cards.nth(toIndex).locator('[data-testid="drag-handle"]')

  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()

  if (!sourceBox || !targetBox) throw new Error('Cannot find drag elements')

  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2
  )
  await page.mouse.down()
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 10 }
  )
  await page.mouse.up()
}
```

## Batch Evaluation Fill (Load Testing)

```typescript
async function fillMultipleEvaluations(
  page: Page,
  formId: string,
  agentIds: string[],
  count: number
) {
  for (let i = 0; i < count; i++) {
    const agentId = agentIds[i % agentIds.length]
    await page.goto(`/forms/${formId}`)
    await page.getByLabel(/agent/i).selectOption(agentId)

    // Fill all rating questions with random 1-5
    const ratingQuestions = page.locator('[data-question-type="RATING"]')
    const ratingCount = await ratingQuestions.count()
    for (let j = 0; j < ratingCount; j++) {
      const rating = Math.floor(Math.random() * 5) + 1
      await ratingQuestions.nth(j)
        .getByRole('button', { name: `${rating} star` })
        .click()
    }

    await page.getByRole('button', { name: /submit/i }).click()
    await page.waitForTimeout(500) // brief wait between submissions
  }
}
```

## Rules

1. Always wait for form elements to be visible before interacting
2. Use semantic selectors (role, label) over CSS classes
3. Add `data-question-id`, `data-question-type`, and `data-testid` attributes in components to make automation reliable
4. Handle loading states before form interaction
5. Verify success/error messages after submission
