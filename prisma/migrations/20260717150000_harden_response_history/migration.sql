-- A response created without an explicit lifecycle state must never look submitted.
ALTER TABLE "Response" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- Repair legacy rows before enforcing the official-history timestamp invariant.
UPDATE "Response"
SET "submittedAt" = "createdAt"
WHERE "status" = 'SUBMITTED' AND "submittedAt" IS NULL;

ALTER TABLE "Response"
ADD CONSTRAINT "Response_submitted_requires_timestamp_check"
CHECK ("status" <> 'SUBMITTED' OR "submittedAt" IS NOT NULL) NOT VALID;

ALTER TABLE "Response"
VALIDATE CONSTRAINT "Response_submitted_requires_timestamp_check";

-- Support paginated evaluation history by submission date and authorization scope.
CREATE INDEX "Response_status_submittedAt_id_idx"
ON "Response"("status", "submittedAt", "id");

CREATE INDEX "Response_agentId_status_submittedAt_id_idx"
ON "Response"("agentId", "status", "submittedAt", "id");

CREATE INDEX "Response_evaluatorId_status_submittedAt_id_idx"
ON "Response"("evaluatorId", "status", "submittedAt", "id");

CREATE INDEX "Response_formId_status_submittedAt_id_idx"
ON "Response"("formId", "status", "submittedAt", "id");

CREATE INDEX "Response_dispositionId_status_submittedAt_id_idx"
ON "Response"("dispositionId", "status", "submittedAt", "id");
