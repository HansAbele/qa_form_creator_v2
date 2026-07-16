-- Audit events are evidence, not ordinary application data. Historical actor
-- and campaign references must never be rewritten by cascades.
BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_campaignId_fkey";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;
ALTER TABLE "AuditLog" VALIDATE CONSTRAINT "AuditLog_userId_fkey";
ALTER TABLE "AuditLog" VALIDATE CONSTRAINT "AuditLog_campaignId_fkey";

-- Only the table owner may mutate audit rows, and only inside an explicitly
-- marked maintenance transaction. Pinning search_path prevents object shadowing.
CREATE OR REPLACE FUNCTION qa_protect_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  audit_owner text;
BEGIN
  SELECT pg_get_userbyid(c.relowner)
  INTO audit_owner
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'AuditLog'
    AND c.relkind = 'r';

  -- Prisma supplies @default(now()) values explicitly. Always replace that
  -- client value with database time unless the owner opened an approved
  -- maintenance transaction for a controlled historical import.
  IF TG_OP = 'INSERT' THEN
    IF NOT (
      session_user = audit_owner
      AND current_setting('qore.audit_maintenance', true) = 'enabled'
    ) THEN
      NEW."createdAt" := statement_timestamp();
    END IF;
    RETURN NEW;
  END IF;

  IF session_user = audit_owner
     AND current_setting('qore.audit_maintenance', true) = 'enabled' THEN
    IF TG_OP = 'UPDATE' THEN
      RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NULL;
  END IF;

  RAISE EXCEPTION 'AuditLog is append-only; use an approved owner maintenance transaction'
    USING ERRCODE = '42501';
END $$;

CREATE TRIGGER "AuditLog_stamp_created_at"
BEFORE INSERT ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION qa_protect_audit_log();

CREATE TRIGGER "AuditLog_block_mutation"
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION qa_protect_audit_log();

CREATE TRIGGER "AuditLog_block_truncate"
BEFORE TRUNCATE ON "AuditLog"
FOR EACH STATEMENT
EXECUTE FUNCTION qa_protect_audit_log();

-- ALWAYS is defense in depth: these controls remain active even during a
-- replication-role session. The runtime role is also denied that parameter.
ALTER TABLE "AuditLog" ENABLE ALWAYS TRIGGER "AuditLog_stamp_created_at";
ALTER TABLE "AuditLog" ENABLE ALWAYS TRIGGER "AuditLog_block_mutation";
ALTER TABLE "AuditLog" ENABLE ALWAYS TRIGGER "AuditLog_block_truncate";

COMMIT;
