# Batch 16: per-tester deadline reminders, Find sort, Alerts line, Pays on average (owner, Oct 28)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 15 and the wording fixes (22b5a64).

## 1. Each tester is reminded before their OWN deadline
Today (holds.ts ~line 556) the tester's "Your deadline on “<test>” is <date>: send your work before then." rides on the developer's Open until marks, and only reaches testers whose deadline is within a day of Open until. Later joiners get nothing. Replace it:
- Each working tester gets their own reminders, counted to **their own deadline** (`dueAt`, the date their session page shows): **1 month, 1 week, 3 days and 1 day before**.
- Same rule as the developer's review reminders (`reviewMarksFor`): only marks still ahead when the tester **joins** are used; the 1-month mark only if the deadline was more than a month away at joining; a mark within 24 hours of joining is skipped.
- Batch 15 §18 is unchanged and is the owner's rule: every tester gets the same tester days (test opened → Open until), counted from when they join, and "Sent late" applies after those days. So on one test every tester gets the same set of reminders, decided by its tester days. Example: a test with 10 days per tester gives every tester 1 week, 3 days and 1 day; one with 45 days gives every tester all four. Only an Edit moving Open until later (deadlines move D days for working testers) changes what's still ahead.
- Line unchanged: "Your deadline on “<test>” is <date>: send your work before then." Link: their session page. Bell group: that test's day, as now.
- Track sent marks per tester (per contract), not per test. If their deadline moves later (Open until extended, or a pause shift), the marks still ahead of the new deadline can fire again; a mark is never sent twice for the same deadline.
- Who gets them: as now, testers still working on the test (not left, not ended, not finished). Reminders wait while the test or the tester is paused (the existing rule).
- The developer's "“<test>” closes to new testers on <date>." stays on the Open until marks (1 month, 1 week, 3 days, 1 day), unchanged.

## 2. "Sent late" stays
No change: it's measured against the tester's own deadline since batch 15. Only make sure no comment or doc line in the code calls it obsolete.

## 3. Find: "Most time to finish" sorts by days per tester
`src/app/app/find/page.tsx` line ~48 sorts by Open until, which no longer says how long a tester has. Sort by the days each new tester gets (`testerDays ?? testerDaysOf(createdAt, openUntil)`, the number in the card's "N days per tester" badge), most first. Ties: the later Open until first (more time left to join). Tests without Open until go last. The label stays "Most time to finish". Update the comment above it.

## 4. Tester Alerts: say what stops, in the grey line under the button
Replace the line under "Alerts: On / Off" (TesterAlertsToggle.tsx) with ONE short grey line that matches the current state and lists what stops a press:
- On: "Stops a press once for: new terms, your key, pay, calls, delayed pay, your dispute, listing changes, other tabs."
- Off: "Stops a press only for: new terms, your key marked as working."
It swaps when the button is pressed. Keep it `text-xs text-slate-400`, right-aligned on desktop and left on phones as now, wrapping inside the existing `max-w-xs`. Check the lists against the tester table in DESIGN-DOC.md (Why a press stops → Tester) and the code's tester stop kinds; if a kind is missing from the list above, add it in the same short style and report it.
Update tests/batch15-stops.test.ts (~line 68) and any evidence/media check that reads the old line.

## 5. Developer profile: "Pays on average" without the split
In profileStats.ts the hint "50% accepted in full, 25% partly, 25% rejected" goes. The tile keeps its value (the average share of the listing paid, as now) with the hint **"of the listing, over N pieces of work"** (N = the pieces counted; "1 piece of work" when one; "no paid work yet" with value "-" when none). The footnote (DEV_FOOTNOTE) stays as it is. Update tests/profile-stats.test.ts (~line 36), the find/[id] page line that shows `pays.hint`, and scripts/evidence.cjs ~line 1567.

## 6. Clean-up left from batch 15 (nothing user-visible)
- Remove the dead `checkReject` in rules.ts and anything only it uses.
- Remove the unreachable "you can only cancel booked calls here" text on the developer test page (~line 558), if it truly can't show.
- Fix stale comments: TestForm.tsx:179, find/page.tsx:47, terms.ts:84, rules.ts:529.

## 7. No waitlist: the home page is the launch page (owner, Oct 28)
The site launches with open sign-up, so the waitlist (built Oct 22 as a pre-launch page) goes completely:
- Home page: remove `<WaitlistForm />` from the hero and the comment mentioning it. The Sign up / Log in buttons stay as they are.
- Remove `WaitlistForm.tsx`, `api/waitlist`, `server/waitlist.ts` (`joinWaitlist`), its rate limit (5 sign-ups per network an hour), the admin console's Waitlist list (admin page, PagedList, adminLists) and the privacy page's waitlist line (privacy/page.tsx line 16, and the comment on line 8).
- Drop the `WaitlistEntry` table with a hand-written migration (no hosted DB has it yet, so this is safe); check it with `prisma migrate diff` as below and apply it to the local `playtest_lite` DB only.
- Remove or update every test, evidence and media script step that uses the waitlist (tests/batch15-security, bell-admin, extras; scripts/evidence.cjs, scripts/media.cjs).
- Check and report: the home page signed out shows no email box; `/api/waitlist` is gone (404); the admin console has no Waitlist section.

## 8. No "How testers see it" under the NDA (owner, Oct 28)
On Post and Edit, the NDA box's "How testers see it" preview (TestForm.tsx ~line 534, `<NdaBox label="How testers see it" …>`) only repeats what was just typed. Remove it. NdaBox stays everywhere else (join page, session page, terms history). Update any test, evidence or media step that looks for it.

## 9. Mature (18+): say why the box is red (owner, Oct 28)
The "Why is this test mature?" box turns red for "idk" because the server needs at least 5 characters (rules.ts ~295), but nothing says so and the message "it's required" reads as if the box were empty.
- Keep the 5-character minimum. Add a counter under the box, "N / 500", like the other limited fields.
- When it's red, show a red line under the box (the form's usual red line, on blur or after a press, like the other fields): empty → "Say why this test is mature (18+): it's required for mature content."; 1–4 characters → "Say a little more: at least 5 characters." Use the same two messages on the server.
- The grey line under the tick box contradicts itself ("No graphic content … Graphic content must be marked Mature"). Change it to: "Tick this if your test has mature content, and say why. Never allowed: sexual content involving minors, illegal content, real-world gore. Other graphic content must be marked Mature." Check the Terms of Use say the same and report if they don't.

## 10. A press with mistakes: "Please fix the mistakes above." and go to the first one (owner, Oct 28)
Today Post lists the server's messages under the button ("Fix the mistake above, then press Post the test again." plus a bullet per mistake), while the field itself may or may not be red: the owner saw the Mature list under the button with the "idk" box not red. The two systems (FieldChecks on blur and the server's `errs` matched by FIELD_WORDS) disagree.
- **One rule, every form with fields** (Post, Edit, posting a draft, profile/settings, sign up, log in, reset password, Contact us, dispute and rating boxes, and any other form that has field mistakes):
  - Each mistake shows at its field only: the box red, with the red line under it saying what's wrong (from the client check or the server, the same text).
  - Under the button only: "Please fix the mistakes above." (one line, red), no list.
  - The page scrolls to the **first** red field (top to bottom) and puts the cursor in it.
  - A field stays red until its own value is fixed: it's re-checked as it's typed in once it has been red, and editing another field never clears it. When the last one is fixed, the line under the button goes.
- A server mistake that belongs to no field (rare) shows under the button in red as now; refusals that aren't mistakes (blue, e.g. "Confirm your email first.") and the blue stop-once box are unchanged.
- Every server field message must map to its field; add a test that each Post/Edit field message from `checkListing`/`editCheck` lands on a field (no FIELD_WORDS misses).
- Proof: a short recording on Post: two mistakes (Mature "idk" and an empty title), press Post, the page goes to the title, fix it, the next one is still red, fix it, the line goes.

## Check and report
- Tests for items 1, 3, 4 and 5 (item 1: a tester joining with 40 days, 10 days and 2 days; a deadline moved later; a paused test).
- Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green.
- No migration unless item 1 truly needs one; if it does, hand-write it and check it with `prisma migrate diff … --shadow-database-url …playtest_lite_shadow --exit-code` (template1 is damaged), and apply it only to the local `playtest_lite` DB on port 5499.
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed and any interpretations.
