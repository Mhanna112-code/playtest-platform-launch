-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "devRatePromptedAt" TIMESTAMP(3),
ADD COLUMN     "ratePromptedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "raterId" TEXT NOT NULL,
    "rateeId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Rating_rateeId_idx" ON "Rating"("rateeId");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_contractId_side_key" ON "Rating"("contractId", "side");

