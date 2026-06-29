# Handoff de contexto - Qore / QA Form Creator

Ultima actualizacion: 2026-05-18

Este documento resume el estado actual de la conversacion y del trabajo realizado para poder continuar en una nueva conversacion sin perder contexto.

## Referencias principales

- Plan tecnico principal: `docs/plans/qa-settings-critical-changes-plan.md`
- Propuesta integral ajustada: `docs/plans/qore-integral-improvements-adjusted-proposal.md`
- Sincronizacion servidor/local: `docs/server-local-sync-2026-05-05.md`
- Guia de despliegue existente: `docs/DEPLOY_NEW_PROJECT.md`

## Objetivo del proyecto

Qore / QA Form Creator es una plataforma interna para control operativo QA en operaciones de call center. La app permite crear formularios, evaluar agentes, medir desempeno por campana, consultar Dashboard/KPIs/reportes y exportar informacion. La regla central es que cada usuario solo debe ver y operar sobre las campanas asignadas.

Roles funcionales definidos:

- QA Manager: administracion operativa global.
- QA de campana: administracion limitada a campanas asignadas.
- Supervisor: lectura por campana.

## Hallazgos criticos originales

1. `src/server/actions/agents.ts`: filtro de campana sobrescribible.
2. `src/server/actions/teams.ts`: mutaciones sin RBAC por entidad.
3. `src/server/actions/responses.ts`: envio de evaluaciones sin validar pertenencia.
4. `src/server/actions/exports.ts`: exports filtraban fuera del scope.
5. `scripts/ssh-helper.py`: secreto SSH versionado historicamente.
6. `scripts/deploy.sh`: migraciones de produccion fragiles.
7. `docker-compose.prod.yml`: app expuesta directo por HTTP.
8. `src/lib/auth.ts`: cookies no seguras en produccion.

Estado actual:

- Hallazgos 1 a 4: mitigados en codigo y cubiertos por tests RBAC.
- Hallazgos 5 a 8: mitigados en codigo y documentados en `docs/production-security-runbook.md`. Repo-side cerrado al 2026-05-13: env files fuera de Git, deploy endurecido, Docker/Apache documentado y `migrate deploy` como ruta canonica. Sigue siendo accion operacional externa rotar cualquier secreto que haya estado expuesto historicamente en servidor/password manager.

## Cambios ya implementados

### RBAC y aislamiento por campana

- Se agregaron permisos granulares por campana en Prisma via `UserCampaign`.
- Se agrego el rol global `SUPERVISOR` en Prisma/Auth/UI.
- `SUPERVISOR` queda limitado a lectura por campana asignada: Dashboard, KPIs, formularios y reportes.
- Las mutaciones quedan bloqueadas en servidor para `SUPERVISOR`, incluso si una fila legacy de `UserCampaign` conserva permisos de escritura en `true`.
- Se agrego `src/lib/campaign-permissions.ts`.
- Se agrego `src/server/queries/campaign-filter.ts`.
- Acciones sensibles ahora validan permisos por campana:
  - `agents`
  - `teams`
  - `dispositions`
  - `forms`
  - `responses`
  - `exports`
  - rutas/UI visibles via `ui-access`

### Tests reales RBAC

Se agrego Vitest y mocks controlados:

- `vitest.config.ts`
- `src/test/prisma-mock.ts`
- `src/server/queries/campaign-filter.test.ts`
- `src/server/actions/exports.test.ts`
- `src/server/actions/agents.test.ts`
- `src/server/actions/teams.test.ts`
- `src/server/actions/dispositions.test.ts`
- `src/server/actions/responses.test.ts`

Ultimo resultado conocido:

- `pnpm test`: 10 archivos, 41 tests pasando.
- `pnpm lint`: limpio.
- `pnpm build`: correcto.
- `pnpm exec prisma validate`: schema valido.
- `pnpm db:generate`: correcto.
- `pnpm exec prisma migrate status`: base local al dia con las migraciones.

Commit operativo reciente:

- `fcc0edf feat: complete operational settings validation`

### Auditoria operativa

Se agrego base de auditoria:

- `AuditLog` en `prisma/schema.prisma`
- migracion `prisma/migrations/20260505010000_add_audit_logs/`
- helper `src/server/audit-log.ts`
- lector `src/server/actions/audit.ts`

Eventos conectados:

- usuarios
- permisos por campana
- campanas
- scoring global
- scoring por campana
- agentes
- equipos
- disposiciones
- formularios
- evaluaciones
- exportaciones

Estado de auditoria al 2026-05-15:

- Configuracion ya muestra filtros avanzados de auditoria.
- El detalle before/after ya esta disponible en la UI.
- La auditoria ya tiene paginacion.
- Auditoria para no-admins ya esta expuesta con permiso explicito `canViewAudit`.
- QA/Supervisor solo ven eventos de campanas donde tienen `canViewAudit`; eventos globales o de campanas ajenas quedan fuera del scope.

### Scoring por campana

Se agrego:

- `CampaignScoringSettings`
- migracion `prisma/migrations/20260505011000_add_campaign_scoring_settings/`
- accion `src/server/actions/campaign-scoring.ts`
- helpers en `src/lib/settings.ts`
- integracion completa en `src/server/queries/analytics.ts`

Estado:

- `passThreshold` ya puede resolverse por campana.
- Targets operativos cerrados repo-side el 2026-05-18:
  - `targetPassRate`
  - `targetAvgScore`
  - `targetDailyRate`
  - `fatalFailuresAllowed`
- Dashboard, KPIs y Reports ya consumen settings efectivos por campana para metricas, badges, alertas y comparativos.

### Categorias QA y versionado

Se preparo la base de datos para:

- `QACategory`
- `FormCategory`
- `Form.status`
- `Form.version`
- `Form.publishedAt`
- `Form.archivedAt`
- `Question.weight`
- `Question.fatal`
- `Question.requiresCommentOnFail`
- `Answer.categoryId`
- `Answer.score`
- `Answer.comment`
- `Answer.isFatalFail`
- `Response.formVersion`
- `Response.result`
- `Response.hasFatalFail`
- `Response.status`

Migracion:

- `prisma/migrations/20260505012000_add_qa_categories_and_form_versioning/`

Accion agregada:

- `src/server/actions/qa-categories.ts`

Builder de formularios:

- `src/components/forms/form-builder.tsx` ahora recibe categorias QA activas.
- `src/components/forms/question-card.tsx` permite asignar categoria QA por pregunta.
- Las preguntas `RATING` tienen peso configurable y el builder valida que los pesos sumen 100%.
- Las preguntas permiten flags de falla fatal y comentario requerido segun categoria.
- `src/server/actions/forms.ts` valida categorias QA activas, persistencia de `FormCategory`, `Question.weight`, `Question.fatal` y `Question.requiresCommentOnFail`.

Versionado/publicacion de formularios:

- `prisma/migrations/20260506093000_add_form_revision_parent/` agrega `Form.parentFormId`, indices por parent/status y backfill para que formularios existentes queden `PUBLISHED`.
- Formularios nuevos quedan como `DRAFT`; solo formularios `PUBLISHED` se pueden evaluar.
- Editar un formulario `PUBLISHED` crea un borrador de nueva version (`1.0.0` -> `1.1.0`) sin borrar preguntas ni alterar la version publicada.
- Publicar un borrador archiva la version publicada anterior dentro de la misma familia de revisiones.
- `src/app/(dashboard)/forms/forms-client.tsx` muestra estado/version y acciones de publicar/archivar/eliminar segun estado.
- `src/components/forms/form-builder.tsx` avisa cuando guardar un publicado creara un borrador de nueva version.
- Tests agregados en `src/server/actions/forms.test.ts`: editar publicado crea draft, publicar archiva anterior y borradores no son evaluables.

Evaluaciones:

- `src/components/forms/form-viewer.tsx` muestra score estimado, peso configurado, fallas fatales y comentarios requeridos pendientes.
- `src/components/forms/question-renderer.tsx` muestra badges de categoria/peso/fatal/comentario y captura comentarios QA por pregunta.
- `src/server/actions/responses.ts` calcula score ponderado cuando hay pesos, mantiene fallback de promedio simple para formularios antiguos sin pesos, guarda `formVersion`, `result`, `hasFatalFail`, `Answer.categoryId`, `Answer.score`, `Answer.comment` y `Answer.isFatalFail`.
- El servidor exige comentario cuando una pregunta `RATING` marcada como `requiresCommentOnFail` falla. En esta primera regla, una pregunta rating falla cuando no obtiene 5/5.
- Tests ampliados en `src/server/actions/responses.test.ts`: cobertura de score ponderado, metadata de respuestas, fatal fail y comentario obligatorio.
- Evaluaciones avanzadas cerradas el 2026-05-18:
  - `Response.status` soporta `DRAFT`, `SUBMITTED` y `CANCELLED`.
  - `FormViewer` permite guardar borrador manual, autosave silencioso y resume borradores via `?responseId=...`.
  - `QuestionRenderer` soporta N/A por pregunta; las respuestas N/A quedan excluidas del denominador de scoring rating.
  - `submitResponse` publica evaluaciones nuevas, convierte borradores en enviadas y edita evaluaciones enviadas solo con `canEditEvaluations`.
  - `cancelResponse` anula evaluaciones con motivo y auditoria.
  - `Response` guarda `scoringSnapshot`, `settingsSnapshot` y `formSnapshot` historicos.
  - Dashboard/KPIs/reportes/export filtran solo `SUBMITTED`; drafts y anuladas no contaminan metricas ni archivos.
  - Detalle de evaluacion permite editar/anular si el usuario tiene permiso y muestra estado/anulacion.

Analytics/reportes por categoria QA:

- `src/lib/qa-category-metrics.ts` agrupa respuestas calificadas por categoria QA.
- `src/server/queries/analytics.ts` expone `getQACategoryMetrics()` con scope `canViewKPIs`, umbrales por campana y soporte de `visibleInKPIs`.
- `/kpis` muestra score y riesgo por categoria QA: evaluaciones unicas, respuestas bajo umbral, tasa de falla y fallas fatales.
- Detalle de evaluacion y dialogo de reportes muestran categoria QA, score por respuesta, peso, fatal y comentario.
- Tests agregados: `src/lib/qa-category-metrics.test.ts` y `src/server/queries/analytics.test.ts`.
- Reportes y KPIs ya respetan `Response.result` y `Response.hasFatalFail`.
- Las opciones fatales de preguntas `SELECT` y `RADIO` ya se soportan con `fatalOptions` en builder, viewer y scoring.
- Exportaciones ya incluyen `Resultado` y `Falla fatal`.
- Export configurable cerrado repo-side el 2026-05-18: seleccion de campos, Excel enriquecido con resumen/evaluaciones/detalle de respuestas y auditoria con campos seleccionados.

Validado/cerrado:

- Validacion visual de analytics/reportes por categoria QA con datos reales.
- Validacion visual de crear, editar y publicar formulario con datos reales.
- Validacion visual de evaluacion con opcion fatal `SELECT`/`RADIO`.
- Validacion visual de reportes, KPIs y export con datos reales.

Pendiente real de este bloque:

- Sin pendientes repo-side. Queda solo validacion operacional si se requiere con datos productivos.

### Arranque local y sesiones

Se corrigio el problema observado al probar localmente:

- `/` ya no redirige ciegamente a `/login`; ahora resuelve al dashboard del route group `(dashboard)`.
- El proxy permite abrir `/login` aunque exista una cookie vieja.
- `/settings` redirige a `/login` si la sesion apunta a un usuario que ya no existe en la DB local, en vez de caer en 500 con `Usuario no encontrado`.
- Se reemplazo `next-themes` por `src/components/theme-provider.tsx` para evitar el overlay de Next 16 por `<script>` dentro de componente React.

## Estado del modulo Configuracion

La pantalla `src/app/(dashboard)/settings/settings-client.tsx` fue limpiada en el pase del 2026-05-05:

- Se corrigio el mojibake visible en el componente.
- Se reemplazo el menu horizontal por navegacion lateral interna.
- Se quitaron textos visibles tipo "Pendiente:".
- Las secciones de Evaluaciones, Formularios, Dashboard/KPIs, Reportes/Exportacion y Notificaciones muestran estados operativos con switches de lectura y badges, sin lenguaje de backlog interno.

Estado al 2026-05-13:

- Validado visualmente en navegador con datos reales.
- Los controles avanzados operativos ya persisten via `AppSetting.operationalConfig`.
- Auditoria operativa ya tiene filtros avanzados, detalle before/after y paginacion.
- El switch de Notificaciones queda persistido y probado tras recarga.
- No hay pendiente funcional abierto en Configuracion para la fase operativa cerrada en `fcc0edf`.

## Estado Prisma local

El bloqueo anterior de `pnpm db:generate` por `EPERM` ya no se reproduce.

Estado actual verificado:

- `pnpm db:generate`: correcto.
- `pnpm exec prisma migrate status`: database schema is up to date.
- `pnpm exec prisma validate`: schema valido.
- Migraciones `20260514090000_add_supervisor_role`, `20260515090000_add_campaign_audit_permission` y `20260518120000_advanced_evaluations` aplicadas localmente.

El codigo todavia conserva delegates tolerantes (`as unknown`) en auditoria/scoring/categorias para soportar entornos que no hayan regenerado cliente Prisma, pero el entorno local ya esta sincronizado.

## Pendientes prioritarios reales

### Prioridad 1 - produccion segura

- Repo-side cerrado en `docs/production-security-runbook.md`.
- `.env` y `odoo.local.env` removidos de tracking y protegidos por `.gitignore`.
- `docker-compose.prod.yml` exige `DB_PASSWORD`, `AUTH_SECRET` y `AUTH_URL`.
- `scripts/deploy.sh` rechaza `AUTH_URL` no HTTPS, host placeholder y credenciales placeholder.
- `pnpm db:push` queda protegido por `scripts/guard-db-push.mjs` para impedir ejecucion contra DB no local sin override explicito.
- Accion operacional externa: rotar secretos historicamente expuestos y verificar deploy real en servidor con el runbook.

### Prioridad 2 - roles, permisos y auditoria por alcance

- Decision cerrada el 2026-05-14: se mantiene el modelo actual de permisos booleanos en `UserCampaign`. Ver `docs/decisions/2026-05-14-campaign-permissions-model.md`.
- Auditoria no-admin cerrada el 2026-05-15: `canViewAudit` por campana, Settings visible por permiso y Server Action con scope obligatorio.

### Prioridad 3 - funcionalidades QA profundas

- Evaluaciones avanzadas cerradas repo-side el 2026-05-18: draft/autosave, editar/anular con auditoria, N/A y snapshots historicos completos.
- Targets operativos Dashboard/KPIs/Reports cerrados repo-side el 2026-05-18.
- Export configurable cerrado repo-side el 2026-05-18.
- Dashboard/KPIs con coaching y tendencias mas profundas.
- Coaching accionable.
- Motor real de notificaciones: eventos, destinatarios, inbox/toasts/email.

## Archivos clave para revisar en la siguiente conversacion

- `src/app/(dashboard)/settings/settings-client.tsx`
- `src/app/(dashboard)/settings/page.tsx`
- `src/lib/settings.ts`
- `src/server/queries/analytics.ts`
- `src/server/queries/campaign-filter.ts`
- `src/server/audit-log.ts`
- `src/server/actions/audit.ts`
- `src/server/actions/campaign-scoring.ts`
- `src/server/actions/qa-categories.ts`
- `prisma/schema.prisma`
- `prisma/migrations/20260518120000_advanced_evaluations/`
- `docs/decisions/2026-05-14-campaign-permissions-model.md`
- `prisma/migrations/20260514090000_add_supervisor_role/`
- `prisma/migrations/20260505010000_add_audit_logs/`
- `prisma/migrations/20260505011000_add_campaign_scoring_settings/`
- `prisma/migrations/20260505012000_add_qa_categories_and_form_versioning/`

## Frase sugerida para iniciar nueva conversacion

Lee `docs/handoff/current-conversation-context-2026-05-05.md`, `docs/plans/qa-settings-critical-changes-plan.md` y `docs/plans/qore-integral-improvements-adjusted-proposal.md`. Continuemos desde el estado actual: la fase operativa de Settings, auditoria UI, validacion visual, formularios versionados, opcion fatal SELECT/RADIO, reportes/KPIs/export con datos reales, produccion segura repo-side, rol Supervisor read-only, decision de mantener permisos booleanos, auditoria no-admin por campana y evaluaciones avanzadas ya quedaron cerrados. Lo siguiente real es targets de scoring, export configurable, coaching/tendencias o motor de notificaciones.
