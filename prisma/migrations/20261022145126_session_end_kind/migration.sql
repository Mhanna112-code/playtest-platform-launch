-- AlterTable
ALTER TABLE "CallSlot" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Contract" DROP COLUMN "sendUntil",
ADD COLUMN     "endKind" TEXT NOT NULL DEFAULT '';

