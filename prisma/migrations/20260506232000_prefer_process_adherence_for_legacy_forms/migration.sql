-- Normalize the generic legacy fallback category to Process Adherence.
-- This keeps old forms evaluable without implying a stricter business-critical rule.
WITH process_category AS (
  SELECT "id"
  FROM "QACategory"
  WHERE "id" = 'qa_process_adherence'
),
legacy_categories AS (
  SELECT
    "FormCategory"."id",
    "FormCategory"."formId"
  FROM "FormCategory"
  CROSS JOIN process_category
  WHERE "FormCategory"."id" LIKE 'legacy_fc_%'
    AND "FormCategory"."qaCategoryId" <> process_category."id"
),
existing_process_categories AS (
  SELECT
    "FormCategory"."id",
    "FormCategory"."formId"
  FROM "FormCategory"
  INNER JOIN process_category
    ON process_category."id" = "FormCategory"."qaCategoryId"
)
UPDATE "Question"
SET "formCategoryId" = existing_process_categories."id"
FROM legacy_categories
INNER JOIN existing_process_categories
  ON existing_process_categories."formId" = legacy_categories."formId"
WHERE "Question"."formCategoryId" = legacy_categories."id";

WITH process_category AS (
  SELECT "id"
  FROM "QACategory"
  WHERE "id" = 'qa_process_adherence'
),
legacy_categories AS (
  SELECT
    "FormCategory"."id",
    "FormCategory"."formId"
  FROM "FormCategory"
  CROSS JOIN process_category
  WHERE "FormCategory"."id" LIKE 'legacy_fc_%'
    AND "FormCategory"."qaCategoryId" <> process_category."id"
),
existing_process_categories AS (
  SELECT
    "FormCategory"."id",
    "FormCategory"."formId"
  FROM "FormCategory"
  INNER JOIN process_category
    ON process_category."id" = "FormCategory"."qaCategoryId"
)
DELETE FROM "FormCategory"
USING legacy_categories
INNER JOIN existing_process_categories
  ON existing_process_categories."formId" = legacy_categories."formId"
WHERE "FormCategory"."id" = legacy_categories."id";

UPDATE "FormCategory"
SET "qaCategoryId" = 'qa_process_adherence'
WHERE "id" LIKE 'legacy_fc_%'
  AND "qaCategoryId" <> 'qa_process_adherence';

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

UPDATE "Answer"
SET "categoryId" = "FormCategory"."qaCategoryId"
FROM "Question"
INNER JOIN "FormCategory"
  ON "FormCategory"."id" = "Question"."formCategoryId"
WHERE "Answer"."questionId" = "Question"."id";
