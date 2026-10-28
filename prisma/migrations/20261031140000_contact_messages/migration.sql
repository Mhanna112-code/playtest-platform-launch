-- Batch 15 section 21: Contact us keeps the message (up to 50,000 characters) for the admin's list, and which admin marked it replied.
ALTER TABLE "ContactMessage" ADD COLUMN "message" TEXT NOT NULL DEFAULT '',
ADD COLUMN "repliedById" TEXT,
ADD COLUMN "repliedAt" TIMESTAMP(3);
