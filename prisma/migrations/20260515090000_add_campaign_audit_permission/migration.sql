ALTER TABLE "UserCampaign" ADD COLUMN "canViewAudit" BOOLEAN NOT NULL DEFAULT false;

UPDATE "UserCampaign"
SET "canViewAudit" = true
WHERE "roleInCampaign" IN ('CAMPAIGN_ADMIN', 'SUPERVISOR');
