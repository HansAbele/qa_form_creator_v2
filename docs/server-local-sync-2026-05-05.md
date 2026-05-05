# Checkpoint de sincronizacion servidor/local - 2026-05-05

## Objetivo

Antes de continuar con los cambios criticos de seguridad, backend y UI, se reviso el codigo que esta corriendo en el servidor productivo y se comparo contra el workspace local actual.

Servidor revisado:

```text
https://192.168.80.243/
Host: 192.168.80.243
Proyecto remoto: /opt/qa-form-creator
Contenedor app: qa_form_creator_app
Imagen activa: qa-form-creator:latest
Estado app: healthy
Puerto directo: 3000
```

## Snapshot remoto

Se descargo una copia de solo lectura del codigo fuente remoto en:

```text
_server_backup/remote-20260505-095841
```

La carpeta `_server_backup/` esta ignorada por git, por lo que el snapshot no se mezcla con el codigo del proyecto.

Exclusiones del snapshot:

```text
backups
.env.production
node_modules
.next
```

## Resultado de comparacion

Comparacion del servidor contra `HEAD` limpio:

```text
Archivos remotos modificados vs HEAD: 32
Archivos remotos nuevos vs HEAD: 6
Archivos en HEAD que no existen en servidor: 0
```

Esto confirma que el servidor contiene una capa de UI/analytics que no estaba en el `HEAD` base del repo.

Comparacion del servidor contra el workspace local actual:

```text
Archivos diferentes servidor/local: 41
Archivos solo en servidor: 1
Archivos solo en local: 31
```

El unico archivo relevante que existe solo en servidor es:

```text
src/middleware.ts
```

En local existe:

```text
src/proxy.ts
```

Segun la documentacion local de Next 16.2.2, `middleware` esta deprecado y fue renombrado a `proxy`. La logica de rutas/autenticacion del `middleware.ts` remoto esta conservada en `src/proxy.ts`, asi que no se debe restaurar `middleware.ts`.

## Estado de los cambios visuales remotos en local

De los archivos que el servidor agrego o modifico contra `HEAD`:

```text
23 archivos estan identicos entre servidor y local.
15 archivos existen localmente pero fueron extendidos por cambios posteriores.
0 archivos visuales remotos estan ausentes localmente.
```

Archivos remotos ya identicos en local:

```text
src/app/(dashboard)/admin/agents/agents-client.tsx
src/app/(dashboard)/admin/agents/page.tsx
src/app/(dashboard)/admin/teams/page.tsx
src/app/(dashboard)/admin/teams/teams-client.tsx
src/app/(dashboard)/analytics/agents/[agentId]/agent-detail-client.tsx
src/app/(dashboard)/analytics/agents/[agentId]/page.tsx
src/app/(dashboard)/analytics/dispositions/[dispositionId]/disposition-detail-client.tsx
src/app/(dashboard)/analytics/dispositions/[dispositionId]/page.tsx
src/app/(dashboard)/analytics/dispositions/page.tsx
src/app/(dashboard)/analytics/evaluators/[userId]/evaluator-detail-client.tsx
src/app/(dashboard)/analytics/evaluators/[userId]/page.tsx
src/app/(dashboard)/analytics/responses/[responseId]/page.tsx
src/app/(dashboard)/analytics/responses/[responseId]/response-detail-client.tsx
src/app/(dashboard)/analytics/responses/responses-list-client.tsx
src/app/(dashboard)/analytics/teams/[teamId]/page.tsx
src/app/(dashboard)/analytics/teams/[teamId]/team-detail-client.tsx
src/app/(dashboard)/analytics/teams/teams-analytics-client.tsx
src/app/(dashboard)/kpis/kpis-client.tsx
src/components/admin/agent-form.tsx
src/components/admin/team-form.tsx
src/components/forms/disposition-combobox.tsx
src/components/forms/form-viewer.tsx
src/components/layout/header.tsx
```

Archivos remotos que local ya contiene, pero con cambios posteriores nuestros o del workspace:

```text
prisma/schema.prisma
src/app/(dashboard)/admin/campaigns/campaigns-client.tsx
src/app/(dashboard)/analytics/dispositions/dispositions-analytics-client.tsx
src/app/(dashboard)/analytics/responses/page.tsx
src/app/(dashboard)/dashboard-client.tsx
src/app/(dashboard)/forms/[id]/edit/page.tsx
src/app/(dashboard)/forms/new/page.tsx
src/app/(dashboard)/forms/page.tsx
src/app/(dashboard)/page.tsx
src/server/actions/agents.ts
src/server/actions/dispositions.ts
src/server/actions/forms.ts
src/server/actions/responses.ts
src/server/actions/teams.ts
src/server/queries/analytics.ts
```

## Decision de trabajo

No se debe sobrescribir el workspace local con el snapshot del servidor.

La estrategia correcta es:

```text
1. Mantener el snapshot remoto como referencia.
2. Mantener los cambios locales actuales como base de trabajo.
3. Tratar los 15 archivos divergentes como "local extendido":
   - conservar UI remota ya presente,
   - conservar cambios de permisos/RBAC ya aplicados,
   - revisar manualmente si un ajuste futuro toca esos mismos archivos.
4. No restaurar src/middleware.ts porque Next 16 usa src/proxy.ts.
```

## Verificaciones realizadas antes del checkpoint

```text
pnpm build: OK
pnpm lint -- --max-diagnostics 80: OK con warnings existentes
pnpm test -- --run: OK, sin tests encontrados
pnpm prisma validate: OK
Servidor dev local: http://127.0.0.1:3001/login
```

## Proximo bloque recomendado

Continuar con el endurecimiento de `submitResponse`:

```text
Validar que formulario, agente y disposicion pertenezcan a la misma campana.
Validar que el usuario tenga canEvaluate en esa campana.
Validar que answers correspondan al formulario.
Validar required, tipo, rango y opciones validas.
Evitar respuestas duplicadas o preguntas inyectadas.
Registrar eventos relevantes en auditoria cuando exista el modulo.
```
