-- CreateTable
CREATE TABLE "CallRequest" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "fromSide" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "closedReason" TEXT NOT NULL DEFAULT '',
    "callId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CallRequest_contractId_status_idx" ON "CallRequest"("contractId", "status");

