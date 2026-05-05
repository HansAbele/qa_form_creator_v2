---
name: nextauth-authentication
description: Assists with Auth.js v5 (NextAuth) configuration, session management, middleware protection, and role-based access in Next.js 15 App Router. Use when setting up authentication, configuring providers, protecting routes, or handling sessions.
---

# Auth.js v5 (NextAuth) Authentication

You are an expert in Auth.js v5 for Next.js 15 App Router. This is NOT v4 — the API is significantly different.

## Project Context

- **Version:** Auth.js v5 (`next-auth@beta`)
- **Provider:** Credentials (email + password with bcrypt)
- **Sessions:** Database sessions (not JWT) for invalidation support
- **Roles:** ADMIN, QA
- **Reverse proxy:** Apache (requires `AUTH_TRUST_HOST=true`)

## Critical v5 Differences from v4

1. Config is in `auth.ts` (not `[...nextauth].ts` API route)
2. Use `auth()` not `getServerSession()`
3. Middleware uses `auth` export, not `withAuth`
4. Route handler is at `app/api/auth/[...nextauth]/route.ts` and exports `{ GET, POST }` from `auth.ts`
5. `callbacks.session` and `callbacks.jwt` have different signatures

## File Structure

```
src/
  lib/
    auth.ts           # Main Auth.js config (NextAuth())
    auth.config.ts    # Providers config (separated for middleware edge compat)
  app/
    api/auth/[...nextauth]/
      route.ts        # { GET, POST } exports
  middleware.ts       # Route protection
  types/
    next-auth.d.ts    # Session type augmentation
```

## Core Configuration

```typescript
// src/lib/auth.config.ts
import Credentials from 'next-auth/providers/credentials'
import { compare } from 'bcryptjs'
import { z } from 'zod'
import { prisma } from './prisma'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export default {
  providers: [
    Credentials({
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials)
        if (!parsed.success) return null

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email, active: true },
          include: { campaigns: true },
        })
        if (!user) return null

        const valid = await compare(parsed.data.password, user.password)
        if (!valid) return null

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          campaignIds: user.campaigns.map((c) => c.campaignId),
        }
      },
    }),
  ],
}
```

```typescript
// src/lib/auth.ts
import NextAuth from 'next-auth'
import authConfig from './auth.config'

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: 'database' }, // DB sessions, not JWT
  pages: { signIn: '/login' },
  callbacks: {
    async session({ session, user }) {
      // Augment session with role + campaigns
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        include: { campaigns: true },
      })
      if (dbUser) {
        session.user.id = dbUser.id
        session.user.role = dbUser.role
        session.user.campaignIds = dbUser.campaigns.map((c) => c.campaignId)
      }
      return session
    },
  },
  trustHost: true, // Required for Apache reverse proxy
})
```

```typescript
// src/app/api/auth/[...nextauth]/route.ts
export { GET, POST } from '@/lib/auth'
```

## Type Augmentation

```typescript
// src/types/next-auth.d.ts
import { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: 'ADMIN' | 'QA'
      campaignIds: string[]
    } & DefaultSession['user']
  }
}
```

## Middleware (Route Protection)

```typescript
// src/middleware.ts
import { auth } from '@/lib/auth'

export default auth((req) => {
  const { nextUrl, auth: session } = req

  const isLoggedIn = !!session?.user
  const isLoginPage = nextUrl.pathname === '/login'
  const isAdminRoute = nextUrl.pathname.startsWith('/admin')

  // Redirect to login if not authenticated
  if (!isLoggedIn && !isLoginPage) {
    return Response.redirect(new URL('/login', nextUrl))
  }

  // Redirect to home if already logged in and on login page
  if (isLoggedIn && isLoginPage) {
    return Response.redirect(new URL('/', nextUrl))
  }

  // Block non-admin from admin routes
  if (isAdminRoute && session?.user?.role !== 'ADMIN') {
    return Response.redirect(new URL('/', nextUrl))
  }
})

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
}
```

## Getting Session in Server Components

```typescript
import { auth } from '@/lib/auth'

export default async function Page() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const { role, campaignIds } = session.user
  // ...
}
```

## Getting Session in Server Actions

```typescript
'use server'
import { auth } from '@/lib/auth'

export async function myAction() {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  // ...
}
```

## Getting Session in Client Components

```typescript
'use client'
import { useSession } from 'next-auth/react'

export function MyComponent() {
  const { data: session, status } = useSession()
  if (status === 'loading') return <Skeleton />
  // ...
}
```

## Environment Variables

```bash
AUTH_SECRET=           # openssl rand -base64 32
AUTH_URL=https://qa.empresa.local
AUTH_TRUST_HOST=true   # CRITICAL for Apache reverse proxy
```

## Common Mistakes to Avoid

1. Never use `getServerSession()` — that's v4. Use `auth()` in v5
2. Never import from `next-auth/react` in Server Components
3. Always set `AUTH_TRUST_HOST=true` when behind a reverse proxy
4. Never store plain text passwords — always bcrypt with cost 12
5. Always validate credentials with Zod before database lookup
6. Remember: Credentials provider does NOT support database sessions by default in v5 — you need to configure the adapter explicitly
