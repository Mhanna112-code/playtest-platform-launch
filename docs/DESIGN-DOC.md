# Playtest Platform — Page-by-Page Design Doc

Oct 26, 2026 · @Mhanna112

## Owner notes (kept as written)

For playtest platform is it necessary for admins to be able to talk directly to devs and testers or going without that is fine (they can contact support which emails all admins?) (?)

&#91;SUGGEST\] Contact support (emails all admins) is enough for launch; admins reply by email; an in-app admin thread is post-launch.

Save blocked when nothing updated in test (faded)

Contract changes approval shown to devs

Questions changes require approval + previous questions/answers shown - after 1 tester has joined only allow to be changed 3x for significant test changes (prices/part, questions, steps, link) - past ndas shown (?)

&#91;SUGGEST\] Approval = the tester's Switch/Keep offer; previous questions, answers and NDAs stay in the tester's terms history; the 3-change limit applies once a tester has joined (Edit test).

UI behaviors that are applicable everywhere:

- Dev or Tester’s account deleted by dev (or themselves on another device) should route all logged in pages to logout with a notice in red that their account no longer exists \[IN I\]

&#91;update\] remove download my data from dev settings

&#91;SUGGEST\] Removed from Settings for developers; data requests go through Contact us.

- Dev suspension should cause the dev to be routed from whatever page he’s on to dashboard (unless theyre already on it) which redirects them to the top where it informs that if they pressed the last button it failed (all submission-form buttons across all pages to check for suspension) and their accounts have been suspended, all tests are paused meaning testers are still in it but they cant do anything except cancel booked calls, they can appeal by contacting the team on the settings page on lifting suspension the tests will unpause and resume as normal and they’re not allowed to navigate to any test pages, post a test or view messages. \[IN V\] \[update\] show button presses failing when going to other pages and when going to profile

&#91;SUGGEST\] A press that fails because of a suspension sends the developer to the dashboard top, where a red box names the failed action ("Your Pay on Harbor Run didn't go through"); Profile shows the same box when they land there instead.

&#91;update\] if suspension happened 3 or less days or extends until then before a call auto cancel it

&#91;SUGGEST\] Calls starting within 3 days of a suspension (or while it lasts) are cancelled with no fault; both sides told; later calls stay booked and are cancelled only if the suspension is still in force 3 days before them.

(?) allow other dev actions during suspension like cancelling calls

&#91;SUGGEST\] Allow Cancel call and Pay (from the Payments list); everything else stays blocked.

&#91;update\] remove “Testing is now on for..” banner remind me where this is and when

&#91;SUGGEST\] It is the strip "Email confirmation is off for testing." under the header on every page, shown only when SKIP\_EMAIL\_CONFIRM=1 locally; remove it and show nothing.

- tester suspension should cause tester to routed dashboard from whatver page there on which redirects them to top informing if they pressed last button it failed (all submission-form buttons across all pages to check for suspension) and their accounts have been suspended, they were removed from all tests they were part of and they are not allowed to go to find tests, edit their profile or view messages. They can appeal suspension by going to Contact Us on settings page (make sure not allowed to go to edit profile on settings page). On being reinstated they will automatically be reinvited to tests they were removed from that are still open and have spots (and are not invite only)

&#91;SUGGEST\] On reinstatement they are re-invited automatically (open tests with spots, not invite only); other removed tests show at the top of their dashboard with a "Suspended" label and Ask to rejoin.

(?)how deal with legality of changing nda + having it

&#91;SUGGEST\] Legal review of the NDA template; a changed NDA is always a new offer the tester accepts, never applied silently.

Is test is closed after a suspension (never lifted) or deleted (with dev) close excerpt requests

&#91;SUGGEST\] Yes: closing or deleting closes pending excerpt requests and tells the tester.

Tested contract change only lists it if it changed their term (repeatedly updating it?)

&#91;SUGGEST\] A tester sees an offer only when their own terms differ; repeated saves replace the waiting offer with the newest one.

Deal history in testers

&#91;SUGGEST\] Each tester row's History fold lists their terms versions, offers, Switch/Keep choices and payments.

10 test tester limit in effect on joining/applying/accelting invite?

&#91;SUGGEST\] Yes, all three, plus asking to rejoin: "You can't join more tests right now."

Playtest Platform — Website Design & Functional Requirements Document

Document type: Product design, functional requirements, UI behavior, and implementation QA

## 1. Overview

Playtest Platform is a marketplace where developers recruit testers to evaluate games, websites, apps and other digital products: developers set requirements, deliverables, deadlines and prices; testers join or apply, submit work and are paid for accepted deliverables. It covers written reports, recordings, live sessions, profiles, mutual ratings, test lifecycle, payments, disputes, moderation and admin controls.

- **Developers:** create and manage tests, recruit testers, review submissions, pay, rate testers.
- **Testers:** find and join tests, submit deliverables, attend live sessions, get paid, rate developers.
- **Administrators:** manage accounts, suspensions, disputes, reports, test states, payments and integrity.

**Launch principle:** every action involving money, participation, permissions or agreed terms is checked against the current server state. Nobody is charged twice, loses earned pay because an account changes state, unknowingly accepts different terms, or sees a false success.

**How this doc is organized:** one tab per page, each listing what the page shows and how it behaves; 2. Every page holds rules shared by every page (live updates, stop-once, pop-ups, sign-in, the bell and emails) and 11. Rules the pages rely on the rules several pages rely on (limits, money, holds and suspensions).

**Tags:** \[IN I\] = a photo goes here and \[IN V\] = a video goes here (xN = N different cases shown); \[update\], \[question\], \[future\], (?) are owner notes; \[SUGGEST\] = a proposed change or answer; \[AMENDED\] = how the app was changed to match this doc. Requirement, UI behavior, Open Question and Post-launch keep their usual meaning.

## 2. Every page

These rules hold on every signed-in page; page tabs only add what's specific to them.

**Sign-in and accounts**

- Email + password sign-up, log in, forgot/reset (link works once, signs out every device), email confirmation (Resend); changing the password signs out other devices.
- A confirmed email is required before posting, editing, joining, applying, sending work, calls, paying, charging, inviting and rating; a blocked press says so under the button with Resend.
- &#91;AMENDED\] Cross-tab sign-in (Oct 27): signing in as a different account switches every other tab and window of that browser to the new account, on the page that sign-in landed on; the "Signed in as someone else" cover screen is gone. Signing out in any tab signs out every tab, and all of them go to the sign-in page. A press racing the switch is refused, and that tab switches. Back/Forward restore and refresh.
- Dev or Tester’s account deleted by dev (or themselves on another device) should route all logged in pages to logout with a notice in red that their account no longer exists \[IN I\]
- &#91;AMENDED\] The "Email confirmation is off for testing." strip is removed (the switch is kept).

**Notices**

- Blue: a recoverable change, or a press that didn't go through because something changed; shown directly under the pressed button, which scrolls just enough into view.
- Red: a form mistake at the field (checked when the field loses focus and on submit), or an account restriction (suspended, deleted, appeal needed).
- Yellow: an attention list (e.g. broken access keys). Green: a confirmation.
- A failed press never shows success; it explains why, keeps typed data, and updates the page to the real state.

**Live updates and stops**

- Changes made by others, and by the same person in another tab, appear live in a box at the top of the page (newest first, Dismiss); the page scrolls to it once, on its first live update, never because of a press.
- The first press after an unseen change stops once with a blue box under the button listing what changed; the second press goes ahead unless something newer happened. Red mistakes always win: nothing saves while red remains.
- A new-terms stop scrolls to the Switch/Keep offer instead. Never ignorable: payment hold, suspension, test stopped, final refusals.
- &#91;SUGGEST\] Long lists: the top box and stop boxes show the newest 3 lines, then "Show N more" opening a scroll box about 8 lines tall; repeats group ("Ana, Ben and 3 others sent work"); each line links to its place; never-ignorable lines stay pinned.
- &#91;AMENDED\] Long lists: the live box and stop boxes show 3 lines then "Show N more" in a scroll box; the same for the yellow keys box, Invited and upcoming calls; Past calls scrolls.
- Where each page puts its live box and stop boxes is listed on that page's tab.

**Pop-ups (failure rule)**

- &#91;AMENDED\] The five confirm dialogs (Stop and End early on 6. Developer test page; Leave, Let it go and Rate and finish on 8. Tester session page) show live blue notices inside while open (the 3 newest in the "Just updated" style, then "Show N more"). A failed confirm (unseen changes or any refusal) closes the dialog, and the blue notice ("Your press didn't go through" plus the changes) shows under the ORIGINAL button.
- &#91;AMENDED\] The Join anyway box (7. Tester dashboard, Find tests and the join page) and the Invite anyway box (6. Developer test page) update to the needs still unmet and disappear when all are met. A press after a change shows the updated list with "Your press didn't go through". Any other failure closes the box, with the notice under the original button.
- &#91;AMENDED\] Block (confirm dialog, race check only), Report (inline reason box) and Delete account (confirm dialog, no stop-once) live on 9. Shared pages.

**Drafts, numbers, links**

- Unsent text is kept per person and form (written answers, chat, dispute text, rating comments, reject reasons, Post/Edit) and returns with "Not sent yet"; never on login or sign-up.
- &#91;AMENDED\] Numbers use thousands separators everywhere; money being acted on is always exact; big stat tiles abbreviate: under 10,000 in full, then k, M, B, T, then × 10^N, no trailing .0.
- Every box with a minimum or maximum shows its range next to it ("10–180 min", "at least $1.00").

**Restrictions on every page**

- &#91;AMENDED\] Suspended developer: any failed press sends them to the dashboard top, whose red box names it and explains the suspension and appeal (Contact us in Settings); Profile shows the same box. Tests are paused. Only Cancel call, End early and Stop work, with or without a payment hold; test pages open with every other button hidden. Pay and Reject are hidden and refused everywhere (test page, Payments list, dashboard). Post a test and Messages are closed.
  - &#91;SUGGEST\] Pay remains possible from the Payments page's waiting list, and Cancel call from the dashboard's upcoming calls.
- &#91;AMENDED\] Suspended tester: routed to the dashboard top with the same explanation; removed from every test at once (developers see "Left this test"); their pay is charged with the share held; every press refused; Contact us stays open (Settings without the profile editor); profile editor, Find tests and Messages closed.
- Deleted account: red notice and logout on every open tab.
- &#91;AMENDED\] Payment hold: all the developer's tests paused; "Pay what you owe" on the dashboard, every test page and Payments, shown only during a payment hold or while a failed charge is unpaid (never for a suspension alone). What Pay and Reject do during a hold is in 11. Rules the pages rely on (11.2).

**Stopped tests (any reason)**

- Both sides show a "Stopped" label at the top and, under the overview panel, one line on what they can still do (developer: pay or reject sent work, chat, rate, read answers; tester: charge or let go once Charge opens, dispute, rate, chat). Buttons for anything else are hidden; a stale page's press is refused in blue naming the stop.
- Still-allowed actions keep stop-once checks: developer Pay/Reject stops for a tester's dispute, charge or let-go of that piece, or a failed payment; tester Charge/Let it go and Dispute stop for the developer's Pay/Reject; tester Charge/Let it go is refused if the developer decided it meanwhile and waits during a hold or suspension; Dispute stops once when the developer adds their side and is refused once decided; Rate is refused while a dispute is open. A tester filing a dispute stops the developer's next press once and appears in Needs you and the bell.

**Deleted accounts, page by page**

- &#91;AMENDED\] Self-delete in Settings and admin delete with a reason; both follow the rules below.
- The deleted person: every open tab logs out with a red "This account no longer exists" notice.
- Developer deleted: their tests are stopped and leave Find; testers' session pages show the test stopped and the still-allowed actions; invites and applications close; chats become read-only; their profile shows "Deleted account" with ratings kept; unpaid work follows the payment rules and the admin resolves anything owed.
- Tester deleted: removed from every test (developers see "Left this test" with name shown as "Deleted account"); their sent work, payments, disputes and ratings stay for both sides and the admin; chats read-only; they disappear from invite lists.
- Admins still see deleted accounts in full (who deleted, why, history).

**Notifications (bell)**

- Bell reach: for both sides, a bell notification about another person is sent only when that person is in, or was in, one of the recipient's tests that is still open (chat follows the same reach). \[AMENDED\] Invites, applications, payments and disputes are exempt.
- Call requests are not bell lines. \[SUGGEST\] Same-day lines about the same test stack into one expandable entry.
- &#91;AMENDED\] Stacking: same-day lines about one test stack into one expandable entry, except these, which always get their own line: admin decisions, a test being stopped (tester lines), payment failures and holds starting, a hold or pause lifting or a pause being extended, and chargebacks. The team pausing, stopping or closing a test (including a pause closure) stacks into one developer line a day across tests. Tester payment lines don't stack; tester paused / resumed ("running again") and payout-problem lines stack per day across tests. Admin new-dispute, new-report and lift lines stack into one line a day.
- &#91;AMENDED\] Every bell line opens the exact place: the developer's test page at the item (Needs you row, tester row, call, dispute, keys notice) or Payments; the tester's session page at the part, call, terms offer or key; the admin's dispute row, Lifts row or account.
- &#91;AMENDED\] Every test-tied reminder waits while the test is paused.
- &#91;AMENDED\] The tester rating-change alert ("a tester's rating moves a whole star") is dropped (never built).
- &#91;AMENDED\] On admin bell lines about disputes, reports and lifts, names carry the label "Reported more than 3 times" where it applies (10. Administrator console).

&#91;AMENDED\] All bell notifications (Oct 26 table, updated with the Oct 27 changes):

| Who | Notification | When | Stacks? |
| --- | --- | --- | --- |
| Developer | Tester joined / accepted invite | each time | yes |
| Developer | Application received / rejoin ask | each time; while waiting, daily per test | yes, with that test's lines |
| Developer | Tester left | each time | yes |
| Developer | Part sent / updated | each time | yes |
| Developer | Call booked / cancelled | each time | yes |
| Developer | Key reported not working | each time | yes |
| Developer | Unreviewed work reminder | 1 month, 1 week, 3 days and 1 day before Charge opens (skipping any already past), then daily | yes, one "work waiting for your review" stack |
| Developer | Dispute filed | each time | no |
| Developer | Admin decision (dispute, disputed charge, suspension, reinstatement) | each time | no |
| Developer | Payment failed / retry went through / hold started / hold lifted | each time | no |
| Developer | Owed reminder "Pay $X by … or your tests are paused" | daily until paid or the hold starts | yes, one line across all owed payments, stacked with that day's lines |
| Developer | Payment hold "Your tests are paused until you pay what you owe" | daily during a hold (a declined retry that day is merged in) | no |
| Developer | Chargeback | each time | no |
| Developer | "\<test> is paused and closes on \<date> unless your account is cleared" | when it pauses, and again the day before it closes | no |
| Developer | The team paused, stopped or closed your test (including a pause closure) | each time | yes, one line a day across tests |
| Developer | Pause lifted or extended | each time | no |
| Tester | Invite (with No thanks) | on invite, then daily until answered | yes, one stack across tests |
| Tester | Paid / rejected / payment delayed / delayed payment arrived | each time | no |
| Tester | "\<dev> paid you $X extra for \<test>" | each time | no |
| Tester | New terms offered | each time | yes |
| Tester | Call booked / cancelled | each time | yes |
| Tester | Rating available / developer rated (revealed) | once; after a stop or close, every 3 days until rated or the window ends | yes while the test is open; its own line once stopped or closed |
| Tester | Charge window open | when Charge opens, then every 3 days | yes, one stack across tests |
| Tester | Test stopped / work ended | each time | no |
| Tester | Test paused / resumed ("running again") | each time | yes, per day across tests |
| Tester | Dispute decided | each time | no |
| Tester | Payout problem | every 3 days until fixed | yes, per day across tests |
| Tester | Suspended / reinstated | each time | no |
| Admin | New dispute | each time | yes, one line a day (with reports and lifts) |
| Admin | New report | each time | yes, one line a day (with disputes and lifts) |
| Admin | Lift waiting for Approve | each time | yes, one line a day (with disputes and reports) |
| Admin | New chargeback | each time | no |
| Admin | Suspended-accounts review reminder | daily, one line | no |

**Emails**

- &#91;AMENDED\] Setting: Off, or On with Daily / Weekly / Monthly (the per-update option is gone and its users moved to Daily). Each email lists everything since the last one. With email On, payment lines also go in an end-of-day email, even on Weekly or Monthly.
- &#91;AMENDED\] Sent right away: only email confirmation, password reset, and the admin chargeback email.
- &#91;AMENDED\] These ignore Off for developers and testers: the daily owed reminder, "Your account is paused" / "active again", and the team pausing, stopping or closing your test. They go in ONE end-of-day email, sent once.
- &#91;AMENDED\] Developer receipts and the tester's "You were paid…" follow the setting.
- &#91;AMENDED\] Each admin gets ONE daily email that can't be turned off, sent only when it has something: new disputes, lifts waiting, chargeback holds waiting for Approve, call reports once, the accounts this admin suspended that still have paused tests, and the tests this admin paused (with closing dates). Items drop off when the tests close or resume. This replaces the old admin daily email and the 3-day digest. New reports follow the admin's own email setting.

**Outages and mobile**

- When outage checks are on, a gap over 15 minutes moves every running timer later and cancels calls inside it with no fault; everyone affected is told once.
- Every core workflow works on mobile; panels collapse into folds.

## Why an old tab can't act on stale information

- Every action goes to the server, which re-checks the current state before doing anything: the session's status (working, left, ended, rated), the test's status (open, paused, stopped), holds, suspensions, blocks, spots, Open until, deadlines and limits.
- Each form sends the moment its page last showed ("seen at"); anything newer stops the press once, and anything that makes the action impossible (session ended, test stopped, request already taken, offer replaced) refuses it every time.
- So an old tab can't rejoin, accept a superseded offer, accept a request someone else took, book a call on a stopped test, or pay twice: a payment carries a one-time key, and a repeated press returns the first result instead of charging again.
- Rejoining in particular needs a current ask the developer accepts; an old page's Join or Accept is checked against today's session and refused if it no longer applies.

## Why going Back is safe

- Back and Forward show the saved page instantly and then refresh it from the server; nothing on a restored page is trusted when a button is pressed.
- Signing out, a suspension, a deletion or switching account in any tab invalidates the session everywhere; a restored page of the old account is hidden and its presses are refused.
- Restored forms keep only unsent text the person typed (kept drafts); amounts, offers and call times are re-read from the server before any action.

## 3. Developer dashboard

One place to see every test, what needs action, and the developer's own numbers.

- &#91;AMENDED\] Built: stat tiles (tester-limit card moved to Profile), Needs you across tests (scroll past 4), upcoming calls with Cancel, test cards with category icon, tags, Accepting testers / Paused with reason / Payment failed labels and feedback bars; hold and "account active again" boxes.
- All dev stats at the top including Parts to review, total number of testers joined across all tests, money spent so far accepting work, pays on average, typical review and rating. Abbreviations for larger numbers (endings with “k”, M, B, T and 10^N) \[update\] remove “Can take up to”
- &#91;SUGGEST\] The "Can take up to N testers per test" card moves to Profile; the spots field on Post/Edit still shows the limit.
- Post a test shortcut next to their name at top
- Identify tests requiring action with Needs you section at the top of the dashboard with Needs you action items from all tests from most recent to oldest. Becomes a scroll box when more than 4 items listed
- View open, paused, and closed tests; outstanding submissions and call requests; recruitment progress; deadlines and upcoming calls; invitations, applications and tester histories; paused tests and why.
- &#91;IN I\]x4 \[update\] show all different types of cases with tests here
- &#91;SUGGEST\] The four cases: an open test with work waiting, a full test, a paused test (payment hold), a stopped test.
- Tests are available in dashboard as boxes having category icons to the left of their names, tags describing their terms under the titles, feedback bars with statistics on the right at the bottom \[IN I\]x3 where clicking on them allows dev to navigate to them \[update\] show widely different tests with labels, Accepting testers as label if not paused or stopped
- &#91;SUGGEST\] The three cases: a game test with written + recording + live call, a free web-app test, an invite-only test with access keys.
- Paused and closed tests or tests with payment failures have a label or Accepting testers as the label if not paused or stopped \[IN I\]x2
- &#91;AMENDED\] No pause countdown on the dashboard; the bell says when a paused test closes (2. Every page). A test closed by its pause still says so on its card.
- &#91;AMENDED\] Test cards and links must respect account permissions and current test state; a suspended developer's test pages open with only Cancel call, End early and Stop.
- Banner at top shown while suspension happened warning the dev about all terms \[IN I\]
- &#91;AMENDED\] The suspension banner says the tests are paused and only Cancel call, End early and Stop remain, with or without a hold; the red box names any press that failed ("Your Pay on Harbor Run didn't go through").
- &#91;AMENDED\] Hold banners: "Pay what you owe" during a payment hold or an unpaid failed charge. A chargeback hold shows its three steps (card re-verified with 3D Secure, what is owed paid, the team's Approve) each as ✓/✗ (also on Payments and every test page). After the developer's 3rd hold, the banner says the team will review after they pay (11. Rules the pages rely on 11.2).
- &#91;SUGGEST\] An "Upcoming calls" list (next 7 days) with Cancel, usable during a suspension.
- Notice boxes: the suspension or failed-press box at the top; the Needs you list.

## 4. Post a test

The developer defines the product, the work, how testers join and what they're paid; these become each new tester's terms when they join.

**Fields**

1. Product name: the game, website, app or other product.
2. Test title: a concise description of the opportunity.
3. Instructions: what testers should do.
4. Build or product link.
5. Categories (ticks): Game, Productivity, Social, Entertainment, Education, Health & fitness, Finance, Shopping, Business, Developer tools, AI, Other.
6. Language requirements.
7. Technology requirements: devices, platforms or skills.
8. Deliverables: up to three parts (below).
9. &#91;update\] Mature (18+) warning checkmark with required warning where developer explains why the test content is mature (text under the field that marking this is required if their test is mature) \[question\] update this to be on entering the field not leaving if not already
10. Number of tester spots.
11. Individual tester deadline (days after joining).
12. Open-until date (recruitment cutoff).
13. Joining method: anyone can join, approved only (apply), invitation only.
14. NDA (optional): text testers must accept before joining.
15. Access keys (optional): one per line; each joining tester gets one.

&#91;SUGGEST\] Mature: ticking the box shows the required "why" field at once (on change), checked on blur and submit; the hint under the box says it's required for mature content.

&#91;AMENDED\] Mature shows its required "why" box at once.

&#91;update\] add no graphic, etc. content to terms and elsewhere

&#91;SUGGEST\] Terms of Use and a line under the Mature box: no sexual content involving minors, no illegal content, no real-world gore; graphic content must be marked Mature.

&#91;AMENDED\] The "no graphic content" line is in the Terms of Use and under the Mature box.

**Deliverables (parts)**

- Written report (questions, each required or optional), Recording (with think-aloud), Live session (calls).
- Each part is a card with its tick, price (calls "up to $ /h"), a Free tick and a Required tick. Required is a label only: it blocks nothing, and is shown on the listing, in testers' terms, on their session page and on the developer's tester rows.
- Free parts are clearly marked before a tester commits.
- &#91;AMENDED\] Price caps (Oct 27): written and recording $1–$1,000 each; live calls $10–$200/hr. The fields show the min–max hint, go red on blur, and the server refuses too.
- &#91;AMENDED\] A part price over $200 needs the tick "I confirm this part pays more than $200." when created over $200 or raised from at most $200 to over it. An already-saved price over $200 that stays unchanged needs no tick.

**Joining methods**

- Anyone can join: join at once while open with spots; first come, first served.
- Approved only: testers apply; the developer accepts or declines.
- Invitation only: not in Find; only invited testers join.
- Any method can also invite; an invite plus a pending application or rejoin ask joins the tester at once unless a final refusal applies.
- &#91;AMENDED\] The optional NDA is accepted on Join, Apply and Ask to rejoin.

**UI behavior**

- Top of the form mentions \* as required fields \[IN I\]
- Product (60 characters limit), Name of this test (60 characters limit) and What to do (1000 characters limit) are textboxes with Name of this test and What should testers do required (red highlighted box and warning underneath) \[IN I\]
- &#91;AMENDED\] Product 60, Name 60, What to do 1,000 (required) with counters, "\* marks required", red on blur and submit.
- Link to the product or build \[future\] block Private/internal network address based urls, use Google's Web Risk to validate URLs for threads such as malware and phishing, and warn about password-protected archives
- The creation form validates required fields and incompatible settings (How long do new testers have? field (their deadline) is not less than 3 total days from the open until date, open number of testers being greater than number of spots open and if the test has access keys, there must be at least as many access keys as open spots). Validates these with red warning under fields after on click and clicking away from the fields in invalid state \[IN V\] \[IN I\]x2
- &#91;AMENDED\] The deadline must leave 3 days inside Open until ("Set/Extend Open until to Nov 12 or later to allow a 10-day deadline."); spots up to the developer's limit; keys must cover open spots.
- The developer sees the configured parts, prices, tester capacity, deadlines, and joining method before publishing. \[IN I\]
- Publishing creates an active test and makes it discoverable according to its joining method.\[IN V\]\[IN I\]x2
- Race conditions of dev saving the test from a different device or tab is noted under Save after pressing it where it mentions save happened somewhere else and they need to press it again to go through. Fields that the dev updated in the other page are updated here and fields that didn’t remain updated on this tab. \[IN V\]
- Spots can't exceed the developer's tester limit (starts at 10 per test, grows with good ratings, max 50); the limit shows under the field.
- &#91;SUGGEST\] Large totals confirm before posting: "Up to $8,000 could be charged if all spots send everything."
- &#91;AMENDED\] Large-total confirm: not built (decision open; 12. QA, post-launch, open questions, launch priorities).
- All limits are in 11. Rules the pages rely on (11.5).

## 5. Edit test

Edits update the listing for new testers and are offered to current testers, who choose to Switch or Keep; Post's rules still apply (4. Post a test).

**Terms and offers**

- Each tester's terms (work, parts, prices, Required labels, deadline, requirements, NDA) are fixed when they join. Edits apply to new testers; working testers whose own terms would differ get an offer at the top of their session page: Switch to the new terms or Keep. Work already sent keeps its price. Repeated saves replace a waiting offer with the newest.
- &#91;AMENDED\] A changed NDA is a new offer, and the history keeps the previous NDA and questions.
- The developer sees offer results (who switched or kept) under Save, on tester rows and in the Pay box.
- The developer can change the critical test fields 3, 4, 6, 7, 8 and 12 up to 3 times (after that, editing those fields and saving doesn’t work with a red highlighted field \[question\] field or box? warning with “Contact support” mentioned \[update\] \[IN I\]
- &#91;SUGGEST\] The count starts once the first tester has joined; each field that changed is outlined red, with one line under Save: "You've changed the instructions, link or parts 3 times since testers joined. Contact support to change them again."
- &#91;AMENDED\] Critical fields are limited to 3 changes after the first join: red fields, the line under Save, enforced by the server, and an admin's "Allow 3 more" (10. Administrator console).
- &#91;AMENDED\] Save is faded and does nothing when no field changed.
- &#91;AMENDED\] The price caps and the over-$200 tick from Post apply here too; the tick is needed when a price is raised from at most $200 to over it.

**UI behavior**

- Existing tester deadlines can only be extended when the developer changes the deadline for new testers (shortening deadlines only applies for new testers and is ignored). Trying to lengthen the deadline past less than 3 days from when the test’s current open until date (measured from the test opened date) is not allowed with a red warning and \[update\] mentions when they can extend the Open Until date to allow it. \[IN I\]
- &#91;SUGGEST\] The red line reads: "Extend Open until to Nov 12 or later to allow a 10-day deadline."
- Only extending the recruitment period (Open Until) date is allowed with a red warning underneath if shortened \[IN I\].
- Live updates from every page's rules appear at a blue notice box under the save button at bottom of page. \[IN I\]
- Red warning from Post Test are still shown where applicable including leaving making required fields like What to Do blank, trying to save access keys under the number of open spots (fields can have both red warning and blue notices) \[IN I\]x3
- Updating a test while any new changes happen triggers a blue modal notice (live and on press) under the blue save notice box and. Race conditions with the dev updating this in another tab or device are also mentioned (in order of which updates happened first) where it mentions save happened somewhere else and they need to press it again to go through. The specific fields that were changed in another place are updated and have blue notices under them mentioning what changed (with expand arrows for long changes related to access keys) \[question\] do other fields need this? Fields that didn’t change in the other place remain updated on this tab. It’s especially important for access keys to  \[IN I\]x3\[IN V\]
- &#91;SUGGEST\] Yes for every field changed elsewhere, with an expand arrow only when the change is over two lines (keys, questions, instructions).
- &#91;AMENDED\] Built: Open until extend-only; shortening the deadline ignored for working testers; blue notes under fields changed elsewhere, with expand over two lines; live box under Save.
- An admin stopping this test for any reason should send the dev back to the test where it mentions save failed if they tried \[IN V\]
- Notice boxes: blue box under Save (live updates and stops), blue notes under fields changed elsewhere.

**Access keys**

- Access keys are now shown in separate In Use (read only) and Free (where you can add new keys or remove keys as long as the total number of free keys is greater than or equal to open spots) boxes. Free keys are assigned to new testers automatically; current testers whose key doesn't work are NOT given a new key automatically \[AMENDED owner Oct 26\]: the developer is told quietly (no stop) in the yellow box — how many testers reported keys not working, the 3 most recent named, then a dropdown with all of them — and each row has an "Assign a free key" button. \[SUGGEST\] Testers can report access keys as broken. Keys not working are greyed out and crossed out and when the dev assigns extras or they are automatically assigned, those disappear from the In Use box. If a tester with a broken key leaves the test, the in use key disappears but can later reappear if the tester confirms the key is still working before joining.
- The In Use access keys box is dynamically and automatically updated live and after changes happen from other places.
- Using access keys that are already in use, or given out to previous testers who left the test (even if still working) are not allowed. Using previous ones reported as broken also gives a red warning \[IN I\]x2
- &#91;AMENDED\] Built: In use (read only, broken greyed and crossed) and Free boxes that follow live; used, left or broken keys can't be re-added; no auto-assign for current testers; the quiet yellow box (count, 3 most recent, dropdown) with "Assign a free key" per row sits on 6. Developer test page.

## 6. Developer test page

The central place to run one test: what changed, what needs action, who is in it, calls and invites.

**Panels and buttons**

&#91;update in order and other parts\]

&#91;SUGGEST\] Order: overview (terms, status, Open until date, buttons) → live updates box → yellow broken-keys notice → Needs your attention → Testers → Live session → Invite testers → By question.

&#91;AMENDED\] Built in that order (overview → live box → yellow keys → Needs you → Testers → Live session → Invite → By question), all folds.

- Test overview panel: Current terms, status, deadlines, and recruitment information \[update\] with current look \[IN I\]
- &#91;SUGGEST\] "Current look" = the full site's header: title, status pill, who-can-join badge, category, part and deadline badges, keys-left badge, and the Open until date at the right (changed only through Edit) \[AMENDED owner Oct 26: the inline Change fold is removed\].
- &#91;AMENDED\] The overview shows status, badges and the admin banner, and the Open until date only. No pause countdown (the bell says when a paused test closes). A test closed by its pause says so here, and the developer gets the reason by bell plus a banner on this page. A chargeback hold's three steps show here as ✓/✗.
- Testers panel: Current testers, their status, which contract are they on (did they accept recent changes from the dev), submission and payment history (how much has been paid and did any payments recently fail), and rating information \[IN I\]
- Needs your attention panel: Submissions requiring review and other pending decisions. \[IN I\]
- Live sessions: Proposed times, requested calls, confirmed calls, and cancellations. \[IN I\]
- Invite testers: Search for testers, review their profiles, and send invitations. \[IN I\]
- End early button: End participation for a specific tester where permitted. \[IN I\]
- Next round button: Start a new test round using the current test as a template. \[IN I\]
- Alerts filter button: Configure which update notifications interrupt sensitive actions. \[IN I\] \[AMENDED\] Built as the Alerts menu.
- Stop the test for all candidates with a reason sent out to everyone, preventing the dev from inviting new candidates, and canceling and accepting/rejecting parts or calls and making requests (all previous calls are canceled). Edit, Next round, End early and Stop disappear and for testers from sending further parts and booking calls (dispites and excerpt requests are still allowed). \[IN I\]x2

**Pop-ups on this page**

- &#91;AMENDED\] Stop ("Are you sure you want to stop…") and End early ("End their work now") are confirm dialogs with live blue notices inside while open; a failed confirm follows the pop-up failure rule in 2. Every page.
- &#91;AMENDED\] Invite anyway is an inline box under Invite (not a dialog) with the same live notices. It updates to the needs still unmet and disappears when all are met; a press after a change shows the updated list with "Your press didn't go through"; any other failure closes it, with the notice under the original Invite button.
- &#91;AMENDED\] Block and Report moved to the tester's profile (9. Shared pages).

**What each panel holds**

- Needs your attention: every Pay/Reject for sent parts (one box, reason next to Reject, one press, "Paid so far"), applications (Accept/Decline), rejoin asks (with the time they'd get back), call requests waiting for an answer, calls waiting for a length or Pay, disputes waiting for the developer's side, broken-key reports.
- &#91;AMENDED\] Needs you is grouped per person. The Pay box starts at the listing (or the call's rate × length) and the developer can pay more; Ask $ is gone, so there is no asked amount.
- &#91;AMENDED\] Any Pay box over $200 shows the tick "I understand this payment can't be refunded and is charged now." every time; the payment is refused until it's ticked. While any failed payment is owed, part Pay and extra pay are disabled ("Pay what you owe first."); Reject still works. Pay and Reject are hidden while the developer is suspended.
- Testers: the avatar row (about 12 circles then +N, hover card with rating, accepted parts and profile link), then a scroll box of tester rows with a name search: required and not-required parts sent, paid per part and in total, contract version (switched or kept), call summary, "History (N)" fold (terms versions, offers, payments); "No longer working (N)" fold below.
- &#91;AMENDED\] The History fold holds terms, offers, Switch/Keep choices and payments; No longer working rows are tagged Left / Ended early / Stopped / Removed; the hover card no longer has Block (Block and Report are on the profile only).
- &#91;AMENDED\] Extra pay (Oct 27): in the Testers panel (current and past testers), each SENT part has an amount box and Pay, with "Paid so far for this part: $X" and "up to $Y"; unsent parts have none, and the row-level extra Pay is gone. Same charge path and 80/20 split; the tester's bell "\<dev> paid you $X extra for \<test>" is its own line. The cap is in 11. Rules the pages rely on (11.2). Hidden when suspended; "Pay what you owe first." during a hold or while a failed payment is owed; "This payment isn't available." when blocked either way.
- Live session: the rate line; tick testers (each with terms and "N of 3 booked") or Select all; request form (up to 3 time rows, each Once/Daily/Weekly with 2–8 calls or Forever; one typed length 10–180 min); waiting requests (Accept/Decline/Withdraw); booked calls (timer, who's in the room, Add to calendar, Cancel ▾; Join from 10 min before to 30 min after); after a call: log length (measured minutes, up to 150% of booked, within 24 h), Report a problem (No-show / Late); Past calls with who joined and outcome.
- By question: each written question with every tester's answer, time, "not required" mark and Paid / Rejected / Not reviewed yet.

* &#91;AMENDED\] "Chat with \<name>" sits on the tester hover card and the tester's profile and opens the same per-test chat as the Testers panel (the profile uses the most recent shared test and hides the button when there is none). A block either way, a suspension or any other refusal shows the blue "Unable to chat with this tester."
* Excerpt requests: not built in this version (testers can't request excerpts yet); post-launch.

**Invite testers**

- The invite panel has people you’ve worked with before at the top, suggested (with people who have matching language and tech requirements with the most number of them and highest ranked sorted to the top) \[question\] algorithm and has “in tests with you” with a drop down on tester rows under People you’ve worked with that shows number of tests and links to them underneath. Tester’s who don’t have test requirements show the missing requirements in orange labels on their rows. Shows greyed out rows with “Can’t join this test” for testers who are suspended or in 10 tests \[IN I\] x2 Open Question: Should we allow for more than 10?
- &#91;SUGGEST\] Algorithm. A tester *meets* the test with one required device and one required language (where any are required). *Score* = (3 × platform average + their stars) ÷ (3 + their ratings), so new testers start near average. *Invitable* = not in the test, not invited, under 10 tests, not paused; blocked or deleted testers never appear. Worked with: invitable first, then your rating of them, tests together, most recent. Suggested: top 5 invitable newcomers to you, filtered by the device/language ticks, by meets, score, accepted parts, matches. Find testers: name search plus ticks, invitable first, then meets and score.
- &#91;AMENDED\] Built: the invite algorithm, top 5 Suggested, "In N tests with you", greyed "Can't join this test".

**UI behavior**

&#91;update\] handle abbreviations everywhere and

&#91;SUGGEST\] Every number on the page uses the shared format (2. Every page); stat-like counts abbreviate, money being acted on stays exact.

- Under the test overview panel is the blue modal with live updates from all mentioned in 2. Every page \[IN V\]
- Under the overview panel (below live updates modal if both are up) is a notice in yellow listing all testers with access keys not working \[update\] needs expand box? And which all need expand boxes and other high limit UI
- &#91;SUGGEST\] The yellow notice shows 3 names then "Show N more"; the same 3-then-expand rule applies to the live box, stop boxes, Needs you and Invited; Testers, worked-with, Find results and Past calls are scroll boxes about 6 rows tall.
- &#91;AMENDED\] The yellow box is quiet (no stop): the count, the 3 most recent named, then a dropdown with all of them, and "Assign a free key" per row (keys rules in 5. Edit test).
- All the panels are drop downs. Needs you also has drop downs for each person and their sent parts. Becomes a scrollbox for more than 3 items listed \[IN I\]x2
- &#91;question\] which all sub forms and devs may get excerpt requests which also appear in needs you where they can approve or reject testers using tests \[IN V\]
- &#91;SUGGEST\] Excerpt requests appear in Needs you as their own item (Approve / Deny); sub-forms inside Needs you are Pay/Reject, application, rejoin ask, call request, call length and dispute side.
- In the live sessions panel they developer can make \[SUGGEST\] requests, accept/decline/withdraw, cancel, log lengths and report problems as listed above.
- Race conditions of accept/rejecting parts from needs you, booking/cancelling and requesting calls, and inviting people and the live updates from 2. Every page are shown under the buttons of each panel \[IN V\]\[IN I\]x3
- &#91;AMENDED\] A tester's dispute and the developer's side of it are stop-once reasons.
- Notice boxes: the live updates box under the overview panel; below it the yellow access-keys box; blue stop boxes under each pressed button.
- If test was stopped normally it just shows “Stopped” in the top panel. \[IN I\]. \[AMENDED\] Plus the stopped-test line of what can still be done (2. Every page).
- If test was stopped by an admin redirect to the top of the test overview panel where it permanently shows banner that admin stopped the test and any button presses that failed. Normal test stopped rules apply afterward. \[IN V\]
- Race conditions of stopping the test at the same time as an admin to be accounted.
- The top banner mentions if the test was paused by an admin (behaving like a stop). If the dev still has access to it in this case (wasn’t suspended) they can only stop the test \[IN V\]
- &#91;update\] Open question: what changes to all limits etc.
- &#91;SUGGEST\] Limits live in one table (11. Rules the pages rely on 11.5); any change there is announced to developers in the bell and on affected fields.
- Invite rows must be ticked to invite (typing never invites); "Invite anyway" confirms when a ticked tester misses a need and updates live (if everyone now fits, it closes with a blue line under Invite); the Invited list shows only waiting invites with Cancel invite; "Left this test" / "You ended their work" show beside those names; new invites are refused while the test is full; invitations close when the test or developer becomes ineligible and may be reissued when restored.
- End early: tick one or more testers (with All), one reason they read, confirm pop-up; their upcoming calls are cancelled; their work, payments and disputes stay.
- Next round: creates a draft copy with an updated round label; nothing goes public until published; records stay with the original round.

**Linked UI**

- Any actions the dev makes here should propagate to testers (tester session page and join page).
- The dev inviting testers should change their join page (7. Tester dashboard, Find tests and the join page).
- The test becoming full or empty based on inviting new testers or ending it early for current testers changes tester’s dashboards based on if they previously visited the test, and reveals the tests in Find Tests to new visitors.
- approved / reject excerpt only on notification bell \[update\]
- &#91;SUGGEST\] Excerpt decisions reach the tester only as a bell line; the developer's Needs you item disappears once decided.

## 7. Tester dashboard, Find tests and the join page

Testers see what to do next, find relevant tests, and join on clear terms.

### 7.1 Tester dashboard

&#91;update\] Tester Dashboard

&#91;SUGGEST\] Built like the developer dashboard:

- Stat tiles: Earned, Waiting for review, Rating, To do.
- **Charge or cancel:** a scroll box listing each test with parts past 14 days unreviewed ("Harbor Run · 2 parts"); each row links to that test's session page and scrolls to the part, where Charge / Cancel (Let it go) are pressed.
- To do (parts not sent yet, with deadlines), Waiting for the developer, upcoming calls, invitations (Accept opens the join page; No thanks), New tests for you, History.
- Tests the tester left or was removed from (before their deadline, not stopped, not rated) show Ask to rejoin; suspension removals sit at the top with a "Suspended" label until they rejoin or dismiss it.
- Payout problem banner when a payout fails (9. Shared pages).

&#91;AMENDED\] Built: stat tiles, payout banner, the "Charge or cancel" scroll box linking to the part, To do, Waiting, upcoming calls, invitations, New tests, Ask to rejoin, history. "Charge or cancel" lists a part once Charge has opened (the later of 14 days after sending and Open until; 11. Rules the pages rely on 11.1).

Notice boxes: the suspension or failed-press box at the top; the Charge or cancel list.

### 7.2 Find tests

- Each listing shows product and title, categories, required languages and devices, spots left, price per part, joining method, Open until and the individual deadline.
- &#91;AMENDED\] Find cards show product, joining method, Open until and Mature/NDA badges.
- Open public tests are listed; invite-only only through invites; paused, closed, full, deleted or stopped tests are not joinable and don't appear as such.
- Most relevant first: tests needing a device the tester has, then tests open to any device, then the rest, newest first within each; each card lists every unmet need.
- Tests the tester left show "You left this test".
- Notice boxes (Find and the join page): live updates box at the top; blue stop boxes under Join, Apply, Accept, No thanks, Ask to rejoin.

### 7.3 Join page (listing)

- Offers Join (anyone), Apply (approved only), Accept invitation / No thanks (invited), Ask to rejoin (left or ended before their deadline), or a reason it's unavailable (paused, closed, full, stopped).
- Layout follows the full site's listing (product, price block, badges, how it works, the developer's stats), without any offer or price-ask area.
- Joining checks requirements, spots (atomic: two people never take the last spot), Open until, NDA acceptance and the 10-test limit (also for applying, accepting invites and asking to rejoin).
- &#91;AMENDED\] The 10-test limit applies to Join, Apply, accepting an application or invite, and Ask to rejoin.
- A missing device or language opens a "Join anyway?" pop-up listing every unmet need; it updates live as the profile or the test changes and closes with a blue "You now meet this test's needs" line under Join when everything fits.
- &#91;AMENDED\] Join anyway ("What this test needs") rechecks the profile and the test while open ("Just updated") and disappears when all needs are met (Join keeps "You now meet this test's needs"). A press after the needs changed shows the updated list with "Your press didn't go through"; any other failure closes it, with the notice under the original Join button (pop-up rule in 2. Every page).
- Live top box and stop-once on every button for every test change except spots (only when it's now full) and Open until (only when it passes); a title change is info only.
- Invited testers see the invite; an invite after leaving shows Join on their old session page too.
- &#91;AMENDED\] Ask to rejoin: the developer accepts; the exact time left is returned; an invite plus an ask in either order joins at once; only before the deadline, never after a stop or rating.

## 8. Tester session page

Everything a tester does inside one test: see their terms, send work, run calls, get paid, leave or rejoin, rate.

**What it shows**

- Terms and product link, deadline with a countdown under 24 hours, any access key (with "This key doesn't work"), NDA accepted date.
- A Switch / Keep offer at the top whenever the developer offers new terms.
- "Your parts": each part's Required / Not required, in or not in their contract, sent or not, "Paid so far $Y", and status (draft, submitted, under review, accepted, rejected, paid, payment delayed).
- Each part panel repeats its term at the top ("Written answers: $8 · Required").
- Chat with the developer opens its own page (unread count on the button).
- &#91;AMENDED\] Order: test name → key box ("This key doesn't work" always goes through) → live box → Switch/Keep box; deadline countdown under 24 hours.
- Notice boxes: under the test name, the access-key box with "This key doesn't work"; then the live updates box (every change except contract changes) sitting directly above the Switch/Keep contract offer box; blue stop boxes under buttons.

**What a developer does that testers see (blue under their buttons, stop once)**

- Contract changes (Switch/Keep offer), paying or rejecting their work, call changes (requests made, withdrawn, declined, accepted, booked, cancelled), listing changes (description, devices, languages, who can join; title as info only). On the join page also: re-sent invites and closed applications. The test being stopped (or the tester's work ended early) appears as a blue line in the live box; every later press on that page (Send, calls, Switch/Keep, Leave) is refused in blue under the button, and the Switch/Keep offer box disappears. Spots matter only when the test is now full; Open until only when it passes.
- &#91;AMENDED\] A stopped or ended test shows the live line, a Stopped label and the still-allowed line, refuses later presses and hides the offer.

**Actions**

- Send written answers or a recording ("Send my answers" / "Send my recording", then "Send my updated answers" / "Send my updated recording"); sending after the deadline is allowed and labelled "Sent late".
- &#91;AMENDED\] Ask $ is removed from sends and call requests (Oct 26).
- Live session panel (same as the developer's, tester side): their rate ("Live call: $40/h"), Request a time (up to 3 rows, Once/Daily/Weekly with 2–8 calls or Forever, one length), Accept / Decline / Withdraw requests, booked calls with timer, presence, Add to calendar, Cancel ▾, Join (10 min before to 30 min after), Past calls; they see the length the developer logged and why.
- &#91;AMENDED\] Charge or Let it go on contract parts left unreviewed, once Charge opens: at the later of 14 days after sending and the test's Open until. A stopped or closed test still waits for its Open until. With no Open until, it opens when the test stops or closes or the tester's work ends (left, deadline passed, ended early). Up to listing minus what was already paid for that part (typed amount); reminders every 3 days; works after leaving too. Rules in 11. Rules the pages rely on (11.1).
- &#91;AMENDED\] While the developer owes a failed payment, Charge and Dispute on that developer's tests are disabled, with "delayed" wording.
- Dispute a rejected or underpaid contract piece once.
- Leave (in its own "Can't finish?" card, confirm pop-up): calls ahead cancelled; history and pay stay; the page stays with live updates.
- &#91;AMENDED\] Leave, Let it go and Rate and finish are confirm dialogs with live notices inside (the 3 newest, "Show N more"), like Stop and End early; a failed confirm follows the pop-up failure rule in 2. Every page.
- Ask to rejoin after leaving or being ended before the deadline (not after a stop or rating); the developer accepts; the session comes back on the current listing with the time they had left (details in 7. Tester dashboard, Find tests and the join page 7.3).
- Rate the developer once everything sent is decided or past the point where Charge opens and no dispute is open; the warning lists unsent contract parts (required ones marked) and that upcoming calls are cancelled; no rejoin afterwards.
- &#91;AMENDED\] Block and Report the developer: on the developer's profile only (9. Shared pages), no longer on this page.

**UI behavior**

- Live top box and stop once on every button for every test change except spots and Open until, developer payments or rejections, call changes, and their own actions in another tab; Leave stops only once.
- During a pause (hold or developer suspension), testers see only "This test is paused…": sending works, calls and joining don't, Charge and Dispute wait, Let it go, Leave, chat and Rate work.
- Testers never see the words "failed", "hold", "chargeback" or "suspended" about the developer.
- &#91;AMENDED\] Testers keep the "delayed" wording (owner confirmed Oct 27).

## 9. Shared pages

Pages both sides use, each with its own behavior.

**Header and side switch**

- One account can be a developer, a tester or both; the header has a switch between the two sides, each with its own nav, dashboard and pages; shared pages (messages, notifications, payments, profile, settings) belong to neither. A link to the other side's page switches sides and goes there. Each tab shows its side.

**Public profiles**

- Developer profile (as testers see it): Pays on average, Typical review, Rating ("4.6 ★ (12 ratings)") and comments without the rater's name.
- Tester profile (as developers see it): Accepted parts ("N of M sent · N sessions with accepted work") and Rating; bio; devices and languages.
- The developer's own Profile also shows the tester-limit card ("Can take up to N testers per test · Next: +10% after N more ratings").
- &#91;AMENDED\] The tester's profile (developer side) has "Chat with \<name>", opening the chat of the most recent shared test, hidden when there is none (6. Developer test page).
- &#91;AMENDED\] Block and Report live ONLY on profiles (the tester profile on the developer side, the developer profile on the tester side); they were removed from the find/test page, the session page and the Testers-panel rows and hover card.
  - Block keeps its confirm dialog. Its only stop is a race check: already blocked in another tab → blue notice "You already blocked X." under the button.
  - "Report \<name>" has a reason box (at least 5 characters) and Send to the team. Each person can report another once, ever. Afterwards: "You reported \<name> on \<date>." Race check: "You already reported X on \<date>."
  - The reported person is not told. The call's "Report a problem with this call" (no-show/late) stays on the call.
- &#91;AMENDED\] Admins also see admin-only boxes on profiles (10. Administrator console).

**Profile and settings**

- Name, pronoun, bio, devices and languages (testers), developer/tester sides; change password; email preferences (Off, or On with Daily / Weekly / Monthly; rules in 2. Every page); Contact us (emails the admin team); delete account.
- &#91;update\] (owner note) remove download my data from dev settings. \[SUGGEST\] Removed; data requests go through Contact us.
- &#91;AMENDED\] There was no "download my data" to remove. The profile's "Testing is now on for…" banner is removed.
- &#91;AMENDED\] Delete account: a confirm dialog, no stop-once (what deletion does is in 2. Every page).
- During a suspension: Contact us stays open; the profile editor is closed for testers.

**Messages**

- One chat per tester per test, only between the developer and testers who are or were in the test; unread counts on the Chat buttons; read-only for suspended accounts.
- &#91;AMENDED\] After a block, chat refuses and hides the box on both sides.

**Notifications (bell)**

- &#91;AMENDED\] Every bell line, stacking rule, reminder and the full bell table are in 2. Every page.

**Payments**

- Developer: card on file; a "Waiting for your review" panel listing every test with unreviewed parts and a Pay button to that test's Needs you; "Pay what you owe" during a hold; receipts and history; paid so far per part.
- &#91;AMENDED\] The "Waiting for your review" Pay is hidden and refused while the developer is suspended. "Pay what you owe" shows only during a payment hold or an unpaid failed charge. A chargeback hold's three steps show here as ✓/✗ (11. Rules the pages rely on 11.2).
- Tester: payout setup (Stripe), earnings and statuses; on a payout failure a banner "Your bank couldn’t receive a payout. Update your payout details." with a button to Stripe and a bell reminder every 3 days until fixed (money stays in their Stripe balance).

**Call page**

- "Call with Ana · booked for 60 minutes (paid up to 90) · the length is measured while you're both here", the embedded room or a link, the timer and presence; closes when the call is cancelled, blocked, or 24 h after its start.

## 10. Administrator console

Admins see every account (deleted too), act on suspensions, tests and disputes, and every action is audited.

**Dashboard layout**

- &#91;AMENDED\] Laid out like the other dashboards, top to bottom (Oct 27): Open disputes (newest first, scroll box); Lifts; Chargeback holds; Your actions (tests this admin paused or stopped, or whose developer they suspended, newest first, scroll box); Paused tests; then the rest (Payment holds, Reports, No-show reports, the suspension and dispute tools, accounts).
- &#91;AMENDED\] Every list shows pages of 25 with Previous / Next and "1–25 of N", and only that list reloads. Admin list rows link to the profile or test page they are about. Developers see nothing new.
- &#91;AMENDED\] Lifts: after a developer's 3rd payment hold, each later hold is a row in this scroll box once they have paid: the developer, "More than 3 holds", what was owed, when it was paid, a note box and Approve. If two admins press at once, the first wins. Lift bell lines link to the row.
- &#91;AMENDED\] Chargeback holds: card ✓/✗, owed ✓/✗, and Approve, refused until the first two are done. "Mark resolved" and "Close their tests" are gone.
- &#91;AMENDED\] Paused tests: each with its closing date, Extend (days, current pause only) and Close now.
- &#91;AMENDED\] The Payment holds list shows "More than 3 holds" where it applies and has no Approve.

**Accounts and tests**

- **Accounts:** profile and status; test history (live, stopped, paused); reports; suspensions with reason, time and admin; disputes; ratings; payments and balances; work submitted, reviewed and paid; participation including testers who left; deletion status and reason (owner- or admin-deleted).
- **Suspensions and tests:** suspend and lift with a recorded reason; pause, unpause and close tests; extend a paused test's closing date or close it now; preview a suspension's effects; held tester shares (refund or release).
- &#91;AMENDED\] Built: suspend with reason and preview, lift, delete with a reason; pause, lift and stop tests; refund or release held shares; "already decided by \<name> at \<time>" for a second admin; "Allow 3 more" critical-field changes for a test (5. Edit test).
- &#91;AMENDED\] Admin-only views (Oct 27; the per-test History view is gone):
  - On profiles, admin-only scroll boxes (newest first, pages of 25): payments, payouts, disputes, chargebacks, holds and suspensions (with the acting admin), tests posted or joined, and reports against them.
  - Testers' profiles also get a box of their sent parts with totals. A totals line on top shows money spent or paid out, plus counts of reports, disputes, chargebacks, holds and suspensions.
  - On a test's public page, admins see a timeline, contract changes and payments.

**Reports**

- &#91;AMENDED\] A "Reports" list next to No-show reports, in pages of 25: who reported whom, date, reason, links to both profiles, and the label; reason and status are kept per account. Admins get a bell line per new report, stacked one a day with the dispute and lift line.
- &#91;AMENDED\] The label "Reported more than 3 times" (profile reports plus call no-show/late reports) shows on names in dispute, report and lift rows and in the admin bell lines for them. Never the number; the exact count is only in the admin totals line on the profile. A report count is never proof by itself.

**Disputes**

- See submissions, payments and terms; the decision row shows listing, paid for this piece, paid for this part so far and the allowed range (from what was paid to listing minus what was paid on other pieces); blank keeps the pay; decisions and reasons are recorded and both sides told.
- Any admin can decide any dispute; the first decision wins and a second admin's press is refused ("already decided by Ana at 3:10 PM"). \[SUGGEST\] Keep this rather than assigning one random admin; add a soft "Ana is looking at this" marker post-launch.

**Notifications and admin accounts**

- &#91;AMENDED\] Contact us emails the admin group. Admin bell lines, the daily suspended-accounts review line, the chargeback email and the one daily admin email are in 2. Every page. Muting is post-launch.
- **Admin accounts:** proper authentication; a suspended admin is blocked from login and sessions and sees how to appeal.

Holds, chargebacks and suspensions: 11. Rules the pages rely on (11.2, 11.4).

## 11. Rules the pages rely on

The lifecycle, money, rating and restriction rules referenced above, plus every limit in one table.

### 11.1 Test lifecycle and deadlines

- States: Open (join, submit, review), Paused (admin or account restriction; no new commitments; records kept), Closed (developer stop, admin, deletion, or long pause; history stays), Draft (an unpublished next round).
- A tester's deadline starts at joining; existing testers keep theirs when the default changes; it's a guide (late work is labelled "Sent late").
- Open until is the recruitment cutoff; it can only be extended, before it passes.
- &#91;AMENDED\] Unreviewed contract work: Charge / Let it go opens at the later of 14 days after sending and the test's Open until. A stopped or closed test still waits for its Open until. With no Open until, it opens when the test stops or closes or the tester's work ends (left, deadline passed, ended early). The rating rule, the dashboard "Charge or cancel" box and the refusal use the same point. Tester reminders every 3 days; the developer's reminders are in the bell table (2. Every page). Nothing is charged automatically.
- &#91;AMENDED\] Paused tests close after 7 days, whatever the cause, unless an admin presses Extend (days, current pause only) or Close now. The daily job closes them like a Stop: testers read "ended" with no reason, and the developer gets the reason by bell plus a banner on the test page. Drafts are never closed. A test closed by its pause still says so on its card and page.
- A third pause, regardless of reason, stops the test under the current proposed rule. \[SUGGEST\] Remind the developer at 3 and 6 days and close at 14 days (admin can extend), replacing the build's 30-day admin alert.
- Open Question: Which rule should be authoritative? Finalize the relationship between the individual deadline, the three-day buffer, the two-day late-joiner extension, and the maximum recruitment period before implementation.
- Open Question: Can developers shorten an individual tester’s deadline if they provide at least 24 hours’ notice before the existing deadline?
- Open Question: What should happen to unreviewed work when a test closes automatically?

### 11.2 Money

- &#91;AMENDED\] Pay: one box per piece; the amount starts at the listing (or the call's rate × length) and developers can pay more; auto-pay is the listing; reason required to Reject; charged at once; nothing shows success before the result. Ask $ is removed from sends and call requests.
- &#91;AMENDED\] Verified: a developer can Pay or Reject sent work until the tester presses Charge or Let it go, unless the developer is suspended, including after Open until, after Stop, and after a pause closure.
- &#91;AMENDED\] Any Pay box over $200 shows the tick "I understand this payment can't be refunded and is charged now." every time; the payment is refused until it's ticked.
- A declined charge becomes owed: daily retry, 3-day pay-by date; a second failure or a missed cut-off starts a payment hold that pauses all the developer's tests until they pay what they owe (that box pays exactly what it shows).
- &#91;AMENDED\] Owed window (a declined charge, before the hold):
  - The developer gets a daily "Pay $X by … or your tests are paused", one line across all owed payments, stacked with that day's other lines.
  - While any failed payment is owed, part Pay and extra pay are disabled ("Pay what you owe first."), and Reject still works. The tester's Dispute and Charge on that developer's tests are disabled, with "delayed" wording. Testers never see "failed".
  - Automatic daily retries stop after the 3-day cut-off; the hold starts.
  - On a failure and on a retry success, both sides get the live notice and the first press stops once.
- &#91;AMENDED\] Payment hold: Reject takes effect at once. A Pay is recorded and charged when the account is clear ("Paid $8 · charged when your account is clear"; the tester sees "Payment may be delayed"), except that while a failed payment is still owed, Pay is disabled (owed window above). Admin dispute decisions that raise pay wait the same way.
  - &#91;SUGGEST\] (was "Paying during a hold or suspension") During a payment hold (and for Pay pressed from the Payments list during a suspension), the developer's Pay and Reject still go through as decisions; any other press by a suspended account sends them to the dashboard, whose top box names the failed press and explains the suspension; Reject takes effect at once, and a Pay is recorded but its charge waits until the hold or suspension lifts ("Paid $8 · charged when your account is clear"). The tester sees the part as paid with "payment may be delayed". Admin dispute decisions that raise pay wait the same way.
- &#91;AMENDED\] Hold count: after a developer's 3rd payment hold, every later hold needs an admin Approve even after they pay (a row in the Lifts box, 10. Administrator console). The developer's banner says the team will review after they pay.
- &#91;AMENDED\] Chargebacks: a chargeback is a hold with three steps to lift it: re-verify the card with 3D Secure, pay what is owed, then admin Approve. Paying alone never lifts it. The banner on the dashboard, Payments and every test page shows each step as ✓/✗. Approve is refused until the first two are done. A new chargeback clears an earlier card check.
  - &#91;SUGGEST\] The original spec called for a suspension plus card re-verification; pick one.
- &#91;AMENDED\] Charge cap (confirmed): listing minus what was already paid for that part. Dispute range: from what this piece was paid to listing minus what was paid on other pieces.
- &#91;AMENDED\] Extra pay cap (Oct 27): everything paid above the listing prices (normal Pay above the listing plus extra pays) may total at most 100% of the tester's current contract total (part prices plus the agreed totals of booked and held calls). Pay for work outside the contract doesn't count toward the cap. When blocked either way: "This payment isn't available." Where extra pay lives: 6. Developer test page.
- A suspended tester's pay is charged but their share is held until reinstatement (admin refunds or releases if never lifted).
- &#91;AMENDED\] Price caps (Oct 27): written and recording $1–$1,000 each; live calls $10–$200/hr (or free); $0.50 smallest charge; Stripe's per-charge maximum still applies. Post and Edit details: 4. Post a test.
- Testers only ever see "delayed", never "failed", "hold" or "chargeback". \[AMENDED\] Owner confirmed the "delayed" wording (Oct 27).
- Open Question: Is a 10-day refund period technically and commercially appropriate given the payment provider’s rules, the platform’s payout timing, and the possibility that tester funds have already been paid out?
- &#91;SUGGEST\] Fraud exposure: invite developers by hand at launch, lengthen tester payout delay, and add a new-developer spending limit or prepaid budgets before public developer sign-up.

### 11.3 Ratings

- &#91;AMENDED\] Testers rate the developer when everything they sent is decided or past the point where Charge opens (11.1) and no dispute is open; rating ends their participation (Charge, Let it go and Dispute stay).
- Developers rate a tester after the tester has rated, within 14 days (a Needs you item); both ratings reveal together, or the tester's after 14 days.
- 1–5 stars plus an optional comment shown without names; only real participation counts.

### 11.4 Restrictions and deletion

&#91;AMENDED\] Table updated: a suspended developer can't Pay or Reject (Oct 26); holds follow the owed window, hold count and chargeback rules in 11.2.

|  | Payment hold | Developer suspended | Tester suspended |
| --- | --- | --- | --- |
| Developer's tests | Paused | Paused | — |
| Developer can | Pay what you owe, Reject, Pay (charged when clear; disabled while a failed payment is owed), cards, Payments | Cancel call, End early, Stop, Contact us (Pay and Reject hidden and refused) | — |
| Testers in the test can | Send, Let it go, Leave, chat, Rate | Send, Let it go, Leave, chat, Rate | Removed from all tests |
| Waits until lifted | Charge, Dispute, calls, joins | Pay, Reject, Charge, Dispute, calls, joins | Pay for their work (share held) |
| On lifting | Tests resume; testers told "resumed" (a chargeback hold, or any hold after the 3rd, also needs the admin's Approve) | Tests resume; same | Re-invited where open with spots; others listed with "Suspended" and Ask to rejoin |

- Calls starting within 3 days of a suspension are cancelled with no fault.
- &#91;AMENDED\] Developer suspension pauses tests and cancels calls within 3 days with no fault; lifting resumes tests and shifts deadlines; reinstated testers are re-invited to open tests with spots (not invite-only), others listed with "Suspended" and Ask to rejoin; held shares released.
- Deletion stops the account's tests, cancels invites and applications, keeps history, and never clears holds, chargebacks or obligations.
- Open Question: Which safeguards stop abusive re-registration without blocking people who share devices or networks?

### 11.5 Limits

| What | Limit |
| --- | --- |
| Spots | 1–50 and the developer's tester limit (10 to start, +10% per 10 good ratings, max 50) |
| Tester deadline | 1–90 days; must leave 3 days inside Open until |
| Open until | future, at most a year ahead, extend only |
| Product, test name | 60 characters each |
| What to do | 1,000 characters |
| Categories | at least 1 |
| Written questions | 1–20 |
| Part price | \[AMENDED\] written and recording $1–$1,000, or free; over $200 needs a tick |
| Call rate | \[AMENDED\] $10–$200/h, or free |
| Any charge | $0.50 to $999,999.99 |
| Pay above the listing | \[AMENDED\] at most 100% of the tester's current contract total |
| Call length | 10–180 min; logged up to 150% of booked |
| Call requests | 3 time rows; repeats 2–8 or Forever; per tester 3 booked times and 3 waiting requests |
| Tests per tester | 10 at once |
| Recordings | 500 MB each, 5 per session |
| Text | rating comment 500, dispute 2,000, bio 1,000, contact 10–3,000 characters; report reason at least 5 |
| Critical field changes | 3 after the first tester joins |
| Reports | each person can report another once, ever |

## 12. QA, post-launch, open questions, launch priorities

### 12.1 Edge cases tested before launch

- **Payments:** failure then retry; two tabs paying one part; a tester or developer suspended mid-payment; a chargeback with pending work; a deleted developer with valid charges; a payout failure; an admin fixing a payment; a held share released or refunded.
- **Participation:** two testers for the last spot; joining just before Open until; recruitment or default deadline changed while testers join or work; leaving during a suspension; pausing mid-submission; closing mid-review; an invite accepted in one tab after it was cancelled in another; invite plus rejoin ask in either order.
- **Terms:** an offer replaced by a newer one before the tester answers; work sent during a change; reviewing at an outdated price; rejoining with the right terms restored.
- **Calls:** overlapping bookings; cancelling from another tab; a suspension before a call; joining a paused test's call; booking while terms are edited; a Forever set adding its next call; nobody joining by halfway.
- **Ratings:** complete and rate; developer doesn't rate in 14 days; leaving early; ended by the developer; closing with mixed paid, rejected and unreviewed work; ratings on deleted or suspended accounts; leave and rejoin without duplicate records.
- **Restrictions:** suspended on the test or payout page; a deleted user on an open page; two admins on one account; a lifted suspension; long pauses closing; a third pause.
- **Cross-device:** a phone action refreshing a desktop tab; a hold in every tab; a resume notice; drafts kept after a stale rejection; auth expiring mid-submission; network failure during upload or payment; an outage moving timers.

### 12.2 Post-launch

Tester notification preferences; admin outage recording; admin pay above listing; notification muting; more rating filters; question-based forums; group tests; advanced recruitment; automated risk controls; Themes and moments (transcribed recordings grouped into themes); admin "Payout problems" list; profile excerpts; spending limit or prepaid budgets; in-app admin messaging.

### 12.3 Open questions

- Business: higher prices for higher-rated testers; charging for work that isn't accepted; which tester stats are public; forums or group tests.
- Timing: the Open until ↔ deadline rule, 3-day buffer and late-joiner extension; a 30-day recruitment maximum; shortening deadlines with notice; review window length for extended tests; what happens to unreviewed work at closure; whether a third pause always closes.
- Payments: escalation on a first failure; card rules after a chargeback; collectible charges during a chargeback; refund window; refund exceptions; unresolved charges at account closure; pay when a developer ends early.
- Restrictions: escalation differences; appeals in-site vs email; a suspension landing mid-press; anti-abuse for deleted accounts; disputes and reports on paused tests.
- Ratings: scales and categories; early departures; tests ending without full completion.
- Content and storage: which content needs warnings or rejection; identity verification; recording retention and limits; resumable uploads; transcription with self-hosted open-source models; mobile layouts for complex panels; dispute recall; more than 10 tests per tester.
- &#91;AMENDED\] Not built (decisions open): large-total confirm, spending limit, auto-pausing inactive developers, excerpts.

### 12.4 Launch priorities

1. Core marketplace: posting, recruiting, joining, submissions, history.
2. Payments: charges, payouts, failures, balances, disputes.
3. Lifecycle: open, paused, closed, deadlines, late joins.
4. Contract integrity: stable terms, correct prices, no conflicting updates.
5. Restrictions: holds, chargebacks, suspensions, deletion, reinstatement.
6. Concurrency and alerts: cross-tab sync, stale forms, duplicate actions, failure notices.
7. Reputation: ratings and history.
8. Admin tooling: audits, reports, suspensions, disputes.
9. Mobile and recording reliability.
10. Post-launch items.
