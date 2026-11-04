-- (Owner, Nov 4, batch 35 §169) The version of a test's Alerts ticks: every save adds one, so a tab can tell an older list (a poll or redraw asked before a
-- save and answered after it) from a newer one. Additive: existing tests start at 0.
ALTER TABLE "Test" ADD COLUMN "alertsV" INTEGER NOT NULL DEFAULT 0;
