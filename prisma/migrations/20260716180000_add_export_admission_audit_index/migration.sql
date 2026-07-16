-- Keep global export-admission scans bounded to the active lease window while
-- preserving the module/action prefix used by existing audit queries.
CREATE INDEX "AuditLog_module_action_entityType_createdAt_idx"
ON "AuditLog"("module", "action", "entityType", "createdAt");

DROP INDEX "AuditLog_module_action_idx";
