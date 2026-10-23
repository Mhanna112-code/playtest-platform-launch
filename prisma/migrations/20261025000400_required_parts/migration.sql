-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "liveRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recordingRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "writtenRequired" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TermsOffer" ADD COLUMN     "liveRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recordingRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "writtenRequired" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "liveRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recordingRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "writtenRequired" BOOLEAN NOT NULL DEFAULT false;

