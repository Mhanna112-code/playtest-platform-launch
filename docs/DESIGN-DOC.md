# Playtest Platform: how the app works, page by page

Oct 30, 2026 · @Mhanna112

## What Playtest is

Playtest is a marketplace where developers pay testers to try their games, websites, apps and other products. A developer posts a test: what to do, the parts to send (written answers, a recording, live calls), the price of each part, Open until (the last day to join) and who can join. Every tester gets the same number of days to work, counted from the day they join. Testers join or apply, send their work and are paid for each part they send: the developer pays any amount from $0 up, and the tester can dispute the amount once. At the end both sides rate each other.

- **Developers** post and run tests, invite testers, pay for work, and rate testers.
- **Testers** find and join tests, send work, take calls, get paid, and rate developers.
- **Admins** suspend and reinstate either side of an account, pause or stop tests, decide disputes, and review reports and payment holds.

One account can be a developer, a tester or both; a switch in the header changes sides (Shared pages).

**The main promise:** every press that touches money, joining, permissions or agreed terms is checked on the server against what is true right now. Nobody is charged twice, loses pay they earned because an account changed, accepts terms they didn't see, or sees a success that didn't happen.

## How to read this guide

- One tab per page, in the order people meet them: Developer dashboard, Post a test, Developer test page, Edit test, Tester dashboard, Find tests and the join page, Tester session page, Shared pages and Administrator console.
- Each page uses the same headings, skipping empty ones: what it's for and who sees it; what's on it; each button, and what it changes elsewhere; what can stop a press; how it looks in each state; the bell lines that open it.
- Every page explains once, with examples, what holds everywhere: notices, how state stays consistent (with a state map of tests, accounts, parts and calls), long lists, pop-ups, suspensions and holds, the bell and emails.
- Rules holds every number, cap and timer: test lifecycle, money, ratings, holds and suspensions, limits.
- Security and launch says, in plain words, what the pre-launch security fixes mean for people.
- QA and open questions lists the edge cases to test, the decisions still open and post-launch ideas.
- Testers never see the words hold, suspended, failed or chargeback about a developer. They see "paused" and "delayed".

## Every page

These rules hold on every signed-in page. Each page tab says which of them apply there and links back here.

### Notices

- **Blue:** something changed, or a press didn't go through. It sits right under the button that was pressed, and the page scrolls just enough to show it. It always names the press first: "Your Pay didn't go through."
- **Red:** a mistake in a field (checked when you leave the field and when you submit), a deleted account, and the banner on a paused or stopped test page.
- **Yellow:** a list that needs attention, or a warning that never blocks anything (a reused access key, money left for calls).
- **Green:** a confirmation, e.g. "Saved."
- A failed press never shows success. It says why, keeps what was typed, and updates the page to what is true now.
- **No connection:** a press made offline shows "You seem to be offline. Check your connection and try again." under the button, and the typed text stays.

  [image: No connection: "You seem to be offline. Check your connection and try again." under the button; the typed answers stay.]

### How state stays consistent

- **The server checks every press.** Before doing anything it re-checks what is true now: the tester's place in the test (working, left, ended, rated), the test (open, paused, stopped), holds, suspensions, blocks, spots, Open until, deadlines and limits. More in Why an old tab can't act on stale information.
- **Live box.** Changes made by other people, or by you in another tab, appear in a blue box at the top of the page as they happen: "Updated · 3:10 PM: Ana sent her written answers", newest first, with Dismiss.
  - The first update since the page loaded scrolls the page smoothly up to the box, and the new line flashes. It happens once per page load; later updates just appear. It never happens because of a press.
  - Nobody is pulled away mid-task: while a field has focus or a pop-up is open, the page doesn't move. A small floating pill, "1 new update ↑", shows instead; pressing it scrolls up, and it disappears once the box is in view. Nothing moves when the box is already in view. With reduced motion turned on, the page jumps without the animation.

  [video: The developer is at the bottom of the test page when Ben sends their answers: the page scrolls smoothly up to the live box and the new line flashes.]

  [image: Ana is typing when the developer pays them: the page doesn't move; a small pill "1 new update ↑" shows instead.]
- **Stop-once.** The first press after a change you haven't seen stops once. A blue box under the button reads, top to bottom: "Your <button> didn't go through." (e.g. "Your Pay on Ana Silva's written answers didn't go through."), "Since you opened this page:" and the changes with their times, the Alerts lines, and last, in bold, "Press <button> again to go ahead." The next press goes ahead unless something newer happened. Rate works the same way: on a test still open it stops once for every kind of change; after the test stops or closes, only for a Pay, Charge, Let it go or dispute. Every kind of change, for developers and testers, and the kinds that never stop: Why a press stops.
  - Example: the developer presses Pay on Ana's answers just as Ana disputes her recording. Pay stops once with "Ana disputed the pay for her recording".
- **Always refused.** A change that makes the press impossible refuses it every time, not once: the test stopped, the work ended, the request was already taken, the offer was replaced. A refusal names the press too: "Your Pay didn't go through: <reason>."
  - Example: "Ben stopped the test on Oct 12. Work you sent is still reviewed."
- **Your other tab.** A press already made in another tab stops once with "You also did this in another tab: …".
- **Red wins.** Nothing saves while a field is red.
- **Nothing happens twice.** If a press reached the server but its answer was lost (the connection dropped), pressing again never does it twice: Pay, Pay more, Pay what you owe, Charge, Let it go, Send work, Join, Apply, Accept, Book a call, Rate and Allow or Deny either answer "already done" or act once. Each payment carries a one-time key, so a repeated press returns the first result instead of charging again. A chat message carries one too: a resend of the same unconfirmed message posts once, while "Hello" sent twice on purpose posts twice.
- **Payments that never answered.** If the payment service doesn't answer, the press says so: "We didn't hear back from the payment service, so this payment is being checked. Within 15 minutes it shows as paid, or it's back here to pay again. Don't pay it twice: it's never charged twice." After 15 minutes the app checks it: if it went through, it's finished as normal; if it didn't, the piece is back in Needs you with Pay, and nobody gets a bell. A new press on that piece within 24 hours reuses the same one-time key.
- **Old tabs and Back.** Back and Forward show the saved page, then refresh it from the server; nothing on a restored page is trusted. More in Why going Back is safe.
- **Cross-tab sign-in.** Signing in as someone else switches every other tab of that browser to the new account, on the page the sign-in landed on. Signing out in one tab signs out every tab and sends them to the sign-in page. A press racing the switch is refused ("You're signed in as someone else in another tab. This page is switching to that account.") and that tab switches.
- **Renames** never stop a press, and nothing is added under it. Every change of the product name or the test name is recorded in each working tester's contract changes (Developer test page, Tester session page).

### State map

Each object's states, and where people see them.

**Test**

| State | Meaning | Where it shows |
|---|---|---|
| Draft | A next round not opened yet | Developer dashboard card "Draft". It isn't a test page: it opens in Post a test, filled in, where Post the test opens it for testers. Not in Find tests; for testers its link is not found. |
| Open | Takes testers until Open until passes or it's full | Developer dashboard card: "Accepting testers". Find tests (unless it's invite only) and the join page (Join, Apply); testers' session pages work normally. |
| Full | No spots left | Developer dashboard card: "Full". Not in Find tests. Join page: "This test is full." Invited testers: "<test> is full right now. Your invite stays open; we'll tell you when a spot opens." |
| Joining closed | Open until passed; testers who joined keep working until their own deadlines | Developer card and test page: "Joining closed · testers working until <latest deadline>". Not in Find tests; the join page says "This test closed to new testers on <date>."; waiting applications and open invites close. It's done when the last working tester's deadline passes or everyone has finished. It no longer counts toward the open tests (DEFAULT). |
| Paused | An admin paused it, or its developer is on a payment or chargeback hold, or their developer side is suspended. It closes after 7 days. | Developer dashboard card: "Paused: account suspended / payment hold / chargeback hold / paused by the team". Whatever the cause, the test page opens in the paused view: the red banner, the overview with Stop the test and End early, Booked calls with Cancel, excerpt requests and disputes (Developer test page). Testers: "This test is paused right now." and a "Paused" tag on their dashboard; their session page hides what doesn't work right now (Send, the call-request tools and Join call) under a blue banner that lists what still works; invites and applications wait. When it lifts, deadlines and Open until move later by the length of the pause. Not in Find tests; others opening the link see "This test isn't available right now." |
| Stopped | Stopped by the developer or an admin, or its developer was deleted | "Stopped" label on both sides; the developer's red banner and the tester's still-allowed line (below). Testers get a live-box line and a bell line. |
| Closed | Closed after 7 days paused, or an admin pressed Close now | Like Stopped. Card: "Closed after 7 days paused". Testers read "This test ended on <date>." with no reason; the developer gets the reason by bell and a banner. |

**Account**

| State | Where it shows |
|---|---|
| Active | Everything works. For 3 days after reinstatement the dashboard shows "Your account is active again" (on a mixed account, "Your developer account…" or "Your tester account…"). |
| Email not confirmed | A strip: "Confirm your email: we sent a link to <email>". Post a test, Join, Apply and accepting an invite are refused (below). |
| Payment hold (developer) | Every signed-in developer page except the dashboard, Payments, Settings, the bell list and the paused view of their test pages moves to the dashboard top, with the blue box. All their tests are paused. |
| Chargeback hold (developer) | The same, plus the three chargeback steps on Payments. |
| Developer side suspended | The same, for the developer side only. Their tester side works as normal. |
| Tester side suspended | Their tester pages close and move them to the dashboard top; removed from every test; developers see "Left this test". Their developer side works as normal. |
| Deleted | Every open tab logs out with a red "This account no longer exists". Others see "Deleted account". |

**Part (a piece of work in a tester's contract)**

| State | Where it shows |
|---|---|
| Not sent | Session page "Your parts"; tester dashboard To do. |
| Sent, waiting for review | Developer: the piece in Needs you (one green Pay) and the dashboard's Needs review. Tester: "Waiting for the developer". "Sent late (deadline was <date>)" if sent after that tester's own deadline. |
| Paid | Tester: "Paid" and "Paid so far $Y"; at $0: "Paid $0: "<reason>"". Developer: a receipt. |
| Payment delayed | The developer's card was declined (a hold starts). Tester: "Payment may be delayed". |
| Waiting for the bank | The developer's bank wants them to confirm the payment. On their own press the bank's pop-up opens at once; a charge made while they weren't there waits for Confirm on Payments for 3 days, then counts as declined. While a press waits for the bank the piece is locked: a Charge or Let it go is refused with "A payment for this is being confirmed right now." Tester: "Payment may be delayed". |
| Rejected (older work only) | There is no Reject any more. Work rejected before it was removed still reads "Rejected" with the reason, and can still be disputed once. |
| Charge open | At the review date: the later of that tester's own deadline and 7 days after sending (for a listed call, 7 days after the call). Tester: Charge or Let it go; the dashboard's "Charge or cancel". Developer: can still Pay until the tester chooses. Never for an unlisted part. |
| Charged | The tester charged up to the listing. During a payment or chargeback hold it's added to what the developer owes and paid when they pay; the tester sees "Charged $X. Payment may be delayed until the test resumes." Developer sees "<name> charged $X for this." |
| Let go | Closed with nothing more paid. |
| Disputed | Any part the developer paid (any amount, $0 included; unlisted parts too; an older rejection too) can be disputed once. Developer: the dispute in Needs you; admin: Open disputes. Decided: both are told. |
| Can't be paid | The developer deleted their account while the work was still under review. Tester: "Can't be paid: <dev> deleted their account". |

**Call**

| State | Where it shows |
|---|---|
| Requested | Waiting requests on both sides' Live session panels (Accept, Decline, Withdraw). Two requests for the same time book at once ("Booked: you both picked <time>"). |
| Booked | Both Live session panels and the developer dashboard's Calls box: timer, Add to calendar, Cancel ▾. |
| Joinable | From 10 minutes before the start to 30 minutes after the booked end: Join call appears wherever the call is listed. |
| In progress | While either person is on the call page: "Call in progress / measuring". The app measures the minutes both were there at the same time. |
| Cancelled | By either side, or by a pause, stop, end early, leave, block, outage, or nobody joining by halfway. Join disappears; a late press reads "Your Join call didn't go through: <name> cancelled this call at <time>." and the row leaves the upcoming lists. |
| Took place | The length is final once both have left, or 30 minutes after the latest allowed end: "Length: 29 min (both in the call 2:21–2:50 PM)". The developer pays; they can lower the length (with a reason), never raise it. Either side can report a problem. |
| Over | Every call that's over (took place, cancelled, nobody joined, missed because of a pause or outage, skipped) moves out of Live session: to the tester's row ("Calls (N)") for the developer, and to "Call history" for the tester, each with its outcome badge. |

### Sign-in and accounts

- Sign up with email and password (or with Google, when it's switched on) and agree to the Terms of Use, then log in. Forgot password sends a link that works once and signs out every device. Changing the password signs out other devices. "Sign out of all devices" in Settings signs the account out everywhere, this device included.
- **Signing in** says only "Wrong email or password" when anything is wrong: no account, a deleted account, an account made with Google (no password), or a wrong password. It never says which. When Google sign-in is on, the form adds "Signed up with Google? Use Continue with Google."

  [image: One message for every wrong sign-in: "Wrong email or password".]
- **Too many tries.** 5 failed tries for one email in 15 minutes, or 20 from one network, pause sign-in for that email or network: "Too many tries. Wait 15 minutes or reset your password." This applies even when the password is right. At most 10 new accounts can be made from one network in an hour ("Too many new accounts from here. Try again in an hour.").

  [image: After several wrong passwords: "Too many tries. Wait 15 minutes or reset your password."]
- **Forgot your password?** always shows the same answer, whatever the email, so it never reveals who has an account. An account with no password (made with Google) gets "Your account has no password yet. Choose one here:" with the same link. At most 10 reset requests from one network an hour ("Too many reset requests from here. Try again in an hour."). Sign-up keeps "An account with that email already exists".
- Email confirmation is needed for Post a test, Join, Apply, accepting an invite and payout setup. A blocked press shows, under the button: "Confirm your email first. We sent a link to <email>." with "Resend the link". Payments says "Confirm your email first: payouts go only to a confirmed account. We sent you a link." The server checks too.
- **Signing in with Google to an account whose email isn't confirmed yet** makes it safe first: the account's password is cleared, every device is signed out, and any payout setup is dropped. Then the email counts as confirmed. So nobody can make an account with someone else's email and keep it once the real owner signs in.
- On a local setup with confirmation switched off (SKIP_EMAIL_CONFIRM=1), a strip under the header says "Email confirmation is off for testing." It never shows in production.
- Names need at least 1 character, nothing else.
- Deleted account: every open tab logs out with a red "This account no longer exists".

  [image: Kai deleted their account in another tab: this tab is signed out with the red notice.]

### Long lists

- Every blue box (the live box, stop boxes, notices in pop-ups, notices under buttons) shows 3 lines, then "Show N more", which opens a scroll box about 8 lines tall.
  - Example: 12 testers send work while the page is open. The live box shows the 3 newest, then "Show 9 more".
- A list inside a row, such as the unmet needs on an invite row, shows 3 items, then "+N more".
- Dashboard boxes show the newest 3 rows, then "Show N more". The restricted dashboard's "Disputes: add your side" and "Excerpt requests" boxes scroll once they hold more than 3 items (about 3 items tall).
- Long names and titles are cut with "…" in rows (full text on hover) and shown in full where they are the main content.
- **Long text** is handled the same way everywhere:
  - The NDA, wherever it's shown (the join page, the session page's terms, the Switch / Keep offer, Terms history, and the preview on Post and Edit), sits in a scroll box about 12 lines tall; the offer and Terms history show "Before" and "Offered" as two such boxes, never in full.
  - The steps ("What should testers do", up to 20,000 characters) sit in a scroll box about 6 lines tall on the listing, the join page and the session page (short steps show without a scroll bar); on cards and rows, 3 lines, then "Show more"; in the offer box and Terms history, "Before" and "Offered" are two such scroll boxes.
  - Each question (up to 20,000 characters) sits in a scroll box about 6 lines tall wherever it's shown in full: the answer form, previous question sets, the listing and join page, Post and Edit, the developer's piece view and By question, and the admin's "See the work". In lists (the offer box, "Questions then and now", cards) each question is cut to 3 lines with "Show more", and the list shows 3, then "+N more".
  - A piece's written answers sit in their own scroll box about 16 lines tall when they're longer, with the question labels inside; the Pay box stays outside it, always visible.
  - **Reasons and notes** (the team's reasons, End early's reason, Pay notes, the reason for paying $0 or less than the listing, a lowered call length's reason) show under their heading in italics, as a quote: The team stopped this test. / *"Media pass check: build link is broken"*. A long one sits in a scroll box about 4 lines tall. This holds on banners, tester rows, Needs you, the session page and the admin lists and History. Messages in rows show 3 lines, then "Show more".
  - Limited fields have live counters and are refused in red at the field when too long, never cut without telling: "N / 20,000" (the steps, each question), "N / 1,000" (the NDA, every reason and note), "N / 10,000" (End early's reason), "N / 2,000" (dispute text and the developer's side) and "N / 50,000" (a written part, Contact us).

### Pop-ups

- **Confirm pop-ups** (Cancel is focused; the confirm button is red): Stop and End early on Developer test page; Leave, Let it go and Rate and finish on Tester session page. While open they show live blue notices ("Just updated (3:10 PM): …", the 3 newest, then "Show N more"). If the confirm fails (an unseen change or any refusal), the pop-up closes and the blue notice, naming the press, plus the changes shows under the button that opened it. Leave's pop-up is built from the current state when it opens, and Leave itself never stops.
- **Inline "anyway" boxes:** Join anyway on the join page and Invite anyway on Developer test page. They list the needs still unmet, update live, and disappear when all are met. A press after a change shows the updated list with "Your press didn't go through"; any other failure closes the box, with the notice under the original button.
- Block and Delete account also confirm, without live notices.

### Drafts, numbers and ranges

- Unsent text (written answers, chat, dispute text, rating comments, Pay notes, Post and Edit) is kept per person and form, up to 50 forms per person (a new one drops the oldest). When they come back to the page it returns, labelled "Not sent yet". Never on log in or sign up.
- Numbers use thousands separators. Money being paid or charged is always exact. Big stat tiles shorten: in full under 10,000, then k, M, B, T, then × 10^N, with no trailing ".0" (12,400 shows as 12.4k).
- Every box with a minimum or maximum shows the range next to it ("10–180 min", "at least $1.00").

### Suspended or on hold

A payment hold, a chargeback hold and a suspension of the developer side do the same thing to a developer's pages; a suspension of the tester side does the same to a tester's. Suspensions are per side: an admin suspends the developer side or the tester side of an account, and the other side keeps working. A hold limits only the developer side. Causes, timers and lifting are in Rules.

- **Routing.** Every signed-in page of the restricted side except the open ones below moves them to the dashboard top, live and on load; on the dashboard it scrolls up. Every press is checked on the server by the side it belongs to, and a refused press sends them there too.

  [video: A payment hold starts while the test page (left) and Edit (right) are open: both move to the dashboard top, where the blue box explains.]
- **Blue box at the dashboard top** (never red). It says:
  - if they just pressed something, "Your <press> on <test> didn't go through";
  - their account (on a mixed account, "your developer account" or "your tester account") is suspended or paused, or on hold (payment or chargeback);
  - all their tests are paused, and testers stay in them;
  - how to resume: "Pay what you owe" (opens Payments in a new tab), the chargeback steps on Payments, or an appeal through Contact us in Settings;
  - after more than 3 holds: the team will review the account after they pay;
  - when it lifts, their tests resume as normal.
- **Open while it lasts:** the dashboard; each test page, opened from its dashboard card, in the paused view only (below); Payments (receipts, Pay what you owe, Change card, payout setup); Settings (Contact us, the email setting, Sign out of all devices, Delete account; the profile editor is hidden); the bell list, where a line whose page is closed opens the dashboard top. Change card works during a payment hold, a chargeback hold and a suspension, and a suspended tester can still set up payouts. The open pages other than the dashboard show one blue line under the header, e.g. "Your tests are paused until you pay what you owe. Pay what you owe." **Closed:** tester and developer profiles, session pages, Find tests and test listings, Messages and chat, Edit, the full test page, Post a test. On their dashboard, names are plain text with no hover card, so there's no Chat with, Report, Block or profile link.
- **What works on their tests.** A test page opens in the paused view: the red banner, the overview with only **Stop the test** and **End early**, a compact **Booked calls** list with **Cancel** on each, the test's excerpt requests (Allow, Deny) and Take down, and the disputes.
  - Stop the test and End early go through silently: no stop-once, whatever changed. End early still needs its reason. Afterwards the developer lands on the dashboard top, which says "Done: you stopped <test>." or "Done: you ended <N> testers' work on <test>."
  - Cancel call keeps its normal stop-once, and they stay on the paused view. Calls can also be cancelled from the dashboard's Calls box.
  - Excerpt requests are never stopped, routed or refused for the pause.
  - The developer's side of a dispute can always be added, from the dashboard's "Disputes: add your side" box under the blue box: each open dispute with the tester's text and the Add your side box.
  - Pay waits until it lifts. Any other press from an older full page is refused and routed to the dashboard top with the failed-press line.

  [video: From the card to the paused view; a call cancelled; Stop goes through and the dashboard says it's done.]

  [image: A suspended developer opens the test from its card: the red banner (title, reason, what's allowed), the overview with Stop and End early, Booked calls with Cancel.]

  [image: Stop went through silently, and the dashboard top says "Done: you stopped Harbor Run: first 3 levels."]

  [image: While suspended, the dashboard lists each open dispute with the tester's text and the Add your side box; more than 3 scroll.]
- **A mixed account** keeps its other side. The side switch still works: switching to the restricted side lands on the dashboard top with that side's blue box, and the other side's pages stay open. With the developer side suspended, they can still find and join tests, send work, Charge, get payouts and chat as a tester.

  [image: The developer side is paused ("Your developer account is paused"); the switch to the tester side still works.]
- **Chat** closes only for a restricted person, never because a test is paused. The restricted person's chat pages are closed, and a Send from a page loaded before the restriction is refused and routes them to the dashboard top, with the typed text kept. The other person can still open the chat and read everything; the message box is replaced by "Messages are paused for now. You can still read this chat." A Send from a page loaded before then shows, under Send, "Messages are paused for now, so this wasn't sent." and keeps the text. When the restriction lifts, the message box comes back live. Only chats where the person is on the restricted side are paused: a developer-side suspension pauses the chats on their own tests, not the chats on tests they're testing.

  [image: The developer is restricted: the tester reads "Messages are paused for now. You can still read this chat."]
- **Testers in a paused test** aren't restricted: they keep their session page, where the paused rules apply: they can't send work (drafts can be saved), request calls or join calls, and they can still cancel calls, dispute, Charge or Let it go, rate and leave (Tester session page). Chat follows the rule above: open on a test the team paused, read-only while the developer is restricted.
- **A suspended tester side** follows the same rules: the open pages above stay open, and every other tester page, their session pages included, moves them to the dashboard top. The blue box there says their account is paused, they were removed from their tests, how to appeal (Contact us in Settings), and that pay for work already accepted still reaches their Stripe account. Any other press is refused with "Your account is paused. Contact support if you think this is a mistake." Their dashboard is in Tester dashboard, Find tests and the join page.
- Testers never see hold, suspended, failed or chargeback about a developer. They see "paused" and "delayed".

### Paused and stopped test banners

Any pause is treated the same, whatever its cause: the team paused the test, a payment hold, a chargeback hold or a developer-side suspension. The only difference by cause is the banner's title and reason. The developer's test page shows one red banner for paused and stopped tests, top to bottom:

1. The title, by cause: "The team paused this test." / "The team stopped this test." / "Your tests are paused until you pay what you owe." / "Your account is suspended: your tests are paused." / "This test is stopped."
2. The reason, in italics in a scroll box, when there is one.
3. The updates: the failed-press lines ("Your Save on <test> didn't go through: the team paused this test.") and any other live lines for it.
4. At the bottom, what's still allowed, built from the buttons actually shown, so it never lists something hidden:
   - paused (any cause): "For now you can stop this test, end testers' work early, or cancel calls."
   - stopped: "You can still pay for work testers already sent, chat with them, rate testers, and read their answers", ending ", and start a Next round" only when Next round is really there (never after a team stop).

[image: The team paused this test: the title, a 1,000-character reason in italics in its scroll box, and at the bottom "For now you can stop this test, end testers' work early, or cancel calls."]

[image: A payment hold: "Your tests are paused until you pay what you owe." on the same banner.]

[image: Stopped by the developer: "This test is stopped." and what still works, with Next round.]

[image: The team stopped this test: the same banner; Next round isn't offered after a team stop, so the allowed line doesn't list it.]

### Stopped tests

- A stopped or closed test shows a "Stopped" label at the top and:
  - developer: the red banner above, "This test is stopped." (or "The team stopped this test.") with what still works;
  - tester: one line on what can still be done: charge or let go once Charge opens, dispute, rate, leave (if still in), chat.
- Every other button and panel is hidden, so the page shows only what still works (Developer test page, Tester session page). An old page's press is refused in blue, naming the stop.
- Every press left runs the stop-once check, on stopped and paused tests alike, except Stop the test and End early on a paused test, which go through silently. For example: the developer's Pay or Pay more stops for a dispute, a Charge or a Let it go on that piece; the tester's Charge, Let it go and Dispute stop for the developer's Pay; Charge or Let it go is refused if the developer paid meanwhile ("<dev> paid $X for this meanwhile."); Dispute stops once when the developer adds their side; Rate stops once for a Pay, Charge, Let it go or dispute, and is refused while a dispute is open; Cancel call stops once for any change to that call.

### Deleted accounts

- The deleted person: every open tab logs out with a red "This account no longer exists".
- A deleted developer: their tests stop and leave Find tests; testers see the stopped test and what they can still do; invites and applications close; chats become read-only; the profile shows "Deleted account" with ratings kept; parts where Charge was already open stay open, and a tester's Charge goes to the deleted developer's saved card (if it's declined, the payment stays delayed for the tester and is listed for admins; the platform doesn't cover it); work still under review never opens Charge, and the tester's part carries the badge "Can't be paid: <dev> deleted their account"; open disputes are still decided by the admins, a decision for the tester charging the saved card the same way; pending excerpt requests on their tests close, and excerpts already shown stay.
- A deleted tester: removed from every test (developers see "Left this test" and the name "Deleted account"); their work, payments and ratings stay; calls ahead, invites and applications are cancelled; open disputes are withdrawn; chats close. Work they sent stays in the developer's Needs you, with Pay and the usual reminders, and Pay reaches their Stripe account if their payout account was connected. If it wasn't, those rows leave Needs you with "<name> deleted their account before setting up payouts, so this can't be paid." (DEFAULT). Unsent work is gone, and so are Charge and Dispute. Their excerpt requests and shown excerpts are removed. A delayed payment still reaches their Stripe account when the developer pays, if their payout setup is finished.
- Admins still see deleted accounts in full: who deleted them, why, and the history.
- Deleting never clears a hold, a chargeback or money owed. A developer can always delete their account; the warnings are in Settings on Shared pages.

### The bell

- **Reach.** A line about another person arrives only if that person is or was in one of your open tests. Invites, applications, payments and disputes always arrive, because they can come from outside an open test. Chat follows the same reach.
- **Every line opens the exact spot**, e.g. the developer's Needs you row, the tester's part, a call, the keys box, Payments. A line about a call that's over opens that call in the tester's row (developer) or in Call history (tester), marked; a call still ahead opens Live session. Each page tab lists the lines that open it.
- **Stacking.** Lines about one test on the same day stack into one entry that opens to show them. Lines of the same kind stack across tests, one entry per kind per day: payments and holds; the team's decisions; disputes filed; disputes decided; the team acted on your tests; the paused-test reminder; tester Paid, Payments delayed, Delayed payments arrived and Extra pay (Pay more); tests stopped or ended; invitations waiting; Charge or Let it go; work waiting for your review; call requests; payout problems; tester applications closed by a listing change ("3 tests you applied to changed: your applications were closed"); tester invites sent again on a new listing ("3 tests you were invited to changed: your invites were sent again"); the admin suspended-accounts review. Test titles are always quoted, stacked or not.
  - Example: Harbor Run and Sky Lab both pay Ana on Monday. Ana's bell shows one "You were paid" entry with both inside.
- Receipts, a pause being lifted or extended, and outages are always their own line.
- **No reasons in the bell.** A bell line never carries a reason, a note, a dispute's text or a chat message. It says what happened and opens the place where the text is shown. Emails include them in full.
- **Each reader's own time.** Every time in a bell line or an email is written in the reader's own time zone and names it: "2:00 PM EST". The app learns each person's time zone from their browser when they sign in (UTC until it knows). Times on pages use the browser's own clock. Scheduling stays automatic: times are picked in the picker's own time zone, the other side sees them in theirs, and there's no time zone menu.

  [image: The developer's bell in Chicago time: "Booked: <day> at <time> CST".]

  [image: The same booking in the tester's bell, in their own zone (JST).]
- **Reminders wait while a test is paused** and start again when it runs again. The developer's daily paused reminder is the exception.
- **Reminders also go in the summary email** if the email setting allows it. Each line is emailed once; a Weekly or Monthly email shows only the newest copy of each reminder.
- Admin lines about disputes, reports and lifts show "Reported more than 3 times" next to names where it applies (Administrator console).

[image: The developer's daily lines: review reminders on one schedule, "N applications wait for your answer", and a call to pay.]

**Every bell line**

| Who | Line | When | Stacks in |
|---|---|---|---|
| Developer | "<tester> joined <test>" (also after an accepted application, invite or rejoin) | each time | that test's day |
| Developer | "<tester> applied to join" / "<name> asks to rejoin"; then "N applications wait for your answer" | each time; then daily while waiting | that test's day |
| Developer | "<tester> left <test>" (also after a suspension or deletion) | each time | that test's day |
| Developer | "<tester> sent / updated written answers / a recording" | each send | that test's day |
| Developer | "<tester> asked to show an excerpt from <test> on their profile" | each request | that test's day |
| Developer | "<tester> asked for a call: <time(s)>" | each request | Call requests |
| Developer | Call lines: booked, cancelled ("<name> cancelled the call on <day>."; the reason is in the email and on the call), remaining calls cancelled, nobody joined, cancelled because the test is paused, missed because the site was down, a Forever call skipped for a clash | each time | that test's day |
| Developer | "“<test>”: review <tester>'s <part> within 1 month / 3 weeks / 2 weeks / 1 week / 3 days / by tomorrow" (a listed part adds "(after that <tester> can charge or let it go)"; an unlisted one "(it isn't listed: any amount, $0 included)"); a listed call: "“<test>”: pay <tester>'s call on <time> within …" | the marks still ahead when the work is sent, counting to its review date: 1 month (only if it was more than a month away), 3, 2 and 1 weeks, 3 days and 1 day before; none within 24 hours of sending, because "<tester> sent work" counts as the first | Work waiting for your review |
| Developer | "“<test>”: <tester>'s <part> waited over 7 days: pay it (<tester> can now charge or let it go)" (and the same for a listed call) | daily once the review date has passed, for listed work only; an unlisted part's reminders stop at its review date | Work waiting for your review |
| Developer | "Pay your calls: your call with <tester> on “<test>” isn't paid yet (any amount, $0 included)." / "Pay your calls: 3 calls to pay on 2 tests." (calls that aren't listed) | weekly, until each is paid ($0 counts) | own line |
| Developer | "“<test>” closes to new testers on <date>." (Open until is near) | 1 month, 1 week, 3 days, 1 day before Open until | that test's day |
| Developer | "<tester> disputed a payment on <test>" | each time | Disputes filed |
| Developer | "A dispute on <test> was decided" | each time | Disputes decided |
| Developer | "Receipt: you paid $X for …" | every charge that goes through | own line |
| Developer | "Your tests are paused" / "…paused after a chargeback" / "Another payment was declined: $X … was added to what you owe" / "Your bank reversed a $X payment …" / "Your bank's chargeback of $X was reversed in your favour." / "We charged your card $X for what you owed." / "Your bank wants you to confirm a $X payment. Confirm it in Payments by <date>." / "Your payment went through. Your tests stay paused while your account is suspended." / "Your tests are running again" (only when nothing pauses them any more) | each time | Payments and holds |
| Developer | "Your $7 subscription payment didn't go through. Update your card by <date> to keep it." / "Your subscription ended because the payment didn't go through." | when a renewal is declined; when the last retry fails | Payments and holds |
| Developer | "…extras need a $7/month subscription from <date>" (free during launch is ending) | 30 days and 7 days before the FREE_UNTIL date | Payments and holds |
| Developer | "The team approved lifting your hold" / "A note from the team about your hold" | admin Approve | The team decided |
| Developer | "<test> is paused and closes on <date> unless you pay what you owe" (or "…your account is cleared", "…the team lifts the pause") | when it pauses, then daily | Paused tests |
| Developer | "The team paused “<test>”" / "The team stopped “<test>”" (the team's reason is on the test page and in the email, never in the bell) / "“<test>” was closed. <why>" (the app's own explanation, never a typed reason) | each time | The team acted on your tests |
| Developer | "The team lifted the pause on <test>" / "<test> will close later" | each time | own line |
| Developer | "<tester> finished <test>. You can rate them for 14 days.", then "Reminder: rate <tester>…" | when they rate; every 3 days after a stop, inside the 14 days | that test's day |
| Tester | "<dev> invited you to <test>", then "Reminder: <dev> invited you…" | each invite; daily until answered | Invitations waiting |
| Tester | "<test> is full, so your application was closed" / "…is full right now. Your invite stays open…" / "A spot opened on <test>…" / "…is now invite only…" / "<test> changed since you applied" | each time | that test's day |
| Tester | "<test>'s listing changed, so your application was closed. You can apply again on the current listing." | each Save that changes the listing | Applications closed ("3 tests you applied to changed: your applications were closed") |
| Tester | "<dev> updated <test>: your invite was sent again on the new listing." | each Save that changes the listing | Invites sent again ("3 tests you were invited to changed: your invites were sent again") |
| Tester | "You're in: <test>" / "You're back in <test>: your deadline is <date>." / "Your application (or ask to rejoin) wasn't accepted" | each time | that test's day |
| Tester | "<dev> updated the listing: <changes>" (new terms offered) | each Save that changes their terms | that test's day |
| Tester | "Work sent: your …" | each time | that test's day |
| Tester | "<dev> paid you $X for your <part> on “<test>”" (or "<dev> paid $0 for your <part> on “<test>”"); the note is on the session page and in the email | each time | You were paid |
| Tester | "<dev>'s payment for your <part> ($X) is delayed. You'll be told when it arrives." / "Payment for your work on <test> may be delayed" | each time | Payments delayed |
| Tester | "<dev> paid $X for your <part>" (a delayed payment arrived) | each time | Delayed payments arrived |
| Tester | "<dev> paid you $X more for your <part> on “<test>”" (Pay more) | each time | Extra pay |
| Tester | "Your dispute on <test> was decided" | each time | Disputes decided |
| Tester | "Your excerpt from <test> is now on your profile." / "<dev> prefers that work from <test> isn't shown on profiles." | when the developer allows or denies a request (a bell line only) | that test's day |
| Tester | "Your deadline on “<test>” is <date>: send your work before then." | 1 month, 1 week, 3 days, 1 day before Open until, to working testers whose deadline is then | that test's day |
| Tester | "<dev> didn't review your <part> in 7 days: charge $X or let it go" / "<dev> didn't pay your call on <time> in 7 days: charge $X or let it go", then "Reminder: …" | when Charge opens, then every 3 days | Charge or Let it go |
| Tester | "Rate <dev> on <test>", then "Reminder: rate <dev>…" | once; after a stop or close every 3 days, for 2 weeks | that test's day; its own line once stopped |
| Tester | "<test> is running again" | each time | Tests paused or running again |
| Tester | "<test> was stopped" / "Your work on <test> was ended early" / "<test> ended" | each time | Tests stopped or ended |
| Tester | Call lines (as for developers) and "Your session on <test> ended." (after a block) | each time | that test's day |
| Tester | "Your bank couldn't receive a payout. Update your payout details." | when a payout fails, then every 3 days until fixed | Payout |
| Both | "<name> sent you a message on “<test>”" (chat; the message itself is only in the chat and the email) | each message | that test's day |
| Both | "<name> took down the excerpt from <test>." | when the other side takes a shown excerpt down | that test's day |
| Both | "Your developer account is paused" / "Your tester account is paused" / "Your developer (or tester) account is active again" (per side) | each time | The team decided |
| Both | "The site was down from <a> to <b>. Deadlines and payment dates moved <length> later." | once per outage | own line |
| Admin | "Dispute on <test>: <tester> says the pay should be higher (<dev>)" / "New report: <a> reported <b>" / "Hold lift waiting: <dev> paid what they owe (More than 3 holds)" | each time | one line a day for all three |
| Admin | "N suspended account sides to review" | daily | Suspended accounts |

### Emails

- Each person picks Off, or On with Daily, Weekly or Monthly, under "How you're notified" on the Notifications page (Shared pages).
- With email On, each email lists every bell line since the last one ("Your Playtest summary: N updates"). Each line is emailed once.
- On Weekly or Monthly, payment lines also go out the same evening in "Your Playtest payment updates".
- With email Off, only the lines in the first part of the table are emailed ("Your Playtest account updates").
- Developer receipts, the tester's "You were paid…" and new reports for admins follow the setting.
- Emails carry the full text that bell lines leave out: the team's reasons, Pay notes, End early's reason, a cancelled call's reason, a chat message. Every time is in the reader's own time zone, named ("2:00 PM EST").
- On the live site, emails are always really sent: without the email service set up, sending fails loudly instead of being written to a test outbox.

| Email | To | When |
|---|---|---|
| **Ignore the setting** (sent even with Off, once, in one end-of-day email) | | |
| "Your tests are paused" (payment hold starts) | developer | when it starts |
| "Your tests are paused after a chargeback" / "…your payment hold is now a chargeback hold" | developer | when it starts |
| "Your tests are running again" | developer | when nothing pauses their tests any more |
| "Your payment went through. Your tests stay paused while your account is suspended." | developer | when what they owe is paid (or a chargeback hold lifts) while a suspension continues |
| "Your bank wants you to confirm a $X payment. Confirm it in Payments by <date>." | developer | when a charge made while they weren't there needs their confirmation |
| "Your $7 subscription payment didn't go through. Update your card by <date> to keep it." | developer | when a renewal is declined |
| "Your subscription ended because the payment didn't go through." | developer | when the last retry fails |
| "…extras need a $7/month subscription from <date>" | every developer | 30 days and 7 days before the FREE_UNTIL date |
| "Your developer account is paused" / "Your tester account is paused" / "…account is active again" | developer or tester | suspension or reinstatement of that side |
| "The team paused / stopped “<test>”", with the team's reason in full / "“<test>” was closed. <why>" | developer | each time |
| Admin daily email: new disputes, lifts and chargeback holds waiting for Approve, call no-show and late reports (each once), accounts this admin suspended that still have paused tests, tests this admin paused (with closing dates) | each admin | once a day, only when it has something; can't be turned off |
| **Sent right away** | | |
| "Confirm your email" | the person | sign-up and Resend (at most 3 an hour) |
| "Reset your password" (or, for an account with no password, "Your account has no password yet. Choose one here:") | the person | Forgot password (at most 3 an hour per account, 10 an hour per network) |
| "Contact us: <topic>", with the whole message (up to 50,000 characters) | all admins | each message (at most 5 per account a day) |
| "Playtest: new chargeback of $X" | all admins | each chargeback |
| Any line for an address with no account | that address | at once |

### Outages and phones

- With outage checks on, outages come from the uptime service's own alerts: a "down" alert, then the matching "up". If the site was down 15 minutes or more, every running timer moves later by that time and calls inside it are cancelled with no fault. Everyone affected is told once. Missing pings never count as an outage, and pausing the uptime monitor changes nothing.
- The app uses its own clock for when the site went down and came back, not the times inside the alert. An outage longer than 24 hours moves nothing until an admin approves it in the console.
- Every core task works on a phone; panels fold.

## Why an old tab can't act on stale information

Part of Every page.

- Every press goes to the server, which re-checks what is true now before doing anything: the tester's place in the test (working, left, ended, rated), the test (open, paused, stopped), holds, suspensions, blocks, spots, Open until, deadlines and limits.
- Each form sends the moment its page last updated. Anything newer stops the press once. Anything that makes the press impossible (the work ended, the test stopped, the request was already taken, the offer was replaced) refuses it every time.
- So an old tab can't rejoin, accept a replaced offer, accept a request someone else took, book a call on a stopped test, or pay twice: each payment carries a one-time key, and a repeated press returns the first result instead of charging again.
- Rejoining needs a current ask that the developer accepts. An old page's Join or Accept is checked against today's state and refused if it no longer applies.

## Why a press stops

Part of Every page.

A press stops once when something changed since the page last showed it, so nobody acts on stale information. The blue box under the button reads, top to bottom:

1. "Your <button> didn't go through.", using the button's own label: "Your Pay on Ana Silva's written answers didn't go through.", "Your Stop the test didn't go through.", "Your Save didn't go through.", "Your Send didn't go through."
2. "Since you opened this page:" and the list of changes, with their times.
3. The Alerts lines. Developer: "You can turn these stops off in Alerts, at the top of the page." and "Don't stop me for:" with one quick button per kind in the box. Tester: "You can turn these stops off with Alerts at the top of the page (new terms from the developer still stop)." and "Turn off alerts".
4. Last, in bold: "Press <button> again to go ahead.", e.g. "Press Pay again to go ahead."

A refusal (not a stop) keeps its own wording but also names the press first: "Your Pay didn't go through: <reason>."

[image: Every stop box names the press: "Your Pay on Ana Silva's recording didn't go through." · Since you opened this page: … · the Alerts line · bold "Press Pay again to go ahead."]

Below is every kind of change that stops a press, for each side, then the kinds that never do.

### Developer

Buttons that stop: Next round, Pay, Pay more, Lower the length, Rate, the call buttons (Request a time, Accept, Decline, Withdraw, Cancel ▾), Invite, Save on Edit, Stop the test and End early (except on a paused test, below), and Cancel call in the dashboard's Calls box. Each change kind belongs to an Alerts type, which the developer can switch off (below).

| Change | What triggers it | Alerts type | Line in the blue notice |
|---|---|---|---|
| A tester joined | a join, a rejoin, or an accepted application or invite | Joins and applications | "Ana joined" / "Ana joined again" |
| An application | a tester applies, asks to rejoin, or withdraws an application | Joins and applications | "Ana applied to join" / "Ana asks to rejoin" / "Ana withdrew their application" |
| An invite answer | a tester turns down an invite | Joins and applications | "Ana said no thanks to your invite" |
| The test filled | the last spot was taken | Joins and applications | "<test> is full" |
| A tester left | Leave, or finishing with a rating | Testers leaving | "Ana left the test" / "Ana finished <test> and rated you" |
| Work sent | written answers or a recording sent or updated | Work sent | "Ana sent her written answers" / "Ana updated her recording" |
| Call changes | a call booked, cancelled, requested, withdrawn or declined | Call changes | "Ana booked a call for <time>" / "Ana cancelled her call on <time>" / "Ana requested a call for <time>" |
| A tester's Charge or Let it go | Charge opens, or the tester chooses | Payments | "Ana can now charge or let go of their written answers" / "Ana charged $X for their recording" / "Ana let their recording go: nothing charged" |
| Payments | a payment went through or failed, or the bank's chargeback was reversed | Payments | "Payment failed on <test>: …" / "Your bank's chargeback of $X was reversed: $Y refunded to your card." |
| A dispute | a tester disputes a payment | Disputes | "Ana disputed the pay for their recording" |
| The team decided | an admin decides a dispute or acts on the test | Decisions by the team | "The team decided Ana's dispute: …" |
| Listing info | the description, devices, languages or similar changed in another tab | Listing changes | "<dev> changed the description" |
| Your own press in another tab | the same press or a Save made in another tab | Your saves and presses in another tab | "You also did this in another tab: …" |
| A chargeback | the bank reverses a payment | none: always stops | "Your bank reversed your $X payment for <what>" |
| The subscription ended | a cancel reached its end, or a renewal lapsed | none: always stops | "Your subscription ended." |

On a paused test (any cause) the Alerts menu lists only the kinds that can still happen: Testers leaving, Call changes, Payments, Disputes, Decisions by the team, and Your saves and presses in another tab. On a stopped test (the developer's or the team's) it lists only Payments, Disputes, Decisions by the team, and Your saves and presses in another tab. The menu keeps the developer's ticks; it only shows fewer types.

[image: Work sent: Ben sent his answers since the page loaded, so Pay stops once and lists it under the button.]

[image: A tester left: Cam left while the Stop pop-up was open; the press didn't go through and the change shows under Stop.]

[image: Joins and work sent on Edit: Ana sent answers and Ben joined while Edit was open, so Save stops once with the list.]

[image: The subscription ended while the test page was open: "Your subscription ended." in the live box; a press stops once for it.]

[image: Alerts on a paused test: only testers leaving, call changes, payments, disputes, the team's decisions and your own saves.]

[image: Alerts on a stopped test: payments, disputes, the team's decisions and your own saves only.]

### Tester

Buttons that stop: Switch / Keep, Send (written answers and recording), Charge, Let it go, Dispute, Rate, Request a time, Accept, Decline, Withdraw and Cancel call. Leave and Block never stop. After a test stops or closes, Rate stops only for a Pay, Charge, Let it go or dispute. The join page has its own short list (Tester dashboard, Find tests and the join page).

**Alerts: On / Off.** Testers have one press, "Alerts: On" or "Alerts: Off", at the top right of the session page, with the line "On: a button stops once when something changed since you opened the page. Off: only new terms from the developer stop it." It's saved per tester for all their tests. With Alerts Off, only changes to their contract stop a press (new terms, and their key marked as working); every other change still shows in the live box, greyed, and never stops. Refusals are unchanged.

| Change | What triggers it | Line in the blue notice |
|---|---|---|
| New terms (stops even with Alerts Off) | the developer offered new terms; the page scrolls up to the offer | "<dev> offered new terms: <changes>", ending "Press again to send under your current terms, or switch first." |
| Your key marked as working (stops even with Alerts Off) | the developer marked the tester's key as working | "The developer marked your key as working (HR-2222)" |
| Your work was reviewed | the developer paid for it | "<dev> paid $X for your written answers" |
| Call changes | the developer's requests, a booking, a decline or a cancelled call | "<dev> requested a call for <time>" / "<dev> withdrew the request for …" / "The call time <time> is no longer available: another tester took it" / "<dev> accepted your call request: <time>" / "<dev> declined your call request for <time>" / "Your call on <time> was cancelled" |
| A delayed payment, or its arrival | the developer's payment was declined, then went through | "<dev>'s payment for your <part> ($X) is delayed. You'll be told when it arrives." |
| Your dispute | the developer added their side, or the team decided | "<dev> added their side to your dispute" / "The team decided your dispute: the pay was raised to $X" |
| Listing info | the description, devices, languages or similar changed | "<dev> changed the description" |
| Your own press in another tab | the same press made in another tab | "You also did this in another tab: …" |

[video: Ana has typed their answers; the developer pays their recording; Send stops once with the blue list; the second press sends.]

[image: The tester's stop box: "Your Send didn't go through." · Nora Lane paid $15.00 for your recording · "Turn off alerts" · "Press Send again to go ahead."]

[image: Charge stops once and names itself: the developer changed the listing after the page loaded.]

[image: "Alerts: On" at the top right of the session page, with its line.]

[image: Alerts Off: a payment made after the page loaded shows greyed in the live box, and Send goes straight through.]

[image: With Alerts Off, a terms offer still stops the press: the page goes up to the Switch or Keep box.]

### Changes that never stop a press

- **A tester switching terms:** one quiet line in the developer's live box, "Ana switched to the new terms" (several in a day: "3 testers switched to the new terms"), because work already sent keeps its price, so nothing a press could change. A Keep shows nothing.
- **Renames:** a change of the product or test name is info only. The press goes through with nothing added under it; the rename is recorded in each working tester's contract changes.
- **A key reported broken:** one quiet line in the developer's live box, "Ana reported their key doesn't work", with no bell.
- **Excerpt requests:** asking, Allow, Deny, Remove and Take down go through whatever changed, including on paused and stopped tests; only a request that no longer exists is refused.
- **The tester's Leave and Block:** they go through on the first press (Leave's own confirm pop-up stays). They are still refused when they can't happen ("You already left this test.").
- **The developer's side of a dispute:** "Send your side" never stops. It's refused only with "This dispute was already decided." or "You already added your side."
- **Stop the test and End early on a paused test** (any cause) go through silently, whatever changed.
- **Your own edits:** what you do on the page never stops you; only the same press already made in another tab does (above). Spots and Open until never stop a tester either.

[image: Leave never stops: the listing changed after the page loaded, and Leave (after its own confirm) went through on the first press.]

### How it works

- **One stop per change.** Each change stops a press once, and the blue box lists every change since the page last showed one.
- **The second press goes through** unless something new happened after the box appeared; then it stops again, listing only the new changes.
- **Alerts can switch kinds off.** Developers tick types in Alerts on the test page; testers turn Alerts Off. A switched-off type no longer stops a press and shows greyed in the live box. Holds and pauses, a closed tester account, a stopped test, a chargeback, the subscription ending, new terms for a tester, and refusals always stop.

[image: Ticked types no longer stop your buttons; they still show, greyed, in the live box.]

[image: A ticked type still shows in the live box, greyed ("You turned these stops off in Alerts" on hover).]

- **Red comes before blue.** A red field stops the press in the page, before it reaches the server, so a blue notice can only show on the next press, once the red is fixed.

[image: Open until 40 days ahead on the free plan with a test already open: the red at the field stops Post in the page, so the server's blue notice can't show yet.]

[image: With the date fixed, the next press reaches the server and the blue notice appears under Post the test.]

- **A refusal is not a stop.** A change that makes the press impossible (the test stopped, the work ended, the request was already taken, the offer was replaced) refuses it every time, with no "Press again". Those refusals are listed on each page.

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

- **Blue box**, only during a hold or a developer-side suspension. Under it, while it lasts: "Excerpt requests" (Allow, Deny) and "Disputes: add your side" (each open dispute with the tester's text and the Add your side box). Each box scrolls once it holds more than 3 items.

  [image: Payment hold: the blue box at the top of the developer dashboard.]
- **"Done: you stopped <test>."** or **"Done: you ended <N> testers' work on <test>."** (green), after Stop the test or End early from a test page during a hold or suspension.
- **"Your account is active again · <time>"** (on a mixed account, "Your developer account is active again") for 3 days after a reinstatement.
- **Welcome line** with a "Post a test" shortcut next to the name.
- **Stat tiles:** Parts to review, Testers joined (all tests), Spent so far (accepted work), Pays on average, Typical review, Rating. Big numbers shorten. The tester-limit card ("Can take up to N testers per test") is on Profile (Shared pages).
- **Needs review:** one row per test with work or calls waiting, e.g. "Harbor Run · 3 parts to pay", newest first. Each row opens that test's Needs you.
- **Needs you:** applications, rejoin asks, call requests, disputes and excerpt requests (Allow, Deny) from every test, newest first. Each opens its own row on the test page, marked.
- **Calls:** every booked call, soonest first. Join call appears only while the call can be joined. Each row opens the call on the test page, where it can be cancelled.
- **Your tests:** one card per test. Category icon left of the name; tags under the title (who can join, Open until, keys left, invites waiting, applications, unread messages, Mature, NDA); a status label; feedback bars with stats at the bottom right. After Open until the card says "Joining closed · testers working until <latest deadline>". Clicking a card opens the test page.
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
- **Join call** (Calls box): opens the call page.
- **Cancel ▾** (Calls box, only during a hold or suspension; otherwise it's on the test page): a reason box, required when the call is less than 24 hours away. The tester gets "<dev> cancelled the call on <day>." (the reason is in the email and on the call) and the call leaves both sides' upcoming lists.
- **Send your side** (Disputes box, while restricted): once per dispute, up to 2,000 characters, never stopped (Developer test page).
- **Pay what you owe** (in the blue box): opens Payments in a new tab.

### What can stop a press

- Cancel stops once for any change to that call, with the change under the button.
- Which changes stop a press, and the notice text: Why a press stops.
- Always refused, in blue under the button: "The call with <name> was already cancelled."; "The call has started, so it can't be cancelled. Report a no-show instead if someone didn't come."; "The call is less than 24 hours away: say why you're cancelling (the other side sees it)."
- Join call checks the call live and disappears when it's cancelled. A press from a page loaded before a cancellation reads "Your Join call didn't go through: <name> cancelled this call at <time>." under it, and the row leaves the list.

### How it looks in each state

- **Test** (on its card): Draft (a next round, not yet open); Open: "Accepting testers" (green) while at least one spot is free, "Full" (grey) when every spot is taken; Joining closed ("Joining closed · testers working until <date>"); Paused ("Paused: account suspended / payment hold / chargeback hold / paused by the team"); Stopped (a Stopped label); Closed ("Closed after 7 days paused").

  [image: Draft: the next round, not open yet.]

  [image: Closed after 7 days paused.]
- **Account active:** as above.
- **Payment hold, chargeback hold or developer side suspended:** the blue box at the top, with the "Excerpt requests" and "Disputes: add your side" boxes under it; Needs review and Needs you are hidden; each card (not a draft's) opens its test page in the paused view, with only Stop the test, End early and Cancel call (Every page); Calls rows get their own Cancel ▾; names are plain text with no hover card; Post a test leaves the header. Every other developer page except Payments, Settings and the bell list moves them back here.
- **Deleted:** every tab logs out.

### Bell lines that open this page

- "Your tests are running again" and "Your developer account is active again": the top.
- "Pay your calls: …" (several tests): Needs review.
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
3. **What should testers do** (required, up to 20,000, with the counter "N / 20,000"). Counters show on all three.

   [image: Counters on Product, Name of this test and What should testers do.]
4. **Link to the product or build** (must start with https://).
5. **Categories** (at least 1): Game, Productivity, Social, Entertainment, Education, Health & fitness, Finance, Shopping, Business, Developer tools, AI, Other.
6. **Languages** and **devices, platforms or skills** needed.
7. **Mature (18+):** ticking it shows a required "why" box at once. The line under it: no sexual content involving minors, no illegal content, no real-world gore; graphic content must be marked Mature. The Terms of Use say the same.

**Deliverables (parts)**: up to three.

- Written answers (1–20 questions, each required or optional and up to 20,000 characters, with a counter "N / 20,000"; a long question sits in a scroll box about 6 lines tall), a Recording (with think-aloud), Live calls.
- Each part is a card with its tick, a price (calls: "up to $ /h"), a Free tick and a Required tick. Required is only a label: it blocks nothing, and shows on the listing, in testers' terms, on their session page and on the developer's tester rows. Free parts are clearly marked before a tester commits.
- Prices: written and recording $1–$1,000 each, calls $10–$200 an hour, or free. Each field shows its range.
- A price over $200 needs the tick "I confirm this part pays more than $200." when it's set over $200 or raised from $200 or less to over it.

**Who and how long**

- **Spots:** up to the developer's tester limit (10 per test to start, grows with good ratings, at most 50). The limit shows under the field.
- **Open until (last day to join):** required, at least 3 and at most 30 days after today, counted in the developer's own time zone. The hint under it says, live as the date changes: "Each tester gets the same time from when they join: today to this date (14 days)." Each tester's deadline is the day they join plus those days. There's no separate "days after joining" field.
- **Who can join:**
  - Anyone can join: join at once while open with spots; first come, first served.
  - Approved only: testers apply; the developer accepts or declines. A subscriber perk: on the free plan it carries a "Subscribers" tag, and Post is refused: "Approved-only testers need a subscription ($7/month)." with a Payments link (new tab).
  - Invite only: never in Find tests, not even for invited testers; only invited testers join, from their dashboard's invites, the bell or the email.
  - Any test can also invite. An invite plus a waiting application or rejoin ask joins the tester at once.

**Optional**

- **NDA:** its own card, "Keep it confidential? (NDA, optional)", with three points: an NDA stops testers sharing the build or what they saw, and they must accept it before joining; with or without one, the developer can always use the feedback they receive; testers can never show work from a test under an NDA as excerpts on their profile, and without one only with the developer's permission. The text box, up to 1,000 characters ("N / 1,000"): "Leave blank for no NDA. If filled, testers must accept it before joining." Testers accept it on Join, Apply and Ask to rejoin. The preview shows it in a scroll box about 12 lines tall. The NDA template gets a legal review before launch.
- **Access keys:** one per line; each new tester gets a free one.

All numbers are in Rules.

### Buttons

- **Post the test:** checks everything, then opens the test, lists it according to who can join (Find tests for Anyone and Approved only; invites only for Invite only) and goes straight to the new test's page. There is no summary step: the developer reviews the fields they filled in on this page before pressing it.

  [video: Filling in the four panels, pressing Post the test, landing on the new test's page.]

  [image: Anyone can join: the new test shows in testers' Find tests.]

  [image: Invite only: not in Find tests; the invited tester sees the invite on their dashboard.]
  - Elsewhere: unless it's invite only, the test appears in Find tests and in matching testers' "New tests for you" (Tester dashboard, Find tests and the join page), and the developer lands on Developer test page.

### What can stop a press

- **Red, at the field** (when you leave the field, and on Post; the server checks too).

  [video: Each box turns red when you leave it; Post then finds what only the server checks (a link without https://, a key typed twice).]

  [image: Red when you leave the field: required fields empty, a price under $1, spots over the limit.]

  [image: Red when you leave the field: Open until only 2 days ahead (it must be 3 to 30), and fewer keys than spots.]
  - A required field left empty.
  - A price outside its range, or over $200 without the tick.
  - Open until missing, or less than 3 or more than 30 days after today.
  - Spots over the limit.
  - Fewer access keys than spots; a key typed twice ("<key> is typed more than once. Each key goes in once."); a key that's too long.
  - A link not starting with https:// ("The build link must start with https://"); http:// is refused too.
  - A question over its limit ("Keep each question to 20,000 characters.") or an NDA over 1,000 ("Keep the NDA to 1,000 characters."), said in red at the field, not only by the counter.
  - Above the button: "Fix the N mistakes above…".

    [image: Every red at once: empty required fields, a price under $1, 60 spots, Open until 45 days ahead, an NDA over 1,000 characters, a question over its limit and fewer keys than spots, with the list above Post the test.]
- **Blue, under the button:** "Confirm your email first. We sent a link to <email>." with "Resend the link" under the button.
- **Blue, under the button, on the free plan:** with an open test already (Open, Full or Paused; a test whose joining has closed doesn't count), Post is refused: "You already have an open test. Subscribe ($7/month) to run several at once." with a link to Payments (new tab). The form keeps what was typed. The same applies when a draft is posted.

  [image: A second open test on the free plan: Post is refused under the button, and the form keeps what was typed.]
- **Blue, under the button, at 10 open tests** (subscribers): "You have 10 open tests, the most you can have at once. Stop or close one to post another." This covers posting a draft too. The count is checked on the server at the press: if another tab stopped a test meanwhile, the post simply goes through.

  [image: At 10 open tests, Post is refused under the button and the form keeps its text.]
- **Red comes first:** a red field stops Post in the page, so the server's blue notice shows only on the next press, once the red is fixed.

  [image: Open until 40 days ahead on the free plan with a test already open: the red at the field stops Post in the page, so the blue notice can't show yet.]

  [image: With the date fixed, the next press reaches the server and the blue notice appears under Post the test.]
- How presses stop and are refused across the app: Why a press stops.

### How it looks in each state

- **Account active:** the form.
- **Payment hold, chargeback hold or developer side suspended:** the page is closed; opening it moves the developer to the dashboard top, and Post a test leaves the header.
- **A draft** (a Next round not opened yet) isn't a test page: it opens here, filled in with its saved details. Its card, its link, its Edit page and Next round all land here. Post the test opens it for testers. The draft can also be deleted here (confirm pop-up).

  [image: The subscription ended and the developer has an open test: posting the round-2 draft is refused with "You already have an open test. Subscribe ($7/month) to run several at once." and Open Payments.]
- A new test starts Open. Later changes go through Edit test.

## Developer test page

### What it's for and who sees it

The place to run one test: what changed, what needs the developer, who is in it, calls, invites and answers. Only the test's developer sees it. Admins don't get this page: they see the disputed work in their console and their own boxes on the public test page.

From Every page: the live box, stop-once, long lists, pop-ups, number format, the paused and stopped banners, and the blue box when suspended or on hold.

### What's on it (top to bottom; every panel folds)

1. **Overview**: title, status pill, who-can-join badge, category, part and deadline badges, keys-left badge, "terms · spots", and "Open until (last day to join) <date>" on the right (changed only in Edit test); after that date, "Joining closed · testers working until <latest deadline>". Buttons: Edit, Alerts, Next round (or "Go to the next round"), End early, Stop.

   [image: Overview: title, status, badges, terms and spots, Open until, and the Edit, Alerts, Next round, End early and Stop buttons.]
2. **Banners** when they apply: the red banner for a paused or stopped test (title, reason, failed presses, what's still allowed: Every page); "<test> closes in …" when under 3 days are left before joining closes.
3. **Live box**. It also shows quiet lines that never stop a press: "Ana switched to the new terms" with "See their contract" (scrolls to Ana's row with her contract shown; several in a day: "3 testers switched to the new terms"; a Keep shows nothing), and "Ana reported their key doesn't work". A new dispute links to its Needs you row.

   [video: Ana (right, phone) sends her answers and switches to the new terms; the developer's live box updates and See their contract scrolls to her row.]
4. **Access keys** (read only, shown only when the test uses keys; never stops a press):
   - **Keys that don't work** (amber, at the top, only for current working testers whose key is marked as not working): "Ben Okafor's key doesn't work (HR-2222)", or stacked, "2 testers' keys don't work: Ben Okafor (HR-2222), Cam Lee (HR-3333)". Each row has a select tick and a "Works now" tick (unticked at first); above them "Select all (N)", below them one "Dismiss selected" button, disabled until something is ticked and reading "Dismiss 2" when two are. Dismissing hides those rows for this developer; a row with "Works now" ticked also clears the key's broken mark (Buttons, below). A new report on the same key shows it again. The rows leave by themselves when the tester leaves or finishes.
   - "Free (not given to anyone yet)": the free keys as small chips with the count and the open spots ("4 free · 2 open spots: each new tester gets one."). A key typed back from a tester who left or finished says so: "HR-3333 · reused (Ben Okafor)" or "HR-2222 · reported as broken (Ben Okafor)".
   - "Given": each given key with its tester ("KEY-1111 · Ana Silva"); a key reported as not working shows crossed out.
   - Free and Given each sit in their own scroll box about 4 lines tall, and they stack on phones. One line: "If a tester's key doesn't work, delete a free key in Edit and send it to them in a message." ("in Edit" opens Edit's access keys in a new tab). It updates live when keys are added or deleted, when a joining tester is given one, and when a key is reported. Key rules are in Edit test.

   [image: The read-only Access keys notice: free keys as chips with the open spots, and each given key with its tester.]

   [image: Keys that don't work: two rows, each with its tick and Works now; Select all; Dismiss selected.]

   [image: "Dismiss 2": Ben's key is marked as working again, Cam's warning is only hidden.]

   [image: The warning is gone; HR-2222 is no longer crossed out, HR-3333 still is.]

   [image: The notice chips: "HR-1111 · reused (Ana Silva)" and "HR-3333 · reported as broken (Cam Lee)".]
5. **Needs you**, grouped per person, each with a fold for their sent parts: one green Pay for each sent piece and each call that took place; applications (Accept, Decline); rejoin asks (with the time they'd get back); call requests; disputes, with "Add your side (optional, once; the team reads both)"; excerpt requests (Allow, Deny); testers waiting to be rated. A piece's written answers, shown formatted with their attachments and recordings (each downloadable or playable), sit in a scroll box about 16 lines tall when they're longer, with the question labels inside; the Pay box stays under it. A part sent for earlier questions is labelled "Sent for the questions until <date>" and is paid at the price it was sent at.

   [image: Needs you, grouped per person: Pay for sent work, a call to pay for its measured length, a dispute waiting for your side.]

   [image: On an Approved-only test: applications to Accept or Decline, and a rejoin ask with the time they'd get back.]

   [image: A dispute waiting for the developer's side, and a call that took place, measured by the app.]
6. **Testers**:

   [image: Testers: the avatar row with Ana's hover card, and one row per tester with parts sent, pay and their contract.]
   - An avatar row (about 12, then +N). Each hover card shows rating, accepted parts, the profile link and "Chat with <name>".
   - A scroll box of tester rows with a name search: required and optional parts sent, paid per part and in total, the agreed scope (their current contract, switched or kept), Rate, "Pay more" on every paid piece (written answers, recordings and calls, listed or unlisted) until its cap is reached, a "Previous questions and answers" fold with earlier sets (only what was sent, never the tester's drafts), "See their contract" (with their contract changes, renames included), and Take down on an excerpt they show from this test. After a Keep the row says "On their terms from <date>".
   - **The Live call part** shows the total paid for all their calls on the right, like the other parts ("Live call · Not required · paid $45.00"). Under it, a fold "Calls (N)" lists every call that's over, newest first, each with its outcome badge: "Took place · 29 min · paid $14.50", "Took place · 29 min · not paid yet", "Cancelled by Ana · 3:05 PM" with the reason under it, "Nobody joined", "Missed: the site was down", "Missed: the test was paused". Each call that took place has its own Pay or Pay more box under it, with the room for that call. The fold scrolls when long. Calls still waiting for a first payment also link to their Needs you item.
   - The bottom line: "Paid in all: $X · Calls: 1 booked ahead, 1 done" ("done" is a call that took place).
   - "No longer working (N)" below, each row tagged Left, Ended early, Stopped or Removed.

   [image: A tester row's "Calls (4)": took place and paid (with Pay more), cancelled by Ana with their reason, nobody joined, missed because the site was down.]
7. **Contract changes** (folded, after Testers): one entry per Save that changed the terms or the names, newest first. Each entry has its date and time and the fields that changed; before → after for each field, shown as in the offer box (the NDA and steps in scroll boxes, questions as 3 then "+N more", parts and prices as terms lines); who chose what ("Switched: Ana Silva, Ben Okafor · Kept: Cam Lee · Not decided yet: Dee Marsh"; testers who left since are marked "(left)", and each name opens that tester's row); and the Save's effects on others ("2 applications closed · 1 invite re-sent"). Renames are entries too. The entries scroll when there are many and update live. Each tester row's "See their contract" stays that tester's own path.

   [image: Contract changes: one entry per Save, before → after, Switched / Kept / Not decided yet with links to the rows, and each Save's effects.]
8. **Live session**: the rate line; tick testers (each with their terms and "N of 3 booked") or Select all; the request form; waiting requests; then one card per tester with only their calls ahead and in progress, in a scroll box about 3 calls tall, soonest first, and call sets. Calls that are over move to the tester's row (above). The list of tester cards scrolls on its own once it's taller than about 2 screens, with the tick list and the request form staying above it. Calls can be requested with any tester, whether or not a live call is a listed part. Each tester shows "Live call · $X/h" when a call is listed and in their contract, otherwise the label "Not listed"; any part not listed in a tester's contract carries the same label. All of one tester's calls on a test can come to at most $1,000 together (Rules); when less than an hour's worth is left at that tester's rate (or under $200 for calls that aren't listed), a small grey line says so: "$X left of the $1,000 for calls with Ana on this test." It never stops anything.

   [image: Live session: each tester's booked calls in a scroll box about 3 calls tall, soonest first; calls that are over moved to the tester's row.]

   [image: "$100.00 left of the $1,000 for calls with Ana Silva on this test.": small, no stop.]
9. **Invite testers**: three lists, "People you've worked with" (with "In N tests with you", a fold linking those tests), "Suggested" (top 5) and "Find testers" (name search plus device and language ticks); then "Invited" (waiting invites).

   [image: Invite testers: People you've worked with and Suggested, with orange labels for missing needs.]

   [image: Find testers by name: Dee is ticked; the orange label shows the need they miss.]

   [image: Invite anyway: the inline box lists the needs Dee doesn't meet.]
10. **By question:** each written question (answers grouped by the exact question text, each long question in its scroll box) with every tester's answer, its time, a "not required" mark and Paid, Rejected (older work) or Not reviewed yet.

After Edit's Save, the page opens with a green line under the panels: "Saved. Offered the new terms to N working testers." (or, when nobody's terms changed, "Saved. New testers join on the new listing; testers already in keep their contract."), followed by what the Save did to others: "Closed N applications: <names>.", "Invites re-sent on the new listing: <names>." and "Not re-invited: <names>." when they apply.

### Buttons

**Overview**

- **Edit:** opens Edit test.
- **Alerts:** "Tick what should not stop your buttons." Kinds: Joins and applications; Testers leaving; Work sent; Call changes; Payments (going through or failing); Disputes; Decisions by the team; Your saves and presses in another tab; Listing changes. Ignored lines still show, greyed, in the live box. A hold or pause, a closed tester account, a stopped test and final refusals always stop. Under each stop box: "Don't stop me for: <kind>". On a paused or stopped test the menu lists only the kinds that can still happen (Why a press stops), and keeps the developer's ticks.

  [image: Alerts: tick what should not stop your buttons.]
- **Next round:** makes a draft copy titled "(round N)" and goes straight to Post a test, filled in with its details; nothing is public until the developer presses Post the test there; records stay with the original round. Refused after a team stop.

  [image: Next round: the draft “(round 2)” opens in Post a test, filled in; Post the test opens it for testers.]
- **End early** (confirm pop-up "End their work now"): tick testers (or "All (N)") and give one reason they read. The "Why?" box is required, up to 10,000 characters ("N / 10,000"). The End early button stays disabled, greyed with the hint "Say why first", until the box has some text and at least one tester is ticked; the server refuses an empty or too-long reason anyway. Their work ends; calls ahead are cancelled; what they sent still waits for Pay; unsent parts close with no pay; they can be invited back later. Testers read the reason in italics in a scroll box on their session page, and in full in the email; the bell line doesn't carry it. Tester bell: "Your work on <test> was ended early"; calls: "…cancelled because your session was ended."

  [image: End early waits for a reason: the button stays disabled with "Say why first"; the counter reads 0 / 10,000.]

  [image: With a reason and a tester ticked, the button is enabled; the counter shows the length.]
- **Stop** (confirm pop-up "Are you sure you want to stop “<test>”?"): ends every tester's work, cancels every call and request ahead, takes no new testers, and can't be edited or reopened. What was sent still waits for Pay. Testers: "<test> was stopped" and the stopped line on their page. Edit, End early and Stop disappear, and so do Invite testers and the call-request tools; Next round stays (not after a team stop).

  [image: Stop: the confirm pop-up “Are you sure you want to stop …?”.]

  [image: The tester's page after Stop (phone): the stopped line says what they can still do.]

**Needs you and the Pay box**

- **Pay:** there's no Reject: the developer pays an amount from $0 up. Every Pay and Pay more box (Needs you, tester rows, calls) has one green Pay button, the amount, "Note to <tester> (optional)" with its counter "N / 1,000", the ticks, and beside the amount the room left: "up to $15.00 above the listing", "up to $2,000.00 (max)" for an unlisted written part or recording, "up to $X ($200/h × 29 min)" for an unlisted call, or "up to $X (what's left of the $1,000 for calls)" when that limit is the one that binds. An amount above it turns red at the box as they type ("This is more than you can pay above the listing (up to $15).", "…above the max…", "This is more than you can pay for this call (up to $X…)."), and Pay is disabled; the server checks again.
  - The box starts at the listing (or, for a call, the rate × its measured length); for an unlisted part it starts empty.
  - The note becomes required at $0: "Say why you're paying $0 (the tester reads it)." Paying a listed part less than the listing also needs it: "Say why you're paying less than the listing's $X (the tester reads it)." Both are red at the box. The tester reads the note with the payment on their session page and in the email, never in the bell line.
  - The line under the button: listed, "<tester> can dispute the amount once."; unlisted, "This part isn't listed: pay any amount, $0 included. <tester> can dispute the amount once."
  - Paying more than the listing is extra pay, within the per-piece caps (Rules). After a piece is paid, its row keeps the same box as "Pay more" until the cap is reached.
  - Every Pay above $0 needs the tick "I understand this payment of $X can't be refunded and is charged now.", naming the exact amount (a changed amount unticks it); over $200 the tick "I confirm this payment is over $200." is needed too. Paying $0 needs no tick.
  - The stop-once check runs first; then the card is charged at once, and nothing shows success before the result. If the bank wants the developer to confirm, its pop-up opens in the page: confirmed, the payment goes through; cancelled or failed, "Your bank didn't confirm the payment, so nothing was charged." and no hold. While the bank's confirmation is pending the piece is locked, and it's never charged twice.
  - A $0 payment closes the row like any payment. The tester reads "Paid $0: "<reason>"". Any amount can be disputed once, $0 included.
  - Tester bell: "<dev> paid you $X for your <part> on “<test>”" ("<dev> paid you $X more…" for a Pay more); developer: a receipt. "Paid so far" updates on both sides.

  [image: One green Pay; beside the amount the room left ("up to $10.00 above the listing"); the note is optional; "Ana Silva can dispute the amount once."]

  [image: Over the cap, red as you type: "This is more than you can pay above the listing (up to $10.00)." and Pay is disabled.]

  [image: At $0 the note is required, in red at the box: "Say why you're paying $0 (the tester reads it)."]

  [video: An amount over the cap turns red at once; $0 asks for a reason; a valid amount with its tick pays.]
- **An unlisted part** ("Not listed"): the box starts empty. Written answers or a recording can be paid up to $1,000, plus up to $1,000 more as extra pay ($2,000 in all); a call up to $200 an hour for its measured length, with no extra, within the $1,000 for all of that tester's calls on the test. Paying $0 is allowed and closes the row. It gets the same review reminders as listed work until its review date, then they stop; the row stays until it's paid, even $0. It never opens Charge.

  [image: No Reject anywhere: "This part isn't listed: pay any amount, $0 included. Ben Okafor can dispute the amount once."]
- **A declined card** starts a payment hold at once: "Your card was declined, so <name> wasn't paid $X for the <part> yet. Your tests are paused until you pay what you owe: open Payments." The tester sees "payment may be delayed". Holds are in Rules. Any other problem with the payment service is not a decline: "Payments are having a problem right now. Nothing was charged; try again shortly.", with no hold and nothing owed.
- **Accept / Decline an application or rejoin ask:** Accept joins them ("You're in: <test>" or "You're back in <test>: your deadline is <date>."); Decline tells them it wasn't accepted.
- **Add your side** to a dispute: optional (an admin can decide without it), once, up to 2,000 characters with a counter. The box stays until the admin decides, with no time limit, on a stopped, paused or closed test too, and in the dashboard's "Disputes: add your side" box while restricted. Once sent, it becomes the read-only text. "Send your side" never stops; it's refused only with "This dispute was already decided." or "You already added your side." The tester's next dispute press stops once; the admin sees the side appear live ("added <time>"), and their Decide stops once if it arrived after their page loaded (Administrator console).
- **A call that took place:** the app measures its length: "Length: 29 min (both in the call 2:21–2:50 PM)", up to 150% of the booked length; "Call in progress / measuring" until it's final. Nobody enters a length. The call's Pay box has "Rate ($/h)" and the amount, which fill each other live: typing a rate fills the amount (rate × length), typing an amount fills the rate (amount ÷ length × 60, to the cent per hour). The one typed last wins, and the server works out the other and checks the caps. A listed call's rate starts at the contract rate; an unlisted call's starts empty and can't go over $200/h.

  [image: The measured length: "Length: 29 min (both in the call …)"; the Pay box's Rate and Amount use it; "Lower the length" is under it.]

  [image: Rate and Amount fill each other: typing $40/h filled $19.33; typing $10.00 filled the rate back ($20.69/h).]
- **Lower the length** (under the call's Pay box, until it's paid): the developer can only lower the measured length, never raise it, with a reason the tester reads ("Say why you're lowering the length (the tester reads it)."). It then reads "Length: 20 min (lowered from 29 min; both in the call …)" with the reason in italics, and the Pay box uses the new length. The tester can dispute the amount once, as usual.

  [image: Lower the length: only lower, never raise; a reason is required and the tester reads it.]

  [image: Lowered: "Length: 20 min (lowered from 29 min; both in the call …)" with the reason in italics; the Pay box now uses 20 minutes.]
- **Rate** a tester after they rated, within 14 days: 1–5 stars and an optional comment; both ratings then show.

**Testers**

- **Pay more** on every paid piece (current and past testers; written answers, recordings and calls, listed or unlisted): the same Pay box, with its "up to $Y", the same ticks and the optional note, until the piece's cap is reached. The part line already shows what was paid, so the box doesn't repeat it. Each call that took place has its own box in the "Calls (N)" fold. Unpaid pieces are paid in Needs you. Tester bell: "<dev> paid you $X more for your <part> on “<test>”".
- **Chat with <name>** (hover card, row, profile): opens the per-test chat. After a block either way, a suspension or any other refusal: "Unable to chat with this tester."

**Live session**

- **Request a time:** up to 3 time rows, each Once, Daily or Weekly (2–8 calls, or Forever), and one length (10–180 min). The tester gets the request; if they asked for the same time, it books at once ("Booked: you both picked <time>"). A request, an offer or an Accept that would take a tester's calls on this test over $1,000 is refused on both sides: "Calls with Ana on this test can come to at most $1,000; $X is left, so this call can't be booked."

  [image: Refused at the limit: "Calls with Ana Silva on this test can come to at most $1,000; $100.00 is left, so this call can't be booked."]

  [video: The warning under an hour's worth, then a 60-minute request at $150/h refused with what's left.]
- **Accept / Decline / Withdraw** a waiting request. Accepting books it; the other side is told.
- **Booked calls:** timer, who is in the room, Add to calendar, Join call (10 minutes before the start to 30 minutes after the booked end), Cancel ▾ (reason required under 24 hours), "Cancel the remaining calls" for a set.
- **After a call:** **Report a problem** (No-show, Late, a note), once, after the call's start. Admins see reports in their daily email.

**Invite testers**

- Rows must be ticked (typing never invites). Missing needs show as orange labels: 3 named, then "+N more", which opens to show the rest ("fewer" folds it again); testers who can't join (suspended, or in 10 tests) are greyed with "Can't join this test".

  [image: Missing needs on an invite row: 3 named, then "+2 more".]
- Order: a tester **meets** the test with one required device and one required language (where any are required). **Score** = (3 × platform average + their stars) ÷ (3 + their ratings), so new testers start near average. **Invitable** = not in the test, not invited, under 10 tests, not paused; blocked or deleted testers never appear.
  - People you've worked with: invitable first, then your rating of them, tests together, most recent.
  - Suggested: the top 5 invitable testers new to you, filtered by the ticks, by meets, score, accepted parts, matches.
  - Find testers: invitable first, then meets and score.
- **Invite:** the tester gets "<dev> invited you to <test>" and a daily reminder until they answer. A ticked tester who misses a need opens the inline Invite anyway box (Every page). If the tester had applied or asked to rejoin, they join at once.
- **Cancel invite** on the Invited list. "Left this test" or "You ended their work" show beside those names.
- Invites close when the test or the developer can't take testers, and at Open until, and can be sent again when that's restored.

**Access keys**

- **Dismiss selected** in the keys warning: hides the ticked rows for this developer (stored per report, so a new report shows again). For a row with "Works now" ticked it also clears the key's broken mark: the key is no longer crossed out in Given, in Edit's In use or in the tester row, and it can be reused later without the "reported as broken" warning. That tester's key notice changes from "Marked as not working" to "The developer marked your key as working. If it still fails, you can report it again." It's a change to their contract: their next press from an older page stops once for it, even with Alerts Off, and there's no bell. A row without "Works now" is only hidden; the key stays marked broken.

### What can stop a press

- **Stop-once** on every button (Next round, Pay, Pay more, Lower the length, the call buttons, Invite, Rate, and Stop and End early on a running test) for any change the page hasn't shown yet, listed under the button. Every kind of change, its Alerts type and the notice text are in Why a press stops. On a stopped test every press still allowed stops once the same way: Pay, Pay more, Lower the length and Rate. "Send your side" never stops.

  [video: Ben (right, phone) sends his answers while the developer presses Pay for Ana; Pay stops once and lists the change, the second press goes ahead.]

  [image: Pay stops once: Ben sent his answers since the page loaded.]

  [image: Cam left while the Stop pop-up was open: the press didn't go through and the change shows under Stop.]

  [image: Invite stops once: Fay removed iPhone and iPad from her profile after the page loaded.]
- **Invite** also stops for: "<name> removed <X>, which this test needs", "<name> joined this test…", "<name> can't be invited right now", "<name> can't join more tests right now".
- **Always refused** (blue, under the button, naming the press: "Your Pay didn't go through: …"):
  - "This test was stopped."; "The team stopped this test."; "This test was already stopped." (the developer and an admin stopped it at the same moment: the first wins).
  - "<name> already left the test."; "<name>'s work already ended."
  - "<name> already charged $X for this."; "<name> let this go: nothing was charged."; "You already paid $X for this."
  - "<test> is full. Add spots to invite more people."; "Joining closed on <date> (Open until), so nobody can be invited."
  - Call lines: "This time isn't available."; clashes ("You already have a call with <name> at <time>."); "You already have 3 requests waiting with <name>…"; "<name> already has 3 booked times with you…"; the $1,000 limit for a tester's calls.
- **On a paused test** (any cause) only Stop the test, End early and Cancel call work, plus excerpts and the side of a dispute. Stop and End early go through silently; Cancel call keeps its stop-once. Any other press from an older page (an Edit Save, Pay, Invite, Next round…) is refused. For a team pause the developer is taken to the test page's red banner, which lists it: "Your Save on <test> didn't go through: the team paused this test." For a hold or suspension they go to the dashboard top.
- **Subscriber perks:** on the free plan, Invite and Next round stay visible with a small "Subscribers" tag; a press is refused with "Inviting testers needs a subscription ($7/month)." or "Next round needs a subscription ($7/month)." and a Payments link (new tab). Invites already sent stay valid when a subscription ends. A page open at that moment gets "Your subscription ended." as a stop-once change.

### How it looks in each state

- **Draft:** not a test page. Its card, its link and its Edit page open Post a test, filled in with the draft's saved details.
- **Open:** as above.
- **Joining closed** (after Open until): as above, with "Joining closed · testers working until <latest deadline>" in the overview. Invites can't be sent; working testers carry on until their own deadlines.
- **Paused (any cause: the team, a payment or chargeback hold, or a developer-side suspension):** the paused view. It shows the red banner, the overview with only Stop the test and End early, a compact Booked calls list (time, tester, length) with Cancel on each, the test's excerpt requests (Allow, Deny) and Take down for shown excerpts, the disputes with Add your side, and Alerts limited to what can still happen. Hidden live: Needs you, Testers, the Live session tools, Invite, Edit, Next round, chat links and the answers. During a hold or suspension the developer reaches it from the dashboard card; Edit, chat and every other test page still go to the dashboard top. Testers follow the paused-test rules (Rules); on a team pause the chat stays open both ways.

  [video: The team pauses the test while it's open: on the test page the banner appears and only Stop, End early and Cancel stay; on Edit, Save is refused and lands on the test page banner with its line; after Ana leaves, Stop still goes through silently.]

  [image: Save on a team-paused test is refused and routed to the test page: under the team's reason, the banner lists "Your Save on Harbor Run: lighthouse didn't go through."]

  [image: Ana left after the page loaded, yet Stop on the team-paused test went straight through, with no stop box.]
- **Stopped:** the page shows only what still works. Gone: Invite testers, the call-request tools in Live session, Edit, Stop and End early. Left: the Stopped label and the red banner "This test is stopped." with what still works, Next round (it starts a new draft from this test), Needs you (Pay, a call's Pay, a dispute's side), the Testers panel (rows, the "Calls (N)" folds, Rate, Pay more), Contract changes, chat, Alerts (limited) and the answers.

  [image: Stopped: the Stopped label and the stopped line; only what still works: Needs you, the Testers panel and past calls; Next round stays.]
- **Stopped by the team:** the page moves to the top of the overview, where the banner "The team stopped this test." stays, with the reason, and names any press that didn't go through. Then the stopped rules apply, except that Next round isn't offered.

  [video: The team stops the test while a call is being requested; the request is refused and the banner names the press that didn't go through.]
- **Closed after a pause:** like stopped, with the reason in the banner.

### Bell lines that open this page

- A tester joined, rejoined or left → that tester's row.
- An application, rejoin ask, "N applications wait for your answer", or "<tester> asked for a call: …" → Needs you.
- Work sent or updated, "review … within…", "…waited over 7 days…", "Pay your calls" (one test) → that piece or call in Needs you.
- A dispute filed → its Needs you row; a dispute decided, "<tester> finished… You can rate…" and the rate reminder → the tester's row.
- A call line about a call ahead → that call in Live session; about a call that's over (cancelled, nobody joined, paused, outage, skipped) → that call in the tester's "Calls (N)" fold, opened and marked.
- The team paused, stopped or closed the test, lifted the pause, or "will close later" → the overview banner.
- "“<test>” closes to new testers on <date>." and chat lines → the test page.

What testers see of all this is in Tester session page and Tester dashboard, Find tests and the join page; profiles and chat are in Shared pages.

## Edit test

### What it's for and who sees it

The developer changes a test's listing. Edits apply to new testers; working testers get an offer to Switch or Keep. The fields and red checks are the same as on Post a test. Only the test's developer sees it.

From Every page: the live box, stop-once, red field checks, kept drafts, long lists, and the blue box when suspended or on hold.

### What's on it

- "← Back to the test", the title "Edit “<title>”", the Alerts menu (Developer test page), and a note that Edit changes the listing for new testers only.
- The Post form, filled in.
- **Access keys** ("each joining tester gets one") in two boxes:
  - **In use** (read only): keys given to working testers, each with its tester; a key reported as not working is crossed out ("· not working"). Below them, greyed, the keys of testers who left or finished, with "(left)" or "(finished)" after the name, so the developer can see which ones they could reuse. It follows changes live.
  - **Free:** one plain text box holding every free key, one per line. The heading counts live as they type: "Free (3 keys · 3 open spots)". The developer deletes a line to remove that key and types a new line to add one. Red under the box when there are fewer keys than open spots: "Add 1 more key: 3 open spots, 2 free keys." Free keys go to new testers first.
  - The line under the boxes: "Keys in use can't be added. Keys from testers who left or finished can be typed in again; you'll see if one was reported as broken."

  [image: One Free box: every free key one per line ("Free (2 keys · 2 open spots)"); In use lists Ben's key and, greyed, Ana's and Cam's "(left)".]
- **"Changes left: N of 3"** next to the label of each limited field (the steps, NDA, questions, languages, devices, build link, and parts and prices), once anyone is affected (the first join, application or invite).
- **Save**, faded and doing nothing while nothing changed.
- **The live box** sits under Save.

  [image: Edit's live box sits under Save: Ana sent her written answers while Edit was open.]

### Buttons

- **Save** changes the listing for new testers. Elsewhere:
  - **Working testers whose own terms change** (work, parts, prices, Required labels, requirements, NDA) get an offer at the top of their session page, Switch or Keep (Tester session page), and the bell line "<dev> updated the listing: <changes>". A tester whose terms don't change gets no offer. Work already sent keeps its price. A newer Save replaces a waiting offer.
  - **A changed NDA** is always a new offer, never applied silently.
  - **Earlier questions, answers and NDAs** stay in the tester's Terms history.
  - **Waiting applications** close when prices, parts, questions, devices, languages, the description, the build link or the NDA change, or when the test becomes Invite only. The tester is told ("<test>'s listing changed, so your application was closed. You can apply again on the current listing.", stacked across tests as "3 tests you applied to changed: your applications were closed" / "<test> is now invite only, so your application was closed.").
  - **Open invites** are sent again on the new listing ("<dev> updated <test>: your invite was sent again on the new listing.", stacked across tests the same way).
  - **Switching to Anyone can join** lets waiting applicants in ("You're in: <test>") or tells them "<test> changed since you applied".
  - **More spots** tells invited testers "A spot opened on <test>…"; filling the test closes applications and keeps invites open.
  - **Renames** (the product or the test name) are info for everyone and never stop a press. Each one is recorded in every working tester's contract changes, "Renamed: "<old product> · <old test>" → "<new product> · <new test>" · <date, time>", including a rename saved while a tester's press was in flight. It's also an entry in the developer's Contract changes panel.

    [image: A rename in the tester row's contract changes: "Renamed: "Harbor Run · Harbor Run: first 3 levels" → "Harbor Run · Harbor Run: night harbors"".]
  - After Save, the developer lands on the test page with the green line "Saved. Offered the new terms to N working testers." (or "Saved. New testers join on the new listing; testers already in keep their contract."), plus the applications it closed and the invites it re-sent (Developer test page). When a tester later Switches, the top box shows one quiet line, "Ana switched to the new terms" with "See their contract", which opens the test page at that tester's row in a new tab; several in a day stack into "3 testers switched to the new terms". A Keep tells the developer nothing. Neither stops a press, because work already sent keeps its price.
- **3 changes per field, counted once anyone is affected.** The count starts when the first tester joins, the first application arrives or the first invite is sent, whichever comes first, and keeps counting even if that applicant later withdraws. Before that, edits are free and nobody is told. From then on each of these 7 fields has its own 3 changes: what to do (the steps), the NDA, questions, required languages, required devices and technology, the build link, and parts and prices (one counter for the part ticks, prices, Required and Free ticks, the live rate and call length). One Save that changes two of them uses one change of each. Each field shows "Changes left: N of 3" next to its label, and the counts update live when another tab saves. A field at 0 locks on its own, with the note "You've changed the <field> 3 times since testers joined. Contact us in Settings to change it again."; the other fields stay editable. Changing parts or prices still sends working testers the Switch / Keep offer. Access keys aren't limited: a key given to a tester stays theirs, so adding keys never changes anyone's terms. An admin's "Allow 3 more" gives every field at 0 three more changes (Administrator console).

  [image: After 3 saves that changed the steps, the steps field locks with its note; every other limited field shows its own “Changes left: N of 3”.]
- **Dates.**
  - Open until (last day to join) is required and can only move later, before it passes, and never more than 30 days after today: "Open until can only be extended: it's <date> now." Once passed: "Joining closed on <date> (Open until), so it can't be extended." The hint says how many days each tester gets, live.
  - Moving it later by some days gives every tester that many more days: new testers get the longer time, and every working tester's deadline moves the same number of days later.

    [image: Open until can only move later: an earlier date is red.]
  - There's no separate deadline field: each tester's deadline is the day they joined plus the tester days.
- **Access keys.** Save works out the change against the keys this page loaded, not the current ones, so another tab's work is never undone: removed = loaded keys whose line is gone; added = lines that weren't loaded. Keys another tab added are left alone, and so are keys a joining tester was given whose line is still there.
  - **Refused, red under the box, one line each:** a key in use by a working tester ("HR-1111 is in use by Ana Silva, so it can't be added."), broken or not; a key typed twice ("<key> is typed more than once. Each key goes in once."); a deleted line whose key a tester was given since the page loaded ("HR-4444 was given to a tester since you opened this page, so it's in use now and can't be removed."). After a red line, the box shows the current free keys with the developer's other edits still applied (HR-4444 is now under In use), and pressing Save again saves the rest, unless something new happened in between.
  - **Allowed, with a warning:** a key from a tester who left, was removed, or finished goes back to Free when typed in. It shows an amber line with a "Reused" tag: "HR-3333: reused, previously given to Ben Okafor.", or, for a key that tester last marked as not working, "HR-2222: reported as broken by Ben Okafor." It's a warning only: it doesn't count as a mistake, isn't in "Fix the N mistakes" and doesn't block Save. Nothing returns to Free by itself.
  - Every key a refusal calls "in use" is a working tester's and is listed under In use.
  - Testers whose key doesn't work never get a new one automatically: the developer deletes a free key here and sends it to them in a message; the Access keys notice on Developer test page links here. The developer can also mark the key as working there.

  [image: A working tester's key can't be added (red, as you type): "HR-2222 is in use by Ben Okafor, so it can't be added."]

  [image: Typed back with a warning: "HR-1111: reused, previously given to Ana Silva." and "HR-3333: reported as broken by Cam Lee.", with a Reused tag, never a mistake.]

### What can stop a press

- **Changed in another tab or device.** Save stops once. Each field changed elsewhere updates here with a blue note under it, "Changed in another tab or device at <time>", saying what changed (an expand arrow when it's over two lines: keys, questions, instructions). For keys the note names each change: "HR-7777 added in another tab", or, when a key was simply given to a joining tester, "Ana Silva joined and was given HR-4444". Fields not changed there keep what you typed, and the Free box shows the current free keys with your own edits still applied. Under Save: "This test changed since you opened Edit. Press Save again to save your changes on top."

  [video: Two tabs on Edit; the right one saves new instructions and keys, then the left one's Save stops once and its fields update with blue notes.]

  [image: Another tab saved new instructions: the field updates with a blue note under it.]

  [image: Keys added in another tab: the blue note under the key boxes.]

  [image: Save stops once: “Since you opened this page” lists the other tab's saves; press Save again to save on top.]
- **Other changes** (joins, work sent, calls and so on, as set in Alerts) stop Save once, listed under it. Every kind, with its notice text, is in Why a press stops.

  [image: Ana sent written answers and Ben joined while Edit was open: Save stops once with the blue list, and the key boxes and open spots are already up to date (K-2 is now Ben's).]
- **A field can be red and blue at once**, e.g. fewer access keys than open spots after another tab added spots.

  [image: You deleted a key's line; another tab added a spot (blue): now fewer free keys than open spots (red).]

  [image: You deleted one key's line; another tab removed another (blue): the free keys no longer cover the open spots (red).]
- **Always refused:** "This test was stopped." If an admin stops or pauses the test while it's being edited, Save is refused and the developer goes back to the test page, whose banner names the press that didn't go through ("Your Save on <test> didn't go through: the team paused this test.").

  [video: The team stops the test while Edit is open; Save is refused and the test page's banner names the Save that didn't go through.]
- **Subscriber perk:** on the free plan, Approved only under Who can join shows a small "Subscribers" tag, and a Save that switches to it is refused: "Approved-only testers need a subscription ($7/month)." with a Payments link (new tab). A test that is already Approved only stays so when a subscription ends, and its applications can still be accepted or declined.

### How it looks in each state

- **Open:** the form. **Draft:** a draft's Edit page opens Post a test, filled in with its details.
- **Paused by the team:** Save is refused, and the developer is taken to the test page's paused view, whose banner lists "Your Save on <test> didn't go through: the team paused this test."
- **Stopped or closed:** red "This test was stopped." and no form.
- **Payment hold, chargeback hold or developer side suspended:** the page is closed; the developer moves to the dashboard top.

### Bell lines that open this page

None; bell lines about a test open the test page.

New-tester side: what changed shows on the join page and in Find tests (Tester dashboard, Find tests and the join page).

## Tester dashboard

### What it's for and who sees it

The tester's home: what to do next, money waiting, calls, invites and new tests. Only the tester sees it.

From Every page: the live box, long lists (each box shows the newest 3 rows, then "Show N more"), number format, and the blue box when their tester side is suspended.

### What's on it (top to bottom)

- **Payout problem banner**, when a payout failed: "Your bank couldn't receive a payout. Update your payout details." (Shared pages).
- **Stat tiles:** Earned, Waiting for review, Rating, To do.
- **Tests you were removed from** (only after a suspension, see below).
- **Charge or cancel:** tests with parts where Charge is open, e.g. "Harbor Run · 2 parts". Each row opens the part on the session page. When Charge opens is in Rules.
- **To do:** unsent parts with deadlines, each with "Send work", which opens the part; also new terms to Switch or Keep, and the developer's call requests to accept or decline. A test can be in both Charge or cancel and To do.
- **Waiting for the developer:** sent work waiting for review, and applications or rejoin asks waiting.
- **Upcoming calls:** the next 7 days, each with Join call while the call can be joined (the same rule as the session page).

  [image: The tester dashboard's Upcoming calls, with Join while the call can be joined.]
- **Invitations:** Accept (opens the join page) and No thanks.
- **Tests you left:** tests they left or were removed from, before the deadline, not stopped and not rated, with Ask to rejoin.
- **New tests for you.**
- **History:** past tests and how each ended. Each ended test's entry holds the tester's own deal history, in order: the terms they joined on, every offer with what changed and what they chose, renames, their previous question sets, calls that are over (with their outcome badges) and payments. It never shows other testers' choices.
- Paused tests the tester joined, was invited to or applied to show with a "Paused" tag. Their invites and applications wait, and work again after the lift unless something else closed them.
- A test they applied to or visited that became invite only stays here, marked "Closed to new testers (invite only)". An open invite of theirs still works.

### Buttons

- **A row** in any box: opens that part, call, offer or test.
- **Send work:** opens the part on Tester session page.
- **Accept** (invite): opens the join page. **No thanks:** closes the invite; the developer's page shows "<name> said no thanks to your invite".
- **Ask to rejoin:** as on the join page, below.
- **Ask to rejoin** on a "You were removed from this test" row, while the test is open, has a spot and isn't paused; **Dismiss** removes the row.

### What can stop a press

- No thanks stops once if the developer changed the listing ("<dev> changed the listing at <time> and sent you a new invite: …") and is refused if the invite closed ("This invite closed: the test filled up.").
- Join call is refused if the call was cancelled, moved or closed since the page loaded: "Your Join call didn't go through: <name> cancelled this call at <time>." The row then leaves the list.

### How it looks in each state

- **Active:** as above.
- **Tester side suspended:** the blue box at the top says their account (on a mixed account, their tester account) is paused, they were removed from their tests, how to appeal (Contact us in Settings), and that pay for work already accepted still reaches their Stripe account. Every other signed-in page moves them here, session pages and Find tests included, except Payments (with payout setup), Settings and the bell list. Below the box, a read-only list "Tests you were removed from". Names in rows are plain text with no hover card. Invitations and New tests are hidden; To do says "Nothing to do while your account is suspended."
- **After reinstatement:** no automatic re-invite. The tests they were removed from stay at the top, labelled "You were removed from this test", with Ask to rejoin while the test is open, has a spot and isn't paused, until they ask or dismiss. The developer can also invite them again as usual.
- **Deleted:** every tab logs out.

### Bell lines that open this page

- "Your tester account is active again", outage lines → the top.

## Find tests

### What it's for and who sees it

Testers find tests to join. It lists open public tests (Anyone can join, Approved only) until their Open until. Invite-only tests are never listed, not even for testers who were invited (they reach the test from their dashboard's invites, the bell or the email). Paused, full, stopped, closed and deleted tests, and tests whose joining has closed, are not listed either.

From Every page: the live box, long lists.

### What's on it

- A title and intro, category chips, and filters: Device, Part, Sort by, Show.
- **Cards:** product and title, categories, languages and devices needed, spots left, price per part, who can join, the time each tester gets and the last day to join ("14 days per tester · join by Nov 20"), Mature and NDA badges, "You left this test".

  [image: Find tests: "14 days per tester · join by <date>"; the invite-only test isn't listed, not even for invited testers.]
- Each card lists every unmet need in amber (3, then "+N more").
- **Order:** tests needing a device the tester has, then tests open to any device, then the rest; newest first within each.

### Buttons

- **A card:** opens its join page.

### How it looks in each state

- **Active:** as above. A test that fills, pauses, stops or passes its Open until leaves the list; one that frees a spot comes back.
- **Tester side suspended:** the page is closed; it moves to the dashboard top.

## Join page

### What it's for and who sees it

The listing of one test, where a tester joins, applies, accepts an invite or asks to rejoin. Testers see it from Find tests, an invite or a link.

From Every page: the live box, stop-once, Join anyway, kept drafts, email confirmation.

### What's on it (top to bottom)

- "← All tests", the live box, the header card (product, price block, badges).
- An invitation card with No thanks, if invited.
- The steps, in a scroll box about 6 lines tall.
- "How it works", "<dev> wants to know" (the questions, each long one in its scroll box), "Your deal" (parts, prices, Required labels, and "Your deadline: Dec 3 (14 days from joining)": the deadline they'd have if they joined now), "How <dev> reviews" (the developer's stats).

  [image: The join page: "Your deadline: <date> (14 days from joining)"; a long question and long steps in their scroll boxes.]
- A state line when it can't be joined (below).
- **The join box:** the NDA to accept (in a scroll box about 12 lines tall), then one of Join (Anyone can join), Apply (Approved only), Accept invitation (invited) or Ask to rejoin (left or ended before their deadline).
- A tester's hover card on the developer's name has "Chat with <name>" (Shared pages).

### Buttons

- **Join / Accept invitation:** checks requirements, spots (two people never take the last spot), Open until (the last day to join), the NDA, a confirmed email, a free access key and the 10-test limit. Then the tester is in, on the current listing, with their own deadline (the day they join plus the test's tester days), and lands on Tester session page. Accepted invites and approved applications count from the moment they become a tester. The developer's bell: "<name> joined <test>". If that took the last spot, other applicants and invitees are told.
- **Apply:** sends an application; the developer's bell: "<name> applied to join <test>". If the test is now open to anyone, it joins at once. **Withdraw application** takes it back.
- **Ask to rejoin:** only before their deadline, never after a stop or rating. The developer accepts in Needs you; the tester comes back on the current listing with the exact time they had left. An invite plus an ask, in either order, joins at once.
- **Join anyway / Apply anyway / Ask to rejoin anyway:** when the profile lacks a device or language the test needs, an inline box "What this test needs" lists each one ("Your profile doesn't list <X>, which this test needs.") with Join anyway, "Edit my profile" (new tab) and Cancel. It checks again every few seconds ("Just updated") and closes when everything fits: "You now meet this test's needs. Press Join to join."
- **No thanks:** closes the invite.
- **Join on the current listing / Withdraw application:** shown in "This test changed since you applied."
- The 10-test limit applies to Join, Apply, accepting an invite or application, and Ask to rejoin: "You can't join more tests right now."

### What can stop a press

- **Stop-once:** "The listing was edited: <fields>"; an info change (description, devices, languages, link, categories, who can join, product, Mature); an application closed ("<test> is full: your application was closed"); a new invite on the updated listing; your own press in another tab. Spots stop only when the test is now full, Open until only when it passes; a title change is info only. The box ends "Press again to join on the current listing." How stop-once works everywhere: Why a press stops.
- **Needs changed** while Join anyway is open: "<dev> added <X> to the devices this test needs" and "Your press didn't go through. Check what this test needs now, then press again."
- **Always refused** (blue, under the button): "This test was stopped."; "This test closed to new testers on <date>."; "This test isn't taking new testers any more."; "This test is paused, so it isn't taking new testers right now."; "This test is full."; "You've already joined this test."; "You rated this test, so you can't join it again."; "You left this test, so you ask to rejoin and the developer accepts."; "This test takes applications: press Apply to join."; "This test is invite only."; "Accept the NDA to join."; "No access key is free right now, so this test can't take another tester until the developer adds one."; "You blocked <dev>: unblock them in Account → Blocked people to join."; "Confirm your email first. We sent a link to <email>." (with "Resend the link" under the button)

### How it looks in each state

- **Open:** the join box.
- **Joining closed:** "This test closed to new testers on <date>." Waiting applications and open invites closed at Open until.
- **Full:** "This test is full." Invited testers: "<test> is full right now. Your invite stays open; we'll tell you when a spot opens."
- **Paused:** testers who joined, were invited or applied see it with a "Paused" tag and "This test is paused right now."; their invites and applications wait and work again after the lift unless something else closed them. Anyone else sees "This test isn't available right now."
- **Stopped or closed:** red "This test was stopped." or "This test isn't taking new testers any more."
- **Draft:** not found.
- **Blocked by the developer:** "This test isn't taking new testers right now." (the block isn't revealed).
- **The tester's own test:** "This is your own test…"
- **Tester side suspended:** the page is closed; it moves them to the dashboard top.

### Bell lines that open this page

- Invites and invite reminders, "…here's a new invite…", "A spot opened…", "…is full right now. Your invite stays open…" → the invitation card.
- "…your application was closed", "…is now invite only…", "<test> changed since you applied", "Your ask to rejoin … wasn't accepted" → the join box.

The developer's side of joining and invites is on Developer test page.

## Tester session page

### What it's for and who sees it

Everything a tester does inside one test they joined: read their terms, send work, run calls, get paid, charge, dispute, leave or rejoin, and rate. Only that tester sees it.

From Every page: the live box, stop-once, pop-ups, kept drafts, long lists, stopped tests. Testers see "paused" and "delayed", never hold, suspended, failed or chargeback.

### What's on it (top to bottom)

1. **Product and test name**, and at the top right **Alerts: On / Off** with its line (Why a press stops).
2. **Access key box**, if the test has keys: the key, and "This key doesn't work". Once reported: "Marked as not working. The developer was told. They can send you another key in a message." If the developer later marks it as working: "The developer marked your key as working. If it still fails, you can report it again."

   [image: The tester reads "The developer marked your key as working." (their next older-page press stops once for it, even with Alerts Off).]
3. **Live box:** every change except new terms. With Alerts Off, lines that won't stop anything show greyed.
4. **Switch / Keep offer**, when the developer offers new terms: "<dev> updated the listing: <changes>." A changed NDA shows as "Before" and "Offered" in two scroll boxes about 12 lines tall, changed steps as two scroll boxes about 6 lines tall, and changed questions as a list of 3, then "+N more".
5. **State lines:** why presses are refused (e.g. "You left this test."), the paused banner, the reason their work was ended early (in italics, in a scroll box), "<test> closes in …".
6. **Header card:** the developer (hover card with "Chat with <name>"), badges (Stopped when stopped), Chat (unread count), the description (the steps, in a scroll box about 6 lines tall), their own deadline ("Due …", a countdown under 24 hours, "late" after), "Open the product", "<dev> updated the listing since you joined: see it now", the NDA accepted date.
7. **Stopped line**, when stopped (Every page).
8. **Rating box** and **rejoin card** when they apply.
9. **Your agreed scope** and **Terms history**: their own deal history, in order: the terms they joined on; every offer, with what changed and what they chose (Switched, Kept or not decided), with dates; renames ("Renamed: "<old product> · <old test>" → "<new product> · <new test>" · <date, time>"); their previous question sets; and payments. It never shows other testers' choices.

   [image: The tester's own deal history: the terms they joined on, each offer and what they chose, the rename, their earlier questions, and payments, in order.]
10. **Your parts:** each part's Required or Not required, in the contract or not ("Not listed" when not), sent or not, "Paid so far $Y" (with the developer's note in italics, and for a call the rate when one was typed), and status: draft, sent, under review, paid, "Paid $0: "<reason>"", payment delayed, or "Rejected" for older work. Each part repeats its term at the top ("Written answers: $8 · Required"). Charge or Let it go, and Dispute, sit on the part. A part that isn't listed is paid at the developer's choice (up to $2,000 for written answers or a recording; $200 an hour for a call, within the $1,000 for all their calls on the test) and never opens Charge. Any part the developer paid can be disputed once, $0 included. If the developer deleted their account, work still under review carries "Can't be paid: <dev> deleted their account". A paid written part (above $0) of a test with no NDA has "Show an excerpt on your profile".

    [image: "Paid $0: "<reason>"" on the part; it can be disputed once like any amount.]
11. **Live session** (the developer's panel, tester side): their rate ("Live call: $40/h"), or "Not listed" when a live call isn't a listed part or isn't in their contract; requests; calls ahead and in progress ("Call in progress / measuring"). When less than an hour's worth is left of the $1,000 for their calls on this test, a small grey line says "$X left of the $1,000 for your calls on this test."; it never stops anything.

    [image: The tester's wording: "$100.00 left of the $1,000 for your calls on this test."]
12. **Call history (N)**, a fold: every call that's over, newest first, with the same outcome badges as the developer's tester row ("Took place · 29 min · paid $14.50", "Cancelled by <name> · 3:05 PM" with the reason, "Nobody joined", "Missed: the site was down"…). A call that took place shows its measured length, "Length: 29 min (both in the call 2:21–2:50 PM)", or "Length: 20 min (lowered from 29 min; …)" with the developer's reason.

    [image: Call history: the same calls and badges on the tester's session page; their Live session keeps only the calls ahead.]

    [image: The tester reads the measured length, that it was lowered to 20 min, and why.]
13. **The written part** and **the Recording part.** The written form shows the current questions only, each long one in a scroll box about 6 lines tall, with a fold per previous set below it ("Previous questions and answers (until <date>)", newest first, read-only, at most 3). A previous set keeps what the tester had when they switched: "Sent <date>" for answers they sent, "Draft (not sent)" for answers they never sent, or both, "Sent <date>" first and then "Draft (not sent)" with edits made after sending, each a read-only fold. Drafts are the tester's own: the developer only ever sees what was sent. All the answers together can be up to 50,000 characters ("N / 50,000"), with a small toolbar for Bold, Italic and Code block, and up to 5 attachments (25 MB each: images, PDF, plain text, zip) plus recordings. The Recording part takes up to 5 recordings, 500 MB each, uploaded or recorded on the page with Record (the screen, and the microphone if allowed, with a timer and Stop); each shows a preview, its length and size, and Remove (with a confirm).

    [image: The tester's previous set: "Sent <date>" first, then "Draft (not sent)" with the edit they typed after sending.]

    [image: The developer's fold for the same set: only what was sent.]
14. **Can't finish?** with Leave.

### Buttons

- **Alerts: On / Off:** one press, saved for all their tests. Off: only new terms from the developer (and their key marked as working) stop a press (Why a press stops).
- **This key doesn't work:** always goes through, once (a tester can't take a report back; the developer decides). The key shows crossed out in the developer's Access keys notice, tester row and Edit, the developer's notice gets a warning row, and their live box gets one quiet line, "Ana reported their key doesn't work" (no bell). They may send another key in a message, or mark the key as working.
- **Switch / Keep:** Switch moves the tester to the new terms (work already sent keeps its price); Keep stays on the current ones. The developer's live box shows a quiet "<name> switched to the new terms"; a Keep tells them nothing.
- **Send my answers / Send my recording**, then "Send my updated answers / recording": sends the work ("Sent late (deadline was <date>)" after their deadline). Required questions must be answered. A paid part can't be changed ("Your written answers were already paid for, so they can't be changed. Send anything new in the chat."). The Recording part's recordings (up to 5) are sent together as one piece; a 6th add is refused ("You can add at most 5 recordings. Remove one first."), and Send while one is still uploading is refused ("A recording is still uploading. Send once it's done."). An upload that didn't arrive whole is removed: "That upload didn't finish properly. Try again." Until the developer pays, recordings can be removed or added and sent again. Written answers send the current set of questions and replace the sent version until paid. After a switch to changed questions, the whole earlier set is kept as a previous set, answers to unchanged questions (drafts included) stay filled in, and changed or new questions start empty. While the test is paused, Send is hidden and drafts can still be saved. Bells: "Work sent: …" to the tester; "<name> sent / updated …" to the developer, whose Needs you gets the piece.
- **Charge / Let it go** on a contract part left unpaid, once Charge opens at its review date (Rules): written answers, a recording, or a listed call. Charge takes a typed amount up to the listing minus what was paid for that part (a call: its measured or lowered length × the contract rate, within the $1,000 for calls; when that limit cuts it: "Charge $X (the $1,000 limit for calls on this test)"), with the tick "charge <dev> $X now". Let it go is a confirm pop-up ("Let it go? This closes with nothing more paid."). Works after leaving too, and while the test is paused: during the developer's payment or chargeback hold the charge is recorded and paid when the developer pays what they owe ("Charged $X. Payment may be delayed until the test resumes."). Never for a part or call outside the tester's contract. The developer sees "<name> charged $X for their <part>" or "<name> let their <part> go: nothing charged" and can no longer Pay it. A declined charge starts the developer's hold; the tester sees "Payment for your work on <test> may be delayed". If the developer's bank wants them to confirm, the charge waits ("Payment may be delayed") until they confirm within 3 days, or it counts as declined. If the developer deleted their account, Charge still works on parts already open to charging, charged to their saved card.

  [image: Charge opens for a call: "Nora Lane didn't pay your call on <date> in 7 days: charge $12.50 or let it go" (the measured length × the rate).]
- **Dispute** any part the developer paid, once (any amount, $0 included; an unlisted part too; an older rejection too), with a reason (at least a sentence, up to 2,000 characters). The developer's Needs you and bell get it, and admins get "Dispute on <test>: …". Not for a part they settled themselves with Charge or Let it go.
- **Live session:** Request a time (up to 3 rows, Once, Daily or Weekly with 2–8 calls or Forever, one length), Accept, Decline or Withdraw requests, Join call (10 minutes before the start to 30 minutes after the booked end), Add to calendar, Cancel ▾ (reason required under 24 hours), cancel the remaining calls of a set, Report a problem (No-show, Late) after the start. Calls can be requested whether or not a live call is a listed part. A request or Accept that would take their calls on this test over $1,000 is refused ("Calls with <dev> on this test can come to at most $1,000; $X is left, so this call can't be booked."). The developer is told each time.
- **Leave** (confirm pop-up "Are you sure you want to leave “<test>”?", built from the current state when it opens): never stops; it's refused only when it can't happen ("You already left this test."). Sent work is still reviewed and paid; unsent parts close with no pay; calls ahead are cancelled; the page stays, with live updates. The developer: "<name> left <test>". They can ask to rejoin while the test is open.
- **Ask to rejoin** (rejoin card): after leaving or being ended early, before their deadline, never after a stop or rating; the developer accepts and the tester comes back on the current listing with the time they had left (Tester dashboard, Find tests and the join page).
- **Rate and finish** (confirm pop-up while still working; a plain Rate otherwise): 1–5 stars and an optional comment. Open once everything sent is decided or past its review date, every call that took place (listed or not) is paid or past its review date, and no dispute is open. The warning lists unsent contract parts (required ones marked) and that calls ahead are cancelled. Rating ends their part; no rejoin afterwards; Charge, Let it go and Dispute stay. The developer: "<name> finished <test>. You can rate them for 14 days."
- **Chat** opens the per-test chat. It stays open while the test is paused by the team; while the developer is on a hold or suspended, the tester can read it but the message box is replaced by "Messages are paused for now. You can still read this chat." (Shared pages). **Block** and **Report** the developer are on the developer's profile; Block never stops.
- **Show an excerpt on your profile** (on a written part the developer paid for, above $0, on a test with no NDA): pick one answer and trim it to 10–500 characters, shown as a plain quote with formatting stripped; "Don't name the product" is ticked by default. The developer allows or denies it, and the decision comes as a bell line only. At most 3 shown or pending ("You can show at most 3 excerpts. Remove one first."), and one pending request per part. Requests never stop once. If the test now has an NDA, the button is hidden, and a press from an older page is refused with "This test now has an NDA, so its work can't be shown as an excerpt."

### What can stop a press

- **Stop-once** on every button except Leave and Block, for any change the page hasn't shown yet: new terms (the page scrolls up to the offer, and the box ends "Press again to send under your current terms, or switch first."), the key marked as working, a payment for your work, call changes, listing info, payments, your dispute, and your own press in another tab. With Alerts Off, only new terms and the key marked as working stop. Every kind, with its notice text, is in Why a press stops. On a stopped or paused test every press still allowed stops once the same way: Charge, Let it go, Dispute, Rate and Cancel call. "This key doesn't work" never stops.

  [image: Leave never stops: the listing changed after the page loaded, and Leave (after its own confirm) went through on the first press.]
- **Always refused** (blue, under the button, naming the press):
  - "You left this test."; "You rated this test, so your part is finished."; "<dev> stopped the test on <date>. Work you sent is still reviewed."; "This test ended on <date>. Work you sent is still reviewed."; "<dev> ended your session early on <date>."; "Your session on <test> ended." (after a block); "This test closed on <date>."
  - Charge: "<dev> paid $X for this meanwhile."; "You can choose once 7 days have passed since you sent it…"; "This part is already paid in full."; "A payment for this is being confirmed right now."
  - Dispute: "You already disputed this payment. A part can be disputed once."; "You settled this part yourself (Charge or Let it go), so there's no developer decision to dispute."
  - Rate: "Rating opens once the developer has reviewed everything you sent…"; "Rating opens once the team has decided the open dispute."
  - Calls: "This time is no longer free."; "You already have 3 booked times in this test."; the $1,000 limit for calls; the Join refusals ("Your Join call didn't go through: <name> cancelled this call at <time>.", "You can join from <time>.", "This call is over.").
  - Chat, while the developer is restricted: "Messages are paused for now, so this wasn't sent." (the typed text stays).
- The stop and work-ended lines also appear in the live box, and the Switch / Keep box disappears.

### How it looks in each state

- **Open, working:** as above.
- **Paused** (the developer is on a payment or chargeback hold, their developer side is suspended, or the team paused this test): what doesn't work right now is hidden: Send, the call-request tools and Join call (the server still refuses them). A blue banner at the top lists what still works, built from what is actually available, e.g. "This test is paused right now. For now you can save drafts of your parts, charge or let go of work left unreviewed, dispute, rate, leave the test, and cancel booked calls. Sending work and requesting calls come back when it resumes." When their deadline moves with pauses, it adds "Your deadline is paused too: it moves later by however long the pause lasts." Payment for their work may be delayed. When the pause lifts, the deadline moves later by the length of the pause. Chat follows the rule above.
- **Calls during a pause:** calls starting within 3 days are cancelled with no fault ("Your call on <day> was cancelled because the test is paused."); later ones stay booked (Rules).
- **Stopped or closed:** the page shows only what still works. Send and the call-request tools are hidden. It shows the live-box line, the Stopped label and the still-allowed line, their agreed scope, every part with its status (sent, under review, paid with the amount, payment delayed), the work they sent (readable), Call history and Terms history. Charge or Let it go, Dispute, Rate, Leave (if still in) and chat work; other presses from an old page are refused; the offer disappears. A paused test hides what doesn't work too, under its banner (above).
- **The tester left, was ended early or rated:** the page shows the same read-only view as a stopped test, with the matching line (ended early: the developer's reason, in italics); the rejoin card when it applies.

  [image: Ended early: the reason in italics in a scroll box on the tester's page (never in the bell line).]
- **The tester side is suspended:** they were removed from the test, and the page is closed: opening it moves them to the dashboard top. A tester whose developer is suspended or on hold keeps this page, with the paused rules above.

### Bell lines that open this page

- "You're in…", "You're back in…", "<test> is running again", "<test> was stopped", "…ended early", "<test> ended", "Your session on <test> ended.", "Your deadline on “<test>” is <date>…", chat → the top.
- "<dev> updated the listing: …" → the Switch / Keep offer.
- "Work sent…", "<dev> paid you $X…", "<dev> paid $0…", "…paid you $X more…", "…is delayed…", "<dev> paid $X for your <part>", "Your dispute … was decided", "…charge $X or let it go" and its reminders → that part.
- "Rate <dev>…" and its reminders → the rating box.
- A call line about a call ahead → that call in Live session; about a call that's over → that call in Call history, opened and marked.

The developer's side of each press is on Developer test page.

## Shared pages

Pages both sides use. From Every page: notices, the live box, kept drafts, and the closed pages during a hold or suspension.

## Header and side switch

- One account can be a developer, a tester or both. The header switches between the two sides, each with its own menu, dashboard and pages. Messages, Notifications, Payments, Profile and Settings belong to neither.
- A link to the other side's page switches sides and goes there. Each tab shows its side.
- During a hold or suspension the header loses Post a test, Messages and Profile (and Find tests for a suspended tester side). Suspensions are per side: on a mixed account, switching to the restricted side lands on its dashboard top with that side's blue box, and the other side works as normal.

## Public profiles and hover cards

### What's on them

- **Developer profile** (as testers see it): "Posting tests since", Pays on average, Typical review, Rating ("4.6 ★ (12 ratings)"), comments without the rater's name, Open tests.
- **Tester profile** (as developers see it): "Tester since", Accepted parts ("N of M sent · N sessions with accepted work"), Rating, About (bio, devices, languages), up to 3 shown excerpts (plain quotes; the product is named only if the tester unticked "Don't name the product"), "Chat with <name>".
- **Hover cards** on names: the Testers-panel hover card (developer side) and testers' hover cards on a developer's name. Each has "Chat with <name>", and a tester's card also shows their excerpts (up to 3). Excerpts from a test that now has an NDA are hidden from profiles and hover cards, and come back if the NDA is removed.
- **Admins** also see admin-only boxes on profiles (Administrator console).
- **During a hold or suspension** profiles are closed: a tester whose tester side is suspended, or a developer on hold or with their developer side suspended, who opens one moves to their dashboard top.

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
- **Excerpts** (tester): their profile and Settings list their excerpts, pending, shown or denied, each with Remove (which never stops once); one from a test that now has an NDA is marked "Hidden while <test> has an NDA". A suspended tester can still Remove from Settings but can't make new requests. Blocks, holds and suspensions don't affect excerpts.
- Names need at least 1 character. Saving changes what others see at once; a tester's new device or language updates open Join anyway and Invite anyway boxes.
- Closed during a hold or suspension.

## Settings (Account)

- Name and email ("not confirmed yet" with Resend), the Developer / Tester / both switch, links to the profile and Blocked people, change password (signs out other devices), Delete account.
- **Contact us** emails every admin, with the whole message (up to 50,000 characters, "N / 50,000"); admins reply by email. At most 5 messages per account a day; a 6th shows, under Send: "You've sent 5 messages today. We'll reply by email." It stays open for suspended and held accounts, and is how they appeal. Requests about personal data (for example, a copy of it) go through Contact us.
- **Delete account** (confirm pop-up "Delete your account?"): every open tab signs out with "This account no longer exists". What deletion does is in Every page.
- **Deleting as a tester:** the pop-up is a full warning with their real numbers:
  - "Pay already sent to your Stripe account stays there. Your Stripe account is separate from Playtest: you can still sign in to Stripe and withdraw it."
  - "$X is waiting for your payout setup. Finish it before deleting, or it can't reach you." with a "Set up payouts" link (only when some is waiting).
  - Delayed payments still reach their Stripe account when the developer pays, if payout setup is finished.
  - "Work you already sent can still be paid by the developer, to your Stripe account if it's set up. After deleting, you can't charge for it or dispute it."
  - "You leave every test you're in. Calls ahead are cancelled, and your invites and applications are cancelled. Open disputes are withdrawn."
  - "Your chats close. The ratings you gave and got stay."
  - "You can't sign in again, and this can't be undone."
- **Deleting as a developer** always works. The warning lists, with counts, work waiting for review, parts testers can still charge, and open disputes, then: "Testers can still charge for parts already open to charging. Work you haven't reviewed can't be charged after you delete." What they owe stays owed. For a subscriber it adds "Your subscription ends now, with no refund for the rest of the month."
- **Signed-in devices:** "Sign out of all devices" signs this account out everywhere, this device included, and every open tab goes to the sign-in page.
- During a hold or suspension Settings stays open with Contact us, the email setting, Sign out of all devices and Delete account; the profile editor and profile links are hidden.

## Notifications

- "How you're notified": email Off, or On with Daily, Weekly or Monthly ("Your alert settings are saved.").
- The bell list: newest first, stacked entries open to show their lines, each line opens its exact spot.
- The bell list stays open during a hold or suspension; a line whose page is closed opens the dashboard top.

## Messages and chat

- One chat per tester per test, only between the developer and testers who are or were in the test. Unread counts show on the Chat buttons.
- Chat is closed only while a person is restricted (their developer side or tester side suspended, or a developer on a payment or chargeback hold), never because a test is paused. For the restricted person, Messages and chat move them to the dashboard top; a Send from a page loaded earlier is refused the same way, and the typed text is kept.
- The other person can still open the chat and read everything. The message box is replaced by a neutral note, "Messages are paused for now. You can still read this chat." A Send from a page loaded before then shows "Messages are paused for now, so this wasn't sent." under Send, keeps the text and hides the box. When the restriction lifts, the box comes back live. This covers every chat where the restricted person is on the restricted side.

  [image: The team paused the test: the chat stays open for both.]
- After a block, or when an account is deleted: "This chat is closed."
- Each message reaches the other side's bell as "<name> sent you a message on “<test>”"; the message itself is in the chat and the email, never in the bell.
- A message sent twice by accident (the answer was lost and Send was pressed again) posts once; the same words sent again on purpose post again. At most 30 messages a minute per person ("You're sending messages very fast. Wait a minute, then send again.").

## Payments

### What's on it

- **Developer:** "Your card" (add or change it in Stripe) and "What you've paid" (receipts and history, paid so far per part). Pay is not here: it's in each test's Needs you, linked from the dashboard's Needs review. A payment the payment service never answered shows as being checked until it's finished or cleared (Every page).
  - **During a payment hold only:** "Pay what you owe" with the exact amount. It pays exactly what it shows. More declines during the hold add to it, and so do testers' charges and disputes decided for them during the hold. It updates live (about every 20 seconds) and disappears when nothing is owed. A chargeback's line reads "Your bank reversed a $X payment: $X + $15 chargeback fee". Automatic retries show "Last try: <date> · next try: <date>", or "No more automatic tries: press Pay what you owe".
  - **During a chargeback hold:** the three steps, each ✓ or ✗: verify a card with 3D Secure, pay what is owed, the team's Approve. "Verify a card" starts the check.
  - **Waiting for your confirmation:** payments the bank wants confirmed (made while the developer wasn't there), each with Confirm, by the date in the bell line; after 3 days one counts as declined.
  - **Refunds:** a chargeback the platform won gives a receipt line, "Refund: your bank's chargeback of $X was reversed".
- **Subscription · $7/month** (developers; the plans are in Rules):
  - Not subscribed: the perks list and "Subscribe for $7/month", which needs a saved card.
  - Subscribed: active since, renews on, and "Cancel subscription".
  - Cancelled: "You can use the perks until <date>; you won't be charged again." with "Keep my subscription".
  - Free during launch: "Free during launch until <date>: everything is included. Subscribe to keep the extras after that." With no date set: "Free during launch".
  - Each subscription charge gets a receipt line. During a hold or suspension billing pauses; Cancel and Keep my subscription still work, and Subscribe is refused: "You can subscribe once your account is active again."
- **Tester:** "Everything you sent" with statuses ("Payment may be delayed" when it is), "Where your money goes" (payout setup with Stripe; it needs a confirmed email: "Confirm your email first: payouts go only to a confirmed account. We sent you a link."), "Your earnings" (" · yours once your account is active again" while suspended).
  - When a payout fails: "Your bank couldn't receive a payout. Update your payout details." with a button to Stripe; the money stays in their Stripe balance.
- Payments stays open during holds and suspensions. Change card works during a payment hold, a chargeback hold and a suspension, and a tester whose tester side is suspended can still set up payouts.

### Buttons and what can stop them

- **Pay what you owe:** pays every owed charge. It stops once for every change (another decline, a chargeback, a tester's Charge, a reversed chargeback, a payment in another tab): "What you owe changed: now $X. Press again to pay $X." When nothing is owed, the server refuses it, so another tab's payment is never charged twice. If the bank wants to confirm, its pop-up opens in the page; cancelled or failed: "Your bank didn't confirm the payment, so nothing was charged." (no hold). When everything is paid the hold lifts at once ("Your tests are running again"; testers: "<test> is running again"; while a suspension continues: "Your payment went through. Your tests stay paused while your account is suspended."), and payments that were waiting are charged; testers are paid the charges that were added for them. From the 4th hold on, admins must Approve first ("Hold lift waiting…"). Holds are in Rules.
- **Verify a card:** the 3D Secure check for a chargeback hold.

### Bell lines that open this page

- Hold lines ("Your tests are paused…", "Another payment was declined…", "Your bank reversed…") → Pay what you owe or the chargeback steps; "The team approved lifting your hold", receipts with no test → the top; the payout problem → the payout section.

## Call page

- "Call with Ana", then "“<test>” · <time> · booked for 60 minutes (paid up to 90) · the length is measured while you're both here.", the room (or a link), the timer and who is here, "Both joined at …", and "Trouble with the video?…".
- While the page is open, it tells the app every ~10 seconds that this person is there. A gap under 5 minutes (a reload, a brief drop) counts as still there. The length is the minutes both were there at the same time, in whole minutes, up to 150% of the booked length. It's final when both have left, or 30 minutes after the latest allowed end. With no overlap at all, the "nobody joined" rule cancels the call.
- Join call works from 10 minutes before the start to 30 minutes after the booked end. Refusals: "This call was cancelled.", "This test is paused.", "This test was stopped.", "You left this test.", "They left the test.", "You can join from <time>.", "This call is over."
- Nobody enters a length. The developer pays afterwards on Developer test page, and can only lower the length, with a reason.

  [video: The developer (left) and Ana (right, phone) in the call page: "the length is measured while you're both here".]

## Waitlist (public)

- Before signing up, anyone can leave an email on the waitlist ("Enter an email address like you@email.com." when it's not valid). At most 5 sign-ups from one network an hour ("Too many sign-ups from here. Try again in an hour."). Admins see the list at the bottom of the console.

## Administrator console

### What it's for and who sees it

Admins see every account (deleted ones too), act on suspensions, tests, holds and disputes, and every action is recorded with the admin who did it. Admin views name that admin by email ("stopped by ana@…"), or "an admin (deleted)" once that account is gone. Only admins see it; developers and testers see nothing of it, and always read "the team".

From Every page: the bell (admin lines and the "Reported more than 3 times" label) and the admin daily email.

### What's on it (top to bottom)

- **Settings to fix** (red, at the very top, only when there's something to fix): every problem with the live site's settings, each with a plain fix, e.g. "Emails aren't being sent: RESEND_API_KEY is missing." Only the owner sees it (every admin, if no owner is named, so it's never hidden). It never shows on public pages.
- Stat tiles, then "Opened from a link" (the row a bell line or email pointed to).
- **Outages:** while the uptime service says the site is down, "The uptime service says the site has been down since <time>. The outage is recorded when it says the site is up again (if it lasted 15 minutes or more)."; then each recorded outage with its length. One over 24 hours moves nothing until an admin presses "Approve: move every timer".
- **Open disputes**, newest first. Each row (open or decided) has a fold, "See the work", showing the disputed piece exactly as the developer's piece view shows it: written answers under the questions they answered (with "Sent for the questions until <date>" when relevant) in the scroll box, attachments to download, recordings that play, and for a call its time, length and rate. When the developer adds their side, the row updates live: "Developer's side", marked "added <time>".

  [image: See the work: the dispute row opens the piece as the developer sees it, the answers under their questions in the scroll box (a 10,000-character answer here).]
- **Lifts:** from a developer's 4th payment hold on, each hold appears here once they have paid: the developer, "More than 3 holds", what was owed, when it was paid, a note box and Approve.
- **Chargeback holds:** card ✓/✗, owed ✓/✗, and Approve.
- **Your actions:** tests this admin paused or stopped, and accounts they suspended (per side) or deleted, newest first.
- **Paused tests:** each with its closing date, Extend and Close now.
- **Needs the team today**, **Payment holds** ("More than 3 holds" where it applies; no Approve here), **Decided disputes**.
- **Reports:** who reported whom, the date, the reason, links to both profiles, and the label. **No-show reports** from calls.
- **Payouts waiting** and **Latest payments**; **Held tester shares** (Release, Refund).
- **Accounts** (Suspend, Reinstate per side, Delete; each row says which side is suspended, "Suspended (developer side)", and shows the subscription state: free plan, subscribed, cancelled until <date>, lapsed, or paused for a hold or suspension) and **Tests** (Pause, Lift the pause, Stop, Allow 3 more; each row names the admin, "stopped by <email>", "paused by <email>"); **Contact us** (each message, up to 50,000 characters, in a scroll box about 8 lines tall, with "Mark replied" and then who replied and when); **Waitlist**.

  [image: The tests list names the admin by email ("stopped by <email>"); developers and testers still read "the team".]

  [image: A 50,000-character Contact us message in a scroll box about 8 lines tall, with Mark replied.]
- Every list shows pages of 25 with Previous / Next and "1–25 of N"; only that list reloads. Rows link to the profile or test page they are about.
- **On profiles,** admins see extra boxes (newest first, pages of 25): payments, payouts, disputes, chargebacks, holds and suspensions (with the acting admin), tests posted or joined, and reports against them. Testers' profiles also list their sent parts with totals. A totals line shows money spent or paid out and counts of reports, disputes, chargebacks, holds and suspensions.
- **On a test's public page,** admins see a timeline, contract changes and payments. Admins don't get the developer's test page: the dispute fold is their view of the work, and the file links for attachments and recordings open for admins.

### Buttons

Admin buttons have no confirm pop-up; each shows "Done." or the refusal.

- **Decide a dispute:** the row shows the listing, paid for this piece, paid for this part so far, and the allowed range (from what was paid up to the listing minus what was paid on other pieces). Enter the total pay; blank keeps it. Any part the developer paid can be disputed ($0 included), unlisted ones too: for an unlisted part the range runs up to its cap ($1,000 for a written or recording piece, $200 an hour × the call's measured length for a call) minus what was already paid. A call's decision is also capped by what's left of the $1,000 for that tester's calls on the test. The developer's side is optional: an admin can decide without it. If the side arrived after the admin's page loaded, Decide stops once: "<dev> added their side at 3:12 PM: read it, then press Decide again."; the second press goes through. The decision and note (up to 1,000 characters) are recorded; both sides are told ("…was decided"); a raise is charged at once; during a payment or chargeback hold it is added to what the developer owes and paid to the tester when they pay; during a suspension with no hold it is charged at once, and a decline starts a payment hold.
- **Suspend** (a reason is required, up to 1,000 characters; Preview shows the effects first). It suspends one side of an account. An account with both roles gets a choice, "Developer side" or "Tester side"; a one-role account just shows Suspend. To suspend both, the admin suspends each side.
  - the developer side: all their tests pause; invites and applications wait; calls within 3 days are cancelled with no fault; billing pauses; payments don't lift it; they get "Your developer account is paused". Their tester side works as normal.
  - the tester side: removed from every test (developers get "<name> left <test>"); pay for their sent work is still charged and their share is held; they get "Your tester account is paused". Their developer side works as normal.
- **Reinstate**, per suspended side: "Your developer account is active again" or "Your tester account is active again". A developer's tests resume, deadlines move on by the pause, and testers get "<test> is running again". A tester isn't re-invited: the tests they were removed from wait on their dashboard with Ask to rejoin, and the developer can invite them again. Their held shares are released.
- **Delete** an account, with a reason (see Every page).
- **Pause a test** (a reason is required, up to 1,000 characters): the developer's test page shows the paused view, where only Stop the test, End early and Cancel call work (Developer test page); it closes after 7 days. Testers follow the same paused-test rules as during a developer's hold (Rules), and chat stays open. The developer gets "The team paused “<test>”" (the reason is on the banner and in the email). **Lift the pause:** "The team lifted the pause on <test>"; testers' deadlines and the test's Open until move later by the length of the pause.
- **Stop a test:** for good; testers get "<test> was stopped", the developer "The team stopped “<test>”". The admin's Stop and the developer's Stop can't both run: the second is refused with "This test was already stopped."
- **Extend** a paused test's closing date (1–90 days, this pause only): "<test> will close later". **Close now:** testers read "<test> ended"; the developer gets "<test> was closed. <reason>".
- **Approve** a lift or a chargeback hold. A chargeback Approve is refused until the card is verified and what's owed is paid ("Not yet: the card isn't verified and $X is still owed."). The developer gets "The team approved lifting your hold", or "Your tests are running again" if that lifts it.
- **Release / Refund** a held tester share; **Send** a waiting payout.
- **Allow 3 more** for a test: every limited field at 0 gets 3 more changes (Edit test).
- **Free during launch** (Settings, read only): "Free during launch: free for everyone until <date>" (or "…ended on <date>", or "free for everyone, no end date"), with "Set by FREE_UNTIL in the server configuration (at least 30 days ahead). Every developer is told 30 days and 7 days before (even with email Off)." Admins can't change it in the console.

### What can stop a press

- Any admin can act on anything; the first decision wins. A second admin's press is refused, naming the first admin: "ben@… already decided this dispute at 3:10 PM.", "This lift was already approved by …", "That account's developer side is already suspended (by ana@…).", "That account's tester side was already reinstated (by ana@…).", "That test was already stopped."
- Other refusals: "Record why (it is kept with the suspension).", "You can't pause your own account.", "Use Settings to delete your own account.", "A decision can only raise pay…".

### The "Reported more than 3 times" label

- Counts profile reports plus call no-show and late reports. It shows on names in dispute, report and lift rows and in the admin bell lines about them. Never the number: the exact count is only in the totals line on the profile. A report count is never proof by itself.

### Admin accounts

- Proper sign-in. An email in the admin list gets admin access only once that account's email is confirmed, so registering an admin's address first gives nothing.
- An admin with either side suspended loses admin access: they sign in like any suspended account, and the console and every admin action refuse them with "Your account is paused."
- Contact us messages arrive by email to every admin, who reply by email.

### Bell lines and emails that open this page

- New dispute → that dispute; new report → Reports; "Hold lift waiting…" → that Lifts row; "N suspended account sides to review" → Accounts.
- The chargeback email → Chargeback holds; the daily email's items → their rows.

Holds, chargebacks and suspensions in full: Rules. What the developer sees: Developer test page.

## Rules

The rules several pages share, with every number, cap and timer. How pages show them is in each page tab and in Every page.

### Test lifecycle and timers

- **States:** Draft (a next round not opened yet; it opens in Post a test, not as a test page), Open, Joining closed (Open until passed; testers who joined keep working), Paused (an admin pause, or the developer's payment or chargeback hold or developer-side suspension; nothing new can start; records kept), Stopped, Closed (after a long pause).
- **Open until** is required: the last day to join, at least 3 and at most 30 days after today on Post and Edit, counted in the developer's own time zone. It can only move later, only before it passes, and within 30 days of today; a pause lifting can still push it later than that. After it, the test is closed to everyone who hasn't joined: it leaves Find tests, the join page says "This test closed to new testers on <date>.", and waiting applications and open invites close (as when it fills up).
- **Every tester gets the same number of days.** The tester days run from when the test opened (posted, or a Next round opened) to Open until, in whole days. Each tester's deadline is the day they join plus those days; accepted invites and approved applications count from the moment they become a tester.
  - Example: a test posted Nov 6 with Open until Nov 20 gives 14 days per tester. A tester joining Nov 6 is due Nov 20; one joining Nov 19 is due Dec 3.
  - When Edit moves Open until later by some days, the tester days grow by the same number, and every working tester's deadline moves that many days later. Pause and outage shifts work as before.
  - Tests posted before this rule keep the deadlines their testers already have; their tester days (Open until minus when they opened) apply to new joins only.
  - A deadline is a guide: late work is accepted and labelled "Sent late (deadline was <date>)".
- **After Open until** the test is done when the last working tester's deadline passes, or when everyone has finished. Stop and End early work as usual. Once joining has closed, it no longer counts toward the open tests (DEFAULT).
- **The review date** of a piece of sent work is the later of that tester's own deadline and 7 days after sending; for a call, the later of the tester's deadline and 7 days after the call. So the developer always has at least a week (DEFAULT: the tester's own deadline replaced the shared Open until here).
- **Review reminders** count down to the review date, the same for listed and unlisted parts and listed calls: 1 month before (only if the review date was more than a month away when the work was sent), then 3 weeks, 2 weeks and 1 week before, 3 days before and 1 day before. Only marks still ahead when the work is sent are used, and a mark within 24 hours of sending is skipped, because the "<tester> sent work" line that day counts as the first.
  - Example: a review date 25 days away gives 3 weeks, 2 weeks, 1 week, 3 days and 1 day. A review date a week after sending gives the sent line, then 3 days, then 1 day.
  - After the review date a listed part (or listed call) opens Charge, and the developer is reminded daily until it's paid, charged or let go. An unlisted part doesn't open Charge: its reminders stop, and its Needs you row (Pay only) stays until it's paid, even at $0.
  - Calls that aren't listed never get these reminders. Instead the developer gets one weekly line, stacked across tests, "Pay your calls: 3 calls to pay on 2 tests.", until each is paid ($0 counts). They stay on the test until paid, with no end date and no Charge.
- **Charge opens** on unpaid contract work (written answers, a recording, a listed call) at its review date. A stopped or closed test still waits for it. Rating, the "Charge or cancel" box and the refusals all use this same point. Nothing is charged automatically. After a developer deletes their account, work still under review never opens Charge.
- **Paused tests close after 7 days**, whatever the cause, unless an admin presses Extend or Close now. A paused test has one closing clock: 7 days from when it was first paused. A second cause starting doesn't restart or extend it, and neither does one cause lifting while another remains. The card shows every reason, e.g. "Paused: payment hold · paused by the team", and the daily paused reminder uses that one date. Closing works like a Stop: testers read "ended" with no reason, and the developer gets the explanation by bell and a banner. Drafts never close.
- **Any pause is treated the same** on the developer's test page, whatever its cause (the team, a payment or chargeback hold, a developer-side suspension): only Stop the test, End early and Cancel call work, plus excerpts and the side of a dispute; Stop and End early go through silently; Cancel call keeps its stop-once (Every page).
- **Pausing and resuming** moves every deadline and timer on by the length of the pause. When any pause lifts (a hold is paid off, an account is reinstated, or the team lifts its pause), every working tester's deadline and the test's Open until move later by that length.
- **Outages:** with outage checks on, an outage reported by the uptime service's alerts that lasted 15 minutes or more moves every running timer later and cancels calls inside it with no fault. Over 24 hours, it waits for an admin's Approve.

### Money

- **Pay:** one box per piece, with one green Pay button and no Reject. The developer pays any amount from $0 up. It starts at the listing (or, for a call, the rate × its measured length); for an unlisted part it starts empty. After a piece is paid, its row keeps the same box as "Pay more" until the cap is reached. Every Pay box has a note, "Note to <tester> (optional)", up to 1,000 characters. It becomes required at $0 ("Say why you're paying $0 (the tester reads it).") and when a listed part is paid less than the listing ("Say why you're paying less than the listing's $X (the tester reads it)."). The tester reads the note with the payment on their session page and in the email, never in the bell line. Beside the amount, the room left ("up to $15.00 above the listing" / "up to $2,000.00 (max)" / the call's own cap / what's left of the $1,000 for calls); an amount above it is refused in red at the box, live and again on the server. The card is charged at once and nothing shows success before the result. The split is 80% to the tester, 20% to the platform.
- **A $0 payment** closes the row like any payment, listed or unlisted. The tester reads "Paid $0: "<reason>"" and can dispute it once. For a listed part, a $0 payment is a review, so Charge and Let it go don't open for it.
- **Old rejections:** Reject no longer exists. Work rejected before it was removed still shows "Rejected" with its reason and can still be disputed once.
- **When Pay works:** until the tester presses Charge or Let it go, including after Open until, after a Stop, after a pause closure, and after the tester deleted their account (Pay reaches their Stripe account if their payout account was connected; if not, those rows leave Needs you with "<name> deleted their account before setting up payouts, so this can't be paid.", a DEFAULT). Never during a hold or a developer-side suspension.
- **Over $200:** setting a part price over $200 needs "I confirm this part pays more than $200." Every Pay and Pay more above $0 needs the tick "I understand this payment of $X can't be refunded and is charged now.", naming the exact amount (a changed amount unticks it); over $200 the tick "I confirm this payment is over $200." is needed too. Paying $0 needs no tick. There is no 3D Secure check on Pay.
- **Any declined payment starts a payment hold at once:** a part Pay, the tester's Charge, a call charge or extra pay. Only a real card decline counts: any other problem with the payment service fails the press with "Payments are having a problem right now. Nothing was charged; try again shortly.", with no hold and nothing owed. There are no grace days, but what is owed is retried during the hold (below). A bank asking to confirm a payment isn't a decline (below). A declined subscription renewal is the one exception: it lapses with no hold (Plans and the subscription, below). More declines during the hold add to "Pay what you owe". Paying it all lifts the hold at once (from the 4th hold on, after an admin's Approve).
- **A payment that never answered** (the payment service didn't reply) is never a decline. After 15 minutes it's checked, by the daily job and whenever the developer's test page, Payments or the tester's session page loads: if it went through, it's finished as normal; if the bank is still confirming, it's left for the bank's timers; if it failed or can't be found, the payment is cleared and the piece is back in Needs you, with no bell. A new press on that piece within 24 hours reuses the same one-time key, so it's never charged twice.
- **Chargebacks:** a chargeback starts a chargeback hold with three steps: verify a card with 3D Secure, pay what is owed, then an admin's Approve. Paying alone never lifts it. A chargeback during a payment hold turns it into a chargeback hold. Every further chargeback adds to what is owed; a new chargeback clears an earlier card check. Each chargeback also adds a $15 chargeback fee ("Your bank reversed a $X payment: $X + $15 chargeback fee"). When the platform wins a chargeback, its amount and fee come off what is owed, or are refunded to the card if already paid (receipt: "Refund: your bank's chargeback of $X was reversed"); if that was all that was owed, the hold lifts as usual (from the 4th hold on, after Approve).
- **Hold count:** the first 3 holds lift as soon as the developer pays. From the 4th hold on, an admin must Approve the lift (Lifts on Administrator console); the developer's box says the team will review after they pay.
- **Charge cap:** the listing minus what was already paid for that part. For a listed call: its measured (or lowered) length × the contract rate, minus what was paid, within the $1,000 for that tester's calls ("Charge $X (the $1,000 limit for calls on this test)" when the limit cuts it).
- **Charge during a pause:** during a payment or chargeback hold, a tester's Charge (and a dispute decided for the tester) goes through as their choice but isn't charged yet: it is added to the developer's "Pay what you owe", and the tester is paid when the developer pays. The tester sees "Charged $X. Payment may be delayed until the test resumes." During a developer-side suspension with no hold, a Charge, or a dispute decided for the tester, is charged at once; if it's declined, a payment hold starts and the amount is added to what is owed.
- **Dispute range:** from what this piece was paid up to the listing minus what was paid on other pieces (for an unlisted part, up to its cap minus what was already paid; for a call, also within what's left of the $1,000 for that tester's calls). An admin decision can only raise pay. Any part the developer paid can be disputed, $0 included, unlisted parts too, and older rejections; a part the tester settled with Charge or Let it go can't. Each part can be disputed once; the developer adds their side once, if they want (it's optional).
- **Extra pay cap:** counted per piece, across its Pay and every Pay more on it. Extra pay is everything paid above the base: the listing for a listed part, or the max for an unlisted one. The max is $1,000 for written answers or a recording, and $200 an hour × the measured length for a call. Unlisted written answers or a recording: the base Pay is at most $1,000, and extra pay can add up to $1,000 more ($2,000 in all). Unlisted call: at most $200 an hour for its measured length, with no extra. Listed part: extra pay can add up to 100% of the listing, but never more than the max (a $20 written listing allows $20 extra; a $50/h listed call allows $50/h × minutes extra, per call). Blocked: "This is more than you can pay above the listing (up to $Y).", or "…above the max…" for an unlisted part.
- **One $1,000 for all of a tester's calls on a test**, listed and unlisted together, with extra pay counted. Used = everything paid for that tester's calls on the test (Pay, Pay more, dispute decisions, Charge), plus each booked call not yet paid at its reference (rate × booked length; for calls that aren't listed, $200/h × booked length).
  - Booking: a request, an offer or an Accept that would take Used over $1,000 is refused on both sides: "Calls with Ana on this test can come to at most $1,000; $X is left, so this call can't be booked." Waiting requests over the limit can't be accepted.
  - Paying: every call's Pay and Pay more "up to" is also limited by what's left, and so are Charge and dispute decisions.
  - A small grey line, never a stop, shows wherever calls are requested, offered, accepted or paid, once what's left is under one hour at that tester's listed rate (or under $200 for calls that aren't listed): "$X left of the $1,000 for calls with Ana on this test." (developer) / "$X left of the $1,000 for your calls on this test." (tester).
- **Calls that aren't a listed part:** either side can request a call even when a live call isn't a listed part of the test or isn't in that tester's contract. A call or any other part that isn't listed in the tester's contract carries the label "Not listed" on both sides. Pay for such a call is up to the developer: at most $200 an hour for its measured length, with no extra, within the $1,000 for that tester's calls. The Pay box and its rate start empty. Charge and Let it go never open for a call outside the tester's contract.
- **A call's length is measured** by the app: the minutes both people had the call page open at the same time, in whole minutes, up to 150% of the booked length (gaps under 5 minutes count as still there). It's final when both have left, or 30 minutes after the latest allowed end. Nobody types a length. The developer can only lower it, with a reason the tester reads ("Lower the length"); never raise it. Calls logged before measuring keep their logged minutes. With no overlap at all, the call is cancelled as "nobody joined".
- **Paying for a call:** the call's Pay box has "Rate ($/h)" and the amount, which fill each other: a rate fills the amount (rate × length, to the cent), an amount fills the rate (amount ÷ length × 60, to the cent per hour). The one typed last wins, and the server works out the other and checks the caps (per hour and in total). A listed call's rate starts at the contract rate; an unlisted call's starts empty and can't go over $200/h. A listed call is paid and charged at the measured (or lowered) length × the contract rate. The tester sees the amount and, when one was typed, the rate.
- **Unlisted parts in Needs you** have Pay only, any amount, $0 included. Paying $0 closes the row; the tester reads "Paid $0: "<reason>"". Charge or Let it go never opens for them. They get the same review reminders as listed work until the review date, then no more; the row stays until it's paid, even $0.
- **Your bank wants to confirm:** a bank's request to confirm a payment isn't a decline. On the developer's own press (Pay, Pay more, Pay what you owe, Subscribe, the chargeback steps) the stop-once check runs first, then the bank's pop-up opens in the page: confirmed, it goes through; cancelled or failed, "Your bank didn't confirm the payment, so nothing was charged." and no hold. While the confirmation is pending the piece is locked: a tester's Charge or Let it go on it is refused ("A payment for this is being confirmed right now.") until the bank confirms, refuses or times out (the pop-up is closed, or after 15 minutes). A charge made while the developer isn't there (a tester's Charge, a dispute decision, a retry, a renewal) waits as "needs your confirmation": they're asked to Confirm it in Payments within 3 days, or it counts as declined (a payment hold for a charge, a lapse for a renewal), and the tester sees "Payment may be delayed". A Confirm pressed twice counts once. A piece is never charged twice.
- **Retries during a hold:** while a payment hold or chargeback hold lasts, what is owed is retried on the saved card once a day, at most 7 tries per hold, and at once when a new card is saved. A success pays the lines it covers (open pages stop once) and the developer gets "We charged your card $X for what you owed."; a payment hold with nothing left owed lifts as if they had pressed Pay (from the 4th hold on, after Approve); a chargeback hold still needs the card check and Approve. A failed retry sends no bell; Payments shows "Last try: <date> · next try: <date>", or "No more automatic tries: press Pay what you owe".
- **Paying while suspended:** a payment never lifts an admin suspension. When what is owed is paid (or a chargeback hold lifts) while a developer-side suspension continues, the developer gets "Your payment went through. Your tests stay paused while your account is suspended." (bell and email, even with email Off); "Your tests are running again" goes out only when nothing pauses their tests any more.
- **Pay what you owe** updates live (about every 20 seconds), and the server refuses it when nothing is owed, so a payment from another tab is never charged twice. It has no note.
- **A deleted developer's card:** parts already open to Charge when they deleted stay open and charge their saved card, and so does a dispute decided for the tester. A decline leaves the payment delayed for the tester and listed for admins; there's no account left to hold, and the platform never covers it. What they owe stays owed.
- **Prices:** written and recording $1–$1,000 each, calls $10–$200 an hour, or free. The smallest charge is $0.50; Stripe's largest is $999,999.99.
- **A suspended tester's pay** is still charged; their share is held until their tester side is reinstated. If it never is, an admin refunds or releases it.
- **Payouts** go to a tester's Stripe account once it can receive them (payouts and transfers both switched on), and payout setup needs a confirmed email.
- **Wording for testers:** "paused" and "delayed" only.

### Plans and the subscription

- **Free plan (every developer):** one open test at a time. A test counts as open while it is Open, Full or Paused; drafts, stopped and closed tests, and tests whose joining has closed (DEFAULT), don't count.
- **Subscription, $7 a month,** adds: up to 10 open tests at once (an 11th is refused: "You have 10 open tests, the most you can have at once. Stop or close one to post another."; the count is checked on the server at the press), Approved-only testers (applications), Next round, and Invite testers.
- Testers never pay and never see any of this. The 20% platform share on payments is unchanged.
- **Billing:** monthly from the sign-up day; a sign-up on the 31st renews on the last day of shorter months. Cancel any time: the subscription lasts until the end of the paid month, with no refunds. Each charge gets a receipt line on Payments.
- **On the free plan** the perk buttons stay visible with a small "Subscribers" tag, and a press is refused with "<Perk> needs a subscription ($7/month)." and a Payments link (new tab). The perks are named "Inviting testers", "Next round", "Approved-only testers" and "Running several open tests" (Post a test, Edit test, Developer test page).
- **Losing the subscription** (a cancel reaches its end, or a renewal lapses): running tests carry on as they are (an Approved-only test stays Approved only, and invites already sent stay valid); only new uses of a perk are refused. Using a perk on an existing test is not a new use: an Approved-only test keeps working fully, and the developer can still accept or decline its applications. A page open at that moment gets it as a stop-once change: "Your subscription ended."
- **A declined renewal lapses, with no hold.** The payment is retried for about a week, and the perks continue meanwhile. After the last retry fails, the subscription ends and the developer is on the free plan. Testers are never affected. A chargeback on a subscription payment starts a chargeback hold like any chargeback, and the amount is added to what is owed.
- **During a payment hold, a chargeback hold or a developer-side suspension** billing pauses: no renewal is charged. The paid days left resume when it lifts, so the next renewal moves later by the time it was paused. The developer can still cancel from Payments, and Keep my subscription still works because it charges nothing; Subscribe is refused: "You can subscribe once your account is active again."
- **Deleting the account**, or the team deleting it, ends the subscription at once with no refund.
- **Free during launch:** until the date set in the server configuration (FREE_UNTIL, an ISO date; unset now, which means free with no end), every developer has the perks without paying. A value that isn't a real date stops the deploy, so the old version stays live until it's fixed; a past date is fine and means free has ended. It can be set, changed or cleared at any time after launch. The daily job tells every developer 30 days and 7 days before that date, by bell and by email even with email Off. A developer who subscribes during the free period is first charged on that date. When the free period ends, it works like a lapse: running tests carry on, and only new uses of a perk are refused.

### Ratings

- Testers rate the developer once everything they sent is decided or past its review date, every call that took place (listed or not) is paid or past its review date, and no dispute is open. So an unpaid unlisted call never blocks rating for ever. Rating ends their part (Charge, Let it go and Dispute stay). The Rate button has no end date.
- Developers rate a tester after the tester rated, within 14 days (a Needs you item). Both ratings show together, or the tester's alone after 14 days.
- 1–5 stars and an optional comment (up to 500 characters), shown without names. Only real work counts: some work sent or a call held.
- A suspended or held person's tests can still be rated by the other side; the suspended person can't rate on that side until it lifts: Rate is hidden while their pages are closed, a press from an old page is refused and routes them to the dashboard top, and Rate comes back when it lifts.
- Reminders: once; after a stop or close, every 3 days for 2 weeks. Rate is refused while a dispute is open. Otherwise it stops once like any press: on a test still open, for every kind of change; after the test stops or closes, only for a Pay, Charge, Let it go or dispute.

### Holds and suspensions

| | Payment hold | Chargeback hold | Developer side suspended | Tester side suspended |
|---|---|---|---|---|
| Starts when | any payment is declined | a chargeback arrives | an admin suspends, with a reason | an admin suspends, with a reason |
| Their tests | all paused | all paused | all paused | they are removed from every test |
| They can | Pay what you owe, Change card, Payments, Contact us; on their tests: Stop the test, End early, Cancel call, excerpts, their side of a dispute | the three steps, Change card, Payments, Contact us; on their tests the same as a payment hold | Change card, Payments, Contact us (appeal); on their tests the same as a payment hold; their tester side works as normal | Payments (payout setup), Contact us (appeal); their developer side works as normal |
| Testers in those tests can | save drafts, cancel booked calls, dispute, Charge or Let it go, Rate, Leave; read the chat | the same | the same | (not in any test) |
| Waits until it lifts | sending work, sending chat messages, new calls, joins, invites and applications, Pay; testers' charges are paid when the developer pays what they owe | the same | the same; testers' charges and disputes decided for them are charged at once | their held share of pay |
| Lifts when | everything owed is paid, by a press or an automatic retry (4th hold on: plus an admin's Approve) | card verified, owed paid, admin Approve | an admin reinstates that side | an admin reinstates that side |
| On lifting | tests resume; deadlines move on; testers get "<test> is running again" | the same | the same | no automatic re-invite: the tests they were removed from stay at their dashboard top ("You were removed from this test", with Ask to rejoin while the test is open with a spot) until they ask or dismiss; the developer can invite them again |

- **Calls:** calls starting within 3 days of a hold or suspension starting are cancelled with no fault, and both sides are told. Later calls stay booked; each is cancelled 3 days before it starts if the hold or suspension is still on.
- **Testers in a paused test** (the developer is on any hold or a developer-side suspension, or the team paused that one test): Send, the call-request tools and Join call are hidden (the server still refuses them), under a blue banner listing what still works; drafts can be written and saved. They can still dispute, Charge or Let it go, rate and leave. A paused test never closes the chat: it stays open both ways on a team pause; while the developer is restricted, the tester can read it but not send ("Messages are paused for now. You can still read this chat."). Invites and applications wait, and work again after the lift unless something else closed them. The 7-day close still applies; after it, Charge, Let it go, dispute and rate carry on, and charges added to what is owed stay owed.
- **What the developer can do on a paused test** is the same for every cause: Stop the test and End early (both go through silently, with no stop-once; End early still needs its reason), Cancel call (with its stop-once), excerpts, and their side of a dispute. During a hold or suspension they reach the test's paused view from its dashboard card; Calls can also be cancelled from the dashboard's Calls box.
- **Daily paused reminder** for the developer: "<test> is paused and closes on <date> unless your account is cleared" (for a hold: "…unless you pay what you owe"). It stacks across tests and replaces their "paused" and "closes tomorrow" lines; testers keep theirs.
- **Per side.** A hold limits only the developer side of an account. A suspension covers one side: the developer side or the tester side; to suspend both, an admin suspends each. While it lasts, every signed-in page of that side except the dashboard, Payments, Settings, the bell list (and, for the developer side, the paused view of their test pages) moves them to the dashboard top (details in Every page). Presses are judged by the side they belong to. A tester whose developer is suspended or on hold isn't restricted.

### When account states change or combine

One row per change. A test is paused while its developer has any hold or suspension, so it runs again only when none is left. The lines in the last column are quoted from the bell and email tables on Every page; "bell" and "email" say which.

| What happened | What changes for the developer | What changes for testers | Who is told |
|---|---|---|---|
| A developer-side suspension starts, with no hold | All their tests pause. Every developer page except the dashboard, Payments, Settings, the bell list and the paused view of their test pages moves to the dashboard top, where the blue box says how to appeal. On their tests only Stop the test, End early, Cancel call, excerpts and their side of a dispute work. Calls within 3 days are cancelled with no fault. Their tester side works as normal. | The paused-test rules: Send is refused (drafts save), the chat can be read but not sent to, invites and applications wait; dispute, Charge, Let it go, Rate, Leave and cancelling calls work. A Charge, or a dispute decided for them, is charged at once. | Developer: "Your developer account is paused" (bell and email), then daily "<test> is paused and closes on <date> unless your account is cleared" (bell). Testers: the call line for a call cancelled because the test is paused (bell). |
| A tester's Charge, or a dispute decided for them, is declined during a suspension | A payment hold starts on top of the suspension, and the amount goes into "Pay what you owe". Pay can't be pressed during a suspension, so a Pay can't be declined then. | Their payment is delayed; they are paid when the developer pays. | Developer: "Your tests are paused" (bell and email). Testers: "Payment for your work on <test> may be delayed" (bell). |
| A payment hold becomes a chargeback hold | The three chargeback steps on Payments replace Pay what you owe: verify a card with 3D Secure, pay what is owed, then an admin's Approve. The chargeback adds its amount plus the $15 fee to what is owed; paying alone never lifts it. | Nothing new: the test stays paused under the same rules, and Charges and disputes decided for them are still added to what is owed. | Developer: "…paused after a chargeback" (bell) and "…your payment hold is now a chargeback hold" (email). Admins: "Playtest: new chargeback of $X" (email), then the hold in their daily email. |
| Another decline, or another chargeback, during a hold | A decline adds to "Pay what you owe". A chargeback adds its amount plus the $15 fee to what is owed, turns a payment hold into a chargeback hold and clears an earlier card check. A Pay what you owe press for the old amount stops once ("What you owe changed: now $X. Press again to pay $X."). | The payment is delayed and paid when the developer pays. | Developer: "Another payment was declined: $X … was added to what you owe" or "Your bank reversed a $X payment …" (bell). Admins: "Playtest: new chargeback of $X" (email). Testers: "<dev>'s payment for your <part> ($X) is delayed. You'll be told when it arrives." (bell). |
| The hold is paid while the suspension continues | The hold lifts (from the 4th hold on, after an admin's Approve). The tests stay paused and the pages stay closed while the suspension lasts. | The test stays paused. Charges added for them are paid. | Developer: "Receipt: you paid $X for …" (bell). Testers: "<dev> paid $X for your <part>" (bell). Instead of "Your tests are running again": "Your payment went through. Your tests stay paused while your account is suspended." (bell and email). |
| The developer-side suspension lifts while a hold continues | The developer side stays as in a hold: tests paused, pages closed except the paused view, Pay what you owe or the chargeback steps on Payments. | The test stays paused. | Developer: "Your developer account is active again" (bell and email). Testers: nothing until the test runs again. |
| Both have lifted | Tests resume as normal and the pages reopen. Every working tester's deadline and the test's Open until move later by the length of the pause. | Send, chat, call requests, invites and applications work again, unless something else closed them. Their deadline moves later by the length of the pause. | Developer: the line for whichever lifted last, "Your tests are running again" or "Your developer account is active again" (bell and email). Testers: "<test> is running again" (bell). |
| A paused test reaches its 7-day close during a hold or suspension | The test closes like a Stop: the card says "Closed after 7 days paused" and a banner gives the reason. The hold or suspension goes on, and money owed stays owed. Pay opens once it lifts. | "This test ended on <date>." with no reason. Charge, Let it go, dispute and rate carry on; charges added to what is owed stay owed. | Developer: the daily "<test> is paused and closes on <date> unless …" before it, then "<test> was closed. <reason>" (bell and email). Testers: "<test> ended" (bell). |
| The team pauses one test during a hold | The test is paused by both, so it runs again only when the hold has lifted and the team has lifted its pause. It keeps its one closing date, 7 days from when it was first paused, and the card shows both reasons: "Paused: payment hold · paused by the team". | The same paused-test rules. | Developer: "The team paused <test>" (bell and email); later "The team lifted the pause on <test>" (bell). |
| A tester's tester side is suspended while their developer is on hold | The tester leaves every test ("Left this test"). Their sent work stays, waiting for Pay once the hold lifts; pay for it is charged, and the tester's share is held until they are reinstated. | The suspended tester is removed from every test, and every tester page except the dashboard, Payments, Settings and the bell list closes. Charges already added to what the developer owes are paid when the developer pays, with their share held. | Developer: "<tester> left <test>" (bell). Tester: "Your tester account is paused" (bell and email). |
| The developer deletes their account during a hold | It goes through: a developer can always delete. Deleting never clears a hold, a chargeback or money owed. Parts already open to Charge stay open and charge the saved card; work still under review never opens Charge. | Their tests stop. Parts already open to Charge keep Charge and Let it go; work still under review reads "<dev> deleted their account, so this can't be paid."; open disputes are still decided. | As for any deletion; there is no hold line. |
| The 4th hold or later is paid | The hold stays until an admin presses Approve (Lifts on the Administrator console); the blue box says the team will review the account after they pay. The tests stay paused until then. | The test stays paused until the Approve. Charges added for them are paid when the developer pays. | Admins: "Hold lift waiting: <dev> paid what they owe (More than 3 holds)" (bell) and the admin daily email. Developer: "The team approved lifting your hold", or "Your tests are running again" when the Approve lifts it (bell; "Your tests are running again" is also emailed). Testers: "<test> is running again" (bell). |
| A subscription renewal is declined | No hold starts. The payment is retried for about a week and the perks continue. After the last retry fails, the subscription ends and they are on the free plan: running tests carry on, new uses of a perk are refused, and an open page gets "Your subscription ended." as a stop-once change. | Nothing changes. | Developer: "Your $7 subscription payment didn't go through. Update your card by <date> to keep it." (bell and email), then "Your subscription ended because the payment didn't go through." (bell and email). |
| A chargeback arrives on a subscription payment | A chargeback hold starts, like any chargeback, and the amount is added to what is owed. | As for any chargeback hold: the developer's tests pause. | As for any chargeback hold (above). |
| A hold or suspension starts while subscribed | Billing pauses: no renewal is charged while it lasts, and the paid days left are kept. They can still cancel or keep it from Payments; Subscribe is refused ("You can subscribe once your account is active again."). | Only the hold or suspension rules above. | The hold or suspension lines above. |
| That hold or suspension lifts | The paid days left resume, so the next renewal moves later by the time it was paused. | Only the lifting rules above. | The lift lines above. |
| A subscriber deletes their account, or the team deletes it | The subscription ends at once, with no refund. The delete warning says: "Your subscription ends now, with no refund for the rest of the month." | As for any deleted developer (Every page). | As for any deletion; there is no subscription line. |
| An automatic retry during a hold goes through | The lines it covers are paid. A payment hold with nothing left owed lifts (from the 4th hold on, after Approve); a chargeback hold stays until the card check and Approve; a suspension stays. | Payments for those lines are no longer delayed; the test runs again only when nothing pauses it. | Developer: "We charged your card $X for what you owed." (bell), then the lift lines above. |
| The platform wins a chargeback | Its amount and the $15 fee come off what is owed, or are refunded to the card if already paid ("Refund: your bank's chargeback of $X was reversed"). If that was all that was owed for a chargeback hold, it lifts as usual (from the 4th hold on, after Approve). Open test pages and Edit stop once: "Your bank's chargeback of $X was reversed: $Y refunded to your card." | Nothing changes, unless the hold lifts (above). | Developer: "Your bank's chargeback of $X was reversed in your favour." (bell and email). |
| The bank wants a charge confirmed while the developer isn't there | The payment waits as "needs your confirmation", with Confirm on Payments. After 3 days without a confirmation it counts as declined: a payment hold for a charge, a lapse for a renewal. | "Payment may be delayed". | Developer: "Your bank wants you to confirm a $X payment. Confirm it in Payments by <date>." (bell and email, even with email Off). |
| A tester deletes their account with sent work waiting | Their sent work stays in Needs you with Pay and the usual reminders. Pay reaches their Stripe account if their payout account was connected; if not, those rows leave Needs you with "<name> deleted their account before setting up payouts, so this can't be paid." (DEFAULT). | Unsent work is gone, and so are Charge and Dispute. Their excerpt requests and shown excerpts are removed. | Developer: "<tester> left <test>" (bell). |

### Deletion

- Deleting stops the account's tests, cancels invites and applications, keeps all history, and never clears holds, chargebacks or money owed. A developer can always delete: parts already open to Charge stay open and charge their saved card (a decline leaves the payment delayed for the tester and listed for admins; the platform doesn't cover it); work still under review never opens Charge; open disputes are still decided; pending excerpt requests on their tests close, and shown excerpts stay. A tester who deletes leaves every test (calls ahead, invites and applications cancelled, open disputes withdrawn); work they already sent can still be paid by the developer, to their Stripe account if their payout account was connected (if not, those rows leave Needs you, a DEFAULT), but they can't charge for it or dispute it; their excerpt requests and shown excerpts are removed.

### Limits

| What | Limit |
|---|---|
| Spots | 1–50 and the developer's tester limit (10 to start, +10% per 10 good ratings, at most 50) |
| Open tests per developer | 1 at a time on the free plan (Open, Full and Paused count; not once joining has closed, DEFAULT); up to 10 with the $7/month subscription |
| Tester deadline | the day they join + the test's tester days (from when the test opened to Open until, in whole days) |
| Open until | required; the last day to join; 3–30 days after today, in the developer's own time zone; extend only, within 30 days of today |
| Product, test name | 60 characters each |
| What should testers do | 20,000 characters |
| NDA | 1,000 characters (an Edit Save that changes a longer old NDA must fit) |
| Written part | 50,000 characters for all its answers together; up to 5 attachments, 25 MB each (images, PDF, plain text, zip), plus recordings |
| Excerpts | 10–500 characters; at most 3 shown or pending per tester; one pending request per part |
| Categories | at least 1 |
| Written questions | 1–20, each up to 20,000 characters |
| Part price | written and recording $1–$1,000, or free; over $200 needs a tick |
| Call rate | $10–$200 an hour, or free |
| Any charge | $0.50 to $999,999.99 |
| Pay | any amount from $0; a note is required at $0 and below the listing |
| Pay above the listing | per piece: up to 100% of the listing, never more than the max; unlisted written answers or a recording at most $1,000 plus $1,000 extra; an unlisted call at most $200 an hour for its measured length, with no extra |
| All of one tester's calls on a test | $1,000 together, listed and unlisted, extra pay counted (paid plus booked calls at their reference) |
| Changes to the steps, NDA, questions, languages, devices, build link, and parts and prices | 3 per field, counted from the first join, application or invite; one Save that changes two fields uses one change of each (an admin's Allow 3 more gives 3 more to every field at 0); access keys aren't limited |
| Call length | booked 10–180 min; measured up to 150% of booked; the developer can only lower it |
| Call requests | 3 time rows; repeats 2–8 or Forever; per tester 3 booked times and 3 waiting requests |
| Joining a call | 10 minutes before the start to 30 minutes after the booked end; cancelled if nobody joins by halfway |
| Cancelling a call | a reason is required under 24 hours; not after it starts |
| Tests per tester | 10 at once |
| Recordings | 500 MB each; up to 5 on the Recording part, sent together; a written part's attachments count separately |
| Uploads per account | 3 GB a day ("You've uploaded a lot today. Try again tomorrow."); an upload not finished within 3 hours is removed |
| Names | at least 1 character |
| Reasons and notes | 1,000 characters (the team's reasons and decision notes, Pay notes, the reason for paying $0 or less than the listing, a lowered call length) |
| End early's reason | required, up to 10,000 characters |
| Text | rating comment 500, dispute 2,000, the developer's side of a dispute 2,000, bio 1,000, Contact us 10–50,000 characters; report reason at least 5 |
| Contact us | 5 messages per account a day |
| Chat | 30 messages a minute per person |
| Sign-in | 5 failed tries per email or 20 per network in 15 minutes pause sign-in for 15 minutes |
| New accounts | 10 per network an hour |
| Confirmation and reset emails | 3 an hour each; reset requests 10 per network an hour |
| Waitlist | 5 sign-ups per network an hour |
| Kept drafts | 50 forms per person (a new one drops the oldest) |
| Reports | one per person about another, ever |
| Disputes | one per part |
| Paused test | closes after 7 days; an admin can extend by 1–90 days |
| Review date (Charge opens) | the later of the tester's own deadline and 7 days after sending (or after the call) |
| Developer review reminders | 1 month (if it was more than a month away), 3, 2 and 1 weeks, 3 days and 1 day before the review date, none within 24 hours of sending; then daily for listed work, none for unlisted |
| Unlisted calls | one weekly "Pay your calls" line until paid |
| Tester Charge reminders | every 3 days |
| Invite reminders | daily until answered |
| Rating | developer within 14 days of the tester; reminders every 3 days for 2 weeks after a stop |
| Payout problem reminders | every 3 days until fixed |
| Hold lifts | the 4th hold on needs an admin's Approve |
| Retries during a hold | once a day, at most 7 per hold, and at once when a new card is saved |
| Bank confirmation | 3 days to confirm a charge made while the developer wasn't there; a pending press locks the piece for up to 15 minutes |
| A payment with no answer | checked after 15 minutes; the same one-time key for 24 hours |
| Chargeback fee | $15 per chargeback, added to what is owed |
| Calls near a hold or suspension | cancelled within 3 days |
| Outage | 15 minutes or more moves timers; over 24 hours needs an admin's Approve |
| Long lists | 3 lines, then "Show N more" (scroll box about 8 lines); admin lists pages of 25 |
| Long text | steps and each question: scroll box about 6 lines; reasons and notes: about 4 lines; written answers: about 16 lines; NDA: about 12 lines |
| Big numbers | in full under 10,000, then k, M, B, T, × 10^N |

Open questions about these rules are in QA and open questions.

## Security and launch

What the pre-launch security fixes mean for the people using Playtest, in plain words. How each page shows them is in its own tab.

### Signing in

- A wrong sign-in always says "Wrong email or password", whatever was wrong, so nobody can find out who has an account. "Forgot your password?" always answers the same way too.
- Too many wrong tries pause sign-in for 15 minutes for that email or that network, even with the right password: "Too many tries. Wait 15 minutes or reset your password." New accounts (10 an hour), reset requests (10 an hour) and waitlist sign-ups (5 an hour) are limited per network as well.
- **Google into an unconfirmed account.** If someone made an account with an email they don't own, the real owner signing in with Google takes it over safely: the password is cleared, every device is signed out, and any payout setup is dropped before the email counts as confirmed.
- **Sign out of all devices** in Settings ends every session of the account, this device included.

### Admins

- An address on the admin list gets admin access only once its email is confirmed. Registering an admin's address first gives nothing.
- An admin with either side of their account suspended loses admin access ("Your account is paused.").
- Every admin action is kept with the admin who did it; other admins see who, developers and testers only ever see "the team".

### Money

- **Only a real card decline is a decline.** Any other problem with the payment service fails the press with "Payments are having a problem right now. Nothing was charged; try again shortly.": no hold starts, nothing is owed, and the payment service's own error text is never shown. A subscription renewal that fails for such a reason is simply tried again the next day.
- **A payment that never answered** is checked after 15 minutes and either finished or cleared, never charged twice (Rules).
- **No press counts twice.** Each press carries its own one-time key, made by the app for that person, so a repeated or replayed press never charges twice, and one person's press can never block another person's Charge or the team's decision. A payment event delivered twice by the payment service, or a Confirm pressed twice, counts once. Pay more is checked and saved in one step, so two quick presses can't both go over the cap.
- **Payouts** need a confirmed email, and a tester's payout account counts as ready only once it can receive transfers and pay out.

### Uploads

- Each file must be exactly the size the browser said it was, and the app checks it once it's uploaded. A file that's missing, the wrong size or too big is deleted: "That upload didn't finish properly. Try again."
- Files are always served as the type they were uploaded as: images and videos open in the page, everything else downloads.
- Removing a recording deletes its file. Uploads not finished within 3 hours are removed by the daily job, and so are files left without their row.
- Each account can upload up to 3 GB a day: "You've uploaded a lot today. Try again tomorrow."

### The live site

- **Settings are checked loudly.** A missing or wrong setting that would make the live site quietly unsafe (payments recorded but never charged, uploads on the server's own disk, emails written to a test outbox, test payment fakes, placeholder admin addresses or keys, a missing site address) stops the deploy, so the old version stays live until it's fixed. Smaller problems show in the red "Settings to fix" box at the top of the admin console, for the owner only.
- **Emails are really sent.** On the live site, an email that can't be sent fails loudly; it's never written to a test outbox, and the test outbox only opens for admins.
- **Outages can't be faked.** They come only from the uptime service's own alerts, timed by the app's own clock; alerts more than 10 minutes off are refused, the key can be checked safely, and an outage over 24 hours moves nothing until an admin approves it.
- **Pages are protected in the browser:** they can't be shown inside other sites, and they only load scripts, pictures, videos and payment pop-ups from Playtest, the payment service, the file storage and the built-in call room. A call room on another service can't be shown inside the call page; "Open the room in a new tab" is the way in.
- **Chat** is limited to 30 messages a minute per person, and kept drafts to 50 forms per person.

## QA and open questions

### Edge cases to test before launch

- **Payments:** a declined Pay, Charge, call charge or extra pay starting a hold at once; another decline during the hold adding to what is owed; two tabs paying one part; a chargeback with work waiting; a chargeback during a payment hold; a tester or developer suspended mid-payment; a deleted developer with valid charges; a payout failure; an admin raising pay in a dispute; a held share released or refunded; the extra-pay cap with parts outside the contract and unlisted parts; a call that isn't a listed part paid from an empty box; a tester's Charge during a hold added to what is owed and paid when the developer pays; the per-piece extra-pay caps: an unlisted written piece totalling $2000, a 30-minute unlisted call at $100 with no extra, five hours of unlisted calls reaching the $1000 total, a $20 written listing allowing $20 extra, a $50/h call allowing $50/h × minutes extra, and a listing above the max ($3000, or $300/h) allowing only the max ($1000, or $200/h × minutes) extra (such listings are outside today's price ranges); paying $0 on a listed and an unlisted part (the reason required, the row closed, the dispute still open); the note on Pay and Pay more (required at $0 and below the listing, 1,000 characters, never in the bell); the room beside the amount turning red as you type; the call's Rate and Amount filling each other (the last typed wins); the amount tick unticking when the amount changes, and the second tick over $200; a payment-service error that isn't a decline (no hold, nothing owed); a payment that never answered, checked after 15 minutes both ways (it went through, it didn't); a press repeated after a lost answer never acting twice.
- **Participation:** two testers for the last spot; joining on the first day, the 13th day and the last day of a 14-day test (each gets 14 days); joining refused after Open until, and applications and invites closing then; a test past Open until no longer counting as open; Open until moved later by some days while testers work (every working deadline moves the same days); invite-only tests never in Find, and a test that became invite only staying on an applicant's dashboard; Open until under 3 or over 30 days refused; an 11th open test refused, and a post that goes through after another tab stopped a test; leaving during a suspension; pausing mid-send; closing mid-review; an invite accepted in one tab after it was cancelled in another; invite plus rejoin ask in either order; the 10-test limit on every way in.
- **Terms:** an offer replaced by a newer one before the tester answers; work sent during a change; reviewing at an old price; rejoining with the right terms; the per-field 3-change limit on 7 fields (one Save changing two fields), counted from the first join, application or invite and still counting after the only applicant withdrew, and Allow 3 more; applications closed and invites re-sent, stacked across tests; a Switch shown as one quiet line and a Keep not at all; questions changed after a draft (a draft answer to Q1 kept, a changed Q2 empty, Q3 unchanged, and the previous set showing all three).
- **Calls:** overlapping bookings; cancelling from another tab, then a stale Join; a hold or suspension starting within 3 days of a call, and one starting later; joining a paused test's call; requesting a call on a test with no Live call part; booking while terms are edited; a Forever set adding its next call; nobody joining by halfway; the measured length (a reload gap under 5 minutes, the 150% cap, no overlap at all), lowering it with a reason, and a listed call opening Charge at the measured length × rate; the $1,000 for one tester's calls (a mix of listed and unlisted calls, booking refused at the limit, the warning under an hour's worth, a capped Charge); the weekly "Pay your calls" line stacking across tests; calls that are over moving to the tester row and Call history.
- **Ratings:** complete and rate; the developer not rating in 14 days; leaving early; ended by the developer; closing with mixed paid ($0 included), older rejected and unreviewed work; an unpaid unlisted call no longer blocking rating after its review date; rating while the other side is suspended or held; leave and rejoin without duplicate records.
- **Restrictions:** a developer pressing on a test page as a hold starts (routed to the dashboard top, blue box naming the press); the same on Profile and Edit; Cancel call from the Calls box during a hold; suspended on the session or payout page; a deleted user on an open page; two admins on one account; a lifted suspension and Ask to rejoin; long pauses closing; repeated pauses; a tester sending, saving a draft, charging or chatting while a test is paused, and the paused banner listing only what's available (with and without the deadline line); deadlines and Open until moving later when a pause lifts; a 6th Contact us message; a restricted account opening each closed page, a bell line and Change card; deleting with work still waiting; a mixed account with the developer side suspended (the tester side still joins, sends work and chats; the side switch lands on the blue box); the paused view during a team pause and during a hold (Stop and End early going through silently, Cancel call stopping once, an older page's Save refused and routed); chat while the other person is restricted (read-only note, a Send turned back with the text kept, the box coming back live); the developer's side of a dispute from the dashboard box while suspended.
- **Cross-device:** a phone action refreshing a desktop tab; a hold reaching every tab; signing in as someone else in another tab; drafts kept after a refused press; sign-in expiring mid-send; network failure during upload or payment; an outage moving timers.
- **Subscription:** a second test on the free plan (Open, Full and Paused count; drafts, stopped and closed don't), including a draft posted while another test is open; each perk on the free plan (Approved only on Post and Edit, Next round, Invite) refused with its "Subscribers" tag; Cancel, then Keep my subscription before the end; a page open when the subscription ends; running Approved-only tests and sent invites after it ends; a declined renewal (retries, perks during them, the lapse, no hold); a chargeback on a subscription payment; a hold or suspension starting and lifting mid-month (paid days resume, renewal moves later); cancelling during a hold; a sign-up on the 31st; deleting while subscribed; the free-during-launch date (under 30 days refused, the 30- and 7-day notices with email Off, no date set, subscribing during the free period and being charged first on that date).
- **Reviews and payments:** a dispute on every kind of reviewed part (a $0 Pay, an older Reject, an unlisted Pay), and an admin decision on an unlisted part up to its cap; Pay more on every paid piece until its cap; a bank confirmation on a press (confirmed, cancelled, the pop-up closed, 15 minutes) and a Charge pressed meanwhile; a charge made while the developer is away waiting for Confirm, and timing out after 3 days into a hold (or a lapse for a renewal); retries (a success lifting a payment hold, a chargeback hold staying, the 7-try limit, a new card retrying at once); the $15 fee; a won chargeback before and after paying; Pay what you owe updating live and refused when nothing is owed; paying while suspended.
- **Written work:** the 50,000-character counter; Bold, Italic and Code block rendered safely; 5 attachments of 25 MB; Record (screen only when the microphone is refused); 5 recordings with Remove, a 6th refused, and Send while one is uploading; long answers in the developer's scroll box; previous question sets (at most 3) and By question grouping.
- **Excerpts:** eligible parts only (paid above $0, no NDA); trimming to 10–500 characters; a 4th refused; one pending per part; an NDA added later hiding requests and shown excerpts, and removing it bringing them back; Allow from an old page after an NDA was added; blocks, holds (the dashboard box) and suspensions; deleting on either side; requests never stopping once.
- **Deletion:** a tester deleting with sent work, with and without a payout account; a developer deleting with work under review, parts open to Charge (charged to the saved card, a decline staying delayed), an open dispute and money owed.
- **Access keys:** the read-only notice updating live as keys are added, deleted or given; a reported key crossed out, with its quiet live-box line; the one Free box (lines deleted and added, another tab's keys left alone, a deleted line whose key a joining tester was given); typing back a key from a tester who left or finished (the warning-only line, never a mistake); the broken-key warning (Select all, Works now, Dismiss selected; a new report showing again; the tester's next press stopping once even with Alerts Off).
- **Sign-in and security:** the one wrong-sign-in message for each case; 5 tries per email and 20 per network; 10 new accounts per network an hour; Forgot password for an account with no password; Google into an unconfirmed account; an unconfirmed admin address; a suspended admin; Sign out of all devices; an upload of the wrong size; the 3 GB a day limit; each reader's own time zone in bell lines and emails.

### Open questions

**Waiting for the owner (tonight's list)**

- Built with defaults, to confirm:
  - While a test is paused, testers can still write and save drafts.
  - When a pause lifts, every working tester's deadline and the test's Open until move later by the length of the pause.
  - A deleted tester with no payout account: their sent work leaves Needs you with "<name> deleted their account before setting up payouts, so this can't be paid." (BATCH-11 §1).
  - Quiet Switch / Keep: a Keep tells the developer nothing, and a Switch is one quiet line that never stops a press (BATCH-14 §4).
  - The review date (Charge, reminders, rating) uses each tester's own deadline in place of Open until (BATCH-15 §18).
  - A test whose joining has closed no longer counts toward the open tests (BATCH-15 §18).
  - A payment or chargeback hold gives the same paused view as a suspension: Stop, End early and Cancel call (BATCH-15 §29).
  - A refused press on a test the team paused goes to the test page's banner, not the dashboard top (BATCH-15 §23).
  - A tester who finished counts as "no longer working", so their key can be typed back into Free (BATCH-15 §19).
  - The first live update never scrolls the page while someone is typing or a pop-up is open; a "1 new update ↑" pill shows instead (BATCH-15 §28).
  - The developer marking a tester's key as working stops that tester's next press even with Alerts Off (BATCH-15 §45).
- Confirm large totals before posting ("Up to $8,000 could be charged if all spots send everything.")? Not built.
- When a limit in Rules changes, tell developers in the bell and on the fields it affects?
- Fraud: invite developers by hand at launch, a longer tester payout delay, and a new-developer spending limit or prepaid budgets before public developer sign-up?
- Pause developers who stop responding? Not built.
- 3D Secure on large payments (e.g. Pay over $200): not built; revisit after launch data.
- Tests paused repeatedly, and repeated holds or suspensions: stop a test or escalate after several? (The old "third pause stops the test" idea was dropped.)
- Tester suspensions: removing a suspended tester from all tests at once may be too harsh. Options: pause their contracts instead, or let developers choose.
- UI for many rows and long text: long names and titles are cut with "…" (full text on hover); reasons and notes sit in scroll boxes. Revisit layouts for accounts with many rows and very long names.
- Written answers: are 50,000 characters per written part, and 5 attachments of 25 MB each, the right limits?
- Which formats do developers want in written answers? Today: Bold, Italic and Code block.

**Earlier questions**

- **Timing:** what happens to unreviewed work when a test closes on its own.
- **Payments:** is a 10-day refund period workable with the payment provider's rules and payout timing; refund exceptions; pay when a developer ends work early.
- **Restrictions:** different escalation for different causes; stopping abusive re-registration without blocking people who share devices or networks; reports on paused tests.
- **Business:** higher prices for higher-rated testers; charging for work that isn't accepted; which tester stats are public; forums or group tests.
- **Ratings:** scales and categories; early departures; tests ending without full completion.
- **Content and storage:** which content needs warnings or rejection; identity checks; how long recordings are kept and size limits; resumable uploads; transcription with self-hosted open-source models; phone layouts for complex panels; taking back a dispute; more than 10 tests per tester.

### Post-launch

Tester notification preferences; admin outage recording; admin pay above the listing; notification muting; more rating filters; question-based forums; group tests; advanced recruitment; automated risk controls; Themes and moments (transcribed recordings grouped into themes); an admin "Payout problems" list; a spending limit or prepaid budgets; in-app messages between admins and users; a soft "Ana is looking at this" marker on disputes; link checks on the build link (block private network addresses, check for malware and phishing with Google Web Risk, warn about password-protected archives); if invalid or unreachable emails are found, require those accounts to change their email (and password) before continuing.

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
