-- CreateEnum
CREATE TYPE "QaActivityType" AS ENUM ('EVALUATION', 'COACHING_PREPARATION', 'COACHING_LIVE', 'COACHING_DOCUMENTATION', 'CALIBRATION', 'DISPUTE_REVIEW', 'TRAINING', 'MEETING', 'ADMINISTRATIVE', 'SYSTEM_ISSUE', 'OTHER');

-- CreateEnum
CREATE TYPE "QaActivityStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CoachingStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'AWAITING_ACKNOWLEDGEMENT', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CoachingSource" AS ENUM ('MANUAL', 'EVALUATION', 'TREND', 'CRITICAL_FAILURE', 'CALIBRATION', 'PIP_REVIEW', 'OTHER');

-- CreateEnum
CREATE TYPE "AcknowledgementStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'REFUSED');

-- CreateEnum
CREATE TYPE "AcknowledgementMethod" AS ENUM ('IN_PERSON', 'SECURE_LINK', 'EMAIL', 'COMPANY_SYSTEM', 'WITNESSED');

-- CreateEnum
CREATE TYPE "CoachingActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PipStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'ON_HOLD', 'EXTENDED', 'COMPLETED_SUCCESSFULLY', 'COMPLETED_UNSUCCESSFULLY', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PipGoalStatus" AS ENUM ('PENDING', 'ON_TRACK', 'AT_RISK', 'MET', 'NOT_MET', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "PipReviewOutcome" AS ENUM ('ON_TRACK', 'AT_RISK', 'IMPROVED', 'NO_PROGRESS');

-- AlterTable
ALTER TABLE "UserCampaign" ADD COLUMN     "canManageCoaching" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canManagePips" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canTrackQaActivity" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "canViewCoaching" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "canViewPips" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canViewQaActivity" BOOLEAN NOT NULL DEFAULT false;

-- Preserve least privilege while giving existing campaign roles their expected
-- Performance Management capabilities.
UPDATE "UserCampaign"
SET
    "canManageCoaching" = "roleInCampaign" IN ('CAMPAIGN_ADMIN', 'EVALUATOR'),
    "canTrackQaActivity" = "roleInCampaign" IN ('CAMPAIGN_ADMIN', 'EVALUATOR'),
    "canViewQaActivity" = "roleInCampaign" = 'CAMPAIGN_ADMIN',
    "canViewPips" = "roleInCampaign" IN ('CAMPAIGN_ADMIN', 'SUPERVISOR'),
    "canManagePips" = "roleInCampaign" = 'CAMPAIGN_ADMIN';

-- CreateTable
CREATE TABLE "CoachingSession" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "responseId" TEXT,
    "interactionId" TEXT,
    "pipPlanId" TEXT,
    "title" TEXT NOT NULL,
    "focusArea" TEXT NOT NULL,
    "behavior" TEXT,
    "objective" TEXT NOT NULL,
    "strengths" TEXT,
    "opportunities" TEXT,
    "rootCause" TEXT,
    "comments" TEXT,
    "source" "CoachingSource" NOT NULL DEFAULT 'MANUAL',
    "status" "CoachingStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "acknowledgementDueAt" TIMESTAMP(3),
    "followUpAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachingActionItem" (
    "id" TEXT NOT NULL,
    "coachingSessionId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL DEFAULT 'AGENT',
    "ownerName" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" "CoachingActionStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "evidenceNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachingActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachingAcknowledgement" (
    "id" TEXT NOT NULL,
    "coachingSessionId" TEXT NOT NULL,
    "status" "AcknowledgementStatus" NOT NULL DEFAULT 'PENDING',
    "method" "AcknowledgementMethod",
    "agentNameSnapshot" TEXT NOT NULL,
    "comment" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "refusedAt" TIMESTAMP(3),
    "witnessUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachingAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaActivitySession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "responseId" TEXT,
    "coachingSessionId" TEXT,
    "pipPlanId" TEXT,
    "activityType" "QaActivityType" NOT NULL,
    "status" "QaActivityStatus" NOT NULL DEFAULT 'ACTIVE',
    "label" TEXT,
    "notes" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "totalSeconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QaActivitySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaActivityInterval" (
    "id" TEXT NOT NULL,
    "activitySessionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "stopReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QaActivityInterval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipPlan" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "acknowledgementWitnessId" TEXT,
    "title" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "baselineSummary" TEXT,
    "supportSummary" TEXT,
    "consequences" TEXT,
    "employeeComments" TEXT,
    "reviewFrequency" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "targetEndDate" TIMESTAMP(3) NOT NULL,
    "midpointDate" TIMESTAMP(3),
    "finalReviewDate" TIMESTAMP(3),
    "status" "PipStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "acknowledgementStatus" "AcknowledgementStatus" NOT NULL DEFAULT 'PENDING',
    "acknowledgementMethod" "AcknowledgementMethod",
    "acknowledgementComment" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "refusedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "closureSummary" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipGoal" (
    "id" TEXT NOT NULL,
    "pipPlanId" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "baseline" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "measurementPeriod" TEXT,
    "dataSource" TEXT NOT NULL,
    "measurementMethod" TEXT,
    "sustainabilityPeriod" TEXT,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "currentResult" TEXT,
    "status" "PipGoalStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipReview" (
    "id" TEXT NOT NULL,
    "pipPlanId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "outcome" "PipReviewOutcome",
    "summary" TEXT,
    "metricsSnapshot" JSONB,
    "barriers" TEXT,
    "supportProvided" TEXT,
    "nextSteps" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoachingSession_campaignId_status_createdAt_idx" ON "CoachingSession"("campaignId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CoachingSession_agentId_status_createdAt_idx" ON "CoachingSession"("agentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CoachingSession_coachId_status_createdAt_idx" ON "CoachingSession"("coachId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CoachingSession_responseId_idx" ON "CoachingSession"("responseId");

-- CreateIndex
CREATE INDEX "CoachingSession_interactionId_idx" ON "CoachingSession"("interactionId");

-- CreateIndex
CREATE INDEX "CoachingSession_pipPlanId_idx" ON "CoachingSession"("pipPlanId");

-- CreateIndex
CREATE INDEX "CoachingActionItem_coachingSessionId_status_dueAt_idx" ON "CoachingActionItem"("coachingSessionId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoachingAcknowledgement_coachingSessionId_key" ON "CoachingAcknowledgement"("coachingSessionId");

-- CreateIndex
CREATE INDEX "CoachingAcknowledgement_status_updatedAt_idx" ON "CoachingAcknowledgement"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "CoachingAcknowledgement_witnessUserId_idx" ON "CoachingAcknowledgement"("witnessUserId");

-- CreateIndex
CREATE INDEX "QaActivitySession_userId_status_startedAt_idx" ON "QaActivitySession"("userId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "QaActivitySession_campaignId_startedAt_idx" ON "QaActivitySession"("campaignId", "startedAt");

-- CreateIndex
CREATE INDEX "QaActivitySession_responseId_idx" ON "QaActivitySession"("responseId");

-- CreateIndex
CREATE INDEX "QaActivitySession_coachingSessionId_idx" ON "QaActivitySession"("coachingSessionId");

-- CreateIndex
CREATE INDEX "QaActivitySession_pipPlanId_idx" ON "QaActivitySession"("pipPlanId");

-- A QA may have only one running timer, and a timer may have only one open
-- interval. Paused timers remain resumable without blocking a new interval.
CREATE UNIQUE INDEX "QaActivitySession_one_active_per_user_key"
ON "QaActivitySession"("userId")
WHERE "status" = 'ACTIVE';

-- CreateIndex
CREATE INDEX "QaActivityInterval_activitySessionId_startedAt_idx" ON "QaActivityInterval"("activitySessionId", "startedAt");

CREATE UNIQUE INDEX "QaActivityInterval_one_open_per_session_key"
ON "QaActivityInterval"("activitySessionId")
WHERE "endedAt" IS NULL;

ALTER TABLE "QaActivitySession"
ADD CONSTRAINT "QaActivitySession_total_seconds_nonnegative_check"
CHECK ("totalSeconds" >= 0);

ALTER TABLE "QaActivityInterval"
ADD CONSTRAINT "QaActivityInterval_duration_nonnegative_check"
CHECK (
    "durationSeconds" >= 0
    AND ("endedAt" IS NULL OR "endedAt" >= "startedAt")
);

ALTER TABLE "CoachingSession"
ADD CONSTRAINT "CoachingSession_time_order_check"
CHECK (
    ("endedAt" IS NULL OR "startedAt" IS NULL OR "endedAt" >= "startedAt")
    AND ("closedAt" IS NULL OR "endedAt" IS NULL OR "closedAt" >= "endedAt")
);

ALTER TABLE "PipPlan"
ADD CONSTRAINT "PipPlan_date_order_check"
CHECK (
    "targetEndDate" > "startDate"
    AND ("midpointDate" IS NULL OR ("midpointDate" >= "startDate" AND "midpointDate" <= "targetEndDate"))
    AND ("finalReviewDate" IS NULL OR "finalReviewDate" >= "startDate")
);

-- CreateIndex
CREATE INDEX "PipPlan_campaignId_status_createdAt_idx" ON "PipPlan"("campaignId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PipPlan_agentId_status_createdAt_idx" ON "PipPlan"("agentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PipPlan_ownerId_status_idx" ON "PipPlan"("ownerId", "status");

-- CreateIndex
CREATE INDEX "PipPlan_approvedById_idx" ON "PipPlan"("approvedById");

-- CreateIndex
CREATE INDEX "PipPlan_acknowledgementWitnessId_idx" ON "PipPlan"("acknowledgementWitnessId");

-- CreateIndex
CREATE INDEX "PipGoal_pipPlanId_status_idx" ON "PipGoal"("pipPlanId", "status");

-- CreateIndex
CREATE INDEX "PipReview_pipPlanId_scheduledAt_idx" ON "PipReview"("pipPlanId", "scheduledAt");

-- CreateIndex
CREATE INDEX "PipReview_reviewerId_scheduledAt_idx" ON "PipReview"("reviewerId", "scheduledAt");

-- AddForeignKey
ALTER TABLE "CoachingSession" ADD CONSTRAINT "CoachingSession_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingSession" ADD CONSTRAINT "CoachingSession_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingSession" ADD CONSTRAINT "CoachingSession_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingSession" ADD CONSTRAINT "CoachingSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingSession" ADD CONSTRAINT "CoachingSession_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "Response"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingSession" ADD CONSTRAINT "CoachingSession_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingSession" ADD CONSTRAINT "CoachingSession_pipPlanId_fkey" FOREIGN KEY ("pipPlanId") REFERENCES "PipPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingActionItem" ADD CONSTRAINT "CoachingActionItem_coachingSessionId_fkey" FOREIGN KEY ("coachingSessionId") REFERENCES "CoachingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingAcknowledgement" ADD CONSTRAINT "CoachingAcknowledgement_coachingSessionId_fkey" FOREIGN KEY ("coachingSessionId") REFERENCES "CoachingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingAcknowledgement" ADD CONSTRAINT "CoachingAcknowledgement_witnessUserId_fkey" FOREIGN KEY ("witnessUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaActivitySession" ADD CONSTRAINT "QaActivitySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaActivitySession" ADD CONSTRAINT "QaActivitySession_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaActivitySession" ADD CONSTRAINT "QaActivitySession_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "Response"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaActivitySession" ADD CONSTRAINT "QaActivitySession_coachingSessionId_fkey" FOREIGN KEY ("coachingSessionId") REFERENCES "CoachingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaActivitySession" ADD CONSTRAINT "QaActivitySession_pipPlanId_fkey" FOREIGN KEY ("pipPlanId") REFERENCES "PipPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaActivityInterval" ADD CONSTRAINT "QaActivityInterval_activitySessionId_fkey" FOREIGN KEY ("activitySessionId") REFERENCES "QaActivitySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipPlan" ADD CONSTRAINT "PipPlan_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipPlan" ADD CONSTRAINT "PipPlan_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipPlan" ADD CONSTRAINT "PipPlan_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipPlan" ADD CONSTRAINT "PipPlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipPlan" ADD CONSTRAINT "PipPlan_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipPlan" ADD CONSTRAINT "PipPlan_acknowledgementWitnessId_fkey" FOREIGN KEY ("acknowledgementWitnessId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipGoal" ADD CONSTRAINT "PipGoal_pipPlanId_fkey" FOREIGN KEY ("pipPlanId") REFERENCES "PipPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipReview" ADD CONSTRAINT "PipReview_pipPlanId_fkey" FOREIGN KEY ("pipPlanId") REFERENCES "PipPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipReview" ADD CONSTRAINT "PipReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
