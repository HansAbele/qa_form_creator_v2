---
name: access-control-rbac
description: Assists with implementing role-based access control (RBAC) and campaign-level data isolation in the QA Form Creator. Use when writing middleware, server actions, API routes, or any code that needs to enforce permissions.
---

# Access Control & RBAC

You are an expert in implementing RBAC for multi-tenant applications with Next.js 15.

## Project Context

- **Roles:** ADMIN (full access), QA (campaign-scoped)
- **Isolation:** Data filtered by campaignIds from session
- **Enforcement layers:** Middleware (route), Server Actions (data), UI (visibility)

## Core: getCampaignFilter()

This is the single source of truth for data isolation. Every query that touches campaign-scoped data MUST use it.

```typescript
// src/server/queries/campaign-filter.ts
import { auth } from '@/lib/auth'

type CampaignFilter = { campaignId?: { in: string[] } }

export async function getCampaignFilter(): Promise<CampaignFilter> {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')

  if (session.user.role === 'ADMIN') return {}
  return { campaignId: { in: session.user.campaignIds } }
}

export function getCampaignFilterSync(
  role: string,
  campaignIds: string[]
): CampaignFilter {
  if (role === 'ADMIN') return {}
  return { campaignId: { in: campaignIds } }
}
```

## Layer 1: Middleware (Route Protection)

```typescript
// src/middleware.ts
const adminRoutes = ['/admin']
const publicRoutes = ['/login']

export default auth((req) => {
  const { pathname } = req.nextUrl
  const session = req.auth

  // Public routes
  if (publicRoutes.some((r) => pathname.startsWith(r))) return

  // Must be logged in
  if (!session?.user) {
    return Response.redirect(new URL('/login', req.nextUrl))
  }

  // Admin-only routes
  if (adminRoutes.some((r) => pathname.startsWith(r))) {
    if (session.user.role !== 'ADMIN') {
      return Response.redirect(new URL('/', req.nextUrl))
    }
  }
})
```

## Layer 2: Server Actions (Data Protection)

```typescript
// src/server/actions/forms.ts
'use server'

import { auth } from '@/lib/auth'
import { getCampaignFilter } from '@/server/queries/campaign-filter'
import { prisma } from '@/lib/prisma'

export async function getForms() {
  const filter = await getCampaignFilter()

  return prisma.form.findMany({
    where: filter,
    include: {
      _count: { select: { questions: true, responses: true } },
      campaign: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createForm(data: FormInput) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')

  // QA can only create forms for their campaigns
  if (session.user.role === 'QA') {
    if (!session.user.campaignIds.includes(data.campaignId)) {
      throw new Error('Cannot create form for this campaign')
    }
  }

  return prisma.form.create({
    data: { ...data, createdById: session.user.id },
  })
}
```

## Layer 3: UI (Conditional Rendering)

```tsx
// Server component
import { auth } from '@/lib/auth'

export default async function Layout({ children }) {
  const session = await auth()
  const isAdmin = session?.user?.role === 'ADMIN'

  return (
    <Sidebar>
      <NavLink href="/">Dashboard</NavLink>
      <NavLink href="/forms">Forms</NavLink>
      <NavLink href="/reports">Reports</NavLink>
      {isAdmin && (
        <>
          <NavLink href="/admin/users">Users</NavLink>
          <NavLink href="/admin/campaigns">Campaigns</NavLink>
          <NavLink href="/admin/agents">Agents</NavLink>
        </>
      )}
    </Sidebar>
  )
}
```

```tsx
// Client component
'use client'
import { useSession } from 'next-auth/react'

export function AdminButton() {
  const { data: session } = useSession()
  if (session?.user?.role !== 'ADMIN') return null
  return <Button>Admin Action</Button>
}
```

## Permission Checks Helper

```typescript
// src/lib/permissions.ts
type Role = 'ADMIN' | 'QA'

const permissions = {
  'users:create': ['ADMIN'],
  'users:read': ['ADMIN'],
  'campaigns:create': ['ADMIN'],
  'campaigns:read': ['ADMIN', 'QA'], // QA sees only their own
  'forms:create': ['ADMIN', 'QA'],
  'forms:delete': ['ADMIN'],
  'forms:read': ['ADMIN', 'QA'],
  'responses:create': ['ADMIN', 'QA'],
  'responses:read': ['ADMIN', 'QA'],
  'agents:create': ['ADMIN'],
  'kpis:configure': ['ADMIN'],
  'export:all': ['ADMIN', 'QA'],
} as const

type Permission = keyof typeof permissions

export function hasPermission(role: Role, permission: Permission): boolean {
  return permissions[permission].includes(role)
}

export function requirePermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`Forbidden: ${permission} requires ${permissions[permission].join(' or ')}`)
  }
}
```

## Rules

1. NEVER trust client-side role checks alone — always verify on the server
2. EVERY Server Action must call `getCampaignFilter()` or `auth()` as its first line
3. NEVER expose user IDs or campaign IDs in URLs without server-side verification
4. ADMIN sees all data, QA sees only their campaigns — no exceptions
5. Use `requirePermission()` for actions, `hasPermission()` for UI visibility
6. Log all permission denials for audit purposes
7. Campaign assignment changes take effect on next login (session refresh)
