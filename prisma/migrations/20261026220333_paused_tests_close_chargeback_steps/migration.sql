-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "pauseCloseAt" TIMESTAMP(3),
ADD COLUMN     "pauseCloseSetAt" TIMESTAMP(3),
ADD COLUMN     "pauseClosedAt" TIMESTAMP(3),
ADD COLUMN     "pauseClosedReason" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "chargebackApprovedAt" TIMESTAMP(3),
ADD COLUMN     "chargebackCardVerifiedAt" TIMESTAMP(3);
