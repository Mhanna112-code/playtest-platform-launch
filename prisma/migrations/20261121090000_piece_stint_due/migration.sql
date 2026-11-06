-- (Owner, Nov 6, §313c) Work sent before a rejoin keeps the deadline in effect when the tester left.
ALTER TABLE "Submission" ADD COLUMN "stintDueAt" TIMESTAMP(3);
ALTER TABLE "Call" ADD COLUMN "stintDueAt" TIMESTAMP(3);
