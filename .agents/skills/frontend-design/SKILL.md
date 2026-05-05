---
name: frontend-design
description: Assists with building UI components using shadcn/ui, Tailwind CSS v4, and Radix primitives in Next.js. Use when creating pages, layouts, components, or implementing responsive designs with the project's design system.
---

# Frontend Design with shadcn/ui + Tailwind v4

You are an expert in building UIs with shadcn/ui and Tailwind CSS v4 for Next.js 15.

## Project Context

- **CSS framework:** Tailwind CSS v4
- **Component library:** shadcn/ui (Radix-based)
- **Icons:** Lucide React
- **Theme:** Light/dark with next-themes
- **Charts:** Recharts + shadcn/ui chart components

## Tailwind v4 Key Differences

```css
/* globals.css — Tailwind v4 syntax */
@import "tailwindcss";

/* CSS variables for theming (shadcn/ui pattern) */
@theme {
  --color-background: hsl(0 0% 100%);
  --color-foreground: hsl(222.2 84% 4.9%);
  --color-primary: hsl(221.2 83.2% 53.3%);
  --color-secondary: hsl(210 40% 96.1%);
  --color-destructive: hsl(0 84.2% 60.2%);
  --color-muted: hsl(210 40% 96.1%);
  --color-accent: hsl(210 40% 96.1%);
  --color-card: hsl(0 0% 100%);
  --color-border: hsl(214.3 31.8% 91.4%);
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
}
```

## Component Patterns

### Page layout
```tsx
export default async function FormsPage() {
  const forms = await getForms()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">QA Forms</h1>
        <Button asChild>
          <Link href="/forms/new">
            <Plus className="mr-2 h-4 w-4" />
            New Form
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {forms.map((form) => (
          <FormCard key={form.id} form={form} />
        ))}
      </div>
    </div>
  )
}
```

### KPI Card
```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendingUp } from 'lucide-react'

function KPICard({ title, value, change, icon: Icon }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{change}</p>
      </CardContent>
    </Card>
  )
}
```

### Dashboard sidebar layout
```tsx
// src/app/(dashboard)/layout.tsx
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'

export default function DashboardLayout({ children }) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
```

### Score badge with color coding
```tsx
function ScoreBadge({ score }: { score: number }) {
  const variant = score >= 90
    ? 'default'      // green
    : score >= 70
    ? 'secondary'    // yellow
    : 'destructive'  // red

  return <Badge variant={variant}>{score.toFixed(1)}%</Badge>
}
```

## shadcn/ui Component Usage

Install components as needed:
```bash
pnpm dlx shadcn@latest add button card input select table badge dialog
pnpm dlx shadcn@latest add form       # includes react-hook-form + zod
pnpm dlx shadcn@latest add chart      # includes recharts wrapper
pnpm dlx shadcn@latest add sidebar    # collapsible sidebar
```

## Responsive Design Rules

```tsx
// Mobile-first approach
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
  {/* KPI cards */}
</div>

// Hide on mobile
<div className="hidden md:block">
  <Sidebar />
</div>

// Stack on mobile, row on desktop
<div className="flex flex-col md:flex-row gap-4">
```

## Rules

1. Always use shadcn/ui components over custom implementations
2. Use Tailwind utility classes — never write custom CSS unless absolutely necessary
3. Follow mobile-first responsive design
4. Use `cn()` from `@/lib/utils` for conditional classes
5. Use Lucide icons consistently — never mix icon libraries
6. Use `text-muted-foreground` for secondary text, not hardcoded grays
7. Use semantic color tokens (`primary`, `destructive`, `muted`) not raw colors
8. All interactive elements must have visible focus states (shadcn handles this)
