-- (Owner, Oct 28, batch 8) The developer subscription ($7/month). The free-during-launch date lives in AppState ("free-until").
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "subscriptionAnchorAt" TIMESTAMP(3),
ADD COLUMN     "subscriptionCanceling" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subscriptionEndReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "subscriptionEndedAt" TIMESTAMP(3),
ADD COLUMN     "subscriptionId" TEXT,
ADD COLUMN     "subscriptionPastDueAt" TIMESTAMP(3),
ADD COLUMN     "subscriptionPausedAt" TIMESTAMP(3),
ADD COLUMN     "subscriptionRenewsAt" TIMESTAMP(3),
ADD COLUMN     "subscriptionStatus" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "subscribedAt" TIMESTAMP(3);
