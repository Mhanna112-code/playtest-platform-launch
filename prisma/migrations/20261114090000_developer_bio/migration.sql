-- (Batch 35 §134) The developer side's own bio (optional, up to 2,000 characters). The tester side keeps its own on TesterProfile.bio: nothing is copied
-- between the two, so every developer side starts with an empty one.
ALTER TABLE "User" ADD COLUMN "devBio" TEXT NOT NULL DEFAULT '';
