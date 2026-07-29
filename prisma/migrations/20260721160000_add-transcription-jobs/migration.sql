-- CreateEnum
CREATE TYPE "TranscriptionJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "TranscriptionJob" (
    "id" TEXT NOT NULL,
    "interactionId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "transcriptId" TEXT,
    "requestedById" TEXT,
    "status" "TranscriptionJobStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranscriptionJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TranscriptionJob_attempt_count_check" CHECK ("attemptCount" >= 0),
    CONSTRAINT "TranscriptionJob_max_attempts_check" CHECK ("maxAttempts" BETWEEN 1 AND 10)
);

-- CreateIndex
CREATE INDEX "TranscriptionJob_status_runAfter_createdAt_idx"
ON "TranscriptionJob"("status", "runAfter", "createdAt");

-- CreateIndex
CREATE INDEX "TranscriptionJob_interactionId_createdAt_idx"
ON "TranscriptionJob"("interactionId", "createdAt");

-- CreateIndex
CREATE INDEX "TranscriptionJob_mediaAssetId_createdAt_idx"
ON "TranscriptionJob"("mediaAssetId", "createdAt");

-- A recording may only have one active queue item, while completed and failed
-- history remains available for operations and audit.
CREATE UNIQUE INDEX "TranscriptionJob_one_active_per_media_idx"
ON "TranscriptionJob"("mediaAssetId")
WHERE "status" IN ('PENDING', 'PROCESSING');

-- AddForeignKey
ALTER TABLE "TranscriptionJob"
ADD CONSTRAINT "TranscriptionJob_interactionId_fkey"
FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptionJob"
ADD CONSTRAINT "TranscriptionJob_mediaAssetId_fkey"
FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptionJob"
ADD CONSTRAINT "TranscriptionJob_transcriptId_fkey"
FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE SET NULL ON UPDATE CASCADE;
