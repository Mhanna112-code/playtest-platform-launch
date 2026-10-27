# Playtest Platform: how the app works, page by page

Oct 27, 2026 · @Mhanna112

## What Playtest is

Playtest is a marketplace where developers pay testers to try their games, websites, apps and other products. A developer posts a test: what to do, the parts to send (written answers, a recording, live calls), the price of each part, the deadlines and who can join. Testers join or apply, send their work and are paid for each part the developer accepts. At the end both sides rate each other.

- **Developers** post and run tests, invite testers, pay or reject work, and rate testers.
- **Testers** find and join tests, send work, take calls, get paid, and rate developers.
- **Admins** suspend and reinstate accounts, pause or stop tests, decide disputes, and review reports and payment holds.

One account can be a developer, a tester or both; a switch in the header changes sides (Shared pages).

**The main promise:** every press that touches money, joining, permissions or agreed terms is checked on the server against what is true right now. Nobody is charged twice, loses pay they earned because an account changed, accepts terms they didn't see, or sees a success that didn't happen.

## How to read this guide

- One tab per page, in the order people meet them: Developer dashboard, Post a test, Edit test, Developer test page, Tester dashboard, Find tests and the join page, Tester session page, Shared pages and Administrator console.
- Each page uses the same headings, skipping empty ones: what it's for and who sees it; what's on it; each button, and what it changes elsewhere; what can stop a press; how it looks in each state; the bell lines that open it.
- Every page explains once, with examples, what holds everywhere: notices, how state stays consistent (with a state map of tests, accounts, parts and calls), long lists, pop-ups, suspensions and holds, the bell and emails.
- Rules holds every number, cap and timer: test lifecycle, money, ratings, holds and suspensions, limits.
- QA and open questions lists the edge cases to test, the decisions still open and post-launch ideas.
- Testers never see the words hold, suspended, failed or chargeback about a developer. They see "paused" and "delayed".

## Every page

These rules hold on every signed-in page. Each page tab says which of them apply there and links back here.

### Notices

- **Blue:** something changed, or a press didn't go through. It sits right under the button that was pressed, and the page scrolls just enough to show it.
- **Red:** a mistake in a field (checked when you leave the field and when you submit), or a deleted account.
- **Yellow:** a list that needs attention, e.g. testers whose access key doesn't work.
- **Green:** a confirmation, e.g. "Saved."
- A failed press never shows success. It says why, keeps what was typed, and updates the page to what is true now.

### How state stays consistent

- **The server checks every press.** Before doing anything it re-checks what is true now: the tester's place in the test (working, left, ended, rated), the test (open, paused, stopped), holds, suspensions, blocks, spots, Open until, deadlines and limits. More in Why an old tab can't act on stale information.
- **Live box.** Changes made by other people, or by you in another tab, appear in a blue box at the top of the page as they happen: "Updated · 3:10 PM: Ana sent her written answers", newest first, with Dismiss. The page scrolls to it once, on its first update, never because of a press.
- **Stop-once.** The first press after a change you haven't seen stops once. A blue box under the button says "Since you opened this page:", lists the changes with their times, and ends "Press again to go ahead." The next press goes ahead unless something newer happened. Rate works the same way: on a test still open it stops once for every kind of change; after the test stops or closes, only for a Pay, Reject, Charge, Let it go or dispute.
  - Example: the developer presses Pay on Ana's answers just as Ana disputes her recording. Pay stops once with "Ana disputed the pay for her recording".
- **Always refused.** A change that makes the press impossible refuses it every time, not once: the test stopped, the work ended, the request was already taken, the offer was replaced.
  - Example: "Ben stopped the test on Oct 12. Work you sent is still reviewed."
- **Your other tab.** A press already made in another tab stops once with "You also did this in another tab: …".
- **Red wins.** Nothing saves while a field is red.
- **No double payments.** Each payment carries a one-time key, so a repeated press returns the first result instead of charging again.
- **Old tabs and Back.** Back and Forward show the saved page, then refresh it from the server; nothing on a restored page is trusted. More in Why going Back is safe.
- **Cross-tab sign-in.** Signing in as someone else switches every other tab of that browser to the new account, on the page the sign-in landed on. Signing out in one tab signs out every tab and sends them to the sign-in page. A press racing the switch is refused ("You're signed in as someone else in another tab. This page is switching to that account.") and that tab switches.
- **Title changes** never stop a press: it goes ahead with "Done. Also: the test was renamed to <title> at <time>."

### State map

Each object's states, and where people see them.

**Test**

| State | Meaning | Where it shows |
|---|---|---|
| Draft | A next round not opened yet | Developer dashboard card "Draft". It isn't a test page: it opens in Post a test, filled in, where Post the test opens it for testers. Not in Find tests; for testers its link is not found. |
| Open | Takes testers until Open until passes or it's full | Developer dashboard card: "Accepting testers". Find tests and the join page (Join, Apply); testers' session pages work normally. |
| Full | No spots left | Developer dashboard card: "Full". Not in Find tests. Join page: "This test is full." Invited testers: "<test> is full right now. Your invite stays open; we'll tell you when a spot opens." |
| Paused | An admin paused it, or its developer is on hold or suspended. It closes after 7 days. | Developer dashboard card: "Paused: account suspended / payment hold / chargeback hold / paused by the team". Admin pause: banner on the test page. Testers: "This test is paused right now." and a "Paused" tag on their dashboard; they can't send work (drafts can be saved), chat is closed both ways, and invites and applications wait. When it lifts, deadlines and Open until move later by the length of the pause. Not in Find tests; others opening the link see "This test isn't available right now." |
| Stopped | Stopped by the developer or an admin, or its developer was deleted | "Stopped" label and the still-allowed line on both sides (below). Testers get a live-box line and a bell line. |
| Closed | Closed after 7 days paused, or an admin pressed Close now | Like Stopped. Card: "Closed after 7 days paused". Testers read "This test ended on <date>." with no reason; the developer gets the reason by bell and a banner. |

**Account**

| State | Where it shows |
|---|---|
| Active | Everything works. For 3 days after reinstatement the dashboard shows "Your account is active again". |
| Email not confirmed | A strip: "Confirm your email: we sent a link to <email>". Post a test, Join, Apply and accepting an invite are refused (below). |
| Payment hold (developer) | Every signed-in page except the dashboard, Payments, Settings and the bell list moves to the dashboard top, with the blue box. All their tests are paused. |
| Chargeback hold (developer) | The same, plus the three chargeback steps on Payments. |
| Suspended (developer) | The same, whole account. |
| Suspended (tester) | The same pages close and move them to the dashboard top; removed from every test; developers see "Left this test". |
| Deleted | Every open tab logs out with a red "This account no longer exists". Others see "Deleted account". |

**Part (a piece of work in a tester's contract)**

| State | Where it shows |
|---|---|
| Not sent | Session page "Your parts"; tester dashboard To do. |
| Sent, waiting for review | Developer: the piece in Needs you (Pay / Reject) and the dashboard's Needs review. Tester: "Waiting for the developer". "Sent late" if after the deadline. |
| Paid | Tester: "Paid" and "Paid so far $Y"; developer: a receipt. |
| Payment delayed | The developer's card was declined (a hold starts). Tester: "Payment may be delayed". |
| Rejected | Tester: "Not accepted" with the reason; they can dispute it. |
| Charge open | 14 days after sending and after Open until. Tester: Charge or Let it go; the dashboard's "Charge or cancel". Developer: can still Pay or Reject until the tester chooses. |
| Charged | The tester charged up to the listing. During a payment or chargeback hold it's added to what the developer owes and paid when they pay; the tester sees "Charged $X. Payment may be delayed until the test resumes." Developer sees "<name> charged $X for this." |
| Let go | Closed with nothing more paid. |
| Disputed | Developer: the dispute in Needs you; admin: Open disputes. Decided: both are told. |

**Call**

| State | Where it shows |
|---|---|
| Requested | Waiting requests on both sides' Live session panels (Accept, Decline, Withdraw). Two requests for the same time book at once ("Booked: you both picked <time>"). |
| Booked | Both Live session panels and the developer dashboard's Calls box: timer, Add to calendar, Cancel ▾. |
| Joinable | From 10 minutes before to 30 minutes after the start: Join appears. |
| Cancelled | By either side, or by a pause, stop, end early, leave, block, outage, or nobody joining by halfway. Join disappears; a late press shows "This call was cancelled" with the reason. |
| Happened | The developer logs the length (within 24 hours) and pays; either side can report a problem. |
| Past | Past calls: who joined and the outcome. |

### Sign-in and accounts

- Sign up with email and password (or with Google, when it's switched on) and agree to the Terms of Use, then log in. Forgot password sends a link that works once and signs out every device. Changing the password signs out other devices.
- Email confirmation is needed only for Post a test, Join, Apply and accepting an invite. A blocked press shows, under the button: "Confirm your email first. We sent a link to <email>." with "Resend the link". The server checks too.
- On a local setup with confirmation switched off (SKIP_EMAIL_CONFIRM=1), a strip under the header says "Email confirmation is off for testing." It never shows in production.
- Names need at least 1 character, nothing else.
- Deleted account: every open tab logs out with a red "This account no longer exists".

  [image: Kai deleted their account in another tab: this tab is signed out with the red notice.]

### Long lists

- Every blue box (the live box, stop boxes, notices in pop-ups, notices under buttons) and the yellow keys box shows 3 lines, then "Show N more", which opens a scroll box about 8 lines tall.
  - Example: 12 testers report a key not working. The yellow box names the 3 most recent, then "Show 9 more".
- A list inside a row, such as the unmet needs on an invite row, shows 3 items, then "+N more".
- Dashboard boxes show the newest 3 rows, then "Show N more".
- Long names, titles and reasons are cut with "…" in rows (full text on hover) and shown in full where they are the main content.

### Pop-ups

- **Confirm pop-ups** (Cancel is focused; the confirm button is red): Stop and End early on Developer test page; Leave, Let it go and Rate and finish on Tester session page. While open they show live blue notices ("Just updated (3:10 PM): …", the 3 newest, then "Show N more"). If the confirm fails (an unseen change or any refusal), the pop-up closes and the blue notice "Your press didn't go through." plus the changes shows under the button that opened it.
- **Inline "anyway" boxes:** Join anyway on the join page and Invite anyway on Developer test page. They list the needs still unmet, update live, and disappear when all are met. A press after a change shows the updated list with "Your press didn't go through"; any other failure closes the box, with the notice under the original button.
- Block and Delete account also confirm, without live notices.

### Drafts, numbers and ranges

- Unsent text (written answers, chat, dispute text, rating comments, reject reasons, Post and Edit) is kept per person and form. When they come back to the page it returns, labelled "Not sent yet". Never on log in or sign up.
- Numbers use thousands separators. Money being paid or charged is always exact. Big stat tiles shorten: in full under 10,000, then k, M, B, T, then × 10^N, with no trailing ".0" (12,400 shows as 12.4k).
- Every box with a minimum or maximum shows the range next to it ("10–180 min", "at least $1.00").

### Suspended or on hold

A payment hold, a chargeback hold and an admin suspension do the same thing to a developer's pages, and a tester's suspension does the same to theirs. Causes, timers and lifting are in Rules.

- **Routing.** Every signed-in page except the open ones below moves them to the dashboard top, live and on load; on the dashboard it scrolls up. Every press is checked on the server, and a refused press sends them there too.

  [video: A payment hold starts while the test page (left) and Edit (right) are open: both move to the dashboard top, where the blue box explains.]
- **Blue box at the dashboard top** (never red). It says:
  - if they just pressed something, "Your <press> on <test> didn't go through";
  - their account is suspended, or on hold (payment or chargeback);
  - all their tests are paused, and testers stay in them;
  - how to resume: "Pay what you owe" (opens Payments in a new tab), the chargeback steps on Payments, or an appeal through Contact us in Settings;
  - after more than 3 holds: the team will review the account after they pay;
  - when it lifts, their tests resume as normal.
- **Open while it lasts:** the dashboard; Payments (receipts, Pay what you owe, Change card, payout setup); Settings (Contact us, the email setting, Delete account; the profile editor is hidden); the bell list, where a line whose page is closed opens the dashboard top. Change card works during a payment hold, a chargeback hold and a suspension, and a suspended tester can still set up payouts. The open pages other than the dashboard show one blue line under the header, e.g. "Your tests are paused until you pay what you owe. Pay what you owe." **Closed:** tester and developer profiles, session pages, Find tests and test listings, Messages and chat, Edit, test pages, Post a test. On their dashboard, names are plain text with no hover card, so there's no Chat with, Report, Block or profile link.
- **The only press that works on their tests:** Cancel call, in the dashboard's Calls box. Stop and End early aren't available, and Pay and Reject wait until it lifts.
- A hold limits only the developer side: on their tester side the same account works as usual. A suspension covers the whole account. A tester whose developer is suspended or on hold isn't restricted: they keep their session page, where the paused rules apply: they can't send work (drafts can be saved) or chat, and they can still cancel calls, dispute, Charge or Let it go, rate and leave (Tester session page).
- **A suspended tester**'s pages follow the same rules: the open pages above stay open, and every other page, their session pages included, moves them to the dashboard top. The blue box there says their account is paused, they were removed from their tests, how to appeal (Contact us in Settings), and that pay for work already accepted still reaches their Stripe account. Any other press is refused with "Your account is paused. Contact support if you think this is a mistake." Their dashboard is in Tester dashboard, Find tests and the join page.
- Testers never see hold, suspended, failed or chargeback about a developer. They see "paused" and "delayed".

### Stopped tests

- A stopped or closed test shows a "Stopped" label at the top and, under the overview, one line on what can still be done:
  - developer: "This test is stopped. You can still pay or reject work testers already sent, chat with them, rate testers, and read their answers."
  - tester: charge or let go once Charge opens, dispute, rate, leave (if still in), chat.
- Every other button and panel is hidden, so the page shows only what still works (Developer test page, Tester session page). An old page's press is refused in blue, naming the stop.
- Every press left runs the stop-once check, on stopped and paused tests alike (and the developer's Cancel call in the dashboard's Calls box during a hold or suspension). For example: the developer's Pay or Reject stops for a dispute, a Charge or a Let it go on that piece; the tester's Charge, Let it go and Dispute stop for the developer's Pay or Reject; Charge or Let it go is refused if the developer decided meanwhile ("<dev> paid $X for this meanwhile."); Dispute stops once when the developer adds their side; Rate stops once for a Pay, Reject, Charge, Let it go or dispute, and is refused while a dispute is open.

### Deleted accounts

- The deleted person: every open tab logs out with a red "This account no longer exists".
- A deleted developer: their tests stop and leave Find tests; testers see the stopped test and what they can still do; invites and applications close; chats become read-only; the profile shows "Deleted account" with ratings kept; unpaid work follows the money rules and an admin settles anything owed.
- A deleted tester: removed from every test (developers see "Left this test" and the name "Deleted account"); their work, payments and ratings stay; calls ahead, invites and applications are cancelled; open disputes are withdrawn; chats close. Sent work not paid yet can no longer be paid, charged or disputed. A delayed payment still reaches their Stripe account when the developer pays, if their payout setup is finished.
- Admins still see deleted accounts in full: who deleted them, why, and the history.
- Deleting never clears a hold, a chargeback or money owed. A developer can't delete their account while sent work waits for Pay or Reject (parts where Charge is open included), a dispute is open, or a hold is on; the warnings and refusals are in Settings on Shared pages.

### The bell

- **Reach.** A line about another person arrives only if that person is or was in one of your open tests. Invites, applications, payments and disputes always arrive, because they can come from outside an open test. Chat follows the same reach.
- **Every line opens the exact spot**, e.g. the developer's Needs you row, the tester's part, a call, the keys box, Payments. Each page tab lists the lines that open it.
- **Stacking.** Lines about one test on the same day stack into one entry that opens to show them. Lines of the same kind stack across tests, one entry per kind per day: payments and holds; the team's decisions; disputes filed; disputes decided; the team acted on your tests; the paused-test reminder; tester Paid, Not accepted, Payments delayed, Delayed payments arrived and Extra pay; tests stopped or ended; invitations waiting; Charge or Let it go; work waiting for your review; payout problems; the admin suspended-accounts review.
  - Example: Harbor Run and Sky Lab both pay Ana on Monday. Ana's bell shows one "You were paid" entry with both inside.
- Receipts, a pause being lifted or extended, and outages are always their own line.
- **Reminders wait while a test is paused** and start again when it runs again. The developer's daily paused reminder is the exception.
- **Reminders also go in the summary email** if the email setting allows it. Each line is emailed once; a Weekly or Monthly email shows only the newest copy of each reminder.
- Admin lines about disputes, reports and lifts show "Reported more than 3 times" next to names where it applies (Administrator console).

**Every bell line**

| Who | Line | When | Stacks in |
|---|---|---|---|
| Developer | "<tester> joined <test>" (also after an accepted application, invite or rejoin) | each time | that test's day |
| Developer | "<tester> applied to join" / "<name> asks to rejoin"; then "N applications wait for your answer" | each time; then daily while waiting | that test's day |
| Developer | "<tester> left <test>" (also after a suspension or deletion) | each time | that test's day |
| Developer | "<tester> sent / updated written answers / a recording" | each send | that test's day |
| Developer | "<tester> reports an access key not working" | each report | that test's day |
| Developer | Call lines: booked, cancelled (with reason), remaining calls cancelled, nobody joined, cancelled because the test is paused, missed because the site was down, a Forever call skipped for a clash | each time | that test's day |
| Developer | "<test>: review <tester>'s <part> within 1 month / 1 week / 3 days / by tomorrow", then "…waited over 14 days: pay or reject it" | 1 month, 1 week, 3 days and 1 day before Charge opens (skipping past ones), then daily | Work waiting for your review |
| Developer | "<test>: <tester>'s <part> still waits for you to pay or reject." (work outside the contract) | every 3 days | that test's day |
| Developer | "<test> closes on <date>: send your work before then." (Open until is near; testers get it too) | 1 month, 1 week, 3 days, 1 day before | that test's day |
| Developer | "<tester> disputed a payment on <test>" | each time | Disputes filed |
| Developer | "A dispute on <test> was decided" | each time | Disputes decided |
| Developer | "Receipt: you paid $X for …" | every charge that goes through | own line |
| Developer | "Your tests are paused" / "…paused after a chargeback" / "Another payment was declined: $X … was added to what you owe" / "Your bank reversed a $X payment …" / "Your tests are running again" | each time | Payments and holds |
| Developer | "The team approved lifting your hold" / "A note from the team about your hold" | admin Approve | The team decided |
| Developer | "<test> is paused and closes on <date> unless you pay what you owe" (or "…your account is cleared", "…the team lifts the pause") | when it pauses, then daily | Paused tests |
| Developer | "The team paused <test>" / "The team stopped <test>" / "<test> was closed. <reason>" | each time | The team acted on your tests |
| Developer | "The team lifted the pause on <test>" / "<test> will close later" | each time | own line |
| Developer | "<tester> finished <test>. You can rate them for 14 days.", then "Reminder: rate <tester>…" | when they rate; every 3 days after a stop, inside the 14 days | that test's day |
| Tester | "<dev> invited you to <test>" (or "…here's a new invite: <terms>" after an edit), then "Reminder: <dev> invited you…" | each invite; daily until answered | Invitations waiting |
| Tester | "<test> is full, so your application was closed" / "…is full right now. Your invite stays open…" / "A spot opened on <test>…" / "…listing changed, so your application was closed" / "…is now invite only…" / "<test> changed since you applied" | each time | that test's day |
| Tester | "You're in: <test>" / "You're back in <test>: your deadline is <date>." / "Your application (or ask to rejoin) wasn't accepted" | each time | that test's day |
| Tester | "<dev> updated the listing: <changes>" (new terms offered) | each Save that changes their terms | that test's day |
| Tester | "You have a new access key for <test>" / "Work sent: your …" | each time | that test's day |
| Tester | "You were paid for your <part> on <test>" | each time | You were paid |
| Tester | "Your <part> on <test> wasn't accepted" | each time | Work not accepted |
| Tester | "<dev>'s payment for your <part> ($X) is delayed. You'll be told when it arrives." / "Payment for your work on <test> may be delayed" | each time | Payments delayed |
| Tester | "<dev> paid $X for your <part>" (a delayed payment arrived) | each time | Delayed payments arrived |
| Tester | "<dev> paid you $X extra for <test>" | each time | Extra pay |
| Tester | "Your dispute on <test> was decided" | each time | Disputes decided |
| Tester | "<dev> didn't review your <part> in 14 days: charge $X or let it go", then "Reminder: …" | when Charge opens, then every 3 days | Charge or Let it go |
| Tester | "Rate <dev> on <test>", then "Reminder: rate <dev>…" | once; after a stop or close every 3 days, for 2 weeks | that test's day; its own line once stopped |
| Tester | "<test> is running again" | each time | Tests paused or running again |
| Tester | "<test> was stopped" / "Your work on <test> was ended early" / "<test> ended" | each time | Tests stopped or ended |
| Tester | Call lines (as for developers) and "Your session on <test> ended." (after a block) | each time | that test's day |
| Tester | "Your bank couldn't receive a payout. Update your payout details." | when a payout fails, then every 3 days until fixed | Payout |
| Both | "<name> · <test>: <first words>" (chat) | each message | that test's day |
| Both | "Your account is paused" / "Your account is active again" | each time | The team decided |
| Both | "The site was down from <a> to <b>. Deadlines and payment dates moved <length> later." | once per outage | own line |
| Admin | "Dispute on <test>: <tester> says the pay should be higher (<dev>)" / "New report: <a> reported <b>" / "Hold lift waiting: <dev> paid what they owe (More than 3 holds)" | each time | one line a day for all three |
| Admin | "N suspended accounts to review" | daily | Suspended accounts |

### Emails

- Each person picks Off, or On with Daily, Weekly or Monthly, under "How you're notified" on the Notifications page (Shared pages).
- With email On, each email lists every bell line since the last one ("Your Playtest summary: N updates"). Each line is emailed once.
- On Weekly or Monthly, payment lines also go out the same evening in "Your Playtest payment updates".
- With email Off, only the lines in the first part of the table are emailed ("Your Playtest account updates").
- Developer receipts, the tester's "You were paid…" and new reports for admins follow the setting.

| Email | To | When |
|---|---|---|
| **Ignore the setting** (sent even with Off, once, in one end-of-day email) | | |
| "Your tests are paused" (payment hold starts) | developer | when it starts |
| "Your tests are paused after a chargeback" / "…your payment hold is now a chargeback hold" | developer | when it starts |
| "Your tests are running again" | developer | when the hold lifts |
| "Your account is paused" / "Your account is active again" | developer or tester | suspension, reinstatement |
| "The team paused / stopped <test>" / "<test> was closed. <reason>" | developer | each time |
| Admin daily email: new disputes, lifts and chargeback holds waiting for Approve, call no-show and late reports (each once), accounts this admin suspended that still have paused tests, tests this admin paused (with closing dates) | each admin | once a day, only when it has something; can't be turned off |
| **Sent right away** | | |
| "Confirm your email" | the person | sign-up and Resend (at most 3 an hour) |
| "Reset your password" | the person | Forgot password (at most 3 an hour) |
| "Contact us: <topic>" | all admins | each message (at most 5 per account a day) |
| "Playtest: new chargeback of $X" | all admins | each chargeback |
| Any line for an address with no account | that address | at once |

### Outages and phones

- With outage checks on, a gap over 15 minutes moves every running timer later and cancels calls inside it with no fault. Everyone affected is told once.
- Every core task works on a phone; panels fold.

## Why an old tab can't act on stale information

Part of Every page.

- Every press goes to the server, which re-checks what is true now before doing anything: the tester's place in the test (working, left, ended, rated), the test (open, paused, stopped), holds, suspensions, blocks, spots, Open until, deadlines and limits.
- Each form sends the moment its page last updated. Anything newer stops the press once. Anything that makes the press impossible (the work ended, the test stopped, the request was already taken, the offer was replaced) refuses it every time.
- So an old tab can't rejoin, accept a replaced offer, accept a request someone else took, book a call on a stopped test, or pay twice: each payment carries a one-time key, and a repeated press returns the first result instead of charging again.
- Rejoining needs a current ask that the developer accepts. An old page's Join or Accept is checked against today's state and refused if it no longer applies.

## Why going Back is safe

Part of Every page.

- Back and Forward show the saved page at once, then refresh it from the server. Nothing on a restored page is trusted when a button is pressed.
- Signing out, or the account being deleted, ends the session in every tab; signing out sends every tab to the sign-in page. Signing in as someone else switches every other tab to the new account, on the page the sign-in landed on. A restored page of the old account is never trusted: its presses are refused and the tab switches.
- A hold or suspension moves a developer's open pages to the dashboard top, including a restored one.
- Restored forms keep only text the person typed and didn't send. Amounts, offers and call times are read again from the server before any action.

## Developer dashboard

### What it's for and who sees it

The developer's home: every test, what needs them, booked calls and their own numbers. Only the developer sees it; testers have their own dashboard.

From Every page: the live box, long lists, number format, and the blue box when suspended or on hold.

### What's on it (top to bottom)

- **Blue box**, only during a hold or suspension.

  [image: Payment hold: the blue box at the top of the developer dashboard.]
- **"Your account is active again · <time>"** for 3 days after a reinstatement.
- **Welcome line** with a "Post a test" shortcut next to the name.
- **Stat tiles:** Parts to review, Testers joined (all tests), Spent so far (accepted work), Pays on average, Typical review, Rating. Big numbers shorten. The tester-limit card ("Can take up to N testers per test") is on Profile (Shared pages).
- **Needs review:** one row per test with work waiting, e.g. "Harbor Run · 3 parts to pay or reject", newest first. Each row opens that test's Needs you.
- **Needs you:** applications, rejoin asks, call requests and disputes from every test, newest first. Each opens its row on the test page.
- **Calls:** every booked call, soonest first. Join appears only when the call can be joined. Each row opens the call on the test page, where it can be cancelled.
- **Your tests:** one card per test. Category icon left of the name; tags under the title (who can join, days per tester, Open until, keys left, invites waiting, applications, unread messages, Mature, NDA); a status label; feedback bars with stats at the bottom right. Clicking a card opens the test page.
  - Three very different tests (a game test with written answers, a recording and live calls; a free web-app test; an invite-only test with access keys).

    [image: A game test with written answers, a recording and live calls.]

    [image: A free web-app test (Finance, Productivity): its written answers pay nothing.]

    [image: An invite-only test with access keys and an NDA.]
  - An open test with work waiting, a full test, a paused test (payment hold), a stopped test.

    [image: An open test with work waiting for review.]

    [image: A full test: 2 of 2 spots taken.]

    [image: A paused test: the developer is on a payment hold.]

    [image: A stopped test.]
- There is no pause countdown; the daily bell reminder says when a paused test closes.

### Buttons

- **Post a test:** opens Post a test.
- **A test card:** opens Developer test page; a draft's card opens Post a test, filled in with the draft's details.
- **A Needs review or Needs you row:** opens that exact row on the test page.
- **Join** (Calls box): opens the call page.
- **Cancel ▾** (Calls box, only during a hold or suspension; otherwise it's on the test page): a reason box, required when the call is less than 24 hours away. The tester gets "<dev> cancelled the call on <day>: <reason>" and the call leaves both sides' pages.
- **Pay what you owe** (in the blue box): opens Payments in a new tab.

### What can stop a press

- Cancel stops once for any change to that call, with the change under the button.
- Always refused, in blue under the button: "The call with <name> was already cancelled."; "The call has started, so it can't be cancelled. Report a no-show instead if someone didn't come."; "The call is less than 24 hours away: say why you're cancelling (the other side sees it)."
- Join checks the call live and disappears when it's cancelled. A press after a cancellation shows "This call was cancelled" with the reason, under Join.

### How it looks in each state

- **Test** (on its card): Draft (a next round, not yet open); Open: "Accepting testers" (green) while at least one spot is free, "Full" (grey) when every spot is taken; Paused ("Paused: account suspended / payment hold / chargeback hold / paused by the team"); Stopped (a Stopped label); Closed ("Closed after 7 days paused").

  [image: Draft: the next round, not open yet.]

  [image: Closed after 7 days paused.]
- **Account active:** as above.
- **Payment hold, chargeback hold or suspended:** the blue box at the top; Needs review and Needs you are hidden; cards don't open; Calls rows get their own Cancel ▾, the only press on their tests (Stop and End early aren't available); names are plain text with no hover card; Post a test leaves the header. Every other signed-in page except Payments, Settings and the bell list moves them back here.
- **Deleted:** every tab logs out.

### Bell lines that open this page

- "Your tests are running again" and "Your account is active again": the top.
- "The site was down from <a> to <b>…": the top.

## Post a test

### What it's for and who sees it

A developer creates a test: the product, the work, the pay, who can join and the deadlines. These become each tester's terms when they join. Only accounts with the developer side on can post ("Turn on “post tests” in your profile to post a test."), and the email must be confirmed.

From Every page: red field checks, kept drafts ("Not sent yet"), ranges shown next to boxes, and email confirmation.

### What's on it

"* marks required" at the top. The form has four panels.

[image: The top of Post a test: “* marks the fields you have to fill in”.]

**What are testers trying?**

1. **Product** (up to 60 characters): the game, website, app or other product.
2. **Name of this test** (required, up to 60).
3. **What should testers do** (required, up to 1,000). Counters show on all three.

   [image: Counters on Product (up to 60), Name of this test (up to 60) and What should testers do (up to 1,000).]
4. **Link to the product or build** (must start with https://).
5. **Categories** (at least 1): Game, Productivity, Social, Entertainment, Education, Health & fitness, Finance, Shopping, Business, Developer tools, AI, Other.
6. **Languages** and **devices, platforms or skills** needed.
7. **Mature (18+):** ticking it shows a required "why" box at once. The line under it: no sexual content involving minors, no illegal content, no real-world gore; graphic content must be marked Mature. The Terms of Use say the same.

**Deliverables (parts)**: up to three.

- Written answers (1–20 questions, each required or optional), a Recording (with think-aloud), Live calls.
- Each part is a card with its tick, a price (calls: "up to $ /h"), a Free tick and a Required tick. Required is only a label: it blocks nothing, and shows on the listing, in testers' terms, on their session page and on the developer's tester rows. Free parts are clearly marked before a tester commits.
- Prices: written and recording $1–$1,000 each, calls $10–$200 an hour, or free. Each field shows its range.
- A price over $200 needs the tick "I confirm this part pays more than $200." when it's set over $200 or raised from $200 or less to over it.

**Who and how long**

- **Spots:** up to the developer's tester limit (10 per test to start, grows with good ratings, at most 50). The limit shows under the field.
- **How long do new testers have?** 1–90 days after joining.
- **Open until:** the last day to join.
- **Who can join:**
  - Anyone can join: join at once while open with spots; first come, first served.
  - Approved only: testers apply; the developer accepts or declines.
  - Invite only: not in Find tests; only invited testers join.
  - Any test can also invite. An invite plus a waiting application or rejoin ask joins the tester at once.

**Optional**

- **NDA:** text testers accept on Join, Apply and Ask to rejoin. The NDA template gets a legal review before launch.
- **Access keys:** one per line; each new tester gets a free one.

All numbers are in Rules.

### Buttons

- **Post the test:** checks everything, then opens the test, lists it according to who can join (Find tests for Anyone and Approved only; invites only for Invite only) and goes straight to the new test's page. There is no summary step: the developer reviews the fields they filled in on this page before pressing it.

  [video: Filling in the four panels, pressing Post the test, landing on the new test's page.]

  [image: Anyone can join: the new test shows in testers' Find tests.]

  [image: Invite only: not in Find tests; the invited tester sees the invite on their dashboard.]
  - Elsewhere: the test appears in Find tests and in matching testers' "New tests for you" (Tester dashboard, Find tests and the join page), and the developer lands on Developer test page.

### What can stop a press

- **Red, at the field** (when you leave the field, and on Post; the server checks too).

  [video: Each box turns red when you leave it; Post then finds what only the server checks (a link without https://, a key typed twice).]

  [image: Red when you leave the field: required fields empty, a price under $1, spots over the limit.]

  [image: Red: a 10-day deadline needs Open until later, and there are fewer keys than spots.]
  - A required field left empty.
  - A price outside its range, or over $200 without the tick.
  - The deadline doesn't leave 3 days before Open until: "Set Open until to Nov 12 or later to allow a 10-day deadline."
  - Spots over the limit.
  - Fewer access keys than spots; a key typed twice ("<key> is typed more than once. Each key goes in once."); a key that's too long.
  - A link not starting with https:// ("The build link must start with https://").
  - Above the button: "Fix the N mistakes above…".
- **Blue, under the button:** "Confirm your email first. We sent a link to <email>." with "Resend the link" under the button.

### How it looks in each state

- **Account active:** the form.
- **Payment hold, chargeback hold or suspended:** the page is closed; opening it moves the developer to the dashboard top, and Post a test leaves the header.
- **A draft** (a Next round not opened yet) isn't a test page: it opens here, filled in with its saved details. Its card, its link, its Edit page and Next round all land here. Post the test opens it for testers. The draft can also be deleted here (confirm pop-up).
- A new test starts Open. Later changes go through Edit test.

## Edit test

### What it's for and who sees it

The developer changes a test's listing. Edits apply to new testers; working testers get an offer to Switch or Keep. The fields and red checks are the same as on Post a test. Only the test's developer sees it.

From Every page: the live box, stop-once, red field checks, kept drafts, long lists, and the blue box when suspended or on hold.

### What's on it

- "← Back to the test", the title "Edit “<title>”", the Alerts menu (Developer test page), and a note that Edit changes the listing for new testers only.
- The Post form, filled in.
- **Access keys** in two boxes:
  - **In use** (read only): keys given to working testers. Keys reported as not working are greyed and crossed out. It follows changes live.
  - **Free:** add keys, or remove them while the free keys still cover the open spots. Free keys go to new testers automatically.
- **"Changes left: N of 3"** next to the label of each limited field (the steps, NDA, questions, languages and devices), once a tester has joined.
- **Save**, faded and doing nothing while nothing changed.
- **The live box** sits under Save.

  [image: Edit's live box sits under Save: Ana sent her written answers while Edit was open.]

### Buttons

- **Save** changes the listing for new testers. Elsewhere:
  - **Working testers whose own terms change** (work, parts, prices, Required labels, deadline, requirements, NDA) get an offer at the top of their session page, Switch or Keep (Tester session page), and the bell line "<dev> updated the listing: <changes>". A tester whose terms don't change gets no offer. Work already sent keeps its price. A newer Save replaces a waiting offer.
  - **A changed NDA** is always a new offer, never applied silently.
  - **Earlier questions, answers and NDAs** stay in the tester's Terms history.
  - **Waiting applications** close when prices, parts, questions, the deadline, devices, languages, the description or the NDA change, or when the test becomes Invite only. The tester is told ("<test>'s listing changed, so your application was closed…" / "<test> is now invite only, so your application was closed.").
  - **Open invites** are sent again on the new listing ("<dev> updated <test>, so here's a new invite: <terms>").
  - **Switching to Anyone can join** lets waiting applicants in ("You're in: <test>") or tells them "<test> changed since you applied".
  - **More spots** tells invited testers "A spot opened on <test>…"; filling the test closes applications and keeps invites open.
  - **Title only** changes are info for everyone and never stop a press.
  - Under Save: "Saved. Offered the new terms to N…". When a tester later Switches or Keeps, the top box shows "Ana switched to the new terms" with "See their contract", which opens the test page at that tester's row in a new tab. The same line, with the same link, also shows in the notice under a pressed button when a press stops once for it.
- **3 changes per field after the first join.** Once a tester has joined, each of these fields has its own 3 changes: what to do (the steps), the NDA, questions, required languages, and required devices and technology. One Save that changes two of them uses one change of each. Each field shows "Changes left: N of 3" next to its label, and the counts update live when another tab saves. A field at 0 locks on its own, with the note "You've changed the <field> 3 times since testers joined. Contact us in Settings to change it again."; the other fields stay editable. Part prices, parts and the build link aren't limited; changing prices or parts still sends working testers the Switch / Keep offer. Access keys aren't limited either: a key given to a tester stays theirs, so adding keys never changes anyone's terms. An admin's "Allow 3 more" gives every field at 0 three more changes (Administrator console).

  [image: After 3 saves that changed the steps: “Changes left: 0 of 3” near Save and the locked note.]

  Updated: each limited field now has its own 3 changes, with "Changes left: N of 3" next to its label; only the field at 0 locks.
- **Dates.**
  - Open until can only move later, before it passes: "Open until can only be extended: it's <date> now." Once passed: "Joining closed on <date> (Open until), so it can't be extended."

    [image: Open until can only move later: an earlier date is red.]
  - A new deadline applies to new testers. It can lengthen working testers' deadlines but never shorten them. It must leave 3 days before Open until: "Extend Open until to Nov 12 or later to allow a 10-day deadline."

    [image: A 30-day deadline needs Open until 3 days later: red under both fields.]
- **Access keys.** A key that's in use, was given to a tester who left, or was reported as not working can't be added again (red). Testers whose key doesn't work never get a new one automatically; the developer assigns one from the yellow box on Developer test page. When such a tester leaves, the key leaves In use; it comes back only if they confirm it works when they rejoin.

  [image: A key in use can't be added again (red).]

  [image: Keys reported as not working, or given to a tester who left, can't be added again.]

### What can stop a press

- **Changed in another tab or device.** Save stops once. Each field changed elsewhere updates here with a blue note under it, "Changed in another tab or device at <time>", saying what changed (an expand arrow when it's over two lines: keys, questions, instructions). Fields not changed there keep what you typed. Under Save: "This test changed since you opened Edit. Press Save again to save your changes on top."

  [video: Two tabs on Edit; the right one saves new instructions and keys, then the left one's Save stops once and its fields update with blue notes.]

  [image: Another tab saved new instructions: the field updates with a blue note under it.]

  [image: Keys added in another tab: the blue note under the key boxes.]

  [image: Save stops once: “Since you opened this page” lists the other tab's saves; press Save again to save on top.]
- **Other changes** (joins, work sent, calls and so on, as set in Alerts) stop Save once, listed under it.
- **A field can be red and blue at once**, e.g. fewer access keys than open spots after another tab added spots.

  [image: You ticked a key to remove; another tab added a spot (blue): now fewer free keys than open spots (red).]

  [image: You typed a 40-day deadline; another tab moved Open until later (blue), still too early for it (red).]

  [image: You ticked one key to remove; another tab removed another (blue): the free keys no longer cover the open spots (red).]
- **Always refused:** "This test was stopped." If an admin stops or pauses the test while it's being edited, Save is refused and the developer goes back to the test page, whose banner names the press that didn't go through.

  [video: The team stops the test while Edit is open; Save is refused and the test page's banner names the Save that didn't go through.]

### How it looks in each state

- **Open:** the form. **Draft:** a draft's Edit page opens Post a test, filled in with its details.
- **Paused by an admin:** Save is refused ("The team paused this test: you can only stop it.").
- **Stopped or closed:** red "This test was stopped." and no form.
- **Payment hold, chargeback hold or suspended:** the page is closed; the developer moves to the dashboard top.

### Bell lines that open this page

None; bell lines about a test open the test page.

New-tester side: what changed shows on the join page and in Find tests (Tester dashboard, Find tests and the join page).

## Developer test page

### What it's for and who sees it

The place to run one test: what changed, what needs the developer, who is in it, calls, invites and answers. Only the test's developer sees it (admins see their own boxes on the public test page).

From Every page: the live box, stop-once, long lists, pop-ups, number format, stopped tests, and the blue box when suspended or on hold.

### What's on it (top to bottom; every panel folds)

1. **Overview**: title, status pill, who-can-join badge, category, part and deadline badges, keys-left badge, "terms · spots", and "Open until <date>" on the right (changed only in Edit test). Buttons: Edit, Alerts, Next round (or "Go to the next round"), End early, Stop.

   [image: Overview: title, status, badges, terms and spots, Open until, and the Edit, Alerts, Next round, End early and Stop buttons.]
2. **Banners** when they apply: the team stopped or paused the test; the test was closed after a pause (with the reason); the stopped line; "<test> closes in …" when under 3 days are left.
3. **Live box**. It also shows contract news, e.g. "Ana switched to the new terms" with "See their contract" (scrolls to Ana's row with her contract shown), and a new dispute, linking to its Needs you row. When a press stops once for a switch or keep, that line in the notice under the button has the same "See their contract" link.

   [video: Ana (right, phone) sends her answers and switches to the new terms; the developer's live box updates and See their contract scrolls to her row.]
4. **Yellow keys box** (quiet, never stops a press): how many testers report a key not working, the 3 most recent, "Show N more", and "Assign a free key" on each row. Key rules are in Edit test.
5. **Needs you**, grouped per person, each with a fold for their sent parts: Pay or Reject for each sent piece; applications (Accept, Decline); rejoin asks (with the time they'd get back); call requests; calls waiting for a length or for Pay; disputes waiting for the developer's side; testers waiting to be rated.

   [image: Needs you, grouped per person: Pay or Reject for sent work, a call waiting for its length, a dispute waiting for the developer's side.]

   [image: On an Approved-only test: applications to Accept or Decline, and a rejoin ask with the time they'd get back.]

   [image: A dispute waiting for the developer's side, and a call that happened waiting for its length.]
6. **Testers**:

   [image: Testers: the avatar row with Ana's hover card, and one row per tester with parts sent, pay and their contract.]
   - An avatar row (about 12, then +N). Each hover card shows rating, accepted parts, the profile link and "Chat with <name>".
   - A scroll box of tester rows with a name search: required and optional parts sent, paid per part and in total, the agreed scope (their current contract, switched or kept), a call summary, Rate, and Extra pay on each sent part.
   - "No longer working (N)" below, each row tagged Left, Ended early, Stopped or Removed.
7. **Live session**: the rate line; tick testers (each with their terms and "N of 3 booked") or Select all; the request form; waiting requests; booked calls and call sets; Past calls. Calls can be requested with any tester, whether or not a live call is a listed part. Each tester shows "Live call · $X/h" when a call is listed and in their contract, otherwise the label "Not listed"; any part not listed in a tester's contract carries the same label. The $100 cap is said only when a Pay goes over it.

   [image: Live session: tick testers, request times, a waiting request, booked calls (Join shows near the start).]
8. **Invite testers**: three lists, "People you've worked with" (with "In N tests with you", a fold linking those tests), "Suggested" (top 5) and "Find testers" (name search plus device and language ticks); then "Invited" (waiting invites).

   [image: Invite testers: People you've worked with and Suggested, with orange labels for missing needs.]

   [image: Find testers by name: Dee is ticked; the orange label shows the need they miss.]

   [image: Invite anyway: the inline box lists the needs Dee doesn't meet.]
9. **By question:** each written question with every tester's answer, its time, a "not required" mark and Paid, Rejected or Not reviewed yet.

### Buttons

**Overview**

- **Edit:** opens Edit test.
- **Alerts:** "Tick what should not stop your buttons." Kinds: Joins and applications; Testers leaving; Work sent; Call changes; Payments (going through or failing); Disputes; Decisions by the team; Your saves and presses in another tab; Listing changes. Ignored lines still show, greyed, in the live box. A hold or pause, a closed tester account, a stopped test and final refusals always stop. Under each stop box: "Don't stop me for: <kind>".

  [image: Alerts: tick what should not stop your buttons.]
- **Next round:** makes a draft copy titled "(round N)" and goes straight to Post a test, filled in with its details; nothing is public until the developer presses Post the test there; records stay with the original round.

  [image: Next round: a draft copy “(round 2)”, hidden from new testers until Accept testers again.]

  Updated: Next round now opens the draft in Post a test, filled in; Post the test there opens it for testers.
- **End early** (confirm pop-up "End their work now"): tick testers (or "All (N)") and give one reason they read. Their work ends; calls ahead are cancelled; what they sent still waits for review; unsent parts close with no pay; they can be invited back later. Tester bell: "Your work on <test> was ended early"; calls: "…cancelled because your session was ended."

  [image: End early: one tester ticked, a reason given, then the confirm pop-up “End their work now”.]
- **Stop** (confirm pop-up "Are you sure you want to stop “<test>”?"): ends every tester's work, cancels every call and request ahead, takes no new testers, and can't be edited or reopened. What was sent still waits for Pay or Reject. Testers: "<test> was stopped" and the stopped line on their page. Edit, End early and Stop disappear, and so do Invite testers and the call-request tools; Next round stays.

  [image: Stop: the confirm pop-up “Are you sure you want to stop …?”.]

  [image: The tester's page after Stop (phone): the stopped line says what they can still do.]

**Needs you**

- **Pay:** the box starts at the listing (or the call's rate × length; empty for a call that isn't a listed part). Paying less than the listing needs a reason the tester reads. Paying more is extra pay (cap below). Over $200, the tick "I understand this payment can't be refunded and is charged now." is needed every time. The card is charged at once; nothing shows success before the result. Tester bell: "You were paid for your <part> on <test>"; developer: a receipt. "Paid so far" updates on both sides.
- **Reject:** needs a reason the tester reads. Tester bell: "Your <part> on <test> wasn't accepted"; they can dispute it.
- **A declined card** starts a payment hold at once: "Your card was declined, so <name> wasn't paid $X for the <part> yet. Your tests are paused until you pay what you owe: open Payments." The tester sees "payment may be delayed". Holds are in Rules.
- **Accept / Decline an application or rejoin ask:** Accept joins them ("You're in: <test>" or "You're back in <test>: your deadline is <date>."); Decline tells them it wasn't accepted.
- **Add your side** to a dispute, once. The tester's next dispute press stops once; an admin decides (Administrator console).
- **Call length:** the measured minutes, up to 150% of booked, within 24 hours of the start (after that the booked length is used).
- **Rate** a tester after they rated, within 14 days: 1–5 stars and an optional comment; both ratings then show.

**Testers**

- **Extra pay** on each sent part (current and past testers): an amount box and Pay, with "Paid so far for this part: $X" and "up to $Y". Unsent parts have none. Over the cap: "This is more than you can pay above the listing (up to $Y)." Tester bell: "<dev> paid you $X extra for <test>". Cap in Rules.
- **Chat with <name>** (hover card, row, profile): opens the per-test chat. After a block either way, a suspension or any other refusal: "Unable to chat with this tester."

**Live session**

- **Request a time:** up to 3 time rows, each Once, Daily or Weekly (2–8 calls, or Forever), and one length (10–180 min). The tester gets the request; if they asked for the same time, it books at once ("Booked: you both picked <time>").
- **Accept / Decline / Withdraw** a waiting request. Accepting books it; the other side is told.
- **Booked calls:** timer, who is in the room, Add to calendar, Join (10 minutes before to 30 after), Cancel ▾ (reason required under 24 hours), "Cancel the remaining calls" for a set.
- **After a call:** log the length; **Report a problem** (No-show, Late, a note), once, after the call's start. Admins see reports in their daily email.

**Invite testers**

- Rows must be ticked (typing never invites). Missing needs show as orange labels (3, then "+N more"); testers who can't join (suspended, or in 10 tests) are greyed with "Can't join this test".
- Order: a tester **meets** the test with one required device and one required language (where any are required). **Score** = (3 × platform average + their stars) ÷ (3 + their ratings), so new testers start near average. **Invitable** = not in the test, not invited, under 10 tests, not paused; blocked or deleted testers never appear.
  - People you've worked with: invitable first, then your rating of them, tests together, most recent.
  - Suggested: the top 5 invitable testers new to you, filtered by the ticks, by meets, score, accepted parts, matches.
  - Find testers: invitable first, then meets and score.
- **Invite:** the tester gets "<dev> invited you to <test>" and a daily reminder until they answer. A ticked tester who misses a need opens the inline Invite anyway box (Every page). If the tester had applied or asked to rejoin, they join at once.
- **Cancel invite** on the Invited list. "Left this test" or "You ended their work" show beside those names.
- Invites close when the test or the developer can't take testers, and can be sent again when that's restored.

### What can stop a press

- **Stop-once** on every button (Stop, End early, Next round, Pay, Reject, Extra pay, call buttons, Invite, Assign a free key) for any unseen change: a tester joined, left, applied, sent or updated work, booked, requested or cancelled a call, switched or kept terms, charged or let go, disputed, said no thanks; the team decided; the test filled; payments went through or failed; your own press in another tab. The changes are listed under the button. On a stopped test every press still allowed stops once the same way: Pay, Reject, Extra pay, a call's length, a dispute's side and Rate.

  [video: Ben (right, phone) sends his answers while the developer presses Pay for Ana; Pay stops once and lists the change, the second press goes ahead.]

  [image: Pay stops once: Ben sent his answers since the page loaded.]

  [image: Cam left while the Stop pop-up was open: the press didn't go through and the change shows under Stop.]

  [image: Invite stops once: Fay removed iPhone and iPad from her profile after the page loaded.]
- **Invite** also stops for: "<name> removed <X>, which this test needs", "<name> joined this test…", "<name> can't be invited right now", "<name> can't join more tests right now".
- **Always refused** (blue, under the button):
  - "This test was stopped."; "The team stopped this test."; "The team paused this test: you can only stop it."
  - "<name> already left the test."; "<name>'s work already ended."
  - "<name> already charged $X for this."; "<name> let this go: nothing was charged."; "You already paid $X for this."; "You already rejected this."
  - "<test> is full. Add spots to invite more people."; "Joining closed on <date> (Open until), so nobody can be invited."
  - Call lines: "This time isn't available."; clashes ("You already have a call with <name> at <time>."); "You already have 3 requests waiting with <name>…"; "<name> already has 3 booked times with you…"; "This call closed 24 hours after its start: the booked length is used."
  - Keys: "You have no free keys. Add some in Edit first."; "Every free key is kept for the N open spot(s). Add more keys in Edit first."
- If the developer and an admin stop the test at the same time, the first wins and the other press is refused.

### How it looks in each state

- **Draft:** not a test page. Its card, its link and its Edit page open Post a test, filled in with the draft's saved details.
- **Open:** as above.
- **Paused by the team:** a banner "The team paused this test: it behaves like a stop, and you can only stop it." Only Stop works, and chat with testers is closed. Testers follow the paused-test rules (Rules).

  [video: The team pauses the test; the developer's End early is refused and the banner explains.]
- **Stopped:** the page shows only what still works. Gone: Invite testers, the call-request tools in Live session (Past calls stay), Edit, Stop and End early. Left: the Stopped label and the stopped line, Next round (it starts a new draft from this test), Needs you (Pay, Reject, a call's length, a dispute's side), the Testers panel (rows, Rate, Extra pay), chat, Alerts and the answers.

  [image: Stopped: the Stopped label and the stopped line; the overview buttons are gone and Live session says no calls can be booked.]

  Updated: on a stopped test Next round stays, and Live session shows only Past calls: the request tools and the "no calls can be requested or booked" line are gone.
- **Stopped by the team:** the page moves to the top of the overview, where the banner "The team stopped this test." stays and names any press that didn't go through. Then the stopped rules apply.

  [video: The team stops the test while a call is being requested; the request is refused and the banner names the press that didn't go through.]
- **Closed after a pause:** like stopped, with the reason in a banner.
- **Payment hold, chargeback hold or suspended:** the page is closed; the developer moves to the dashboard top.

### Bell lines that open this page

- A tester joined, rejoined or left → that tester's row.
- An application, rejoin ask, or "N applications wait for your answer" → Needs you.
- Work sent or updated, "review … within…", "…waited over 14 days…", outside-contract work waiting → that piece in Needs you.
- A dispute filed → its Needs you row; a dispute decided, "<tester> finished… You can rate…" and the rate reminder → the tester's row.
- Any call line (booked, cancelled, nobody joined, paused, outage, skipped) → that call in Live session.
- A key not working → the yellow keys box.
- The team paused, stopped or closed the test, lifted the pause, or "will close later" → the overview banner.
- Open until heads-up and chat lines → the test page.

What testers see of all this is in Tester session page and Tester dashboard, Find tests and the join page; profiles and chat are in Shared pages.

## Tester dashboard

### What it's for and who sees it

The tester's home: what to do next, money waiting, calls, invites and new tests. Only the tester sees it.

From Every page: the live box, long lists (each box shows the newest 3 rows, then "Show N more"), number format, and the suspended tester's blue box.

### What's on it (top to bottom)

- **Payout problem banner**, when a payout failed: "Your bank couldn't receive a payout. Update your payout details." (Shared pages).
- **Stat tiles:** Earned, Waiting for review, Rating, To do.
- **Tests you were removed from** (only after a suspension, see below).
- **Charge or cancel:** tests with parts where Charge is open, e.g. "Harbor Run · 2 parts". Each row opens the part on the session page. When Charge opens is in Rules.
- **To do:** unsent parts with deadlines, each with "Send work", which opens the part; also new terms to Switch or Keep, and the developer's call requests to accept or decline. A test can be in both Charge or cancel and To do.
- **Waiting for the developer:** sent work waiting for review, and applications or rejoin asks waiting.
- **Upcoming calls:** the next 7 days, with Join when it's time.
- **Invitations:** Accept (opens the join page) and No thanks.
- **Tests you left:** tests they left or were removed from, before the deadline, not stopped and not rated, with Ask to rejoin.
- **New tests for you.**
- **History:** past tests and how each ended.
- Paused tests the tester joined, was invited to or applied to show with a "Paused" tag. Their invites and applications wait, and work again after the lift unless something else closed them.

### Buttons

- **A row** in any box: opens that part, call, offer or test.
- **Send work:** opens the part on Tester session page.
- **Accept** (invite): opens the join page. **No thanks:** closes the invite; the developer's page shows "<name> said no thanks to your invite".
- **Ask to rejoin:** as on the join page, below.
- **Ask to rejoin** on a "You were removed from this test" row, while the test is open, has a spot and isn't paused; **Dismiss** removes the row.

### What can stop a press

- No thanks stops once if the developer changed the listing ("<dev> changed the listing at <time> and sent you a new invite: …") and is refused if the invite closed ("This invite closed: the test filled up.").

### How it looks in each state

- **Active:** as above.
- **Suspended:** the blue box at the top says their account is paused, they were removed from their tests, how to appeal (Contact us in Settings), and that pay for work already accepted still reaches their Stripe account. Every other signed-in page moves them here, session pages and Find tests included, except Payments (with payout setup), Settings and the bell list. Below the box, a read-only list "Tests you were removed from". Names in rows are plain text with no hover card. Invitations and New tests are hidden; To do says "Nothing to do while your account is suspended."
- **After reinstatement:** no automatic re-invite. The tests they were removed from stay at the top, labelled "You were removed from this test", with Ask to rejoin while the test is open, has a spot and isn't paused, until they ask or dismiss. The developer can also invite them again as usual.
- **Deleted:** every tab logs out.

### Bell lines that open this page

- "Your account is active again", outage lines → the top.

## Find tests

### What it's for and who sees it

Testers find tests to join. It lists open public tests (Anyone can join, Approved only). Invite-only, paused, full, stopped, closed and deleted tests are not listed.

From Every page: the live box, long lists.

### What's on it

- A title and intro, category chips, and filters: Device, Part, Sort by, Show.
- **Cards:** product and title, categories, languages and devices needed, spots left, price per part, who can join, Open until, the deadline, Mature and NDA badges, "Invited", "You left this test".
- Each card lists every unmet need in amber (3, then "+N more").
- **Order:** tests needing a device the tester has, then tests open to any device, then the rest; newest first within each.

### Buttons

- **A card:** opens its join page.

### How it looks in each state

- **Active:** as above. A test that fills, pauses or stops leaves the list; one that frees a spot comes back.
- **Suspended tester:** the page is closed; it moves to the dashboard top.

## Join page

### What it's for and who sees it

The listing of one test, where a tester joins, applies, accepts an invite or asks to rejoin. Testers see it from Find tests, an invite or a link.

From Every page: the live box, stop-once, Join anyway, kept drafts, email confirmation.

### What's on it (top to bottom)

- "← All tests", the live box, the header card (product, price block, badges).
- An invitation card with No thanks, if invited.
- "How it works", "<dev> wants to know" (the questions), "Your deal" (parts, prices, Required labels, deadline), "How <dev> reviews" (the developer's stats).
- A state line when it can't be joined (below).
- **The join box:** the NDA to accept, then one of Join (Anyone can join), Apply (Approved only), Accept invitation (invited) or Ask to rejoin (left or ended before their deadline).
- A tester's hover card on the developer's name has "Chat with <name>" (Shared pages).

### Buttons

- **Join / Accept invitation:** checks requirements, spots (two people never take the last spot), Open until, the NDA, a confirmed email, a free access key and the 10-test limit. Then the tester is in, on the current listing, and lands on Tester session page. The developer's bell: "<name> joined <test>". If that took the last spot, other applicants and invitees are told.
- **Apply:** sends an application; the developer's bell: "<name> applied to join <test>". If the test is now open to anyone, it joins at once. **Withdraw application** takes it back.
- **Ask to rejoin:** only before the deadline, never after a stop or rating. The developer accepts in Needs you; the tester comes back on the current listing with the exact time they had left. An invite plus an ask, in either order, joins at once.
- **Join anyway / Apply anyway / Ask to rejoin anyway:** when the profile lacks a device or language the test needs, an inline box "What this test needs" lists each one ("Your profile doesn't list <X>, which this test needs.") with Join anyway, "Edit my profile" (new tab) and Cancel. It checks again every few seconds ("Just updated") and closes when everything fits: "You now meet this test's needs. Press Join to join."
- **No thanks:** closes the invite.
- **Join on the current listing / Withdraw application:** shown in "This test changed since you applied."
- The 10-test limit applies to Join, Apply, accepting an invite or application, and Ask to rejoin: "You can't join more tests right now."

### What can stop a press

- **Stop-once:** "The listing was edited: <fields>"; an info change (description, devices, languages, link, categories, who can join, product, Mature); an application closed ("<test> is full: your application was closed"); a new invite on the updated listing; your own press in another tab. Spots stop only when the test is now full, Open until only when it passes; a title change is info only. The box ends "Press again to join on the current listing."
- **Needs changed** while Join anyway is open: "<dev> added <X> to the devices this test needs" and "Your press didn't go through. Check what this test needs now, then press again."
- **Always refused** (blue, under the button): "This test was stopped."; "This test isn't taking new testers any more."; "This test is paused, so it isn't taking new testers right now."; "This test is full."; "You've already joined this test."; "You rated this test, so you can't join it again."; "You left this test, so you ask to rejoin and the developer accepts."; "This test takes applications: press Apply to join."; "This test is invite only."; "Accept the NDA to join."; "No access key is free right now, so this test can't take another tester until the developer adds one."; "You blocked <dev>: unblock them in Account → Blocked people to join."; "Confirm your email first. We sent a link to <email>." (with "Resend the link" under the button)

### How it looks in each state

- **Open:** the join box.
- **Full:** "This test is full." Invited testers: "<test> is full right now. Your invite stays open; we'll tell you when a spot opens."
- **Paused:** testers who joined, were invited or applied see it with a "Paused" tag and "This test is paused right now."; their invites and applications wait and work again after the lift unless something else closed them. Anyone else sees "This test isn't available right now."
- **Stopped or closed:** red "This test was stopped." or "This test isn't taking new testers any more."
- **Draft:** not found.
- **Blocked by the developer:** "This test isn't taking new testers right now." (the block isn't revealed).
- **The tester's own test:** "This is your own test…"
- **Suspended account:** the page is closed; it moves them to the dashboard top.

### Bell lines that open this page

- Invites and invite reminders, "…here's a new invite…", "A spot opened…", "…is full right now. Your invite stays open…" → the invitation card.
- "…your application was closed", "…is now invite only…", "<test> changed since you applied", "Your ask to rejoin … wasn't accepted" → the join box.

The developer's side of joining and invites is on Developer test page.

## Tester session page

### What it's for and who sees it

Everything a tester does inside one test they joined: read their terms, send work, run calls, get paid, charge, dispute, leave or rejoin, and rate. Only that tester sees it.

From Every page: the live box, stop-once, pop-ups, kept drafts, long lists, stopped tests. Testers see "paused" and "delayed", never hold, suspended, failed or chargeback.

### What's on it (top to bottom)

1. **Product and test name.**
2. **Access key box**, if the test has keys: the key, and "This key doesn't work". After the developer assigns a new one: "The developer gave you a new access key."
3. **Live box:** every change except new terms.
4. **Switch / Keep offer**, when the developer offers new terms: "<dev> updated the listing: <changes>." with folds for a changed NDA or questions.
5. **State lines:** why presses are refused (e.g. "You left this test."), the paused line, "<test> closes in …".
6. **Header card:** the developer (hover card with "Chat with <name>"), badges (Stopped when stopped), Chat (unread count), the description, the deadline ("Due …", a countdown under 24 hours, "late" after), "Open the product", "<dev> updated the listing since you joined: see it now", the NDA accepted date.
7. **Stopped line**, when stopped (Every page).
8. **Rating box** and **rejoin card** when they apply.
9. **Your agreed scope** and **Terms history** (earlier terms, questions, answers, NDAs, offers and choices).
10. **Your parts:** each part's Required or Not required, in the contract or not ("Not listed" when not), sent or not, "Paid so far $Y", and status: draft, sent, under review, paid, not accepted, payment delayed. Each part repeats its term at the top ("Written answers: $8 · Required"). Charge or Let it go, and Dispute, sit on the part.
11. **Live session** (the developer's panel, tester side): their rate ("Live call: $40/h"), or "Not listed" when a live call isn't a listed part or isn't in their contract, requests, booked calls, Past calls, and the length the developer logged and why.
12. **Your recordings** and **The written part.**
13. **Can't finish?** with Leave.

### Buttons

- **This key doesn't work:** always goes through. The developer's yellow keys box and bell get it; they may assign a free key.
- **Switch / Keep:** Switch moves the tester to the new terms (work already sent keeps its price); Keep stays on the current ones. The developer's live box shows "<name> switched to the new terms" or "…kept their current terms".
- **Send my answers / Send my recording**, then "Send my updated answers / recording": sends the work ("Sent late" after the deadline). Required questions must be answered. A paid part can't be changed ("Your written answers were already paid for, so they can't be changed. Send anything new in the chat."). Recordings: at most 5, 500 MB each. While the test is paused, Send is refused and drafts can still be saved. Bells: "Work sent: …" to the tester; "<name> sent / updated …" to the developer, whose Needs you gets the piece.
- **Charge / Let it go** on a contract part left unreviewed, once Charge opens (Rules). Charge takes a typed amount up to the listing minus what was paid for that part, with the tick "charge <dev> $X now". Let it go is a confirm pop-up ("Let it go? This closes with nothing more paid."). Works after leaving too, and while the test is paused: during the developer's payment or chargeback hold the charge is recorded and paid when the developer pays what they owe ("Charged $X. Payment may be delayed until the test resumes."). Never for a call outside the tester's contract. The developer sees "<name> charged $X for their <part>" or "<name> let their <part> go: nothing charged" and can no longer Pay or Reject it. A declined charge starts the developer's hold; the tester sees "Payment for your work on <test> may be delayed".
- **Dispute** a rejected or underpaid contract part, once, with a reason (at least a sentence). The developer's Needs you and bell get it, and admins get "Dispute on <test>: …". Not for work outside the contract or paid at the listing or more.
- **Live session:** Request a time (up to 3 rows, Once, Daily or Weekly with 2–8 calls or Forever, one length), Accept, Decline or Withdraw requests, Join (10 minutes before to 30 after), Add to calendar, Cancel ▾ (reason required under 24 hours), cancel the remaining calls of a set, Report a problem (No-show, Late) after the start. Calls can be requested whether or not a live call is a listed part. The developer is told each time.
- **Leave** (confirm pop-up "Are you sure you want to leave “<test>”?"): sent work is still reviewed and paid; unsent parts close with no pay; calls ahead are cancelled; the page stays, with live updates. The developer: "<name> left <test>". They can ask to rejoin while the test is open.
- **Ask to rejoin** (rejoin card): after leaving or being ended early, before the deadline, never after a stop or rating; the developer accepts and the tester comes back on the current listing with the time they had left (Tester dashboard, Find tests and the join page).
- **Rate and finish** (confirm pop-up while still working; a plain Rate otherwise): 1–5 stars and an optional comment. Open once everything sent is decided or past the point where Charge opens, and no dispute is open. The warning lists unsent contract parts (required ones marked) and that calls ahead are cancelled. Rating ends their part; no rejoin afterwards; Charge, Let it go and Dispute stay. The developer: "<name> finished <test>. You can rate them for 14 days."
- **Chat** opens the per-test chat, closed both ways while the test is paused (Shared pages). **Block** and **Report** the developer are on the developer's profile.

### What can stop a press

- **Stop-once** on every button for: new terms ("<dev> offered new terms: <changes>"; the page scrolls up to the offer; "Press again to send under your current terms, or switch first."); the developer paid or rejected your work; call changes (requested, withdrawn, declined, accepted, booked, cancelled, "The call time <time> is no longer available"); listing info changes; a delayed payment or its arrival; the team decided your dispute; the developer added their side; your own press in another tab. Spots and Open until never stop here; a title change is info only. "This key doesn't work" never stops. On a stopped or paused test every press still allowed stops once the same way: Charge, Let it go, Dispute, Rate, Leave and Cancel call.
- **Always refused** (blue, under the button):
  - "You left this test."; "You rated this test, so your part is finished."; "<dev> stopped the test on <date>. Work you sent is still reviewed."; "This test ended on <date>. Work you sent is still reviewed."; "<dev> ended your session early on <date>."; "Your session on <test> ended." (after a block); "This test closed on <date>."
  - Charge: "<dev> paid $X for this meanwhile." / "<dev> rejected this meanwhile."; "You can choose once 14 days have passed since you sent it and the test's Open until has passed…"; "This part is already paid in full."
  - Dispute: "You already disputed this payment. A part can be disputed once."; "This wasn't in your contract, so the developer's amount is final."; "This part was paid the listing amount or more, so there's nothing to dispute."
  - Rate: "Rating opens once the developer has reviewed everything you sent…"; "Rating opens once the team has decided the open dispute."
  - Calls: "This time is no longer free."; "You already have 3 booked times in this test."; the Join refusals ("This call was cancelled.", "You can join from <time>.", "This call is over.").
- The stop and work-ended lines also appear in the live box, and the Switch / Keep box disappears.

### How it looks in each state

- **Open, working:** as above.
- **Paused** (the developer is on any hold or suspension, or the team paused this test): a paused line that says what still works, and "Payment for your work may be delayed." Send is refused ("This test is paused right now. You can send this once it resumes."), but drafts can still be written and saved. Dispute, Charge or Let it go, Rate and Leave work, and booked calls can be cancelled. Chat is closed both ways ("Chat is paused while the test is paused."). Call requests are hidden and calls can't be joined. When the pause lifts, the deadline moves later by the length of the pause.
- **Calls during a pause:** calls starting within 3 days are cancelled with no fault ("Your call on <day> was cancelled because the test is paused."); later ones stay booked (Rules).
- **Stopped or closed:** the page shows only what still works. Send and the call-request tools are hidden. It shows the live-box line, the Stopped label and the still-allowed line, their agreed scope, every part with its status (sent, under review, paid with the amount, not accepted, payment delayed), the work they sent (readable) and Terms history. Charge or Let it go, Dispute, Rate, Leave (if still in) and chat work; other presses from an old page are refused; the offer disappears. A paused test is different: it can resume, so Send stays visible and is refused.
- **The tester left, was ended early or rated:** the page shows the same read-only view as a stopped test, with the matching line; the rejoin card when it applies.
- **The tester is suspended:** they were removed from the test, and the page is closed: opening it moves them to the dashboard top. A tester whose developer is suspended or on hold keeps this page, with the paused rules above.

### Bell lines that open this page

- "You're in…", "You're back in…", "<test> is running again", "<test> was stopped", "…ended early", "<test> ended", "Your session on <test> ended.", Open until heads-up, chat → the top.
- "<dev> updated the listing: …" → the Switch / Keep offer.
- "You have a new access key…" → the key box.
- "Work sent…", "You were paid…", "…wasn't accepted", "…is delayed…", "<dev> paid $X for your <part>", "…paid you $X extra…", "Your dispute … was decided", "…charge $X or let it go" and its reminders → that part.
- "Rate <dev>…" and its reminders → the rating box.
- Every call line → that call.

The developer's side of each press is on Developer test page.

## Shared pages

Pages both sides use. From Every page: notices, the live box, kept drafts, and the closed pages during a hold or suspension.

## Header and side switch

- One account can be a developer, a tester or both. The header switches between the two sides, each with its own menu, dashboard and pages. Messages, Notifications, Payments, Profile and Settings belong to neither.
- A link to the other side's page switches sides and goes there. Each tab shows its side.
- During a hold or suspension the header loses Post a test, Messages and Profile (and Find tests for a suspended tester).

## Public profiles and hover cards

### What's on them

- **Developer profile** (as testers see it): "Posting tests since", Pays on average, Typical review, Rating ("4.6 ★ (12 ratings)"), comments without the rater's name, Open tests.
- **Tester profile** (as developers see it): "Tester since", Accepted parts ("N of M sent · N sessions with accepted work"), Rating, About (bio, devices, languages), "Chat with <name>".
- **Hover cards** on names: the Testers-panel hover card (developer side) and testers' hover cards on a developer's name. Each has "Chat with <name>".
- **Admins** also see admin-only boxes on profiles (Administrator console).
- **During a hold or suspension** profiles are closed: a suspended tester, or a developer on hold or suspended, who opens one moves to their dashboard top.

### Buttons

- **Chat with <name>:** opens the per-test chat (on a profile, the most recent shared test; hidden when there is none). After a block either way, a suspension or any other refusal: "Unable to chat with this tester." / "Unable to chat with this developer."
- **Block** (confirm pop-up "Block <name>?"; they aren't told; undo in Account → Blocked people). On a tester's profile: their sessions with you end (sent work stays payable), calls between you are cancelled, chat closes; the neutral bell "Your session on <test> ended." On a developer's profile: you stop seeing their tests and profile, and they can't invite you. Requests, offers and invites between you close.
- **Report <name>:** a reason (at least 5 characters) and Send to the team. Once per person, ever. Afterwards: "You reported <name> on <date>." The reported person isn't told; admins get "New report: <a> reported <b>". A call's no-show or late report stays on the call.
- Block and Report exist only on profiles: the tester profile on the developer side and the developer profile on the tester side.

### What can stop a press

- Block: "You already blocked <name>." (blocked in another tab). Report: "You already reported <name> on <date>."

## Your profile

- **Developer:** "Your developer profile" with "See it as testers do", name, the tester-limit card ("Can take up to N testers per test · Next: +10% after N more ratings"), and their ratings.
- **Tester:** "Your tester profile" with "How developers see you", name, bio, devices and languages (at least one of each), and their ratings.
- Names need at least 1 character. Saving changes what others see at once; a tester's new device or language updates open Join anyway and Invite anyway boxes.
- Closed during a hold or suspension.

## Settings (Account)

- Name and email ("not confirmed yet" with Resend), the Developer / Tester / both switch, links to the profile and Blocked people, change password (signs out other devices), Delete account.
- **Contact us** emails every admin; admins reply by email. At most 5 messages per account a day; a 6th shows, under Send: "You've sent 5 messages today. We'll reply by email." It stays open for suspended and held accounts, and is how they appeal. Requests about personal data (for example, a copy of it) go through Contact us.
- **Delete account** (confirm pop-up "Delete your account?"): every open tab signs out with "This account no longer exists". What deletion does is in Every page.
- **Deleting as a tester:** the pop-up is a full warning with their real numbers:
  - "Pay already sent to your Stripe account stays there. Your Stripe account is separate from Playtest: you can still sign in to Stripe and withdraw it."
  - "$X is waiting for your payout setup. Finish it before deleting, or it can't reach you." with a "Set up payouts" link (only when some is waiting).
  - Delayed payments still reach their Stripe account when the developer pays, if payout setup is finished.
  - "N parts you sent aren't paid yet (up to $X). After deleting, they can't be paid, charged or disputed." This counts work under review, parts where Charge is open, and open disputes.
  - "You leave every test you're in. Calls ahead are cancelled, and your invites and applications are cancelled. Open disputes are withdrawn."
  - "Your chats close. The ratings you gave and got stay."
  - "You can't sign in again, and this can't be undone."
- **Deleting as a developer** is refused while sent work waits for Pay or Reject (parts where Charge is open included), a dispute is open, or a payment or chargeback hold is on. The Delete account section lists each one with a link, and the refusal reads "Pay or reject the work waiting for you first: <list>." Once none is left, deletion works as above; since nothing is left under review, Charge never opens later.
- During a hold or suspension Settings stays open with Contact us, the email setting and Delete account; the profile editor and profile links are hidden.

## Notifications

- "How you're notified": email Off, or On with Daily, Weekly or Monthly ("Your alert settings are saved.").
- The bell list: newest first, stacked entries open to show their lines, each line opens its exact spot.
- The bell list stays open during a hold or suspension; a line whose page is closed opens the dashboard top.

## Messages and chat

- One chat per tester per test, only between the developer and testers who are or were in the test. Unread counts show on the Chat buttons.
- Closed for a suspended tester and for a developer on hold or suspended: Messages and chat move them to the dashboard top. While a test is paused, its chat is closed both ways; testers see "Chat is paused while the test is paused." After a block, or when an account is deleted: "This chat is closed."
- Each message reaches the other side's bell: "<name> · <test>: <first words>".

## Payments

### What's on it

- **Developer:** "Your card" (add or change it in Stripe) and "What you've paid" (receipts and history, paid so far per part). Pay and Reject are not here: they are in each test's Needs you, linked from the dashboard's Needs review.
  - **During a payment hold only:** "Pay what you owe" with the exact amount. It pays exactly what it shows. More declines during the hold add to it, and so do testers' charges and disputes decided for them during the hold.
  - **During a chargeback hold:** the three steps, each ✓ or ✗: verify a card with 3D Secure, pay what is owed, the team's Approve. "Verify a card" starts the check.
- **Tester:** "Everything you sent" with statuses ("Payment may be delayed" when it is), "Where your money goes" (payout setup with Stripe), "Your earnings" (" · yours once your account is active again" while suspended).
  - When a payout fails: "Your bank couldn't receive a payout. Update your payout details." with a button to Stripe; the money stays in their Stripe balance.
- Payments stays open during holds and suspensions. Change card works during a payment hold, a chargeback hold and a suspension, and a suspended tester can still set up payouts.

### Buttons and what can stop them

- **Pay what you owe:** pays every owed charge. If another payment failed meanwhile, or the amount changed, it stops once: "What you owe changed: now $X. Press again to pay $X." When everything is paid the hold lifts at once ("Your tests are running again"; testers: "<test> is running again"), and payments that were waiting are charged; testers are paid the charges that were added for them. From the 4th hold on, admins must Approve first ("Hold lift waiting…"). Holds are in Rules.
- **Verify a card:** the 3D Secure check for a chargeback hold.

### Bell lines that open this page

- Hold lines ("Your tests are paused…", "Another payment was declined…", "Your bank reversed…") → Pay what you owe or the chargeback steps; "The team approved lifting your hold", receipts with no test → the top; the payout problem → the payout section.

## Call page

- "Call with Ana · booked for 60 minutes (paid up to 90) · the length is measured while you're both here", the room (or a link), the timer and who is here, "Both joined at …", and "Trouble with the video?…".
- Join works from 10 minutes before to 30 minutes after the start. The page closes when the call is cancelled, blocked, or 24 hours after its start. Refusals: "This call was cancelled: <reason>", "This test is paused.", "This test was stopped.", "You left this test.", "They left the test.", "You can join from <time>.", "This call is over."
- The developer logs the length and pays afterwards on Developer test page.

## Waitlist (public)

- Before signing up, anyone can leave an email on the waitlist ("Enter an email address like you@email.com." when it's not valid). Admins see the list at the bottom of the console.

## Administrator console

### What it's for and who sees it

Admins see every account (deleted ones too), act on suspensions, tests, holds and disputes, and every action is recorded with the admin's name. Only admins see it; developers and testers see nothing of it.

From Every page: the bell (admin lines and the "Reported more than 3 times" label) and the admin daily email.

### What's on it (top to bottom)

- Stat tiles, then "Opened from a link" (the row a bell line or email pointed to).
- **Open disputes**, newest first.
- **Lifts:** from a developer's 4th payment hold on, each hold appears here once they have paid: the developer, "More than 3 holds", what was owed, when it was paid, a note box and Approve.
- **Chargeback holds:** card ✓/✗, owed ✓/✗, and Approve.
- **Your actions:** tests this admin paused or stopped, and accounts they suspended, newest first.
- **Paused tests:** each with its closing date, Extend and Close now.
- **Needs the team today**, **Payment holds** ("More than 3 holds" where it applies; no Approve here), **Decided disputes**.
- **Reports:** who reported whom, the date, the reason, links to both profiles, and the label. **No-show reports** from calls.
- **Payouts waiting** and **Latest payments**; **Held tester shares** (Release, Refund).
- **Accounts** (Suspend, Lift, Delete) and **Tests** (Pause, Lift the pause, Stop, Allow 3 more); **Waitlist**.
- Every list shows pages of 25 with Previous / Next and "1–25 of N"; only that list reloads. Rows link to the profile or test page they are about.
- **On profiles,** admins see extra boxes (newest first, pages of 25): payments, payouts, disputes, chargebacks, holds and suspensions (with the acting admin), tests posted or joined, and reports against them. Testers' profiles also list their sent parts with totals. A totals line shows money spent or paid out and counts of reports, disputes, chargebacks, holds and suspensions.
- **On a test's public page,** admins see a timeline, contract changes and payments.

### Buttons

Admin buttons have no confirm pop-up; each shows "Done." or the refusal.

- **Decide a dispute:** the row shows the listing, paid for this piece, paid for this part so far, and the allowed range (from what was paid up to the listing minus what was paid on other pieces). Enter the total pay; blank keeps it. The decision and reason are recorded; both sides are told ("…was decided"); a raise is charged at once; during a payment or chargeback hold it is added to what the developer owes and paid to the tester when they pay; during a suspension with no hold it is charged at once, and a decline starts a payment hold.
- **Suspend** (a reason is required; Preview shows the effects first):
  - a developer: all their tests pause; invites and applications wait; calls within 3 days are cancelled with no fault; they get "Your account is paused".
  - a tester: removed from every test (developers get "<name> left <test>"); pay for their sent work is still charged and their share is held.
- **Lift** (reinstate): "Your account is active again". A developer's tests resume, deadlines move on by the pause, and testers get "<test> is running again". A tester isn't re-invited: the tests they were removed from wait on their dashboard with Ask to rejoin, and the developer can invite them again. Their held shares are released.
- **Delete** an account, with a reason (see Every page).
- **Pause a test:** behaves like a stop for the developer ("you can only stop it"); it closes after 7 days. Testers follow the same paused-test rules as during a developer's hold (Rules). The developer gets "The team paused <test>". **Lift the pause:** "The team lifted the pause on <test>"; testers' deadlines and the test's Open until move later by the length of the pause.
- **Stop a test:** for good; testers get "<test> was stopped", the developer "The team stopped <test>".
- **Extend** a paused test's closing date (1–90 days, this pause only): "<test> will close later". **Close now:** testers read "<test> ended"; the developer gets "<test> was closed. <reason>".
- **Approve** a lift or a chargeback hold. A chargeback Approve is refused until the card is verified and what's owed is paid ("Not yet: the card isn't verified and $X is still owed."). The developer gets "The team approved lifting your hold", or "Your tests are running again" if that lifts it.
- **Release / Refund** a held tester share; **Send** a waiting payout.
- **Allow 3 more** for a test: every limited field at 0 gets 3 more changes (Edit test).

### What can stop a press

- Any admin can act on anything; the first decision wins. A second admin's press is refused: "This dispute was already decided by Ana at 3:10 PM.", "This lift was already approved by …", "That account is already suspended.", "That test was already stopped."
- Other refusals: "Record why (it is kept with the suspension).", "You can't pause your own account.", "Use Settings to delete your own account.", "A decision can only raise pay…".

### The "Reported more than 3 times" label

- Counts profile reports plus call no-show and late reports. It shows on names in dispute, report and lift rows and in the admin bell lines about them. Never the number: the exact count is only in the totals line on the profile. A report count is never proof by itself.

### Admin accounts

- Proper sign-in; a suspended admin can't log in and sees how to appeal.
- Contact us messages arrive by email to every admin, who reply by email.

### Bell lines and emails that open this page

- New dispute → that dispute; new report → Reports; "Hold lift waiting…" → that Lifts row; "N suspended accounts to review" → Accounts.
- The chargeback email → Chargeback holds; the daily email's items → their rows.

Holds, chargebacks and suspensions in full: Rules. What the developer sees: Developer test page.

## Rules

The rules several pages share, with every number, cap and timer. How pages show them is in each page tab and in Every page.

### Test lifecycle and timers

- **States:** Draft (a next round not opened yet; it opens in Post a test, not as a test page), Open, Paused (an admin pause or the developer's hold or suspension; nothing new can start; records kept), Stopped, Closed (after a long pause).
- **A tester's deadline** starts when they join. Changing the default later never shortens a working tester's deadline. It's a guide: late work is accepted and labelled "Sent late".
- **Open until** is the last day to join. It can only move later, and only before it passes. The deadline must leave 3 days before Open until.
- **Charge opens** on unreviewed contract work at the later of 14 days after sending and the test's Open until. A stopped or closed test still waits for Open until. With no Open until, it opens when the test stops or closes or the tester's work ends (left, deadline passed, ended early). Rating, the "Charge or cancel" box and the refusals all use this same point. Nothing is charged automatically.
- **Paused tests close after 7 days**, whatever the cause, unless an admin presses Extend or Close now. Closing works like a Stop: testers read "ended" with no reason, and the developer gets the reason by bell and a banner. Drafts never close.
- **Pausing and resuming** moves every deadline and timer on by the length of the pause. When any pause lifts (a hold is paid off, an account is reinstated, or the team lifts its pause), every working tester's deadline and the test's Open until move later by that length.
- **Outages:** with outage checks on, a gap over 15 minutes moves every running timer later and cancels calls inside it with no fault.

### Money

- **Pay:** one box per piece. It starts at the listing (or the call's rate × length); the developer can pay less (with a reason) or more (extra pay). Reject needs a reason. The card is charged at once and nothing shows success before the result. The split is 80% to the tester, 20% to the platform.
- **When Pay or Reject works:** until the tester presses Charge or Let it go, including after Open until, after a Stop and after a pause closure. Never during a hold or suspension.
- **Over $200:** setting a part price over $200 needs "I confirm this part pays more than $200."; any Pay box over $200 needs "I understand this payment can't be refunded and is charged now." every time. There is no 3D Secure check on Pay.
- **Any declined payment starts a payment hold at once:** a part Pay, the tester's Charge, a call charge or extra pay. There are no retries and no grace days. More declines during the hold add to "Pay what you owe". Paying it all lifts the hold at once (from the 4th hold on, after an admin's Approve).
- **Chargebacks:** a chargeback starts a chargeback hold with three steps: verify a card with 3D Secure, pay what is owed, then an admin's Approve. Paying alone never lifts it. A chargeback during a payment hold turns it into a chargeback hold. Every further chargeback adds to what is owed; a new chargeback clears an earlier card check.
- **Hold count:** the first 3 holds lift as soon as the developer pays. From the 4th hold on, an admin must Approve the lift (Lifts on Administrator console); the developer's box says the team will review after they pay.
- **Charge cap:** the listing minus what was already paid for that part.
- **Charge during a pause:** during a payment or chargeback hold, a tester's Charge (and a dispute decided for the tester) goes through as their choice but isn't charged yet: it is added to the developer's "Pay what you owe", and the tester is paid when the developer pays. The tester sees "Charged $X. Payment may be delayed until the test resumes." During an admin suspension with no hold, a Charge, or a dispute decided for the tester, is charged at once; if it's declined, a payment hold starts and the amount is added to what is owed.
- **Dispute range:** from what this piece was paid up to the listing minus what was paid on other pieces. An admin decision can only raise pay. Each part can be disputed once; the developer adds their side once.
- **Extra pay cap:** any amount above a part's listed price (normal Pay above the listing plus extra pay, parts outside the contract too) may total at most 100% of the tester's current contract total (part prices plus the agreed totals of booked and held calls). Each unlisted part or unlisted call can be paid at most $100 (its pay plus extra pay), which doesn't count toward the 100%. Blocked: "This is more than you can pay above the listing (up to $Y)."
- **Calls that aren't a listed part:** either side can request a call even when a live call isn't a listed part of the test or isn't in that tester's contract. A call or any other part that isn't listed in the tester's contract carries the label "Not listed" on both sides. Pay for such a call is up to the developer: at most $100 for that call (its pay plus extra pay), outside the 100% cap; the cap is said only when a Pay goes over it (the blocked line above). The Pay box starts empty. Charge and Let it go never open for a call outside the tester's contract.
- **Prices:** written and recording $1–$1,000 each, calls $10–$200 an hour, or free. The smallest charge is $0.50; Stripe's largest is $999,999.99.
- **A suspended tester's pay** is still charged; their share is held until they are reinstated. If they never are, an admin refunds or releases it.
- **Wording for testers:** "paused" and "delayed" only.

### Ratings

- Testers rate the developer once everything they sent is decided or past the point where Charge opens, and no dispute is open. Rating ends their part (Charge, Let it go and Dispute stay). The Rate button has no end date.
- Developers rate a tester after the tester rated, within 14 days (a Needs you item). Both ratings show together, or the tester's alone after 14 days.
- 1–5 stars and an optional comment (up to 500 characters), shown without names. Only real work counts: some work sent or a call held.
- A suspended or held person's tests can still be rated by the other side; the suspended person can't rate until it lifts.
- Reminders: once; after a stop or close, every 3 days for 2 weeks. Rate is refused while a dispute is open. Otherwise it stops once like any press: on a test still open, for every kind of change; after the test stops or closes, only for a Pay, Reject, Charge, Let it go or dispute.

### Holds and suspensions

| | Payment hold | Chargeback hold | Developer suspended | Tester suspended |
|---|---|---|---|---|
| Starts when | any payment is declined | a chargeback arrives | an admin suspends, with a reason | an admin suspends, with a reason |
| Their tests | all paused | all paused | all paused | they are removed from every test |
| They can | Pay what you owe, Change card, Cancel call (dashboard), Payments, Contact us | the three steps, Change card, Cancel call, Payments, Contact us | Cancel call (dashboard), Change card, Payments, Contact us (appeal) | Payments (payout setup), Contact us (appeal) |
| Testers in those tests can | save drafts, cancel booked calls, dispute, Charge or Let it go, Rate, Leave | the same | the same | (not in any test) |
| Waits until it lifts | sending work, chat, new calls, joins, invites and applications, Pay, Reject; testers' charges are paid when the developer pays what they owe | the same | everything else; testers' charges and disputes decided for them are charged at once | their held share of pay |
| Lifts when | everything owed is paid (4th hold on: plus an admin's Approve) | card verified, owed paid, admin Approve | an admin lifts it | an admin reinstates them |
| On lifting | tests resume; deadlines move on; testers get "<test> is running again" | the same | the same | no automatic re-invite: the tests they were removed from stay at their dashboard top ("You were removed from this test", with Ask to rejoin while the test is open with a spot) until they ask or dismiss; the developer can invite them again |

- **Calls:** calls starting within 3 days of a hold or suspension starting are cancelled with no fault, and both sides are told. Later calls stay booked; each is cancelled 3 days before it starts if the hold or suspension is still on.
- **Testers in a paused test** (the developer is on any hold or suspension, or the team paused that one test): Send is refused ("This test is paused right now. You can send this once it resumes."), but drafts can be written and saved. They can still dispute, Charge or Let it go, rate and leave. Chat is closed both ways ("Chat is paused while the test is paused."). Invites and applications wait, and work again after the lift unless something else closed them. The 7-day close still applies; after it, Charge, Let it go, dispute and rate carry on, and charges added to what is owed stay owed.
- **No Stop or End early** during a hold or suspension: the only press on their tests is Cancel call, from the dashboard's Calls box. Paused tests close after 7 days anyway, and stopping would cut off testers' unsent work.
- **Daily paused reminder** for the developer: "<test> is paused and closes on <date> unless your account is cleared" (for a hold: "…unless you pay what you owe"). It stacks across tests and replaces their "paused" and "closes tomorrow" lines; testers keep theirs.
- **A hold** limits only the developer side of an account; a suspension covers the whole account. While either lasts, every signed-in page except the dashboard, Payments, Settings and the bell list moves them to the dashboard top (details in Every page). A tester whose developer is suspended or on hold isn't restricted.

### When account states change or combine

One row per change. A test is paused while its developer has any hold or suspension, so it runs again only when none is left. The lines in the last column are quoted from the bell and email tables on Every page; "bell" and "email" say which.

| What happened | What changes for the developer | What changes for testers | Who is told |
|---|---|---|---|
| A suspension starts, with no hold | All their tests pause. Every signed-in page except the dashboard, Payments, Settings and the bell list moves to the dashboard top, where the blue box says how to appeal. The only press on their tests is Cancel call. Calls within 3 days are cancelled with no fault. It covers the whole account, tester side too. | The paused-test rules: Send is refused (drafts save), chat is closed, invites and applications wait; dispute, Charge, Let it go, Rate, Leave and cancelling calls work. A Charge, or a dispute decided for them, is charged at once. | Developer: "Your account is paused" (bell and email), then daily "<test> is paused and closes on <date> unless your account is cleared" (bell). Testers: the call line for a call cancelled because the test is paused (bell). |
| A tester's Charge, or a dispute decided for them, is declined during a suspension | A payment hold starts on top of the suspension, and the amount goes into "Pay what you owe". Pay and Reject can't be pressed during a suspension, so a Pay can't be declined then. | Their payment is delayed; they are paid when the developer pays. | Developer: "Your tests are paused" (bell and email). Testers: "Payment for your work on <test> may be delayed" (bell). |
| A payment hold becomes a chargeback hold | The three chargeback steps on Payments replace Pay what you owe: verify a card with 3D Secure, pay what is owed, then an admin's Approve. The chargeback adds to what is owed; paying alone never lifts it. | Nothing new: the test stays paused under the same rules, and Charges and disputes decided for them are still added to what is owed. | Developer: "…paused after a chargeback" (bell) and "…your payment hold is now a chargeback hold" (email). Admins: "Playtest: new chargeback of $X" (email), then the hold in their daily email. |
| Another decline, or another chargeback, during a hold | A decline adds to "Pay what you owe". A chargeback adds to what is owed, turns a payment hold into a chargeback hold and clears an earlier card check. A Pay what you owe press for the old amount stops once ("What you owe changed: now $X. Press again to pay $X."). | The payment is delayed and paid when the developer pays. | Developer: "Another payment was declined: $X … was added to what you owe" or "Your bank reversed a $X payment …" (bell). Admins: "Playtest: new chargeback of $X" (email). Testers: "<dev>'s payment for your <part> ($X) is delayed. You'll be told when it arrives." (bell). |
| The hold is paid while the suspension continues | The hold lifts (from the 4th hold on, after an admin's Approve). The tests stay paused and the pages stay closed while the suspension lasts. | The test stays paused. Charges added for them are paid. | Developer: "Receipt: you paid $X for …" (bell). Testers: "<dev> paid $X for your <part>" (bell). Whether the developer also gets "Your tests are running again": Open. |
| The suspension lifts while a hold continues | The tester side reopens, since a hold limits only the developer side. The developer side stays as in a hold: tests paused, pages closed, Pay what you owe or the chargeback steps on Payments. | The test stays paused. | Developer: "Your account is active again" (bell and email). Testers: nothing until the test runs again. |
| Both have lifted | Tests resume as normal and the pages reopen. Every working tester's deadline and the test's Open until move later by the length of the pause. | Send, chat, call requests, invites and applications work again, unless something else closed them. Their deadline moves later by the length of the pause. | Developer: the line for whichever lifted last, "Your tests are running again" or "Your account is active again" (bell and email). Testers: "<test> is running again" (bell). |
| A paused test reaches its 7-day close during a hold or suspension | The test closes like a Stop: the card says "Closed after 7 days paused" and a banner gives the reason. The hold or suspension goes on, and money owed stays owed. Pay and Reject open once it lifts. | "This test ended on <date>." with no reason. Charge, Let it go, dispute and rate carry on; charges added to what is owed stay owed. | Developer: the daily "<test> is paused and closes on <date> unless …" before it, then "<test> was closed. <reason>" (bell and email). Testers: "<test> ended" (bell). |
| The team pauses one test during a hold | The test is paused by both, so it runs again only when the hold has lifted and the team has lifted its pause. Which closing date applies, and which reason the card shows: Open. | The same paused-test rules. | Developer: "The team paused <test>" (bell and email); later "The team lifted the pause on <test>" (bell). |
| A tester is suspended while their developer is on hold | The tester leaves every test ("Left this test"). Their sent work stays, waiting for Pay or Reject once the hold lifts; pay for it is charged, and the tester's share is held until they are reinstated. | The suspended tester is removed from every test, and every page except the dashboard, Payments, Settings and the bell list closes. Charges already added to what the developer owes are paid when the developer pays, with their share held. | Developer: "<tester> left <test>" (bell). Tester: "Your account is paused" (bell and email). |
| The developer tries to delete their account during a hold | Refused: "Pay or reject the work waiting for you first: <list>." The Delete account section lists the hold with a link. Deleting never clears a hold, a chargeback or money owed. | Nothing changes. | No one: the refusal shows under the button. |
| The 4th hold or later is paid | The hold stays until an admin presses Approve (Lifts on the Administrator console); the blue box says the team will review the account after they pay. The tests stay paused until then. | The test stays paused until the Approve. Charges added for them are paid when the developer pays. | Admins: "Hold lift waiting: <dev> paid what they owe (More than 3 holds)" (bell) and the admin daily email. Developer: "The team approved lifting your hold", or "Your tests are running again" when the Approve lifts it (bell; "Your tests are running again" is also emailed). Testers: "<test> is running again" (bell). |

### Deletion

- Deleting stops the account's tests, cancels invites and applications, keeps all history, and never clears holds, chargebacks or money owed. A developer can't delete while sent work waits for Pay or Reject (parts where Charge is open included), a dispute is open, or a payment or chargeback hold is on, so Charge never opens after a developer deletes. A tester who deletes leaves every test (calls ahead, invites and applications cancelled, open disputes withdrawn); their unpaid sent work can no longer be paid, charged or disputed, but delayed payments still reach their Stripe account when the developer pays, if their payout setup is finished.

### Limits

| What | Limit |
|---|---|
| Spots | 1–50 and the developer's tester limit (10 to start, +10% per 10 good ratings, at most 50) |
| Tester deadline | 1–90 days; must leave 3 days before Open until |
| Open until | in the future, at most a year ahead, extend only |
| Product, test name | 60 characters each |
| What should testers do | 1,000 characters |
| Categories | at least 1 |
| Written questions | 1–20 |
| Part price | written and recording $1–$1,000, or free; over $200 needs a tick |
| Call rate | $10–$200 an hour, or free |
| Any charge | $0.50 to $999,999.99 |
| Pay above the listing | at most 100% of the current contract total; each unlisted part or unlisted call at most $100 (its pay plus extra pay), outside the 100% |
| Changes to the steps, NDA, questions, languages and devices | 3 per field after the first tester joins; one Save that changes two fields uses one change of each (an admin's Allow 3 more gives 3 more to every field at 0); prices, parts, the build link and access keys aren't limited |
| Call length | 10–180 min; logged up to 150% of booked, within 24 hours |
| Call requests | 3 time rows; repeats 2–8 or Forever; per tester 3 booked times and 3 waiting requests |
| Joining a call | 10 minutes before to 30 minutes after the start; cancelled if nobody joins by halfway |
| Cancelling a call | a reason is required under 24 hours; not after it starts |
| Tests per tester | 10 at once |
| Recordings | 500 MB each, 5 per session |
| Names | at least 1 character |
| Text | rating comment 500, dispute 2,000, bio 1,000, Contact us 10–3,000 characters; report reason at least 5 |
| Contact us | 5 messages per account a day |
| Confirmation and reset emails | 3 an hour each |
| Reports | one per person about another, ever |
| Disputes | one per part |
| Paused test | closes after 7 days; an admin can extend by 1–90 days |
| Charge opens | the later of 14 days after sending and Open until |
| Developer review reminders | 1 month, 1 week, 3 days, 1 day before Charge opens, then daily |
| Tester Charge reminders | every 3 days |
| Invite reminders | daily until answered |
| Rating | developer within 14 days of the tester; reminders every 3 days for 2 weeks after a stop |
| Payout problem reminders | every 3 days until fixed |
| Hold lifts | the 4th hold on needs an admin's Approve |
| Calls near a hold or suspension | cancelled within 3 days |
| Outage | over 15 minutes moves timers |
| Long lists | 3 lines, then "Show N more" (scroll box about 8 lines); admin lists pages of 25 |
| Big numbers | in full under 10,000, then k, M, B, T, × 10^N |

Open questions about these rules are in QA and open questions.

## QA and open questions

### Edge cases to test before launch

- **Payments:** a declined Pay, Charge, call charge or extra pay starting a hold at once; another decline during the hold adding to what is owed; two tabs paying one part; a chargeback with work waiting; a chargeback during a payment hold; a tester or developer suspended mid-payment; a deleted developer with valid charges; a payout failure; an admin raising pay in a dispute; a held share released or refunded; the extra-pay cap with parts outside the contract and unlisted parts; a call that isn't a listed part paid from an empty box; a tester's Charge during a hold added to what is owed and paid when the developer pays.
- **Participation:** two testers for the last spot; joining just before Open until; Open until or the default deadline changed while testers join or work; leaving during a suspension; pausing mid-send; closing mid-review; an invite accepted in one tab after it was cancelled in another; invite plus rejoin ask in either order; the 10-test limit on every way in.
- **Terms:** an offer replaced by a newer one before the tester answers; work sent during a change; reviewing at an old price; rejoining with the right terms; the per-field 3-change limit (one Save changing two fields) and Allow 3 more.
- **Calls:** overlapping bookings; cancelling from another tab; a hold or suspension starting within 3 days of a call, and one starting later; joining a paused test's call; requesting a call on a test with no Live call part; booking while terms are edited; a Forever set adding its next call; nobody joining by halfway.
- **Ratings:** complete and rate; the developer not rating in 14 days; leaving early; ended by the developer; closing with mixed paid, rejected and unreviewed work; rating while the other side is suspended or held; leave and rejoin without duplicate records.
- **Restrictions:** a developer pressing on a test page as a hold starts (routed to the dashboard top, blue box naming the press); the same on Profile and Edit; Cancel call from the Calls box during a hold; suspended on the session or payout page; a deleted user on an open page; two admins on one account; a lifted suspension and Ask to rejoin; long pauses closing; repeated pauses; a tester sending, saving a draft, charging or chatting while a test is paused; deadlines and Open until moving later when a pause lifts; a 6th Contact us message; a restricted account opening each closed page, a bell line and Change card; deleting with work still waiting.
- **Cross-device:** a phone action refreshing a desktop tab; a hold reaching every tab; signing in as someone else in another tab; drafts kept after a refused press; sign-in expiring mid-send; network failure during upload or payment; an outage moving timers.

### Open questions

**Waiting for the owner (tonight's list)**

- Built with defaults, to confirm:
  - The Rate button has no end date.
  - While a test is paused, testers can still write and save drafts.
  - When a pause lifts, every working tester's deadline and the test's Open until move later by the length of the pause.
  - Chat is closed both ways while a test is paused.
  - A team pause of one test follows the same tester rules as a developer's hold or suspension.
- Confirm large totals before posting ("Up to $8,000 could be charged if all spots send everything.")? Not built.
- When a limit in Rules changes, tell developers in the bell and on the fields it affects?
- Fraud: invite developers by hand at launch, a longer tester payout delay, and a new-developer spending limit or prepaid budgets before public developer sign-up?
- Pause developers who stop responding? Not built.
- 3D Secure on large payments (e.g. Pay over $200): not built; revisit after launch data.
- Tests paused repeatedly, and repeated holds or suspensions: stop a test or escalate after several? (The old "third pause stops the test" idea was dropped.)
- Tester suspensions: removing a suspended tester from all tests at once may be too harsh. Options: pause their contracts instead, or let developers choose.
- UI for many rows and long text: long names, titles and reasons are cut with "…" (full text on hover). Revisit layouts for accounts with many rows and very long names.
- Developer deletion: the owner suggested keeping open Charge rows and never opening Charge for work still under review. The app now refuses deletion until that work is paid or rejected instead. Confirm.
- When a developer pays off a hold while their suspension continues, do they get "Your tests are running again", though their tests stay paused? (Rules, When account states change or combine.)
- The team pauses a test that is already paused by its developer's hold: which closing date applies (the hold's 7 days or the team pause's), and which reason does the card show?

**Earlier questions**

- **Timing:** which deadline rule wins (the individual deadline, the 3-day buffer, a 2-day late-joiner extension, a maximum recruitment period such as 30 days); shortening a tester's deadline with 24 hours' notice; the review window for extended tests; what happens to unreviewed work when a test closes on its own.
- **Payments:** is a 10-day refund period workable with the payment provider's rules and payout timing; refund exceptions; unresolved charges when an account closes; pay when a developer ends work early.
- **Restrictions:** different escalation for different causes; stopping abusive re-registration without blocking people who share devices or networks; reports on paused tests.
- **Business:** higher prices for higher-rated testers; charging for work that isn't accepted; which tester stats are public; forums or group tests.
- **Ratings:** scales and categories; early departures; tests ending without full completion.
- **Content and storage:** which content needs warnings or rejection; identity checks; how long recordings are kept and size limits; resumable uploads; transcription with self-hosted open-source models; phone layouts for complex panels; taking back a dispute; more than 10 tests per tester.

### Post-launch

Tester notification preferences; admin outage recording; admin pay above the listing; notification muting; more rating filters; question-based forums; group tests; advanced recruitment; automated risk controls; Themes and moments (transcribed recordings grouped into themes); an admin "Payout problems" list; a spending limit or prepaid budgets; in-app messages between admins and users; a soft "Ana is looking at this" marker on disputes; link checks on the build link (block private network addresses, check for malware and phishing with Google Web Risk, warn about password-protected archives); if invalid or unreachable emails are found, require those accounts to change their email (and password) before continuing. Profile excerpts (testers request excerpts; developers approve or deny). If built: deleting the account closes pending requests; closing a test doesn't.

### Launch priorities

1. Core marketplace: posting, recruiting, joining, sending work, history.
2. Payments: charges, payouts, declines, balances, disputes.
3. Lifecycle: open, paused, closed, deadlines, late joins.
4. Contract integrity: stable terms, correct prices, no conflicting updates.
5. Restrictions: holds, chargebacks, suspensions, deletion, reinstatement.
6. Consistency: cross-tab updates, old forms, repeated presses, failure notices.
7. Reputation: ratings and history.
8. Admin tools: records, reports, suspensions, disputes.
9. Phones and recording reliability.
10. Post-launch items.
