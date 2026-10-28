-- Batch 15 section 26: the tester's one-press Alerts (On / Off), saved per tester.
ALTER TABLE "User" ADD COLUMN "testerAlertsOff" BOOLEAN NOT NULL DEFAULT false;
