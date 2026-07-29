-- AlterTable
ALTER TABLE "Form" ADD COLUMN     "gradingScale" JSONB,
ADD COLUMN     "passThresholdOverride" INTEGER,
ADD COLUMN     "templateKey" TEXT,
ADD COLUMN     "templateVersion" TEXT;

ALTER TABLE "Form"
ADD CONSTRAINT "Form_passThresholdOverride_check"
CHECK ("passThresholdOverride" IS NULL OR "passThresholdOverride" BETWEEN 0 AND 100);

-- CreateIndex
CREATE INDEX "Form_templateKey_idx" ON "Form"("templateKey");

-- Seed the six official Parker Davis scorecard sections. These are global
-- taxonomy records; the form template remains campaign-scoped.
INSERT INTO "QACategory" (
  "id",
  "name",
  "description",
  "systemColor",
  "systemIcon",
  "canBeFatal",
  "requiresCommentOnFail",
  "sortOrder",
  "updatedAt"
)
VALUES
  (
    'qa_pd_opening_verification',
    'SECTION 1 — Opening/Greeting & Verification',
    'Official Parker Davis opening, greeting, and verification criteria.',
    '#003366',
    'badge-check',
    false,
    false,
    110,
    CURRENT_TIMESTAMP
  ),
  (
    'qa_pd_communication_control',
    'SECTION 2 — Communication & Call Control',
    'Official Parker Davis communication and call-control criteria.',
    '#0B4F7A',
    'messages-square',
    false,
    false,
    120,
    CURRENT_TIMESTAMP
  ),
  (
    'qa_pd_problem_resolution',
    'SECTION 3 — Problem Resolution*',
    'Official Parker Davis problem-resolution criteria and supporting checks.',
    '#176A96',
    'circle-check-big',
    false,
    false,
    130,
    CURRENT_TIMESTAMP
  ),
  (
    'qa_pd_policy_compliance',
    'SECTION 4 — Policy & Compliance/Procedures*',
    'Official Parker Davis policy, compliance, and critical-failure controls.',
    '#003366',
    'shield-check',
    true,
    false,
    140,
    CURRENT_TIMESTAMP
  ),
  (
    'qa_pd_correct_information',
    'SECTION 5 — Correct Information*',
    'Official Parker Davis information-accuracy and probing criteria.',
    '#0B4F7A',
    'info',
    true,
    false,
    150,
    CURRENT_TIMESTAMP
  ),
  (
    'qa_pd_documentation',
    'SECTION 6 — Documentation*',
    'Official Parker Davis case-note and documentation criteria.',
    '#176A96',
    'file-check-2',
    true,
    false,
    160,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "systemColor" = EXCLUDED."systemColor",
  "systemIcon" = EXCLUDED."systemIcon",
  "canBeFatal" = EXCLUDED."canBeFatal",
  "requiresCommentOnFail" = EXCLUDED."requiresCommentOnFail",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;
