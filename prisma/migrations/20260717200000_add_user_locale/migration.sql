ALTER TABLE "User"
ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';

ALTER TABLE "User"
ADD CONSTRAINT "User_locale_check" CHECK ("locale" IN ('en', 'es'));
