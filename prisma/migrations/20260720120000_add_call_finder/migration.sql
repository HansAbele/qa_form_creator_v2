-- Call Finder foundation: provider-scoped interactions, local media metadata,
-- diarized transcripts, provider attempts, and one optional call per evaluation.

CREATE TYPE "InteractionProvider" AS ENUM ('NICE_CXONE', 'VICIDIAL');
CREATE TYPE "InteractionDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'UNKNOWN');
CREATE TYPE "MediaAssetKind" AS ENUM ('ORIGINAL', 'PLAYBACK');
CREATE TYPE "TranscriptProvider" AS ENUM ('NICE_CXONE', 'NVIDIA_NIM', 'GROQ', 'OPENAI');
CREATE TYPE "TranscriptionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'SPEAKERS_UNVERIFIED');
CREATE TYPE "SpeakerRole" AS ENUM ('AGENT', 'CUSTOMER', 'UNKNOWN');

ALTER TABLE "Response" ADD COLUMN "interactionId" TEXT;

CREATE TABLE "CampaignCallSource" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "provider" "InteractionProvider" NOT NULL,
    "instanceKey" TEXT NOT NULL DEFAULT 'default',
    "externalCampaignIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CampaignCallSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "agentId" TEXT,
    "dispositionId" TEXT,
    "provider" "InteractionProvider" NOT NULL,
    "providerInstance" TEXT NOT NULL DEFAULT 'default',
    "providerInteractionId" TEXT NOT NULL,
    "providerAgentId" TEXT,
    "providerCampaignId" TEXT,
    "direction" "InteractionDirection" NOT NULL DEFAULT 'UNKNOWN',
    "phoneNumber" TEXT,
    "queueName" TEXT,
    "status" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "hasRecording" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Interaction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Interaction_duration_nonnegative_check" CHECK ("durationSeconds" >= 0),
    CONSTRAINT "Interaction_time_order_check" CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt")
);

CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "interactionId" TEXT NOT NULL,
    "kind" "MediaAssetKind" NOT NULL DEFAULT 'ORIGINAL',
    "storageKey" TEXT NOT NULL,
    "originalFileName" TEXT,
    "mimeType" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "durationMs" INTEGER,
    "channelCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MediaAsset_sizes_nonnegative_check" CHECK (
      "byteSize" >= 0 AND ("durationMs" IS NULL OR "durationMs" >= 0)
    ),
    CONSTRAINT "MediaAsset_channel_count_check" CHECK ("channelCount" IS NULL OR "channelCount" > 0),
    CONSTRAINT "MediaAsset_sha256_format_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "Transcript" (
    "id" TEXT NOT NULL,
    "interactionId" TEXT NOT NULL,
    "mediaAssetId" TEXT,
    "provider" "TranscriptProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "language" TEXT,
    "status" "TranscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "jobFingerprint" VARCHAR(64) NOT NULL,
    "fullText" TEXT,
    "isDiarized" BOOLEAN NOT NULL DEFAULT false,
    "speakerCount" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Transcript_fingerprint_format_check" CHECK ("jobFingerprint" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "Transcript_speaker_count_check" CHECK ("speakerCount" IS NULL OR "speakerCount" >= 0),
    CONSTRAINT "Transcript_time_order_check" CHECK (
      "completedAt" IS NULL OR "startedAt" IS NULL OR "completedAt" >= "startedAt"
    )
);

CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "speakerKey" TEXT,
    "speakerRole" "SpeakerRole" NOT NULL DEFAULT 'UNKNOWN',
    "text" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TranscriptSegment_time_order_check" CHECK (
      "ordinal" >= 0 AND "startMs" >= 0 AND "endMs" >= "startMs"
    ),
    CONSTRAINT "TranscriptSegment_confidence_check" CHECK (
      "confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)
    )
);

CREATE TABLE "TranscriptionAttempt" (
    "id" TEXT NOT NULL,
    "interactionId" TEXT NOT NULL,
    "mediaAssetId" TEXT,
    "transcriptId" TEXT,
    "provider" "TranscriptProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "status" "TranscriptionStatus" NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "TranscriptionAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TranscriptionAttempt_number_check" CHECK ("attemptNumber" > 0),
    CONSTRAINT "TranscriptionAttempt_time_order_check" CHECK (
      "completedAt" IS NULL OR "completedAt" >= "startedAt"
    )
);

CREATE INDEX "CampaignCallSource_provider_instanceKey_enabled_idx" ON "CampaignCallSource"("provider", "instanceKey", "enabled");
CREATE UNIQUE INDEX "CampaignCallSource_campaignId_provider_instanceKey_key" ON "CampaignCallSource"("campaignId", "provider", "instanceKey");
CREATE INDEX "Interaction_campaignId_startedAt_idx" ON "Interaction"("campaignId", "startedAt");
CREATE INDEX "Interaction_agentId_startedAt_idx" ON "Interaction"("agentId", "startedAt");
CREATE INDEX "Interaction_dispositionId_startedAt_idx" ON "Interaction"("dispositionId", "startedAt");
CREATE INDEX "Interaction_phoneNumber_idx" ON "Interaction"("phoneNumber");
CREATE UNIQUE INDEX "Interaction_provider_providerInstance_providerInteractionId_key" ON "Interaction"("provider", "providerInstance", "providerInteractionId");
CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");
CREATE INDEX "MediaAsset_interactionId_kind_idx" ON "MediaAsset"("interactionId", "kind");
CREATE INDEX "MediaAsset_sha256_idx" ON "MediaAsset"("sha256");
CREATE INDEX "Transcript_interactionId_status_completedAt_idx" ON "Transcript"("interactionId", "status", "completedAt");
CREATE UNIQUE INDEX "Transcript_mediaAssetId_provider_model_jobFingerprint_key" ON "Transcript"("mediaAssetId", "provider", "model", "jobFingerprint");
CREATE INDEX "TranscriptSegment_transcriptId_startMs_idx" ON "TranscriptSegment"("transcriptId", "startMs");
CREATE UNIQUE INDEX "TranscriptSegment_transcriptId_ordinal_key" ON "TranscriptSegment"("transcriptId", "ordinal");
CREATE INDEX "TranscriptionAttempt_interactionId_startedAt_idx" ON "TranscriptionAttempt"("interactionId", "startedAt");
CREATE INDEX "TranscriptionAttempt_provider_status_startedAt_idx" ON "TranscriptionAttempt"("provider", "status", "startedAt");
CREATE UNIQUE INDEX "Response_interactionId_key" ON "Response"("interactionId");

ALTER TABLE "CampaignCallSource" ADD CONSTRAINT "CampaignCallSource_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_dispositionId_fkey" FOREIGN KEY ("dispositionId") REFERENCES "Disposition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Response" ADD CONSTRAINT "Response_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TranscriptionAttempt" ADD CONSTRAINT "TranscriptionAttempt_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TranscriptionAttempt" ADD CONSTRAINT "TranscriptionAttempt_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TranscriptionAttempt" ADD CONSTRAINT "TranscriptionAttempt_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Keep provider imports and evaluation links inside their campaign boundary,
-- including updates made outside the application ORM.
CREATE OR REPLACE FUNCTION qa_validate_call_finder_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'Interaction' THEN
    IF NEW."agentId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Agent" a
      WHERE a.id = NEW."agentId" AND a."campaignId" = NEW."campaignId"
    ) THEN RAISE EXCEPTION 'Interaction agent must belong to the same campaign'; END IF;

    IF NEW."dispositionId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Disposition" d
      WHERE d.id = NEW."dispositionId" AND d."campaignId" = NEW."campaignId"
    ) THEN RAISE EXCEPTION 'Interaction disposition must belong to the same campaign'; END IF;

    IF EXISTS (
      SELECT 1
      FROM "Response" r
      JOIN "Form" f ON f.id = r."formId"
      WHERE r."interactionId" = NEW.id
        AND (f."campaignId" <> NEW."campaignId"
          OR (NEW."agentId" IS NOT NULL AND r."agentId" <> NEW."agentId")
          OR (NEW."dispositionId" IS NOT NULL AND r."dispositionId" IS DISTINCT FROM NEW."dispositionId"))
    ) THEN RAISE EXCEPTION 'Interaction conflicts with its linked evaluation'; END IF;

  ELSIF TG_TABLE_NAME = 'Response' AND NEW."interactionId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "Interaction" i
      JOIN "Form" f ON f.id = NEW."formId"
      WHERE i.id = NEW."interactionId"
        AND i."campaignId" = f."campaignId"
        AND (i."agentId" IS NULL OR i."agentId" = NEW."agentId")
        AND (i."dispositionId" IS NULL OR i."dispositionId" = NEW."dispositionId")
    ) THEN RAISE EXCEPTION 'Response interaction must match its campaign, agent, and disposition'; END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER "Interaction_campaign_integrity"
AFTER INSERT OR UPDATE OF "campaignId", "agentId", "dispositionId" ON "Interaction"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_validate_call_finder_integrity();

CREATE CONSTRAINT TRIGGER "Response_interaction_integrity"
AFTER INSERT OR UPDATE OF "interactionId", "formId", "agentId", "dispositionId" ON "Response"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_validate_call_finder_integrity();

ALTER TABLE "Interaction" ENABLE ALWAYS TRIGGER "Interaction_campaign_integrity";
ALTER TABLE "Response" ENABLE ALWAYS TRIGGER "Response_interaction_integrity";
