# Decision: mantener permisos booleanos en UserCampaign

Last updated: 2026-05-14

## Estado

Aceptada.

## Contexto

Qore ya usa `UserCampaign` como relacion entre usuario y campana. Esa relacion contiene el nivel operativo por campana y permisos booleanos granulares como `canViewDashboard`, `canCreateForms`, `canEvaluate`, `canExport`, `canManageAgents` y `canViewAudit`.

Tambien se habia considerado migrar a una tabla flexible tipo `UserCampaignPermission`, con una fila por permiso concedido.

## Decision

Mantener el modelo actual de permisos booleanos en `UserCampaign` como modelo oficial para esta etapa.

No se migrara a una tabla flexible de permisos hasta que exista una necesidad real de permisos dinamicos.

## Razones

- El set de permisos actual es fijo, conocido y ya esta cubierto por UI, Server Actions, queries y tests RBAC.
- Los permisos booleanos son directos de consultar con Prisma y faciles de razonar en filtros por campana.
- Migrar ahora agregaria cambios amplios en schema, Settings, helpers RBAC, seeds, tests y reportes sin una ganancia funcional inmediata.
- El rol `SUPERVISOR` ya se resolvio con una regla central de read-only en servidor, sin requerir un nuevo modelo.

## Criterios para reabrir la decision

Reconsiderar una tabla flexible solo si aparece al menos una de estas necesidades:

- roles custom configurables por cliente;
- permisos nuevos agregables sin migracion Prisma;
- plantillas de permisos por campana, cliente o equipo;
- permisos por scopes adicionales a campana, como equipo, formulario o modulo;
- historial granular por permiso individual;
- delegacion avanzada de permisos entre usuarios no-admin.

## Consecuencias

- `UserCampaign` sigue siendo la fuente de verdad para permisos por campana.
- Los helpers centrales de RBAC deben seguir normalizando casos especiales de rol, como `SUPERVISOR`.
- Los planes y handoff ya no deben listar "migrar a tabla flexible de permisos" como pendiente abierto.
