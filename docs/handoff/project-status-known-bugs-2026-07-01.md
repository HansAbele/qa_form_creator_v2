# Handoff - estado actual del proyecto y bugs conocidos

Last updated: 2026-07-01

Este documento resume el estado actual de Qore / QA Form Creator para continuar el trabajo en una conversacion nueva de Codex sin perder contexto.

## Objetivo del proyecto

Qore / QA Form Creator es una plataforma interna para control de calidad QA en operaciones de call center. La app permite crear formularios, evaluar agentes, medir rendimiento por campana, consultar Dashboard/KPIs/reportes y exportar informacion. La regla de seguridad central es que cada usuario solo debe ver y operar sobre las campanas asignadas.

Roles funcionales:

- `ADMIN`: QA Manager / administracion operativa global.
- `QA`: QA de campana con permisos por campana.
- `SUPERVISOR`: lectura por campana, sin mutaciones.

## Estado general actual

El proyecto ya tiene implementados los cimientos principales:

- RBAC real por campana en Server Actions, queries, UI y exports.
- Rol `SUPERVISOR` global, con bloqueo central de mutaciones.
- Auditoria operativa con filtros, detalle before/after, paginacion y scope por campana para no-admins con `canViewAudit`.
- Scoring global y por campana mediante `CampaignScoringSettings`.
- Targets operativos usados en Dashboard, KPIs y Reports:
  - `passThreshold`
  - `targetPassRate`
  - `targetAvgScore`
  - `targetDailyRate`
  - `fatalFailuresAllowed`
- Formularios con draft/published/archived, versionado y publicacion.
- Categorias QA, pesos por pregunta, flags de fatal y comentario requerido.
- Evaluaciones avanzadas:
  - draft manual
  - autosave
  - editar evaluaciones
  - anular evaluaciones con auditoria
  - N/A por pregunta
  - snapshots historicos de scoring/config/form
- Export configurable:
  - seleccion de campos
  - CSV/JSON/Excel
  - Excel enriquecido con resumen, evaluaciones y detalle de respuestas
  - auditoria de export
- Notificaciones in-app repo-side.
- Settings operativos persistidos.

Pendientes externos o de roadmap:

- Rotar secretos historicos que hayan estado expuestos fuera del repo.
- Validar deploy real en servidor siguiendo `docs/production-security-runbook.md`.
- Email/push externo solo si se decide salir del canal in-app.

## Cambios recientes no necesariamente commiteados

El working tree actual tiene cambios locales. No hacer `git reset` ni revertir sin confirmar con el usuario.

Ultimo `git status --short` conocido:

```text
 M src/app/(dashboard)/dashboard-client.tsx
 M src/app/(dashboard)/forms/forms-client.tsx
 M src/app/(dashboard)/forms/page.tsx
 M src/app/globals.css
 M src/server/actions/forms.test.ts
 M src/server/actions/forms.ts
?? scripts/import-qore-reference-data.ts
```

Resumen de esos cambios recientes:

- Dashboard: se ajusto visualmente el bloque `Rendimiento por Campana` y `Disposiciones Mas Frecuentes`.
- Dashboard: se removio la seccion completa `Coaching accionable` porque el usuario la sentia cargada.
- CSS global: se agrego/ajusto comportamiento visual para scrollbars reveladas en hover.
- Forms: se separo mejor `canEditForms` de `canPublishForms`.
- Forms: `publishForm` y `archiveForm` exigen `canPublishForms`.
- Tests de forms: se agrego cobertura para permisos de publicar/archivar.
- Script nuevo: `scripts/import-qore-reference-data.ts` para carga/referencia de datos Qore.

## Validacion reciente

Validacion reciente ejecutada:

```powershell
.\node_modules\.bin\vitest.cmd run src/server/actions/forms.test.ts src/server/actions/responses.test.ts
```

Resultado:

```text
Test Files  2 passed (2)
Tests       17 passed (17)
```

Nota: `pnpm exec vitest ...` intento reconciliar `node_modules` y fallo por no tener TTY. Para tests locales en este entorno funciono mejor llamar directamente a `.\node_modules\.bin\vitest.cmd`.

Validaciones conocidas de pases anteriores:

- TypeScript: `tsc --noEmit` paso.
- Biome lint: `biome lint .` paso.
- Tests de forms pasaron tras el ajuste de permisos de publicacion.

## Como correr localmente

Para evitar conflicto con puertos `3000` o `3001`, usar un puerto libre como `3002`:

```powershell
cd C:\Users\USER\Documents\PX\WORKFORCE\qa_form_creator_v2
pnpm exec next dev --turbopack --hostname 127.0.0.1 --port 3002
```

Abrir:

```text
http://127.0.0.1:3002
```

Si aparece un problema de sesion o usuario local:

- Revisar que el usuario de la cookie exista en la DB local.
- Probar cerrar sesion y entrar de nuevo.
- Revisar `.env` y la DB apuntada por `DATABASE_URL`.

## Bugs y hallazgos actuales del modulo Formularios/Evaluaciones

Estos bugs fueron diagnosticados, pero todavia no se han corregido.

### 1. Rating 4/5 cuenta como "comentario requerido"

Sintoma reportado:

- En `Customer service QA Form`, pregunta `Greeting`.
- Al marcar `4/5` estrellas, el resumen muestra `1 comentario`.
- Solo desaparece al marcar `5/5`.

Causa:

- El cliente considera que una pregunta `RATING` falla si el score es menor a `100%`.
- Es decir, cualquier valor menor de `5/5` se trata como fallo.

Archivo cliente:

- `src/components/forms/form-viewer.tsx`
- Funcion: `isFailedQuestion`
- Logica actual relevante:

```ts
if (question.type === "RATING") return getRatingScore(value) < 100;
```

Impacto:

- Si una pregunta tiene `requiresCommentOnFail`, entonces `4/5` dispara comentario obligatorio.
- Esto es demasiado estricto para una operacion QA real, porque `4/5` equivale a `80%` y puede estar por encima del `passThreshold` de campana.

### 2. Servidor repite la misma regla incorrecta

La regla no es solo visual. El backend tambien considera que `RATING < 100%` es fallo.

Archivo servidor:

- `src/server/actions/responses.ts`
- Funcion: `isFailedAnswer`

Logica actual relevante:

```ts
const ratingScore = getRatingScore(value);
return ratingScore !== null && ratingScore < 100;
```

Impacto:

- Al enviar la evaluacion, el servidor tambien exige comentario para `4/5` si `requiresCommentOnFail` esta activo.
- No basta corregir la UI; cliente y servidor deben usar la misma definicion.

### 3. El viewer no recibe `passThreshold`

El resultado final `PASS/FAIL` del servidor si usa `passThreshold` efectivo por campana.

Archivo:

- `src/server/actions/responses.ts`
- Zona: `getCampaignScoringSettings(form.campaignId)` y calculo de `result`.

Pero la pantalla de evaluacion no recibe ese umbral.

Archivo:

- `src/app/(dashboard)/forms/[id]/page.tsx`
- Renderiza `<FormViewer form={form} ... />` sin pasar `passThreshold`.

Impacto:

- La UI usa una regla local de "solo 5/5 pasa".
- El backend usa `passThreshold` para `PASS/FAIL`.
- Esto crea inconsistencia de experiencia: el usuario ve comentario pendiente aunque la nota podria aprobar segun la campana.

### 4. Critical/fatal no se marca visualmente al seleccionar una opcion

Sintoma reportado:

- Al elegir una opcion critical/fatal, el usuario no ve que quede marcada como critical.

Estado actual:

- Para preguntas `SELECT`/`RADIO`, el sistema puede guardar opciones fatales en `fatalOptions`.
- El servidor marca `isFatalFail` si el valor seleccionado coincide exactamente con una opcion en `fatalOptions`.
- Hay test pasando para SELECT fatal.

Archivo renderer:

- `src/components/forms/question-renderer.tsx`

Problema:

- El componente solo muestra badges generales como `Fatal` u `opcion(es) fatal(es)`.
- No resalta la opcion seleccionada si esa opcion es fatal.
- No muestra un mensaje inmediato debajo de la pregunta tipo "Esta opcion cuenta como falla fatal".

Impacto:

- Aunque la logica puede funcionar, el usuario no tiene feedback claro.
- Si el contador superior no cambia, puede ser por `fatalOptions` mal configurado o por mismatch exacto de texto.

### 5. RATING puede marcarse como fatal sin umbral explicito

El builder permite activar `Falla fatal` en preguntas `RATING` si la categoria QA permite fatal.

Archivos:

- `src/components/forms/question-card.tsx`
- `src/components/forms/form-builder.tsx`
- `src/types/form-builder.ts`
- `src/server/actions/forms.ts`

Problema:

- No existe configuracion de umbral fatal para ratings, por ejemplo "fatal si <= 2 estrellas".
- Como no hay umbral, la logica actual termina interpretando cualquier rating menor a `5/5` como fatal si la pregunta tiene `fatal = true`.

Impacto:

- `4/5` puede convertirse en falla fatal si la pregunta `RATING` es fatal.
- Esto no parece deseable para QA real.

### 6. Tests actuales protegen la regla vieja

Archivo:

- `src/server/actions/responses.test.ts`

Tests relevantes:

- `marks fatal failed rating as FAIL regardless of score threshold`
- `requires a comment when a comment-required rating fails`

Actualmente esperan que `4/5` falle.

Impacto:

- Al corregir la regla, hay que actualizar tests para reflejar la nueva definicion.

## Recomendacion tecnica para corregir los bugs

### Regla recomendada para RATING

Usar el `passThreshold` efectivo de campana:

- `5/5 = 100%`
- `4/5 = 80%`
- `3/5 = 60%`
- `2/5 = 40%`
- `1/5 = 20%`

Una pregunta `RATING` falla si:

```text
ratingScore < passThreshold
```

Ejemplo con `passThreshold = 70`:

- `4/5 = 80%`: no falla, no requiere comentario.
- `3/5 = 60%`: falla, requiere comentario si la pregunta/categoria lo exige.

### Regla recomendada para SELECT/RADIO

Mantener:

```text
falla si selectedValue esta en fatalOptions
```

Mejoras necesarias:

- Resaltar visualmente la opcion seleccionada si es fatal.
- Mostrar texto inmediato: `Esta opcion cuenta como falla fatal`.
- Mantener contador superior `fatalCount`.

### Regla recomendada para RATING fatal

Hay dos caminos:

1. Recomendado para cierre rapido: no permitir `fatal` en preguntas `RATING` hasta tener umbral fatal explicito.
2. Mejor a largo plazo: agregar configuracion por pregunta:

```text
fatalRatingThreshold
```

Ejemplo:

```text
fatal si rating <= 2
```

Para este proyecto, lo mas prudente ahora es la opcion 1.

## Archivos clave para el proximo Codex

Modulo de evaluacion:

- `src/components/forms/form-viewer.tsx`
- `src/components/forms/question-renderer.tsx`
- `src/server/actions/responses.ts`
- `src/server/actions/responses.test.ts`

Modulo builder/formularios:

- `src/components/forms/form-builder.tsx`
- `src/components/forms/question-card.tsx`
- `src/types/form-builder.ts`
- `src/server/actions/forms.ts`
- `src/server/actions/forms.test.ts`

Scoring/settings:

- `src/lib/settings.ts`
- `src/server/actions/campaign-scoring.ts`
- `src/app/(dashboard)/settings/settings-client.tsx`

Pagina de evaluacion:

- `src/app/(dashboard)/forms/[id]/page.tsx`

Dashboard reciente:

- `src/app/(dashboard)/dashboard-client.tsx`
- `src/app/globals.css`

## Plan sugerido para la siguiente tarea

1. Pasar el `passThreshold` efectivo al `FormViewer`.
2. Cambiar cliente y servidor para que `RATING` falle por `ratingScore < passThreshold`, no por `< 100`.
3. Ajustar tests:
   - `4/5` no requiere comentario si `passThreshold <= 80`.
   - `3/5` requiere comentario si `passThreshold = 70`.
   - SELECT/RADIO fatal sigue marcando `hasFatalFail`.
   - N/A sigue excluyendo required/comment/fatal.
4. Mejorar feedback visual en `QuestionRenderer`:
   - opcion fatal seleccionada resaltada
   - warning inmediato en la pregunta
   - contador superior consistente
5. Decidir si se bloquea `fatal` para `RATING` por ahora.
6. Ejecutar:

```powershell
.\node_modules\.bin\vitest.cmd run src/server/actions/forms.test.ts src/server/actions/responses.test.ts
pnpm exec tsc --noEmit
pnpm exec biome lint .
```

## Prompt sugerido para una nueva conversacion de Codex

```text
Lee docs/handoff/project-status-known-bugs-2026-07-01.md y continua desde ahi. No hagas git reset ni reviertas cambios locales. Quiero corregir el modulo Formularios/Evaluaciones: 4/5 no debe contar como fallo si supera el passThreshold de campana, los critical/fatal deben marcarse visualmente al seleccionarlos, y debemos decidir si bloqueamos fatal en RATING hasta tener umbral explicito.
```

