-- (Batch 20 section 5) When the account confirmed it is 18 or older (sign-up, Google's sign-up step, or the updated-Terms box). Null = not yet.
ALTER TABLE "User" ADD COLUMN "ageConfirmedAt" TIMESTAMP(3);
