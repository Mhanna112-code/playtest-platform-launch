-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "groupKey" TEXT,
ADD COLUMN     "payment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "emailPref" SET DEFAULT 'daily';

-- Email "each notification" is gone: those people get the daily email.
UPDATE "User" SET "emailPref" = 'daily' WHERE "emailPref" = 'each';
