-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "testId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "testerId" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "contractId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Message_testId_testerId_createdAt_idx" ON "Message"("testId", "testerId", "createdAt");


-- Backfill the test and tester of existing messages
UPDATE "Message" m SET "testId" = c."testId", "testerId" = c."testerId" FROM "Contract" c WHERE m."contractId" = c.id;
