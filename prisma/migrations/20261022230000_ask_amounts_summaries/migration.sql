-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "askedCents" INTEGER;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "askedCents" INTEGER,
ADD COLUMN     "remindedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastSummaryAt" TIMESTAMP(3);

UPDATE "User" SET "emailPref" = 'off' WHERE "emailPref" = 'none';
