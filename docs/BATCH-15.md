# Batch 15: launch fixes and owner decisions (owner, Oct 30)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 14 and after the report recordings are committed.

Every item needs tests AND a proof for the owner's report: a scenario in `scripts/media.cjs` (desktop + `-phone`), or, where a picture can't show it, a short test-output or log capture saved under `docs/media/proof/` with a caption in `captions.json`. Items marked **(owner at home)** need the owner's own Stripe, R2 or UptimeRobot account for the final check. Build and test them with the fakes, and list the exact steps the owner should follow in `docs/media/proof/AT-HOME.md`.

## 1. Chat: closed only while a PERSON is restricted, never because a test is paused
- **A paused test no longer closes the chat.** Remove `PAUSE_DEFAULTS.chatClosed` and `CHAT_PAUSED` from the chat page, the session page and the sessions route. Also remove "chat is closed" from the paused banner and its tests.
- **While either person is restricted** (suspended, or a developer on a payment or chargeback hold):
  - **The restricted person:** chat pages stay closed (closedPages: redirect to the dashboard top, as today). A Send pressed from a page loaded before the restriction is refused the same way as Rate: it routes them to the dashboard top, and the text they typed is kept.
  - **The other person:** they can open the chat and read everything. The message box is replaced by a note: "Messages are paused for now. You can still read this chat." This is neutral wording. Never say "suspended", "hold" or "failed" about the other person.
  - **A Send from an open page** when the other person became restricted after the page loaded: a blue notice under Send, "Messages are paused for now, so this wasn't sent." The typed text is kept and the box hides live.
  - **When the restriction lifts,** the message box comes back live.
- This applies to every chat between the two people, on every test.

## 2. Unlisted parts: the same review reminders as listed parts, then they stop
- **Remove `UNLISTED_REMIND_DAYS`.**
- **A part that isn't listed gets the developer's review reminders on the same schedule as listed work.** The countdown runs to its review date, the later of Open until and sent + 7 days, with these marks (owner, Oct 30):
  - 1 month before (only if the date was more than a month away when it was sent),
  - then every week: 3 weeks, 2 weeks and 1 week before,
  - 3 days before,
  - 1 day before.
  - Only marks still ahead when the work is sent are used. Example: review date 25 days away gives 3 weeks, 2 weeks, 1 week, 3 days, 1 day.
- **No duplicate on the sending day.** A mark that falls within 24 hours of sending is skipped, because the "<name> sent work" notice that day counts as the first one. Example: review date a week after sending gives the sent notice, then 3 days, then 1 day.
- **Listed review reminders use exactly the same marks.** Drop batch 12's `noMonth` for review reminders. Add the review-reminder marks as their own list (`REVIEW_MARKS`); the other countdowns that use `MARKS` (Open until heads-ups and the like) are unchanged.
- **After the review date:** a listed part opens Charge, as today. An unlisted part does NOT: its reminders stop, and its Needs you row (Pay only) stays until it's paid, even at $0.
- **Proof:** a fake-clock test listing the reminder dates for:
  - a part sent 20 days before Open until;
  - a part sent 2 days before Open until (review date = sent + 7);
  - the same two cases for unlisted parts, ending without Charge.

## 3. Questions: up to 20,000 characters each
- **`LIMITS.question = 20000`,** per question, and the counter reads "N / 20,000". The 1 to 20 questions rule is unchanged.
- **Long questions sit in a scroll box about 6 lines tall wherever they're shown in full:**
  - the tester's answer form,
  - previous question sets,
  - the listing and join page,
  - Post and Edit,
  - the developer's piece view and By question,
  - the admin dispute fold (item 8).
- **In lists** (the offer box, "Questions then and now", cards), each question is cut to 3 lines with "Show more", and the list shows 3 then "+N more".
- **Storage:** answer sets store question text, so 20 × 20,000 characters plus 50,000 of answers must fit.
  - Raise `kept.ts` `MAX_BYTES` and every other size guard that the listing snapshots (applications, invites, contracts, Terms history) go through.
  - Add a test with 20 questions of 20,000 characters, sent, switched and kept.
- **Proof:** a recording of the answer form and the developer's view with 3 very long questions.

## 4. Payout readiness (no new UI)
- **`refreshPayoutStatus`:** ready = `payouts_enabled && capabilities.transfers === "active"`. Drop `charges_enabled`, because these accounts only receive money.
- **The `account.updated` webhook** uses the same rule.
- The payout setup button, banner and wording are unchanged.
- **Proof:** a unit test with Stripe account objects (transfers-only and ready; payouts off; transfers pending).
- **(owner at home)** Onboard one test-mode Express account with Stripe's test details and see "Payouts are set up".

## 5. Stripe Connect webhook secret
- **New setting: `STRIPE_CONNECT_WEBHOOK_SECRET`.**
  - The webhook route checks the signature against `STRIPE_WEBHOOK_SECRET`, and then against the Connect secret.
  - It accepts either one, and a bad signature with both is still a 400.
- **`.env.example` and the HANDOVER launch checklist list both endpoints and their events:**
  - **Platform endpoint:** `charge.dispute.created`, `charge.dispute.closed`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `customer.subscription.deleted`.
  - **Connect endpoint ("events on connected accounts"), same URL:** `account.updated`, `payout.failed`, `payout.paid`.
- **Proof:** tests that sign one event with each secret, plus a wrong one.
- **(owner at home)** Create the Connect endpoint in Stripe test mode and send a test `account.updated` from the dashboard.

## 6. Upload sizes enforced on the live storage (R2)
- **The presigned PUT signs `content-length` as a signed header,** equal to the size the browser claimed (already capped at 500 MB / 25 MB), so R2 refuses any other size.
- **`finishRecording` checks the real object** with a HEAD request to R2. If it's missing, a different size, or over the limit, the object and the row are deleted: "That upload didn't finish properly. Try again."
- **Local uploads are unchanged** (they already count bytes).
- **Proof:** a unit test of the presign (content-length in SignedHeaders), and a test with a fake HEAD (too big, so deleted).
- **(owner at home)** With the R2 test bucket: a script PUTting more bytes than claimed is refused.

## 7. Sign-in: one message, and attempt limits
- **Sign-in says "Wrong email or password"** for:
  - no account,
  - a deleted account,
  - an account without a password (Google sign-up),
  - a wrong password.
- **When Google sign-in is set up,** the form shows a hint: "Signed up with Google? Use Continue with Google."
- **"Forgot your password?"** for an account with no password sends "Your account has no password yet. Choose one here:" with the same reset link. The page always says the same thing whatever the email.
- **Limits** (new table `LoginAttempt`: email, ip, at, ok; migration):
  - **5 failed tries for one email in 15 minutes, or 20 from one network** (`x-forwarded-for`'s first address), pause sign-in for that email or network: "Too many tries. Wait 15 minutes or reset your password." This pause applies even when the password is right.
  - **Sign-up:** at most 10 new accounts per network per hour: "Too many new accounts from here. Try again in an hour."
  - **Cleanup:** the daily job deletes attempts older than a day.
- **Unchanged (owner, Oct 30):**
  - The reset link stays as it is (no temporary password).
  - Sign-up keeps "An account with that email already exists".
- **Proof:** recordings of the wrong-password message for each case, and the too-many-tries message.

## 8. Admins see the disputed work
- **Each dispute row (open and decided) has a fold, "See the work",** showing the disputed piece exactly as the developer's piece view shows it. Reuse that component, don't copy it:
  - written answers under the questions they answered, with "Sent for the questions until <date>" when relevant, each in batch 10's scroll box (formatted Markdown);
  - attachments (downloadable);
  - recordings (playable);
  - for a call, its time, the logged minutes and the rate.
- **Access:** `canView` and the attachment/recording file routes allow admins (ADMIN_EMAILS).
- **Admins don't get the developer's test page.** The fold is their view.
- **Proof:** a recording of an admin opening a dispute on a long written answer (with a 10,000-character answer and an attachment) and on a recording that plays.

## 9. Payments stuck "in progress"
- **A `pending` Payment older than 15 minutes** is checked by the daily job, and when the developer's test page, Payments or the tester's session page loads (at most one check per payment per minute).
  - It finds the PaymentIntent by its metadata `payKey` (Stripe search; with the fake, its lookup).
  - **Found and `succeeded`:** finish it as normal (finishReviewPay / the matching finish for Charge, extra and owed payments).
  - **Found and `requires_action` / `processing`:** leave it for the bank-confirmation timers.
  - **Found and failed or cancelled, or not found:** clear it. Delete the review (or the press's reservation), mark the payment `failed` with "interrupted", and the piece is back in Needs you, so Pay can be pressed again. Nobody gets a bell.
- **Never charge twice.** The same `payKey` idempotency key is kept on any new press for that piece within 24 hours.
- **Proof:** a test that crashes between the reservation and the charge (the fake throws), then recovers both ways (charged and not charged).

## 10. Outages come from the uptime service's own alerts
- **New route `POST /api/health/alert?key=<HEALTH_KEY>`,** taking UptimeRobot's alert webhook (`alertType` 1 = down, 2 = up, the alert time and duration).
  - A "down" is stored.
  - The matching "up" records an outage from down to up, if it lasted 15 minutes or more, with the existing `recordOutage`, which moves timers and cancels calls.
- **Missing pings never create an outage any more.** Heartbeats may stay for information only. A paused monitor changes nothing.
- **HANDOVER and `.env.example`:** how to set the UptimeRobot alert contact (webhook, POST, the URL with the key).
- **Proof:**
  - tests showing a 20-minute gap with no pings records nothing, and that a down/up pair 40 minutes apart records one outage and moves a deadline;
  - a recording of the admin's outage line after a simulated alert pair.
- **(owner at home)** Pause the monitor for 20 minutes: nothing changes.

## 11. Each person's own time zone in bell lines and emails
- **`User.timeZone`** (IANA name; migration).
  - The browser sends `Intl.DateTimeFormat().resolvedOptions().timeZone` at sign-in and whenever it differs (one small call from the app layout).
  - Unknown means UTC.
- **Every time written into a bell line or email uses the RECIPIENT's time zone and names it:** "2:00 PM EST". This includes the dates now forced to UTC in rules.ts and subscription.ts: `shortDay`, `bankConfirmLine`, `day`, outage lines, call times and deadlines.
  - Write one helper, `fmtFor(user, date, kind)`, and use it everywhere a server-side line includes a time.
- **Times on pages** keep using the viewer's browser clock.
- **Scheduling stays automatic:** times are picked in the picker's own time zone, and the other side sees them in theirs. There's no time zone dropdown (check that none exists).
- **Proof:** a recording with the developer in America/New_York and the tester in Europe/Berlin (Playwright `timezoneId`). The same call shows each side's own time on their pages, in their bell lines and in their outbox emails.

## 12. Settings checked loudly
- **One function, `configProblems()`,** listing problems with plain fixes:
  - production without `RESEND_API_KEY`: "Emails aren't being sent: RESEND_API_KEY is missing.";
  - `FREE_UNTIL` set but not a valid date: "FREE_UNTIL isn't a valid date ("<value>"). Developers stay free until it's fixed.";
  - `FREE_UNTIL` less than 30 days ahead when set;
  - `STRIPE_SECRET_KEY` set without `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` or `STRIPE_CONNECT_WEBHOOK_SECRET`;
  - only some of the four R2 settings;
  - production without `CRON_SECRET`, `ADMIN_EMAILS` or `APP_URL`;
  - `OUTAGE_CHECKS=1` without `HEALTH_KEY`.
- **A bad value stops the deploy (owner, Oct 30: "make them enter a proper date").**
  - A check runs before `next build` (`scripts/check-config.cjs`, run from the build script) and fails the build with the plain message for:
    - a `FREE_UNTIL` that isn't a valid date (a past date is fine: it means free has ended, and it can be set, changed or cleared at any time after launch);
    - a live Stripe key without the publishable key or either webhook secret;
    - only some R2 settings;
    - production without `RESEND_API_KEY`.
  - On Vercel, a failed build means the old version stays live and the new value doesn't take effect until it's fixed.
  - Missing optional settings only warn.
- **Where the rest show:**
  - a red box at the top of the admin dashboard, listing each one, shown only to the owner. New setting `OWNER_EMAIL`: only that admin sees the box. If it's unset, every admin sees it, so it's never hidden.
  - logged once at server start (instrumentation);
  - never on public pages.
- **Production without the email key:** `sendEmail` throws and logs. It never writes to the outbox unless `ALLOW_DEV_OUTBOX=1`.
- **Proof:** a recording of the admin red box with three problems set on a test server, and the unit tests.

## 13. Presses with no connection, or a lost answer
- **Today:** every press goes through `api()`. With no connection it shows "You seem to be offline. Check your connection and try again." under the button, and the typed text stays.
- **Audit:**
  - Every press uses `api()` (no raw `fetch`).
  - Every form keeps its typed text on that error.
- **A press whose answer was lost after the server acted** (the connection dropped mid-press), pressed again:
  - **It must never do it twice.** Check Pay, Pay more, Pay what you owe, Charge, Let it go, Send work, Join, Apply, Accept, Book a call, Rate and Allow/Deny.
  - **Each one either answers "already done" cleanly** (the existing refusals), or is made idempotent with a press ID sent by the page.
  - **Chat messages:** send a client ID so a repeat doesn't post twice. The ID belongs to one press of one message, not to its words. It's made when the person presses Send, kept only while that message hasn't been confirmed, and replaced once it is. So "Hello" sent twice on purpose posts twice; only a resend of the same unconfirmed message is ignored. Test both.
- **Proof:** a test per press that repeats the same request, and a recording with the browser set offline showing the message and the kept text.

## 14. Previous questions: say whether each set was sent or a draft (owner, Oct 30)
When a tester switches to terms with changed questions, the previous set (batch 13 §8) keeps whatever the tester had at that moment, labelled:
- **Sent only:** the sent answers, labelled "Sent <date>".
- **Draft only (never sent):** the draft answers, labelled "Draft (not sent)".
- **Both** (sent, then edited without sending again): both versions in that set. "Sent <date>" comes first, then "Draft (not sent)" with the unsent edits. Each is a read-only fold.
- **The developer only ever sees the SENT versions** in their "Previous questions and answers" fold. Drafts are the tester's own and never reach the developer, the admins or the report's developer views.
- Store the label on `PrevSet` (`kind: "sent" | "draft"` per version, with its date). Older stored sets without one show as "Sent" if the part was sent, else "Draft (not sent)".
- **Proof:** re-record the report's changed-questions example as a timeline. The scenario has 3 questions and the tester sends all 3. They then edit their Q1 answer in a draft. The developer changes Q2, and the tester switches. Show the form (Q1's draft filled in, Q2 empty, Q3 kept), the previous set with both "Sent" and "Draft (not sent)", and the developer's fold with only "Sent".

## 15. Logging a call's length (owner, Oct 30)
- **Listed calls:** the developer can log the length until the call's log date: the later of Open until and 24 hours after the call starts (instead of 24 hours). This replaces `CALL_CLOSE_MS` for logging.
  - The log date moves with Open until (Edit) and with pause shifts.
  - **Not logged by then:** the booked length is used, so the listing price applies (rate × booked length), and the call is reviewed like any other part. Charge opens at the later of Open until and the call + 7 days.
  - **Tester's line:** "<dev> enters the length after the call. If they don't by <log date>, the booked length (<N> minutes) is used."
- **Unlisted calls:** never logged automatically. They stay on the test until logged and paid, with no end date and no Charge.
  - **The weekly reminder,** "Log and pay your calls", stacks across tests in one bell line per week: "3 calls to log and pay on 2 tests". It opens to the list and keeps coming weekly until each call is paid ($0 counts).
  - These calls get no other review reminders.
- **Rating:** every call that took place counts, listed or not. Today calls use a stale 14-day rule in `rateBlocker`. Replace it with the same rule as sent parts: a call blocks rating until it's paid, or its review date (the later of Open until and the call + 7 days) has passed. So an unpaid unlisted call never blocks rating for ever.
- **Logging during a suspension or hold:** unchanged (owner, Oct 30). A hold refuses it ("You can enter this once the hold is lifted.") and a suspension closes the test page. The log date moves later by the pause length, so the developer never loses the chance.
- **Proof:** fake-clock tests and a recording showing:
  - a listed call logged a week later (before Open until);
  - one never logged, which uses the booked length and then opens Charge;
  - an unlisted call's weekly stacked reminder across two tests;
  - rating opening after a call.

## 16. Suspensions are per side (owner, Oct 30)
An admin suspends ONE side of an account: the developer side or the tester side. To suspend both, they suspend each side.
- **Data:** split `suspendedAt` / `suspendNote` / `suspendedById` into a developer-side set and a tester-side set (migration). Existing suspended accounts get both sides.
- **The admin's Suspend box:**
  - An account with both roles gets a choice: "Developer side" or "Tester side". A one-role account just shows Suspend.
  - Each suspended side has its own Reinstate, and admin rows say which side(s): "Suspended (developer side)".
  - The two-admin refusals work per side: "That account's developer side is already suspended." / "…was already reinstated."
- **Developer side suspended:** everything batches 5–12 say about a suspended developer, unchanged:
  - pages closed and sent to the dashboard top with the blue box;
  - tests paused;
  - billing paused;
  - payments don't lift it.

  Their tester side works normally: Find, joining, sessions, sending work, Charge, payouts, and chats as a tester.
- **Tester side suspended:** today's tester suspension, unchanged (tester pages closed, removed from every test, developers see "Left this test"). Their developer side works normally.
- **A mixed account:**
  - The side switch still works. Switching to the suspended side lands on the dashboard top with that side's blue box.
  - The other side's pages stay open.
  - Presses are judged by the side they belong to (`requireActive`'s `devSide`, as holds already are).
- **Chat (item 1):** only chats where the person is on the suspended side are paused. A developer-side suspension pauses the chats on their own tests, not the chats on tests they're testing.
- **Emails and bell:** "Your developer account is paused…" or "Your tester account is paused…". The daily admin line counts suspended sides.
- **Proof:** a recording of a mixed account with the developer side suspended. The developer side sends them to the dashboard top, the tester side still works and sends work, and a second admin's refusal shows.

## 17. "What should testers do?": up to 20,000 characters (owner, Oct 30)
- **`LIMITS.whatToDo = 20000`** (was 1,000), with the counter "N / 20,000" on Post, Edit and the draft. It's still required and keeps its own 3 changes.
- **Display:** the steps are no longer shown in full:
  - On the listing, the join page and the session page, they sit in the same scroll box as long questions (about 6 lines tall; short steps show without a scroll bar).
  - On cards and rows: 3 lines, then "Show more", as now.
  - In the Switch/Keep offer box and Terms history, "Before" and "Offered" are two such scroll boxes.
- **Storage:** listing snapshots now carry up to 20,000 more characters. Include this in item 3's size checks.
- **Proof:** a recording of a 20,000-character "What to do" on the listing, the join page and the offer box, desktop and phone.

## 18. Every tester gets the same number of days; Open until is the last day to JOIN (owner, Oct 30; replaces batch 12 §6's shared deadline)
- **Tester days:** from when the test opened (posted, or a Next round opened) to Open until, in whole days. Store `Test.testerDays` (migration).
  - Example: posted Nov 6 with Open until Nov 20 is 14 days.
- **Each tester's deadline** is the day they join + tester days, stored on the contract (`dueAt`, as now).
  - Example: a tester joining Nov 6 is due Nov 20; one joining Nov 19 is due Dec 3.
  - Accepted invites and approved applications count from the moment they become a tester.
- **Open until = the last day to join.**
  - **Afterwards, the test is closed to everyone who hasn't joined:** it's out of Find, and the join page says "This test closed to new testers on <date>."
  - Pending applications and open invites close at Open until (as when it fills up).
  - Working testers carry on until their own deadlines.
- **Edit moving Open until later by D days:** tester days grow by D, and every working tester's deadline moves D later. It's still only later, and still within 30 days of today. Pause and outage shifts are unchanged.
- **The test after Open until:**
  - **Developer card and test page:** "Joining closed · testers working until <latest deadline>".
  - It's done when the last working tester's deadline passes, or everyone has finished. Stop and End early work as now.
  - It does NOT count toward the 10 open tests once joining has closed. (DEFAULT; the owner may change it.)
- **Review dates use the tester's own deadline in place of Open until** (DEFAULT, because Open until was only there as the shared deadline). This covers every place:
  - Charge opens at the later of that tester's deadline and sent + 7 days;
  - the review reminders (item 2) and unlisted calls (item 15);
  - a call's log date (the later of the tester's deadline and the call + 24 hours);
  - rating opening.
- **Wording:**
  - **Post and Edit**, label "Open until (last day to join)". Hint: "Each tester gets the same time from when they join: today to this date (14 days)." The number updates live.
  - **Find cards and the listing:** "14 days per tester · join by Nov 20".
  - **Join page:** "Your deadline: Dec 3 (14 days from joining)".
  - **Terms lines:** "14 days".
- **Existing tests** keep their stored deadlines. `testerDays` for them is Open until − opened, used for new joins only.
- **Design doc and report:** the example above, stated once.
- **Proof:** fake-clock tests (join on day 1, day 13 and the last day; Edit +5 days; joining refused after Open until; Charge dates from each tester's deadline), plus recordings of the Post hint, the join page late in the window, the "closed to new testers" page and the developer's card after Open until. Desktop and phone.

## 19. Edit's Free keys: one plain text box (owner, Oct 30)
- **Replace the Free list** (each key with its ×) **and the separate "Add keys" box** with ONE text box holding all current free keys, one per line. The developer deletes lines to remove keys and types new lines to add them.
- **Heading, live as they type:** "Free (3 keys · 3 open spots)". Red under the box when there are fewer keys than open spots: "Add 1 more key: 3 open spots, 2 keys." (`keyNeedLine`).
- **In use is unchanged** (read-only, crossed out when reported).
- **Save works out the change against the keys this page LOADED, not the current ones,** so another tab's work is never undone:
  - **removed:** loaded keys whose line is gone;
  - **added:** lines that weren't loaded.
  - Keys another tab added are left alone, and so are keys that a joining tester was given but whose line is still there.
- **Refusals stay red under the box, one line each** (`keyRefusal`):
  - a deleted line whose key a tester was given since the page loaded: "HR-4444 was given to a tester since you opened this page, so it's in use now and can't be removed." (Replaces `tickedInUseLine`; there's no Keep button any more);
  - a typed key that's used, reported, held or a duplicate (as now).
- **After that red line,** the box refreshes to the current free keys with the developer's other edits still applied. HR-4444 is now under In use, not in the box. Pressing Save again saves the rest and goes through, unless something new happened in between (owner, Oct 30).
- **The race scenario (blue notice):** the stop-once notice lists what changed since the page loaded ("HR-7777 added in another tab", "HR-4444 given to Ana"). The box then shows the current free keys with the developer's own edits still applied, ready to Save again.
- **What can be typed into Free (owner, Oct 30):**
  - **Refused, red:**
    - a key in use by a working tester ("HR-1111 is in use by Ana Silva, so it can't be added.");
    - a key reported as not working ("…was reported as not working, so it can't be added.");
    - a duplicate.
  - **Allowed:** a key whose tester is no longer working on the test (left, removed, suspended, or their deadline passed / they finished). It goes back to Free when typed in, and nothing returns to Free by itself.
    - (DEFAULT: "no longer working" covers finished testers too, since they don't need the build any more.)
  - **In use** shows such keys greyed, with "(left)" or "(finished)" after the name, so the developer can see which ones they could reuse.
  - **The hint under the boxes:** "Keys in use or reported as not working can't be added. A key from a tester who left or finished can be typed in again."
  - Update `keyRefusal` ("held" is no longer refused) and its tests.
- **Bug to check:** the owner's screenshot shows "HR-3333 is already in use by a tester" while In use lists only HR-1111 and HR-2222. Every key a refusal calls "in use" must appear in In use. Fix whichever side is wrong, and add a test.
- **Proof:** re-record the access-keys race (both tabs, desktop and phone) and the refusals with the new box.

## 20. Reasons and notes: italic, up to 1,000 characters, scroll when long (owner, Oct 30)
- **One limit, `LIMITS.reason = 1000`, with a live "N / 1,000" counter on every box.** A longer one is refused in red at the field, never cut silently. Today some are trimmed with `.slice(0, 500/1000/2000)` without telling anyone; remove those cuts. The limit applies to:
  - the admin's reasons: stop, pause, suspend, reinstate, Approve a lift, delete an account;
  - the admin's dispute decision note;
  - the developer's Reject reason and Pay note (including Pay more). **Pay what you owe has no note** (owner, Oct 30), and none is added.
  - the reason for paying less than the listing.
- **Unchanged:** the tester's dispute text and the developer's side stay at 2,000.
- **Display, everywhere a reason or note is shown:**
  - under its heading, in italics, as a quote: The team stopped this test. / *"Media pass check: build link is broken"*;
  - in a scroll box about 4 lines tall when long;
  - covering banners (the admin stop/pause banner on the test page and the tester's), tester rows, Needs you, the session page, and the admin lists and History.
- **Reasons and notes never appear in bell lines (owner, Oct 30).** The bell says what happened and links to where the reason is shown. Today two lines include the admin's note, and they change as follows:
  - "The team stopped "<test>": <note>" becomes "The team stopped "<test>"";
  - "The team paused "<test>": <note>" becomes "The team paused "<test>"".

  Check every `notify`/`bell` subject for a reason, note, dispute text or message, and add a test that no bell text contains one. Emails still include them in full.
  - Emails show it in full.
- **The admin-stopped banner, in order:**
  1. the title;
  2. the reason (italic, scroll);
  3. any failed-press line ("Your Save on <test> didn't go through.");
  4. what still works.
- **Proof:** recordings of a 1,000-character admin stop reason on the developer's banner and a 1,000-character Reject reason on the tester's session page, desktop and phone.

## 21. Admins see which admin did what; Contact us up to 50,000 characters (owner, Oct 30)
- **Admin views name the acting admin by email,** everywhere an admin action shows:
  - test rows ("stopped by ana@…", "paused by …", lifted, extended, closed now);
  - dispute decisions;
  - Approve lifts;
  - suspend and reinstate (per side, item 16);
  - delete account;
  - Allow 3 more;
  - refunds and payouts of held shares;
  - Contact us replies;
  - History.

  Store the admin's id on every one of these that doesn't already (some do: `adminStoppedById`, `suspendedById`, `decidedById`). Show "an admin (deleted)" if that admin's account is gone. The two-admin refusals name them too: "ben@… already decided this dispute at 3:10 PM."
- **Developers and testers never see which admin;** they always read "the team".
- **Contact us:** `LIMITS.contact.max = 50000`, with the counter "N / 50,000". The admin's list shows each message in a scroll box about 8 lines tall (the email to the team has it in full). The 5-per-day limit is unchanged.
- **Proof:** a recording of two admins: one stops a test, the other sees "stopped by <email>" and gets a refusal naming the first. Plus a 50,000-character Contact us message in the admin list.

## 22. End early: a required reason, up to 10,000 characters (owner, Oct 30)
- The End early pop-up's "Why?" box: required, at most **10,000 characters**, with the counter "N / 10,000". Remove `maxLength={500}` and the 5-character minimum.
- **The End early press button stays disabled** (greyed, with the hint "Say why first") until the box has at least one non-space character AND at least one tester is ticked. The server refuses an empty or too-long reason anyway.
- **Testers read the reason** in item 20's italic scroll box: on the session page, and in full in the email. It's not in the bell line.
- **Proof:** a recording of the pop-up with the button disabled, then enabled, and a long reason on the tester's page, desktop and phone.

## 23. A test paused by the team: Stop, End early and Cancel call only (owner, Oct 30)
- **The test page still opens.** Its banner reads: "The team paused this test. For now you can stop it, end testers' work early, or cancel calls." Then come the reason (item 20) and any failed-press lines.
- **Only these buttons show:** Stop the test, End early, and each booked call's Cancel. Everything else is hidden live: Edit, Next round, Invite, Pay, Reject, Pay more, Alerts' changes, the call-request tools and excerpt Allow (Deny still works, batch 13). Chat follows item 1: the team pausing a test doesn't close it.
- **Stop goes through silently.** No stop-once at all while the team has the test paused, whatever changed. The developer's own Stop during a team pause is never stopped by a blue notice.
- **End early goes through silently as well (item 29); Cancel call** keeps its normal stop-once.
- **Any other press on that test from an older page** (an Edit Save, Pay, Invite, Next round…) is refused. The developer is routed to the test page banner (DEFAULT, recommended; the owner may choose the dashboard top instead, so keep the route in one place). The failed-press line is listed there: "Your Save on <test> didn't go through: the team paused this test." Edit for that test closes the same way.
- **Proof:** a recording of a team pause while the developer has the test page and Edit open. The buttons disappear live, Save is refused and routed, and Stop goes through without a stop even after a tester's change.

## 24. Renames: no note under the press; recorded in the contract's changes (owner, Oct 30)
- Remove `renamedNote` ("Done. Also: the test was renamed…") from presses on both sides. A rename still never stops a press.
- Every change of the product name or the test name is recorded in the contract changes box: the tester's Terms history on the session page, and "See their contract" on the developer's side. It reads "Renamed: "<old product> · <old test>" → "<new product> · <new test>" · <date, time>", stored for every working tester's contract.
- This includes a rename saved while a tester's press was in flight (the entry is written by the Save, not by the press).
- **Proof:** a test, plus a recording of the Terms history entry after a rename.

## 25. Tester's Leave and Block never stop (owner, Oct 30)
- The tester's Leave and Block skip the tester gate entirely. No blue stop, ever; they go through on the first press. Leave's own confirm pop-up stays, and it's built from the current state when opened.
- They are still refused when they can't happen ("You already left this test.").

## 26. Alerts: back to a menu at the top of the page, and a one-press Alerts for testers (owner, Oct 30)
- **Developer:** move Alerts out of the overview's button row to its own place at the top right of the test page and of Edit, above the overview, like the full app (`playtest-platform/src/components/press-notice.tsx` AlertsMenu).
  - **The button:** "Alerts ▾", or "Alerts (2 ignored) ▾" when some are off.
  - **The dropdown:** "What stops your presses on this test's pages. Unticked ones still show (greyed) but never stop you." with one tick per type (ticked = stops, as in the full app; flip lean's current "tick what should NOT stop") and "Reset (stop me for everything)".
  - Still saved per developer.
- **Tester:** an "Alerts: On / Off" toggle, one press, at the top right of the session page. It's saved per tester and applies to all their tests.
  - **On:** today's behaviour.
  - **Off:** no press stops for anything except changes to their contract: a new terms offer (Switch/Keep) still stops. Every other change still shows in the live box, greyed, but never stops. Refusals are unchanged.
  - The stop box gets "Turn off alerts" as a quick option.
- **A short line under each button (owner, Oct 30):**
  - Developer, under "Alerts ▾": "Choose which updates make your buttons stop once to show you what changed."
  - Tester, under the toggle: "On: a button stops once when something changed since you opened the page. Off: only new terms from the developer stop it."
  - Both are small grey text, and on phones they wrap under the button.
- **Proof:** a recording of each: the developer's menu and a tick turning a stop off, and the tester's toggle making a Send go through despite a payment line while a terms offer still stops.
- **Owner change (Oct 30, later):** KEEP the developer's Alerts exactly as it is now: it stays in the overview's button row, keeps "Tick what should not stop your buttons" (ticked = ignored), and gets no new line under the button. The developer part of this item (the move, the flip, "Reset") is dropped. The tester's one-press Alerts toggle and its line stay as specified, and the proof covers only the tester's toggle.

## 27. The developer's side of a dispute: optional, never stopped, works while restricted (owner, Oct 30)
- **Not required (as today):** an admin can decide without it. The Needs you item says "Add your side (optional, once; the team reads both)".
- **The Add your side box stays until the admin decides,** with no time limit, on the test page, on a stopped, paused or closed test, and in the dashboard box while restricted. Once the side is sent, the box becomes the read-only text.
- **"Send your side" never stops:** remove `devGateIfSeen` from `addDevSide`. Its only refusals are "This dispute was already decided." and "You already added your side." It's limited to 2,000 characters with a counter (no silent cut, item 20).
- **During a suspension or hold** (test pages show only item 29's restricted view), the developer's dashboard gets a "Disputes: add your side" box at the top, under the blue box, like batch 13's excerpt box. It lists each open dispute with the tester's text and the same Add your side box. The refusal and routing rules don't apply to this press. With more than 3 disputes, the box scrolls (about 3 items tall). The batch 13 excerpt box does the same.
- **Admins:**
  - The dispute row updates live when the developer adds their side: the "Developer's side" line appears, marked "added <time>".
  - The admin's Decide stops once if the developer's side arrived after the admin's page loaded: a blue notice under Decide, "<dev> added their side at 3:12 PM: read it, then press Decide again." The second press goes through.
  - The decided-elsewhere refusal (two admins) is unchanged.
- **Proof:** a recording of an admin with the dispute open while the developer (suspended, from the dashboard box) adds their side. The admin's row updates, the first Decide stops, the second goes through.

## 28. The first live update scrolls the page up to the top box (owner, Oct 30)
- On the developer test page, Edit, the tester session page and both dashboards: when the FIRST live update since the page loaded arrives in the top (live) box, the page scrolls smoothly up to that box, and the new line flashes briefly.
- It happens once per page load. Later updates just appear (and the box's count goes up).
- **Never yank someone mid-task (DEFAULT):** when a text box or field has focus, or a pop-up is open, don't scroll. Show a small floating pill instead, "1 new update ↑", which scrolls up when pressed and disappears once the box is in view. It also doesn't scroll if the box is already in view.
- Ignored (greyed) Alerts lines count as updates too, since they still show.
- Respect reduced motion: jump without the animation.
- **Proof:** a recording of the developer scrolled down to Needs you when a tester sends work (the page scrolls up), and of a tester typing an answer when an update arrives (the pill appears, no scroll). Desktop and phone.

## 29. A restricted developer's test pages: overview only, with Stop, End early and Cancel call (owner, Oct 30)
Applies while the developer's account is suspended (developer side, item 16) or on a payment or chargeback hold (DEFAULT: holds too). It changes batch 5's "test pages close".
- **Test pages open again from the dashboard cards,** in a restricted view showing only:
  - the blue box line at the top: their usual restriction line plus "For now you can stop this test, end testers' work early, or cancel calls.";
  - the **overview panel** (title, status, badges, terms, Open until), with only the **Stop the test** and **End early** buttons;
  - a compact **Booked calls** list (time, tester, length) with **Cancel** on each (24 hours ahead, as now; `devOk`).

  Hidden: Needs you, Testers, Live session tools, Invite, Edit, Next round, Alerts, chat links and the answers. Edit, chat and every other test page still route to the dashboard top.
- **Stop and End early go through silently:** no stop-once, whatever changed. End early still needs its reason (item 22). After the press, the developer goes to the dashboard top, which shows a line: "Done: you stopped <test>." / "Done: you ended <N> testers' work on <test>."
- **Cancel call keeps its normal stop-once.** After the press they stay on the restricted view.
- **Any other press from an older full page** is refused and routed to the dashboard top with the failed-press line, as now.
- **Item 23 (team pause of one test)** uses the same pair: Stop AND End early go through silently there too.
- **Owner note (Oct 30, later):** no Alerts menu in the restricted view until the owner answers (it stays hidden there).
- **Proof:** a recording of a suspended developer opening a test card and seeing the restricted view. They cancel a call, then Stop (it goes through despite a tester's change) and land on the dashboard with the "Done" line. Plus the disputes box with 5 disputes scrolling. Desktop and phone.

## 30. No Reject anywhere: Pay any amount, with a reason required at $0 (owner, Oct 30)
- **Every Pay box** (written answers, recordings and calls; listed or unlisted; Needs you and the tester rows) **loses its Reject button.** The developer pays an amount from $0 up.
- **The note** is labelled "Note to <name> (optional)", and it becomes required only when the amount is $0: "Say why you're paying $0 (the tester reads it)." It's red at the box.
  - Paying less than the listing but above $0 no longer requires a reason (owner, Oct 30; replaces checkPay's "Say why you're paying less than the listing"). PENDING owner confirmation: keep this one rule behind one constant, `REASON_WHEN_UNDER_LISTING = false`, so it can be flipped back.
  - **Owner update (Oct 30, later):** paying LESS than the listing still requires a reason, as today. Set `REASON_WHEN_UNDER_LISTING = true` (keep checkPay's "Say why you're paying less than the listing…"). A $0 payment also requires a reason, including on unlisted parts. Everything else in this item stands.
- **A $0 payment closes the row like a payment.** The tester can dispute any amount once, $0 included. Its wording on both sides is "Paid $0: "<reason>"".
- **Old rejections stay** and show as "Rejected".
- **Listed parts:** Charge / Let it go still only open for work left unreviewed. A $0 payment is a review.
- **The line under the button:**
  - listed: "<name> can dispute the amount once.";
  - unlisted: "This part isn't listed: pay any amount, $0 included. <name> can dispute the amount once."
- Update the Terms page, the design doc wording and every test that relied on Reject.

## 31. Pay boxes: one green Pay, the cap beside it; calls as a history fold in the tester row (owner, Oct 30)
- **Every Pay and Pay more box** (Needs you, tester rows, calls) has:
  - one **green Pay** button;
  - the amount;
  - "Note (optional)" (required at $0, item 30);
  - the ticks;
  - and, beside the amount, the room left: "up to $15.00 above the listing" / "up to $2,000.00 (max)" / "up to $X more for unlisted calls".

  An amount above it is refused in red at the box (`overListingLine` / `overMaxLine` / `overCallsLine`), live as they type and again on the server.
- **Remove the repeated "Paid so far for this part: $X"** from Pay more boxes in the tester rows, since the part line already shows what was paid.
- **Every Pay and Pay more** (Needs you, tester rows, Payments) uses the same stop-once (devGate) and the same suspension/hold refusal and routing. Add a test per box.
- **Tester row, Live call part:** the part line shows the total paid for all calls on the right, like the other parts ("Live call · Not required · paid $45.00").
  - Under it, a fold "Calls (3)" lists each call that took place: date and time, logged length, "paid $15.00" on the right.
  - Each call has its own green Pay / Pay more box inside the fold, under that call. Its "up to" is for that call.
  - Calls still waiting for a first payment link to their Needs you item.
- **The bottom line stays:** "Paid in all: $X · Calls: 1 booked ahead, 1 done". The owner asked what "held" means: it's a call that took place. "held" becomes "done" everywhere (tester rows, the part line, the tester's own page).
- **Proof:** recordings of a tester row with 3 calls (the fold, a Pay more over the cap turning red, then a valid one), and the Needs you Pay box with its cap beside it. Desktop and phone.

## 32. Problems the report's recorder found (Oct 30)
- **Open until in the evening (Americas):** the Post date picker counts 3 to 30 days from the local date, but the server counts from the UTC date, so after about 7 PM in Chicago the picker's earliest date is refused. Count days in the developer's own time zone (item 11's `User.timeZone`, sent with the Post/Edit press). Fix the two tests the recorder's attempt broke.
- **Post:** a question over its limit or an NDA over 1,000 shows only a red counter or border. Add the red message at the field ("Keep each question to 20,000 characters." / "Keep the NDA to 1,000 characters.").
- **Edit's blue note** says "Changed in another tab or device" when a key was simply given to a joining tester. Use "<name> joined and was given HR-4444" for that case; keep "Changed in another tab or device" for saves.
- **Stacked "listing changed" bell lines** leave test titles unquoted. Quote them like every other line.
- **A part whose developer deleted their account** still shows the "Under review" badge. Show "Can't be paid: <dev> deleted their account" instead (batch 12 §1).
- **Grammar:** "Your written answers on … wasn't accepted" goes away with Reject (item 30). Check that no other line uses "wasn't" with a plural part.
- **The test database grows without limit** (2.4M notifications, 1,380 admins), and the daily-job tests time out. Make the test setup clear the `test` schema at the start of each `npm run check` run (TRUNCATE all tables, test schema only, never the dev data), so it can't build up again.

## 33. Live session panel: long call lists scroll (owner, Oct 30, added later)
On the developer test page's Live session panel, each tester's card lists their calls. With many calls (weekly repeats, up to 8), the card gets long, so:
- **Each tester's card:** booked and upcoming calls go in a scroll box about 3 calls tall, soonest first.
- **Calls that took place** move into a "Past calls (N)" fold under it, also scrolling.
- **The whole list of tester cards:** it scrolls on its own once it's taller than about 2 screens, with the tester tick list and the request form staying above it.

**Proof:** a recording with one tester who has 6 booked calls and 4 past ones, desktop and phone.

## 34. One $1,000 ceiling for all of a tester's calls on a test (owner, Oct 30, added later)
One $1,000 ceiling for ALL of a tester's calls on a test, listed and unlisted together, with extra pay counted. This replaces batch 12 §2's unlisted-only $1,000 pool (`NO_LISTING_CALLS_TOTAL_CENTS` becomes `CALLS_TOTAL_CENTS`). The unlisted $200/h per-call cap is unchanged.
- **Used** = everything paid for that tester's calls on the test (Pay, Pay more, dispute decisions, Charge), plus each booked call not yet paid at its reference (rate × booked length; unlisted: $200/h × booked length).
- **Booking:** a request, an offer or an Accept that would push Used over $1,000 is refused, on both sides: "Calls with Ana on this test can come to at most $1,000; $X is left, so this call can't be booked." Pending requests over the limit can't be accepted (same line).
- **Paying:** every call Pay / Pay more box's "up to" is also limited by what's left. Charge and dispute decisions are capped at what's left too. If a listed call's Charge amount is cut by the cap, say so: "Charge $X (the $1,000 limit for calls on this test)".
- **Small warning text** (grey/amber, no stop) wherever calls are requested, offered, accepted or paid, on both sides. It appears when what's left is under one hour at that tester's listed rate, or under $200 for a tester whose calls aren't listed: "$X left of the $1,000 for calls with Ana on this test." The tester's wording is "…for your calls on this test."
- **Tests** for each, including a mix of listed and unlisted calls.
- **Proof:** a recording of the warning appearing, then a booking refused at the limit, desktop and phone.

## 35. Code gaps found by the rule checklist (Oct 30, added later)
From docs/media/rule-checklist.json (status "gap"). Fix each with a test.
- **Build link:** `parseListing` accepts http://, but the message says https://. Require https:// and keep the message.
- **Invite rows' unmet needs** (`TAG_NAMES` in src/lib/inviteRows.ts): name 3 items, then a "+N more" that opens to show the rest (it currently shows 2, with an "or N more…" that can't be opened). Update invite-rows.test.ts.
- **Developer dashboard's Needs you:**
  - Include excerpt requests (Allow / Deny), not only in the restricted box.
  - Applications and rejoin asks link to their own row (`#item-…` plus the markJump highlight), not to `#needs-you`.
- **Live box:** a new dispute line links to its Needs you row, the same as its bell line.
- **Tester dashboard, Upcoming calls:** each row gets a Join button while the call is joinable (the same rule as the session page).
- **Admin "Your actions"** (`mine` in adminLists.ts): also list ACCOUNTS this admin suspended (per side, item 16) or deleted, not only tests.
- **A suspended admin loses admin access.** Login refuses them like any suspended account, and the console and every admin action refuse them ("Your account is paused."). Add tests.
- **A tester's call request makes a bell line for the developer** ("<name> asked for a call: <time(s)>"), stacked like the other request lines, as the doc says.
- **The admin's Stop takes the same test lock as the developer's Stop,** so a simultaneous developer Stop and admin Stop can't both run. The second is refused: "This test was already stopped."
- **Stale test names and comments** that describe old rules ("14 days", "$100 cap", "20 at a time", "the same again as extra pay"…): rename or update them to match what they check. Also fix the comments in suspended-and-ask.test.ts, restrictions.test.ts and design-misc.test.ts.
- **Leave alone for now (owner deciding):** the call Join window, invite-only tests in Find for invited testers, and Next round after a team stop.

## 36. Every stop-once box names the press first and ends with the action (owner, Oct 30, added later)
This applies on both sides, on every page: the test page, Edit, the session page, Payments and the dashboards. The box reads, top to bottom:
1. "Your <button> didn't go through." Use the button's own label: "Your Pay on Ana Silva's written answers didn't go through.", "Your Stop the test didn't go through.", "Your Save didn't go through.", "Your Send didn't go through."
2. "Since you opened this page:" and the list of changes.
3. The Alerts lines ("You can turn these stops off in Alerts…" / "Don't stop me for: …"). For testers, use the item 26 toggle wording.
4. Last line, bold: "Press <button> again to go ahead.", e.g. "Press Pay again to go ahead."

Refusals (not stops) keep their own wording, but also start by naming the press: "Your Pay didn't go through: <reason>." Re-record the stop-once scenarios to match.

**Also (Oct 30, added later), a proof:** a "tester-stop-once" group (desktop + phone): the tester has the session page open with a written answer typed; the developer pays another piece or edits the listing; Send stops once with the blue list; the second press goes through. Plus a still of a tester's Charge stopping once after the developer paid something, and a still with Alerts Off where Send goes through while a terms offer still stops it.

## 37. One rule for every pause, and one banner shape for pauses and stops (owner, Oct 30, added later)
**Any pause is treated the same**, whatever its cause: the team paused the test, a payment hold, a chargeback hold, or a developer-side suspension.
- The test page shows item 29's restricted view: the overview, plus Booked calls with Cancel.
- Only Stop the test, End early and Cancel call work.
- Stop and End early go through silently. Cancel call keeps its stop-once.
- Item 23's separate team-pause view merges into this. The only difference by cause is the banner's title and reason.

**The red banner, top to bottom, for paused AND stopped tests** (the team stop/pause banner the owner likes, generalised):
1. The title, by cause:
   - "The team paused this test." / "The team stopped this test."
   - "Your tests are paused until you pay what you owe."
   - "Your account is suspended: your tests are paused."
   - "This test is stopped."
2. The reason, in italics in a scroll box (item 20), when there is one.
3. The updates: the failed-press lines ("Your Save on <test> didn't go through.") and any other live lines for this banner.
4. At the BOTTOM, what's still allowed:
   - **paused (any cause):** "For now you can stop this test, end testers' work early, or cancel calls."
   - **stopped:** "You can still pay for work testers already sent, chat with them, rate testers, and read their answers." Add "and start a Next round" only when Next round is actually allowed. The owner is deciding about team stops, so build it from what is actually available.

Build the allowed line from the buttons actually shown, so it can never list something hidden. Re-record the paused and stopped banners (team, hold, suspension, own stop), desktop and phone.

## Check and report
- Migrations: `LoginAttempt`, `User.timeZone`, the stored "down" alert (or reuse `AppState`). Write them by hand and check them with the `prisma migrate diff ... --exit-code` command from BATCH-10. A stale Prisma client is then the only acceptable failure.
- Run `NEXT_DIST_DIR=.next-build npm run check` until it's green.
- Run the proof scenarios from PowerShell (`$env:ONLY="..."; node scripts/media.cjs`). Add them to `docs/media/report-manifest.json` under a "Launch fixes" section.
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md. Never use live Stripe keys.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed, the proofs made, the AT-HOME steps and any interpretations.
