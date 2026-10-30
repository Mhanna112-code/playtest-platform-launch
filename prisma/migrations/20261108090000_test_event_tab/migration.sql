-- (Batch 34 §9) The tab that saved the listing: Edit never stops for its own tab's save.
ALTER TABLE "TestEvent" ADD COLUMN "tab" TEXT NOT NULL DEFAULT '';
