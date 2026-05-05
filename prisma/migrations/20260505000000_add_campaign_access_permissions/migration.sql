-- Add campaign-scoped operational permissions.
CREATE TYPE "CampaignAccessLevel" AS ENUM ('CAMPAIGN_ADMIN', 'EVALUATOR', 'SUPERVISOR');

ALTER TABLE "UserCampaign"
  ADD COLUMN "roleInCampaign" "CampaignAccessLevel" NOT NULL DEFAULT 'CAMPAIGN_ADMIN',
  ADD COLUMN "canViewDashboard" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canViewKPIs" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canViewForms" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canCreateForms" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canEditForms" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canPublishForms" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canEvaluate" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canEditEvaluations" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canViewReports" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canExport" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canManageAgents" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canManageDispositions" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canManageCampaignScoring" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "UserCampaign_campaignId_idx" ON "UserCampaign"("campaignId");
