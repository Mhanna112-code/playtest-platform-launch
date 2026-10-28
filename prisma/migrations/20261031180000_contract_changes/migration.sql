-- Batch 15 sections 24 and 43: the developer's Contract changes (one entry per Save that changed terms or names) and renames in each tester's contract changes.
ALTER TABLE "TermsOffer" ADD COLUMN "changeId" TEXT;

CREATE TABLE "TestChange" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "fields" TEXT[],
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "effects" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TestChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TestChange_testId_createdAt_idx" ON "TestChange"("testId", "createdAt");

CREATE TABLE "ContractNote" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContractNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ContractNote_contractId_createdAt_idx" ON "ContractNote"("contractId", "createdAt");
