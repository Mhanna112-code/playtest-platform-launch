-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "noShowDigestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "remindedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "devMarks" TEXT[],
ADD COLUMN     "devRemindedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "notifiedMarks" TEXT[];

-- CreateTable
CREATE TABLE "AppState" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "AppState_pkey" PRIMARY KEY ("key")
);

