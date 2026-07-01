-- Advanced evaluation lifecycle:
-- drafts/autosave, submitted timestamps, cancellation audit metadata,
-- full historical snapshots, and N/A answers.

ALTER TABLE "Response"
  ADD COLUMN "scoringSnapshot" JSONB,
  ADD COLUMN "settingsSnapshot" JSONB,
  ADD COLUMN "formSnapshot" JSONB,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledById" TEXT,
  ADD COLUMN "cancellationReason" TEXT;

ALTER TABLE "Answer"
  ADD COLUMN "notApplicable" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Response"
SET "submittedAt" = "createdAt"
WHERE "status" = 'SUBMITTED'
  AND "submittedAt" IS NULL;

CREATE INDEX "Response_status_createdAt_idx" ON "Response"("status", "createdAt");
CREATE INDEX "Response_cancelledById_idx" ON "Response"("cancelledById");
