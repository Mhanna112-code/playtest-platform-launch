-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "ndaAcceptedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "ndaAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "ndaText" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "TermsOffer" ADD COLUMN     "fromNdaText" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "fromQuestions" JSONB,
ADD COLUMN     "ndaText" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "criticalChanges" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mature" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "matureWhy" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "ndaText" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "productName" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "AccessKey" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'free',
    "contractId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "brokenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessKey_testId_status_idx" ON "AccessKey"("testId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AccessKey_testId_value_key" ON "AccessKey"("testId", "value");

-- AddForeignKey
ALTER TABLE "AccessKey" ADD CONSTRAINT "AccessKey_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessKey" ADD CONSTRAINT "AccessKey_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
