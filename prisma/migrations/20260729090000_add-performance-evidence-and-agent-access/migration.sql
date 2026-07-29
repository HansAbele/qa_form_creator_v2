-- CreateEnum
CREATE TYPE "PerformanceEvidenceType" AS ENUM (
    'EVALUATION',
    'CALL_RECORDING',
    'TRANSCRIPT_EXCERPT',
    'METRIC',
    'DOCUMENT',
    'NOTE'
);

-- Extend the existing authorization enums without changing current users.
ALTER TYPE "CampaignAccessLevel" ADD VALUE 'AGENT';
ALTER TYPE "Role" ADD VALUE 'AGENT';

-- Link an authenticated portal account to at most one operational agent.
ALTER TABLE "Agent" ADD COLUMN "userId" TEXT;

-- CreateTable
CREATE TABLE "PerformanceEvidence" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "coachingSessionId" TEXT,
    "pipPlanId" TEXT,
    "responseId" TEXT,
    "interactionId" TEXT,
    "createdById" TEXT NOT NULL,
    "type" "PerformanceEvidenceType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startMs" INTEGER,
    "endMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceEvidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PerformanceEvidence_single_case_check"
      CHECK (num_nonnulls("coachingSessionId", "pipPlanId") = 1),
    CONSTRAINT "PerformanceEvidence_time_order_check"
      CHECK ("startMs" IS NULL OR "endMs" IS NULL OR "endMs" >= "startMs")
);

CREATE INDEX "PerformanceEvidence_campaignId_createdAt_idx"
ON "PerformanceEvidence"("campaignId", "createdAt");

CREATE INDEX "PerformanceEvidence_coachingSessionId_createdAt_idx"
ON "PerformanceEvidence"("coachingSessionId", "createdAt");

CREATE INDEX "PerformanceEvidence_pipPlanId_createdAt_idx"
ON "PerformanceEvidence"("pipPlanId", "createdAt");

CREATE INDEX "PerformanceEvidence_responseId_idx"
ON "PerformanceEvidence"("responseId");

CREATE INDEX "PerformanceEvidence_interactionId_idx"
ON "PerformanceEvidence"("interactionId");

CREATE INDEX "PerformanceEvidence_createdById_idx"
ON "PerformanceEvidence"("createdById");

CREATE UNIQUE INDEX "Agent_userId_key" ON "Agent"("userId");
CREATE INDEX "Agent_userId_idx" ON "Agent"("userId");

ALTER TABLE "Agent"
ADD CONSTRAINT "Agent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PerformanceEvidence"
ADD CONSTRAINT "PerformanceEvidence_campaignId_fkey"
FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PerformanceEvidence"
ADD CONSTRAINT "PerformanceEvidence_coachingSessionId_fkey"
FOREIGN KEY ("coachingSessionId") REFERENCES "CoachingSession"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PerformanceEvidence"
ADD CONSTRAINT "PerformanceEvidence_pipPlanId_fkey"
FOREIGN KEY ("pipPlanId") REFERENCES "PipPlan"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PerformanceEvidence"
ADD CONSTRAINT "PerformanceEvidence_responseId_fkey"
FOREIGN KEY ("responseId") REFERENCES "Response"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PerformanceEvidence"
ADD CONSTRAINT "PerformanceEvidence_interactionId_fkey"
FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PerformanceEvidence"
ADD CONSTRAINT "PerformanceEvidence_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve and expose the evidence already linked to historical coaching records.
INSERT INTO "PerformanceEvidence" (
    "id",
    "campaignId",
    "coachingSessionId",
    "responseId",
    "interactionId",
    "createdById",
    "type",
    "title",
    "description",
    "createdAt"
)
SELECT
    'legacy-coaching-evidence-' || coaching."id",
    coaching."campaignId",
    coaching."id",
    coaching."responseId",
    coaching."interactionId",
    coaching."createdById",
    'EVALUATION'::"PerformanceEvidenceType",
    'Linked evaluation',
    'Evidence migrated from the evaluation originally attached to this coaching session.',
    coaching."createdAt"
FROM "CoachingSession" coaching
WHERE coaching."responseId" IS NOT NULL;

INSERT INTO "PerformanceEvidence" (
    "id",
    "campaignId",
    "coachingSessionId",
    "interactionId",
    "createdById",
    "type",
    "title",
    "description",
    "createdAt"
)
SELECT
    'legacy-coaching-call-' || coaching."id",
    coaching."campaignId",
    coaching."id",
    coaching."interactionId",
    coaching."createdById",
    'CALL_RECORDING'::"PerformanceEvidenceType",
    'Linked call',
    'Call evidence migrated from the interaction originally attached to this coaching session.',
    coaching."createdAt"
FROM "CoachingSession" coaching
WHERE coaching."interactionId" IS NOT NULL
  AND coaching."responseId" IS NULL;
