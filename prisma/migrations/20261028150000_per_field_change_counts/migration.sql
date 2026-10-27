-- (Owner, Oct 28 afternoon) The 3-change limit is per field: one count per limited field instead of one shared total.
-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "criticalCounts" JSONB NOT NULL DEFAULT '{}';

-- Existing data: every limited field starts with the old shared total.
UPDATE "Test" SET "criticalCounts" = jsonb_build_object(
  'description', "criticalChanges",
  'ndaText', "criticalChanges",
  'questions', "criticalChanges",
  'languages', "criticalChanges",
  'devices', "criticalChanges"
) WHERE "criticalChanges" > 0;

-- AlterTable
ALTER TABLE "Test" DROP COLUMN "criticalChanges";
