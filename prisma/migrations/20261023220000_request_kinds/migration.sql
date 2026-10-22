-- AlterTable
ALTER TABLE "CallRequest" ADD COLUMN     "times" TIMESTAMP(3)[],
ADD COLUMN     "weeks" INTEGER NOT NULL DEFAULT 0;


-- Existing requests: their one time is the only option
UPDATE "CallRequest" SET "times" = ARRAY["startsAt"] WHERE cardinality("times") = 0;
