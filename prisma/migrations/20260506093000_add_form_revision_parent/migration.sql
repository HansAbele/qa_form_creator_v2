-- Existing forms were operational before draft/publish controls existed.
-- Keep them published when the revision workflow is introduced.
ALTER TABLE "Form" ADD COLUMN "parentFormId" TEXT;

UPDATE "Form"
SET "status" = 'PUBLISHED',
    "publishedAt" = COALESCE("publishedAt", "createdAt")
WHERE "status" = 'DRAFT'
  AND "publishedAt" IS NULL
  AND "archivedAt" IS NULL;

CREATE INDEX "Form_parentFormId_idx" ON "Form"("parentFormId");
CREATE INDEX "Form_status_idx" ON "Form"("status");

ALTER TABLE "Form"
ADD CONSTRAINT "Form_parentFormId_fkey"
FOREIGN KEY ("parentFormId") REFERENCES "Form"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
