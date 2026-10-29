# Batch 30: after launch (owner, Oct 29)

This file wins over the earlier batches and the design doc where they differ. Build it after launch.

## 35. Storage running out: tell the admins, inside and outside the app (owner, Oct 29)
- Once a day (the daily timed run) the app measures the database's size (pg_database_size) and the total size of stored uploads (from its own records of R2 files). Limits come from settings: `DB_STORAGE_LIMIT_GB` (e.g. 0.5 on Neon's free plan, the plan's size on a paid one) and `UPLOADS_LIMIT_GB` (the R2 budget); unset = not checked.
- At 80% or more of either: a red box at the top of the admin console ("Storage is 82% full: database 410 MB of 500 MB." / "Uploads are 85% full: 8.5 GB of 10 GB."), one admin bell line per crossing ("Storage is filling up (database 82%)"), and the keyed /api/health answers "degraded: storage" (HTTP 200, alongside the emails keyword), so the UptimeRobot keyword monitor alerts the owner outside the app. Under 80% again: the box goes.
- HANDOVER: set the two limits; add "degraded: storage" to the keyword monitor; also turn on Neon's usage alerts (Neon console) and Cloudflare's billing notifications for R2.
- Tests: 79% → nothing; 81% → box, one bell line, health keyword; back under → gone; limits unset → no check.

## Check and report
- Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green. Migration only if needed (hand-written, checked with `prisma migrate diff` against playtest_lite_shadow with --exit-code, applied only to the local playtest_lite DB; say the 3400 server needs a restart).
- Don't touch port 3400 (the owner uses it: write each file in one go). Don't edit docs/DESIGN-DOC.md. Never print secrets from .env.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed.
