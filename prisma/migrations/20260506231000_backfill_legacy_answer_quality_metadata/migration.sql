-- Legacy evaluations predate per-answer QA category and score metadata.
-- Derive that data from the now-backfilled question/category structure.
UPDATE "Answer"
SET
  "categoryId" = "FormCategory"."qaCategoryId",
  "score" = CASE
    WHEN "Question"."type" = 'RATING'
      AND "Answer"."value" ~ '^[1-5]$'
      THEN ("Answer"."value"::numeric / 5) * 100
    ELSE "Answer"."score"
  END
FROM "Question"
LEFT JOIN "FormCategory"
  ON "FormCategory"."id" = "Question"."formCategoryId"
WHERE "Answer"."questionId" = "Question"."id"
  AND (
    "Answer"."categoryId" IS NULL
    OR ("Answer"."score" IS NULL AND "Question"."type" = 'RATING')
  );

WITH global_settings AS (
  SELECT COALESCE(
    (
      SELECT ("value"::text)::integer
      FROM "AppSetting"
      WHERE "key" = 'passThreshold'
      LIMIT 1
    ),
    70
  ) AS "passThreshold"
),
response_thresholds AS (
  SELECT
    "Response"."id",
    "Form"."version",
    COALESCE(
      CASE
        WHEN "CampaignScoringSettings"."usesGlobalDefaults" = false
          THEN "CampaignScoringSettings"."passThreshold"
        ELSE NULL
      END,
      global_settings."passThreshold",
      70
    ) AS "passThreshold"
  FROM "Response"
  INNER JOIN "Form"
    ON "Form"."id" = "Response"."formId"
  CROSS JOIN global_settings
  LEFT JOIN "CampaignScoringSettings"
    ON "CampaignScoringSettings"."campaignId" = "Form"."campaignId"
)
UPDATE "Response"
SET
  "formVersion" = COALESCE("Response"."formVersion", response_thresholds."version"),
  "result" = COALESCE(
    "Response"."result",
    CASE
      WHEN "Response"."hasFatalFail" = true
        OR "Response"."score" < response_thresholds."passThreshold"
        THEN 'FAIL'
      ELSE 'PASS'
    END
  )
FROM response_thresholds
WHERE "Response"."id" = response_thresholds."id"
  AND (
    "Response"."formVersion" IS NULL
    OR "Response"."result" IS NULL
  );
