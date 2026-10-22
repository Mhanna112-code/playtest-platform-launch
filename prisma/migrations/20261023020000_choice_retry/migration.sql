-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "retriedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "choiceBy" TIMESTAMP(3),
ADD COLUMN     "choiceOfferedAt" TIMESTAMP(3);

