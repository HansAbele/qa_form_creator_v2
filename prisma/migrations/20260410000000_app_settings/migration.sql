-- CreateTable: AppSetting (global key/value settings)
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- Seed default scoring settings (idempotent via ON CONFLICT)
INSERT INTO "AppSetting" ("key", "value", "updatedAt") VALUES
    ('passThreshold',     '70'::jsonb, NOW()),
    ('targetPassRate',    '85'::jsonb, NOW()),
    ('targetAvgScore',    '80'::jsonb, NOW()),
    ('targetDailyRate',   '20'::jsonb, NOW())
ON CONFLICT ("key") DO NOTHING;
