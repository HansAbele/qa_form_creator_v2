BEGIN;

CREATE TABLE "LoginRateLimitReservation" (
    "id" UUID NOT NULL,
    "accountKeyHash" VARCHAR(64) NOT NULL,
    "ipKeyHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginRateLimitReservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LoginRateLimitReservation_accountKeyHash_fkey"
      FOREIGN KEY ("accountKeyHash") REFERENCES "LoginRateLimit"("keyHash")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LoginRateLimitReservation_ipKeyHash_fkey"
      FOREIGN KEY ("ipKeyHash") REFERENCES "LoginRateLimit"("keyHash")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "LoginRateLimitReservation_accountKeyHash_expiresAt_idx"
  ON "LoginRateLimitReservation"("accountKeyHash", "expiresAt");
CREATE INDEX "LoginRateLimitReservation_ipKeyHash_expiresAt_idx"
  ON "LoginRateLimitReservation"("ipKeyHash", "expiresAt");
CREATE INDEX "LoginRateLimitReservation_expiresAt_idx"
  ON "LoginRateLimitReservation"("expiresAt");

COMMIT;
