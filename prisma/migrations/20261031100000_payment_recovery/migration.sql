-- Batch 15 section 9: payments stuck "pending" are found by their press id and finished or cleared.
ALTER TABLE "Payment" ADD COLUMN "payKey" TEXT,
ADD COLUMN "checkedAt" TIMESTAMP(3);

CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");
