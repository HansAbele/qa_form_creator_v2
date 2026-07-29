-- Publish a new Parker Davis revision instead of mutating a form that may
-- already have historical evaluations. The duplicated zero-point checkpoint
-- is retained only in SECTION 5 — Correct Information.
CREATE TEMPORARY TABLE "_ParkerDavisRevisionSource" ON COMMIT DROP AS
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
  question."id" AS "removedQuestionId",
  question."order" AS "removedQuestionOrder",
  'official_pd_r2_' || SUBSTRING(MD5(form."id"), 1, 24) AS "revisionFormId"
FROM "Form" AS form
JOIN "Question" AS question ON question."formId" = form."id"
JOIN "FormCategory" AS form_category ON form_category."id" = question."formCategoryId"
JOIN "QACategory" AS category ON category."id" = form_category."qaCategoryId"
WHERE
  form."templateKey" = 'PARKER_DAVIS_QA_SCORECARD'
  AND form."templateVersion" <> 'PD-QA-SCORECARD-2026-07-R2'
  AND form."status" = 'PUBLISHED'
  AND category."name" = 'SECTION 4 — Policy & Compliance/Procedures*'
  AND question."label" = '[[CHECK]]• Customer informed that returns are inspected; restocking fees may apply if used/damaged.'
ORDER BY form."campaignId", form."publishedAt" DESC NULLS LAST, form."createdAt" DESC;

-- The family has a partial unique index that permits only one published form.
-- Archive the source inside this transaction before inserting its revision.
UPDATE "Form" AS form
SET
  "status" = 'ARCHIVED',
  "archivedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_ParkerDavisRevisionSource" AS source
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
    ELSE '1.0.1'
  END,
  'PARKER_DAVIS_QA_SCORECARD',
  'PD-QA-SCORECARD-2026-07-R2',
  COALESCE(source."passThresholdOverride", 95),
  source."gradingScale",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_ParkerDavisRevisionSource" AS source
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
  'official_pd_fc_r2_' || SUBSTRING(MD5(source."revisionFormId" || ':' || form_category."id"), 1, 24),
  source."revisionFormId",
  form_category."qaCategoryId",
  form_category."weight",
  form_category."fatalIfFailed",
  form_category."requiresComment",
  form_category."sortOrder"
FROM "_ParkerDavisRevisionSource" AS source
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
  'official_pd_q_r2_' || SUBSTRING(MD5(source."revisionFormId" || ':' || question."id"), 1, 24),
  source."revisionFormId",
  CASE
    WHEN question."formCategoryId" IS NULL THEN NULL
    ELSE 'official_pd_fc_r2_' || SUBSTRING(
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
  question."fatal",
  question."fatalOptions",
  question."criticalType",
  question."ratingFailThreshold",
  question."ratingMax",
  question."ratingStyle",
  question."requiresCommentOnFail",
  CASE
    WHEN question."order" > source."removedQuestionOrder" THEN question."order" - 1
    ELSE question."order"
  END
FROM "_ParkerDavisRevisionSource" AS source
JOIN "Question" AS question ON question."formId" = source."sourceFormId"
WHERE question."id" <> source."removedQuestionId"
ON CONFLICT ("id") DO NOTHING;
