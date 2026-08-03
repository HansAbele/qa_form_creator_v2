-- Parker Davis only evaluates the three official FreePBX extensions below.
-- The source-level allowlist prevents unrelated extensions from being imported.
UPDATE "CampaignCallSource" AS source
SET
  "settings" = COALESCE(source."settings", '{}'::JSONB)
    || '{"providerAgentIds":["4116","4115","4156"]}'::JSONB,
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

-- Map the official FreePBX extensions to the existing Parker Davis agents.
UPDATE "Agent" AS agent
SET
  "agentCode" = official."extension",
  "active" = TRUE
FROM (
  VALUES
    ('Luisangel Joel Santos Blanco', '4116'),
    ('Alberto Batista Leonardo', '4115'),
    ('Richard Jos%', '4156')
) AS official("namePattern", "extension"),
"Campaign" AS campaign
WHERE agent."campaignId" = campaign."id"
  AND agent."name" ILIKE official."namePattern"
  AND (
    campaign."name" ILIKE '%Parker Davis%'
    OR EXISTS (
      SELECT 1
      FROM "Form" AS form
      WHERE form."campaignId" = campaign."id"
        AND form."templateKey" = 'PARKER_DAVIS_QA_SCORECARD'
    )
  );

-- Removing an agent in QORE means deactivation so historical audit data remains valid.
UPDATE "Agent" AS agent
SET
  "active" = FALSE,
  "agentCode" = NULL
FROM "Campaign" AS campaign
WHERE agent."campaignId" = campaign."id"
  AND agent."name" ILIKE 'Ambar Luciano Tav%'
  AND (
    campaign."name" ILIKE '%Parker Davis%'
    OR EXISTS (
      SELECT 1
      FROM "Form" AS form
      WHERE form."campaignId" = campaign."id"
        AND form."templateKey" = 'PARKER_DAVIS_QA_SCORECARD'
    )
  );

-- Backfill the local agent relation for calls that were imported before the mapping existed.
UPDATE "Interaction" AS interaction
SET
  "agentId" = agent."id",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Agent" AS agent
WHERE interaction."campaignId" = agent."campaignId"
  AND interaction."provider" = 'FREEPBX'::"InteractionProvider"
  AND interaction."providerInstance" = 'parker-davis'
  AND interaction."providerAgentId" = agent."agentCode"
  AND agent."active" = TRUE
  AND agent."agentCode" IN ('4116', '4115', '4156');

-- Calls from other extensions were imported before the allowlist was known.
-- Removing them leaves evaluations, coaching and PIP records untouched because their
-- nullable interaction references use ON DELETE SET NULL.
DELETE FROM "Interaction" AS interaction
USING "CampaignCallSource" AS source
WHERE interaction."campaignId" = source."campaignId"
  AND interaction."provider" = source."provider"
  AND interaction."providerInstance" = source."instanceKey"
  AND source."provider" = 'FREEPBX'::"InteractionProvider"
  AND source."instanceKey" = 'parker-davis'
  AND COALESCE(interaction."providerAgentId", '') NOT IN ('4116', '4115', '4156');
