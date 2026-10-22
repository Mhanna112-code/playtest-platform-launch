-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "setId" TEXT;

-- AlterTable
ALTER TABLE "CallRequest" ADD COLUMN     "repeat" TEXT NOT NULL DEFAULT '';


UPDATE "CallRequest" SET "repeat" = 'weekly' WHERE "weeks" > 0;
