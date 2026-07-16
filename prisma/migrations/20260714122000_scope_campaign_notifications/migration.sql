-- Campaign notifications remain stored for audit/history, but readers must be able
-- to re-check the permission that originally authorized delivery.
BEGIN;

ALTER TABLE "Notification"
  ADD COLUMN IF NOT EXISTS "requiredPermission" TEXT;

CREATE INDEX IF NOT EXISTS "Notification_userId_campaignId_requiredPermission_idx"
  ON "Notification"("userId", "campaignId", "requiredPermission");

COMMIT;
