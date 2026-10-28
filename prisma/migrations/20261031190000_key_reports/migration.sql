-- Batch 15 sections 19, 44 and 45: keys typed back from testers who left or finished, and the developer's broken-key warning (dismissed / works now).
ALTER TABLE "AccessKey" ADD COLUMN "brokenDismissedAt" TIMESTAMP(3),
ADD COLUMN "fixedAt" TIMESTAMP(3),
ADD COLUMN "reusedFrom" TEXT NOT NULL DEFAULT '',
ADD COLUMN "reusedBroken" BOOLEAN NOT NULL DEFAULT false;
