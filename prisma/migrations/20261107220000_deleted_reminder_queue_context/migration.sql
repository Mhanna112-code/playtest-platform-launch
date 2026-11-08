ALTER TABLE "EmailQueue" ADD COLUMN "recipientId" TEXT;
ALTER TABLE "EmailQueue" ADD COLUMN "notificationIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "EmailQueue" ADD COLUMN "reminderKey" TEXT;
