-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "termsSwitchedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TermsOffer" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "listingVersion" INTEGER NOT NULL,
    "writtenCents" INTEGER,
    "recordingCents" INTEGER,
    "liveRateCents" INTEGER,
    "liveMinutes" INTEGER,
    "deadlineDays" INTEGER NOT NULL,
    "questions" JSONB NOT NULL,
    "diff" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TermsOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TermsOffer_contractId_createdAt_idx" ON "TermsOffer"("contractId", "createdAt");

