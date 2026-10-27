# Batch 4: owner decisions (Oct 27, evening)

The design doc (docs/DESIGN-DOC.md, and the Claude Doc it was exported from) still wins where this file is silent. This file wins over the doc where they differ.
Items marked DEFAULT are my recommendation, which the owner hasn't confirmed yet: build them so they're easy to change, and list them in your report.

## A. Payments, holds and suspensions

1. **No 3-day owed window.** Any declined payment (part Pay, the tester's Charge, a call charge, extra pay) starts a payment hold AT ONCE.
   - Remove the daily retries, the daily "Pay $X by…" reminder and the "pay within 3 days" email.
   - More declines during the hold add to "Pay what you owe".
2. **Chargebacks.**
   - A chargeback starts a chargeback hold (3D Secure card check, pay what is owed, admin Approve).
   - A chargeback during a payment hold turns it into a chargeback hold.
   - Every further chargeback adds to the amount owed.
   - The hold count is unchanged: from the 4th hold on, an admin must Approve the lift.
3. **Hold = suspension for the developer's pages.** During a payment hold, a chargeback hold or an admin suspension:
   - **Routing.**
     - Every open page of that developer moves live to the dashboard TOP. If they are already on the dashboard, it scrolls to the top.
     - Every submit/press on every page checks for this on the server. A refused press routes them to the dashboard top too.
   - **Blue box at the dashboard top (not red).** It says:
     - if they just pressed a button, it didn't go through;
     - their account is suspended (admin) or on hold (payment/chargeback);
     - all their tests are paused, and testers stay in them;
     - how to resume:
       - payment hold: "Pay what you owe" links to Payments, opening in a new tab;
       - chargeback hold: the chargeback steps on Payments;
       - admin suspension: appeal through Contact us in Settings;
     - when it lifts, the tests resume as normal.
   - **Closed while it lasts:** test pages, Edit, Post a test, Messages. Payments stays open (Pay what you owe, receipts). Settings stays open (Contact us; the profile editor is hidden).
   - **Pay and Reject are unavailable everywhere during any hold or suspension.**
   - **Only Cancel call is allowed**, directly in the dashboard's Calls box (see B2). No Stop and no End early while suspended or on hold (DEFAULT: paused tests close after 7 days anyway, and stopping would cut off testers' unsent work).
   - **Testers in a paused test:**
     - admin suspension: they can only cancel booked calls;
     - payment or chargeback hold: they can still send work, as settled earlier (DEFAULT: owner to confirm).
     - Testers never see "hold", "suspended", "failed" or "chargeback"; they see "paused" and "delayed".
4. **Calls are cancelled automatically, with no fault**, when they start within 3 days of a suspension or hold starting. Later calls stay booked. Each is cancelled 3 days before it starts if the suspension or hold is still on. Both sides are told.
5. **Emails that ignore Off:** "Your tests are paused" (hold start), the chargeback hold, and "running again". They go in the one end-of-day email for people with email Off.
6. **Daily paused reminder for the developer while paused:** "<test> is paused and closes on <date> unless your account is cleared" (for a hold: "…unless you pay what you owe").
   - It stacks with the same line for their other tests, once a day.
   - It replaces the "paused" and "day before it closes" lines for the developer. Testers keep their lines.
7. **No 3D Secure on Pay over $200** (owner, Oct 27). The "can't be refunded" tick stays. The chargeback-hold 3D Secure check stays.
8. **Extra-pay cap** (owner, Oct 27). Count any amount above a part's listed price, including parts outside the contract. A part with no listed price can be paid at most $100 in total, and that $100 doesn't count toward the 100%.
   - Blocked wording: "This is more than you can pay above the listing (up to $Y)."
9. **"Chat with <name>" on every hover card** (owner, Oct 27): the Testers-panel hover card, and testers' hover cards on a developer's name.

## B. Developer dashboard and Payments

1. **Pay and Reject leave the Payments page.**
   - The dashboard gets a "Needs review" scroll box (newest first, 3 rows then "Show N more"). It lists each test with work waiting, e.g. "Harbor Run · 3 parts to pay or reject".
   - Each row links to that test's Needs you.
   - The box is hidden during a hold or suspension.
   - Payments keeps the history, receipts and (during a hold only) "Pay what you owe".
2. **Calls box on the dashboard:** every booked call, soonest first.
   - Join appears only when the call can be joined.
   - Each row links to that call on the test page, where it can be cancelled.
   - During a suspension or hold, the row has Cancel itself, because test pages are closed.
3. **Join call, both sides:**
   - checked live: Join disappears when the call is cancelled;
   - checked on press: a press after a cancellation shows a blue notice under Join, "This call was cancelled", with the reason.
4. **Contract change notices.** When a working tester Switches or Keeps after new terms, the developer's test page and Edit page show a blue line in the top box, e.g. "Ana switched to the new terms", with a link "See their contract".
   - On the test page, the link scrolls to that tester's row with the contract shown.
   - On Edit, it opens the test page at that row in a new tab.
   - The tester's row shows the agreed scope (current contract) only; there is no full history fold for developers.

## C. Edit

1. **3 significant changes once a tester has joined.** After the first tester joins, Saves that change part prices, parts, questions, steps, the build link or the NDA are limited to 3.
   - One Save counts as one change, however many fields it touches.
   - Show "Changes left: 2 of 3" near Save.
   - After 3, those fields are locked, with a note. Other fields stay editable.
   - Each such Save still creates the Switch/Keep offer. Earlier questions, answers and NDAs stay in the tester's Terms history.
   - (The NDA counting is a DEFAULT; the owner listed prices/parts, questions, steps and link.)
2. **Save stays faded when nothing changed.** This is already built; keep it.

## D. Testers

1. **Suspended tester, after reinstatement:** automatically re-invited to the tests they were removed from that are still open with free spots. Drop any invite-only exception.
   - While suspended: dashboard top blue box plus a read-only list "Tests you were removed from".
   - After reinstatement: those tests sit at the dashboard top with a "Suspended" label and Rejoin/Ask to rejoin until they rejoin or dismiss.
2. **Paused tests:**
   - not shown in Find tests;
   - testers who joined, were invited or applied see them on their dashboard with a "Paused" tag;
   - anyone else opening the link sees "This test isn't available right now."
3. **Tester dashboard boxes, each newest first, 3 rows then "Show N more":**
   - "Charge or cancel": tests with parts where Charge is open; each row links to the part on the session page.
   - "To do": unsent parts with deadlines, each with a "Send work" button that opens the part.
   - A test can be in both.
   - Other left/removed tests (before deadline, not stopped, not rated): a "Tests you left" box with Ask to rejoin.
4. **Rating:**
   - A suspended or held person's tests can still be rated by the other side. The suspended person can't rate until it lifts.
   - Rating reminders: once, then after a stop or close every 3 days, for 2 weeks only.
   - The Rate button itself has no end date (DEFAULT).
   - Rate gets the stop-once blue notices that still apply after a test closes: pay, reject, charge, let go, dispute filed/decided. It is refused while a dispute is open.
5. **Dispute notice for developers.** The blue notice for a new dispute links to that dispute's Needs you row, where the developer adds their side.

## E. Every page

1. **Long lists.** Every blue box (top box, stop boxes, pop-up notices, under-button notices, yellow keys box) shows 3 lines, then "Show N more" opening a scroll box about 8 lines tall.
   - Any list inside a row (e.g. the unmet needs on an invite row) shows 3 items then "+N more".
   - Long names, titles and reasons are cut with "…" in rows, with the full text on hover, and wrap in full where they are the main content.
2. **Stacking: lines of the SAME KIND stack across tests, one entry per kind per day:**
   - payment failed / hold started / hold lifted;
   - admin decisions;
   - dispute filed; dispute decided;
   - the team paused/stopped/closed your test;
   - the paused reminder (A6);
   - tester: Paid; Rejected; Payment delayed; Delayed payment arrived; "<dev> paid you $X extra";
   - test stopped / work ended;
   - the admin suspended-accounts review.
   - Every other line keeps the existing per-test same-day stacking.
3. **Reminders also go in the summary email**, as long as the person's email setting allows it.
   - Each line is still emailed once only.
   - A Weekly or Monthly email shows only the newest copy of each reminder.
4. **Email confirmation is needed only for Post a test, Join, Apply and accepting an invite.**
   - A blocked press shows the blue notice under the button: "Confirm your email first. We sent a link to <email>." plus a "Resend the link" button.
   - Keep the server checks as a backstop.
   - Bring back the strip "Email confirmation is off for testing." when SKIP_EMAIL_CONFIRM=1 (never in production).
5. **Names:** at least 1 character, no other rules (users.ts:78 is now 2).
6. **Contact us spam limit:** at most 5 messages per account per day.
   - A 6th press shows a blue notice under Send: "You've sent 5 messages today. We'll reply by email."
   - Suspended and held accounts must still be able to send.
7. **Data requests go through Contact us.** Remove any data-request item from Settings.

## F. Audit and report

- List every button a suspended or held account can still SEE but the server refuses. There should be none after A3. Fix any you find.
- Tests for everything above. Run `NEXT_DIST_DIR=.next-build npm run check` and get it green.
- Migrations: `prisma migrate dev` fails on this local cluster (a damaged template1). Write the migration SQL by hand. Check it with:
  `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <DATABASE_URL with the db name swapped to playtest_lite_shadow> --exit-code`
  The expected result is "No difference detected".
- Don't run `migrate deploy` or `generate` while the dev server on 3400 runs; I restart it.
- Don't touch port 3400.
- Commit on master and never push.
- Report back: what changed, the DEFAULT items, and anything you couldn't do.
