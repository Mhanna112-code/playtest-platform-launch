-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "contractId" TEXT,
ADD COLUMN     "stripeTransferId" TEXT,
ADD COLUMN     "transferStatus" TEXT NOT NULL DEFAULT 'none';

