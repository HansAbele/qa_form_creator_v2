-- Evaluation drafts are no longer part of the operational workflow. Close any
-- timer that belongs to a pending evaluation before removing its response.
WITH draft_activities AS (
  SELECT qa."id"
  FROM "QaActivitySession" qa
  JOIN "Response" response ON response."id" = qa."responseId"
  WHERE response."status" = 'DRAFT'
    AND qa."activityType" = 'EVALUATION'
)
UPDATE "QaActivityInterval" interval
SET
  "endedAt" = CURRENT_TIMESTAMP,
  "durationSeconds" = GREATEST(
    0,
    FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - interval."startedAt")))::INTEGER
  ),
  "stopReason" = 'Evaluation draft removed by workflow policy'
FROM draft_activities
WHERE interval."activitySessionId" = draft_activities."id"
  AND interval."endedAt" IS NULL;

WITH draft_activities AS (
  SELECT qa."id"
  FROM "QaActivitySession" qa
  JOIN "Response" response ON response."id" = qa."responseId"
  WHERE response."status" = 'DRAFT'
    AND qa."activityType" = 'EVALUATION'
)
UPDATE "QaActivitySession" activity
SET
  "status" = 'CANCELLED',
  "endedAt" = COALESCE(activity."endedAt", CURRENT_TIMESTAMP),
  "totalSeconds" = COALESCE(
    (
      SELECT SUM(interval."durationSeconds")::INTEGER
      FROM "QaActivityInterval" interval
      WHERE interval."activitySessionId" = activity."id"
    ),
    activity."totalSeconds"
  ),
  "notes" = 'Evaluation closed because pending evaluation drafts were removed.'
WHERE activity."id" IN (SELECT "id" FROM draft_activities)
  AND activity."status" IN ('ACTIVE', 'PAUSED');

-- Answers are deleted through the Response -> Answer cascade. Optional
-- evidence and activity links are detached through their existing SET NULL
-- foreign-key behavior.
DELETE FROM "Response"
WHERE "status" = 'DRAFT';

ALTER TABLE "Response"
  ALTER COLUMN "status" SET DEFAULT 'SUBMITTED';

ALTER TABLE "Response"
  ADD CONSTRAINT "Response_status_check"
  CHECK ("status" IN ('SUBMITTED', 'CANCELLED'));
