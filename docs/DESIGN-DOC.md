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

**How this doc is organized:** one section per page, each listing what the page shows and how it behaves; section 2 holds rules shared by every page and section 11 the rules several pages rely on.

**Tags:** \[IN I\] = a photo goes here and \[IN V\] = a video goes here (xN = N different cases shown); \[update\], \[question\], \[future\], (?) are owner notes; \[SUGGEST\] = a proposed change or answer; \[AMENDED\] = how the app was changed to match this doc. Requirement, UI behavior, Open Question and Post-launch keep their usual meaning.

## 2. Every page

These rules hold on every signed-in page; page sections only add what's specific to them.

**Sign-in and accounts**

- Email + password sign-up, log in, forgot/reset (link works once, signs out every device), email confirmation (Resend); changing the password signs out other devices.
- A confirmed email is required before posting, editing, joining, applying, sending work, calls, paying, charging, inviting and rating; a blocked press says so under the button with Resend.
- Sign-in syncs across tabs [Owner, Oct 27]: signing out in any tab signs out every tab and window of the browser, and they all go to the sign-in page; signing in as a different account in one tab switches every other open tab to the new account, on the same page the new sign-in landed on (there is no cover screen); an old tab never sends a press as the previous account (every press names its account; a press racing the switch is refused and the tab then switches); Back/Forward restore and refresh.
- Dev or Tester’s account deleted by dev (or themselves on another device) should route all logged in pages to logout with a notice in red that their account no longer exists \[IN I\]

**Notices**

- Blue: a recoverable change, or a press that didn't go through because something changed; shown directly under the pressed button, which scrolls just enough into view.
- Red: a form mistake at the field (checked when the field loses focus and on submit), or an account restriction (suspended, deleted, appeal needed).
- Yellow: an attention list (e.g. broken access keys). Green: a confirmation.
- Block and Report [Owner, Oct 27]: they live ONLY on profiles (the tester profile on the developer side, the developer profile on the tester side); they are not on the find / test page, the session page or the Testers-panel rows. Block keeps its confirm dialog; its only stop is the race check. "Report <name>": a reason box and Send to the team; each person may report another person once per pair, ever (afterwards: "You reported <name> on <date>."); the only stop is the same race check; the reported person is not told; the admin sees it in the Reports list. The call's "Report a problem with this call" (no-show / late) is a different thing and stays on the call.

**Pop-ups** [Owner, Oct 26-27]

- Developer:
  - Stop ("Are you sure you want to stop…") and End early ("End their work now"): a confirm dialog with live blue notices inside while it is open (the 3 newest in the "Just updated" style, then "Show N more"). If the confirm press fails (unseen changes, or any refusal) the dialog closes and the blue notice sits under the ORIGINAL button, saying the press didn't go through and listing the changes.
  - Invite anyway: an inline box under Invite (not a dialog) with the same live notices. If the tickers' needs change while it is open it updates to list the new needs people don't meet and disappears when everyone meets them; pressing after a change shows the updated list with a blue "Your press didn't go through"; any other failure closes it and shows the blue notice under the original Invite button.
  - Block lives only on the tester's profile: a confirm dialog; its only stop is the race check (already blocked in another tab → a blue notice under the button).
- Tester:
  - Join anyway ("What this test needs"): checks the profile and the test again while open and updates ("Just updated"); it disappears when all needs are met (Join keeps its "You now meet this test's needs" line); pressing after the needs changed shows the updated list with a blue "Your press didn't go through"; any other failure closes it with the blue notice under the original Join button.
  - Leave, Let it go, Rate and finish: confirm dialogs with the same live notices and the same failure behaviour as Stop.
  - Block lives only on the developer's profile (same as the developer's).
- Both: Delete account (a confirm dialog, no stop-once). Report <name> (profiles only) is an inline reason box, not a dialog. There is no "signed in as someone else" screen any more: other tabs switch accounts (see Sign-in).

**Drafts, numbers, links**

- Unsent text is kept per person and form (written answers, chat, dispute text, rating comments, reject reasons, Post/Edit) and returns with "Not sent yet"; never on login or sign-up.
- Numbers use thousands separators; money being acted on is always exact; big stat tiles abbreviate: under 10,000 in full, then k, M, B, T, then × 10^N, no trailing .0.
- Every box with a minimum or maximum shows its range next to it ("10–180 min", "at least $1.00").

**Restrictions on every page**

- Suspended developer: routed to the dashboard top, which names the press that failed and explains the suspension and appeal (Contact us in Settings); Post a test and Messages are closed; tests are paused. The dashboard top banner reads: "Your account is suspended: your tests are paused. You can still cancel calls, end a tester's work early or stop a test. Paying and reviewing work wait until the suspension is lifted." On a test page only Cancel call, End early and Stop the test work (with or without a payment hold). Pay and Reject are hidden everywhere (the test page and the Payments page's "Waiting for your review" list) and refused if pressed; a suspension is not a payment hold, so nothing is recorded.
- Suspended tester: routed to the dashboard top with the same explanation; removed from all tests; Find tests, profile editing and Messages closed; Contact us stays open (Settings without the profile editor).
- Deleted account: red notice and logout on every open tab.
- Payment hold (only; not a suspension): all the developer's tests paused; Pay what you owe on every test and Payments, and only during a hold (a suspension alone never shows it). Pay and Reject still work during a hold: Pay is recorded and the charge waits. A chargeback hold adds the card check and the admin's approval (see 11.2). Whatever the cause, a paused test closes after 7 days (see 11.1).
- Pay and Reject on sent work are available any time until the tester presses Charge or Let it go, unless the developer is suspended: after Open until, and after a test was stopped or closed. [Owner, Oct 26]

**Outages and mobile**

- When outage checks are on, a gap over 15 minutes moves every running timer later and cancels calls inside it with no fault; everyone affected is told once.
- Every core workflow works on mobile; panels collapse into folds.

## 3. Developer dashboard

One place to see every test, what needs action, and the developer's own numbers.

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
- A paused test shows no countdown on the pages (the bell is enough; the admin keeps the dates in its lists). A test closed by its pause says so on its card and page. A developer on a chargeback hold sees the three steps (card verified, what is owed paid, the team's approval) at the top instead of the plain hold box. [Owner, Oct 26]
- Test cards and links must respect account permissions and current test state. (Don’t allow navigating to tests while they have suspension).
- Banner at top shown while suspension happened warning the dev about all terms \[IN I\]
- &#91;SUGGEST\] An "Upcoming calls" list (next 7 days) with Cancel, usable during a suspension.

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

&#91;update\] add no graphic, etc. content to terms and elsewhere

&#91;SUGGEST\] Terms of Use and a line under the Mature box: no sexual content involving minors, no illegal content, no real-world gore; graphic content must be marked Mature.

**Deliverables (parts)**

- Written report (questions, each required or optional), Recording (with think-aloud), Live session (calls).
- Each part is a card with its tick, price (calls "up to $ /h"), a Free tick and a Required tick. Required is a label only: it blocks nothing, and is shown on the listing, in testers' terms, on their session page and on the developer's tester rows.
- Free parts are clearly marked before a tester commits.

**Joining methods**

- Anyone can join: join at once while open with spots; first come, first served.
- Approved only: testers apply; the developer accepts or declines.
- Invitation only: not in Find; only invited testers join.
- Any method can also invite; an invite plus a pending application or rejoin ask joins the tester at once unless a final refusal applies.

**UI behavior**

- Top of the form mentions \* as required fields \[IN I\]
- Product (60 characters limit), Name of this test (60 characters limit) and What to do (1000 characters limit) are textboxes with Name of this test and What should testers do required (red highlighted box and warning underneath) \[IN I\]
- Link to the product or build \[future\] block Private/internal network address based urls, use Google's Web Risk to validate URLs for threads such as malware and phishing, and warn about password-protected archives
- The creation form validates required fields and incompatible settings (How long do new testers have? field (their deadline) is not less than 3 total days from the open until date, open number of testers being greater than number of spots open and if the test has access keys, there must be at least as many access keys as open spots). Validates these with red warning under fields after on click and clicking away from the fields in invalid state \[IN V\] \[IN I\]x2
- The developer sees the configured parts, prices, tester capacity, deadlines, and joining method before publishing. \[IN I\]
- Publishing creates an active test and makes it discoverable according to its joining method.\[IN V\]\[IN I\]x2
- Race conditions of dev saving the test from a different device or tab is noted under Save after pressing it where it mentions save happened somewhere else and they need to press it again to go through. Fields that the dev updated in the other page are updated here and fields that didn’t remain updated on this tab. \[IN V\]
- Spots can't exceed the developer's tester limit (starts at 10 per test, grows with good ratings, max 50); the limit shows under the field.
- &#91;SUGGEST\] Large totals confirm before posting: "Up to $8,000 could be charged if all spots send everything."

## 5. Edit test

Edits update the listing for new testers and are offered to current testers, who choose to Switch or Keep; Post's rules still apply.

**Terms and offers**

- Each tester's terms (work, parts, prices, Required labels, deadline, requirements, NDA) are fixed when they join. Edits apply to new testers; working testers whose own terms would differ get an offer at the top of their session page: Switch to the new terms or Keep. Work already sent keeps its price. Repeated saves replace a waiting offer with the newest.
- The developer sees offer results (who switched or kept) under Save, on tester rows and in the Pay box.
- The developer can change the critical test fields 3, 4, 6, 7, 8 and 12 up to 3 times (after that, editing those fields and saving doesn’t work with a red highlighted field \[question\] field or box? warning with “Contact support” mentioned \[update\] \[IN I\]
- &#91;SUGGEST\] The count starts once the first tester has joined; each field that changed is outlined red, with one line under Save: "You've changed the instructions, link or parts 3 times since testers joined. Contact support to change them again."
- Save is faded and does nothing when no field changed.

**UI behavior**

- Existing tester deadlines can only be extended when the developer changes the deadline for new testers (shortening deadlines only applies for new testers and is ignored). Trying to lengthen the deadline past less than 3 days from when the test’s current open until date (measured from the test opened date) is not allowed with a red warning and \[update\] mentions when they can extend the Open Until date to allow it. \[IN I\]
- &#91;SUGGEST\] The red line reads: "Extend Open until to Nov 12 or later to allow a 10-day deadline."
- Only extending the recruitment period (Open Until) date is allowed with a red warning underneath if shortened \[IN I\].
- Live updates from every page's rules appear at a blue notice box under the save button at bottom of page. \[IN I\]
- Red warning from Post Test are still shown where applicable including leaving making required fields like What to Do blank, trying to save access keys under the number of open spots (fields can have both red warning and blue notices) \[IN I\]x3
- Updating a test while any new changes happen triggers a blue modal notice (live and on press) under the blue save notice box and. Race conditions with the dev updating this in another tab or device are also mentioned (in order of which updates happened first) where it mentions save happened somewhere else and they need to press it again to go through. The specific fields that were changed in another place are updated and have blue notices under them mentioning what changed (with expand arrows for long changes related to access keys) \[question\] do other fields need this? Fields that didn’t change in the other place remain updated on this tab. It’s especially important for access keys to  \[IN I\]x3\[IN V\]
- &#91;SUGGEST\] Yes for every field changed elsewhere, with an expand arrow only when the change is over two lines (keys, questions, instructions).
- An admin stopping this test for any reason should send the dev back to the test where it mentions save failed if they tried \[IN V\]

**Access keys**

- Access keys are now shown in separate In Use (read only) and Free (where you can add new keys or remove keys as long as the total number of free keys is greater than or equal to open spots) boxes. Free keys are assigned to new testers first and only assigned to current testers if there are extras (still enough for open spots). Testers can report access keys as broken. Keys not working are greyed out and crossed out and when the dev assigns extras or they are automatically assigned, those disappear from the In Use box. If a tester with a broken key leaves the test, the in use key disappears but can later reappear if the tester confirms the key is still working before joining.
- The In Use access keys box is dynamically and automatically updated live and after changes happen from other places.
- Using access keys that are already in use, or given out to previous testers who left the test (even if still working) are not allowed. Using previous ones reported as broken also gives a red warning \[IN I\]x2

## 6. Developer test page

The central place to run one test: what changed, what needs action, who is in it, calls and invites.

**Panels and buttons**

&#91;update in order and other parts\]

&#91;SUGGEST\] Order: overview (terms, status, Open until · Change, buttons) → live updates box → yellow broken-keys notice → Needs your attention → Testers → Live session → Invite testers → By question.

- Test overview panel: Current terms, status, deadlines, and recruitment information \[update\] with current look \[IN I\]
- &#91;SUGGEST\] "Current look" = the full site's header: title, status pill, who-can-join badge, category, part and deadline badges, keys-left badge, Open until · Change at the right.
- Testers panel: Current testers, their status, which contract are they on (did they accept recent changes from the dev), submission and payment history (how much has been paid and did any payments recently fail), and rating information \[IN I\]
- Needs your attention panel: Submissions requiring review and other pending decisions. \[IN I\]
- Live sessions: Proposed times, requested calls, confirmed calls, and cancellations. \[IN I\]
- Invite testers: Search for testers, review their profiles, and send invitations. \[IN I\]
- End early button: End participation for a specific tester where permitted. \[IN I\]
- Next round button: Start a new test round using the current test as a template. \[IN I\]
- Alerts filter button: Configure which update notifications interrupt sensitive actions. \[IN I\]
- Stop the test for all candidates with a reason sent out to everyone, preventing the dev from inviting new candidates, and canceling and accepting/rejecting parts or calls and making requests (all previous calls are canceled). Edit, Next round, End early and Stop disappear and for testers from sending further parts and booking calls (dispites and excerpt requests are still allowed). \[IN I\]x2

**What each panel holds**

- Needs your attention: every Pay/Reject for sent parts (one box, reason next to Reject, one press, "Paid so far"; the box starts at the listing, or the call's agreed rate × length, and the developer may pay more), applications (Accept/Decline), rejoin asks (with the time they'd get back), call requests waiting for an answer, calls waiting for a length or Pay, disputes waiting for the developer's side, broken-key reports.
- Testers: the avatar row (about 12 circles then +N, hover card with rating, accepted parts, profile link and Chat; Block and Report are on the profile), then a scroll box of tester rows with a name search: required and not-required parts sent, paid per part and in total, contract version (switched or kept), call summary, "History (N)" fold (terms versions, offers, payments); "No longer working (N)" fold below.
- Live session: the rate line; tick testers (each with terms and "N of 3 booked") or Select all; request form (up to 3 time rows, each Once/Daily/Weekly with 2–8 calls or Forever; one typed length 10–180 min); waiting requests (Accept/Decline/Withdraw); booked calls (timer, who's in the room, Add to calendar, Cancel ▾; Join from 10 min before to 30 min after); after a call: log length (measured minutes, up to 150% of booked, within 24 h), Report a problem (No-show / Late); Past calls with who joined and outcome.
- By question: each written question with every tester's answer, time, "not required" mark and Paid / Rejected / Not reviewed yet.

**Invite testers**

- The invite panel has people you’ve worked with before at the top, suggested (with people who have matching language and tech requirements with the most number of them and highest ranked sorted to the top) \[question\] algorithm and has “in tests with you” with a drop down on tester rows under People you’ve worked with that shows number of tests and links to them underneath. Tester’s who don’t have test requirements show the missing requirements in orange labels on their rows. Shows greyed out rows with “Can’t join this test” for testers who are suspended or in 10 tests \[IN I\] x2 Open Question: Should we allow for more than 10?
- &#91;SUGGEST\] Algorithm. A tester *meets* the test with one required device and one required language (where any are required). *Score* = (3 × platform average + their stars) ÷ (3 + their ratings), so new testers start near average. *Invitable* = not in the test, not invited, under 10 tests, not paused; blocked or deleted testers never appear. Worked with: invitable first, then your rating of them, tests together, most recent. Suggested: top 5 invitable newcomers to you, filtered by the device/language ticks, by meets, score, accepted parts, matches. Find testers: name search plus ticks, invitable first, then meets and score.

**UI behavior**

&#91;update\] handle abbreviations everywhere and

&#91;SUGGEST\] Every number on the page uses the shared format (section 2); stat-like counts abbreviate, money being acted on stays exact.

- Under the test overview panel is the blue modal with live updates from all mentioned in section 2 \[IN V\]
- Under the overview panel (below live updates modal if both are up) is a notice in yellow listing all testers with access keys not working \[update\] needs expand box? And which all need expand boxes and other high limit UI
- &#91;SUGGEST\] The yellow notice shows 3 names then "Show N more"; the same 3-then-expand rule applies to the live box, stop boxes, Needs you and Invited; Testers, worked-with, Find results and Past calls are scroll boxes about 6 rows tall.
- All the panels are drop downs. Needs you also has drop downs for each person and their sent parts. Becomes a scrollbox for more than 3 items listed \[IN I\]x2
- &#91;question\] which all sub forms and devs may get excerpt requests which also appear in needs you where they can approve or reject testers using tests \[IN V\]
- &#91;SUGGEST\] Excerpt requests appear in Needs you as their own item (Approve / Deny); sub-forms inside Needs you are Pay/Reject, application, rejoin ask, call request, call length and dispute side.
- In the live sessions panel they developer can make \[SUGGEST\] requests, accept/decline/withdraw, cancel, log lengths and report problems as listed above.
- Race conditions of accept/rejecting parts from needs you, booking/cancelling and requesting calls, and inviting people and the live updates from section 2 are shown under the buttons of each panel \[IN V\]\[IN I\]x3
- If test was stopped normally it just shows “Stopped” in the top panel. \[IN I\].
- If test was stopped by an admin redirect to the top of the test overview panel where it permanently shows banner that admin stopped the test and any button presses that failed. Normal test stopped rules apply afterward. \[IN V\]
- Race conditions of stopping the test at the same time as an admin to be accounted.
- The top banner mentions if the test was paused by an admin (behaving like a stop). If the dev still has access to it in this case (wasn’t suspended) they can only stop the test \[IN V\]
- &#91;update\] Open question: what changes to all limits etc.
- &#91;SUGGEST\] Limits live in one table (section 11.5); any change there is announced to developers in the bell and on affected fields.
- Invite rows must be ticked to invite (typing never invites); "Invite anyway" confirms when a ticked tester misses a need and updates live (if everyone now fits, it closes with a blue line under Invite); the Invited list shows only waiting invites with Cancel invite; "Left this test" / "You ended their work" show beside those names; new invites are refused while the test is full; invitations close when the test or developer becomes ineligible and may be reissued when restored.
- End early: tick one or more testers (with All), one reason they read, confirm pop-up; their upcoming calls are cancelled; their work, payments and disputes stay.
- Next round: creates a draft copy with an updated round label; nothing goes public until published; records stay with the original round.

**Linked UI**

- Any actions the dev makes here should propagate to testers (tester session page and join page).
- The dev inviting testers should change their join page (section 7).
- The test becoming full or empty based on inviting new testers or ending it early for current testers changes tester’s dashboards based on if they previously visited the test, and reveals the tests in Find Tests to new visitors.
- approved / reject excerpt only on notification bell \[update\]
- &#91;SUGGEST\] Excerpt decisions reach the tester only as a bell line; the developer's Needs you item disappears once decided.

**Chat from a tester's hover card and profile; extra pay** [Owner, Oct 26]

- "Chat with <name>" sits on the tester's hover card (the avatars on the dashboard) and on their profile (developer side). It opens the same per-test chat as the Testers panel's Chat button (on a profile: the chat of the most recent test they share). If a block exists either way, or the chat would otherwise be refused, the press shows a blue notice "Unable to chat with this tester." (no reason given). The button is hidden where there is no shared test.
- **Extra pay** [Owner, Oct 27]: next to each SENT part in a tester's list in the Testers panel (current and past testers; unsent parts have none) there is an amount box and **Pay**, with "Paid so far for this part: $X" and "up to $Y". It pays that tester above the listing for that part: same 80/20 split and charge path; the tester gets a bell "<developer> paid you $X extra for <test>" (a payment line that does not stack); it shows in the developer's Payments history and the tester's payouts. Everything a developer pays a tester ABOVE the listing prices (a normal Pay above the listing, plus extra pays) may total at most 100% of that tester's current contract total (the current part prices plus the agreed totals of their booked and held calls), so they can never get more than double; the server refuses more (the percent is one constant). Any Pay box (part Pay or extra pay) over $200 shows the tick "I understand this payment can't be refunded and is charged now." every time and is refused until ticked. Same refusals as Pay: hidden and refused while suspended; "Pay what you owe first." while a failed payment is owed or on a hold; refused when blocked either way; the stop-once rules apply.

## 7. Tester dashboard, Find tests and the join page

Testers see what to do next, find relevant tests, and join on clear terms.

### 7.1 Tester dashboard

&#91;update\] Tester Dashboard

&#91;SUGGEST\] Built like the developer dashboard:

- Stat tiles: Earned, Waiting for review, Rating, To do.
- **Charge or cancel:** a scroll box listing each test with parts past 14 days unreviewed ("Harbor Run · 2 parts"); each row links to that test's session page and scrolls to the part, where Charge / Cancel (Let it go) are pressed.
- To do (parts not sent yet, with deadlines), Waiting for the developer, upcoming calls, invitations (Accept opens the join page; No thanks), New tests for you, History.
- Tests the tester left or was removed from (before their deadline, not stopped, not rated) show Ask to rejoin; suspension removals sit at the top with a "Suspended" label until they rejoin or dismiss it.
- Payout problem banner when a payout fails (section 9).

### 7.2 Find tests

- Each listing shows product and title, categories, required languages and devices, spots left, price per part, joining method, Open until and the individual deadline.
- Open public tests are listed; invite-only only through invites; paused, closed, full, deleted or stopped tests are not joinable and don't appear as such.
- Most relevant first: tests needing a device the tester has, then tests open to any device, then the rest, newest first within each; each card lists every unmet need.
- Tests the tester left show "You left this test".

### 7.3 Join page (listing)

- Offers Join (anyone), Apply (approved only), Accept invitation / No thanks (invited), Ask to rejoin (left or ended before their deadline), or a reason it's unavailable (paused, closed, full, stopped).
- Layout follows the full site's listing (product, price block, badges, how it works, the developer's stats), without any offer or price-ask area.
- Joining checks requirements, spots (atomic: two people never take the last spot), Open until, NDA acceptance and the 10-test limit (also for applying, accepting invites and asking to rejoin).
- A missing device or language opens a "Join anyway?" pop-up listing every unmet need; it updates live as the profile or the test changes and closes with a blue "You now meet this test's needs" line under Join when everything fits.
- Live top box and stop-once on every button for every test change except spots (only when it's now full) and Open until (only when it passes); a title change is info only.
- Invited testers see the invite; an invite after leaving shows Join on their old session page too.

## 8. Tester session page

Everything a tester does inside one test: see their terms, send work, run calls, get paid, leave or rejoin, rate.

**What it shows**

- Terms and product link, deadline with a countdown under 24 hours, any access key (with "This key doesn't work"), NDA accepted date.
- A Switch / Keep offer at the top whenever the developer offers new terms.
- "Your parts": each part's Required / Not required, in or not in their contract, sent or not, "Paid so far $Y", and status (draft, submitted, under review, accepted, rejected, paid, payment delayed).
- Each part panel repeats its term at the top ("Written answers: $8 · Required").
- Chat with the developer opens its own page (unread count on the button).

**Actions**

- Send written answers or a recording ("Send my answers" / "Send my recording", then "Send my updated answers" / "Send my updated recording"); there is no "Ask $" on sends or call requests (removed, Owner Oct 26: old asks stay in the database, unused); sending after the deadline is allowed and labelled "Sent late".
- Live session panel (same as the developer's, tester side): their rate ("Live call: $40/h"), Request a time (up to 3 rows, Once/Daily/Weekly with 2–8 calls or Forever, one length, optional Ask $/h), Accept / Decline / Withdraw requests, booked calls with timer, presence, Add to calendar, Cancel ▾, Join (10 min before to 30 min after), Past calls; they see the length the developer logged and why.
- Charge or Let it go on contract parts left unreviewed 14 days (up to listing minus already paid for that part, typed amount); reminders every 3 days; works after leaving too.
- Dispute a rejected or underpaid contract piece once.
- Leave (in its own "Can't finish?" card, confirm pop-up): calls ahead cancelled; history and pay stay; the page stays with live updates.
- Ask to rejoin after leaving or being ended before the deadline (not after a stop or rating); the developer accepts; the session comes back on the current listing with the time they had left.
- Rate the developer once everything sent is decided or past 14 days and no dispute is open; the warning lists unsent contract parts (required ones marked) and that upcoming calls are cancelled; no rejoin afterwards.
- Block and Report the developer: on the developer's profile only.

**UI behavior**

- Live top box and stop once on every button for every test change except spots and Open until, developer payments or rejections, call changes, and their own actions in another tab; Leave and Block stop only once.
- During a pause (hold or developer suspension), testers see only "This test is paused…": sending works, calls and joining don't, Charge and Dispute wait, Let it go, Leave, chat and Rate work.
- Testers never see the words "failed", "hold", "chargeback" or "suspended" about the developer.

## 9. Shared pages

Pages both sides use, each with its own behavior.

**Header and side switch**

- One account can be a developer, a tester or both; the header has a switch between the two sides, each with its own nav, dashboard and pages; shared pages (messages, notifications, payments, profile, settings) belong to neither. A link to the other side's page switches sides and goes there. Each tab shows its side.

**Public profiles**

- Developer profile (as testers see it): Pays on average, Typical review, Rating ("4.6 ★ (12 ratings)") and comments without the rater's name.
- Tester profile (as developers see it): Accepted parts ("N of M sent · N sessions with accepted work") and Rating; bio; devices and languages.
- The developer's own Profile also shows the tester-limit card ("Can take up to N testers per test · Next: +10% after N more ratings").

**Profile and settings**

- Name, pronoun, bio, devices and languages (testers), developer/tester sides; change password; email preferences (each, daily, weekly, monthly, off; payment receipts always sent); Contact us (emails the admin team); delete account.
- &#91;update\] (owner note) remove download my data from dev settings. \[SUGGEST\] Removed; data requests go through Contact us.
- During a suspension: Contact us stays open; the profile editor is closed for testers.

**Messages**

- One chat per tester per test, only between the developer and testers who are or were in the test; unread counts on the Chat buttons; read-only for suspended accounts.

**Notifications (bell)**

- Developer bell lines: a tester joins or accepts an invitation; leaves; submits a part; books or confirms a call; cancels a call; files a dispute; an admin decides a dispute or confirms a disputed charge; a payment fails or a retry succeeds; a hold lifts; a tester's rating moves a whole star; a tester reports a key not working.
- Tester bell lines: invites and reminders (every 3 days, with No thanks), paid / rejected / delayed, new-terms offers, call booked or cancelled, rating available, dispute decisions, test paused or resumed.
- Call requests are not bell lines. Same-day lines about the same test stack into one expandable entry, EXCEPT these, which always arrive as their own line: admin decisions (disputes, suspensions, reinstatement, pause extensions), a test being stopped, payment failures and holds starting, a hold or pause being lifted, and a chargeback. For admins, dispute lines about the same test stack per day. [Owner, Oct 26]
- Every bell line opens the exact place. Developer: the test page at the item (a Needs you row, a tester row or a call). Tester: the session page at the part (written answers, recording, live call) or the call. Admin: the dispute row or the account. [Owner, Oct 26]
- Reminders (bell) [Owner, Oct 26]: developer, unreviewed contract work: one reminder 1 day before Charge would open, then daily once it has opened, until paid, rejected, charged or let go (all of a day's stack into one line across parts and tests). Developer on a payment hold: one line a day, "Your tests are paused until you pay what you owe" (link /app/payments#owed), its own line; a declined retry the same day is merged into it. Developer with applications or rejoin asks waiting: a line a day, stacked with that test's other same-day lines. Tester invitations: a reminder daily until answered, all of a day's stacking into one line across tests. Tester Charge or Let it go: reminders every 3 days, all Charge lines of a day stacking into one line across tests. Rating prompts: while the test is open they stack with that test's same-day lines; once it is closed each is its own line, with a reminder every 3 days until rated or the window ends. Admins: one line a day for all suspended accounts. Every reminder tied to a test waits while that test is paused and restarts when it resumes.
- Stacking changes [Owner, Oct 26]: a tester's payment lines (paid, rejected, delayed, delayed payment arrived) do not stack; their test paused / resumed lines of one day stack across tests; payout-problem lines stack into one a day; admins' new-dispute lines of one day stack into one line across tests (link #disputes). The team paused, stopped or closed your test (including a pause closure): the developer's lines stack into one line a day across all tests (their emails stay always-send).
- Email [Owner, Oct 26-27]: Off, or On with Daily / Weekly / Monthly (the per-update option is gone; those people moved to Daily). Nothing is emailed right away: every email is ONE email listing everything since the last one, and each notification is emailed at most once. With email On, payment lines (failures, holds, retries, paid, rejected, delayed, payouts, chargebacks, developer receipts, the tester's "You were paid…") also go out in an end-of-day email even on Weekly or Monthly, holding only those lines; the rest wait for the normal email. Off sends no payment line. FINAL list of what ignores Off: (1) email confirmation and password reset (sent right away); (2) the daily "Pay $X by … or your tests are paused"; (3) "Your account is paused" / "Your account is active again"; (4) the team pausing, stopping or closing your test (including a pause closure). Items 2–4 go in ONE end-of-day email (not right away); with email On they ride in the normal end-of-day payment email or summary. Admins: a chargeback emails right away whatever the setting; new reports follow the admin's own email setting like a normal notification; each admin also gets the daily admin email below.

**Payments**

- Developer: card on file; a "Waiting for your review" panel listing every test with unreviewed parts and a Pay button to that test's Needs you (hidden while the developer is suspended, with a line saying paying and reviewing wait); "Pay what you owe" during a payment hold only; receipts and history; paid so far per part.
- Tester: payout setup (Stripe), earnings and statuses; on a payout failure a banner "Your bank couldn’t receive a payout. Update your payout details." with a button to Stripe and a bell reminder every 3 days until fixed (money stays in their Stripe balance).

**Call page**

- "Call with Ana · booked for 60 minutes (paid up to 90) · the length is measured while you're both here", the embedded room or a link, the timer and presence; closes when the call is cancelled, blocked, or 24 h after its start.

## 10. Administrator console

Admins see every account (deleted too), act on suspensions, tests and disputes, and every action is audited.

- **Accounts:** profile and status; test history (live, stopped, paused); reports; suspensions with reason, time and admin; disputes; ratings; payments and balances; work submitted, reviewed and paid; participation including testers who left; deletion status and reason (owner- or admin-deleted).
- **Suspensions and tests:** suspend and lift with a recorded reason; pause, unpause and close tests; preview a suspension's effects; held tester shares (refund or release).
- **Paused tests:** every paused test (any cause) with its closure date and countdown, **Extend** (days) and **Close now**. **Chargeback holds:** each developer with "card verified ✓/✗, owed paid ✓/✗" and **Approve**. The suspension and dispute tools stay as they are. [Owner, Oct 26]
- **Dashboard layout** (like the developer and tester dashboards), top to bottom [Owner, Oct 27]: Open disputes (disputes only, newest first, in a scroll box); Lifts (a separate scroll box, newest first: one row per payment hold from the 4th onward whose developer has paid what they owe, showing the developer, the label "More than 3 holds" (never the exact number outside the profile totals), what was owed and when it was paid, a note box and Approve; first press wins); Chargeback holds (their own section and Approve); the tests this admin paused or stopped or whose developer this admin suspended (a scroll box); Paused tests with Extend and Close now; then the rest (Reports, No-show reports, accounts ...). Long lists are pages of 25 with Previous and Next under each (keyset by date) and "1–25 of N"; pressing one replaces only that list's rows, with no page reload. Rows link to the profile or test page they are about.
- **Admin-only boxes** [Owner, Oct 27]: on a person's profile, scroll boxes (newest first, pages of 25) for payments, payouts, disputes, chargebacks, holds and suspensions (dates and which admin acted), tests posted or joined, and reports against them; at the top a totals line (total spent for a developer / total paid out for a tester, and the numbers of reports, disputes, chargebacks, holds and suspensions); testers also get a box of their sent parts across tests with totals. On a test's own page: a timeline, the contract changes (the terms each tester joined on, and offers) and the payments. Never shown to anyone else. (The per-test History view was removed.)
- **Reports:** a list next to No-show reports (pages of 25): who reported whom, the date, the reason, links to both profiles. Admins get a bell line per new report, stacked one a day with the new-dispute and lift lines. **Label:** an account reported MORE than 3 times (profile reports plus call no-show / late reports) gets the label "Reported more than 3 times" on its name in dispute, report and lift rows and in the admin bell lines for them; never the exact number there (the count stays in the profile totals line); admin only.
- **Reports:** reason and status per account; accounts with more than three reports are flagged when a new one arrives; a report count is never proof by itself.
- **Disputes:** see submissions, payments and terms; the decision row shows listing, paid for this piece, paid for this part so far and the allowed range (from what was paid to listing minus what was paid on other pieces); blank keeps the pay; decisions and reasons are recorded and both sides told.
- **Notifications:** Contact us emails the admin group; a chargeback emails the admins right away; ONE daily email per admin that can't be turned off, to the admin's own account email, sent only when it has something: new disputes, lifts waiting, chargeback holds waiting for Approve, call (no-show / late) reports once, the accounts THIS admin suspended that still have paused tests (each with its paused tests), and the tests THIS admin paused that are still paused (each with its closing date); each item links to the profile or test; a paused test drops off once it closes (7 days, or later if extended) or resumes, a suspended account once none of its tests is still paused. It replaces the env-list admin daily and the 3-day digest (failed payments, holds and payouts need no action from the team: only the admin page shows them). A daily bell line reviews all suspended accounts; muting is post-launch.
- **Admin accounts:** proper authentication; a suspended admin is blocked from login and sessions and sees how to appeal.

## 11. Rules the pages rely on

The lifecycle, money, rating and restriction rules referenced above, plus every limit in one table.

### 11.1 Test lifecycle and deadlines

- States: Open (join, submit, review), Paused (admin or account restriction; no new commitments; records kept), Closed (developer stop, admin, deletion, or long pause; history stays), Draft (an unpublished next round).
- A tester's deadline starts at joining; existing testers keep theirs when the default changes; it's a guide (late work is labelled "Sent late").
- Open until is the recruitment cutoff; it can only be extended, before it passes.
- Unreviewed contract work [Owner, Oct 27]: a contract part sent and left unreviewed opens for Charge / Let it go at the LATER of 14 days after sending and the test's Open until (a stopped or closed test still waits for its Open until). With no Open until it opens when the test stops or closes, or the tester's work ends (they left, their deadline passed, or their work was ended early). The tester's reminder is every 3 days after it opens; the developer's are 1 month, 1 week, 3 days and 1 day before it would open (skipping any already past), then daily once it has opened, stacked together. Outage and hold time shifts still apply. Rating uses the same opening point; nothing is charged automatically.
- Paused tests: **a paused test closes automatically after 7 days, whatever the cause** (a payment hold, a chargeback hold, the developer's suspension or the team's pause); the pause counts from the earliest cause still in force. The daily job closes it and closing works like Stop: testers' work ends (what they sent is still reviewed and paid), calls ahead are cancelled, requests, invites and applications close. Testers are told neutrally that the test ended (never why); the developer is told why (the test page, the bell and an email). The admin can extend a test's closure date (a number of days, valid for the current pause only) or close it sooner (Close now). This replaces the old 30-day admin alert. [Owner, Oct 26]
- The pause is told by bell: one line when a test is paused ("Harbor Run is paused and closes on Nov 2 unless your account is cleared") and one a day before it closes. The admin's Paused tests list shows each date with Extend and Close now. Testers only ever see "This test is paused". [Owner, Oct 26]
- Open Question: Which rule should be authoritative? Finalize the relationship between the individual deadline, the three-day buffer, the two-day late-joiner extension, and the maximum recruitment period before implementation.
- Open Question: Can developers shorten an individual tester’s deadline if they provide at least 24 hours’ notice before the existing deadline?
- Open Question: What should happen to unreviewed work when a test closes automatically?

### 11.2 Money

- Pay: one box per piece (amount starts at the listing, or the call's agreed rate × length; the developer may pay more; reason required to Reject); charged at once; nothing shows success before the result.
- A declined charge becomes owed: daily retry, 3-day pay-by date; a second failure or a missed cut-off starts a payment hold that pauses all the developer's tests until they pay what they owe (that box pays exactly what it shows).
- Chargebacks: **a hold with extra steps** [Owner, Oct 26]. A chargeback puts the developer's account on a payment hold (all tests paused, as for a failed payment). To lift it they must (a) re-verify a card with 3D Secure (a Stripe SetupIntent with payment_method_options.card.request_three_d_secure = "any"; in fake / dev mode with no Stripe it is simulated as a success), (b) pay what they owe, and (c) get the admin's approval. Paying alone never lifts a chargeback hold; the developer's banner (dashboard, Payments, every test page) lists the steps with a tick or cross and says which remain. The admin sees "Chargeback hold: card verified ✓/✗, owed paid ✓/✗" with an Approve button, which works only when both are ✓; approving closes the chargebacks and lifts the hold. A new chargeback clears an earlier card check. While the hold lasts, paused tests close after 7 days like any other pause.
- The owed window [Owner, Oct 27]: after a declined charge and before the hold, the developer gets a DAILY "Pay $X by <date and time> or your tests are paused" (one line across all owed payments, stacked with that day's other lines; its email goes even with email Off). While ANY failed payment is owed, the developer's Pay buttons (part Pay, extra pay) are disabled with "Pay what you owe first." and only Pay what you owe works; Reject still works; the tester's Dispute and Charge buttons on that developer's tests are disabled (testers read "delayed", never "failed"). After the 3-day cut-off the automatic daily retries stop: the hold starts and the developer pays through Pay what you owe.
- Payment holds count [Owner, Oct 27]: after a developer's 3rd payment hold, every later hold needs an admin's Approve to lift, even after they pay what they owe (the admin sees it as a row in the Lifts box labelled "More than 3 holds"; the Payment holds list shows that label on a row only when it applies; the exact count is only in the admin-only totals line on the profile). The developer's banner says the team will review it after they pay.
- Price caps [Owner, Oct 27]: written answers and recordings $1 to $1,000 each; live calls $10 to $200 an hour. Post and Edit show the min–max hint and turn red on blur; the server refuses too. A written or recording price over $200 needs the tick "I confirm this part pays more than $200." when it is created over $200 or raised from at most $200 to over it (not when an already-saved price over $200 is unchanged).
- Charge cap: listing minus what's already paid for that part. Dispute range: from what this piece was paid to listing minus what was paid on other pieces.
- A suspended tester's pay is charged but their share is held until reinstatement (admin refunds or releases if never lifted).
- No upper price caps except Stripe's per-charge maximum; minimum $1 per part, $10/h per call (or free), $0.50 smallest charge.
- Testers only ever see "delayed", never "failed", "hold" or "chargeback".
- Open Question: Is a 10-day refund period technically and commercially appropriate given the payment provider’s rules, the platform’s payout timing, and the possibility that tester funds have already been paid out?
- &#91;SUGGEST\] Fraud exposure: invite developers by hand at launch, lengthen tester payout delay, and add a new-developer spending limit or prepaid budgets before public developer sign-up.

### 11.3 Ratings

- Testers rate the developer when everything they sent is decided or past 14 days and no dispute is open; rating ends their participation (Charge, Let it go and Dispute stay).
- Developers rate a tester after the tester has rated, within 14 days (a Needs you item); both ratings reveal together, or the tester's after 14 days.
- 1–5 stars plus an optional comment shown without names; only real participation counts.

### 11.4 Restrictions and deletion

|  | Payment hold | Developer suspended | Tester suspended |
| --- | --- | --- | --- |
| Developer's tests | Paused | Paused | — |
| Developer can | Pay and Reject (the charge waits), Pay what you owe, cards, Payments | Cancel call, End early, Stop the test, cards, Contact us (no Pay, Reject or Pay what you owe) | — |
| Testers in the test can | Send, Let it go, Leave, chat, Rate | Send, Let it go, Leave, chat, Rate | Removed from all tests |
| Waits until lifted | Charge, Dispute, calls, joins | Pay, Reject, Charge, Dispute, calls, joins | Pay for their work (share held) |
| On lifting | Tests resume; testers told "resumed" | Tests resume; same | Re-invited where open with spots; others listed with "Suspended" and Ask to rejoin |

- Calls starting within 3 days of a suspension are cancelled with no fault.
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
| Part price | at least $1.00, or free; no maximum |
| Call rate | at least $10/h, or free; no maximum |
| Any charge | $0.50 to $999,999.99 |
| Call length | 10–180 min; logged up to 150% of booked |
| Call requests | 3 time rows; repeats 2–8 or Forever; per tester 3 booked times and 3 waiting requests |
| Tests per tester | 10 at once |
| Recordings | 500 MB each, 5 per session |
| Text | rating comment 500, dispute 2,000, bio 1,000, contact 10–3,000 characters |
| Critical field changes | 3 after the first tester joins |

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
