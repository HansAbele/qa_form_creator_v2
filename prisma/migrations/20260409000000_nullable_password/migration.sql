-- AlterTable: make password nullable to support Microsoft OAuth (passwordless SSO)
ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;
