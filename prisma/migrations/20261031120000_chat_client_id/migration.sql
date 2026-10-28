-- Batch 15 section 13: a chat message's press id, so a repeated press of the same unconfirmed message never posts twice.
ALTER TABLE "Message" ADD COLUMN "clientId" TEXT;

CREATE UNIQUE INDEX "Message_senderId_clientId_key" ON "Message"("senderId", "clientId");
