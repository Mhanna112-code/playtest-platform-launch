-- Batch 15 section 41 (C1, M2): every payment remembers the press it came from; (kind, payKey) and (kind, pressKey) are unique, so two presses at once can never
-- both reserve or charge.
ALTER TABLE "Payment" ADD COLUMN "pressKey" TEXT;

-- (Only an interrupted press's key could repeat before this: keep it on the newest row.)
UPDATE "Payment" p SET "payKey" = NULL
WHERE "payKey" IS NOT NULL AND EXISTS (SELECT 1 FROM "Payment" q WHERE q."kind" = p."kind" AND q."payKey" = p."payKey" AND (q."createdAt", q."id") > (p."createdAt", p."id"));

CREATE UNIQUE INDEX "Payment_kind_payKey_key" ON "Payment"("kind", "payKey");
CREATE UNIQUE INDEX "Payment_kind_pressKey_key" ON "Payment"("kind", "pressKey");

-- M4: an outage longer than 24 hours waits for an admin's approval before it moves anything.
ALTER TABLE "Outage" ADD COLUMN "needsApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "approvedById" TEXT;

-- L3: Stripe webhook events already handled.
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);
