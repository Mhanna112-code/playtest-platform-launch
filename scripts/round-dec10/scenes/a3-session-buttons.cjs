// A (continued). The other session-page buttons: Dispute (red, line, again), Request a time (line, again), Accept a call request (refused: withdrawn), Leave (line,
// again), Charge (line, then refused: Nora paid meanwhile), Rate (line, again).
/* eslint-disable */
const X = require("../lib.cjs");
const { pause, center, lines, waitLive, waitPulse, visible, textOf, sql, own, utcNow, post, ok, go } = X;
const { pair, both, REQ, noraEdits, toTop, fillRequest , editRace } = require("../common.cjs");
const DISPUTE = "button:has-text('Send the dispute')";

module.exports = (scene) => {
  // ---------- A5: Dispute, Request a time, Accept a call request, Leave ----------
  scene("a5", async () => {
    const p = await pair({ liveRateCents: "30.00", liveMinutes: "30" });
    await X.sendWritten(p.ana, p.s);
    const sub = X.subOf(p.s);
    console.log("   [a5] Nora pays $6 with a reason:", (await X.payWith(p.nora, sub, "6.00", "Two answers were short on detail, so this is a partial payment.")).status);
    const { N, A } = await both(p, `/app/tests/${p.t}`, `/app/sessions/${p.s}`);
    const D = X.duo("a5-session-dispute-request-leave", "Session page · Dispute, Request a time, a call request, Leave");
    D.start([N, A]);
    // Dispute: red, then the line, then it goes.
    await X.unfold(A, `#d-${sub}`);
    await center(A, `#d-${sub}`);
    await pause(A, 2000);
    D.say("Nora paid $6.00 of $10.00 for Ana's answers. Ana opens Dispute the pay and writes only “Low”.");
    await X.typeIn(A, `#d-${sub}`, "Low", 80);
    await A.locator(DISPUTE).first().click();
    await pause(A, 3000);
    D.say("Red mistake at the reason (nothing sent): it needs at least a sentence.");
    await lines(A, "a5 dispute red");
    await pause(A, 3000);
    await A.fill(`#d-${sub}`, "");
    await X.typeIn(A, `#d-${sub}`, "Both answers name the exact spot and what went wrong there; please pay the full price.", 8);
    await editRace(D, N, A, p.t, undefined, "Nora edits the listing in her window (Edit, Save).");
    D.say("Ana presses Send the dispute before her page updates: one line under the button; the change is in the top box.");
    await center(A, DISPUTE);
    await A.locator(DISPUTE).first().click();
    await pause(A, 3500);
    await lines(A, "a5 dispute line");
    await pause(A, 2500);
    D.say("Pressed again: the dispute goes ahead. Nora's page shows it live.");
    await A.locator(DISPUTE).first().click();
    await pause(A, 4000);
    await lines(A, "a5 dispute sent");
    await waitLive(N, "text=/disputed/", 30000);
    await pause(A, 2500);
    // Request a time: the line, then it goes.
    D.say("Ana fills in a call request (a time, 30 minutes).");
    await fillRequest(A);
    await editRace(D, N, A, p.t, " And the bridges.", "Nora edits the listing again (Edit, Save).");
    D.say("Ana presses Request a time: one line. Pressed again: the request goes to Nora.");
    await center(A, REQ);
    await A.locator(REQ).first().click();
    await pause(A, 3500);
    await lines(A, "a5 request line");
    await pause(A, 2000);
    await A.locator(REQ).first().click();
    await pause(A, 4000);
    await lines(A, "a5 request sent");
    await waitLive(N, "text=/requested a call/", 30000);
    await pause(N, 2500);
    // A call request from Nora, withdrawn before Ana's Accept: refused for good.
    D.say("Nora asks Ana for a call (Request a time, off camera); Ana's page shows the request live.");
    const d = new Date(Date.now() + 4 * 86400000); d.setMinutes(0, 0, 0);
    ok(await post(p.nora, `/api/tests/${p.t}/request-time`, { ...go, contractIds: [p.s], minutes: 30, times: [d.toISOString()] }), "request a time");
    const reqId = sql(`select id from "CallRequest" where "contractId" = '${p.s}' and status = 'pending' and "fromSide" = 'developer' order by "createdAt" desc limit 1`);
    await N.reload();
    await waitLive(A, "[data-requests-to-you] button:has-text('Accept')", 40000);
    await center(A, "[data-requests-to-you]");
    await pause(A, 2000);
    await waitPulse(A);
    D.say("Nora withdraws her request (off camera); Ana presses Accept before her page updates.");
    post.quiet = true;
    const w = await post(p.nora, `/api/tests/${p.t}/answer-request`, { ...go, contractId: p.s, requestId: reqId, action: "withdraw" });
    post.quiet = false;
    console.log("   [a5] Nora's withdraw:", w.status, JSON.stringify(w.body).slice(0, 200));
    await N.reload();
    await A.locator("[data-requests-to-you] button:has-text('Accept')").first().click().catch((e) => console.log("   ! Accept:", e.message.split("\n")[0]));
    await pause(A, 4000);
    D.say("Refused for good: the request was withdrawn. The row goes; the line stays where it was.");
    await lines(A, "a5 accept refused");
    await pause(A, 5000);
    D.say("Same for: Decline (withdrawn or closed requests), and Accept also when the test is paused, the call limit is reached or the time clashes.");
    await pause(A, 6000);
    // Leave: the line, then it goes.
    await editRace(D, N, A, p.t, " Last: the open sea.", "Nora edits the listing once more (Edit, Save).");
    D.say("Ana presses Leave this test (and confirms) before her page updates: one line under Leave.");
    await center(A, "#leave");
    await X.pressConfirm(A, A.locator("#leave button", { hasText: "Leave this test" }).first(), "Leave this test");
    await pause(A, 3500);
    await lines(A, "a5 leave line");
    await pause(A, 2500);
    D.say("Pressed again: Ana leaves the test. Nora's page shows it live.");
    await X.pressConfirm(A, A.locator("#leave button", { hasText: "Leave this test" }).first(), "Leave this test");
    await pause(A, 4000);
    await lines(A, "a5 left");
    await waitLive(N, "text=/left the test/", 30000);
    await pause(A, 3000);
    D.say("The stop line works the same way on every session-page button that a change can stop: Send Answers, Add, recording Send / Add, Switch / Keep, Charge / Let it go, Dispute, Leave, Rate, Request a time, call Accept / Decline / Withdraw, Cancel call.");
    await pause(A, 9000);
    await D.finish();
    X.noteScene(D, { page: "Session page" });
  });

  // ---------- A6: Charge (the line; then Nora pays meanwhile: refused) and Rate (the line, then it goes) ----------
  scene("a6", async () => {
    const p = await pair();
    await X.sendWritten(p.ana, p.s);
    const sub = X.subOf(p.s);
    // Charge opens for Ana's answers (as the daily job does once 7 days and Open until have passed): set in the database on her own rows.
    own(`update "Submission" set "sentAt" = ${utcNow} - interval '15 days', "payBy" = ${utcNow} - interval '1 day', "choiceOfferedAt" = ${utcNow} - interval '1 day', "choiceBy" = ${utcNow} + interval '6 days' where "contractId" = '${p.s}'`);
    own(`update "Test" set "openUntil" = ${utcNow} - interval '1 day' where id = '${p.t}'`);
    const { N, A } = await both(p, `/app/tests/${p.t}`, `/app/sessions/${p.s}`);
    const D = X.duo("a6-session-charge-rate", "Session page · Charge or Let it go, then Rate");
    D.start([N, A]);
    const charge = A.locator("button", { hasText: /^Charge / }).first();
    await charge.scrollIntoViewIfNeeded().catch(() => {});
    await pause(A, 2500);
    D.say("Nora didn't pay in time: Ana can charge her card or let it go (the dates were moved on in the database to get here).");
    await pause(A, 3000);
    await editRace(D, N, A, p.t, undefined, "Nora edits the listing in her window (Edit, Save).");
    D.say("Ana presses Charge before her page updates: one line under the buttons; the change is in the top box.");
    await charge.scrollIntoViewIfNeeded().catch(() => {});
    await charge.click();
    await pause(A, 3500);
    await lines(A, "a6 charge line");
    await pause(A, 2500);
    await N.backing;
    await N.waitForSelector("main h1");
    await waitPulse(A);
    D.say("Before Ana presses again, the team pauses the test (an admin, off camera). Nora's page shows the pause.");
    await X.adminDo("pause-test", p.t);
    N.reload().catch(() => {});
    D.say("Ana presses Charge again before her page updates: refused for good, “This test is paused, so your Charge didn't go through.”");
    await charge.scrollIntoViewIfNeeded().catch(() => {});
    await charge.click().catch((e) => console.log("   ! Charge 2:", String(e.message).slice(0, 100)));
    await pause(A, 4000);
    await lines(A, "a6 charge refused");
    await pause(A, 4000);
    D.say("Same for Let it go. Both are also refused when Nora paid meanwhile, when a payment is being confirmed, and once their date has passed.");
    await pause(A, 7000);
    D.say("The team lifts the pause; Nora pays the $10.00 (her Pay, off camera). Both pages show it live.");
    await X.adminDo("unpause-test", p.t);
    console.log("   [a6] Nora pays:", (await X.payWith(p.nora, sub, "10.00")).status);
    await N.reload().catch(() => {});
    await pause(A, 4000);
    // Rate.
    await A.reload();
    await A.waitForSelector("main h1");
    await X.unfold(A, "#rate");
    await center(A, "#rate");
    await pause(A, 2000);
    await editRace(D, N, A, p.t, " Thanks for testing!", "Everything is paid, so Ana can rate Nora. Nora edits the listing again.");
    D.say("Ana picks 5 stars and presses Rate before her page updates: one line under Rate.");
    await A.locator("#rate select").first().selectOption("5").catch(() => {});
    const rateBtn = A.locator("#rate button", { hasText: /^Rate( and finish)?$/ }).first();
    await X.pressConfirm(A, rateBtn, "Rate").catch((e) => console.log("   ! Rate:", e.message.split("\n")[0]));
    await pause(A, 3500);
    await lines(A, "a6 rate line");
    await pause(A, 2500);
    D.say("Pressed again: the rating goes ahead.");
    await X.pressConfirm(A, rateBtn, "Rate").catch((e) => console.log("   ! Rate 2:", e.message.split("\n")[0]));
    await pause(A, 4500);
    await lines(A, "a6 rated");
    await pause(N, 3000);
    await D.finish();
    X.noteScene(D, { page: "Session page" });
  });
};
