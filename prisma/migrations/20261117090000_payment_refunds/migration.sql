-- (Owner, Nov 4, batch 35 §192) Refunds to a developer for a reversed payment they had already repaid (the bank lowered what it took back after the repayment,
-- or the platform won the chargeback): each is its own negative line in "What you've paid", under the payment it refunds. Additive: a new table, nothing else
-- changes (refunds made before §192 are read from their refunded repayments).
CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "reversalId" TEXT NOT NULL,
    "developerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "fromCents" INTEGER,
    "toCents" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "stripeRefundId" TEXT,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentRefund_key_key" ON "PaymentRefund"("key");
CREATE INDEX "PaymentRefund_developerId_idx" ON "PaymentRefund"("developerId");
CREATE INDEX "PaymentRefund_reversalId_idx" ON "PaymentRefund"("reversalId");
CREATE INDEX "PaymentRefund_paymentId_idx" ON "PaymentRefund"("paymentId");
