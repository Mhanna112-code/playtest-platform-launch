-- (Owner, Nov 5, batch 35 §267) The NDA follows the listing: its change on each working contract, and when the tester opened its notice.
ALTER TABLE "Contract" ADD COLUMN "ndaChangedAt" TIMESTAMP(3);
ALTER TABLE "Contract" ADD COLUMN "ndaChangeKind" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Contract" ADD COLUMN "ndaNoticeSeenAt" TIMESTAMP(3);
-- (Owner, Nov 5, batch 35 §268) The contract box's "New terms" pill, pressed for this offer.
ALTER TABLE "TermsOffer" ADD COLUMN "pillPressedAt" TIMESTAMP(3);
