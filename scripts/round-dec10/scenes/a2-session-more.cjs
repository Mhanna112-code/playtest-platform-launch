// A (continued). The session page: the two block lines (NDA, new terms), the questions-changed stop and the empty Send, and the other buttons' stop lines.
/* eslint-disable */
const X = require("../lib.cjs");
const { pause, center, lines, waitLive, waitPulse, apiEdit, visible, textOf, sql } = X;
const { pair, both, SEND, ALERTS, REQ, noraEdits, toTop, fillRequest , editRace } = require("../common.cjs");
const SWITCH = "#terms-offer button:has-text('Switch to the new terms')";
const KEEP = "#terms-offer button:has-text('Keep my current terms')";
const Q3 = ["What did you like?", "Where did you get stuck?", "Would you play level 4?"];
const Q4 = [...Q3, "Which harbor was the hardest?"];

module.exports = (scene) => {
  // ---------- A3: the NDA block line and the new-terms block line (a ring at the top, the page doesn't move) ----------
  scene("a3", async () => {
    const p = await pair({ liveRateCents: "30.00", liveMinutes: "30" });
    const { N, A } = await both(p, `/app/tests/${p.t}`, `/app/sessions/${p.s}`);
    const D = X.duo("a3-session-block-lines", "Session page · the two block lines: an NDA change and new terms");
    D.start([N, A]);
    await center(A, "#written");
    await pause(A, 2000);
    D.say("Ana types her answers.");
    await X.typeIn(A, "#a0", X.ANS[0], 8);
    await X.typeIn(A, "#a1", X.ANS[1], 8);
    await editRace(D, N, A, p.t, async (E) => {
      await center(E, "#ndaText");
      await pause(E, 500);
      await E.locator("#ndaText").click();
      await E.keyboard.type("Please don't share screenshots or videos of Harbor Run outside this test.", { delay: 15 });
    }, "Nora adds an NDA to the listing in her window (Edit, NDA, Save).");
    D.say("Ana presses Send Answers before her page updates.");
    await center(A, SEND);
    await A.locator(SEND).click();
    await A.waitForSelector("[data-nda-refusal]", { timeout: 15000 }).catch(() => {});
    await pause(A, 1200);
    D.say("The line: “Acknowledge the NDA change first at the top of the page.” Her page doesn't move.");
    await lines(A, "a3 NDA block");
    console.log("   [a3] scrollY", await A.evaluate(() => scrollY));
    await pause(A, 800);
    D.say("Ana scrolls up at once: the NDA notice at the top has a ring (for about 4 seconds). She acknowledges it.");
    await toTop(A, 3000);
    console.log("   [a3] NDA notice:", await textOf(A, "[data-nda-notice]"), "marked:", await A.locator("[data-nda-notice][data-marked]").count());
    await A.locator("[data-nda-ack]").first().click().catch((e) => console.log("   ! ack:", e.message.split("\n")[0]));
    await pause(A, 3000);
    await center(A, SEND);
    await pause(A, 1500);
    D.say("Send Answers again.");
    await A.locator(SEND).click();
    await pause(A, 3500);
    await lines(A, "a3 after ack, press");
    if (await visible(A, "#written [data-stop-line]")) {
      D.say("Stopped once more for the listing change itself (one line; the change is in the top box). Pressed again: it goes ahead.");
      await pause(A, 3000);
      await A.locator(SEND).click();
    }
    await A.waitForSelector("text=Sent your answers.", { timeout: 20000 }).catch(() => console.log("   ! not sent"));
    await pause(A, 2500);
    D.say("Same for the NDA line: Add, recording Send / Add, Charge, Let it go, Dispute, Switch / Keep, Request a time, call Accept / Decline / Withdraw, Cancel call, Report a call problem, chat Send. Not for Leave or Rate.");
    await pause(A, 9000);
    // The new-terms block.
    D.say("Ana fills in a call request.");
    await fillRequest(A);
    await editRace(D, N, A, p.t, async (E) => {
      const price = E.locator("input[aria-label='Price for the written report']").first();
      if (await price.count()) { await price.scrollIntoViewIfNeeded(); await price.fill("12.00"); }
      else console.log("   ! no written price box");
    }, "Nora raises the written answers' price to $12 in her window (Edit, Save): new terms for Ana.");
    if (!(await visible(N, "main h1"))) await N.goto(`/app/tests/${p.t}`);
    D.say("Ana presses Request a time before her page updates.");
    await center(A, REQ);
    await A.locator(REQ).first().click();
    await A.waitForSelector("[data-answer-terms]", { timeout: 15000 }).catch(() => {});
    await pause(A, 1200);
    D.say("The line: “Answer the new terms first: Switch or Keep at the top of the page.” The page stays put; Ana scrolls up at once: the Switch / Keep box has a ring (about 4 seconds).");
    await lines(A, "a3 terms block");
    console.log("   [a3] scrollY", await A.evaluate(() => scrollY));
    await pause(A, 800);
    await toTop(A, 3000);
    await center(A, "#terms-offer");
    console.log("   [a3] terms offer:", (await textOf(A, "#terms-offer")).slice(0, 300), "marked:", await A.locator("#terms-offer[data-marked]").count());
    await pause(A, 3000);
    D.say("Ana keeps her current terms, then presses Request a time again.");
    await A.locator(KEEP).click().catch((e) => console.log("   ! Keep:", e.message.split("\n")[0]));
    await pause(A, 3500);
    await center(A, REQ);
    await pause(A, 1000);
    await A.locator(REQ).first().click();
    await pause(A, 3500);
    await lines(A, "a3 request after Keep");
    if (await visible(A, "[data-stop-line]")) {
      D.say("Stopped once for the listing change (one line); pressed again, it goes ahead.");
      await pause(A, 2500);
      await A.locator(REQ).first().click();
      await pause(A, 3500);
    }
    D.say("Same for the new-terms line: Send Answers, Add, recording Send / Add, Charge, Let it go, Dispute, call Accept / Decline / Withdraw, Cancel call, Join call. Leave and Rate aren't blocked: they stop once.");
    await waitLive(N, "text=/requested a call/", 20000);
    await pause(A, 8000);
    await D.finish();
    X.noteScene(D, { page: "Session page" });
  });

  // ---------- A4: questions changed (the form takes the new questions), then an empty Send after another question (refused; pay-by stays) ----------
  scene("a4", async () => {
    const p = await pair();
    const { N, A } = await both(p, `/app/tests/${p.t}`, `/app/sessions/${p.s}`);
    const D = X.duo("a4-session-questions-changed", "Session page · Nora changes the questions: the form follows; an empty Send is refused");
    D.start([N, A]);
    await center(A, "#written");
    await pause(A, 2000);
    D.say("Ana types answers to the two questions.");
    await X.typeIn(A, "#a0", X.ANS[0], 8);
    await X.typeIn(A, "#a1", X.ANS[1], 8);
    await waitPulse(A);
    D.say("Nora adds a third question (“Would you play level 4?”; her Save, off camera). Her page shows three questions.");
    await apiEdit(p.nora, p.t, { questions: Q3 });
    await N.reload();
    await pause(N, 1500);
    D.say("Ana presses Send Answers before her page updates.");
    await center(A, SEND);
    await A.locator(SEND).click();
    await pause(A, 4000);
    D.say("Stopped once: one line, the change in the top box, and the form now shows the new questions (her two answers kept).");
    await lines(A, "a4 questions stop");
    console.log("   [a4] boxes:", await A.locator("#written textarea").count());
    await center(A, "#written");
    await pause(A, 5000);
    await toTop(A, 3000);
    await center(A, SEND);
    D.say("Ana answers the new question too and presses Send Answers again: it goes ahead.");
    const third = A.locator("#a2");
    if (await third.count()) await X.typeIn(A, "#a2", "Yes, if the storm level gets a checkpoint halfway through, I'd play level 4.", 8);
    await A.locator(SEND).click();
    await A.waitForSelector("text=Sent your answers.", { timeout: 20000 }).catch(() => console.log("   ! not sent"));
    await pause(A, 3000);
    await lines(A, "a4 sent");
    const sub = X.subOf(p.s);
    const payBy = () => sql(`select to_char("payBy", 'Mon DD HH24:MI') from "Submission" where id = '${sub}'`);
    const before = payBy();
    D.say("Nora adds a fourth question (off camera). Ana's page shows it live with an empty box.");
    await apiEdit(p.nora, p.t, { questions: Q4 });
    await N.reload();
    await waitLive(A, "text=/Which harbor was the hardest/", 40000);
    await pause(A, 2000);
    const send2 = A.locator("button:has-text('Send Answers')").first();
    if (await send2.count()) {
      await send2.scrollIntoViewIfNeeded();
      await pause(A, 2000);
      D.say("Ana presses Send Answers with the new box empty.");
      await send2.click().catch((e) => console.log("   ! send2:", e.message.split("\n")[0]));
      await pause(A, 4000);
      await lines(A, "a4 empty send");
      console.log("   [a4] answer-one:", await textOf(A, "[data-answer-one]"), "| sent line:", await A.locator("text=Sent your answers.").count());
    } else {
      const ans = A.locator("[data-add-more=written][data-answer-first]").first();
      console.log("   [a4] no Send Answers; Answer this question rows:", await A.locator("[data-answer-first]").count());
      if (await ans.count()) {
        await ans.scrollIntoViewIfNeeded();
        await ans.click();
        await pause(A, 1500);
        D.say("The new question comes as “Answer this question”. Ana presses it with the box empty.");
        await A.locator("[data-add-send=written]").first().click();
        await pause(A, 4000);
        await lines(A, "a4 empty answer");
      }
    }
    const after = payBy();
    console.log(`   [a4] payBy ${before} -> ${after}`);
    D.say(`Refused with “Answer at least one question”; nothing is sent, and the pay-by date stays where it was (${before} before, ${after} after, UTC).`);
    await pause(A, 7000);
    await toTop(A, 3000);
    await pause(N, 2000);
    await D.finish();
    X.noteScene(D, { page: "Session page", payBy: { before, after } });
  });
};
