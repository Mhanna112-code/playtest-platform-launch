-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "joinMode" TEXT NOT NULL DEFAULT 'anyone';

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "testerId" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "listing" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "changedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Application_testId_testerId_key" ON "Application"("testId", "testerId");

