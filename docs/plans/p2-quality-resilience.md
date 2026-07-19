# P2 - Calidad, resiliencia y escala

Last updated: 2026-07-16

## Estado

P2.1, P2.2 y P2.3 estan implementados. El alcance cubre consistencia de resultados,
concurrencia entre sesiones, recuperacion de borradores, permisos visibles en UI,
semantica temporal, volumen, observabilidad y pruebas de experiencia.

La publicacion sigue sujeta a los gates de la seccion `Definicion de terminado de P2`.
La evidencia aprobada se registra en este documento; no se considera aprobado un gate
por el solo hecho de existir una prueba o un script.

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
  con un mensaje para recargar y no genera un audit log falso.
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
- Clics en enlaces, cierre de sesion y Back/Forward consultan un guard
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
- Los envios, correcciones y anulaciones conservan trazabilidad durable mediante
  auditoria, sin depender de efectos secundarios de interfaz.
- CSV, XLSX y JSON registran la auditoria de exito despues de construir el artefacto.
  Un fallo de serializacion no deja un exito falso.

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

## Entrega P2.2 implementada - Semantica temporal y escala

### 1. Calendario operacional y DST

- `OPERATIONAL_TIME_ZONE` define una zona IANA por instalacion. Desarrollo usa `UTC`
  por defecto; Compose y el preflight exigen y validan el valor en produccion.
- Los filtros `YYYY-MM-DD` se convierten al primer instante real del dia operacional y
  al primer instante del dia siguiente. Todas las consultas usan el intervalo
  semiabierto `[gte, lt)`, sin limites artificiales `23:59:59`.
- El calculo de inicio de dia resuelve el offset real de la zona, por lo que los dias de
  cambio DST de 23 o 25 horas no se tratan como periodos fijos de 24 horas.
- Agrupaciones, etiquetas de fecha y atajos de calendario comparten la misma zona. El
  atajo de siete dias incluye exactamente siete fechas operacionales.
- `Todo el periodo` conserva todos los datos, pero `dailyRate` usa la primera y ultima
  fecha reales del conjunto filtrado en lugar de un denominador fijo de 30 dias.

### 2. Reports, Dashboard y KPIs

- Reports filtra y resume el conjunto completo en servidor; entrega 50 filas por pagina
  por defecto, admite como maximo 100 y carga el detalle de una evaluacion solo cuando
  el usuario lo solicita.
- Los IDs de pagina usan orden estable y el resumen no se calcula a partir de la pagina
  visible.
- Las agregaciones por campana de Dashboard/KPIs se ejecutan en SQL parametrizado y la
  configuracion de targets se obtiene en lote, eliminando el N+1 por campana.
- Dashboard Manager y KPI consumen un bundle por vista y reutilizan los resultados
  compartidos dentro de la misma solicitud.

### 3. Exportaciones acotadas con serializacion por stream

Los limites por defecto son:

| Variable | Limite por defecto | Maximo aceptado por configuracion |
| --- | ---: | ---: |
| `EXPORT_MAX_EVALUATIONS` | 1,000 evaluaciones | 2,500 |
| `EXPORT_MAX_ANSWER_ROWS` | 10,000 respuestas | 25,000 |
| `EXPORT_MAX_QUESTION_COLUMNS` | 100 columnas | 200 |
| `EXPORT_MAX_CELLS` | 100,000 celdas estimadas | 250,000 |
| `EXPORT_MAX_TEXT_BYTES` | 8,000,000 bytes UTF-8 | 16,000,000 |
| `EXPORT_MAX_REQUESTS_PER_MINUTE` | 4 reservas por usuario | 60 |
| `EXPORT_MAX_CONCURRENT_PER_USER` | 1 export activo por usuario | 2 |
| `EXPORT_MAX_CONCURRENT_GLOBAL` | 2 exports activos en total | 4 |
| `EXPORT_LEASE_TIMEOUT_SECONDS` | 900 segundos | 3,600 |

- Todas las replicas reciben los nueve valores en el mismo despliegue; mezclar limites
  durante un rollout vuelve la decision dependiente de la replica que obtiene el lock.
- La aplicacion cuenta en PostgreSQL las filas de respuesta y todos los textos
  hidratables antes de cargarlos; IDs, presupuesto e hidratacion comparten un snapshot
  `REPEATABLE READ`, y el total se revalida despues de la hidratacion. Rechaza el trabajo
  antes de serializar cuando supera un limite. La estimacion XLSX contabiliza las 21
  celdas reales de cada fila de detalle.
- La seleccion inicial de IDs tiene orden estable y la hidratacion se procesa en lotes
  de 300. Si no se selecciona `Respuestas`, no se cargan respuestas individuales.
- CSV y JSON usan Web Streams. XLSX usa `ExcelJS.stream.xlsx.WorkbookWriter` sobre un
  stream, evitando `writeBuffer + base64` en la ruta usada por la UI.
- El flujo no es streaming de extremo a extremo: el servidor conserva
  `snapshotResponses` hidratado antes de serializar y el cliente actual materializa la
  respuesta con `response.blob()`. Los limites conservadores y la concurrencia global
  son el borde de memoria vigente. Volumenes mayores requieren un job asincrono futuro
  que lea por cursor hacia almacenamiento durable; no se resuelven elevando los hard
  caps.
- Las columnas dinamicas usan una clave estable compuesta por ID de pregunta,
  seccion/categoria y orden. JSON y el detalle XLSX incluyen esa trazabilidad.
- El endpoint de descarga requiere sesion y mismo origen, limita el request, aplica el
  mismo RBAC `canExport` y devuelve errores explicitos para limite o conjunto vacio.
- El CSV neutraliza valores que una hoja de calculo podria interpretar como formulas.
- La admision toma siempre el advisory lock global antes del lock por usuario y cuenta
  reservas activas append-only en `AuditLog`. Los limites global y por usuario se
  respetan entre replicas sin invertir el orden de locks. Una denegacion deja evidencia
  `rejected`, limitada a una fila por usuario/minuto, antes de devolver el error. El
  ciclo admitido registra `reserved`, `started` por campana y un terminal `generated`,
  `cancelled`, `failed` o `rejected`.
  En streams, `generated` solo se registra cuando el consumidor observa EOF.
- La migracion `20260716180000_add_export_admission_audit_index` extiende el indice de
  auditoria con `entityType` y `createdAt`, manteniendo acotado el scan de la ventana de
  lease que usa la admision global.

### 4. Benchmark PostgreSQL 16

`pnpm benchmark:analytics` crea en una base efimera local 10 campanas, 50,000
evaluaciones y 50,000 respuestas, ejecuta `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` y
limpia sus fixtures. El script se bloquea contra hosts remotos o bases que no esten
marcadas para benchmark/CI.

Medicion registrada el 2026-07-16:

| Consulta | Tiempo de ejecucion | Shared hit blocks | Presupuesto |
| --- | ---: | ---: | ---: |
| Agregacion autorizada por campana | 411.172 ms | 1,027 | 1,500 ms |
| Primera pagina estable de 50 IDs | 425.299 ms | 1,027 | 1,000 ms |
| Bundle Dashboard/KPI/QA (13 consultas) | 11,308.147 ms | Perfil compuesto | 12,000 ms |
| Consulta individual mas lenta (`qaCategoryMetrics`) | 1,952.545 ms | 251,028 | 2,000 ms |

Todas las consultas registraron cero bloques leidos de disco durante la medicion y
quedaron dentro de su presupuesto. El bundle incluye las vistas de QA Manager y los
cuatro agregados autocontenidos de `Mi trabajo` para QA. No se agrego un indice
compuesto: la medicion no justifico una migracion adicional.

## Entrega P2.3 implementada - Experiencia y operacion

### 1. Matriz E2E de roles y flujos criticos

- El seed E2E crea dos campanas aisladas y credenciales separadas para QA Manager
  (`ADMIN`), QA estandar, QA con permisos elevados y Supervisor.
- La matriz comprueba controles visibles y URLs directas: la capacidad de evaluacion
  del QA estandar permanece acotada a su campana; QA elevado recibe controles delegados
  de campana sin administracion global;
  Supervisor permanece en lectura y con alcance de su campana; QA Manager conserva el
  control global.
- Las pruebas cubren autosave tras una falla de red, recuperacion del borrador despues
  de recarga, guard de cambios sin guardar y aislamiento de auditoria.
- Playwright incluye Desktop Chrome y un proyecto Pixel 7 para navegacion responsive,
  teclado, etiquetas y ausencia de overflow horizontal.
- La matriz de navegador valida los flujos criticos de roles y evaluaciones en Desktop
  Chrome/Pixel 7 sin fixtures de estado global en el header.

### 2. Concurrencia real

- La prueba `test:integration:response-concurrency` usa PostgreSQL 16 y la Server Action
  real de envio. Dos escrituras parten de la misma version y se mantienen simultaneas
  sobre el lock de fila.
- El resultado esperado y observado es un commit y un `CONFLICT`: queda una sola
  evaluacion enviada, con respuestas/score/version coherentes con el ganador y un solo
  snapshot de auditoria.
- La ejecucion registrada en PostgreSQL 16.14 paso 1 de 1 prueba en 1.18 s y limpio los
  fixtures de respuesta y auditoria.
- La integracion `test:integration:export-admission` cubre concurrencia del mismo
  usuario y de usuarios distintos con el rol runtime restringido. Paso 2 de 2: el
  limite por usuario y el limite global aceptan exactamente el cupo disponible,
  rechazan el competidor esperado y dejan auditoria durable sin fixtures residuales.
- `test:integration:export-download` ejecuta la Server Action real, consume un CSV con
  respuestas hasta EOF y verifica RBAC, `reserved -> started -> generated`, metadata,
  auditoria y cleanup. Paso 1 de 1 contra PostgreSQL 16.14.

### 3. Accesibilidad, responsive y estados

- Los formularios asocian etiquetas, descripciones y errores con sus controles; al
  validar, el foco se mueve al primer campo invalido.
- Las escalas de rating implementan `radiogroup`, foco roving y teclas de direccion,
  `Home` y `End`. Los estados asincronos usan anuncios accesibles.
- Las graficas tienen nombre accesible y resumen textual de datos; sparklines
  decorativos no duplican contenido para lectores de pantalla.
- Dashboard, KPI, analytics y reports distinguen carga, vacio, error y dato no
  disponible, con retry visible en lugar de convertir excepciones en arreglos vacios.
- El layout usa drawer movil, `h-dvh`, anchos fluidos, skip link, foco visible y respeto
  por `prefers-reduced-motion`. Las 25 primitivas Recharts desactivan su animacion
  cuando esa preferencia esta activa.
- `@axe-core/playwright` verifica WCAG 2.1 A/AA en dashboard, formularios, evaluacion y
  KPI. El resultado del rerun final se registra en `Validacion de P2.2/P2.3`; la
  existencia de la prueba no sustituye ese gate.

### 4. Observabilidad y respuestas uniformes

- Los errores de servidor, runtime de cliente, boundaries y API producen eventos JSON
  estructurados con `eventId`, tiempo, servicio, entorno, fuente y contexto sanitizado.
- Email, credenciales y query strings sensibles se redactan antes de log o envio. El
  webhook usa `Authorization: Bearer`, timeout de tres segundos y no interrumpe el flujo
  de usuario cuando el proveedor falla.
- El endpoint de errores de cliente requiere sesion, origen canonico exacto, conteo del
  stream real hasta 8 KiB aunque falte `Content-Length`, y limite de 12 eventos por
  usuario/minuto. Los headers de proxy no pueden redefinir el origen confiable.
- Produccion exige URL HTTPS real y token no placeholder de al menos 32 caracteres. El
  contrato operativo esta en `docs/production-security-runbook.md`.
- Las evaluaciones inexistentes, fuera de alcance o con relaciones corruptas responden
  de forma uniforme como `NOT_FOUND`/`Evaluacion no disponible`; no filtran si el ID
  existe fuera de la campana autorizada.

## Validacion de P2.2/P2.3

Evidencia registrada el 2026-07-16:

- PostgreSQL 16.14: 27/27 migraciones aplicadas, drift cero, seed idempotente y rol
  runtime/append-only audit aprobados.
- Benchmark PostgreSQL 16: aprobado dentro de los presupuestos documentados.
- Playwright final: 31/31 pruebas aprobadas contra PostgreSQL 16 (4 setup y 27
  escenarios, incluidos los cuatro perfiles y Pixel 7).
- WCAG 2.1 A/AA: 3/3 escenarios Axe aprobados en dashboard, formularios, evaluacion y
  KPIs; las graficas exponen alternativas textuales acotadas.
- Concurrencia de evaluaciones PostgreSQL 16.14: 1/1 prueba aprobada en 1.18 s.
- Admision distribuida de exportaciones PostgreSQL 16.14: 2/2 pruebas aprobadas,
  incluyendo usuarios distintos bajo limite global.
- Descarga CSV y lifecycle de exportacion PostgreSQL 16.14: 1/1 prueba aprobada.
- Biome: 260 archivos aprobados.
- TypeScript: `next typegen` y `tsc --noEmit` aprobados.
- Vitest: 40 archivos/308 pruebas aprobadas; 3 archivos/4 pruebas de integracion se
  omiten sin sus variables y fueron ejecutados por separado con los resultados arriba.
- Next.js 16.2.10: build de produccion aprobado con 32 rutas registradas.
- Dependencias: auditoria completa y de produccion sin vulnerabilidades conocidas.
- Scripts Bash, Prisma schema, whitespace y `git diff --check`: aprobados.

Todos los gates del candidato quedaron aprobados localmente. El workflow requerido del
PR debe reproducirlos antes de mergear; la existencia de esta evidencia no permite
omitir CI ni los gates de produccion del runbook.

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
- La zona operacional se configura por instalacion, no por campana. Cambiarla requiere
  una decision operativa y una nueva validacion de agrupaciones y rangos historicos.
