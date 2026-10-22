-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "pronoun" TEXT NOT NULL DEFAULT '',
    "isDeveloper" BOOLEAN NOT NULL DEFAULT false,
    "isTester" BOOLEAN NOT NULL DEFAULT false,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "suspendedAt" TIMESTAMP(3),
    "suspendNote" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stripeCustomerId" TEXT,
    "stripePaymentMethodId" TEXT,
    "stripeAccountId" TEXT,
    "payoutsReady" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TesterProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "devices" TEXT[],
    "categories" TEXT[],
    "languages" TEXT[],
    "bio" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TesterProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Test" (
    "id" TEXT NOT NULL,
    "developerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "buildUrl" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "devices" TEXT[],
    "languages" TEXT[],
    "spots" INTEGER NOT NULL,
    "writtenCents" INTEGER,
    "recordingCents" INTEGER,
    "liveRateCents" INTEGER,
    "liveMinutes" INTEGER,
    "deadlineDays" INTEGER NOT NULL,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'open',
    "round" INTEGER NOT NULL DEFAULT 1,
    "previousId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "listingVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "stoppedAt" TIMESTAMP(3),

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestEvent" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "version" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "testerId" TEXT NOT NULL,
    "listingVersion" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "buildUrl" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "writtenCents" INTEGER,
    "recordingCents" INTEGER,
    "liveRateCents" INTEGER,
    "liveMinutes" INTEGER,
    "deadlineDays" INTEGER NOT NULL,
    "questions" JSONB NOT NULL,
    "keepPrivate" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'working',
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT NOT NULL DEFAULT '',
    "sendUntil" TIMESTAMP(3),

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT NOT NULL DEFAULT '',
    "agreedCents" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "submissionId" TEXT,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "agreedCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "submissionId" TEXT,
    "callId" TEXT,
    "disputeId" TEXT,
    "developerId" TEXT NOT NULL,
    "testerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "testerCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "failure" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "testerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "decidedCents" INTEGER,
    "decisionNote" TEXT NOT NULL DEFAULT '',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallSlot" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "allowedTesterIds" TEXT[],
    "link" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "rateCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "cancelledBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelNote" TEXT NOT NULL DEFAULT '',
    "lengthMinutes" INTEGER,
    "lengthReason" TEXT NOT NULL DEFAULT '',
    "lengthAt" TIMESTAMP(3),
    "noShowBy" TEXT,
    "noShowNote" TEXT NOT NULL DEFAULT '',
    "noShowAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEmail" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "html" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'both',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeAccountId_key" ON "User"("stripeAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "LoginToken_tokenHash_key" ON "LoginToken"("tokenHash");

-- CreateIndex
CREATE INDEX "LoginToken_email_createdAt_idx" ON "LoginToken"("email", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TesterProfile_userId_key" ON "TesterProfile"("userId");

-- CreateIndex
CREATE INDEX "Test_developerId_idx" ON "Test"("developerId");

-- CreateIndex
CREATE INDEX "Test_status_idx" ON "Test"("status");

-- CreateIndex
CREATE INDEX "TestEvent_testId_createdAt_idx" ON "TestEvent"("testId", "createdAt");

-- CreateIndex
CREATE INDEX "Contract_testerId_idx" ON "Contract"("testerId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_testId_testerId_key" ON "Contract"("testId", "testerId");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_contractId_kind_key" ON "Submission"("contractId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Review_submissionId_key" ON "Review"("submissionId");

-- CreateIndex
CREATE INDEX "Payment_developerId_idx" ON "Payment"("developerId");

-- CreateIndex
CREATE INDEX "Payment_testerId_idx" ON "Payment"("testerId");

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_submissionId_key" ON "Dispute"("submissionId");

-- CreateIndex
CREATE INDEX "CallSlot_testId_startsAt_idx" ON "CallSlot"("testId", "startsAt");

-- CreateIndex
CREATE INDEX "Call_contractId_idx" ON "Call"("contractId");

-- CreateIndex
CREATE INDEX "Message_contractId_createdAt_idx" ON "Message"("contractId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_email_key" ON "WaitlistEntry"("email");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TesterProfile" ADD CONSTRAINT "TesterProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_developerId_fkey" FOREIGN KEY ("developerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestEvent" ADD CONSTRAINT "TestEvent_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_testerId_fkey" FOREIGN KEY ("testerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSlot" ADD CONSTRAINT "CallSlot_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "CallSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
