-- (Owner, Nov 3) The description a payment was charged with at Stripe (its "What you've paid" line), fixed when it is first charged.
ALTER TABLE "Payment" ADD COLUMN "stripeDescription" TEXT;
