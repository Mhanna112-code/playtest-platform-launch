// Dec 10 media round: what INDEX.md and the report say about each video beyond its captions: a short title and caption, the "Same for:" lists (read from the
// server code: src/app/api/sessions/[id]/[action]/route.ts, src/lib/server/testerGate.ts, joining.ts, tests.ts devGate, rules.ts), "Found:" bugs, and the
// cases that can't happen now. Filled in after the runs (finalize.cjs reads it).
/* eslint-disable */
const SESSION_STOP = "Send Answers, Add to this answer / Answer this question, recording Send / Add, Switch / Keep, Charge / Let it go, Dispute, Leave, Rate, Request a time, a call request's Accept / Decline / Withdraw, Cancel call / Cancel the remaining calls (all checked against what changed since the page loaded; with Alerts Off only new terms, her own presses in another tab, Nora's side of her dispute, the team's decision on it and a payment on the part she presses about still stop)";
module.exports = {
  order: [
    "a1-send-answers-stop-line", "a2-session-refusals", "a3-session-block-lines", "a4-session-questions-changed", "a5-session-dispute-request-leave", "a6-session-charge-rate",
    "b1-join-page-stop-lines", "b2-join-page-refusals",
    "c1-test-page-applications-pay", "c2-test-page-calls-invite-stop",
    "d1-two-copies-session-page", "d2-two-copies-test-page-edit", "d3-two-copies-join-page", "d4-two-copies-account-pages", "d5-two-copies-ten-second-takeover",
    "e1-account-pages-developer", "e2-account-pages-tester", "f1-edit-save-kept-box",
    "g1-pause-keeps-invites", "g2-full-keeps-applications", "g3-edits-invite-only-closing",
    "h1-offline", "i1-switch-keep-newest-offer", "i2-switch-keep-withdrawn-new-leave", "j1-home-kept-boxes",
  ],
  preface: [
    "How a stop is produced on camera: the other person's change is made right after the presser's page had its live update (every ~20 s), and the press follows within a few seconds, so the page hasn't shown the change yet. Where an admin (the team) or Nora acts \"off camera\", it went through the same API her page uses.",
    "Words: \"the one line\" = the blue line under a stopped button (\"Your … didn't go through: check the updates at the top. Press again to go ahead.\"); \"the top box\" = the updates box at the top of the page; \"the full box\" = the kept stop box (\"Your … didn't go through.\" + what changed + \"Press … again to go ahead.\").",
    "Two-copy and offline videos slow one press on purpose: its answer is held back for the seconds the caption says, as on a slow connection (the press itself reaches the server at once).",
    "The media server is a development server: a page's first load after the server restarts can take a few seconds, and offline pages show without their styles. Neither is the app.",
  ].join("\n\n"),
  videos: {
    "a1-send-answers-stop-line": {
      title: "A1 · Session page: Send Answers stopped once (the one line)",
      caption: "Nora edits the listing; Ana's Send Answers shows one blue line and the change goes to the top box; the line survives her Alerts toggle and a live redraw; the next press clears it and shows the red mistake; another edit: the line, the red mark and the top box all at once; fixed and sent.",
      sameFor: [`The one line: ${SESSION_STOP}.`, "Red mistakes that come back while still true: Send Answers and Add (at least 50 characters, Answer at least one question), Dispute (a sentence), Charge (the amount), Rate (stars), Request a time (time, length), Cancel call under 24 hours (a reason)."],
    },
    "a2-session-refusals": {
      title: "A2 · Session page: refused for good (a pause; the work ended)",
      caption: "The team pauses the test: Ana's Add is refused; the page redraws without Add and the line stays where it was (another press doesn't remove it; after the lift it stays until Add is pressed again or the page reloads). Nora ends Ana's work early: Ana's Request a time is refused, the page loads again at its top and the line comes back where the button was.",
      sameFor: [
        "“This test is paused right now, so your … didn't go through.”: Send Answers, Add, recording Send / Add, Request a time, Accept a call request. Charge, Let it go and Rate read “This test is paused, so …”. Join call reads “…: this test is paused.” Never refused for a pause: Leave, Dispute, Switch / Keep, Cancel call, Withdraw a request.",
        "“Your part in this test has ended” / “This test was stopped” / “This test ended” (the page loads again at its top, the line kept): Send Answers, Add, recording Send / Add, upload, Remove, Switch / Keep, Request a time, a call request's Accept / Decline / Withdraw, Cancel call, Cancel the remaining calls. Leave is silent on an ended part; Dispute, Charge and Rate keep their own rules.",
        "Ana's own suspension (“Your account is paused, so your … didn't go through.”): every session-page press except Dispute.",
      ],
    },
    "a3-session-block-lines": {
      title: "A3 · Session page: the NDA line and the new-terms line",
      caption: "Nora adds an NDA: Ana's Send Answers reads “Acknowledge the NDA change first at the top of the page.” and the page stays put. Nora raises the price: Ana's Request a time reads “Answer the new terms first: Switch or Keep at the top of the page.”; Switch / Keep is at the top. After acknowledging / Keep, the presses go ahead.",
      sameFor: [
        "The NDA line: Send Answers, Add, recording Send / Add, Charge, Let it go, Dispute, Switch / Keep, Request a time, a call request's Accept / Decline / Withdraw, Cancel call, Cancel the remaining calls, Report a call problem, chat Send. Not Leave, Rate, uploads, Ask the developer, the join page or the developer's presses.",
        "The new-terms line (while her part is working): Send Answers, Add, recording Send / Add, Charge, Let it go, Dispute, Request a time, a call request's Accept / Decline / Withdraw, Cancel call, Cancel the remaining calls, Join call. Leave and Rate aren't blocked: they stop once with the new terms (I2).",
      ],
      found: [
        "After “Acknowledge the NDA change first at the top of the page.” the NDA notice was not at the top: Ana's page had not shown the NDA change yet, and the notice only appeared with the next live update about 18 s later, without its ring (frames at 0:31–0:45). The new-terms line in the same video found Switch / Keep at the top at once. (Possibly because src/components/NdaNotice.tsx draws the notice keyed by the change's time, so the copy that asked for the page to load it again is replaced before it can mark it; not checked further.)",
        "The ring on the notice lasts 4 seconds (lib/markJump.ts markOnly) while the page stays put, so when the notice is off screen the ring is usually gone before the tester has scrolled up to it.",
      ],
    },
    "a4-session-questions-changed": {
      title: "A4 · Session page: questions changed; an empty Send refused",
      caption: "Nora adds a question: Ana's Send Answers stops once and the form shows the new question (her answers kept); answered, it goes. Nora adds another: Send Answers with the new box empty is refused (“Answer at least one question …”), nothing is sent and the pay-by date doesn't move.",
      sameFor: ["The questions-changed stop: Add to this answer / Answer this question (a removed question stops it the same way, whatever her Alerts)."],
      notes: ["0:40–1:28: the recorder waited for the fourth question's text to show; it was there but in a folded part of the page, so the video sits still for a while."],
    },
    "a5-session-dispute-request-leave": {
      title: "A5 · Session page: Dispute, Request a time, a call request, Leave",
      caption: "Dispute: a red reason, then the one line, then sent. Request a time: the one line, then sent. A call request Nora withdraws: Accept refused for good (the request stays listed, marked Withdrawn). Leave: the one line, then she leaves.",
      sameFor: [`The one line: ${SESSION_STOP}.`, "A call request closed or withdrawn: Accept and Decline are refused the same way (Withdraw on her own closed request is silent)."],
    },
    "a6-session-charge-rate": {
      title: "A6 · Session page: Charge / Let it go and Rate",
      caption: "Charge stops once for Nora's edit; then the team pauses the test and the second Charge is refused for good (“This test is paused, so your Charge didn't go through.”). After the lift Nora pays; Rate stops once, then goes.",
      sameFor: ["Charge's refusals for good, the same for Let it go: the test paused, Nora paid meanwhile, a payment being confirmed, the date passed, already settled."],
      notes: ["“Nora paid meanwhile” wasn't filmed: a payment reaches Ana's page at once (her Charge button goes before she can press it), so the team's pause is used for the refusal."],
    },
    "b1-join-page-stop-lines": {
      title: "B1 · Join page: the one line on Join, Apply, Ask to rejoin, No thanks",
      caption: "Nora edits the listing each time; on the join page the press shows one line (whatever Ana's Alerts) and the next press goes ahead: Join, Apply to join, Ask to rejoin, No thanks. Withdraw application after a tester-deadline change goes straight through.",
      sameFor: ["The join page's one line: Join, Apply, Ask to rejoin, No thanks (No thanks ignores “full” and “a spot opened”)."],
      notReachable: ["Withdraw application's one line from Nora's edits: the edits the join page lists are the ones that close applications (src/lib/server/tests.ts CLOSING_FIELDS: steps, link, prices, parts, questions, NDA, devices, languages), so the application closes and Withdraw then goes quietly; the other edits (tester deadline, spots, Open until, categories, name) aren't join-page changes (checked through the API: Withdraw went ahead each time)."],
    },
    "b2-join-page-refusals": {
      title: "B2 · Join page: refused for good",
      caption: "Full (Ben took the last spot), paused (the team's pause; the same words for a hold or a suspension), Open until passed, and invite only (first the one line for the listing change, then refused).",
      sameFor: ["Full, paused and Open until passed: Join, Apply, Ask to rejoin (Withdraw and No thanks aren't refused for them).", "Invite only: Join and Apply; Ask to rejoin is never refused for it."],
      notReachable: ["These refusals show only from a join page that hasn't redrawn yet: once it redraws, a paused, full or closed test has no join card."],
    },
    "c1-test-page-applications-pay": {
      title: "C1 · Test page: Accept, Pay, Pay more",
      caption: "Ana withdraws her application: Nora's Accept is refused for good. Ana adds to her answer: Nora's Pay stops once (one line, the change in her top box). Ana leaves: Nora's Pay more stops once.",
      sameFor: ["The developer's one line (her test's Alerts decide which tester changes stop her): Accept / Decline, Invite / Invite anyway, Cancel invite, Pay, Pay more, Request a time, a call request's Accept / Decline / Withdraw, Cancel call, Cancel the remaining calls, End early, Stop the test. A tester's added work stops Pay on that part, and a tester leaving or disputing stops presses about that tester, whatever the Alerts."],
    },
    "c2-test-page-calls-invite-stop": {
      title: "C2 · Test page: a call request, Invite anyway, Stop, the team's pause",
      caption: "Ana withdraws her call request: Nora's Accept is refused. Invite asks first for a tester missing a need (Invite anyway); Ana's new request stops it once; pressed again, Bram is invited. Ana's answers stop Stop the test once. The team pauses the test: Nora's Accept is refused and the page goes to its top.",
      sameFor: ["The team's pause refuses every test-page press except Stop the test, End early, Cancel call, Send your side, chat and Rate; a payment hold reads “Your tests are paused”, a suspension “Your account is suspended”."],
      found: ["The team-pause refusal names the press two ways on one screen: the kept line reads “The team paused this test, so your Accept didn't go through.” while the banner under “The team paused this test.” reads “Your Answer on Harbor Run: 3 levels didn't go through.” (1:20)."],
    },
    "d1-two-copies-session-page": {
      title: "D1 · Two copies: the session page",
      caption: "Tab 2 waits (“Saving changes in other tab…” with Open now, buttons locked) while tab 1's Send is on its way, then takes the page; then Open now while tab 2's Add is on its way (the Add still goes through, tab 2 goes to the dashboard); then a Request a time on its way, which a new copy doesn't wait for. The 10-second takeover is in D5.",
      found: ["After Open now, while tab 2's Add (“One more thing: the lighthouse level has no checkpoint …”) was still on its way, tab 1's Add box on that question held the same words as an unsent draft, though the addition went through a moment later: pressed again, it would add the same text twice."],
    },
    "d2-two-copies-test-page-edit": { title: "D2 · Two copies: the test page and Edit", caption: "The test page and Edit are one page: Edit opened while the test page's Accept is on its way waits, then is drawn with it. Edit opened again in the first tab while the second has typing but no press on its way takes the page at once, and the typing comes across." },
    "d3-two-copies-join-page": { title: "D3 · Two copies: the join page", caption: "A second join page waits while the first one's Apply is on its way, then shows the application." },
    "d4-two-copies-account-pages": { title: "D4 · Two copies: Profile, Notifications, Payments", caption: "Profile and Notifications: the new copy waits for the old copy's Save, then shows it. Payments: opened again with nothing on its way, it moves at once." },
    "d5-two-copies-ten-second-takeover": { title: "D5 · Two copies: the 10-second takeover", caption: "Tab 1's Apply is on its way (its answer held 16 s); tab 2 opens the join page, waits about 10 s and takes the page by itself; tab 1's Apply still goes through and tab 1 then goes to the dashboard." },
    "e1-account-pages-developer": {
      title: "E1 · Account pages: Nora",
      caption: "The full box “Changed in another tab or device since you opened this page:” on Notifications (Password changed at …), Account (Email: Off → Daily) and Payments (Payout account: not connected → connected).",
      notReachable: [
        "Nora's Profile box: what can reach Profile from another page is “Sides” (Account's add-a-side, which opens Profile in that same tab and so takes the page from any Profile copy) or a profile field (only Profile itself saves them), so with one page at a time it can't show for her now; Ana's video shows it, from a Profile tab opened before she added her developer side.",
        "Payments' “Card” and “Subscription” lines: changed only on Payments itself (one copy at a time) or by the chargeback card check during a hold (not recorded); the payout line is shown instead, from Stripe's own message.",
      ],
    },
    "e2-account-pages-tester": {
      title: "E2 · Account pages: Ana",
      caption: "The full box on Profile (Sides: tester → developer and tester), Notifications (Name: …), Account (Email: Weekly → Off) and Payments (Payout account: not connected → connected).",
      found: [
        "Profile: after Save profile went ahead on its second press (saving this page's sides, which removed the developer side tab 1 had just added), the next Save profile on the same page (a name change) was stopped again by the same “Sides: tester → developer and tester” line; only the press after that saved the name.",
        "Payments: Ana pressed “Continue setup”; the box under the payout button reads “Your Change payout details didn't go through … Press Change payout details again”: it names the button the redrawn page shows (now connected), not the one she pressed.",
      ],
    },
    "f1-edit-save-kept-box": {
      title: "F1 · Edit's Save keeps its full box",
      caption: "A team pause and lift since Edit opened: Save shows the full box (“Since you opened this page: The team paused this test at … The team lifted its pause …”), and the next Save goes. Then why the three-value box can't show now.",
      notReachable: ["Edit's “Before / Now / What you typed” box: it needs another Save of the same test while this copy is open, but any other Save loads Edit again and claims the page after this copy loaded, so this copy leaves (“This page was opened somewhere else.”) before its own Save, even when its claim failed at open (offline): filmed in the second half."],
    },
    "g1-pause-keeps-invites": { title: "G1 · A pause keeps the invite", caption: "The team pauses the test: Ana's Join on her invite is refused (“isn't taking new testers right now”), her bell gets nothing, the invite stays open; after the lift the same invite works." },
    "g2-full-keeps-applications": { title: "G2 · A full test keeps applications", caption: "Full: Ana's application stays pending and she's told nothing; Nora's Accept on her is refused (“This test is full.”); Cam (invited) is told it's full; after a new spot Accept goes ahead and Cam is told a spot opened." },
    "g3-edits-invite-only-closing": { title: "G3 · Edits, invite only, a test closing on its own", caption: "An edit doesn't send the invite again (Ana sees the edit in the top box and Join stops once). A Save switching to invite only closes Ana's application with the invite-only line. A test closing on its own rings its invitee." },
    "h1-offline": {
      title: "H1 · Offline",
      caption: "An offline press: “You seem to be offline. Check your connection and try again.”; back online it goes. A copy that opened offline (its claim failed) claims the page again when back online; when another copy claimed it meanwhile, it leaves for the dashboard.",
      found: ["The copy that opened offline had an addition typed in its Add box; after it left (another copy had claimed the page), the other copy's Add box was empty after a reload (0:42–0:49): the typing didn't come across. (D2 shows typing coming across when the copy leaving held the page.)"],
    },
    "i1-switch-keep-newest-offer": { title: "I1 · Switch / Keep: always the newest offer", caption: "With Alerts Off, a Switch naming an older offer stops once with the newest; a third offer between the stop and the second press stops it again; the third press switches." },
    "i2-switch-keep-withdrawn-new-leave": { title: "I2 · Switch / Keep: withdrawn, new offer, Leave", caption: "An offer withdrawn after a stopped Switch leaves one line; a new offer starts the box clean (Keep goes); Leave pressed before the live update loads Switch / Keep at once." },
    "j1-home-kept-boxes": { title: "J1 · Home: full boxes", caption: "Confirm all with your bank stops with the full box when a new charge came in after Home loaded; the Calls box's Cancel (shown while Nora is suspended) stops with the full box for the team's pause." },
  },
  notRecorded: [
    "Recording Send / Add (needs a real video upload), chat Send, Report a call problem, Join call (needs a call minutes away), Cancel the remaining calls, Ask the developer: listed in the Same for lines only.",
    "Payment holds and developer suspensions as the cause of the join-page and invite refusals: only the team's pause is filmed; the code gives the same words for all three (Same for lines).",
  ],
  notReachableGeneral: [
    "A tester's press stopped by a Stop or an early end: only Dispute can show it; every other press is refused first because her part is over.",
    "A tester's Join call never stops once; the developer's Join call can only show a lift, since a paused test refuses it first.",
  ],
};
