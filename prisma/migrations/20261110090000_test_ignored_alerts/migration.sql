-- (Owner, Oct 31, batch 35 §73) The developer's Alerts ticks belong to each test, not the account. A new test and a Next round start with every alert on.
-- Additive only: one column with a default. Each existing test is backfilled with its developer's current account list, so nothing changes for running
-- tests. "User"."ignoredAlerts" stays in place (unused).
ALTER TABLE "Test" ADD COLUMN "ignoredAlerts" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "Test" AS t SET "ignoredAlerts" = u."ignoredAlerts" FROM "User" AS u WHERE u."id" = t."developerId" AND cardinality(u."ignoredAlerts") > 0;
