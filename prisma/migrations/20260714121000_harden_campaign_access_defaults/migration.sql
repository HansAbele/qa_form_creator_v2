-- New campaign assignments default to an evaluator with minimum privileges.
-- Manager access must be granted explicitly through a campaign access preset.
BEGIN;

ALTER TABLE "UserCampaign"
  ALTER COLUMN "roleInCampaign" SET DEFAULT 'EVALUATOR',
  ALTER COLUMN "canViewDashboard" SET DEFAULT true,
  ALTER COLUMN "canViewKPIs" SET DEFAULT false,
  ALTER COLUMN "canViewForms" SET DEFAULT true,
  ALTER COLUMN "canCreateForms" SET DEFAULT false,
  ALTER COLUMN "canEditForms" SET DEFAULT false,
  ALTER COLUMN "canPublishForms" SET DEFAULT false,
  ALTER COLUMN "canEvaluate" SET DEFAULT true,
  ALTER COLUMN "canEditEvaluations" SET DEFAULT false,
  ALTER COLUMN "canViewReports" SET DEFAULT false,
  ALTER COLUMN "canExport" SET DEFAULT false,
  ALTER COLUMN "canManageAgents" SET DEFAULT false,
  ALTER COLUMN "canManageDispositions" SET DEFAULT false,
  ALTER COLUMN "canManageCampaignScoring" SET DEFAULT false,
  ALTER COLUMN "canViewAudit" SET DEFAULT false;

-- The previous application default silently created every QA assignment as a
-- campaign administrator. Reclassify those historical QA rows before applying
-- the evaluator preset. Global ADMIN users and SUPERVISOR assignments remain
-- unchanged. Preserve an exact audit inventory first so intentional campaign
-- managers can be reviewed and granted again explicitly after deploy.
INSERT INTO "AuditLog" (
  "id",
  "campaignId",
  "module",
  "action",
  "entityType",
  "entityId",
  "beforeValue",
  "impact",
  "createdAt"
)
SELECT
  'hardening_' || md5(
    access."userId" || ':' || access."campaignId" || ':' || clock_timestamp()::text
  ),
  access."campaignId",
  'permissions',
  'legacy_campaign_admin_snapshot',
  'user_campaign',
  access."userId" || ':' || access."campaignId",
  jsonb_build_object(
    'userId', access."userId",
    'campaignId', access."campaignId",
    'roleInCampaign', access."roleInCampaign",
    'canViewDashboard', access."canViewDashboard",
    'canViewKPIs', access."canViewKPIs",
    'canViewForms', access."canViewForms",
    'canCreateForms', access."canCreateForms",
    'canEditForms', access."canEditForms",
    'canPublishForms', access."canPublishForms",
    'canEvaluate', access."canEvaluate",
    'canEditEvaluations', access."canEditEvaluations",
    'canViewReports', access."canViewReports",
    'canExport', access."canExport",
    'canManageAgents', access."canManageAgents",
    'canManageDispositions', access."canManageDispositions",
    'canManageCampaignScoring', access."canManageCampaignScoring",
    'canViewAudit', access."canViewAudit"
  ),
  'Snapshot previo a normalizar acceso QA heredado; revisar y reotorgar managers intencionales.',
  NOW()
FROM "UserCampaign" AS access
JOIN "User" AS app_user ON app_user."id" = access."userId"
WHERE app_user."role" = 'QA'
  AND access."roleInCampaign" = 'CAMPAIGN_ADMIN';

UPDATE "UserCampaign" AS access
SET "roleInCampaign" = 'EVALUATOR'
FROM "User" AS app_user
WHERE access."userId" = app_user."id"
  AND app_user."role" = 'QA'
  AND access."roleInCampaign" = 'CAMPAIGN_ADMIN';

-- Existing evaluator assignments inherit the same least-privilege profile.
UPDATE "UserCampaign"
SET
  "canViewDashboard" = true,
  "canViewKPIs" = false,
  "canViewForms" = true,
  "canCreateForms" = false,
  "canEditForms" = false,
  "canPublishForms" = false,
  "canEvaluate" = true,
  "canEditEvaluations" = false,
  "canViewReports" = false,
  "canExport" = false,
  "canManageAgents" = false,
  "canManageDispositions" = false,
  "canManageCampaignScoring" = false,
  "canViewAudit" = false
WHERE "roleInCampaign" = 'EVALUATOR';

COMMIT;
