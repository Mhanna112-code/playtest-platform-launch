-- (Batch 18 section 1) The Terms of Use version each account accepted, and when. Accounts made before this accepted version 1 at sign-up (the version then), so they
-- start at 1 and are asked once to agree to version 2 at their next Post / Join / Apply / Ask to rejoin. New rows default to 0 (never accepted) until sign-up sets it.
ALTER TABLE "User" ADD COLUMN "termsVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
UPDATE "User" SET "termsVersion" = 1;

-- (Batch 18 section 3) A call that ended because its pay reached what was left of the $1,000 for that tester's calls on the test.
ALTER TABLE "Call" ADD COLUMN "cappedAt" TIMESTAMP(3);
