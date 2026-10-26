-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'apply';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "testId" TEXT;

-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "adminNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "adminPausedAt" TIMESTAMP(3),
ADD COLUMN     "adminStoppedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deleteReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedBy" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "payoutProblemAt" TIMESTAMP(3),
ADD COLUMN     "payoutRemindedAt" TIMESTAMP(3),
ADD COLUMN     "reinstatedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedById" TEXT;
