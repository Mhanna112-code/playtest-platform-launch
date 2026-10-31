-- (Owner, Oct 30, batch 34 §5) Notifications belong to a side: "developer", "tester", or NULL for the whole account (sign-in, password, Terms, the
-- account's deletion, the site's own notices). The bell, its number and the Notifications page show the side in use's lines plus the account's.
-- Additive only: one nullable column. No existing notification is removed or changed except for its new side.
ALTER TABLE "Notification" ADD COLUMN "side" TEXT;

-- Backfill: each existing line is sorted by what it is about (its link, then its kind), the same way new lines are (lib/server/notify.ts lineSide and the
-- callers that name a side), never by the side the person happened to use last. Anything that can't be told stays NULL (shown on both sides).
UPDATE "Notification" AS n SET "side" = CASE
  -- The admin console's lines: the account's.
  WHEN n."link" LIKE '/admin%' THEN NULL
  -- A tester's excerpts (on their own profile, or the account page's list).
  WHEN n."groupKey" = 'excerpts' OR n."link" LIKE '/app/account#excerpts%' THEN 'tester'
  -- Your own public profile is the side it shows.
  WHEN n."link" ~ ('^/app/testers/' || n."userId" || '([/?#]|$)') THEN 'tester'
  WHEN n."link" ~ ('^/app/developers/' || n."userId" || '([/?#]|$)') THEN 'developer'
  -- The page the line links to: developer pages, tester pages.
  WHEN n."link" ~ '^/app/(tests|testers)([/?#]|$)' THEN 'developer'
  WHEN n."link" ~ '^/app/(find|sessions|developers)([/?#]|$)' THEN 'tester'
  -- Old links through the side switch.
  WHEN n."link" LIKE '/app/switch?to=developer%' THEN 'developer'
  WHEN n."link" LIKE '/app/switch?to=tester%' THEN 'tester'
  -- Shared pages, by kind: the tester's payments, delays, payouts, Charge / Let it go and deadlines.
  WHEN n."link" LIKE '/app/payments#payout%' OR n."groupKey" IN ('payout', 'tarrived', 'tpaid', 'tdelayed', 'charge', 'deadlines') THEN 'tester'
  WHEN n."text" LIKE 'Your payout setup is done:%' THEN 'tester'
  WHEN n."link" LIKE '/app#charge-or-cancel%' THEN 'tester'
  -- The developer's receipts, failures, holds, retries, chargebacks, card, subscription, reviews to do and bank confirmations.
  WHEN n."link" LIKE '/app/payments%' OR n."link" LIKE '/app#needs-review%' OR n."link" LIKE '/app#bank-to-confirm%'
    OR n."groupKey" IN ('payhold', 'unreviewed', 'closeout', 'pausedreminder') THEN 'developer'
  WHEN n."text" LIKE 'The team approved lifting your hold%' OR n."text" LIKE 'A note from the team about your hold%' THEN 'developer'
  -- A suspension or reinstatement names its side.
  WHEN n."text" LIKE 'Your developer account %' THEN 'developer'
  WHEN n."text" LIKE 'Your tester account %' THEN 'tester'
  -- A line about one test on a shared page (a rating to give, say): the person's role in that test.
  WHEN n."testId" IS NOT NULL AND EXISTS (SELECT 1 FROM "Test" t WHERE t."id" = n."testId" AND t."developerId" = n."userId") THEN 'developer'
  WHEN n."testId" IS NOT NULL AND EXISTS (SELECT 1 FROM "Contract" c WHERE c."testId" = n."testId" AND c."testerId" = n."userId") THEN 'tester'
  ELSE NULL
END
WHERE n."side" IS NULL;
