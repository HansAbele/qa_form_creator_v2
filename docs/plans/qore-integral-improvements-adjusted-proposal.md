# Propuesta integral de mejoras ajustada a Qore

Last updated: 2026-05-04

## 1. Proposito del documento

Este documento toma la propuesta integral de mejoras para Qore / QA Form Creator y la ajusta al estado real del proyecto despues del analisis del codigo, los modulos existentes, el schema Prisma, las Server Actions, la UI actual y el despliegue.

La propuesta original tiene una direccion correcta: Qore debe evolucionar hacia una plataforma seria de gobierno operativo QA por campana. Sin embargo, varias ideas dependen de cimientos que aun no existen en el proyecto: permisos granulares, rol Supervisor, scoring por categoria, auditoria, formularios versionados y evaluaciones con reglas avanzadas.

Este documento organiza la propuesta en una hoja de ruta realista para nuestro proyecto.

## 2. Contexto actual de Qore

Qore es una aplicacion interna para control de calidad en operaciones de call center. Hoy permite:

- Autenticacion con credenciales usando Auth.js.
- Usuarios con roles `ADMIN` y `QA`.
- Asignacion de usuarios a campanas mediante `UserCampaign`.
- Administracion de campanas.
- Administracion de usuarios.
- Administracion de agentes.
- Administracion de equipos.
- Administracion de disposiciones y categorias de disposicion.
- Creacion y edicion de formularios.
- Evaluacion de agentes usando formularios.
- Calculo de score basado en preguntas `RATING`.
- Dashboard general.
- KPIs.
- Reports.
- Exportacion CSV, Excel y JSON.
- Analytics por agentes, equipos, evaluadores, disposiciones y respuestas.
- Configuracion actual con:
  - Mi cuenta.
  - Scoring global basico.

La aplicacion ya tiene una base funcional fuerte, pero todavia no tiene una capa completa de gobierno operativo.

## 3. Decision general sobre la propuesta

La propuesta es apropiada y aporta valor real para Qore, con ajustes.

### Se acepta como direccion principal

- Configuracion debe ser operativa, no tecnica.
- QA Manager debe ser el rol de administracion operativa.
- QA debe operar dentro de campanas asignadas.
- Supervisor debe ser lectura por campana.
- Dashboard debe ser ejecutivo.
- KPIs deben ser analiticos y profundos.
- Formularios deben evolucionar hacia categorias, pesos y reglas.
- Evaluaciones deben validar mas que solo respuestas simples.
- Exportaciones deben respetar permisos y quedar auditadas.
- Auditoria operativa es necesaria.

### Se ajusta para el proyecto actual

- En base de datos, hoy `ADMIN` representa al futuro "QA Manager". No conviene renombrarlo sin migracion planificada. Primero se puede cambiar la etiqueta en UI.
- El rol `SUPERVISOR` no existe. Debe agregarse despues de fortalecer RBAC.
- No existe `CampaignAccess` granular. Hoy solo existe `UserCampaign`.
- No existen categorias QA para scoring. Hoy existen categorias de disposiciones, que son otra cosa.
- No existe versionado de formularios.
- No existe N/A, fatal fail, pesos, snapshots de scoring o edicion de evaluaciones.
- Configuracion actual debe crecer por fases, no reemplazarse de golpe.

### Se elimina del alcance funcional

Estos elementos no deben estar en Configuracion para usuarios operativos:

- Logo.
- Paleta de colores.
- Branding visual.
- Vista previa visual de interfaz.
- Servidores.
- Base de datos.
- Backups.
- Deploys.
- Jobs tecnicos.
- Logs internos.
- IP o diagnostico avanzado.

## 4. Roles objetivo ajustados

### 4.1 QA Manager

Equivalente funcional del rol actual `ADMIN`.

Puede:

- Ver todas las campanas.
- Ver metricas globales.
- Crear usuarios.
- Asignar usuarios a campanas.
- Delegar permisos por campana.
- Administrar agentes, equipos, formularios y disposiciones globalmente.
- Configurar scoring global.
- Configurar scoring por campana.
- Administrar categorias QA.
- Ver auditoria operativa.
- Exportar reportes globales o por campana.

No debe:

- Cambiar branding.
- Ver configuracion tecnica.
- Ver detalles de base de datos, backups, deploys o servidor.

### 4.2 QA de campana

Equivalente funcional del rol actual `QA`, pero con permisos mas granulares.

Puede, segun permisos:

- Ver Dashboard de sus campanas.
- Ver KPIs de sus campanas.
- Ver agentes de sus campanas.
- Crear formularios de sus campanas.
- Editar formularios de sus campanas.
- Publicar formularios de sus campanas.
- Evaluar agentes de sus campanas.
- Editar evaluaciones de sus campanas.
- Ver reportes de sus campanas.
- Exportar reportes de sus campanas.
- Administrar agentes, equipos y disposiciones de sus campanas.
- Ajustar scoring de campana si QA Manager lo permite.

No debe:

- Ver campanas no asignadas.
- Ver metricas globales sin permiso.
- Crear usuarios.
- Dar acceso a campanas.
- Delegar permisos criticos.
- Cambiar configuracion global.

### 4.3 Supervisor

Rol nuevo recomendado para fase posterior.

Puede, segun permisos:

- Ver Dashboard de su campana.
- Ver KPIs de su campana.
- Ver agentes.
- Ver evaluaciones.
- Ver tendencias.
- Ver coaching list.
- Ver reportes si se permite.

No debe:

- Crear formularios.
- Editar formularios.
- Publicar formularios.
- Evaluar agentes.
- Editar evaluaciones.
- Cambiar scoring.
- Cambiar configuracion.
- Exportar salvo permiso especial.

## 5. Principios de diseno y seguridad

### 5.1 Seguridad en backend primero

Qore no debe depender de ocultar botones en la UI. Cada accion debe validar:

- Usuario autenticado.
- Rol base.
- Campanas asignadas.
- Permiso especifico por campana.
- Entidad objetivo pertenece a campana permitida.

### 5.2 Aislamiento por campana

Todo modulo que lea o modifique datos debe aplicar filtro de campana en servidor:

- Dashboard.
- KPIs.
- Reports.
- Export.
- Formularios.
- Evaluaciones.
- Agentes.
- Equipos.
- Disposiciones.
- Analytics.
- Configuracion por campana.

### 5.3 Configuracion operativa

Configuracion debe controlar reglas QA, no aspectos tecnicos:

- Mi cuenta.
- Accesos y permisos.
- Scoring global.
- Scoring por campana.
- Categorias QA.
- Evaluaciones.
- Formularios.
- Dashboard y KPIs.
- Reportes y exportacion.
- Notificaciones.
- Auditoria operativa.

## 6. Estado actual por modulo y ajuste recomendado

## 6.1 Dashboard

### Estado actual

El Dashboard existe en:

- `src/app/(dashboard)/page.tsx`
- `src/app/(dashboard)/dashboard-client.tsx`
- `src/server/queries/analytics.ts`

Actualmente recibe:

- usuario,
- rol,
- settings globales,
- campanas disponibles,
- metricas generales desde queries de analytics.

### Ajuste recomendado

La propuesta de hacerlo mas ejecutivo es correcta.

El Dashboard debe responder:

```text
Como va la operacion ahora mismo?
```

Debe mantenerse compacto y orientado a estado general.

### Cambios aplicables ahora

- Separar visualmente graficos largos de graficos cortos.
- Usar Top N en rendimiento por campana.
- Agregar botones "Ver todas" para listas largas.
- Evitar cards gigantes cuando hay pocos datos.
- Mostrar estados contra targets globales actuales.

### Cambios que dependen de fases futuras

Estos requieren categorias QA y scoring avanzado:

- Resumen de categorias criticas.
- Fallas fatales.
- Categoria mas fuerte/debil por agente.
- Coaching basado en categoria.
- Tendencia por categoria.

### Dashboard objetivo

Cards superiores:

```text
Total formularios
Total evaluaciones
Score promedio
Pass Rate
Alertas / fallas criticas
```

Graficos:

```text
Tendencia de evaluaciones
Tendencia de score promedio
Distribucion de scores
Pass / Fail
Rendimiento por campana Top 8
Disposiciones mas frecuentes
```

Listas:

```text
Top performers
Bottom coaching
Evaluaciones recientes
```

## 6.2 Formularios

### Estado actual

El modulo existe en:

- `src/app/(dashboard)/forms/page.tsx`
- `src/app/(dashboard)/forms/new/page.tsx`
- `src/app/(dashboard)/forms/[id]/page.tsx`
- `src/app/(dashboard)/forms/[id]/edit/page.tsx`
- `src/components/forms/form-builder.tsx`
- `src/components/forms/form-viewer.tsx`
- `src/components/forms/question-card.tsx`
- `src/components/forms/question-renderer.tsx`
- `src/server/actions/forms.ts`

El schema actual tiene:

- `Form`
- `Question`
- `QuestionType`

No tiene:

- estado de formulario,
- version,
- categoria QA por pregunta,
- pesos,
- fatal flags,
- N/A,
- publicacion,
- archivo,
- snapshots.

### Ajuste recomendado

La propuesta de convertir Formularios en un builder profesional por categorias es muy valiosa, pero debe implementarse despues de RBAC y categorias QA.

### Cambios aplicables ahora

- Mejorar la lista de formularios.
- Mostrar campana, cantidad de preguntas, evaluaciones y fecha.
- Arreglar permisos: `isAdmin={true}` no debe ser fijo.
- Validar en servidor que QA solo cree/edite formularios de campanas permitidas.

### Cambios objetivo

Formulario debe evolucionar a:

```text
Formulario
├── Categorias QA
│   ├── Preguntas
│   ├── Pesos
│   └── Reglas
```

Estados:

```text
Borrador
Publicado
Archivado
Requiere revision
```

Builder:

```text
Datos generales
Categorias
Preguntas
Pesos
Reglas
Vista previa
Validacion
Publicacion
```

Validaciones antes de publicar:

```text
Tiene campana
Tiene preguntas
Todas las preguntas tienen categoria
Pesos de categorias suman 100
Preguntas requeridas tienen opciones validas
Preguntas rating tienen escala valida
```

### Ajuste importante

No debemos meter versionado de formularios como detalle cosmetico. Es un cambio de datos critico. Debe hacerse con migracion y snapshot para no romper evaluaciones historicas.

## 6.3 Evaluaciones

### Estado actual

El flujo existe en:

- `src/components/forms/form-viewer.tsx`
- `src/server/actions/responses.ts`
- `Response`
- `Answer`

Actualmente:

- selecciona agente,
- selecciona disposicion,
- responde preguntas,
- calcula score con preguntas `RATING`,
- guarda respuestas.

No valida suficientemente:

- agente pertenece a campana del formulario,
- disposicion pertenece a campana del formulario,
- answers pertenecen al formulario,
- preguntas requeridas desde servidor,
- rango de rating,
- opciones validas para select/radio.

### Ajuste recomendado

Antes de agregar N/A, fatal fails o borradores, hay que corregir validacion server-side.

### Cambios aplicables ahora

- Validar form access.
- Validar agent campaign.
- Validar disposition campaign.
- Validar answers contra questions.
- Validar required.
- Validar rating 1-5.
- Validar select/radio contra opciones.

### Cambios objetivo

Evaluacion por categorias:

```text
Datos de evaluacion
Categorias
Preguntas
Resumen sticky
Botones de accion
```

Resumen:

```text
Score actual
Resultado estimado
Pass / Fail
Score por categoria
Fallas fatales
Preguntas completadas
Comentarios requeridos pendientes
```

Estados futuros:

```text
Draft
Submitted
Voided
```

## 6.4 KPIs

### Estado actual

El modulo existe en:

- `src/app/(dashboard)/kpis/page.tsx`
- `src/app/(dashboard)/kpis/kpis-client.tsx`
- `src/server/queries/analytics.ts`

Hoy usa settings globales y metricas disponibles.

### Ajuste recomendado

La propuesta de convertir KPIs en analisis profundo es correcta.

KPIs debe responder:

```text
Por que esta pasando esto?
Donde esta fallando la operacion?
Que campana, agente, categoria o pregunta requiere accion?
```

### Cambios aplicables ahora

- Asegurar filtros por campana en backend.
- Hacer que QA solo vea campanas permitidas.
- Usar targets globales actuales con claridad.
- Mejorar estados: cumple target, bajo target, sin datos.

### Cambios que dependen de schema futuro

- Score por categoria.
- Fallas fatales por categoria.
- Tendencia por categoria.
- Score por pregunta con categoria.
- Cumplimiento por categorias.

### KPIs objetivo

Cards:

```text
Total evaluaciones
Score global
Pass Rate
Tasa diaria
Fallas fatales
Cumplimiento por categorias
```

Bloques:

```text
Alertas
Desempeno por categoria critica
Fallas fatales por categoria
Tendencia por categoria
Score por pregunta
Actividad de evaluadores
Detalle por campana
```

## 6.5 Reports

### Estado actual

El modulo existe en:

- `src/app/(dashboard)/reports/page.tsx`
- `src/app/(dashboard)/reports/reports-client.tsx`
- `src/server/queries/analytics.ts`

Hoy permite filtrar y consultar informacion operativa.

### Ajuste recomendado

Reports debe respetar exactamente el mismo scope que Dashboard y KPIs.

### Cambios necesarios

- Corregir filtros de campana sobrescribibles.
- Agregar permisos para ver reports.
- Preparar campos futuros:
  - version de formulario,
  - categoria QA,
  - pregunta,
  - resultado,
  - fallas fatales,
  - comentarios.

## 6.6 Exportacion

### Estado actual

El modulo existe en:

- `src/app/(dashboard)/analytics/export/page.tsx`
- `src/app/(dashboard)/analytics/export/export-client.tsx`
- `src/server/actions/exports.ts`

Hoy exporta CSV, Excel y JSON.

### Problema actual

Los filtros deben corregirse para que `campaignId` no pueda pisar el scope permitido.

### Ajuste recomendado

Exportar debe seguir esta regla:

```text
Un usuario solo exporta lo que puede ver.
```

### Cambios necesarios

- Permiso `EXPORT_REPORTS`.
- Scope por campana en servidor.
- Auditoria de cada export.
- Campos configurables por fase.

Campos objetivo:

```text
Fecha
Campana
Agente
Evaluador
Formulario
Version
Categoria
Pregunta
Respuesta
Score
Resultado
Disposicion
Comentarios
Fallas fatales
```

## 6.7 Agentes, equipos y disposiciones

### Estado actual

Existen:

- `Agent`
- `Team`
- `Disposition`
- `DispositionCategory`

Existen modulos admin para:

- Usuarios.
- Campanas.
- Agentes.
- Equipos.
- Disposiciones.

### Ajuste recomendado

Estos modulos deben dejar de ser puramente "admin global" y pasar a respetar permisos por campana.

QA Manager:

- administra todo.

QA de campana:

- administra agentes/equipos/disposiciones solo si tiene permiso en esa campana.

Supervisor:

- lectura solamente.

### Cambios necesarios

- Validar entidades por campana en Server Actions.
- Auditar cambios.
- Evitar update/delete por id sin verificar campana.

## 6.8 Usuarios y campanas

### Estado actual

Usuarios y campanas son modulos admin separados:

- `src/app/(dashboard)/admin/users/page.tsx`
- `src/app/(dashboard)/admin/campaigns/page.tsx`

### Ajuste recomendado

No se deben eliminar. Deben convivir con Configuracion.

Propuesta:

- `Admin > Usuarios`: CRUD de usuarios.
- `Admin > Campanas`: CRUD de campanas.
- `Configuracion > Accesos y permisos`: matriz de acceso y permisos por campana.

Esto evita que Configuracion se vuelva un modulo gigante que mezcla CRUD base con gobierno operativo.

## 6.9 Configuracion

### Estado actual

Configuracion existe en:

- `src/app/(dashboard)/settings/page.tsx`
- `src/app/(dashboard)/settings/settings-client.tsx`
- `src/server/actions/settings.ts`
- `src/lib/settings.ts`
- `AppSetting`

Hoy tiene:

- Mi cuenta.
- Cambio de nombre.
- Cambio de contrasena.
- Informacion de rol y campanas asignadas.
- Scoring global basico para admin.

### Ajuste recomendado

La estructura objetivo es correcta, pero debe crecer por fases:

```text
Configuracion
├── Mi cuenta
├── Accesos y permisos
├── Scoring global
├── Scoring por campana
├── Categorias QA
├── Evaluaciones
├── Formularios
├── Dashboard & KPIs
├── Reportes & Exportacion
├── Notificaciones
└── Auditoria operativa
```

### Primer ajuste de UI recomendado

Cambiar tabs horizontales actuales por layout con menu interno lateral:

```text
Configuracion
  Mi cuenta
  Accesos y permisos
  Scoring global
  Scoring por campana
  Auditoria operativa
```

Los demas items se agregan cuando exista backend real.

## 7. Cambios visuales ajustados

### 7.1 Mantener identidad actual

Se mantiene:

- Sidebar navy.
- Primary orange.
- Cards blancas.
- Bordes suaves.
- Montserrat.
- Lucide icons.
- Badges de estado.
- Tablas limpias.
- Recharts para graficas.
- shadcn/ui y Base UI.

### 7.2 Dashboard

Debe ser mas compacto:

- Menos cards altas con pocos datos.
- Top N para graficos largos.
- "Ver todas" para listas completas.
- Alturas independientes para graficos con volumen distinto.
- Resumen de categorias criticas solo cuando existan categorias QA.

### 7.3 Formularios

Debe evolucionar a builder profesional:

- Cards de formularios.
- Tags por categoria.
- Builder por secciones.
- Drawer para agregar pregunta.
- Panel de resumen.
- Validaciones de publicacion.
- Vista previa.
- Versionado.

### 7.4 KPIs

Debe organizarse por analisis:

```text
Resumen general
Alertas
Categorias criticas
Fallas fatales
Score por pregunta
Actividad de evaluadores
Detalle por campana
```

### 7.5 Configuracion

Debe usar layout de administracion operativa:

- Menu lateral interno.
- Contenido denso pero claro.
- Tablas para permisos.
- Sliders/inputs para thresholds.
- Switches para reglas binarias.
- Segmented controls para modos.
- Audit table con filtros.

## 8. Modelo de datos objetivo ajustado

Esta seccion no es una migracion final, sino un modelo conceptual alineado con el proyecto.

### 8.1 Role

Actual:

```text
ADMIN
QA
```

Objetivo:

```text
ADMIN       -> UI label: QA Manager
QA          -> QA de campana
SUPERVISOR  -> lectura por campana
```

### 8.2 Permisos por campana

En vez de muchas columnas booleanas, se recomienda un modelo flexible de permisos:

```text
UserCampaignPermission
userId
campaignId
permission
grantedAt
grantedBy
```

Permisos:

```text
VIEW_DASHBOARD
VIEW_KPIS
VIEW_FORMS
CREATE_FORMS
EDIT_FORMS
PUBLISH_FORMS
EVALUATE_AGENTS
EDIT_EVALUATIONS
VIEW_REPORTS
EXPORT_REPORTS
MANAGE_AGENTS
MANAGE_TEAMS
MANAGE_DISPOSITIONS
MANAGE_CAMPAIGN_SCORING
VIEW_AUDIT
```

### 8.3 Scoring por campana

```text
CampaignSetting
campaignId
useCustomValues
passThreshold
targetScore
targetPassRate
dailyEvaluationTarget
fatalFailuresAllowed
scoringMethod
naHandling
roundingMode
updatedBy
updatedAt
```

### 8.4 Categorias QA

```text
QaCategory
id
name
description
isActive
canBeFatal
requiresCommentOnFail
visibleInDashboard
visibleInKpis
sortOrder
```

Nota: color e icono deben ser del sistema, no editables libremente.

### 8.5 Formularios versionados

```text
Form
id
campaignId
title
description
status
version
createdById
publishedAt
archivedAt
parentFormId
```

### 8.6 Preguntas

```text
Question
id
formId
qaCategoryId
type
label
options
weight
required
fatal
allowNa
requiresCommentOnFail
order
```

### 8.7 Evaluaciones

```text
Response
id
campaignId
formId
formVersion
agentId
evaluatorId
dispositionId
score
passFail
hasFatalFail
status
generalNote
scoreSnapshot
settingsSnapshot
createdAt
submittedAt
updatedAt
voidedAt
voidedBy
voidReason
```

### 8.8 Respuestas

```text
Answer
id
responseId
questionId
qaCategoryId
value
scoreValue
comment
isNa
isFatalFail
```

### 8.9 Auditoria

```text
AuditLog
id
actorId
campaignId
module
action
entityType
entityId
beforeValue
afterValue
impact
metadata
createdAt
```

## 9. Configuracion objetivo ajustada

## 9.1 Mi cuenta

Mantener y ampliar.

Debe mostrar:

```text
Nombre
Email
Rol
Campanas asignadas
Zona horaria
Idioma
Tema
Cambio de contrasena
```

No debe permitir editar permisos.

## 9.2 Accesos y permisos

Debe ser una seccion principal de Configuracion.

Vista principal:

```text
Usuario              Rol          Campanas              Nivel
QA Manager           QA Manager   Todas                 Global
Ana Perez            QA           Customer Service      Admin campana
Luis Gomez           QA           IT Support            Evaluador
Carlos Ruiz          Supervisor   Customer Service      Solo lectura
```

Detalle:

```text
Usuario
Rol base
Campanas asignadas
Permisos por campana
Permisos criticos
Auditoria reciente
```

Solo QA Manager puede:

- crear usuarios,
- asignar campanas,
- otorgar permisos criticos,
- retirar accesos.

## 9.3 Scoring global

Aplica a toda la app como default.

Campos:

```text
Pass Threshold global
Target Score global
Target Pass Rate global
Target evaluaciones diarias global
Metodo de calculo global
Manejo de N/A
Reglas fatales globales
Redondeo del score
```

Nota obligatoria:

```text
Estos valores aplican como default.
Las campanas pueden tener configuracion propia.
No recalcula evaluaciones anteriores.
```

## 9.4 Scoring por campana

Debe permitir override por campana.

Campos:

```text
Campana
Usa valores personalizados
Pass Threshold
Target Score
Target Pass Rate
Evaluaciones diarias objetivo
Fallas fatales permitidas
```

Se habilita para:

- QA Manager.
- QA de campana con permiso `MANAGE_CAMPAIGN_SCORING`.

## 9.5 Categorias QA

Controladas por QA Manager.

Categorias base:

```text
Customer Critical
Business Critical
Compliance Critical
Contact Resolution
Soft Skills
Process Adherence
Documentation Quality
```

Campos:

```text
Nombre
Descripcion
Estado
Uso en formularios
Permite fatal
Comentario obligatorio
Visible en Dashboard
Visible en KPIs
Orden
```

Regla:

- Desactivar en vez de eliminar cuando haya historial.

## 9.6 Evaluaciones

Debe definir reglas globales y por campana.

Reglas:

```text
Campos obligatorios
Bloquear envio incompleto
Mostrar resumen antes de enviar
Permitir borrador
Auto-guardar
Comentarios obligatorios
Edicion posterior
Requiere disposicion
Requiere nota si Fail
```

## 9.7 Formularios en Configuracion

No reemplaza el modulo Formularios.

Solo controla:

```text
Estado inicial
Versionado
Publicacion
Tipos de pregunta permitidos
Escala rating default
Reglas de validacion
Permisos por campana
```

## 9.8 Dashboard y KPIs

Controla visibilidad, no seguridad.

La seguridad sigue en backend.

Configurable:

```text
Widgets visibles por rol
Comparativos permitidos
Vista global permitida
Vista por campana
Coaching list
Top / Bottom
```

## 9.9 Reportes y Exportacion

Regla:

```text
Un usuario solo exporta lo que puede ver.
```

Debe incluir:

- permiso por rol/campana,
- campos exportables,
- privacidad,
- auditoria.

## 9.10 Notificaciones

Fase posterior.

Alertas recomendadas:

```text
Customer Critical fallido
Compliance Critical fallido
Agente debajo del threshold
Campana debajo del target
QA debajo de meta diaria
Formulario sin evaluaciones recientes
Evaluacion fallida enviada
Categoria critica en riesgo
```

Canal inicial recomendado:

- In-app.

Email puede quedar para despues.

## 9.11 Auditoria operativa

Debe mostrar eventos operativos, no tecnicos.

Eventos:

```text
Usuario creado
Permiso asignado
Acceso a campana modificado
Formulario creado
Formulario publicado
Formulario editado
Evaluacion creada
Evaluacion editada
Evaluacion anulada
Scoring global modificado
Scoring de campana modificado
Categoria QA modificada
Exportacion realizada
Dashboard/KPI config modificada
```

No mostrar:

```text
Estado DB
Backups
Deploys
Jobs tecnicos
Logs servidor
Errores internos
Version tecnica
```

## 10. Matriz de permisos ajustada

| Accion                         | QA Manager | QA campana                 | Supervisor              |
| ------------------------------ | ---------- | -------------------------- | ----------------------- |
| Ver todas las campanas         | Si         | Solo si se delega          | No                      |
| Ver campana asignada           | Si         | Si                         | Si                      |
| Crear usuarios                 | Si         | No                         | No                      |
| Asignar campanas               | Si         | No                         | No                      |
| Delegar permisos criticos      | Si         | No                         | No                      |
| Crear formularios              | Si         | Si, en su campana          | No                      |
| Editar formularios             | Si         | Si, en su campana          | No                      |
| Publicar formularios           | Si         | Segun permiso              | No                      |
| Evaluar agentes                | Si         | Si, en su campana          | No                      |
| Editar evaluaciones            | Si         | Segun permiso              | No                      |
| Ver Dashboard                  | Si         | Solo campana asignada      | Solo lectura            |
| Ver KPIs                       | Si         | Solo campana asignada      | Solo lectura            |
| Exportar reportes              | Si         | Segun permiso              | Segun permiso especial  |
| Configurar scoring global      | Si         | No                         | No                      |
| Configurar scoring por campana | Si         | Segun permiso              | No                      |
| Ver auditoria operativa        | Si         | Solo su campana si permiso | No o limitado           |
| Cambiar logo/colores           | No         | No                         | No                      |
| Ver estado tecnico             | No         | No                         | No                      |

## 11. Fases de implementacion ajustadas

## Fase 1 - Seguridad y base operativa

Objetivo:

```text
Cerrar riesgos antes de agregar nuevas capacidades.
```

Incluye:

- Aislamiento por campana en backend.
- Helpers centralizados de permisos.
- Correccion de Server Actions.
- Correccion de exports.
- Cookies seguras.
- App solo detras de Apache.
- Secretos fuera del repo.
- Tooling local funcional.

Resultado:

- QA no puede ver o mutar campanas ajenas.
- Exports no fugan datos.
- El proyecto puede compilar/verificarse con mas confianza.

## Fase 2 - Permisos y auditoria

Incluye:

- Rol Supervisor en schema.
- Modelo de permisos por campana.
- Matriz de Accesos y permisos.
- AuditLog.
- Auditoria basica visible en Configuracion.

Resultado:

- QA Manager puede gobernar acceso real por campana.
- Cambios sensibles quedan registrados.

## Fase 3 - Scoring global y por campana

Incluye:

- CampaignSetting.
- Overrides por campana.
- Settings efectivos por campana.
- Dashboard, KPIs y Reports consumen settings efectivos.

Resultado:

- Cada campana puede tener targets propios sin romper defaults globales.

## Fase 4 - Categorias QA y formularios estructurados

Incluye:

- QaCategory.
- Preguntas con categoria.
- Pesos.
- Builder por categorias.
- Validaciones de publicacion.
- Estados de formulario.

Resultado:

- Formularios dejan de ser listas planas y pasan a estructura QA real.

## Fase 5 - Versionado y evaluaciones avanzadas

Incluye:

- Versionado de formularios publicados.
- Response snapshots.
- N/A.
- Fatal fail.
- Comentarios obligatorios.
- Borradores.
- Edicion controlada.

Resultado:

- Evaluaciones historicas son confiables y trazables.

## Fase 6 - Dashboard y KPIs avanzados

Incluye:

- Categorias criticas en Dashboard.
- Fallas fatales.
- Score por categoria.
- Score por pregunta.
- Bottom coaching accionable.
- Detalle por agente enriquecido.

Resultado:

- Dashboard responde "como vamos".
- KPIs responde "por que vamos asi".

## Fase 7 - Reports, exportacion y notificaciones

Incluye:

- Exportaciones auditadas.
- Campos configurables.
- Privacidad de datos.
- Notificaciones in-app.
- Alertas por categoria critica.

Resultado:

- Reports y alertas se vuelven herramientas de gestion operativa.

## 12. Criterios de aceptacion por area

### Seguridad

```text
QA no ve campanas no asignadas.
Supervisor no modifica datos.
Solo QA Manager crea usuarios.
Solo QA Manager delega permisos criticos.
Toda accion sensible valida permisos en servidor.
```

### Dashboard

```text
Carga datos segun campanas permitidas.
Top performers respeta permisos.
Bottom coaching muestra razon accionable.
Graficos largos usan Top N.
Graficos con pocos datos no dejan cards vacias gigantes.
```

### Formularios

```text
Toda pregunta pertenece a una categoria.
Pesos validan 100%.
Formulario invalido no se publica.
Editar publicado crea nueva version.
Historial conserva version original.
```

### Evaluaciones

```text
Agente, formulario y disposicion pertenecen a la misma campana.
Answers pertenecen al formulario.
Required se valida en servidor.
Score se calcula con settings efectivos.
Cambios quedan auditados.
```

### KPIs

```text
Datos respetan permisos.
Score por categoria funciona.
Score por pregunta identifica debilidades.
Fallas fatales se cuentan por categoria.
Detalle por campana respeta scope.
```

### Configuracion

```text
No incluye branding.
No incluye servidores.
No incluye base de datos.
QA Manager configura global y campanas.
QA campana solo configura su campana si tiene permiso.
Auditoria muestra eventos operativos.
```

## 13. Diferencias principales contra la propuesta original

1. `ADMIN` se mantiene inicialmente en base de datos, pero se presenta como QA Manager en UI.
2. Supervisor se agrega despues de RBAC, no antes.
3. Permisos se modelan como permisos granulares, no solo como columnas booleanas fijas.
4. Categorias QA no son las mismas que categorias de disposicion.
5. Dashboard puede mejorar visualmente ahora, pero categorias criticas esperan schema nuevo.
6. Formularios por categorias requieren migracion importante y versionado.
7. Evaluaciones avanzadas requieren validacion server-side primero.
8. Notificaciones quedan para fase posterior.
9. Configuracion no reemplaza Admin Usuarios/Campanas; lo complementa.
10. Auditoria se implementa antes de cambios sensibles avanzados.

## 14. Conclusion

La propuesta es altamente util para Qore, pero debe implementarse como evolucion por capas.

El camino correcto es:

```text
Primero seguridad y permisos.
Luego auditoria.
Luego scoring por campana.
Luego categorias QA.
Luego formularios y evaluaciones avanzadas.
Luego Dashboard, KPIs, Reports y notificaciones enriquecidas.
```

La regla central debe mantenerse durante todo el proyecto:

```text
QA Manager gobierna toda la operacion.
QA opera solo en sus campanas asignadas.
Supervisor observa sin modificar.
El backend aplica la seguridad siempre.
```

Con este ajuste, Qore puede crecer de forma seria sin convertirse en un panel generico ni poner en riesgo datos entre campanas.
