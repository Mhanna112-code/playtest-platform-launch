-- AlterTable
ALTER TABLE "User" ADD COLUMN     "holdApprovedAt" TIMESTAMP(3),
ADD COLUMN     "holdCount" INTEGER NOT NULL DEFAULT 0;

-- Accounts on a hold right now are on their first (counted) hold.
UPDATE "User" SET "holdCount" = 1 WHERE "holdStartedAt" IS NOT NULL;

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reportedId" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_reportedId_idx" ON "Report"("reportedId");

-- CreateIndex
CREATE UNIQUE INDEX "Report_reporterId_reportedId_key" ON "Report"("reporterId", "reportedId");
