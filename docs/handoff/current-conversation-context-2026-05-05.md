# Handoff de contexto - Qore / QA Form Creator

Ultima actualizacion: 2026-05-06

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
- Hallazgos 5 a 8: mitigados en codigo. Sigue pendiente la rotacion operacional de cualquier secreto que haya estado expuesto historicamente y la validacion del runbook real de produccion antes de usarlo en servidor.

## Cambios ya implementados

### RBAC y aislamiento por campana

- Se agregaron permisos granulares por campana en Prisma via `UserCampaign`.
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

- `pnpm test -- --run`: 9 archivos, 29 tests pasando.
- `pnpm lint -- --max-diagnostics 120`: limpio.
- `pnpm build`: correcto.
- `pnpm exec prisma validate`: schema valido.
- `pnpm db:generate`: correcto.
- `pnpm exec prisma migrate status`: base local al dia con las migraciones.

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

Pendiente de auditoria:

- filtros avanzados en UI
- detalle before/after
- paginacion
- scope limitado por campana para no-admin si se decide habilitarlo

### Scoring por campana

Se agrego:

- `CampaignScoringSettings`
- migracion `prisma/migrations/20260505011000_add_campaign_scoring_settings/`
- accion `src/server/actions/campaign-scoring.ts`
- helpers en `src/lib/settings.ts`
- integracion parcial en `src/server/queries/analytics.ts`

Estado:

- `passThreshold` ya puede resolverse por campana.
- Falta integrar completamente:
  - `targetPassRate`
  - `targetAvgScore`
  - `targetDailyRate`
  - `fatalFailuresAllowed`

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

Analytics/reportes por categoria QA:

- `src/lib/qa-category-metrics.ts` agrupa respuestas calificadas por categoria QA.
- `src/server/queries/analytics.ts` expone `getQACategoryMetrics()` con scope `canViewKPIs`, umbrales por campana y soporte de `visibleInKPIs`.
- `/kpis` muestra score y riesgo por categoria QA: evaluaciones unicas, respuestas bajo umbral, tasa de falla y fallas fatales.
- Detalle de evaluacion y dialogo de reportes muestran categoria QA, score por respuesta, peso, fatal y comentario.
- Tests agregados: `src/lib/qa-category-metrics.test.ts` y `src/server/queries/analytics.test.ts`.

Pendiente:

- validar visualmente analytics/reportes por categoria QA con datos reales
- validar visualmente publicar/archivar/versionar formularios con datos reales
- exportes enriquecidos por categoria QA si se decide llevar el mismo detalle a CSV/XLSX
- reglas fatales para preguntas no-rating si se define una semantica de fallo para opciones

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

Pendiente de Configuracion:

- Validar visualmente en navegador con datos reales.
- Persistir controles avanzados que hoy solo muestran estado operativo.
- Agregar filtros avanzados a Auditoria operativa.

## Estado Prisma local

El bloqueo anterior de `pnpm db:generate` por `EPERM` ya no se reproduce.

Estado actual verificado:

- `pnpm db:generate`: correcto.
- `pnpm exec prisma migrate status`: database schema is up to date.
- `pnpm exec prisma validate`: schema valido.

El codigo todavia conserva delegates tolerantes (`as unknown`) en auditoria/scoring/categorias para soportar entornos que no hayan regenerado cliente Prisma, pero el entorno local ya esta sincronizado.

## Pendientes prioritarios

### Prioridad 1 - limpieza visible

- Validar Configuracion en navegador y ajustar detalles responsive/espaciado si aparecen.
- Validar el nuevo builder y flujo de evaluacion con categorias QA, pesos, flags y comentarios.
- Mantener UI seria, compacta y operativa al completar controles persistidos.

### Prioridad 2 - produccion segura

- Rotar cualquier secreto que haya estado versionado o expuesto historicamente.
- Mantener `scripts/ssh-helper.py` y scripts SSH solo con credenciales por variables de entorno.
- Revisar scripts legacy antes de usarlos contra produccion.
- `scripts/deploy-analytics.py` y `scripts/deploy-analytics-v2.py` ya no usan `prisma db push`; ahora llaman `prisma migrate deploy`.
- `scripts/pw.sql` y `scripts/migration.sql` se eliminaron del repo y quedaron ignorados como artefactos generados.
- `scripts/deploy.sh` usa Prisma CLI fijada y `migrate deploy`.
- `docker-compose.prod.yml` expone app en `127.0.0.1:3000:3000`.
- `src/lib/auth.ts` usa cookies seguras en produccion.

### Prioridad 3 - funcionalidades QA profundas

- Completar formularios por categorias QA: versionado/publicacion/validacion de publicados implementado; falta validacion visual con datos reales y refinamientos de flujo si aparecen.
- Completar evaluaciones por categorias: primer corte de score/reportes/analytics por categoria ya implementado; falta validacion visual con datos reales y exportes detallados si aplican.
- Reglas fatales para preguntas select/radio cuando exista una definicion explicita de respuesta fallida.
- Dashboard/KPIs con categorias criticas: primer corte visible en `/kpis`; falta calibrar visualmente con datos reales.
- Coaching accionable.
- Notificaciones operativas.

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
- `prisma/migrations/20260505010000_add_audit_logs/`
- `prisma/migrations/20260505011000_add_campaign_scoring_settings/`
- `prisma/migrations/20260505012000_add_qa_categories_and_form_versioning/`

## Frase sugerida para iniciar nueva conversacion

Lee `docs/handoff/current-conversation-context-2026-05-05.md`, `docs/plans/qa-settings-critical-changes-plan.md` y `docs/plans/qore-integral-improvements-adjusted-proposal.md`. Continuemos desde el estado actual: validar Configuracion, analytics QA y versionado/publicacion de formularios en navegador, revisar scripts legacy restantes y seguir con exportes QA o reglas fatales no-rating.
