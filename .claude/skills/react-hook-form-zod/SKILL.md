---
name: react-hook-form-zod
description: Assists with building forms using React Hook Form and Zod validation in Next.js. Use when creating form components, defining validation schemas, handling form submission, or integrating forms with Server Actions.
---

# React Hook Form + Zod

You are an expert in React Hook Form with Zod validation for Next.js 15 App Router.

## Project Context

- **Form library:** React Hook Form
- **Validation:** Zod with `@hookform/resolvers/zod`
- **UI components:** shadcn/ui (Input, Select, Textarea, Button, etc.)
- **Submission:** Server Actions (not API routes)

## Standard Form Pattern

```typescript
'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

// 1. Define schema (shared with server)
const formSchema = z.object({
  title: z.string().min(1, 'Required').max(255),
  description: z.string().optional(),
  campaignId: z.string().cuid(),
})

type FormValues = z.infer<typeof formSchema>

// 2. Use in component
export function MyForm() {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: '', description: '', campaignId: '' },
  })

  async function onSubmit(data: FormValues) {
    const result = await serverAction(data)
    // handle result
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      {/* fields */}
    </form>
  )
}
```

## With shadcn/ui Form Components

```typescript
import {
  Form, FormControl, FormField, FormItem,
  FormLabel, FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)}>
    <FormField
      control={form.control}
      name="title"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Title</FormLabel>
          <FormControl>
            <Input {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  </form>
</Form>
```

## Zod Schema Patterns for This Project

### Form Builder schemas
```typescript
const questionSchema = z.object({
  type: z.enum(['TEXT', 'RATING', 'SELECT', 'RADIO']),
  label: z.string().min(1, 'Question text is required').max(500),
  options: z.array(z.string()).optional(),
  required: z.boolean().default(false),
  order: z.number().int().min(0),
})

const formSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  campaignId: z.string().cuid(),
  questions: z.array(questionSchema).min(1, 'At least one question is required'),
})
```

### Evaluation submission
```typescript
const evaluationSchema = z.object({
  formId: z.string().cuid(),
  agentId: z.string().cuid(),
  answers: z.record(z.string(), z.string()), // { questionId: value }
})
```

### User management (admin)
```typescript
const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
  password: z.string().min(8, 'Minimum 8 characters'),
  role: z.enum(['ADMIN', 'QA']),
  campaignIds: z.array(z.string().cuid()).min(1, 'Assign at least one campaign'),
})
```

## Dynamic Form Fields (Form Builder)

Use `useFieldArray` for dynamic question lists:

```typescript
import { useFieldArray } from 'react-hook-form'

const { fields, append, remove, move } = useFieldArray({
  control: form.control,
  name: 'questions',
})

// Add question
append({ type: 'TEXT', label: '', required: false, order: fields.length })

// Remove question
remove(index)

// Reorder (with dnd-kit)
move(oldIndex, newIndex)
```

## Server Action Integration

```typescript
// src/server/actions/forms.ts
'use server'

import { formSchema } from '@/types/schemas'

export async function createForm(data: unknown) {
  const parsed = formSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.flatten() }
  }
  // ... create in DB
  return { success: true }
}
```

## Rules

1. Always define Zod schemas in a shared location (`src/types/schemas.ts`) so both client and server use the same validation
2. Always set `defaultValues` in `useForm` to avoid uncontrolled→controlled warnings
3. Use `form.formState.isSubmitting` to disable submit buttons during async operations
4. Use `form.setError('root', { message })` for server-side errors
5. Never skip `zodResolver` — rely on Zod for all validation, not manual checks
