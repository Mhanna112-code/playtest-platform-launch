-- AlterTable
ALTER TABLE "Dispute" ADD COLUMN     "devSide" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "devSideAt" TIMESTAMP(3);

