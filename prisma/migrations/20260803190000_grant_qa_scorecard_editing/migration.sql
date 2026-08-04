-- QA users may edit every scorecard within the campaigns assigned to them.
UPDATE "UserCampaign" AS access
SET "canEditForms" = true
FROM "User" AS app_user
WHERE
  app_user."id" = access."userId"
  AND app_user."role" = 'QA';
