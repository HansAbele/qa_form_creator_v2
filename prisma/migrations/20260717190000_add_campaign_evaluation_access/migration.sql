-- Give campaign assignments an explicit evaluation-history permission.
ALTER TABLE "UserCampaign"
ADD COLUMN "canViewEvaluations" BOOLEAN NOT NULL DEFAULT false;

-- Evaluation history is part of the daily workspace for every supported
-- campaign role. The remaining grants below intentionally apply only to QA
-- evaluators, not supervisors.
UPDATE "UserCampaign"
SET "canViewEvaluations" = true;

UPDATE "UserCampaign" AS access
SET
  "canViewKPIs" = true,
  "canCreateForms" = true,
  "canEditForms" = true,
  "canViewReports" = true
FROM "User" AS app_user
WHERE app_user.id = access."userId"
  AND app_user.role = 'QA'
  AND access."roleInCampaign" = 'EVALUATOR';
