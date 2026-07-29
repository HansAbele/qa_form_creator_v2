-- Govern the existing HAPUSA scorecard only when its verified structure is
-- still present: 27 scored criteria totaling 100 points.
UPDATE "Form" AS form
SET
  "description" = 'Official HAPUSA call-monitoring scorecard: 27 scored criteria, 100 total points, exact partial-point choices, and a 95% quality threshold.',
  "templateKey" = 'HAPUSA_QA_SCORECARD',
  "templateVersion" = 'HAPUSA-QA-SCORECARD-2026-07',
  "passThresholdOverride" = 95,
  "gradingScale" = '[
    {"min": 95, "max": 100, "label": "Pass", "result": "PASS"},
    {"min": 0, "max": 94.99, "label": "Fail (Needs Improvement)", "result": "FAIL"}
  ]'::jsonb,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Campaign" AS campaign
WHERE
  form."campaignId" = campaign."id"
  AND LOWER(campaign."name") = 'hapusa'
  AND form."status" = 'PUBLISHED'
  AND (
    SELECT COUNT(*)
    FROM "Question" AS question
    WHERE question."formId" = form."id"
  ) = 27
  AND (
    SELECT COALESCE(SUM(question."weight"), 0)
    FROM "Question" AS question
    WHERE question."formId" = form."id"
  ) = 100;

-- Apply governed display metadata to the categories used by that official
-- form without replacing their IDs or breaking historical answer links.
UPDATE "QACategory" AS category
SET
  "description" = CASE category."name"
    WHEN 'Greeting' THEN 'Official HAPUSA greeting and introduction criteria.'
    WHEN 'Account Verification' THEN 'Official HAPUSA patient identity, account, and authorization checks.'
    WHEN 'Listen to the reason of the call' THEN 'Official HAPUSA listening, understanding, and empathy criteria.'
    WHEN 'Problem Solving an account and Working the Account' THEN 'Official HAPUSA ownership, problem-solving, and account-work criteria.'
    WHEN 'Ending the Call' THEN 'Official HAPUSA closing and call-documentation criteria.'
  END,
  "systemColor" = CASE category."name"
    WHEN 'Greeting' THEN '#0F766E'
    WHEN 'Account Verification' THEN '#0E7490'
    WHEN 'Listen to the reason of the call' THEN '#2563EB'
    WHEN 'Problem Solving an account and Working the Account' THEN '#7C3AED'
    WHEN 'Ending the Call' THEN '#C2410C'
  END,
  "systemIcon" = CASE category."name"
    WHEN 'Greeting' THEN 'hand'
    WHEN 'Account Verification' THEN 'badge-check'
    WHEN 'Listen to the reason of the call' THEN 'headphones'
    WHEN 'Problem Solving an account and Working the Account' THEN 'circle-check-big'
    WHEN 'Ending the Call' THEN 'phone-off'
  END,
  "sortOrder" = CASE category."name"
    WHEN 'Greeting' THEN 210
    WHEN 'Account Verification' THEN 220
    WHEN 'Listen to the reason of the call' THEN 230
    WHEN 'Problem Solving an account and Working the Account' THEN 240
    WHEN 'Ending the Call' THEN 250
  END,
  "canBeFatal" = false,
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE
  category."name" IN (
    'Greeting',
    'Account Verification',
    'Listen to the reason of the call',
    'Problem Solving an account and Working the Account',
    'Ending the Call'
  )
  AND EXISTS (
    SELECT 1
    FROM "FormCategory" AS form_category
    JOIN "Form" AS form ON form."id" = form_category."formId"
    JOIN "Campaign" AS campaign ON campaign."id" = form."campaignId"
    WHERE
      form_category."qaCategoryId" = category."id"
      AND form."templateKey" = 'HAPUSA_QA_SCORECARD'
      AND LOWER(campaign."name") = 'hapusa'
  );
