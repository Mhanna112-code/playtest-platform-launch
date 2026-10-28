-- Batch 15 section 16: suspensions are per side. The existing columns become the developer side; the tester side gets its own.
ALTER TABLE "User" ADD COLUMN "testerSuspendedAt" TIMESTAMP(3),
ADD COLUMN "testerSuspendNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN "testerSuspendedById" TEXT,
ADD COLUMN "testerReinstatedAt" TIMESTAMP(3);

-- Existing suspended accounts get both sides (and an earlier reinstatement counts for both).
UPDATE "User" SET "testerSuspendedAt" = "suspendedAt", "testerSuspendNote" = "suspendNote", "testerSuspendedById" = "suspendedById" WHERE "suspendedAt" IS NOT NULL;
UPDATE "User" SET "testerReinstatedAt" = "reinstatedAt" WHERE "reinstatedAt" IS NOT NULL;

-- The side each suspension and reinstatement in the admin history is about.
ALTER TABLE "AccountEvent" ADD COLUMN "side" TEXT NOT NULL DEFAULT '';
