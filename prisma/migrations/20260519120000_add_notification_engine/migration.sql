-- Persistent in-app notification engine with per-user delivery preferences.

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "campaignId" TEXT,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'INFO',
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "href" TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  "metadata" JSONB,
  "readAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPreference" (
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "inApp" BOOLEAN NOT NULL DEFAULT true,
  "email" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId", "type")
);

CREATE INDEX "Notification_userId_readAt_createdAt_idx"
  ON "Notification"("userId", "readAt", "createdAt");

CREATE INDEX "Notification_userId_archivedAt_createdAt_idx"
  ON "Notification"("userId", "archivedAt", "createdAt");

CREATE INDEX "Notification_campaignId_createdAt_idx"
  ON "Notification"("campaignId", "createdAt");

CREATE INDEX "Notification_type_createdAt_idx"
  ON "Notification"("type", "createdAt");

CREATE INDEX "Notification_entityType_entityId_idx"
  ON "Notification"("entityType", "entityId");

CREATE INDEX "NotificationPreference_type_idx"
  ON "NotificationPreference"("type");

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference"
  ADD CONSTRAINT "NotificationPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
