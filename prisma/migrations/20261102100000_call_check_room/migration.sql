-- (Batch 18 section 13) Each account's private Jitsi practice room id ("Check your call setup"), random and made on first use.
ALTER TABLE "User" ADD COLUMN "callCheckId" TEXT;
CREATE UNIQUE INDEX "User_callCheckId_key" ON "User"("callCheckId");
