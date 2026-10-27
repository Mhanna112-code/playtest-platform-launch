-- (Owner, Oct 29, batch 11) A payment the bank wants the cardholder to confirm, the automatic retries during a hold, and attachments on the written part.
-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "actionBy" TIMESTAMP(3),
ADD COLUMN     "actionPi" TEXT;

-- AlterTable
ALTER TABLE "Recording" ADD COLUMN     "part" TEXT NOT NULL DEFAULT 'recording';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "holdRetries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "holdRetryAt" TIMESTAMP(3);
