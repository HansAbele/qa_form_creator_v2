-- Correct Richard's official FreePBX extension and the Parker Davis source allowlist.
UPDATE "CampaignCallSource" AS source
SET
  "settings" = COALESCE(source."settings", '{}'::JSONB)
    || '{"providerAgentIds":["4116","4115","4113"]}'::JSONB,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Campaign" AS campaign
WHERE source."campaignId" = campaign."id"
  AND source."provider" = 'FREEPBX'::"InteractionProvider"
  AND source."instanceKey" = 'parker-davis'
  AND (
    campaign."name" ILIKE '%Parker Davis%'
    OR EXISTS (
      SELECT 1
      FROM "Form" AS form
      WHERE form."campaignId" = campaign."id"
        AND form."templateKey" = 'PARKER_DAVIS_QA_SCORECARD'
    )
  );

UPDATE "Agent" AS agent
SET
  "agentCode" = '4113',
  "active" = TRUE
FROM "Campaign" AS campaign
WHERE agent."campaignId" = campaign."id"
  AND agent."name" ILIKE 'Richard Jos%'
  AND (
    campaign."name" ILIKE '%Parker Davis%'
    OR EXISTS (
      SELECT 1
      FROM "Form" AS form
      WHERE form."campaignId" = campaign."id"
        AND form."templateKey" = 'PARKER_DAVIS_QA_SCORECARD'
    )
  );

-- Map any retained 4113 calls before the operational backfill runs.
UPDATE "Interaction" AS interaction
SET
  "agentId" = agent."id",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Agent" AS agent
WHERE interaction."campaignId" = agent."campaignId"
  AND interaction."provider" = 'FREEPBX'::"InteractionProvider"
  AND interaction."providerInstance" = 'parker-davis'
  AND interaction."providerAgentId" = '4113'
  AND agent."agentCode" = '4113'
  AND agent."active" = TRUE;

-- 4156 belongs outside the approved Parker Davis agent scope.
DELETE FROM "Interaction" AS interaction
USING "CampaignCallSource" AS source
WHERE interaction."campaignId" = source."campaignId"
  AND interaction."provider" = source."provider"
  AND interaction."providerInstance" = source."instanceKey"
  AND source."provider" = 'FREEPBX'::"InteractionProvider"
  AND source."instanceKey" = 'parker-davis'
  AND interaction."providerAgentId" = '4156';
