-- (Batch 23 section 1) Every email is stored first and retried by the 5-minute sweep (pending / sent / failed for good, kept).
-- (Batch 23 section 6) A chargeback hold's Pay what you owe reserves the owed total on the card; the team's Approve captures it.
CREATE TABLE "EmailQueue" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "html" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "errorKind" TEXT NOT NULL DEFAULT '',
    "nextTryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "giveUpAt" TIMESTAMP(3) NOT NULL,
    "lastTriedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "clearedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailQueue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "developerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "covers" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "stripePaymentIntentId" TEXT,
    "actionBy" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailQueue_status_nextTryAt_idx" ON "EmailQueue"("status", "nextTryAt");

CREATE INDEX "Reservation_developerId_status_idx" ON "Reservation"("developerId", "status");

