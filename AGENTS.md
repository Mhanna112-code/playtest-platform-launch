# Rules for coding agents (Codex and others)

PlaytestPlatform: developers post tests, testers join, send work (written answers, recordings, calls) and get paid through Stripe Connect.
Next.js 15, Prisma 6, Postgres, Stripe. `docs/HANDOVER.md` explains the setup; `docs/DESIGN-DOC.md` describes how the app behaves;
`docs/BATCH-NN.md` are the owner's decisions, newest wins where they differ.

## Where you work
- Never work in `C:/Users/march/Projects/playtest-lite` itself: the owner's dev server (port 3400) and the screenshot server (3450) hot-reload from it.
  Work in your own git worktree on your own branch, e.g.
  `git -C C:/Users/march/Projects/playtest-lite worktree add ../pl-codex-<task> -b codex/<task> master`, then install your own node_modules inside it: `npm ci`.
  Never link (junction) node_modules to another folder: `npx prisma generate` writes the database client into node_modules, and a shared
  one breaks the owner's dev server and every other task the moment your schema differs.
- Never start a server on 3400, 3450 or 3460, and never stop processes you didn't start.
- Never push, never merge into master, never force anything. Finish with commits on your branch; Claude reviews, merges and pushes.

## Checks (must be green before you finish)
- `TEST_DATABASE_URL="postgresql://postgres@localhost:5499/playtest_lite?schema=codex<N>" NEXT_DIST_DIR=.next-codex<N> npm run check`
  Use your own schema name and build folder (`codex1`, `codex2`, …) so you never collide with other runs. Never the `test` or `public` schema.
- Add tests for every rule you change (vitest, `tests/`), named after the task.

## Database
- The local Postgres (localhost:5499) can't create shadow databases, so `prisma migrate dev` doesn't work. Write migrations by hand
  (`prisma/migrations/<timestamp>_<name>/migration.sql`, additive only: no drops), then check they match the schema:
  `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "postgresql://postgres@localhost:5499/playtest_lite_shadow" --exit-code`
- Never apply migrations to any database except your test schema (the tests do that). Never touch a hosted database (Neon) or Vercel.

## Secrets and accounts
- Never print, copy or commit `.env` values, keys or passwords. Never use real Stripe keys; the tests use the fake Stripe.
- No real emails. Test accounts use `@playtest.test` addresses.

## Product rules that are settled (don't change them)
- A tester never sees "hold", "suspended", "failed" or "chargeback" about a developer. A team Stop never names the developer.
- Use "they" for people in every user-facing line and in docs (never he/she).
- Wording on screen is plain English and quotes amounts like `$10.00`. Match the existing lines' style.
- A press that races another change "stops once": the first press shows what changed (oldest first, with times), the second goes ahead. Reuse the
  existing `usePress` / seenAt machinery; don't invent a new one.
- Every part has a cap ($1,000 in all per piece; calls with one tester on one test at most $1,000).
- Charge / Let it go applies only to listed work sent by the tester's own deadline; late work and unlisted work have no Charge.
- If a spec is unclear or contradicts the design doc, stop and write the question in your final message instead of guessing.

## Finish
Your final message: the branch name, the commits, what you built (by spec section), the tests added, `npm run check` result, and any open questions.
