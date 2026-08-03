INSERT INTO "CampaignCallSource" (
  "id",
  "campaignId",
  "provider",
  "instanceKey",
  "externalCampaignIds",
  "enabled",
  "settings",
  "createdAt",
  "updatedAt"
)
SELECT
  'freepbx_' || campaign."id",
  campaign."id",
  'FREEPBX'::"InteractionProvider",
  'parker-davis',
  ARRAY['parker-davis']::TEXT[],
  TRUE,
  '{"initialLookbackHours":24,"overlapMinutes":15,"completionLagMinutes":2,"maxPages":4}'::JSONB,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Campaign" AS campaign
WHERE campaign."active" = TRUE
  AND (
    campaign."name" ILIKE '%Parker Davis%'
    OR EXISTS (
      SELECT 1
      FROM "Form" AS form
      WHERE form."campaignId" = campaign."id"
        AND form."templateKey" = 'PARKER_DAVIS_QA_SCORECARD'
    )
  )
ON CONFLICT ("campaignId", "provider", "instanceKey") DO UPDATE
SET
  "externalCampaignIds" = EXCLUDED."externalCampaignIds",
  "enabled" = TRUE,
  "settings" = EXCLUDED."settings",
  "updatedAt" = CURRENT_TIMESTAMP;
