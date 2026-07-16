-- Reconcile fields already used by the application but missing from the
-- migration history. IF NOT EXISTS keeps this safe for databases that were
-- previously synchronized with `prisma db push`.

BEGIN;

DO $$
BEGIN
  CREATE TYPE "CriticalType" AS ENUM ('CUSTOMER', 'BUSINESS', 'COMPLIANCE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "DispositionOutcome" AS ENUM (
    'RESOLVED',
    'ESCALATED',
    'TRANSFERRED',
    'FOLLOW_UP',
    'CALLBACK',
    'SALE',
    'NO_SALE',
    'NO_CONTACT',
    'DNC',
    'SYSTEM',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'BOOLEAN';

ALTER TABLE "CampaignScoringSettings"
  ADD COLUMN IF NOT EXISTS "fatalZeroesScore" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "customerCeaTarget" DOUBLE PRECISION NOT NULL DEFAULT 95,
  ADD COLUMN IF NOT EXISTS "businessCeaTarget" DOUBLE PRECISION NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS "complianceCeaTarget" DOUBLE PRECISION NOT NULL DEFAULT 99.5;

ALTER TABLE "Disposition"
  ADD COLUMN IF NOT EXISTS "outcomeType" "DispositionOutcome",
  ADD COLUMN IF NOT EXISTS "isSystem" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Question"
  ADD COLUMN IF NOT EXISTS "criticalType" "CriticalType",
  ADD COLUMN IF NOT EXISTS "ratingFailThreshold" INTEGER,
  ADD COLUMN IF NOT EXISTS "ratingMax" INTEGER,
  ADD COLUMN IF NOT EXISTS "ratingStyle" TEXT;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- Reassert defaults and nullability if a prior manual change created a
-- compatible column with weaker constraints.
UPDATE "CampaignScoringSettings"
SET
  "fatalZeroesScore" = COALESCE("fatalZeroesScore", false),
  "customerCeaTarget" = COALESCE("customerCeaTarget", 95),
  "businessCeaTarget" = COALESCE("businessCeaTarget", 90),
  "complianceCeaTarget" = COALESCE("complianceCeaTarget", 99.5);

UPDATE "Disposition"
SET "isSystem" = false
WHERE "isSystem" IS NULL;

UPDATE "User"
SET "sessionVersion" = 0
WHERE "sessionVersion" IS NULL;

ALTER TABLE "CampaignScoringSettings"
  ALTER COLUMN "fatalZeroesScore" SET DEFAULT false,
  ALTER COLUMN "fatalZeroesScore" SET NOT NULL,
  ALTER COLUMN "customerCeaTarget" SET DEFAULT 95,
  ALTER COLUMN "customerCeaTarget" SET NOT NULL,
  ALTER COLUMN "businessCeaTarget" SET DEFAULT 90,
  ALTER COLUMN "businessCeaTarget" SET NOT NULL,
  ALTER COLUMN "complianceCeaTarget" SET DEFAULT 99.5,
  ALTER COLUMN "complianceCeaTarget" SET NOT NULL;

ALTER TABLE "Disposition"
  ALTER COLUMN "isSystem" SET DEFAULT false,
  ALTER COLUMN "isSystem" SET NOT NULL;

ALTER TABLE "User"
  ALTER COLUMN "sessionVersion" SET DEFAULT 0,
  ALTER COLUMN "sessionVersion" SET NOT NULL;

COMMIT;
