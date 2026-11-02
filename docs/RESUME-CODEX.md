# Resume here (Codex) — Nov 2

You work on playtest-lite (Next.js 15, Prisma 6, Postgres on localhost:5499). Read AGENTS.md first and follow it.

## How every task runs
- One worktree per task: C:/Users/march/Projects/pl-codex-<N>, branched from master, with its OWN node_modules (never share
  Prisma clients with C:/Users/march/Projects/playtest-lite, which serves the owner's local site on port 3400: never run anything
  there).
- Test schema codex<N>, build folder .next-codex<N> (as in AGENTS.md).
- Migrations: only if needed, applied locally only (DATABASE_URL and DIRECT_URL both at the local 5499 DB). Never a hosted DB.
- Finish with `npm run check` green. Known flaky (rerun alone before calling flaky): batch22 "two admins at once", batch17-rate §12,
  codex9 resource_missing, batch34-invite-beats-application, batch16-account-tabs, batch12 "a part already open to charging",
  batch34 outage Approve after Dismiss, batch4 "Open until heads-ups wait while the test is paused".
- Commit on your branch only. Don't push, don't merge. Add a section to docs/BATCH-35.md as the task says.
- Testers never see "hold", "suspended", "failed" or "chargeback" about a developer.

## What to do now
Open docs/CODEX-QUEUE.md and do the tasks in its order (29 first: it's about not charging twice). docs/CODEX-TASKS.md keeps every
task ever written and the status of each. docs/BLUE-NOTICES.md is the catalog of every notice; docs/PENDING.md the owner's list.
