# Overnight Dec 10: one-line stops, invites, two copies, offline

Desktop recordings (1280x900 windows), Nora (developer) on the left and Ana (tester) on the right unless the video says otherwise (two tabs or two browsers of one person).
Each video has a caption band at the bottom; the steps below are the captions with their time in the video. Every video is here as `.webm` (in the report) and `.mp4`.
Recorded against the media server (fake Stripe, dev outbox) with throwaway accounts. Where a step was set up directly in the database or by an admin off camera, the caption says so.

How a stop is produced on camera: the other person's change is made right after the presser's page had its live update (every ~20 s), and the press follows within a few seconds, so the page hasn't shown the change yet. Where an admin (the team) or Nora acts "off camera", it went through the same API her page uses.

Words: "the one line" = the blue line under a stopped button ("Your … didn't go through: check the updates at the top. Press again to go ahead."); "the top box" = the updates box at the top of the page; "the full box" = the kept stop box ("Your … didn't go through." + what changed + "Press … again to go ahead.").

Two-copy and offline videos slow one press on purpose: its answer is held back for the seconds the caption says, as on a slow connection (the press itself reaches the server at once).

The media server is a development server: a page's first load after the server restarts can take a few seconds, and offline pages show without their styles. Neither is the app.

## A1 · Session page: Send Answers stopped once (the one line)

File: `a1-send-answers-stop-line.webm` (also `a1-send-answers-stop-line.mp4`) · 2:07

Nora edits the listing; Ana's Send Answers shows one blue line and the change goes to the top box; the line survives her Alerts toggle and a live redraw; the next press clears it and shows the red mistake; another edit: the line, the red mark and the top box all at once; fixed and sent.

Steps:

- 0:02 Ana types her answers. Her page loaded before Nora's next change.
- 0:25 Nora edits the listing in her window (Edit, What should testers do?, Save).
- 0:29 Ana presses Send Answers before her page updates.
- 0:33 Stopped once: ONE blue line under the button. Nora's change went into the updates box at the top at once.
- 0:43 Ana turns her Alerts off, then on again: the line under Send Answers stays.
- 0:51 Nora changes the listing again (its build link, off camera): Ana's page redraws live. The line still stays.
- 1:07 Ana shortens her first answer to 12 characters and presses Send Answers again.
- 1:13 Clear, then the new outcome: the blue line is gone (this was the second press) and the red mistake shows at the box.
- 1:38 Nora edits the listing once more (Edit, Save). Ana, still with the short answer, presses Send Answers.
- 1:43 Everything at once: the line under the button, the red mark at the answer, and Nora's change in the top box.
- 1:53 Ana presses again without fixing it: the line clears, the red mistake comes back (still true).
- 1:57 She fixes the answer and presses Send Answers: it goes ahead.
- 2:02 Nora's page shows Ana's answers live.

Same for:

- The one line: Send Answers, Add to this answer / Answer this question, recording Send / Add, Switch / Keep, Charge / Let it go, Dispute, Leave, Rate, Request a time, a call request's Accept / Decline / Withdraw, Cancel call / Cancel the remaining calls (all checked against what changed since the page loaded; with Alerts Off only new terms, her own presses in another tab, Nora's side of her dispute, the team's decision on it and a payment on the part she presses about still stop).
- Red mistakes that come back while still true: Send Answers and Add (at least 50 characters, Answer at least one question), Dispute (a sentence), Charge (the amount), Rate (stars), Request a time (time, length), Cancel call under 24 hours (a reason).

## A2 · Session page: refused for good (a pause; the work ended)

File: `a2-session-refusals.webm` (also `a2-session-refusals.mp4`) · 1:45

The team pauses the test: Ana's Add is refused; the page redraws without Add and the line stays where it was (another press doesn't remove it; after the lift it stays until Add is pressed again or the page reloads). Nora ends Ana's work early: Ana's Request a time is refused, the page loads again at its top and the line comes back where the button was.

Steps:

- 0:02 Ana opens Add to this answer and writes an addition.
- 0:19 The team pauses the test (an admin, off camera). Nora's page shows the pause.
- 0:33 Ana presses Add to my answer before her page updates.
- 0:37 Refused for good, under the button: “This test is paused right now, so your Add didn't go through.” The page redraws: Add goes away, the line stays where it was and the draft is kept.
- 0:43 Same for “This test is paused right now”: Send Answers, recording Send / Add, Request a time, Accept a call request. Charge, Let it go and Rate: “This test is paused, so …”. Never refused for a pause: Leave, Dispute, Switch / Keep, Cancel call.
- 0:52 Another press on the page (her Alerts button) doesn't remove it: a line refused for a pause stays.
- 1:01 The team lifts the pause: Add to my answer comes back with her draft. The line stays under it until she presses Add again or reloads.
- 1:07 Ana fills in a call request (a time and 30 minutes).
- 1:18 Nora ends Ana's work early in her window (End early, Ana, a reason, End their work now).
- 1:23 Ana presses Request a time before her page updates.
- 1:25 Refused for good: her part is over. The page loads again at its top, and the line comes back where the button was (within 30 s of the press).
- 1:35 Same for “Your part in this test has ended” (and “This test was stopped” after Nora's Stop): Send Answers, Add, recording Send / Add, Switch / Keep, call Accept / Decline / Withdraw, Cancel call. Leave is silent; Dispute, Charge and Rate keep their own rules.

Same for:

- “This test is paused right now, so your … didn't go through.”: Send Answers, Add, recording Send / Add, Request a time, Accept a call request. Charge, Let it go and Rate read “This test is paused, so …”. Join call reads “…: this test is paused.” Never refused for a pause: Leave, Dispute, Switch / Keep, Cancel call, Withdraw a request.
- “Your part in this test has ended” / “This test was stopped” / “This test ended” (the page loads again at its top, the line kept): Send Answers, Add, recording Send / Add, upload, Remove, Switch / Keep, Request a time, a call request's Accept / Decline / Withdraw, Cancel call, Cancel the remaining calls. Leave is silent on an ended part; Dispute, Charge and Rate keep their own rules.
- Ana's own suspension (“Your account is paused, so your … didn't go through.”): every session-page press except Dispute.

## A3 · Session page: the NDA line and the new-terms line

File: `a3-session-block-lines.webm` (also `a3-session-block-lines.mp4`) · 1:49

Nora adds an NDA: Ana's Send Answers reads “Acknowledge the NDA change first at the top of the page.” and the page stays put. Nora raises the price: Ana's Request a time reads “Answer the new terms first: Switch or Keep at the top of the page.”; Switch / Keep is at the top. After acknowledging / Keep, the presses go ahead.

Steps:

- 0:02 Ana types her answers.
- 0:22 Nora adds an NDA to the listing in her window (Edit, NDA, Save).
- 0:24 Ana presses Send Answers before her page updates.
- 0:29 The line: “Acknowledge the NDA change first at the top of the page.” Her page doesn't move.
- 0:30 Ana scrolls up at once: the NDA notice at the top has a ring (for about 4 seconds). She acknowledges it.
- 0:46 Send Answers again.
- 0:52 Same for the NDA line: Add, recording Send / Add, Charge, Let it go, Dispute, Switch / Keep, Request a time, call Accept / Decline / Withdraw, Cancel call, Report a call problem, chat Send. Not for Leave or Rate.
- 1:01 Ana fills in a call request.
- 1:18 Nora raises the written answers' price to $12 in her window (Edit, Save): new terms for Ana.
- 1:19 Ana presses Request a time before her page updates.
- 1:22 The line: “Answer the new terms first: Switch or Keep at the top of the page.” The page stays put; Ana scrolls up at once: the Switch / Keep box has a ring (about 4 seconds).
- 1:29 Ana keeps her current terms, then presses Request a time again.
- 1:37 Same for the new-terms line: Send Answers, Add, recording Send / Add, Charge, Let it go, Dispute, call Accept / Decline / Withdraw, Cancel call, Join call. Leave and Rate aren't blocked: they stop once.

Same for:

- The NDA line: Send Answers, Add, recording Send / Add, Charge, Let it go, Dispute, Switch / Keep, Request a time, a call request's Accept / Decline / Withdraw, Cancel call, Cancel the remaining calls, Report a call problem, chat Send. Not Leave, Rate, uploads, Ask the developer, the join page or the developer's presses.
- The new-terms line (while her part is working): Send Answers, Add, recording Send / Add, Charge, Let it go, Dispute, Request a time, a call request's Accept / Decline / Withdraw, Cancel call, Cancel the remaining calls, Join call. Leave and Rate aren't blocked: they stop once with the new terms (I2).

Found:

- After “Acknowledge the NDA change first at the top of the page.” the NDA notice was not at the top: Ana's page had not shown the NDA change yet, and the notice only appeared with the next live update about 18 s later, without its ring (frames at 0:31–0:45). The new-terms line in the same video found Switch / Keep at the top at once. (Possibly because src/components/NdaNotice.tsx draws the notice keyed by the change's time, so the copy that asked for the page to load it again is replaced before it can mark it; not checked further.)
- The ring on the notice lasts 4 seconds (lib/markJump.ts markOnly) while the page stays put, so when the notice is off screen the ring is usually gone before the tester has scrolled up to it.

## A4 · Session page: questions changed; an empty Send refused

File: `a4-session-questions-changed.webm` (also `a4-session-questions-changed.mp4`) · 1:45

Nora adds a question: Ana's Send Answers stops once and the form shows the new question (her answers kept); answered, it goes. Nora adds another: Send Answers with the new box empty is refused (“Answer at least one question …”), nothing is sent and the pay-by date doesn't move.

Steps:

- 0:02 Ana types answers to the two questions.
- 0:18 Nora adds a third question (“Would you play level 4?”; her Save, off camera). Her page shows three questions.
- 0:22 Ana presses Send Answers before her page updates.
- 0:26 Stopped once: one line, the change in the top box, and the form now shows the new questions (her two answers kept).
- 0:35 Ana answers the new question too and presses Send Answers again: it goes ahead.
- 0:40 Nora adds a fourth question (off camera). Ana's page shows it live with an empty box.
- 1:28 Ana presses Send Answers with the new box empty.
- 1:32 Refused with “Answer at least one question”; nothing is sent, and the pay-by date stays where it was (Dec 18 02:10 before, Dec 18 02:10 after, UTC).

Same for:

- The questions-changed stop: Add to this answer / Answer this question (a removed question stops it the same way, whatever her Alerts).

Notes:

- 0:40–1:28: the recorder waited for the fourth question's text to show; it was there but in a folded part of the page, so the video sits still for a while.

## A5 · Session page: Dispute, Request a time, a call request, Leave

File: `a5-session-dispute-request-leave.webm` (also `a5-session-dispute-request-leave.mp4`) · 2:39

Dispute: a red reason, then the one line, then sent. Request a time: the one line, then sent. A call request Nora withdraws: Accept refused for good (the request stays listed, marked Withdrawn). Leave: the one line, then she leaves.

Steps:

- 0:02 Nora paid $6.00 of $10.00 for Ana's answers. Ana opens Dispute the pay and writes only “Low”.
- 0:05 Red mistake at the reason (nothing sent): it needs at least a sentence.
- 0:38 Nora edits the listing in her window (Edit, Save).
- 0:39 Ana presses Send the dispute before her page updates: one line under the button; the change is in the top box.
- 0:46 Pressed again: the dispute goes ahead. Nora's page shows it live.
- 0:56 Ana fills in a call request (a time, 30 minutes).
- 1:18 Nora edits the listing again (Edit, Save).
- 1:19 Ana presses Request a time: one line. Pressed again: the request goes to Nora.
- 1:35 Nora asks Ana for a call (Request a time, off camera); Ana's page shows the request live.
- 1:46 Nora withdraws her request (off camera); Ana presses Accept before her page updates.
- 1:52 Refused for good: “Nora Lane withdrew this request, so your Accept didn't go through.” The request stays in the list, marked Withdrawn, with the line above it.
- 1:57 Same for: Decline (withdrawn or closed requests), and Accept also when the test is paused, the call limit is reached or the time clashes.
- 2:10 Nora edits the listing once more (Edit, Save).
- 2:12 Ana presses Leave this test (and confirms) before her page updates: one line under Leave.
- 2:18 Pressed again: Ana leaves the test. Nora's page shows it live.
- 2:30 The stop line works the same way on every session-page button that a change can stop: Send Answers, Add, recording Send / Add, Switch / Keep, Charge / Let it go, Dispute, Leave, Rate, Request a time, call Accept / Decline / Withdraw, Cancel call.

Same for:

- The one line: Send Answers, Add to this answer / Answer this question, recording Send / Add, Switch / Keep, Charge / Let it go, Dispute, Leave, Rate, Request a time, a call request's Accept / Decline / Withdraw, Cancel call / Cancel the remaining calls (all checked against what changed since the page loaded; with Alerts Off only new terms, her own presses in another tab, Nora's side of her dispute, the team's decision on it and a payment on the part she presses about still stop).
- A call request closed or withdrawn: Accept and Decline are refused the same way (Withdraw on her own closed request is silent).

## A6 · Session page: Charge / Let it go and Rate

File: `a6-session-charge-rate.webm` (also `a6-session-charge-rate.mp4`) · 2:11

Charge stops once for Nora's edit; then the team pauses the test and the second Charge is refused for good (“This test is paused, so your Charge didn't go through.”). After the lift Nora pays; Rate stops once, then goes.

Steps:

- 0:02 Nora didn't pay in time: Ana can charge her card or let it go (the dates were moved on in the database to get here).
- 0:26 Nora edits the listing in her window (Edit, Save).
- 0:32 Ana presses Charge before her page updates: one line under the buttons; the change is in the top box.
- 0:58 Before Ana presses again, the team pauses the test (an admin, off camera). Nora's page shows the pause.
- 1:06 Ana presses Charge again before her page updates: refused for good, “This test is paused, so your Charge didn't go through.”
- 1:14 Same for Let it go. Both are also refused when Nora paid meanwhile, when a payment is being confirmed, and once their date has passed.
- 1:21 The team lifts the pause; Nora pays the $10.00 (her Pay, off camera). Both pages show it live.
- 1:54 Everything is paid, so Ana can rate Nora. Nora edits the listing again.
- 1:55 Ana picks 5 stars and presses Rate before her page updates: one line under Rate.
- 2:02 Pressed again: the rating goes ahead.

Same for:

- Charge's refusals for good, the same for Let it go: the test paused, Nora paid meanwhile, a payment being confirmed, the date passed, already settled.

Notes:

- “Nora paid meanwhile” wasn't filmed: a payment reaches Ana's page at once (her Charge button goes before she can press it), so the team's pause is used for the refusal.

## B1 · Join page: the one line on Join, Apply, Ask to rejoin, No thanks

File: `b1-join-page-stop-lines.webm` (also `b1-join-page-stop-lines.mp4`) · 2:42

Nora edits the listing each time; on the join page the press shows one line (whatever Ana's Alerts) and the next press goes ahead: Join, Apply to join, Ask to rejoin, No thanks. Withdraw application after a tester-deadline change goes straight through.

Steps:

- 0:18 Ana reads the listing. Nora edits it in her window (Edit, Save).
- 0:19 Ana presses Join this test before her page updates: one blue line under the button; the change is in the box at the top.
- 0:28 Pressed again: Ana joins (her session page opens).
- 0:38 Night Harbor takes applications. Ana writes a note.
- 0:59 Nora edits the listing (Edit, Save).
- 1:00 Apply: one line; pressed again, the application goes to Nora.
- 1:19 Nora changes the tester deadline (7 → 10 days, off camera): it no longer closes applications. Ana presses Withdraw application before her page updates.
- 1:23 It goes straight through: a deadline change isn't one of the join page's changes. (Nora's edits can't stop Withdraw now: the edits the join page lists close the application first, and Withdraw then goes quietly.)
- 1:30 Storm Coast: Ana left it earlier, so she can ask to rejoin.
- 1:51 Nora edits Storm Coast's listing (Edit, Save).
- 1:52 Ask to rejoin: one line; pressed again, Nora gets the request.
- 2:00 Open Sea Run: Nora invited Ana. The invite has Join and No thanks.
- 2:21 Nora edits Open Sea Run's listing (Edit, Save).
- 2:22 No thanks: one line; pressed again, the invite is declined (Ana goes to her dashboard).
- 2:35 On the join page these lines stop the press whatever Ana's Alerts are. No thanks isn't stopped by “full” or “a spot opened” lines.

Same for:

- The join page's one line: Join, Apply, Ask to rejoin, No thanks (No thanks ignores “full” and “a spot opened”).

Not reachable (and why):

- Withdraw application's one line from Nora's edits: the edits the join page lists are the ones that close applications (src/lib/server/tests.ts CLOSING_FIELDS: steps, link, prices, parts, questions, NDA, devices, languages), so the application closes and Withdraw then goes quietly; the other edits (tester deadline, spots, Open until, categories, name) aren't join-page changes (checked through the API: Withdraw went ahead each time).

## B2 · Join page: refused for good

File: `b2-join-page-refusals.webm` (also `b2-join-page-refusals.mp4`) · 2:18

Full (Ben took the last spot), paused (the team's pause; the same words for a hold or a suspension), Open until passed, and invite only (first the one line for the listing change, then refused).

Steps:

- 0:17 Harbor Run has 1 spot. Ben joins it (off camera); Nora's page shows it full.
- 0:22 Ana presses Join this test before her page updates: refused, the test is full.
- 0:30 Same for Apply and Ask to rejoin. The page redraws without the join card.
- 0:55 Night Harbor: the team pauses it (an admin, off camera); Nora's page shows the pause.
- 1:01 Ana presses Join: “This test isn't taking new testers right now” (never says why; the same for a hold or a suspension).
- 1:30 Storm Coast: its Open until passes (moved to yesterday in the database, as the clock would).
- 1:32 Ana presses Join: refused, the test closed to new testers on that date.
- 2:01 Open Sea Run takes applications. Nora switches it to invite only (Edit, How testers join, Save).
- 2:02 Ana presses Apply: first the one line (the listing changed).
- 2:06 Pressed again: refused, the test is invite only.
- 2:13 Same for Join. Ask to rejoin is never refused for invite only.

Same for:

- Full, paused and Open until passed: Join, Apply, Ask to rejoin (Withdraw and No thanks aren't refused for them).
- Invite only: Join and Apply; Ask to rejoin is never refused for it.

Not reachable (and why):

- These refusals show only from a join page that hasn't redrawn yet: once it redraws, a paused, full or closed test has no join card.

## C1 · Test page: Accept, Pay, Pay more

File: `c1-test-page-applications-pay.webm` (also `c1-test-page-applications-pay.mp4`) · 2:14

Ana withdraws her application: Nora's Accept is refused for good. Ana adds to her answer: Nora's Pay stops once (one line, the change in her top box). Ana leaves: Nora's Pay more stops once.

Steps:

- 0:01 Ana applies to join (Apply to join).
- 0:05 Nora's page shows the application live.
- 0:21 Ana withdraws her application; Nora presses Accept before her page updates.
- 0:28 Refused for good: “Ana Silva withdrew her application.” (Decline on a withdrawn application is silent.)
- 0:33 Ana applies again (off camera); Nora accepts. Ana is in.
- 0:42 Ana sends her written answers.
- 0:55 Nora reads them and gets ready to pay $10.00 (the amount, the tick).
- 1:12 Ana adds to her answer; Nora presses Pay before her page updates.
- 1:18 Stopped once: one line under Pay; “Ana Silva added to her answer …” is in Nora's top box (this stops Pay on that part whatever her Alerts).
- 1:25 Pressed again: Nora pays $10.00 (fake card). Ana's page shows the payment live.
- 1:33 Nora wants to pay $2.00 more for the addition.
- 1:52 Ana leaves the test; Nora presses Pay more before her page updates.
- 1:58 Stopped once: one line; “Ana Silva left the test” is in the top box, and the red mistake shows at the tick Nora hadn't ticked. Pressed again: the blue line clears and the red mistake stays until she ticks it (nothing is paid).
- 2:06 Same stop line for Nora's other presses (Accept / Decline, Invite, Cancel invite, Request a time, call answers, Cancel call, End early, Stop the test) when a tester's change comes in, under her test's Alerts.

Same for:

- The developer's one line (her test's Alerts decide which tester changes stop her): Accept / Decline, Invite / Invite anyway, Cancel invite, Pay, Pay more, Request a time, a call request's Accept / Decline / Withdraw, Cancel call, Cancel the remaining calls, End early, Stop the test. A tester's added work stops Pay on that part, and a tester leaving or disputing stops presses about that tester, whatever the Alerts.

## C2 · Test page: a call request, Invite anyway, Stop, the team's pause

File: `c2-test-page-calls-invite-stop.webm` (also `c2-test-page-calls-invite-stop.mp4`) · 1:34

Ana withdraws her call request: Nora's Accept is refused. Invite asks first for a tester missing a need (Invite anyway); Ana's new request stops it once; pressed again, Bram is invited. Ana's answers stop Stop the test once. The team pauses the test: Nora's Accept is refused and the page goes to its top.

Steps:

- 0:00 Ana asks Nora for a call (Request a time).
- 0:15 Ana withdraws her request; Nora presses Accept before her page updates.
- 0:22 Refused for good: the line under Accept says Ana withdrew this request.
- 0:27 Nora invites Bram: she finds him and ticks him. The test needs an iPad, which Bram doesn't list.
- 0:32 Invite asks first: Bram is missing what the test needs. Nora can Invite anyway.
- 0:38 Ana sends a new call request; Nora presses Invite anyway before her page updates.
- 0:43 Stopped once: one line; Ana's request is in the top box. Pressed again: Bram is invited.
- 0:56 Ana sends her written answers; Nora presses Stop the test (reason written) before her page updates.
- 1:01 Stopped once: one line under Stop the test; “Ana Silva sent her written answers” is in the top box.
- 1:05 Same for End early. Nora doesn't press again here: the test stays open for the team's pause next.
- 1:11 The team pauses the test (an admin, off camera). Nora presses Accept on Ana's call request before her page updates.
- 1:18 Refused for good: “The team paused this test, so your Accept didn't go through.” Nora's page goes to the test's top, where the banner names the press.
- 1:24 Same while the team's pause is on: Pay, Pay more, Invite, Request a time, Next round … (Stop the test, End early and Cancel call still work). A hold reads “Your tests are paused”, a suspension “Your account is suspended”.

Same for:

- The team's pause refuses every test-page press except Stop the test, End early, Cancel call, Send your side, chat and Rate; a payment hold reads “Your tests are paused”, a suspension “Your account is suspended”.

Found:

- The team-pause refusal names the press two ways on one screen: the kept line reads “The team paused this test, so your Accept didn't go through.” while the banner under “The team paused this test.” reads “Your Answer on Harbor Run: 3 levels didn't go through.” (1:20).

## D1 · Two copies: the session page

File: `d1-two-copies-session-page.webm` (also `d1-two-copies-session-page.mp4`) · 1:09

Tab 2 waits (“Saving changes in other tab…” with Open now, buttons locked) while tab 1's Send is on its way, then takes the page; then Open now while tab 2's Add is on its way (the Add still goes through, tab 2 goes to the dashboard); then a Request a time on its way, which a new copy doesn't wait for. The 10-second takeover is in D5.

Steps:

- 0:00 Tab 1: Ana types her answers.
- 0:03 Tab 1: Send Answers. Its answer is held 9 s on the way back (a slow connection).
- 0:04 Tab 2 opens the same page: “Saving changes in other tab…” with Open now; every button is locked while it waits.
- 0:10 Tab 1's press finishes; tab 1 hands over and goes to the dashboard (“This page was opened somewhere else.”). Tab 2 redraws with the sent answers.
- 0:20 Tab 2 now holds the page. Ana adds to her answer there; its answer is held 25 s.
- 0:24 Tab 1 opens the page again: it waits. Ana presses Open now: tab 1 takes the page at once.
- 0:30 Tab 2's Add still goes through when its answer arrives; tab 2 then goes to the dashboard. Tab 1 shows the addition.
- 0:38 Found: tab 1's Add box on the first question holds “One more thing: the lighthouse level has no c…” as an unsent draft, though tab 2's addition with these words went through.
- 0:44 Tab 1 holds the page. Ana asks Nora for a call (Request a time); its answer is held 18 s.
- 0:45 Tab 2 opens the page and takes it at once: Request a time doesn't lock the page, so a new copy doesn't wait for it (Send Answers and Add do: parts 1 and 2; the 10-second takeover is in D5).
- 0:48 Tab 1's request still goes through when its answer arrives; tab 1 has already gone to the dashboard (“This page was opened somewhere else.”).
- 1:03 Tab 2 (reloaded): tab 1's call request is on the page.

Found:

- After Open now, while tab 2's Add (“One more thing: the lighthouse level has no checkpoint …”) was still on its way, tab 1's Add box on that question held the same words as an unsent draft, though the addition went through a moment later: pressed again, it would add the same text twice.

## D2 · Two copies: the test page and Edit

File: `d2-two-copies-test-page-edit.webm` (also `d2-two-copies-test-page-edit.mp4`) · 0:27

The test page and Edit are one page: Edit opened while the test page's Accept is on its way waits, then is drawn with it. Edit opened again in the first tab while the second has typing but no press on its way takes the page at once, and the typing comes across.

Steps:

- 0:01 Tab 1 (test page): Nora accepts Ana's application; its answer is held 9 s.
- 0:02 Tab 2 opens Edit for the same test (the test page and Edit are one page): it waits, buttons locked.
- 0:08 Tab 1's Accept finishes; tab 1 goes to the dashboard. Tab 2's Edit is unlocked and drawn again with the change.
- 0:15 Tab 2 types a change in Edit (not saved). Tab 1 opens Edit too: tab 2 has no press on its way, so tab 1 takes it at once and tab 2 leaves, keeping its typing as a draft.

## D3 · Two copies: the join page

File: `d3-two-copies-join-page.webm` (also `d3-two-copies-join-page.mp4`) · 0:16

A second join page waits while the first one's Apply is on its way, then shows the application.

Steps:

- 0:00 Tab 1: Ana presses Apply to join; its answer is held 9 s.
- 0:01 Tab 2 opens the same join page: “Saving changes in other tab…”, buttons locked.
- 0:06 Tab 1's Apply finishes; tab 1 goes to the dashboard; tab 2 redraws showing the application.

## D4 · Two copies: Profile, Notifications, Payments

File: `d4-two-copies-account-pages.webm` (also `d4-two-copies-account-pages.mp4`) · 0:45

Profile and Notifications: the new copy waits for the old copy's Save, then shows it. Payments: opened again with nothing on its way, it moves at once.

Steps:

- 0:01 Profile, tab 1: Ana picks a pronoun and presses Save profile; its answer is held 8 s.
- 0:02 Tab 2 opens Profile: it waits (buttons locked), then redraws with the saved pronoun; tab 1 goes to the dashboard.
- 0:16 Notifications, tab 1: Ana turns email Off and presses Save; its answer is held 8 s.
- 0:17 Tab 2 opens Notifications: it waits, then shows email Off; tab 1 goes to the dashboard.
- 0:33 Payments: tab 1 has it open with no press on its way. Tab 2 opens Payments: it takes the page at once; tab 1 goes to the dashboard.
- 0:38 Payments' presses (Connect a payout account, Change card) go on to Stripe's own pages, so a new copy rarely finds one on its way; the same wait applies when it does.

## D5 · Two copies: the 10-second takeover

File: `d5-two-copies-ten-second-takeover.webm` (also `d5-two-copies-ten-second-takeover.mp4`) · 0:28

Tab 1's Apply is on its way (its answer held 16 s); tab 2 opens the join page, waits about 10 s and takes the page by itself; tab 1's Apply still goes through and tab 1 then goes to the dashboard.

Steps:

- 0:02 Tab 1: Ana presses Apply to join; its answer is held 16 s (a slow connection).
- 0:03 Tab 2 opens the same join page: “Saving changes in other tab…”. Nobody presses Open now.
- 0:16 After about 10 s (here 13.1 s from opening) tab 2 takes the page by itself, while tab 1's Apply is still on its way.
- 0:18 Tab 1's Apply still goes through when its answer arrives; then tab 1 goes to the dashboard (“This page was opened somewhere else.”).
- 0:21 Tab 2, reloaded, shows the application.

## E1 · Account pages: Nora

File: `e1-account-pages-developer.webm` (also `e1-account-pages-developer.mp4`) · 1:02

The full box “Changed in another tab or device since you opened this page:” on Notifications (Password changed at …), Account (Email: Off → Daily) and Payments (Payout account: not connected → connected).

Steps:

- 0:00 Tab 2: Notifications is open. In tab 1 (Account), Nora changes her password.
- 0:04 Tab 2: she turns email Off and presses Save: the kept box “Changed in another tab or device since you opened this page:” lists “Password changed at …”.
- 0:12 Save again: it goes ahead.
- 0:15 Tab 1 opens Account again (a second Account page is allowed: it isn't one-at-a-time). Tab 2 (Notifications) switches email back On, Daily, and saves.
- 0:21 Tab 1: Nora presses “Start testing too” (add the tester side): the kept box lists “Email: Off → Daily”.
- 0:28 Pressed again: the tester side is added (tab 1 goes on to her tester profile).
- 0:33 Profile: what reaches it from another page is “Sides” (Account) or “Name” (only Profile itself). Adding a side opens Profile in that same tab, which takes the page from any other Profile copy, so Nora's Profile can't show this box now; Ana's video shows it.
- 0:41 Tab 2 opens Payments. Stripe tells the app her payout account is now connected (as after setup on her phone; the fake Stripe's message).
- 0:51 Nora presses Continue setup just as her page redraws by itself to “connected”: no press went out and no box shows (in Ana's video, E2, the same line stops the press with the box).

Not reachable (and why):

- Nora's Profile box: what can reach Profile from another page is “Sides” (Account's add-a-side, which opens Profile in that same tab and so takes the page from any Profile copy) or a profile field (only Profile itself saves them), so with one page at a time it can't show for her now; Ana's video shows it, from a Profile tab opened before she added her developer side.
- Payments' “Card” and “Subscription” lines: changed only on Payments itself (one copy at a time) or by the chargeback card check during a hold (not recorded); the payout line is shown instead, from Stripe's own message.

## E2 · Account pages: Ana

File: `e2-account-pages-tester.webm` (also `e2-account-pages-tester.mp4`) · 1:04

The full box on Profile (Sides: tester → developer and tester), Notifications (Name: …), Account (Email: Weekly → Off) and Payments (Payout account: not connected → connected).

Steps:

- 0:00 Tab 2: Profile is open. In tab 1 (Account), Ana adds the developer side.
- 0:01 Tab 2: she picks another device and presses Save profile.
- 0:04 The kept box: “Changed in another tab or device since you opened this page: Sides: Tester → Developer and tester”.
- 0:08 Save profile again: it goes ahead.
- 0:12 Tab 1 opens Notifications. In tab 2 (Profile), Ana changes her name to “Ana S. Silva” and saves.
- 0:16 Found: this Save profile is stopped again with the same “Sides” line, though the last Save profile on this page went ahead (and saved this page's sides over it). Pressed again, the name is saved.
- 0:25 Tab 1: Ana changes her email setting and presses Save: the kept box lists “Name: Ana Silva → Ana S. Silva”.
- 0:35 Tab 2 opens Account. Tab 1 (Notifications) turns email Off and saves (it goes ahead).
- 0:39 Tab 2: Ana changes her password: the kept box lists “Email: … → Off” first; pressed again, the password is saved.
- 0:50 Tab 2 opens Payments. Stripe tells the app Ana's payout account is connected (the fake Stripe's message, as after setup on her phone).
- 0:54 Ana presses the payout button: the kept box lists “Payout account: not connected → connected”.

Found:

- Profile: after Save profile went ahead on its second press (saving this page's sides, which removed the developer side tab 1 had just added), the next Save profile on the same page (a name change) was stopped again by the same “Sides: tester → developer and tester” line; only the press after that saved the name.
- Payments: Ana pressed “Continue setup”; the box under the payout button reads “Your Change payout details didn't go through … Press Change payout details again”: it names the button the redrawn page shows (now connected), not the one she pressed.

## F1 · Edit's Save keeps its full box

File: `f1-edit-save-kept-box.webm` (also `f1-edit-save-kept-box.mp4`) · 0:50

A team pause and lift since Edit opened: Save shows the full box (“Since you opened this page: The team paused this test at … The team lifted its pause …”), and the next Save goes. Then why the three-value box can't show now.

Steps:

- 0:00 Browser 1: Nora types a change in Edit.
- 0:01 The team pauses the test (an admin, off camera), then lifts the pause, both after Edit opened.
- 0:12 Nora presses Save: Edit keeps its full box under Save (“Your Save didn't go through. Since you opened this page: …”), not the one line.
- 0:22 Save again: it goes ahead.
- 0:27 Browser 2 opens Edit (it holds the page). Browser 1 opens Edit too, but offline just as it opens: its claim fails, so browser 2 keeps the page.
- 0:32 Offline, browser 1 types its own version of the steps (not saved).
- 0:33 Browser 2 changes the steps and saves (Edit's Save loads Edit again, which claims the page again).
- 0:37 Browser 1 comes back online: a copy claimed the page after browser 1 loaded, so browser 1 leaves for the dashboard (“This page was opened somewhere else.”).
- 0:42 So Edit's three-value box (Before / Now / What you typed) can't be reached now: any other Save of the same test claims the page after this copy loaded, and this copy leaves before its own Save.

Not reachable (and why):

- Edit's “Before / Now / What you typed” box: it needs another Save of the same test while this copy is open, but any other Save loads Edit again and claims the page after this copy loaded, so this copy leaves (“This page was opened somewhere else.”) before its own Save, even when its claim failed at open (offline): filmed in the second half.

## G1 · A pause keeps the invite

File: `g1-pause-keeps-invites.webm` (also `g1-pause-keeps-invites.mp4`) · 1:07

The team pauses the test: Ana's Join on her invite is refused (“isn't taking new testers right now”), her bell gets nothing, the invite stays open; after the lift the same invite works.

Steps:

- 0:00 Nora invited Ana; Ana's bell has the invite.
- 0:28 The team pauses the test (an admin, off camera). Nora's page shows the pause.
- 0:31 Ana presses Join on the invite before her page updates: refused, “This test isn't taking new testers right now”.
- 0:46 Ana's bell: nothing new about the pause (1 line before, 1 after). Her invite stays open.
- 0:49 The team lifts the pause. Ana's same invite works: she joins.
- 1:01 The same for a payment hold or a suspension of Nora: invites stay open and the invitee hears nothing.

## G2 · A full test keeps applications

File: `g2-full-keeps-applications.webm` (also `g2-full-keeps-applications.mp4`) · 0:53

Full: Ana's application stays pending and she's told nothing; Nora's Accept on her is refused (“This test is full.”); Cam (invited) is told it's full; after a new spot Accept goes ahead and Cam is told a spot opened.

Steps:

- 0:03 One spot. Ana and Ben applied; Cam is invited. Nora accepts Ben.
- 0:07 The test is full. Ana's application stays pending; her page and bell say nothing about it.
- 0:19 Nora presses Accept on Ana: refused, the test is full.
- 0:28 Cam (invited) is told the test is full; Ana (applied) is told nothing.
- 0:32 Nora adds a spot (Spots 1 → 2, off camera). Accept on Ana now goes ahead; Cam is told a spot opened.
- 0:48 Ana's bell: she's in.

## G3 · Edits, invite only, a test closing on its own

File: `g3-edits-invite-only-closing.webm` (also `g3-edits-invite-only-closing.mp4`) · 1:23

An edit doesn't send the invite again (Ana sees the edit in the top box and Join stops once). A Save switching to invite only closes Ana's application with the invite-only line. A test closing on its own rings its invitee.

Steps:

- 0:18 Nora invited Ana. Now she edits the listing (Edit, Save): the invite is NOT sent again.
- 0:20 Ana presses Join before her page updates: one line, the edit in the top box.
- 0:27 No new bell line for Ana (2 before, 2 after). Pressed again, Join goes ahead.
- 0:32 Night Harbor: Ana applied. Nora switches it to invite only and edits the steps in the same Save.
- 0:59 Nora's Save says “Closed 1 application: Ana Silva.” Ana's bell: “Night Harbor” is now invite only, so her application was closed (not “the listing changed”). Her join page now reads “This test isn't available right now.”
- 1:04 Storm Coast: Ana is invited. Its Open until passes with nobody working (moved in the database, as the clock would): the test closes on its own.
- 1:18 Ana's bell rings: “Your invite to “Storm Coast” was closed.”

## H1 · Offline

File: `h1-offline.webm` (also `h1-offline.mp4`) · 0:49

An offline press: “You seem to be offline. Check your connection and try again.”; back online it goes. A copy that opened offline (its claim failed) claims the page again when back online; when another copy claimed it meanwhile, it leaves for the dashboard.

Steps:

- 0:00 Browser 1: Ana types her answers, then her connection drops.
- 0:04 She presses Send Answers while offline. (The media server is a development server: its pages show without their styles while offline. The line under the button is the app's.)
- 0:10 Back online, she presses again: it goes through.
- 0:19 Browser 1 opens the session page, but the connection drops just as it opens: its claim on the page fails (no other copy is open).
- 0:23 Back online: browser 1 claims the page again by itself and stays (nobody else opened it).
- 0:26 Again browser 1 opens offline (claim failed). Ana types a draft addition there.
- 0:30 Meanwhile browser 2 (another window, still online) opens the same page and claims it.
- 0:33 Browser 1 comes back online: another copy claimed the page after it loaded, so browser 1 leaves for the dashboard (“This page was opened somewhere else.”).
- 0:42 Found: browser 2 (reloaded) opens Add to this answer and the box is empty: the addition browser 1 typed offline didn't come across.

Found:

- The copy that opened offline had an addition typed in its Add box; after it left (another copy had claimed the page), the other copy's Add box was empty after a reload (0:42–0:49): the typing didn't come across. (D2 shows typing coming across when the copy leaving held the page.)

## I1 · Switch / Keep: always the newest offer

File: `i1-switch-keep-newest-offer.webm` (also `i1-switch-keep-newest-offer.mp4`) · 1:21

With Alerts Off, a Switch naming an older offer stops once with the newest; a third offer between the stop and the second press stops it again; the third press switches.

Steps:

- 0:00 Ana turns her Alerts off (new terms still stop a press).
- 0:18 Nora raises the written answers' price to $12 (Edit, Save).
- 0:20 Ana's page shows the new terms live: Switch / Keep ($10 → $12).
- 0:38 Nora changes the price again, to $14 (Edit, Save).
- 0:39 Ana presses Switch on the $12 offer her page shows: stopped once (“changed the terms again”), and the box now offers $14.
- 0:58 Before Ana presses again, Nora changes the price a third time, to $16 (Edit, Save).
- 0:59 Ana presses Switch again (her page still offers $14): a newer offer exists, so it stops again, now with $16.
- 1:08 Third press, on the newest offer: Ana switches to $16.
- 1:15 Nora's page shows that Ana switched. Keep works the same way: a Keep naming an older offer stops with the newest.

## I2 · Switch / Keep: withdrawn, new offer, Leave

File: `i2-switch-keep-withdrawn-new-leave.webm` (also `i2-switch-keep-withdrawn-new-leave.mp4`) · 1:58

An offer withdrawn after a stopped Switch leaves one line; a new offer starts the box clean (Keep goes); Leave pressed before the live update loads Switch / Keep at once.

Steps:

- 0:18 Nora raises the price to $12 (Edit, Save).
- 0:38 Nora changes it again, to $14 (Edit, Save).
- 0:40 Ana presses Switch (her page shows $12): stopped once, the box moves to $14.
- 0:47 Nora sets the price back to $10, Ana's own terms (off camera): the offer is withdrawn.
- 1:03 After the live update one line is left: “Your Switch to the new terms didn't go through: These terms are no longer on offer.”
- 1:10 With that line showing, Nora offers $15 (off camera; the team first allowed more price changes): Switch / Keep appear without the old line.
- 1:18 Ana presses Keep my current terms: it goes ahead (“Kept your current terms.”).
- 1:40 Nora raises the price to $17 (Edit, Save).
- 1:42 Ana presses Leave this test before her page updates: one line under Leave, and Switch / Keep with $17 appear at once at the top (no scroll).
- 1:52 Same for Rate: a Rate stopped by new terms loads Switch / Keep at once.

## J1 · Home: full boxes

File: `j1-home-kept-boxes.webm` (also `j1-home-kept-boxes.mp4`) · 0:55

Confirm all with your bank stops with the full box when a new charge came in after Home loaded; the Calls box's Cancel (shown while Nora is suspended) stops with the full box for the team's pause.

Steps:

- 0:00 Ana and Ben charged Nora for unreviewed answers; her bank wants to confirm: Home shows “Confirm all (2)”.
- 0:06 Cam charges too (in his window), after Nora's Home loaded.
- 0:07 Nora presses Confirm all: Home keeps the full box under it (what changed, then “Press Confirm all again to go ahead.”).
- 0:19 Pressed again: the bank's check opens (the fake Stripe's stand-in); Nora confirms.
- 0:33 The team suspends Nora (an admin, off camera). Home's Calls box keeps a Cancel for her booked call with Ana.
- 0:37 After Nora's Home loaded, the team also pauses the test (off camera). Nora presses Cancel this call: Home keeps the full box, under the row.
- 0:47 Pressed again: the call is cancelled.

## Not reachable now (any page)

- A tester's press stopped by a Stop or an early end: only Dispute can show it; every other press is refused first because her part is over.
- A tester's Join call never stops once; the developer's Join call can only show a lift, since a paused test refuses it first.

## Not recorded

- Recording Send / Add (needs a real video upload), chat Send, Report a call problem, Join call (needs a call minutes away), Cancel the remaining calls, Ask the developer: listed in the Same for lines only.
- Payment holds and developer suspensions as the cause of the join-page and invite refusals: only the team's pause is filmed; the code gives the same words for all three (Same for lines).

## All Found

- A3 · Session page: the NDA line and the new-terms line: After “Acknowledge the NDA change first at the top of the page.” the NDA notice was not at the top: Ana's page had not shown the NDA change yet, and the notice only appeared with the next live update about 18 s later, without its ring (frames at 0:31–0:45). The new-terms line in the same video found Switch / Keep at the top at once. (Possibly because src/components/NdaNotice.tsx draws the notice keyed by the change's time, so the copy that asked for the page to load it again is replaced before it can mark it; not checked further.)
- A3 · Session page: the NDA line and the new-terms line: The ring on the notice lasts 4 seconds (lib/markJump.ts markOnly) while the page stays put, so when the notice is off screen the ring is usually gone before the tester has scrolled up to it.
- C2 · Test page: a call request, Invite anyway, Stop, the team's pause: The team-pause refusal names the press two ways on one screen: the kept line reads “The team paused this test, so your Accept didn't go through.” while the banner under “The team paused this test.” reads “Your Answer on Harbor Run: 3 levels didn't go through.” (1:20).
- D1 · Two copies: the session page: After Open now, while tab 2's Add (“One more thing: the lighthouse level has no checkpoint …”) was still on its way, tab 1's Add box on that question held the same words as an unsent draft, though the addition went through a moment later: pressed again, it would add the same text twice.
- E2 · Account pages: Ana: Profile: after Save profile went ahead on its second press (saving this page's sides, which removed the developer side tab 1 had just added), the next Save profile on the same page (a name change) was stopped again by the same “Sides: tester → developer and tester” line; only the press after that saved the name.
- E2 · Account pages: Ana: Payments: Ana pressed “Continue setup”; the box under the payout button reads “Your Change payout details didn't go through … Press Change payout details again”: it names the button the redrawn page shows (now connected), not the one she pressed.
- H1 · Offline: The copy that opened offline had an addition typed in its Add box; after it left (another copy had claimed the page), the other copy's Add box was empty after a reload (0:42–0:49): the typing didn't come across. (D2 shows typing coming across when the copy leaving held the page.)
