-- CreateTable
CREATE TABLE "CampaignScoringSettings" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "usesGlobalDefaults" BOOLEAN NOT NULL DEFAULT true,
    "passThreshold" INTEGER NOT NULL DEFAULT 70,
    "targetPassRate" INTEGER NOT NULL DEFAULT 85,
    "targetAvgScore" INTEGER NOT NULL DEFAULT 80,
    "targetDailyRate" INTEGER NOT NULL DEFAULT 20,
    "fatalFailuresAllowed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "CampaignScoringSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignScoringSettings_campaignId_key" ON "CampaignScoringSettings"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignScoringSettings_campaignId_idx" ON "CampaignScoringSettings"("campaignId");

-- AddForeignKey
ALTER TABLE "CampaignScoringSettings" ADD CONSTRAINT "CampaignScoringSettings_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
