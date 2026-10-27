-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "removedDismissedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "repaysId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "reminderKey" TEXT;

-- CreateTable
CREATE TABLE "ContactMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactMessage_userId_createdAt_idx" ON "ContactMessage"("userId", "createdAt");
