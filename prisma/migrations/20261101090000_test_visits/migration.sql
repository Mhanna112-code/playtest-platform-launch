-- (Batch 17 §18) "Tests visited" on the tester dashboard: each test whose join page a tester opened while not in it, with the last visit.
CREATE TABLE "TestVisit" (
    "id" TEXT NOT NULL,
    "testerId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TestVisit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TestVisit_testerId_visitedAt_idx" ON "TestVisit"("testerId", "visitedAt");
CREATE INDEX "TestVisit_testId_idx" ON "TestVisit"("testId");
CREATE UNIQUE INDEX "TestVisit_testerId_testId_key" ON "TestVisit"("testerId", "testId");
ALTER TABLE "TestVisit" ADD CONSTRAINT "TestVisit_testerId_fkey" FOREIGN KEY ("testerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestVisit" ADD CONSTRAINT "TestVisit_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;
