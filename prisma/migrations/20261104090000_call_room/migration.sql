-- (Batch 21) The built-in call room replaces Jitsi.
-- Section 2: when the server ended the call for real, and why ("length", "calls_cap", "blocked", "paused", "stopped", "left", "ended").
-- Section 3: each side's latest poll of the call room (the page is open); CallPresence now holds the stretches the two browsers were connected.
ALTER TABLE "Call" ADD COLUMN     "devSeenAt" TIMESTAMP(3),
ADD COLUMN     "endReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "testerSeenAt" TIMESTAMP(3);

-- Section 1: the room's connection messages (offers, answers, candidates, camera and microphone state, "left"), relayed by polling.
CREATE TABLE "CallSignal" (
    "id" SERIAL NOT NULL,
    "callId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallSignal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CallSignal_callId_id_idx" ON "CallSignal"("callId", "id");

ALTER TABLE "CallSignal" ADD CONSTRAINT "CallSignal_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;
