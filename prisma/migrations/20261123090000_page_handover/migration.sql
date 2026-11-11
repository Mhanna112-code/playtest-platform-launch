-- (Owner, Nov 11, §380 J) The new-tab handover: the holder's last heartbeat and whether a press of it is on its way, and the new copy waiting for it.
ALTER TABLE "PageClaim" ADD COLUMN "beatAt" TIMESTAMP(3);
ALTER TABLE "PageClaim" ADD COLUMN "busy" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PageClaim" ADD COLUMN "wantTab" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PageClaim" ADD COLUMN "wantAt" TIMESTAMP(3);
