-- Batch 15 section 40: the app measures each call's length from both people's presence on the call page.
ALTER TABLE "Call" ADD COLUMN "measuredMinutes" INTEGER,
ADD COLUMN "measuredFrom" TIMESTAMP(3),
ADD COLUMN "measuredTo" TIMESTAMP(3),
ADD COLUMN "measuredAt" TIMESTAMP(3),
ADD COLUMN "payBy" TIMESTAMP(3),
ADD COLUMN "choiceOfferedAt" TIMESTAMP(3),
ADD COLUMN "choiceBy" TIMESTAMP(3),
ADD COLUMN "devMarks" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "remindedAt" TIMESTAMP(3),
ADD COLUMN "devRemindedAt" TIMESTAMP(3);

CREATE TABLE "CallPresence" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CallPresence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CallPresence_callId_userId_idx" ON "CallPresence"("callId", "userId");
ALTER TABLE "CallPresence" ADD CONSTRAINT "CallPresence_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Calls that already took place keep their meaning: a logged length stays; otherwise the booked length (the old rule). Their review clock starts at their end.
UPDATE "Call" SET "measuredMinutes" = COALESCE("actualMinutes", "minutes"), "measuredAt" = CURRENT_TIMESTAMP,
  "payBy" = "startsAt" + ("minutes" * interval '1 minute') + interval '7 days'
WHERE status = 'booked' AND "startsAt" + ("minutes" * interval '1 minute') < CURRENT_TIMESTAMP;
