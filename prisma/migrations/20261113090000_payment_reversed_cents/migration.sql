-- (Owner, Nov 3, batch 35 §133) A bank can dispute PART of a payment: what it reversed (null = the whole payment, as before).
ALTER TABLE "Payment" ADD COLUMN "reversedCents" INTEGER;
