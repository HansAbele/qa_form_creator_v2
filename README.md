# Qore — QA Form Creator

Qore es una plataforma de evaluacion de calidad para operaciones de contact center. Permite
crear formularios versionados, capturar evaluaciones con autosave, analizar resultados COPC,
administrar catalogos operativos y exportar datos con trazabilidad.

## Acceso por rol

| Rol | Alcance esperado |
| --- | --- |
| QA | Evalua y consulta exclusivamente las campanas asignadas y las capacidades delegadas. |
| QA con permisos elevados | Administra recursos de sus campanas cuando el permiso explicito lo autoriza, sin administracion global. |
| Supervisor | Consulta resultados de sus campanas en modo lectura; no crea ni modifica evaluaciones. |
| QA Manager (`ADMIN`) | Control global de usuarios, campanas, formularios, reportes, KPIs, auditoria y exportaciones. |

La interfaz oculta funciones no autorizadas, pero la seguridad real se aplica nuevamente en
Server Actions, consultas y rutas API mediante rol, permiso y alcance de campana.

## Tecnologia

- Next.js 16.2 App Router, React 19 y TypeScript.
- Auth.js v5 con sesiones persistidas por Prisma.
- PostgreSQL 16 y Prisma ORM.
- Tailwind CSS 4, Radix/Base UI y Recharts.
- Vitest para unidad/integracion y Playwright para E2E/RBAC/WCAG.
- Docker Compose para el despliegue de produccion.

## Desarrollo local

Requisitos: Node.js 20, pnpm 10.34.5 y PostgreSQL 16.

```powershell
Copy-Item .env.example .env
corepack enable
corepack prepare pnpm@10.34.5 --activate
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:seed
pnpm dev
```

Antes del seed, configure en `.env` una base local, `AUTH_SECRET`,
`RATE_LIMIT_HASH_SECRET` y las cuatro variables `QORE_SEED_*_PASSWORD` con valores fuertes.
El seed se bloquea en produccion y solo crea identidades/fixtures de desarrollo. La aplicacion
queda disponible en `http://localhost:3000`.

## Verificacion

```powershell
pnpm lint
pnpm typecheck
pnpm test:ci
pnpm build
pnpm test:e2e
```

Las pruebas de concurrencia y descarga requieren una base PostgreSQL dedicada y dos URLs: un
owner para crear/limpiar fixtures y el rol runtime restringido para ejecutar la aplicacion. Los
scripts disponibles estan declarados en `package.json`; el workflow de CI contiene la secuencia
de referencia completa.

## Produccion y seguridad

No use `prisma db push`, el seed ni scripts historicos de reparacion en produccion. No publique
archivos `.env`, credenciales, backups, `next-env.d.ts` ni bytecode Python. Una entrega requiere
migraciones reproducibles, escaneo de secretos, pruebas sobre el rol runtime, backup/restauracion
y health checks HTTPS.

- [Runbook de seguridad y produccion](docs/production-security-runbook.md)
- [Arquitectura de informacion y acceso](docs/information-architecture-and-access.md)
- [Plan y evidencia P2](docs/plans/p2-quality-resilience.md)
