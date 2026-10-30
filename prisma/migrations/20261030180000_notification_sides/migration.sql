-- A null side is an account-wide notice. No existing notification is removed.
ALTER TABLE "Notification" ADD COLUMN "side" TEXT;

-- Backfill from the subject's side, never the side the recipient happened to use last.
UPDATE "Notification" AS n SET "side" = CASE
  WHEN n."link" LIKE '/admin%' THEN NULL
  WHEN n."groupKey" = 'excerpts' OR n."link" LIKE '/app/account#excerpts%' THEN 'tester'
  WHEN n."link" ~ '^/app/(tests|testers)(/|[?#]|$)' THEN 'developer'
  WHEN n."link" ~ '^/app/(find|sessions|developers)(/|[?#]|$)' THEN 'tester'
  WHEN n."link" LIKE '/app/switch?to=developer%' THEN 'developer'
  WHEN n."link" LIKE '/app/switch?to=tester%' THEN 'tester'
  WHEN n."link" LIKE '/app/payments#payout%' OR n."groupKey" IN ('payout', 'tarrived', 'tpaid', 'tdelayed', 'charge', 'deadlines') THEN 'tester'
  WHEN n."text" LIKE 'Your payout setup is done:%' THEN 'tester'
  WHEN n."link" LIKE '/app/payments%' OR n."link" LIKE '/app#needs-review%' OR n."groupKey" IN ('payhold', 'unreviewed', 'closeout', 'pausedreminder') THEN 'developer'
  WHEN n."link" LIKE '/app#charge-or-cancel%' THEN 'tester'
  WHEN n."text" LIKE 'Your developer account %' THEN 'developer'
  WHEN n."text" LIKE 'Your tester account %' THEN 'tester'
  WHEN n."testId" IS NOT NULL AND EXISTS (SELECT 1 FROM "Test" t WHERE t."id" = n."testId" AND t."developerId" = n."userId") THEN 'developer'
  WHEN n."testId" IS NOT NULL AND EXISTS (SELECT 1 FROM "Contract" c WHERE c."testId" = n."testId" AND c."testerId" = n."userId") THEN 'tester'
  ELSE NULL
END WHERE n."side" IS NULL;
