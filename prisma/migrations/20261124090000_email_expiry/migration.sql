-- (Owner, Nov 11, §383 7) Out-of-date emails expire instead of arriving late: a sent-at-once reminder (the call reminder) is never delivered after its moment
-- (status "expired"), and a morning email still waiting is replaced by the next morning's (status "replaced"). Neither counts as a failure.
ALTER TABLE "EmailQueue" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "EmailQueue" ADD COLUMN "kind" TEXT NOT NULL DEFAULT '';
