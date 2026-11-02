CREATE TABLE "DirectConversation" (
  "id" TEXT NOT NULL,
  "firstId" TEXT NOT NULL,
  "secondId" TEXT NOT NULL,
  "startedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DirectConversation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DirectConversation_different_accounts" CHECK ("firstId" <> "secondId")
);
CREATE TABLE "DirectMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "clientId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "DirectRead" (
  "userId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DirectRead_pkey" PRIMARY KEY ("userId", "conversationId")
);
CREATE UNIQUE INDEX "DirectConversation_firstId_secondId_key" ON "DirectConversation"("firstId", "secondId");
CREATE INDEX "DirectConversation_secondId_idx" ON "DirectConversation"("secondId");
CREATE INDEX "DirectConversation_startedById_createdAt_idx" ON "DirectConversation"("startedById", "createdAt");
CREATE UNIQUE INDEX "DirectMessage_senderId_clientId_key" ON "DirectMessage"("senderId", "clientId");
CREATE INDEX "DirectMessage_conversationId_createdAt_idx" ON "DirectMessage"("conversationId", "createdAt");
CREATE INDEX "DirectMessage_senderId_createdAt_idx" ON "DirectMessage"("senderId", "createdAt");
ALTER TABLE "DirectConversation" ADD CONSTRAINT "DirectConversation_firstId_fkey" FOREIGN KEY ("firstId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DirectConversation" ADD CONSTRAINT "DirectConversation_secondId_fkey" FOREIGN KEY ("secondId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DirectConversation" ADD CONSTRAINT "DirectConversation_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "DirectConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DirectRead" ADD CONSTRAINT "DirectRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DirectRead" ADD CONSTRAINT "DirectRead_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "DirectConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "DirectConversation_firstId_updatedAt_idx" ON "DirectConversation"("firstId", "updatedAt");
CREATE INDEX "DirectConversation_secondId_updatedAt_idx" ON "DirectConversation"("secondId", "updatedAt");
CREATE INDEX "DirectRead_conversationId_idx" ON "DirectRead"("conversationId");
