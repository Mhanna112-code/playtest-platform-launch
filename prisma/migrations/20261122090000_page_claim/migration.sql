-- (Owner, Nov 11, §380) One page at a time, across devices: who holds each test page / session page, and which one-at-a-time page an action came from.
ALTER TABLE "ActionLog" ADD COLUMN "page" TEXT NOT NULL DEFAULT '';

CREATE TABLE "PageClaim" (
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "tabId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageClaim_pkey" PRIMARY KEY ("userId","scope")
);
