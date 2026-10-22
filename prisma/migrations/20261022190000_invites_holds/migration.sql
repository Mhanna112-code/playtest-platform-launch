-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "chargeback" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "owedUntil" TIMESTAMP(3),
ADD COLUMN     "settledAt" TIMESTAMP(3),
ADD COLUMN     "stripeChargeId" TEXT;

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "auto" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "payBy" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "notified1d" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notified3d" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "holdAlertedAt" TIMESTAMP(3),
ADD COLUMN     "holdReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "holdStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "testerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invite_testId_testerId_key" ON "Invite"("testId", "testerId");

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

