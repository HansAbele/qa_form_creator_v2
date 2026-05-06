-- Legacy forms created before QA categories did not have publishable metadata.
-- Attach uncategorized questions to a safe default category and distribute
-- rating weights only when the legacy total is still zero.
WITH fallback_category AS (
  SELECT "id"
  FROM "QACategory"
  WHERE "id" = 'qa_process_adherence'
  UNION ALL
  SELECT "id"
  FROM "QACategory"
  WHERE "isActive" = true
    AND "id" <> 'qa_process_adherence'
  ORDER BY 1
  LIMIT 1
),
legacy_forms AS (
  SELECT DISTINCT "formId"
  FROM "Question"
  WHERE "formCategoryId" IS NULL
)
INSERT INTO "FormCategory" ("id", "formId", "qaCategoryId", "weight", "sortOrder")
SELECT
  'legacy_fc_' || substr(md5(legacy_forms."formId" || fallback_category."id"), 1, 20),
  legacy_forms."formId",
  fallback_category."id",
  0,
  0
FROM legacy_forms
CROSS JOIN fallback_category
ON CONFLICT ("formId", "qaCategoryId") DO NOTHING;

WITH fallback_category AS (
  SELECT "id"
  FROM "QACategory"
  WHERE "id" = 'qa_process_adherence'
  UNION ALL
  SELECT "id"
  FROM "QACategory"
  WHERE "isActive" = true
    AND "id" <> 'qa_process_adherence'
  ORDER BY 1
  LIMIT 1
),
fallback_form_categories AS (
  SELECT "FormCategory"."id", "FormCategory"."formId"
  FROM "FormCategory"
  INNER JOIN fallback_category
    ON fallback_category."id" = "FormCategory"."qaCategoryId"
)
UPDATE "Question"
SET "formCategoryId" = fallback_form_categories."id"
FROM fallback_form_categories
WHERE "Question"."formId" = fallback_form_categories."formId"
  AND "Question"."formCategoryId" IS NULL;

WITH rating_totals AS (
  SELECT
    "formId",
    SUM("weight") AS "ratingWeightTotal"
  FROM "Question"
  WHERE "type" = 'RATING'
  GROUP BY "formId"
),
zero_weight_forms AS (
  SELECT "formId"
  FROM rating_totals
  WHERE "ratingWeightTotal" = 0
),
rating_questions AS (
  SELECT
    "Question"."id",
    row_number() OVER (
      PARTITION BY "Question"."formId"
      ORDER BY "Question"."order", "Question"."id"
    ) AS "rowNumber",
    count(*) OVER (PARTITION BY "Question"."formId") AS "ratingCount"
  FROM "Question"
  INNER JOIN zero_weight_forms
    ON zero_weight_forms."formId" = "Question"."formId"
  WHERE "Question"."type" = 'RATING'
),
weighted_questions AS (
  SELECT
    "id",
    floor(100.0 / "ratingCount")::integer
      + CASE
          WHEN "rowNumber" <= (100 % "ratingCount") THEN 1
          ELSE 0
        END AS "weight"
  FROM rating_questions
)
UPDATE "Question"
SET "weight" = weighted_questions."weight"
FROM weighted_questions
WHERE "Question"."id" = weighted_questions."id";

WITH category_weights AS (
  SELECT
    "formCategoryId",
    SUM(CASE WHEN "type" = 'RATING' THEN "weight" ELSE 0 END) AS "weight"
  FROM "Question"
  WHERE "formCategoryId" IS NOT NULL
  GROUP BY "formCategoryId"
)
UPDATE "FormCategory"
SET "weight" = category_weights."weight"
FROM category_weights
WHERE "FormCategory"."id" = category_weights."formCategoryId";

WITH form_quality AS (
  SELECT
    "Form"."id",
    count("Question"."id") AS "questionCount",
    count("Question"."id") FILTER (WHERE "Question"."formCategoryId" IS NULL) AS "uncategorizedCount",
    count("Question"."id") FILTER (WHERE "Question"."type" = 'RATING') AS "ratingCount",
    COALESCE(
      SUM(CASE WHEN "Question"."type" = 'RATING' THEN "Question"."weight" ELSE 0 END),
      0
    ) AS "ratingWeightTotal"
  FROM "Form"
  LEFT JOIN "Question"
    ON "Question"."formId" = "Form"."id"
  GROUP BY "Form"."id"
)
UPDATE "Form"
SET
  "status" = 'DRAFT',
  "publishedAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
FROM form_quality
WHERE "Form"."id" = form_quality."id"
  AND "Form"."status" = 'PUBLISHED'
  AND (
    form_quality."questionCount" = 0
    OR form_quality."uncategorizedCount" > 0
    OR (
      form_quality."ratingCount" > 0
      AND form_quality."ratingWeightTotal" <> 100
    )
  );
