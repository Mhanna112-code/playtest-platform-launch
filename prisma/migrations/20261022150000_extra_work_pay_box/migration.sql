-- AlterTable
ALTER TABLE "Call" DROP COLUMN "lengthAt",
DROP COLUMN "lengthMinutes",
DROP COLUMN "lengthReason",
ALTER COLUMN "rateCents" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Dispute" ADD COLUMN     "callId" TEXT,
ADD COLUMN     "contractId" TEXT NOT NULL,
ALTER COLUMN "submissionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "callId" TEXT,
ADD COLUMN     "contractId" TEXT NOT NULL,
ADD COLUMN     "payKey" TEXT NOT NULL,
ALTER COLUMN "submissionId" DROP NOT NULL,
ALTER COLUMN "agreedCents" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "late" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "agreedCents" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "openUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TestEvent" ADD COLUMN     "contractId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_callId_key" ON "Dispute"("callId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_callId_key" ON "Review"("callId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_payKey_key" ON "Review"("payKey");

-- CreateIndex
CREATE INDEX "Review_contractId_idx" ON "Review"("contractId");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

