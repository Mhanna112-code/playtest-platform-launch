-- AlterTable
ALTER TABLE "CallRequest" ADD COLUMN     "rows" JSONB;

-- CreateTable
CREATE TABLE "CallSet" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "repeat" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "minutes" INTEGER NOT NULL,
    "rateCents" INTEGER,
    "nextAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CallSet_contractId_status_idx" ON "CallSet"("contractId", "status");

-- AddForeignKey
ALTER TABLE "CallSet" ADD CONSTRAINT "CallSet_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
