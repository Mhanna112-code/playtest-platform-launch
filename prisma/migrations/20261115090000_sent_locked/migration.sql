-- (Owner, Nov 3, batch 35 §136) Sent work is locked: a tester only adds to what they sent. Each addition is kept with its date.
ALTER TABLE "Submission" ADD COLUMN "additions" JSONB NOT NULL DEFAULT '[]';

-- A sent recording can't be removed any more: one marked for removal at the next send (the earlier rule) stays with the piece it was sent with.
UPDATE "Recording" SET "part" = 'recording' WHERE "part" = 'removed' AND "submissionId" IS NOT NULL;
