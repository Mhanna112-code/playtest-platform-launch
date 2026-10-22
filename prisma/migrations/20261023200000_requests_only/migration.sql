-- AlterTable
ALTER TABLE "CallRequest" ADD COLUMN     "askRateCents" INTEGER,
ADD COLUMN     "batchId" TEXT NOT NULL DEFAULT '';

