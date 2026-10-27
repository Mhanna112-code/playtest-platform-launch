-- (Owner, Oct 28 night, batch 9) A note on extra pay, the rate typed on a call's Pay, and one 7-day clock per paused test.
-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "note" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "rateCents" INTEGER;

-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "pausedSince" TIMESTAMP(3);

-- Tests paused right now start their one clock at the earliest cause still on.
UPDATE "Test" t SET "pausedSince" = LEAST(t."adminPausedAt", u."holdStartedAt", u."suspendedAt")
FROM "User" u
WHERE u.id = t."developerId" AND t.status IN ('open', 'closed')
  AND (t."adminPausedAt" IS NOT NULL OR u."holdStartedAt" IS NOT NULL OR u."suspendedAt" IS NOT NULL);
