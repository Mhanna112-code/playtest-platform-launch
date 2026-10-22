-- DropIndex
DROP INDEX "Invite_testId_testerId_key";

-- CreateIndex
CREATE INDEX "Invite_testId_testerId_idx" ON "Invite"("testId", "testerId");

