# Playtest Platform, lean launch version: build spec (owner decisions, Oct 22, 2026)

A fresh, simple rebuild of the core of Playtest Platform. The full app (C:/Users/march/Projects/playtest-platform,
branch integration; plain-English feature list in docs/FEATURES-SPEC.md) is the REFERENCE for wording, money rules
and look, but this version deliberately drops most of its complexity.

## (Owner, Oct 24, NEWEST+15) Paying a suspended tester = held share; reinstatement notices
- The developer can Pay / Reject a suspended tester's sent work as normal (replaces "can't be paid"). The card IS
  charged; the tester's share is HELD (not transferred). When the suspension lifts, held shares go out automatically.
  If the account is closed for good, the admin decides per payment: refund the developer or release to the tester.
  The developer sees "Paid $8.00 · Ana Silva will receive it later" (neutral, never "suspended"); the tester, once
  active, sees it as paid. Admin sees held shares in the admin page.
- REINSTATEMENT is a change: the reinstated person's own pages show "Your account is active again · 3:10 PM" in the
  top box and the next press stops once. A reinstated DEVELOPER's testers see "This test resumed · 3:10 PM" and stop
  once (same as a lifted hold). Developers are never told a TESTER was reinstated.
- EVIDENCE (required in the re-record): Pay on a suspended tester's work (held line), lift -> share released, admin
  refund of a held share, and the reinstatement top-box + stop for both sides.

## (Owner, Oct 24, NEWEST+14) Suspended testers leave their tests; rejoining is always an ask
- SUSPENDED TESTER (replaces the tester part of NEWEST+13): removed from every test they're in AT ONCE (calls ahead
  cancelled, waiting requests closed); work already sent stays and is reviewed; pay for it waits until the suspension
  lifts. Developers only see "Left this test". While suspended: sign in and look only; Find tests hidden ("Your account
  is paused."); messages read-only; every action refused blue under the button.
- WHEN LIFTED: bell + email "Your account is active again" -> their tests page; the tests they were removed from are at
  the TOP with a "Suspended" label that stays until they rejoin or dismiss it; waiting pay goes out.
- SUSPENDED DEVELOPER messages are read-only too.
- REJOINING (all cases): a tester who LEFT (incl. removed by suspension) or whose work the developer ENDED, BEFORE their
  deadline passed, sees "Ask to rejoin" on that test wherever it's listed (dashboard, tests page, session page) unless
  the test was stopped or they rated it. Rejoining is ALWAYS an ask the developer accepts, even on "Anyone can join"
  tests (an invite + an ask still auto-match). Accepting gives back exactly the time they had left. (This replaces
  "ended testers need a new invite".)
  The DEVELOPER is told this wherever they decide: the ask row in Needs you reads e.g. "Ana Silva asks to rejoin.
  If you accept, she gets back the 3 days 4 h she had left (deadline Oct 30, 2:00 PM)."; the same line in the bell /
  email for the ask, and after accepting ("Ana Silva rejoined: her deadline is Oct 30, 2:00 PM."). An ask with no
  time left says "She had no time left: her deadline stays passed."
- PAYOUT PROBLEMS (tester side; do after the rest if usage allows): when Stripe reports a failed payout or an account
  that needs attention, the tester sees a banner on Payments and the dashboard "Your bank couldn't receive a payout.
  Update your payout details." with a button to Stripe, and a bell reminder every 3 days until fixed. The money stays
  in their Stripe balance. (Admin "Payout problems" list: after launch.)

## (Owner, Oct 24, NEWEST+13) Suspensions
- SUSPENDED DEVELOPER: can sign in; Dashboard, Payments, Profile open; can view tester profiles. Banner on every page:
  "Your account is paused. You can still pay for work testers sent. Contact support if you think this is a mistake."
  Each test page: "This test is paused while your account is paused." Pay and "Pay what you owe" GO THROUGH (the
  suspension never stops them; normal stop-once reasons still do). Every other button: final blue refusal under the
  button, every press: "Your account is paused: you can still pay for work testers sent."
- SUSPENDED TESTER: banner "Your account is paused. Contact support if you think this is a mistake."; every button:
  final blue refusal with the same line. Developers see only neutral wording ("Can't be invited right now"; Pay refused
  "…account is closed for now, so they can't be paid"). Never the word "suspended" to anyone else.
- Suspension starting while a page is open: top box "Your account was paused · 3:10 PM" + the next press stops once
  (never ignorable).
- TESTERS IN A SUSPENDED DEVELOPER'S TEST: treated like a payment hold (never told why): page line "This test is paused
  right now."; Send (written / recording) GOES THROUGH with a blue note under the button ("Sent. This test is paused
  right now, so it'll be reviewed once it resumes."); every other action (calls, join, accept requests, charge...) is a
  blue refusal under the button: "This test is paused right now."
  CHARGE / LET IT GO there: "Charge" is refused (blue, under it): "This test is paused right now. You can charge once it
  resumes." "Let it go" STILL WORKS. The Charge box comes back as soon as the suspension lifts (unchanged amount rules).
- Every notice after a press is brought into view at its button (nearest scroll), as in NEXT-UI 13; only the new-terms
  stop scrolls to the top offer box.

## (Owner, Oct 24, NEWEST+12) Which test changes alert testers (session page AND join page)
- Testers are alerted (live top box + stop once on every button) to EVERY change to the test EXCEPT the number of
  spots and Open until, on BOTH the session page and the join page. This now includes "who can join" on the session
  page too.
- Spots: alerted only when it affects them: the test is now full (a final refusal on the join page / their pending
  application closes).
- Open until: never a stop; only when it passes does it matter (join refused for good / the ask or application closes).
- Title stays info only (shown in the top box, never stops).

## (Owner, Oct 23, NEWEST+11) No chat before joining
- Remove chats with applicants and invited testers (the developer's "Chats with applicants and invited testers" and
  the listing's pre-join chat). Chat is only between the developer and testers who are or were in the test. Bells
  for chat follow the same reach. Existing pre-join messages are no longer shown.

## (Owner, Oct 23, NEWEST+10) Required parts = a label only
- Post/Edit: each part has a "Required" tick (full app's Parts and prices cards). It's part of the terms (snapshotted;
  a change is a terms change). It blocks nothing: the developer sees per tester which required / not-required parts
  were sent (under Testers); the tester sees "Required" / "Not required" in Your parts; the rating warning marks unsent
  required parts "(required)". Rating availability is unchanged.

## (Owner, Oct 23, NEWEST+9) Tester capacity per test (as in the full app)
- A developer can take up to N testers per test: starts at 10; after every 10 new ratings it grows by 10% (at least
  +1) when at least half of those 10 are 3 stars or more OR the developer reviewed at least 90% of the work testers
  sent them themselves (paid / partly paid / rejected count; tester Charges and Let it go don't); max 50; never shrinks.
- Post/Edit refuse spots above it: red at the spots field "You can take up to 10 testers per test right now."; the
  limit is shown next to the field. Existing tests keep their spots.
- The full app's card ("Can take up to 10 testers per test · Next: +10% after 4 more ratings…") shows ONLY to the
  developer (their dashboard/profile), never on the profile testers see.

## (Owner, Oct 23, NEWEST+8) Launch fixes
1. EMAIL CONFIRMATION REQUIRED before posting a test, Edit Save, joining/applying/accepting an invite, sending work,
   requesting/accepting calls, paying, charging, inviting, rating. Browsing, profile, chat, sign-out still work. A
   blocked press shows under the button: "Confirm your email first. [Resend the email]" (blue refusal).
2. CALL LENGTH: removed from the listing. Each call request picks a length (30 / 45 / 60 / 90 min); "choose one" and
   daily/weekly requests use one length for all their times. The rate field shows its range next to it: "$10-$200 an
   hour (or 0 for free)". After the call the developer logs the actual length (only when both joined, as before) and
   may log MORE than booked, up to 150% of the booked length ("You can log up to 90 min for this 60-min call." red if
   over). The Pay box uses rate x logged length. 24 HOURS after the planned START the call CLOSES: no joining, the
   length can't be logged or changed any more; if the developer never logged one, the booked length is used for Pay /
   Charge. AUTO-CANCEL: if NEITHER side has joined by the call's halfway point, it is cancelled ("Nobody joined, so the
   call was cancelled."), no charge, never a no-show, both told; if only one joined, the existing no-show rules apply.
   LENGTH IN REQUESTS + AUTO-MATCH (owner): the person who REQUESTS sets the length; the other side can only Accept
   or Decline it (to change the length, decline and send your own request). Auto-booking happens ONLY on an exact
   match: same start, same length and matching rate. ANY other overlap with a pending request or booked call between
   the same two people is refused under the button: "Ana Silva already asked for Thu, Nov 5, 3:00 PM (60 min).
   Accept her request, or pick a time that doesn't overlap." with her request's Accept shown right there. No merging,
   no partial matches. (Clashes with anyone else's calls are checked on Accept, as before.)
3. NEEDS NOTE: the Find card / listing shows a line for EACH unmet need: "This test needs one of: Mac, Linux. Add your
   device in your profile." and "This test needs one of: English, Spanish. Add the language in your profile." (both
   when both are missing). Same lines in the Join anyway warning.
4. OPTIONAL QUESTIONS (as in the full app): each written question has a "Not required" tick; Send requires only the
   required ones; the developer's view and the tester's form mark them "not required" (never "(optional)"). Part of
   the terms (a change offers new terms / closes applications like other question changes).
5. SUGGESTED TESTERS: up to 5, the best mix of highest rating + matching devices AND languages (meets the test's needs
   first, then rating, then number of matches). Find testers: tick-box filters for devices and languages (any ticked
   device / any ticked language), replacing the dropdowns.
6. LAYOUTS like the full app: the dashboard and the test pages (developer test page, tester session page, Find,
   listing) follow the full app's panel layout/sections (reuse its components' markup and classes), behaviour unchanged.

## (Owner, Oct 22, NEWEST+7) Launch look and sign-in like the full site (app behaviour unchanged)
- Theme the lean app like the full Playtest Platform (dark slate/indigo, its fonts, logo, header/nav, cards, buttons,
  inputs, labels, notices), reusing the full app's styles/components where they fit. Blue stop/refusal notices stay
  blue under the pressed button; form mistakes stay red at the field. No behaviour changes.
- Sign-in like the full site: Sign up (email + password), Log in, Forgot password -> Reset (email link), email
  verification, sign out other devices when the password changes; same wording and form behaviour as the full app.
  The email sign-in link is replaced by passwords (Google stays only if configured).
- Landing page wording updated to today's rules (terms can be updated by an offer the tester can Switch/Keep;
  disputes as specced).

## (Owner, Oct 22, NEWEST+6) Outages: detected automatically, every timer moves (no admin entry)
- DETECTION: GET /api/health writes a heartbeat (time) when the app AND the database work. An outside uptime checker
  (e.g. UptimeRobot, free, every 5 min; owner sets it up when the site goes online) calls it. The daily job and the
  first request after a gap check the heartbeats: a gap longer than 15 minutes = an outage from the last heartbeat to
  the next one. No admin entry. Each outage is recorded once (start, end, length).
- GATED (owner): outage detection runs ONLY when OUTAGE_CHECKS=1 (set once the outside checker is live), and ONLY the
  checker's own pings count as heartbeats: GET /api/health?key=<HEALTH_KEY> (secret env). Page loads, polls and the
  daily job never write heartbeats and never create outages. Without the setting nothing is detected (quiet nights
  and a stopped dev server never move timers or send bells).
- EVERY TIMER that was running during it moves later by the outage length: 14-day review clocks / Charge points,
  pay-by dates (3-day cut-off) and hold start, daily retries, tester deadlines, Open until, rating windows (14 days),
  invite reminders, call-request times/expiry, notification schedules.
- CALLS whose time fell inside the outage are cancelled as "missed because the site was down": never a no-show, no
  charge, both told, both can request a new time. No charges or retries run during an outage (anything due runs after).
- NOTICE afterwards: a top-box line on affected pages (both sides) + one bell: "The site was down from 2:10 to 4:40 PM.
  Deadlines and payment dates moved 2 h 30 min later." (testers never see hold wording).

## (Owner, Oct 22, NEWEST+5) Ratings, both ways (tester rates developer; developer rates tester)
- WHEN (tester rating the developer): available as soon as ALL of: (1) at least one part sent or one call done;
  (2) every part/call they sent is decided (paid / rejected) or has reached the 14-day point (Charge / Let it go
  showing); (3) no open dispute in this test (the admin's decision comes first). It does NOT need every contract part
  sent, the deadline, Leave or an end. Before that: no Rate button, no prompt. The "Rate Nora Lane" bell + email is
  sent ONCE, when it first becomes available.
- WARNING (in-page confirm on Rate, like the others):
  - still in the test: "Rating ends your part in Harbor Run. You won't be able to send more work, book calls or join
    this test again." + lines when they apply: "Not sent yet from your contract: recording ($12) — it won't be paid."
    and, if any calls are booked, one short line: "All your upcoming calls will be cancelled." (no list) [Rate and finish] [Cancel]
  - already out: "Once you rate, you won't be able to join Harbor Run again." [Rate] [Cancel]
- EFFECT: like Leave (session ends, upcoming calls cancelled, requests closed, no rejoin ever, the join page says
  "You rated this test, so you can't join it again."), BUT money actions stay: Charge / Let it go and Dispute remain
  available after rating. One rating per tester per test, final (no edit).
- DEVELOPER RATING A TESTER (owner, replaces "mirrored"): available ONLY after that tester has rated the developer
  (so the tester is already out: no session to end, no calls, no warning), and not while a dispute in this test is
  open. The developer gets one bell: "Ana Silva finished Harbor Run. You can rate her for 14 days." The window closes
  14 days after the tester's rating.
- BLIND REVEAL: the tester's rating stays HIDDEN (from the developer and from profiles/averages) until the developer
  rates or the 14-day window closes; then BOTH show at once. Before that each side only sees "You rated Nora Lane" /
  "Ana Silva rated you: you'll see it after you rate her (or on Nov 5)."
- WHAT A RATING IS: 1-5 stars + optional comment (max 500 chars). Shown as "4.6 ★ (12 ratings)" on the developer's
  profile and listings / the tester's profile and invite rows; comments shown WITHOUT the rater's name.
- Rate follows the same button rules as every other button: stop once for all reasons (A-F / developer set),
  refusals and form mistakes as usual (stars missing -> red at the field).

## (Owner, Oct 22, NEWEST+4) Listing changes re-invite; applications; rejoining restores work
- (Owner correction 6, replaces the invite part of correction 4) WHEN THE TEST FILLS: pending APPLICATIONS close (as in
  correction 4). Open INVITES STAY OPEN: the invite shows "Harbor Run is full right now. Your invite stays open; we'll
  tell you when a spot opens." with Accept refused under the button ("Harbor Run is full right now."). Invited testers
  get one notice when it fills (same text) and one when a spot opens (someone leaves or is ended, or spots are raised):
  "A spot opened on Harbor Run: you can accept Nora Lane's invite now." (bell + email + join-page top box; first come,
  first served). The 3-day invite reminders pause while the test is full and resume when it has a spot. Closed
  applicants are NOT told about openings (they may apply again). Developer top box when it fills: "Harbor Run is full ·
  3:10 PM: closed 2 applications. 1 invite stays open until a spot opens."
  ONCE PER INVITE: each invite gets the "full" notice and the "spot opened" notice at most ONCE each (the first fill and the
  first reopening). Later fills/reopenings send nothing more (the invite and the join page still show the current
  state; the 3-day reminders keep their normal rule, paused while full).
  Sending NEW invites while the test is full is NOT allowed: Invite is refused under the button, "Harbor Run is full.
  Add spots to invite more people." (invites already open stay open).
- (Owner correction 5) NO SPOT CAP ON INVITES: any number of invites can be open, whatever the spots; lowering spots
  does NOT close invites; re-sent invites are never limited by spots (drop "Not re-invited: … (no spots left)" and the
  "Only 2 spots are left…" refusal). Invites stay open when the test fills (correction 6).
- (Owner correction 4) WHEN THE TEST FILLS (the last spot is taken): every pending application and every open invite
  CLOSES at once. Applicants: "Harbor Run is full, so your application was closed." Invited testers: "Harbor Run
  filled up, so Nora Lane's invite was closed." Developer top box (all tabs): "Harbor Run is full · 3:10 PM: closed 2
  applications and 1 invite." (stop once, as any tester action). Presses on them -> blue final refusal under the
  button. Nothing reopens if a spot frees later (applicants may apply again; the developer may invite again).
  Invites do NOT hold spots: first come, first served (the spot cap only limits how many invites can be open).
- (Owner correction 3) LOWERING SPOTS below testers in + open invites: Save closes the MOST RECENT invites past the
  cap and names them in the Save result ("Spots are now 3: closed Sam Lee's invite."); each closed tester is told
  ("Nora Lane's invite to Harbor Run was withdrawn: the test has fewer spots now."). Description, devices and
  languages changes stay in the tester SESSION page's top box AND stop once there. Switching Who can join to Invite
  only keeps sent invites open but CLOSES every pending application (owner): applicants are told "Harbor Run is now
  invite only, so your application was closed."; the Save result names them; Accept/Decline on one is refused under
  the button ("Ana Silva's application closed when the test became invite only at 3:10 PM."). New applications are
  refused "This test is invite only."
- (Owner correction 2) WHICH changes close applications / re-send invites: prices, parts, written questions, tester deadline, devices/languages, DESCRIPTION. NOT: title, Open until, spots, who can join (those keep the application/invite open). TITLE changes are INFO ONLY everywhere (tester session page, join page, developer's other tabs): a top-box line ("Nora Lane renamed the test to Harbor Run 2 · 3:12 PM") and, if a press happens before the page showed it, the press GOES THROUGH and a blue note under the button mentions it ("Done. Also: the test was renamed to Harbor Run 2 at 3:12 PM."). A title change never stops a press.
- (Owner correction) A saved listing change (anything except spots / who can join):
  - APPLICATIONS: every pending application CLOSES (no invite is sent). The applicant is told (bell + email + join-page
    top box): "Harbor Run's listing changed, so your application was closed. You can apply again on the current
    listing." The developer's Accept/Decline on a closed application is refused under the button ("Ana Silva's
    application closed because you changed the listing at 3:10 PM."). Switching to Anyone is not a listing change
    here: the auto-join rule stays.
  - INVITES: every OPEN invite closes and is RE-SENT on the new listing to the same testers ("Nora Lane updated Harbor
    Run, so here's a new invite: written $10, recording $12."; the 3-day reminder clock restarts). Accept on an old
    invite is refused under the button and the new invite is shown right there.
  - LIVE + GONE: closed applications and replaced invites DISAPPEAR from the lists as the page auto-refreshes. Live
    news appears ONLY in the top box; notices under buttons appear only on press.
    - Developer, the tab where they saved: nothing in the top box and no stop (it's their own action here); the Save
      result lists it ("Closed 2 applications: Ana Silva, Leo Park. Invites re-sent on the new listing: Dee Moss.
      Not re-invited: Sam Lee (no spots left).").
    - Developer, their OTHER tabs: reason E: top box "You changed the listing in another tab · 3:10 PM: closed Ana
      Silva's application, re-sent Dee Moss's invite" + stop once on every button. Pressing Accept/Decline on the closed
      application there gives ONE blue final notice under the button: "Ana Silva's application closed when you changed
      the listing in another tab at 3:10 PM."
    - Tester (join page): top box "Nora Lane changed the listing · 3:10 PM: your application was closed" / "... here's a
      new invite on the updated listing" + stop once on every join-page button. Pressing Accept on the old invite: one
      blue final notice under the button: "Nora Lane changed the listing at 3:10 PM and sent you a new invite:" with the
      new invite right there.
  - SPOT CAP for invites (always, not only on re-send): open invites + testers in <= spots. Re-sending keeps the
    earliest-invited first; the rest close and the Save result names them ("Not re-invited: Dee Moss (no spots
    left)."), as do testers who can't be invited any more. The Invite button refuses past the cap: "Only 2 spots are
    left and 2 people are already invited. Cancel an invite or add spots."
- REJOINING: a tester who LEFT can join again (normal Join/Apply/Invite rules, spots, refusals, 10-test limit) on the
  CURRENT listing. Their old session is RESTORED (same session page): sent work, reviews, payments, paid so far, chat,
  disputes and call history are all still there. New terms apply to work sent after rejoining; work already sent keeps
  the price it was sent under. Their deadline = rejoin time + exactly the time they had left when they left (hours count; it may land the same day). If their deadline had already passed when they left, it stays passed (sends are labelled late, as before). Holds shift it as usual. Cancelled calls / closed requests stay
  closed. A tester the developer ENDED can only come back through a new invite from the developer; Join for them is
  refused: "You can't join this test again." (neutral; a block is never revealed). Wording fix for others: never
  "You've already joined this test." for someone who left.

## (Owner, Oct 22, NEWEST+3) Every button stops once, including for your own actions in another tab
- ONE rule for every tester button on the session page AND the join/listing page (Switch/Keep, Send written, Send
  recording, Charge/Let it go, Dispute, Leave, BLOCK, Request a time, Accept/Decline/Withdraw, Cancel call; Join,
  Apply, Withdraw application, Accept invite, No thanks): the first press stops once for any reason, the second press
  goes ahead. Reasons: (A) new terms; (B) developer paid/rejected; (C) developer call changes, INCLUDING the developer
  accepting the tester's own request, an auto-match booking, and a developer request being taken or closed; (D) the
  listing changed (join page, as before, spots excepted); (E) ANYTHING the tester did themselves in another tab since
  this page loaded ("You also did this in another tab: sent your written answers at 3:10 PM").
- Exceptions: Join call (time-critical) keeps only its final refusals.
- (F) LISTING INFO: a change to the test's title, description, devices or languages (saved by the developer, in any
  tab) is shown in the live top box AND stops once on every button of: the developer's test page, the developer's
  Edit page (incl. Save), the tester's session page, and the join page ("Nora Lane changed the description · 3:12 PM
  [See it]"). Other edits keep their rules (terms -> A; join-page listing changes -> D; spots only when full).
- PAYMENTS AND DISPUTES (both sides, top box + stop once on every button), ONLY for this test:
  - Developer: payment succeeded / failed (and retried), refunds, chargeback opened/resolved, dispute opened by a
    tester, the developer's side added, admin dispute decision; applications; Switch/Keep; invite answers.
  - Tester: paid / rejected, payment delayed (never "failed", "hold" or "chargeback"), payment arrived after a delay,
    their dispute's admin decision. Chargebacks are never shown to testers.
  - ACROSS TESTS (overrides the next line for these events): the developer's payment FAILED / retried, chargeback
    opened, and the clearing events (a failed payment that went through on retry or was paid off, chargeback resolved)
    show in the top box and stop once on EVERY test page and Edit page of that developer, naming the test ("Payment
    failed on Harbor Run: $8 to Ana Silva · we'll retry tomorrow · pay by Oct 25 to avoid a pause."). Successful
    ordinary payments stay this-test only.
  - Tester, same logic within this developer's tests: the tester's OWN payment delayed / the delayed payment arrived
    shows on every session page they have with THIS developer, naming the test; ordinary paid/rejected stay this-test
    only. Never other testers' payments, never "failed"/"hold"/"chargeback".
  - DECLINED PAY PRESS (owner, final): a developer's Pay declined at the press is treated like ANY other payment
    failure. The refusal shows under Pay, AND it becomes owed: the piece is marked owed (no second Pay on it; the "Pay
    what you owe" box covers it), the daily retry and 3-day cut-off start, a second failure starts the hold at once,
    and the across-tests failure alerts show on every test page and Edit page. The tester is told "delayed" (bell + top
    box + stop once, on every session with this developer): "Nora Lane's payment for your written answers ($8) is
    delayed. You'll be told when it arrives." When it goes through -> the normal paid line. Never "failed"/"declined"/
    "card" wording to the tester.
  - Payment events from the developer's OTHER tests don't show here; a hold shows on every test as the existing
    paused banner/refusals (not a top-box line per failure).
- The Edit page's Save follows the SAME rule as the test-page buttons: it stops once for every developer reason
  (including edits or any other action saved in another tab, and F), with the box under Save; the second press saves.
  The Edit page has the live top box too.
- Developer side: same principle; their own actions in another tab are a stop-once reason on every developer button.
- The stop box under the pressed button stays live while open: new changes are added to it as the page's auto-refresh
  picks them up (like the Invite anyway box). No notices are pre-shown under buttons that weren't pressed.
- LIVE TOP NOTICE (both sides, session/test page and join page): one box at the top of the page lists every change
  (reasons A-E) picked up by the auto-refresh since the page was opened, newest first, with times ("Updated · 3:12 PM:
  Nora Lane paid $8 for your written answers"), with a [Dismiss]. Changes already shown there count as seen: a press
  stops (under the pressed button) only for changes the page hadn't shown yet.
- SCROLL ONCE: the FIRST time the live top box gets an update after the page is opened, the page scrolls up to the
  top box (once per page load; later updates only add lines). If the person is typing in a field at that moment, the
  scroll waits until they leave the field (never lose what they're typing or their cursor).
- Wording: a developer request no longer available -> "The call time Thu, Nov 5 at 3:00 PM is no longer available."
  A tester never sees another tester's name: "Another tester took this time at 2:10 PM."
- Remove the leftover Offer-times (callSlot) checks from the stop logic.

## (Owner, Oct 22, NEWEST+2) Developer live-call panel layout, daily repeats, per-tester limit (wins below)
- Repeat is "Daily" or "Weekly", 2-8 calls, exactly 1 time (never with "choose one"). Every occurrence is
  clash-checked; once accepted each is an ordinary call (cancelled/paid alone). A daily/weekly set is shown as ONE
  line ("Weekly: Mon 10:00 AM · 4 calls, next Nov 9 [Show calls]").
- LIMITS (replace "3 pending per side" and the combined count):
  - BOOKED: up to 3 different booked times per tester at once; a single call = 1, a daily/weekly set = 1. Shown on
    the tester's row as "2 of 3 booked" (no total-calls count).
    Accepting (or auto-match) that would make a 4th is refused under the button: "Ana Silva already has 3 booked
    times with you. Wait until one is over or cancel one." (tester side: "You already have 3 booked times in this
    test."). A slot frees when a single call takes place or is cancelled, or a set's last call is over or all its
    remaining calls are cancelled.
  - REQUESTS: up to 3 pending requests per tester (both sides together), each with up to 3 times or one daily/weekly
    time. A 4th is refused: "You already have 3 requests waiting with Ana Silva. Withdraw one or wait for an answer."
  - Select all: the stop-once box names testers at a limit and sends to the rest on confirm.
- Developer panel, top to bottom:
  1) The rate line ("Calls you request use each tester's contract rate. A tester can ask for a different rate if they
     request a call.").
  2) The tick box list: "Select all", then ONE ROW PER TESTER with their terms, like the parts listing: name ·
     deadline · each part sent/not sent and paid so far of its terms ("Written sent, paid $8 of $8 · Recording not
     sent · Live call $40/h, $40 paid so far") · "2 of 3 booked".
  3) [Request a time] (goes to everyone ticked).
  4) Underneath: per-tester blocks for the TICKED testers with their Booked calls ([Cancel]), daily/weekly sets
     ([Show calls]), and Waiting requests (theirs: [Accept]/[Decline]; yours: [Withdraw]). When NOTHING is ticked,
     show every tester who has any call or request (nothing hidden by accident). Ticked testers with nothing show
     "No calls or requests".
- Tester page stays simple: only their own calls/requests with the developer + "Live call: $40/h".

## (Owner, Oct 22, NEWEST+1) Request kinds, weekly, and a 2-pending limit (adds to the section below)
- A request is ONE of: (a) "Choose one": up to 3 possible times; the other side picks one (or declines) -> 1 call;
  (b) "Weekly": exactly 1 time, repeated weekly for 2-8 weeks; the other side accepts all or declines -> one call
  per week. Never both. Several separate requests can each be accepted -> several calls.
- After acceptance each weekly call is an ordinary call (cancelled and paid on its own; holds/blocks cancel only the
  calls inside them). No series object to manage. The rate is fixed at acceptance.
- Select all: the first tester to accept takes the whole request (their chosen time, or all weeks); others' copies
  close; a late Accept is refused under the button.
- Tester's "Ask $___/h" works on any kind of tester request.
- Auto-match only for "choose one": if one of its times equals a time the other side requested and the rates match,
  that time books. Weekly always needs Accept.
- LIMIT: each side may have at most 3 pending requests at once with the same person in the same test (a Select-all
  request counts once per tester; a weekly request counts as 1). Each request has up to 3 times ("choose one") or 1
  weekly time. No limit on booked calls (clash checks prevent double booking). A 4th is refused under the button:
  "You already have 3 requests waiting with Ana Silva. Withdraw one or wait for an answer." (Select all: names the
  testers at the limit and sends to the rest only after the stop-once box confirms.)
- CLASHES (start + minutes overlap), checked for every time of a request, every week of a weekly: sending is refused
  if it overlaps a booked call or a pending request between the same two people; accepting/auto-match is refused if
  it overlaps any booked call either person has with anyone. A tester refused because of the developer's other calls
  only sees "This time is no longer free." (never who with). A weekly with any clashing week is refused whole,
  naming the week(s).
- Grouped bells: "Nora Lane asked for a call: pick one of 3 times" / "Nora Lane asked for weekly calls: Thu 3:00 PM,
  6 weeks".

## (Owner, Oct 22, NEWEST) Calls are ALWAYS requests; no Offer times, no instant Book; tester can ask a rate
- "Offer times" and the tester's instant "Book" are REMOVED. Every call starts as a request from one side and is
  booked only when the other side accepts (or auto-match below).
- Developer: "Request a time" -> pick one or more working testers (tick list with "Select all"). One request = ONE
  call: the first tester to Accept books it; everyone else's copy closes, and an Accept pressed on a closed copy is
  refused under the button ("Ana Silva took this time at 2:10 PM."). One grouped bell per request batch
  ("Nora Lane asked for a call: Thu, Nov 5 at 3:00 PM").
- The developer never sets a price: their requests use the tester's contract call rate (or "Not in your contract").
  To change the rate they message the tester.
- Concise line under the developer's live-call box (always shown): "Calls you request use each tester's contract
  rate. A tester can ask for a different rate if they request a call." The tick list shows each tester's rate
  ("Ana Silva · $40/h", "Dee Moss · not in contract"). The tester's live-call box shows only their listed rate
  ("Live call: $40/h" or "Live call: not in your contract"), no explanation line.
- The "Ask $___/h" box is ONLY on the tester's own "Request a time" (NOT on Accept). Accepting a developer's request
  always books at the contract rate. A tester who wants a different rate requests the same time with an ask; that
  closes their copy of the developer's request and waits for the developer's Accept/Decline.
- Tester: "Request a time" with an optional "Ask $___/h" (blank = contract rate). Accept on a developer's request
  also has the optional "Ask $___/h".
- STRICT price rule: if the tester's ask differs from the contract call rate (or the call is not in their contract
  and they ask a rate), nothing books on the tester's side. Accepting with a different ask turns that tester's copy
  into a TESTER request (same time, asked rate) that the developer must Accept/Decline; the developer's request stays
  open for the other testers. Accept with no ask (or ask = contract rate) books at once.
- Auto-match: same time requested by both sides books at once ONLY when the tester's ask is blank or equals the
  contract rate; otherwise the tester's priced request stays pending for the developer.
- Booked calls show the agreed rate ("Contract $40/h" or "Agreed $50/h"); the developer's Pay box after the call
  starts at agreed rate x length (as with sends' Ask, the developer can still pay any amount or reject). Charge /
  Let it go keeps the existing Charge-amount rule.
- Rate asks/changes count as call changes (stop-once: developer set, tester reason C). All other rules of the
  section below stay (Withdraw, closing on time passed/block/hold/Stop/End early/Leave, cancel rules, refusals).

## (Owner, Oct 22, newest) Call requests on both sides (adds to offered times + instant Book)
- Developer: "Offer times" (as now: open times anyone allowed can book instantly) AND "Request a time" with one
  tester (pending until that tester accepts or declines). Tester: "Book" an offered time (instant, as now) AND
  "Request a time" (pending until the developer accepts or declines). Each side can Withdraw its own pending request.
- Auto-match: if one side has a pending request for a time and the other side books it, offers it, accepts it or
  requests the same time, it is BOOKED at once ("Booked: you both picked Thu, Nov 5 at 3:00 PM") and the pending
  request closes. Requests also close when their time passes, on a block, a hold, Stop, End early or Leave.
- Both sides can cancel a booked call (reason within 24h; not after start), as now.
- Stops: Accept / Decline / Withdraw on a request that was booked, withdrawn, declined or closed meanwhile → final
  refusal, blue, under that button, saying what happened ("Ana Silva withdrew this request at 2:10 PM."). Call changes
  by the other side (requests made/withdrawn/declined, times offered/removed, bookings/cancellations) are stop-once
  reasons: the developer's set already includes them; for the tester they are reason (C) and stop ALL tester buttons
  (Send written/recording, Switch/Keep, Charge/Let it go, Dispute, Leave, Book, Cancel, Request a time,
  Accept/Decline/Withdraw a request), blue under the pressed button. Pages show call updates live.
- During a hold no requests can be made or accepted; pending ones close (both told).

## (Owner, Oct 22, decisions) Sending during a hold: KEPT allowed. Calls: reason only within 24h, no late-cancel fee.
## Joining with a missing device/language: WARN in-page ("This test needs an iPhone. Join anyway?"), never refuse.
## Form mistakes (validation): RED at the field (and a short red line under the button); blue is only for stop-once
## and refusals. Moves: removed for good.

## (Owner, Oct 22, newest) Charge amount (replaces earlier Charge formulas)
- The ask is for THIS piece of work; the listing is the most the part can be paid in total.
- Room left on the contract = listing − already paid for that part. Charge cap = the lower of (this piece's ask, if
  any) and (room left). Example: listing $7, already paid $5, asked $2 → cap $2. No room left → no box.
- The tester types any amount from $0.01 up to the cap ("Charge $[ 2.00 ] (up to $2.00)"; starts at the cap); the
  tick names the typed amount; above the cap is refused under the button ("You can charge up to $2.00 for this part.").

## (Owner, Oct 22, newest) The "Invite anyway" box
- It stays up as long as any ticked tester doesn't meet the test's needs, updating live (adds/removes names and what
  each is missing as profiles or ticks change).
- Pressing Invite anyway:
  - if since the box appeared everyone ticked now meets the needs → nothing is sent; the box closes and a blue notice
    under the original Invite button says "Everyone you ticked now meets this test's needs. Press Invite to send.";
  - if what they're missing changed → stops once in the box: lists the changes and the updated missing items; press
    again to invite anyway;
  - it also stops once for every Invite reason (developer reason set, ticked testers' need-affecting profile changes,
    joined/invited elsewhere, became greyed/removed), listed in the same box.

## (Owner, Oct 22, latest: replaces parts of "Invite list: greyed vs removed")
- Invite panel sections, in order: **Invited** (top: each sent invite with Cancel invite; invited testers are NOT
  shown again in the lists below), **People you've worked with** (testers currently or previously in any of this
  developer's tests), **Suggested** (testers whose profile fits this test's needs), **Find testers** (search; empty
  until searching). The same greyed/removed rules apply in all three lists.
- No "removed because it no longer fits a filter": filters only narrow what's shown. A tester missing something the
  test needs (language, device, category) can still be ticked; pressing Invite shows an in-page confirm (no pop-up)
  under the button: "Ben Carter doesn't list English, which this test needs. [Invite anyway] [Cancel]" (several
  ticked → one confirm listing each). The confirm reacts live: if that tester's profile now fits, it disappears; if it
  changes again, the text updates. Pressing Invite anyway after any invite stop-once reason since the page loaded
  stops once under it first.

## (Owner, Oct 22) Invite list: greyed vs removed
- Greyed out (tick disabled, neutral reason shown, updates live): at 10 tests ("Can't join more tests right now"),
  suspended ("Can't be invited right now"), already invited ("Invited Oct 21 · Cancel invite"), already in the test.
- Removed from the list entirely (never explained): blocked either way, deleted account, profile no longer fits a
  filter the developer chose.
- Invite stops once (blue, under Invite) for: the developer stop-once reasons (top-panel set), a ticked tester's
  profile change that affects the test's needs (language, device, category), a ticked tester joining or being
  invited elsewhere (other tab), a ticked tester becoming greyed/removed since the page loaded. Final refusals for
  the test itself: full, stopped, past Open until, paused.

## (Owner, Oct 22) Chat reach and notifications
- A developer and a tester can chat about a test when the tester is in it, was in it (finished/left/ended), is
  invited to it (open invite), or has applied (pending application). Not after a block.
- Bell notifications for new messages: when the test is open and the tester is in it / invited / applied, the bell
  reads "Nora Lane · Harbor Run: <first words>" and links to that chat; otherwise (test closed, or they're no longer
  in it) it's a plain "New message from Nora Lane" linking to the chat. Emails follow each person's email setting.

## (Owner, Oct 22) Joining: Join, Apply to join, invite only (no offers / counter-offers on the join page)
- Test setting "Who can join": Anyone (tester presses Join) / Apply (tester presses Apply to join, optional note;
  the developer Accepts or Declines) / Invite only.
- "Test terms changed" means ANYTHING about the test listing (any Edit field, Open until, who can join) EXCEPT the
  number of spots: a spots change never stops Join / Apply / the auto-join; only "full" refuses (for good).
- Join and Apply to join stop once (blue, under the button) if anything about the test changed since the page loaded,
  including a switch between Anyone / Apply / Invite only; the box lists what changed; press again to go ahead on the
  current listing. Refused for good: full, stopped, past Open until, paused, blocked, 10 tests, already in.
- A pending application when the developer switches the test to "Anyone can join": if nothing else about the test
  changed since the application, the tester is joined automatically (bell + email "You're in: Harbor Run"); if
  something else changed, the application stays and the tester is told "Harbor Run changed since you applied:
  [Join on the current listing] [Withdraw application]".
- Developer's Accept / Decline on applications use the developer stop-once reasons (plus "the tester changed their
  profile" and "anything about the test changed since"), box under the button.

## (Owner, Oct 22) If the part's contract price has already been paid in full, NO Charge / Let it go box at all (not
## even "Close it") and no day-14 notices or reminders to the tester for that piece; the developer can still Pay or
## Reject it.

## (Owner, Oct 22) Tester deadline: KEPT as a guide (never blocks). Sent work after it reads "Sent late (deadline
## was Oct 20)", and call bookings after it read "Booked after Ana Silva's deadline (Oct 20)" on both sides (booking
## form, call row, developer's tester row). Open until stays the only hard stop.

## (Owner, Oct 22, calls/hold/block refinements; wins over below)
- Cancelling a call: allowed by either side up to the call's start time (reason required within 24 hours); not after
  it starts (then only "Report a no-show"). A cancel closes the call everywhere at once, including a room someone
  already joined early in another tab ("This call was cancelled." replaces the room/Join).
- Join opens 10 minutes before; joining early changes nothing. Each side's first Join is recorded; the call page shows
  "Both joined at 3:02 PM" when both have. The developer still enters the length (default: from when both joined to
  the booked end).
- Hold: entering a call length is NOT allowed during a hold ("You can enter this once the hold is lifted."). A call
  already in progress when a hold starts runs to its booked end; calls that would start during the hold are
  cancelled. Any admin decision that charges the developer is charged after the hold lifts.
- Block during a call in progress: the room closes at once for both ("This call isn't available.").
- After a block, buttons that can no longer be used are hidden (not just refused): the tester's Join / No thanks on
  the blocker's invite (invite cancelled), the new-terms offer box (withdrawn), Book/Join for calls with that person,
  chat input (replaced by "This chat is closed."); developer: Invite for that tester, Pay/Reject stay (sent work is
  still payable).

## (Owner, Oct 22, very latest)
- **Placement refinement:** tester stop-once boxes appear under the pressed button for every reason EXCEPT new terms:
  when new terms are the reason, the page scrolls to the offer box at the top (Switch / Keep) and the line shows
  there. Every press always brings the user to where the result is shown.
- **Block (both sides can block the other):** from a tester row / the test page (developer) or the session page /
  chat (tester). Effects at once: their sessions together end (the tester's sent work stays payable and reviewable;
  disputes still allowed), booked calls between them are cancelled, neither can book or join a call with the other,
  no invites or joins to the blocker's tests, chat between them closes. Never revealed: the blocked side reads
  neutral lines ("Your session on Harbor Run ended.", "Ben Carter can't be invited right now.", "This time isn't
  available."). Unblock from Settings → Blocked people (nothing reopens by itself).
- "Who can book: anyone" shows the hint "People you've blocked can't book."
- Join call is refused (blue, under Join) when: the call was cancelled; it hasn't opened yet (opens 10 min before:
  "You can join from 2:50 PM."); it's over (30 min after its end); the test is paused (hold), stopped, or the tester's
  session ended or they left; either side blocked the other ("This call isn't available."); the call was reported as a
  no-show.

## (Owner, Oct 22, newest: placement) EVERY stop-once box and every refusal, on both sides, is a BLUE notice
## directly under the button that was pressed (the page scrolls to it). This replaces "top of the session page" and
## "under the panel" placements. Live lines (bell, auto-updating lines) are unchanged.

## (Owner, Oct 22: the tester's stop-once reasons)
- One reason set for the tester's buttons, since their page loaded: (1) new terms offered / terms changed again,
  (2) the developer **paid or rejected** any of their work, (3) the developer **offered, removed or cancelled call
  times**, or **booked/cancelled** a call with them.
- Buttons that stop once for ALL of these: Switch to the new terms / Keep my current terms, Charge / Let it go,
  Dispute, Leave the test, Send written answers, Send recording, Book a call, Cancel a call. Box: under the live-call
  panel for Book/Cancel; at the top of the session page for the rest. Press again to go ahead.
- Final refusals (not stop-once): the developer stopped the test or ended the tester's session ("Nora Lane ended your
  session on Oct 22."), past Open until, already decided/charged, during a hold where the action waits.
- There is NO "ask to leave" or "ask to end early" for either side: the tester just Leaves; the developer uses End
  early (that tester) or Stop the test (everyone).

## (Owner, Oct 22, latest: new terms offered to working testers; wins over "Edit never changes working testers")
- When the developer saves Edit with a change to contract terms (a price, adding/removing a part, the live-call rate or
  length, questions, the deadline days), every working tester is OFFERED the new terms. Their contract doesn't change
  unless they choose. Tester's session page: a box at the TOP: "Nora Lane updated the listing: written $8 → $10, added
  a recording ($12). [Switch to the new terms] [Keep my current terms]" (bell + email too). Switching: the new prices
  and parts apply to work sent from then on; work already sent keeps the price it was sent under; their own deadline
  stays (or moves later if the new days give more time, never earlier).
- Tester-side stop once (box at the TOP of the session page): Send (written/recording) and Charge / Let it go stop
  once if new terms were offered since the page loaded ("Nora Lane offered new terms · 3:10 PM: written $8 → $10.
  Press again to send under your current terms, or switch first."). Switch / Keep stop once if the terms changed
  again since (shows the newest). Book / Cancel keep their own call checks (box under the live-call panel).
- Where the developer is told how this works: the Edit page (a line above Save: "Testers already working keep their
  contract; each is offered these new terms and can switch. Work they've already sent keeps its price."), the Save
  result ("Saved. Offered the new terms to 3 working testers."), each tester row on the test page ("On their original
  terms · offered new terms Oct 22" / "Switched to the Oct 22 terms"), and the Pay box ("If you don't pay or reject by
  Nov 5, Ana Silva can charge you $8.00, her contract price, or let it go.").

## (Owner, Oct 22, after the evidence batch)
- (Owner: NO withdraw of sent work. Dropped.)
- **Charge / Let it go is back (replaces automatic 14-day pay):** when a CONTRACT part has waited 14 days unreviewed,
  the tester decides: "Charge Nora Lane $8.00" (listing amount, or the asked amount if lower) or "Let it go" (closed,
  nothing charged). Bell + email to the tester at day 14 ("Nora Lane didn't review your written answers in 14 days:
  charge $8.00 or let it go"), reminders every 3 days; if they haven't chosen within 14 more days, it's charged
  automatically. The developer can still Pay or Reject until the tester chooses (Pay/Reject then stops once if the
  tester chose meanwhile, final if already charged/let go). Parts outside the contract never get this choice (the
  developer decides; reminders every 3 days).
- (Owner) NO automatic charge if the tester never chooses: it waits, with reminders every 3 days, until they choose
  or the developer pays/rejects. The asked amount may be higher or lower than the listing; "Charge" uses the LOWER of
  the two for contract parts (a tester can't charge more than the contract by themselves; the developer can still pay
  more with Pay).
- Presses during a hold: the developer's Pay/Reject are refused with "Pay what you owe first." (the hold banner is on
  the page); the tester's Charge / Let it go are hidden while paused, and a press from an old page is refused with
  "This test is paused: you can choose once it resumes." If the developer paid or rejected meanwhile, Charge / Let it
  go is refused for good ("Nora Lane paid $8.00 for this meanwhile.").
- **(Owner) Charge amount with earlier payments:** Charge = the lower of listing and asked, MINUS what's already been
  paid for that part (e.g. listing $8, paid $3 earlier for it → "Charge Nora Lane $5.00"). If nothing is left to
  charge, only "Close it" shows. Parts outside the contract never get Charge / Let it go.
- **In-page confirmations (no pop-ups):** Charge is disabled until the tick "Charge Nora Lane $5.00 now" is ticked.
  Let it go swaps the two buttons for one line "Close this with nothing more paid? [Yes, let it go] [Keep it]".
- **(Owner) A second failed payment starts the hold at once:** the first failure gives the 3-day cut-off; if another
  payment fails while one is still owed, the hold starts immediately (bell + email to the developer).
- **(Owner, notification schedule; wins over earlier frequencies)**
  - Countdown pattern for deadlines: 1 month before (if more than a month away), 1 week before, 3 days before,
    1 day before. Used for Open until (developer + working testers: bell + yellow ⏱ line) and for the developer's
    unreviewed CONTRACT work against its 14-day window (1 week, 3 days, 1 day before day 14), then DAILY after day 14
    until it's paid, rejected, charged or let go. Work outside the contract has no deadline: bell every 3 days.
  - Tester gets "Work sent" confirmations too (bell + email per setting).
  - Invites: first invite bell + email, then a bell reminder every 3 days until the tester joins, presses "No thanks",
    or the invite expires.
  - Admin (owner, latest): a DAILY email only when there are new disputes or new chargebacks (these have deadlines);
    everything else (failed payments, holds, no-show reports once, failed payouts) goes in ONE
    digest email every 3 days. The admin page always shows the full list.
  - "Pay what you owe first." refusal under Pay/Reject includes a link "Pay what you owe ↑" that jumps to the hold box
    at the top of the page.
- **Payment-failure notices (frequency):** developer: on the failure (bell + email), each failed daily retry (bell
  only), 1 day before the cut-off (bell + email), when the hold starts and when it lifts (bell + email). Tester: once
  when a payment for their work is delayed (bell + email per their setting), then when it's paid or the test resumes.
- During a hold (including a chargeback hold) the 14-day clocks and the tester's choice wait; the tester sees only
  "This test is paused. Payment for your work may be delayed."; after the hold the clocks carry on.
- **Daily retry (owner: keep):** the daily job retries every owed payment once a day, both before the cut-off
  (payment failure) and during a hold. Success → receipt to the developer, bell to both sides, and the hold lifts if
  nothing else is owed. Chargebacks are never retried: they stay until the admin marks them resolved.
- **"Pay what you owe" stops once** if the owed total changed since the page loaded ("Another payment failed
  meanwhile: Cara Diaz's recording $20.00. New total $48.00. Press again to pay $48.00."). It runs at once: all paid →
  hold lifts, "Paid $48.00, thank you" under the button, both sides update by themselves; some still fail → the
  failing ones are named with the card's reason and a link to update the card; the hold stays.
- **Daily retry:** the daily job also retries owed payments once a day; success lifts the hold (if nothing else is
  owed) with a receipt and a bell notice to both sides.

## (Owner, Oct 22, newest addition)
- **Paid per part, everywhere the developer sees a tester's work:** a line per kind, e.g. "Paid Ana Silva so far:
  written $8.00 · recording $0.00 · live calls $16.67 (25 min of 1 call)". Same on the tester's own page.
- **Reminders for unreviewed work outside the contract: every 3 days** (not 7).
- **Payment receipts to the developer:** every payment that goes through sends the developer a bell notification
  and a receipt email (always sent, like sign-in links): "Paid Ana Silva $8.00 for written answers on Harbor Run."
- **Developer's side in a dispute:** when a tester disputes, the developer gets a bell + email and can add their
  side once (text, optional file) before the admin decides; the admin sees both. The dispute shows on the developer's
  test page under that piece of work ("Ana Silva disputed: … · Add your side").
- **Pages update by themselves** while open (about every 20 seconds): paid/rejected lines, paused/resumed lines, the
  stop-once boxes' live lines, dispute status. Nothing needs a manual reload.

## (Owner, Oct 22, newest: wins over everything below)
- **No "extra work" flag or button anywhere.** Testers can always send all three kinds (written answers, recording,
  live call booking). Their contract stays recorded and is shown in the tester's top panel ("Your contract: written
  $8, recording $12, live call $40/h"); a part outside it just says "Not in your contract" next to its Send.
- **Asking an amount when sending:** each Send has an optional "Ask $___ for this" box. Both sides see, with the work:
  the listing amount (or "Not in your contract"), the amount asked, and "Paid so far for this part: $Z". The
  developer's Pay box shows the same three and starts at the asked amount if there is one, else the listing amount.
- **Auto-pay at 14 days:** contract parts pay the listing amount (or the asked amount if lower). Parts outside the
  contract are NOT auto-paid: they keep waiting and the developer gets a bell reminder every 7 days. (No admin flag.)
- **No "mark"** wording anywhere, including the tester profile.
- **Open until heads-up:** bell notification AND a small yellow line with a timer icon at the top of the test page
  and the tester's session page ("⏱ Harbor Run closes in 2 days 4 hours: send your work before then.").
- **Email settings:** "Each update" (default) / "Daily summary" / "Weekly summary" / "Monthly summary" / "Off". Sign-in
  links and payment receipts always send. The bell keeps everything.
- **Cancelling a call:** either side can cancel any time; within 24 hours of the call a reason is required, and the
  other side sees it ("Ben Carter cancelled the call on Thu, Nov 5 at 3:00 PM: car trouble."). No penalties.
- **Calls during a payment hold:** only booked calls whose time falls inside the hold are cancelled (tester told,
  "…because the test is paused"); calls after the hold lifts stay booked. During the hold the developer can still enter
  a call's length; Pay/Reject wait.
- **Several failed payments:** the hold box lists each one ("Ana Silva's written answers $8.00 · card declined
  Oct 20"…) with one "Pay what you owe ($28.00)" button that retries them all; the hold lifts only when all are paid.
  If some still fail, the box says which. Chargebacks can't be retried: the admin resolves them (Mark resolved).

## (Owner, Oct 22, latest batch: wins over the sections below)
- **Leaving:** testers can leave any time; there are no "marks" in this version, so no "with no mark" wording
  anywhere. Sent work stays payable after leaving. Tester hold line: "This test is paused. Payment for your work may
  be delayed."
- **Admin daily digest:** once a day ONE email to the owner/admins listing every case that needs them (disputes,
  flagged extra work, no-show reports, open chargebacks, failed payouts), each with a link. The admin
  page shows the same list. No per-event admin emails.
- **Heads-up notices** (Open until in 3 days / 1 day) are in-app bell notifications only, not emailed.
- **Email settings** (per user, in Settings): "Email me each update" (default) / "One daily summary" / "Don't
  email me" (sign-in links and payment receipts always send). The bell keeps everything.
- **Live calls are blocked during a payment hold and on stopped/closed tests, both sides:** no offering, booking or
  joining; booked calls are cancelled with no fault (tester told: "Your call on Thu, Nov 5 was cancelled because the
  test is paused." / "…because the test was stopped."). Stop the test and End early also cancel that tester's booked
  calls. (There are no call requests in this version: booking is the only way to get a call.)
- **Call length:** after a call, the developer can enter the actual length in minutes on that call ("How long was the
  call? 25 min"); the Pay box's reference then reads "Listing: $40/h × 25 min = $16.67" and starts at that amount.
  Without it, the reference uses the booked length.
- **Payment problems on a call:** a declined Pay shows under that Pay button ("Your card was declined, so Ana Silva
  wasn't paid $16.67 for the call. Update your card in Payments, then press Pay again.") and the tester sees "Payment
  for this call may be delayed." A chargeback on a paid call starts the hold with the stop-once line "Your bank
  reversed your $16.67 payment for Ana Silva's live call".

## (Owner, Oct 26) The tester's "Ask $" is removed

No ask on sends or call requests; the Pay box starts at the listing (or the call's agreed rate x length), developers may pay more, Charge cap = listing minus
what is already paid for that part, auto-pay is the listing amount. Old ask data stays unused in the database. This overrides every "asked amount" line below.

## (Owner, Oct 26) Bell stacking, bell links, no pause countdown, admin dashboard

- No countdown on the dashboard or test overview; the bell says when a paused test closes (once when paused, once a day before).
- Bell stacking: same-day lines about one test stack, except admin decisions, a stop, payment failures and holds starting, a hold or pause lifted, a chargeback (own line each). Admins' dispute lines stack per day per test.
- Every bell line links to the exact place (#piece-ID / #tester-ID / #call-ID on the test page, #part-written / #part-recording / #part-live / #call-ID on the session page, /admin?dispute=ID#dispute-ID for admins).
- Admin dashboard: open disputes, then this admin's own pauses/stops/suspensions, then the other lists; 25 at a time with Previous / Next (NEWEST+16).

## (Owner, Oct 26, late) NEWEST+16: chat on hover cards, reminder timing, stacking, emails, pagination

- CHAT: "Chat with <name>" on the tester's hover card (dashboard avatars) and the tester's profile (developer side); opens the same per-test chat as the Testers panel's Chat button (profile: the most recent shared test). A block either way, or any other refusal: blue "Unable to chat with this tester." Hidden where there is no shared test.
- REMINDERS (bell): developer unreviewed contract work: ONE reminder 1 day before Charge would open, then daily after it opens (a day's stack into one line across parts and tests). Developer on a payment hold: one line a day, "Your tests are paused until you pay what you owe" (/app/payments#owed), its own line; today's declined retry is merged into it. Developer pending applications / rejoin asks: daily, stacked with that test's lines. Tester invites: daily until answered, one stacked line across tests. Tester Charge or Let it go: every 3 days, all Charge lines of a day stack across tests. Rating prompts: while the test is open they stack with its same-day lines; once closed (stopped) each is its own line with a reminder every 3 days until rated or the window ends. Admins: daily, one line for all suspended accounts. Every test-tied reminder waits while the test is paused and restarts when it resumes.
- STACKING: tester payment lines (paid, rejected, delayed, delayed payment arrived) do not stack; tester paused / resumed lines stack per day across tests; payout-problem lines stack per day; admin new-dispute lines stack per day across tests (link #disputes).
- EMAIL: Off, or On with Daily / Weekly / Monthly (no per-update option; "each" people moved to Daily). Every email is ONE email listing everything since the last. With email On, payment lines (failures, holds, retries, paid, rejected, delayed, payouts, chargebacks) also go out in an end-of-day email even on Weekly / Monthly, holding only those lines. Admins' chargeback emails go out at once. The always-send emails stay as they are (account paused, the team pausing / stopping / closing a test, email confirmation, password reset, receipts); the owner decides the final list.
- ADMIN DASHBOARD ORDER: open disputes, chargeback holds, your actions, paused tests, then the rest.
- PAGINATION: pages of 25 with Previous / Next and "1–25 of N" under each list; a press replaces only that list's rows (fetch), keyset by date.
- CHARGE CAP (confirmed, no change): the tester's Charge cap is the listing minus what was already paid for that part.

## (Owner, Oct 26, late) NEWEST+17: Charge opening, team lines, extra pay, admin test history, live notices in pop-ups

- CHARGE OPENS only when BOTH 14 days have passed since the part was sent AND the test's Open until has passed. No Open until: when the test stops or closes, or the tester's work ends (left, deadline passed, ended early). Tester reminders every 3 days after it opens; the developer's: one 1 day before it would open, then daily. The rating rule ("everything decided or past the point where Charge opens") and the session / dashboard texts use the same point. Outage and hold shifts still apply.
- TEAM ACTIONS ON TESTS (the team paused, stopped or closed your test, incl. a pause closure): the developer's lines stack into one line a day across tests (no longer own-line); their emails stay always-send.
- EXTRA PAY: each tester's row in the Testers panel (current and past) has Pay + an amount box: pays directly, outside any part, same 80/20 split and charge path; bell "<dev> paid you $X extra for <test>" (does not stack). Over $200 a tick box: "I understand this payment can't be refunded and is charged now." (Pay refused until ticked, red at the tick). No cap but Stripe's (one constant, EXTRA_PAY_MAX_CENTS). Refused when suspended (hidden), "Pay what you owe first." in a hold, blocked either way; stop-once applies. Shows in the developer's Payments history and the tester's payouts.
- ADMIN TEST HISTORY: each test row has History (also in ?test=ID): full timeline across all testers, newest first, pages of 25: events, contracts (terms joined on), offers, invites, calls, disputes, admin actions (which admin), payments.
- LIVE NOTICES in pop-ups: the Stop dialog, the End early dialog and the inline Invite anyway box show live blue notices while open (3 newest, "Show N more", "Just updated" style); confirming with unseen changes still stops once. Other dialogs unchanged. The design doc's section 2 lists every pop-up.

## (Owner, Oct 27) NEWEST+18: Block and Report on profiles, pop-up failures, caps, the owed window, hold counts, extra pay, admin views, cross-tab sign-in

- BLOCK / REPORT only on profiles (tester profile on the developer side, developer profile on the tester side); removed from the find / test page, the session page and the Testers-panel rows. Block: confirm dialog, only stop = already blocked in another tab (blue notice under the button). "Report <name>": reason box + Send to the team; once per pair, ever ("You reported <name> on <date>."); same race stop; the reported person is not told; the admin sees it in a new Reports list (pages of 25: who reported whom, date, reason, links to both profiles). The call's "Report a problem with this call" stays.
- LABEL "Reported more than 3 times" (profile reports + call no-show / late reports): admin only, on names in dispute, report and lift rows and the admin bell lines for them; never the number (the count stays in the profile totals line).
- POP-UPS: Leave, Let it go, Rate and finish get the same live notices as Stop / End early. For all five: a failed confirm (unseen changes or any refusal) closes the dialog and the blue notice sits under the ORIGINAL button ("Your press didn't go through", then the changes). Join anyway / Invite anyway: updates live to the needs still unmet, vanishes when all are met (Join keeps "You now meet this test's needs"), a press after a change shows the updated list with a blue "Your press didn't go through", any other failure closes it with the notice under the original Join / Invite button.
- CHARGE OPENS at the later of 14 days after sending and the test's Open until (a stopped or closed test still waits for its Open until); no Open until: when the test stops or closes or the tester's work ends. Developer reminders: 1 month, 1 week, 3 days, 1 day before (skip past ones), then daily; stacked.
- OWED WINDOW: DAILY "Pay $X by <date and time> or your tests are paused" (one line across all owed payments, stacked; emailed even with email Off: on the always list). While any failed payment is owed: part Pay and extra pay disabled ("Pay what you owe first."), Reject works; the tester's Dispute and Charge disabled ("delayed" wording kept). After the 3-day cut-off the daily retries stop.
- HOLD COUNT: after the 3rd payment hold every later hold needs an admin's Approve even after paying (Lifts box row "hold N": developer, owed, when paid, note, Approve, first press wins). Payment holds list shows the count on each row; the developer's banner says the team will review after they pay. Lift bell lines stack into the admin's one-a-day line with disputes and reports and link to the Lifts row. Chargeback holds keep their own section and Approve.
- PRICE CAPS: written / recording $1 to $1,000 each; live $10 to $200 an hour; hints and red on blur; server refuses. A part price over $200 needs the tick "I confirm this part pays more than $200." (created over, or raised from at most $200 to over; not when an already-saved price over $200 is unchanged). Any Pay box over $200: tick "I understand this payment can't be refunded and is charged now." every time.
- COUNT LABELS: no exact counts outside the profile totals line. Lift rows and the Payment holds list show "More than 3 holds" (list rows only when it applies).
- EMAILS (final): nothing is emailed right away; one email lists everything since the last; each notification emailed at most once. Ignore Off: (1) email confirmation / password reset (right away); (2) the daily "Pay $X by … or your tests are paused"; (3) account paused / active again; (4) the team pausing, stopping or closing your test: items 2–4 in ONE end-of-day email (riding in the payment email or summary when email is On). Receipts and the tester's "You were paid…" follow the setting (On = end-of-day payment email, Off = nothing). Admins: a chargeback emails at once; ONE daily email per admin that can't be turned off, only when it has something (new disputes, lifts waiting, chargeback holds waiting, call reports once, THIS admin's suspended accounts with their paused tests, THIS admin's paused tests with closing dates; dropping off when the tests close or resume); it replaces the env-list admin daily and the 3-day digest; new reports follow the admin's own setting.
- EXTRA PAY moves next to each SENT part in the Testers panel (box + Pay, "Paid so far for this part: $X", "up to $Y"). Everything paid above the listing prices (a Pay above the listing + extra pays) totals at most 100% (EXTRA_PAY_CAP_PERCENT) of the tester's current contract total (current part prices + agreed totals of booked and held calls).
- ADMIN VIEWS: per-test History removed. Profiles: admin-only scroll boxes (payments, payouts, disputes, chargebacks, holds and suspensions with the admin, tests posted or joined, reports against them; testers also sent parts) with a totals line on top. A test's own page: timeline, contract changes, payments. Pages of 25. Admin rows link to these pages.
- CROSS-TAB SIGN-IN: a different account signing in in one tab switches every other tab to the new account, on the page the sign-in landed on (no cover screen). Signing out in any tab signs out every tab and window; all go to the sign-in page. An old tab never sends a press as the previous account: every press names its account (x-uid); a mismatch is refused (account_changed) and the tab switches.

## (Owner, Oct 22) Invites, chargebacks, payment hold, Open until

### Invite panel (test page only, never in Edit). No moves at all.
- Filterable list of testers (devices, languages, categories), "Select all", Invite; sent invites listed with
  Cancel invite; invites expire when the test fills, stops or passes Open until. The tester joins with the normal Join.
  A developer may invite a tester who works on their other test (separate contract; the other one is untouched).
- Invite stops once for the developer stop-once reasons below PLUS: a ticked tester's profile changed in a way the
  test needs ("Ben Carter removed English, which this test needs · 3:20 PM"); a ticked tester joined meanwhile
  ("Cara Diaz joined this test, so she's no longer in your invite list · 3:22 PM"); already invited in another tab
  ("You also did this in another tab: invited Dee Moss · 3:24 PM").
- Refused for good (tick cleared): full ("This test is full (6 of 6 spots), so nobody can be invited. Add spots in
  Edit to invite more."); stopped ("This test was stopped on Oct 22, so nobody can be invited."); past Open until
  ("Joining closed on Oct 20 (Open until), so nobody can be invited."); tester blocked you OR suspended ("Ben Carter
  can't be invited right now." — never reveal a block or suspension); account deleted ("Ben Carter's account was
  closed, so they can't be invited."); tester in 10 tests ("Cara Diaz can't join more tests right now.").
- Several ticked: invite those who can be invited; the box lists only the others with reasons
  ("Invited Ana Silva and Dee Moss. Ben Carter can't be invited right now.").
- Where: live lines in a blue box at the bottom of the invite panel (and in the box under the top title panel);
  on press, the blue box directly under the Invite button.

### Chargebacks are a developer stop-once reason
- The developer's bank reversing a payment (Stripe dispute webhook) is added to the reason set: "Your bank reversed
  your $8.00 payment for Ana Silva's written answers · 2:14 PM". Testers never see "chargeback"; at most "Payment for
  your work may be delayed." A chargeback also starts the payment hold below.

### Payment hold (owner rule + agreed details)
- Starts when a failed charge isn't paid within 3 days (the developer sees the cut-off), or when a chargeback opens.
  Paying everything owed lifts it at once (chargebacks: when the admin resolves it).
- During a hold: ALL the developer's tests are paused: no new joiners, invites, Next round, new call bookings; booked
  calls in the hold are cancelled with no fault to the tester; no new tests can be posted in any way; Pay and Reject
  wait ("Pay what you owe first."). Testers CAN still send work. Every working tester's deadline, and the test's Open
  until, shift by the length of the pause.
- Testers read only: "This test is paused. Payment for your work may be delayed." They may leave with no mark. Chat
  keeps working.
- (Owner, Oct 26; replaces the 30-day admin alert) A paused test closes after 7 days whatever the cause; see the design doc 11.1. Testers are told the test ended; the developer is told why.
- Review time limit: if sent work isn't paid or rejected within 14 days, the listing amount is paid automatically
  (extra work: $0, which the tester can flag to the admin). The clock pauses during a hold.

### Open until
- Open until can be moved later only BEFORE it passes. Once it passes, joining and sending are over for good and it
  can't be extended. Heads-up notifications (in-app and email) to the developer and working testers 3 days and 1 day
  before ("Harbor Run closes on Oct 25: send your work before then.").

## (Owner, Oct 22) One set of stop-once reasons for the developer
- **The reasons (test-wide, since the page loaded):** any tester **left**, **joined**, **sent work** (new or updated),
  a live call was **booked, confirmed or cancelled** (either side), call times **offered or removed**, or a **payment
  or rejection** was made (e.g. in another tab).
- **The developer's buttons that stop once for ALL of these:** the top panel (Stop the test, End early, Next round),
  the live-call panel (offer/remove times, confirm/cancel a call), and **Pay / Reject** on each piece of work or call.
- **Where the box shows:** directly under the pressed button's area: under the top title panel, under the live-call
  panel, or under that Pay/Reject. Pressing again goes ahead; a final refusal (can't happen any more) shows there too.
- **Reject:** next to Pay on each piece of work/call. A reason is required; nothing is charged; for a contract part
  the tester may dispute once (an admin can only raise the pay); for extra work it's final. Pay and Reject on the same
  piece are mutually exclusive: the second one pressed (other tab) is refused for good ("You already paid $8 for this.").
- **Tester side** stays as before: Book / Cancel in their live-call panel stop once for call changes, with the box
  under their live-call panel.

## (Owner update, Oct 22) Extra work and one Pay box: these override rules 2–3 and the "can only send parts in
## the contract" line in rule 4
- **Testers may send written answers, send a recording, and book live calls even when that part is not in their
  contract** (the listing). Parts in the contract are labelled "In your contract"; others "Extra (not in the listing):
  the developer decides what to pay". Developers see the same labels.
- **Review = one Pay button with an amount box next to it**, per piece of sent work (and per held call). No Accept /
  pay-in-full / pay-different buttons. Beside it:
  - "Listing: $X for written answers" (or recording, or "$Y/h × N min booked"), or "Not in the listing" for extra work;
  - "You've paid Ana Silva $Z so far on this test."
  - The box starts at the listing amount (or empty for extra work). Any amount from $0 up; a reason is required when
    the amount is below the listing amount. A "charged now: $X" tick naming the exact amount must be ticked to press Pay.
  - Pay charges the developer that amount (Stripe, test mode) and pays the tester minus the platform fee; one charge per
    press, never twice (idempotent).
- **Live calls:** any tester in the test may book offered times (contract or not). After the call the developer pays
  with the same Pay box (reference: the listing rate × length, or "Not in the listing").
- **Disputes:** only for parts in the contract paid below the listing amount; once per part; an admin can only raise
  the pay. Extra work: the developer's amount is final.
- **(Owner, Oct 22) Late work:** testers can still send work (and book calls) after their own deadline; it's marked
  "Sent late (deadline was Oct 20)" for both sides. They can't send or book after the test's **Open until** date, nor
  after the developer stopped the test or ended them early (refused with the reason).
- **(Owner, Oct 22) Pay stops once too.** Pay re-checks what the developer saw: if since the page loaded that tester
  sent new or updated work, left, booked or cancelled a call, or another payment to them was made (e.g. in another
  tab), Pay does NOT go through: a box directly **under that Pay button** lists what changed and shows the updated
  "paid so far"; pressing again pays the amount in the box. A payment that can't happen any more (already paid for that
  same piece of work, tester account closed) is refused for good in the same place.

## The loop
Developer posts a test → testers join (their contract is fixed at join) → testers send written answers and an
optional screen recording, and/or do a booked live call → developer reviews sent work and **chooses how much to pay**
(from $0 up to the agreed price) → Stripe charges the developer, tester is paid (Stripe Connect) minus the platform fee.

## Owner rules for this version
1. **No requests at all.** No price asks, drop asks, more-time asks, change/deal offers, counter-offers, moves.
   Every term is listed in the contract from the start: price for written answers, price for a recording, live-call
   rate and length, the tester's deadline (days from joining), questions, device/category needs. **Neither side can
   change a contract after joining.** Edit changes the listing for NEW joiners only.
2. **The developer chooses how much to pay for sent work** at review: Accept in full, or Pay a different amount
   ($0 up to the agreed price for that part) with a reason (required when less than full). The tester can dispute
   once if paid less than agreed; an admin decides (can only raise pay). Charge only on that press, with a
   "charged now: $X" tick naming the amount.
3. **Live calls stay:** developer offers times (and who can book); tester books or cancels (24-hour rule as in the
   full app); join call (simple room or a link); developer enters the call length; charge = rate × length; no-show
   report. Keep it simple: no proposals/counter-proposals, no extra calls.
4. **(Updated Oct 22, owner) Stop once: the only checks, both sides, shown directly under the pressed button's panel.**
   - Triggers (since the page loaded): a tester **left**, a tester **joined**, a tester **sent work**, a live call was
     **booked, its booking accepted/confirmed, or cancelled** (by either side), or call times were offered/removed.
   - Developer: the top-panel buttons (Stop the test, End early, Next round) show their box **under the top title
     panel**; the live-call panel's buttons (offer times, cancel/confirm a call) show theirs **under the live-call panel**.
   - Tester: the live-call panel's buttons (Book, Cancel) stop once for the call triggers above (a time taken, moved,
     removed or cancelled since the page loaded) with the box **under the live-call panel**.
   - Pressing again goes ahead (unless it can't happen any more: then a final refusal in the same place).
   - Testers are never stopped for term changes: contracts can't change after joining. If the developer stops the
     test or ends a tester early, the tester's page shows one line at the top of their session page ("Nora Lane ended
     your session early on Oct 22. Work you sent is still reviewed.") and any later press is refused with that reason.
   - A tester can only send the parts in their contract (written answers, recording, live call as agreed); the server
     refuses anything else.
   Earlier wording of this rule, kept for reference:
   **Stop once, only on the top panel.** The test page's top title panel holds the developer's big buttons:
   **Offer call times / book**, **Stop the test**, **End early** (for a tester), **Next round**. If since the page
   loaded a tester **booked a live call** (or cancelled one), a tester **left**, a **new tester joined**, or a tester
   **sent work**, the press does NOT go through: a box
   directly under the top title panel lists exactly what changed ("Ana Silva sent her written answers · 3:12 PM";
   "Ben Carter left the test"; "Cara Diaz joined") and says "Press again to go ahead." The second press goes ahead.
   That box is the only live-update box on the page. Nothing else stops once.
5. **Everywhere else, the server is the safety net:** every action re-checks on the server; if it can't happen any
   more it is refused with a plain sentence where the button was ("Ana Silva already left the test."). If the page
   is out of date the message adds "Refresh to see the latest."
6. Wording rules from the full app still apply: "they" unless a pronoun is on record; a red * for required, never
   "(optional)"; never tell testers about holds, suspensions or chargebacks (they read "paused" or "delayed").

## Edit and two tabs (the only multi-tab handling)
- The test has a `version` number. Edit's Save sends the version it loaded. If the test changed since (another tab,
  a join that used a spot, Next round, Stop), Save stops once and lists what changed under Save; the second press
  saves the typed values on top (fields the user didn't touch take the newer values).
- Joining sends the listing version the tester saw. If the listing changed since, the join stops once and shows the
  new terms; the second press joins on the new terms. A test that closed/filled/stopped refuses the join for good.
- Spots can't go below the testers already in; Save refuses with the count.
- Deleting or closing the test in one tab: any later press in another tab is refused ("This test was stopped.").
- Contracts are snapshots at join, so Edit never changes working testers' questions, prices, deadline or call terms.

## Keep
Accounts (developer, tester, both; email sign-in links + Google), tester profile (devices, categories, languages),
post/edit a test, find and join, written answers + recording upload (Cloudflare R2 when configured, local disk in
dev; 500 MB, 5 per session), review with pay amount, Stripe charge + Connect payouts + platform fee, live calls as
above, simple per-test chat between developer and each tester, emails for key events (joined, sent, reviewed, paid,
call booked/cancelled), admin (disputes, suspensions, users, tests, payouts, waitlist), waitlist landing page.

## Cut for launch
Several parts per test with per-part requests, extra parts, drops, the change panel, Already completed, invites,
moves, access keys, NDA (a "keep it private" tick on joining instead), excerpts, AI themes/transcripts, ratings,
per-panel live boxes, chargeback automation (handle Stripe disputes manually in admin), outages logic.

## Stack and quality
Next.js 15 + React 19 + TypeScript + Tailwind, Prisma 6 + Postgres (local: postgresql://postgres@localhost:5499/playtest_lite;
tests in schema `test`), Stripe (test mode), Resend (dev outbox fallback), same patterns as C:/Users/march/Projects/rackscout
(auth, outbox, admin, check script, evidence script). Tests for every money rule, the stop-once rule, the version
check, contract snapshots, data isolation. `npm run check` green. Commits with "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>".
