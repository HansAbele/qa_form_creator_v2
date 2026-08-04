-- Preserve historical Parker Davis evaluations on their archived form revision,
-- then publish a new revision containing only questions that award points.
CREATE TEMPORARY TABLE "_ParkerDavisScoredRevision" ON COMMIT DROP AS
SELECT DISTINCT ON (form."campaignId")
  form."id" AS "sourceFormId",
  form."campaignId",
  form."createdById",
  form."title",
  form."description",
  form."version",
  form."parentFormId",
  form."passThresholdOverride",
  form."gradingScale",
  'official_pd_r3_' || SUBSTRING(MD5(form."id"), 1, 24) AS "revisionFormId"
FROM "Form" AS form
WHERE
  form."templateKey" = 'PARKER_DAVIS_QA_SCORECARD'
  AND form."status" = 'PUBLISHED'
  AND EXISTS (
    SELECT 1
    FROM "Question" AS question
    WHERE question."formId" = form."id" AND question."weight" <= 0
  )
ORDER BY form."campaignId", form."publishedAt" DESC NULLS LAST, form."createdAt" DESC;

UPDATE "Form" AS form
SET
  "status" = 'ARCHIVED',
  "archivedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_ParkerDavisScoredRevision" AS source
WHERE form."id" = source."sourceFormId";

INSERT INTO "Form" (
  "id",
  "title",
  "description",
  "campaignId",
  "createdById",
  "parentFormId",
  "status",
  "version",
  "templateKey",
  "templateVersion",
  "passThresholdOverride",
  "gradingScale",
  "publishedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  source."revisionFormId",
  source."title",
  source."description",
  source."campaignId",
  source."createdById",
  COALESCE(source."parentFormId", source."sourceFormId"),
  'PUBLISHED',
  CASE
    WHEN source."version" ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
      THEN SPLIT_PART(source."version", '.', 1)
        || '.' || SPLIT_PART(source."version", '.', 2)
        || '.' || (SPLIT_PART(source."version", '.', 3)::integer + 1)::text
    ELSE '1.0.2'
  END,
  'PARKER_DAVIS_QA_SCORECARD',
  'PD-QA-SCORECARD-2026-08-R3',
  COALESCE(source."passThresholdOverride", 95),
  source."gradingScale",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_ParkerDavisScoredRevision" AS source
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "FormCategory" (
  "id",
  "formId",
  "qaCategoryId",
  "weight",
  "fatalIfFailed",
  "requiresComment",
  "sortOrder"
)
SELECT
  'official_pd_fc_r3_' || SUBSTRING(MD5(source."revisionFormId" || ':' || form_category."id"), 1, 24),
  source."revisionFormId",
  form_category."qaCategoryId",
  form_category."weight",
  false,
  form_category."requiresComment",
  form_category."sortOrder"
FROM "_ParkerDavisScoredRevision" AS source
JOIN "FormCategory" AS form_category ON form_category."formId" = source."sourceFormId"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Question" (
  "id",
  "formId",
  "formCategoryId",
  "type",
  "label",
  "options",
  "required",
  "weight",
  "fatal",
  "fatalOptions",
  "criticalType",
  "ratingFailThreshold",
  "ratingMax",
  "ratingStyle",
  "requiresCommentOnFail",
  "order"
)
SELECT
  'official_pd_q_r3_' || SUBSTRING(MD5(source."revisionFormId" || ':' || question."id"), 1, 24),
  source."revisionFormId",
  CASE
    WHEN question."formCategoryId" IS NULL THEN NULL
    ELSE 'official_pd_fc_r3_' || SUBSTRING(
      MD5(source."revisionFormId" || ':' || question."formCategoryId"),
      1,
      24
    )
  END,
  question."type",
  question."label",
  question."options",
  question."required",
  question."weight",
  false,
  '[]'::jsonb,
  NULL,
  question."ratingFailThreshold",
  question."ratingMax",
  question."ratingStyle",
  question."requiresCommentOnFail",
  ROW_NUMBER() OVER (PARTITION BY source."revisionFormId" ORDER BY question."order", question."id")::integer
FROM "_ParkerDavisScoredRevision" AS source
JOIN "Question" AS question ON question."formId" = source."sourceFormId"
WHERE question."weight" > 0
ON CONFLICT ("id") DO NOTHING;
