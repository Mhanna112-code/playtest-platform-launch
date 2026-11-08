# November 7 dashboard, links and rating changes

Owner-approved replacement for the earlier dashboard layout and search rules.

## Links

- Tester earnings link the written, recording or live-call phrase to a stable payment-status anchor on the correct session. Person and test links keep their own destinations. The anchor exists while payment status changes. Old Needs review / History / rejoin bookmarks fall back to the replacement panels; new payment reminders target Needs you.
- Expanded bell lines keep their destination on all other words, alongside separate person/test links. This also applies inside long resizable lines. No nested anchors.

## Panels

- Messages has two independent searchable, resizable and scrollable panels: Direct messages and Test messages. Direct search uses the other person's name; test search includes developer, tester and test. Test titles and names have separate links from the chat row. Lists no longer compete for one combined 100-row cutoff.
- New tests for you and History removed from the tester dashboard.
- To do has one row per current working test: test name, individual due date with Deadline passed where applicable, and Send work. No part count, Every part sent, prices, Switch/Keep or other action buttons. Those actions remain on the session page.
- Previous Tests combines removed, left and finished tests, with Removed From / Closed / Left checkboxes. End early, suspension and block removals are Removed From. Personal departure takes precedence over a later overall closure; ordinary completion/rating and overall stops are Closed. Current working tests stay in To do.
- Find Tests, Previous Tests and Tests visited use FindTestCard. Visited keeps Remove, private invite-only redaction, and its own name search and state checkboxes.
- Developer Your tests filters separately include Stopped by admin, Stopped by you, Paused and Open. Open includes tests whose close-out has not passed; it can overlap a stop or pause. Ticks combine as alternatives. No ticks means all states, including historical closed tests and drafts.
- Each dashboard test panel searches only itself. Search inputs and tick filters remain outside the panel scroll. Existing developer category/product filtering remains.
- Needs you shows just the test name and Review. A shared server calculation supplies both dashboard and test page eligibility, including unpaid parts, updates, bank checks, applications, requests, disputes, excerpts and ratings, or the permitted restricted-view items. A test leaves only when its actionable count reaches zero. Dashboard freshness includes ratings, account deletion and minute boundaries.

## Ratings and manual test 10

- New rating actions, dashboard rows and reminder generation close when either account is deleted. A deletion landing after the initial gate is checked again under user locks before creating the rating. Previously submitted ratings keep their existing reveal rules.
- Leaving does not shorten the tester's rating window. Close-out is generally last tester deadline + 14 days (not one week), no earlier than joining closes, with pause/outage adjustments. Pending work, Charge decisions and open disputes can block Rate temporarily.
- Automated checks cover new disputes before/after close-out and after rating, an already-open dispute remaining available to the developer/team, and final tester/developer reminders included in required email.
- This does not establish real inbox delivery. The manual Charge race test still has unpaid charge and Dev Tester work. Next: pay charge's written answers $4.00 with a partial-payment reason; as charge open a dispute. Then age this sample's dates, verify the open dispute remains in admin, and use a different settled sample to check rating closure and final reminders.

## Validation

Two new test files cover the links/panels and the server eligibility, deletion and payment-anchor behavior. The five-file focused run passes 29 tests, including the existing dispute and final-reminder suites. Typecheck, lint and production build pass, with existing lint warnings. A full npm run check was attempted and stopped after reproducing broader pre-existing source/markup assertion failures; it is not green. No new schema change is introduced here. The earlier email-queue migration must be applied by the owner/merger before running the branch in the app database. No changes have been merged into the owner's checkout.
