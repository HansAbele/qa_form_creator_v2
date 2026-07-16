BEGIN;

CREATE TABLE "LoginRateLimit" (
    "keyHash" VARCHAR(64) NOT NULL,
    "scope" VARCHAR(16) NOT NULL,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "lastFailureAt" TIMESTAMP(3) NOT NULL,
    "blockedUntil" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginRateLimit_pkey" PRIMARY KEY ("keyHash"),
    CONSTRAINT "LoginRateLimit_scope_check" CHECK ("scope" IN ('account', 'ip')),
    CONSTRAINT "LoginRateLimit_failure_count_check" CHECK ("failureCount" >= 0)
);

CREATE INDEX "LoginRateLimit_blockedUntil_idx" ON "LoginRateLimit"("blockedUntil");
CREATE INDEX "LoginRateLimit_expiresAt_idx" ON "LoginRateLimit"("expiresAt");

COMMIT;
