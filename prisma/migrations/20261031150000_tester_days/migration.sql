-- Batch 15 section 18: every tester gets the same number of days from when they join; Open until is the last day to join.
ALTER TABLE "Test" ADD COLUMN "testerDays" INTEGER;

-- Existing tests keep their stored deadlines; tester days for them is Open until minus when they opened, used for new joins only.
UPDATE "Test" SET "testerDays" = GREATEST(1, ("openUntil"::date - "createdAt"::date))
WHERE "openUntil" IS NOT NULL AND "status" <> 'draft';
