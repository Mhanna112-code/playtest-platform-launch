-- (Batch 35 §117) Pay what you owe is ONE payment: each debt it covers points to it.
ALTER TABLE "Payment" ADD COLUMN "coveredById" TEXT;
CREATE INDEX "Payment_coveredById_idx" ON "Payment"("coveredById");
