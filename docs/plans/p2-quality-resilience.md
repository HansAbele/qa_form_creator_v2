# P2 - Calidad, resiliencia y escala

Last updated: 2026-07-16

## Estado

La primera entrega critica de P2 esta implementada y validada en la rama
`codex/p2-quality-resilience`. Esta entrega cierra inconsistencias de resultados,
concurrencia entre sesiones, recuperacion de borradores, permisos visibles en UI y
boundaries de error/carga.

P2 completo aun requiere una segunda entrega de semantica temporal y escala, y una
tercera entrega de pruebas de navegador/accesibilidad. No se debe declarar P2 cerrado
hasta cumplir la definicion de terminado de este documento.

## Objetivo

Convertir los controles de seguridad y scoring cerrados en P1 en un flujo operativo
confiable para QA y QA Manager:

- Un QA solo descubre y ejecuta acciones permitidas en sus campanas.
- Un QA Manager puede administrar, corregir, auditar y exportar donde corresponda.
- Dos sesiones no pueden sobrescribir silenciosamente la misma evaluacion.
- Un retry de red no duplica un borrador nuevo.
- Dashboard, reportes y exports interpretan PASS/FAIL/fatal de la misma manera.
- Los fallos y transiciones de pagina no dejan al usuario sin feedback ni descartan
  cambios silenciosamente.

## Entrega P2.1 implementada

### 1. Verdad unica de resultados

- Analytics de agentes, equipos y disposiciones respetan `result` y
  `hasFatalFail`.
- Una falla fatal prevalece sobre un `result=PASS` historico inconsistente.
- El umbral efectivo se resuelve por campana donde corresponde.
- Los filtros `PASS`/`FAIL`, listados, drill-downs y tarjetas recientes usan el mismo
  resultado efectivo, incluso para valores historicos nulos o no estandar.
- El score se canoniza a dos decimales antes de derivar el resultado, persistirlo y
  mostrarlo; no puede aparecer un `70.00% FAIL` por diferencias de redondeo.
- CSV, Excel y resumen exportado usan la misma regla.
- Las consultas de respuestas aprobadas excluyen explicitamente fallas fatales.

### 2. Concurrencia e idempotencia de evaluaciones

- Editar, enviar y anular exige `expectedUpdatedAt`, obtenido de la version que vio el
  cliente.
- El `UPDATE` compara atomicamente `id + status + updatedAt`; una version obsoleta falla
  con un mensaje para recargar y no genera audit log ni notificacion falsa.
- Cada evaluacion nueva recibe un `clientResponseId` UUID estable. Se usa como
  `Response.id`, por lo que CUID historicos y UUID nuevos pueden coexistir sin migracion.
- Un retry despues de un commit cuya respuesta se perdio recupera el mismo registro en
  lugar de crear un duplicado.
- El replay solo acepta la misma identidad estable de evaluador/formulario; despues el
  cliente confirma el payload actual mediante un update versionado.
- El autosave serializa requests, conserva el ID/version devueltos y hace flush antes
  del submit.

### 3. Proteccion contra perdida de cambios

- El estado visual distingue guardando, guardado, pendiente y error.
- El submit suspende autosave y bloquea todos los controles de la evaluacion.
- Clics en enlaces, notificaciones, cierre de sesion y Back/Forward consultan un guard
  comun si existen cambios pendientes.
- `beforeunload` mantiene cobertura para recarga, cierre de pestana y navegacion fuera
  del documento.
- Next actualiza `responseId` con History API sin provocar un remount prematuro.

### 4. Permisos y descubrimiento de borradores

| Capacidad | QA | QA Manager / ADMIN |
| --- | --- | --- |
| Ver borradores propios | Solo campanas con `canEvaluate` | Si |
| Ver borradores ajenos | Solo campanas con `canEditEvaluations` | Si |
| Crear disposiciones desde una evaluacion | Solo con `canManageDispositions` | Si |
| Exportar | Solo con `canExport` | Si |
| Corregir/anular evaluaciones | Solo con `canEditEvaluations` | Si |

- Supervisor no descubre borradores de evaluacion.
- La lista se limita a 50 registros recientes y solo ofrece formularios publicados,
  campanas activas y agentes activos.
- Registros importados/corruptos donde agente y formulario pertenecen a campanas
  distintas se descartan antes de exponer metadata.
- Analytics, reportes, exports, selectores y lectores operativos validan tambien
  disposicion, categoria de disposicion, equipo y pregunta contra la campana/formulario
  propietario.
- Los conteos visibles de agentes, equipos, disposiciones y categorias excluyen hijos
  importados que pertenecen a otra campana.
- La UI separa `Mis borradores` de `Borradores administrables`.

### 5. Estado de formularios de QA Manager

- Formularios de usuario, campana, agente, equipo y disposicion se reinicializan al
  abrir/cambiar entidad, sin borrar el draft local por un rerender normal.
- La tabla de equipos usa encabezados y `colSpan` coherentes.
- El selector de disposiciones ignora respuestas asincronas de una campana anterior.

### 6. Resiliencia de Next.js

- Boundaries de carga y error para rutas de dashboard y raiz.
- `global-error.tsx` autocontenido para errores del Root Layout/Providers.
- Pagina `not-found` accesible.
- Reintento compatible con Next.js 16.2 mediante `unstable_retry`.

### 7. Correcciones historicas y exports auditables

- Una correccion autorizada puede conservar formulario archivado, agente inactivo o
  disposicion inactiva solo cuando esas relaciones no se cambian. Una evaluacion legacy
  sin disposicion tambien puede conservar ese estado durante la correccion.
- La politica de scoring capturada por la evaluacion se comparte entre UI y servidor;
  las correcciones preservan snapshots y registran los cambios auditables. Si un registro
  legacy no tiene `settingsSnapshot`, se materializan los valores efectivos, no los
  defaults actuales que podrian cambiar una correccion posterior.
- Las notificaciones de envio se emiten por transicion real, no por cada guardado de una
  evaluacion ya enviada.
- CSV, XLSX y JSON registran auditoria/notificacion de exito despues de construir el
  artefacto. Un fallo de serializacion no deja un exito falso.

## Validacion de P2.1

Comandos ejecutados desde la raiz del proyecto:

```powershell
pnpm typecheck
pnpm lint
pnpm test:ci
pnpm build
git diff --check
```

Resultado del 2026-07-16:

- TypeScript: aprobado.
- Biome: 219 archivos aprobados.
- Vitest: 28 archivos y 224 pruebas aprobadas.
- Next.js 16.2.10 production build: aprobado; 24 entradas de pagina procesadas.
- Whitespace/diff check: aprobado.

## Pendiente P2.2 - Semantica temporal y escala

Prioridad alta:

1. Definir formalmente la zona horaria operativa por campana o por instalacion.
2. Mantener `Todo el periodo` cuando no hay filtro, pero calcular `dailyRate` con el
   rango real de datos; hoy el denominador por defecto puede ser 30 aunque el numerador
   sea historico completo.
3. Sustituir limites `23:59:59` por intervalos semiabiertos `[inicio, siguiente dia)`
   para no excluir milisegundos del ultimo segundo.
4. Paginar Reports y cargar detalle de respuestas bajo demanda.
5. Establecer maximos de export; para volumen alto usar streaming o job asincrono en
   lugar de `writeBuffer + base64` en memoria.
6. Mover agregaciones grandes de Dashboard/KPIs a SQL y eliminar N+1 por campana.
7. Medir con datos representativos y `EXPLAIN (ANALYZE, BUFFERS)` antes de crear indices
   compuestos o migraciones.
8. Cambiar las columnas dinamicas de respuestas en CSV/XLSX para usar una clave estable
   (ID de pregunta + seccion/orden). Hoy dos preguntas con la misma etiqueta pueden
   colisionar en el formato ancho y conservar solo uno de los valores.

## Pendiente P2.3 - Pruebas de experiencia y operacion

1. E2E autenticado para QA, QA con permisos elevados, QA Manager y Supervisor.
2. Prueba con PostgreSQL real de dos clientes actualizando el mismo borrador.
3. Pruebas de navegador para autosave, retry ambiguo, Back/Forward y navegacion desde
   notificaciones.
4. Auditoria responsive de formularios, tablas y dashboard en movil/tablet.
5. Auditoria WCAG de foco, teclado, anuncios `aria-live`, contraste y graficas.
6. Integrar observabilidad de errores con un destino operativo; hoy los boundaries
   registran en consola y muestran `digest`.
7. Diferenciar estados vacios de errores/not-found en vistas analiticas.
8. Evaluar una respuesta uniforme para IDs de evaluacion inexistentes y no autorizados;
   hoy ambos estan protegidos, pero sus mensajes siguen siendo distinguibles.

## Definicion de terminado de P2

P2 se puede cerrar cuando:

- P2.1, P2.2 y P2.3 estan integrados y revisados.
- No existen hallazgos abiertos de severidad alta en RBAC, perdida de datos, scoring o
  aislamiento por campana.
- La matriz E2E de roles pasa contra PostgreSQL.
- Reports, Dashboard y exports cumplen limites de volumen documentados.
- Typecheck, lint, unit/integration tests y build de produccion pasan en CI.

## Exclusiones deliberadas

- No se publica ni versiona `scripts/__pycache__`.
- No se agregaron indices sin evidencia de un plan de ejecucion real.
- No se cambio la semantica visible `Todo el periodo` sin una decision de producto sobre
  zona horaria y denominadores.
