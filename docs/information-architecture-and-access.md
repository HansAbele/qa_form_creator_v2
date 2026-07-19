# Arquitectura de información y acceso

Última actualización: 2026-07-17

## Objetivo

Qore separa el trabajo diario, la analítica, la operación y la administración sin depender únicamente del rol mostrado en la interfaz. La visibilidad del menú orienta al usuario, pero toda lectura o mutación sensible se vuelve a autorizar en el servidor y por campaña.

```mermaid
flowchart LR
  QA["QA"] -->|"actividad propia y campañas con canViewEvaluations"| EV["Evaluaciones"]
  QM["QA Manager"] -->|"campañas con canViewEvaluations"| EV
  EV --> DT["Detalle canónico"]
  QA -->|"campañas asignadas"| AN["KPIs y rendimiento"]
  QM --> AN
  QM --> RP["Reportes agregados"]
  RP --> EV
  QM -->|"canViewReports + canExport"| EX["Exportar"]
```

## Navegación canónica

| Grupo | Módulo | Ruta | Regla de visibilidad |
|---|---|---|---|
| Principal | Dashboard | `/` | `canViewDashboard` |
| Principal | Formularios | `/forms` | `canViewForms` |
| Principal | Evaluaciones | `/evaluations` | `canViewDashboard`, `canViewEvaluations` o `canViewReports` |
| Principal | Reportes | `/reports` | `canViewReports` |
| Analítica | KPIs | `/kpis` | `canViewKPIs` |
| Analítica | Rendimiento de agentes | `/analytics/agents` | `canViewKPIs` |
| Analítica | Rendimiento por equipos | `/analytics/teams` | `canViewKPIs` |
| Analítica | Resultados por disposición | `/analytics/dispositions` | `canViewKPIs` |
| Operación | Agentes | `/operations/agents` | `canManageAgents` |
| Operación | Equipos | `/operations/teams` | `canManageAgents` |
| Operación | Disposiciones | `/operations/dispositions` | `canManageDispositions` |
| Administración | Usuarios | `/admin/users` | `ADMIN` |
| Administración | Campañas | `/admin/campaigns` | `ADMIN` |
| Configuración | Configuración de calidad | `/settings` | usuario activo |

`Exportar` es una acción dentro de Reportes y no ocupa un enlace permanente en el sidebar.

## Contrato de Evaluaciones

`/evaluations` es la ubicación canónica para consultar evaluaciones enviadas y abrir su detalle.

### Vista «Mis evaluaciones»

- Requiere `canViewDashboard` en la campaña.
- El servidor agrega obligatoriamente `evaluatorId = session.user.id`.
- El cliente no puede solicitar el historial de otro evaluador.
- El periodo se calcula con `submittedAt`, que representa cuándo la evaluación pasó a formar parte del historial oficial.

### Vista «Equipo y campañas»

- Requiere `canViewEvaluations` en cada campaña solicitada.
- Permite ver evaluaciones de los evaluadores dentro de ese alcance.
- No combina permisos de campañas distintas.

### Detalle

Una evaluación enviada puede abrirse si se cumple al menos una de estas condiciones:

1. Es del evaluador autenticado y pertenece a una campaña donde puede ver su trabajo.
2. Pertenece a una campaña donde tiene `canViewEvaluations`.
3. Pertenece a una campaña donde tiene `canViewReports`.
4. Es un borrador dentro de una campaña donde tiene `canEditEvaluations`.
5. Está cancelada y pertenece a una campaña donde tiene `canViewAudit`.

Después de autorizar, la consulta valida también la integridad entre formulario, agente, equipo, disposición, categoría y campaña.

## Seguimiento mensual y coaching

Evaluaciones permite revisar el trabajo por `Este mes`, `Mes anterior`, rangos rápidos o un periodo personalizado. Los filtros de agente, formulario, disposición, resultado, score y fatalidad están disponibles en ambas vistas; el filtro de evaluador solo aparece en la vista administrada.

Al seleccionar un agente y un mes, el resumen muestra:

- cantidad de llamadas evaluadas;
- promedio general del agente;
- pass rate del periodo;
- score y resultado de cada evaluación individual.

Las opciones de los filtros no se obtienen de catálogos globales: se derivan únicamente de evaluaciones enviadas que el usuario ya está autorizado a consultar. Así, un QA no descubre nombres o actividad fuera de sus campañas y un QA Manager solo ve las campañas que administra.

Dashboard, KPIs, Reportes, Evaluaciones y Exportar usan `submittedAt` como fecha oficial. Una llamada pertenece al periodo en que la evaluación fue enviada, no al día en que se creó su borrador. La base de datos repara registros históricos enviados sin esa fecha y aplica una restricción que impide crear nuevos estados `SUBMITTED` sin timestamp de envío.

## Alcance operativo del QA

El perfil QA dispone de las herramientas necesarias para su trabajo diario, siempre limitadas a las campañas que tenga asignadas:

- consulta de agentes, equipos y disposiciones mediante sus vistas analíticas;
- KPIs y rendimiento de agentes, equipos y disposiciones;
- historial mensual propio y del resto de evaluaciones de sus campañas;
- apertura del detalle completo para coaching: score, resultado, comentarios, respuestas y fallas fatales;
- creación y edición de sus propios formularios.

Un QA no obtiene administración global, gestión de usuarios o campañas, exportación, auditoría ni publicación de formularios por defecto. El QA Manager conserva esos controles y puede delegar permisos específicos por campaña sin romper el aislamiento de datos.

En este modelo, «sus agentes» significa los agentes pertenecientes a cualquiera de las campañas asignadas al QA. Una relación más estrecha QA-agente requeriría un modelo explícito de asignación adicional.

## Ciclo de formularios

La interfaz presenta un único formulario lógico y ya no expone números de versión. El comportamiento interno conserva definiciones inmutables porque una evaluación histórica debe seguir apuntando exactamente a las preguntas y pesos con los que fue calificada.

- Un QA solo puede editar, eliminar o, si se le delega el permiso, publicar formularios creados por él.
- Los formularios publicados de la campaña pueden utilizarse para evaluar, independientemente de su autor.
- Editar un formulario publicado crea cambios pendientes y mantiene intacta la definición histórica.
- Solo puede existir un borrador pendiente por familia de formulario; la base de datos hace cumplir esta regla.
- El QA Manager puede gestionar formularios de cualquier autor dentro de su alcance administrativo.

## Reportes y exportaciones

Reportes conserva indicadores, filtros y una muestra paginada para análisis. El detalle completo se abre en `/evaluations/[responseId]`; no existe una segunda ficha con reglas diferentes.

Una exportación requiere simultáneamente:

```text
canViewReports = true
canExport      = true
misma campaña
```

Esto impide que una asignación con `canViewReports` en una campaña y `canExport` en otra se combine como si fuera autorización válida.

## Trazabilidad sin notificaciones

Qore no incluye un centro de notificaciones in-app ni preferencias asociadas. Los eventos relevantes —envío o anulación de evaluaciones, generación de exports y cambios administrativos— conservan su trazabilidad durable en `AuditLog`, respetando el alcance por campaña. La migración `20260717201000_remove_notifications` elimina las tablas retiradas y sus datos históricos.

## Compatibilidad de enlaces

Los enlaces antiguos permanecen como redirecciones para no romper marcadores o enlaces históricos:

- `/analytics/responses` → `/evaluations`
- `/analytics/responses/[responseId]` → `/evaluations/[responseId]`

Las acciones internas generan enlaces canónicos.

## Menú de usuario

El header usa un único menú accesible con:

- identidad, correo y rol;
- acceso a Mi perfil;
- tema Claro, Oscuro o Sistema;
- Cerrar sesión como última acción;
- protección contra pérdida de cambios antes de navegar o cerrar sesión.

No se muestra un selector de idioma hasta que exista internacionalización real y persistencia de preferencias.

## Trabajo posterior deliberadamente separado

Estos cambios requieren su propio ciclo de diseño, migración y pruebas; no deben resolverse ocultando enlaces antes de alcanzar paridad funcional:

1. Unificar Usuarios y permisos por campaña en una sola experiencia administrativa.
2. Retirar las rutas administrativas antiguas de agentes, equipos y disposiciones después de confirmar paridad con Operación.
3. Reducir Configuración a controles realmente modificables y separar las reglas informativas.
4. Completar la presentación de zona horaria en todas las vistas operativas.
5. Añadir metas configurables de muestra por agente y alertas de cobertura mensual.
6. Incorporar un identificador de interacción o llamada, fecha de contacto y referencia de grabación para trazabilidad más allá de `Response.id`.

## Historial y reversión segura

El estado previo a esta reorganización está preservado en:

```text
commit: 9612983
tag:    checkpoint-before-navigation-20260717
```

Para inspeccionarlo sin alterar el trabajo actual:

```powershell
git show checkpoint-before-navigation-20260717
```

Para probar el estado anterior en otra rama, sin borrar la implementación vigente:

```powershell
git switch -c codex/rollback-navigation checkpoint-before-navigation-20260717
```
