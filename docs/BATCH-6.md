# Batch 6: owner decisions (Oct 28, afternoon)

This file wins over docs/BATCH-5.md, docs/BATCH-4.md and the design doc where they differ. Items marked DEFAULT are my recommendation, not yet confirmed by the owner: build them so they're easy to change, and list them in your report.

## 1. Calls without a Live call part are allowed again
Undo the media-pass refusal (`NO_LIVE_PART` / `hasLivePart` in `refusals()` in src/lib/server/requests.ts, and anywhere else it hides call requests). Both sides can request calls whether or not a live call is a listed part or in that tester's contract.
- Show which it is wherever calls are requested or listed (Live session on the test page, the session page):
  - listed and in their contract: as today ("Live call · $X/h");
  - not listed, or not in this tester's contract: "Not a listed part: pay for this call is up to <dev>" (tester side) / "Not a listed part: pay is up to you, at most $100 for this call" (developer side).
- Pay for such a call follows the existing unlisted-part rule (batch 4 A8, per piece as payments.ts already does): at most $100 for each such call (its pay plus extras), outside the 100% cap. The Pay box starts empty, not at a listing.
- Charge / Let it go never opens for a call that isn't in the tester's contract.

## 2. "Accepting testers" only when open with a spot
On the developer dashboard cards (and anywhere `StatusPill` shows an open test):
- open and at least one spot free: "Accepting testers" (green), as before;
- open and full: "Full" (grey);
- Draft, Paused, Stopped and Closed: as today.
Undo the "Open has no label" change in src/app/app/page.tsx.

## 3. The 3-change limit is per field
Each limited field has its OWN 3 changes once the first tester has joined: steps, NDA, questions, languages, devices.
- One Save that changes two of them uses one change of each.
- Each field shows "Changes left: N of 3" next to its label. When a field reaches 0 it locks with the note "You've changed the <field> 3 times since testers joined. Contact us in Settings to change it again." The other fields stay editable.
- Replace `Test.criticalChanges` with per-field counts (e.g. a Json column, or five Int columns). Migrate existing data by copying the old total into every field's count.
- Keep the live update in another tab (the listing poll already sends the counts).

## 4. A paused test: what testers can do
A test is paused when its developer is on a payment hold, a chargeback hold or an admin suspension. While it is paused:
- Testers can't send work. Send is refused with "This test is paused right now. You can send this once it resumes." Drafts can still be written and saved. (DEFAULT: drafts stay editable.)
- Testers can still dispute, Charge or Let it go, rate, and leave.
- **Charge during a payment or chargeback hold** goes through as the tester's choice but isn't charged yet. The amount is added to the developer's "Pay what you owe", and the tester is paid when the developer pays it. The tester sees "Charged $X. Payment may be delayed until the test resumes." (never "hold").
- **Charge during an admin suspension with no hold** is charged at once, as today. If it's declined, a payment hold starts and the amount is added to what is owed.
- **Disputes decided for the tester during a hold** are handled the same way: added to what is owed, and paid when it is paid. During an admin suspension with no hold they charge at once (a decline starts a payment hold).
- **Admin "Allow 3 more"** gives 3 more changes to every limited field that is at 0.
- **Deadlines** (DEFAULT): when the pause lifts, every working tester's deadline and the test's Open until move later by the length of the pause, as already done for a team pause (see `unpauseTest` in restrictions.ts). Do this for hold lifts and reinstatements too.
- **Chat** (DEFAULT): closed both ways while paused, because the developer's Messages page is closed. Testers see "Chat is paused while the test is paused." Today it is closed only during an admin suspension.
- **Invites and applications**: they wait. The join page shows "This test is paused right now." They work again after the lift unless something else closed them.
- **A team pause of one test** (admin pause) (DEFAULT): the same tester rules apply.
- The 7-day close still applies. After it closes, Charge, Let it go, dispute and rate carry on, and charges added to what is owed stay owed.
- Remove the old open question about testers sending during a payment hold. Update PAUSED_FOR_TESTERS and the session page's paused notice to say what still works.

## 5. Post a test: no summary step
No code change. The guide is updated separately.

## Check and report
- Tests for every item. Run `NEXT_DIST_DIR=.next-build npm run check` until it is green.
- A migration is needed (item 3). `prisma migrate dev` fails on this local cluster, so write the SQL by hand and check it with:
  `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <DATABASE_URL with the db name swapped to playtest_lite_shadow> --exit-code`
  It must report "No difference detected".
- Don't run `migrate deploy` or `generate` while port 3400 runs; I restart it. Don't touch port 3400.
- Don't edit docs/DESIGN-DOC.md.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report: what changed, the DEFAULT items and where to flip them, the migration name, and anything you couldn't do.
