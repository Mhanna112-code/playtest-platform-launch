// I. Switch / Keep (the new-terms box on the session page): a press naming an older offer always stops with the newest; a third offer between the stop and the
// second press stops again; then (re-recorded in the one-line design) an offer withdrawn after a stopped Switch leaves one line, a new offer starts clean, and
// Leave loads the new terms at once.
/* eslint-disable */
const X = require("../lib.cjs");
const { pause, center, lines, waitLive, waitPulse, apiEdit, visible, textOf, sql } = X;
const { pair, both, ALERTS, toTop, editRace } = require("../common.cjs");
const SWITCH = "#terms-offer button:has-text('Switch to the new terms')";
const KEEP = "#terms-offer button:has-text('Keep my current terms')";
const price = (v) => async (E) => {
  const box = E.locator("input[aria-label='Price for the written report']").first();
  await box.scrollIntoViewIfNeeded();
  await pause(E, 400);
  await box.fill(v);
};
const offer = async (A, label) => console.log(`   [${label}] #terms-offer: ${(await textOf(A, "#terms-offer")).slice(0, 300)}`);

module.exports = (scene) => {
  // ---------- I1: an older offer named by the press always stops; a third offer stops again ----------
  scene("i1", async () => {
    const p = await pair();
    const { N, A } = await both(p, `/app/tests/${p.t}`, `/app/sessions/${p.s}`);
    const D = X.duo("i1-switch-keep-newest-offer", "Switch / Keep · a press naming an older offer always stops; a third offer stops again");
    D.start([N, A]);
    D.say("Ana turns her Alerts off (new terms still stop a press).");
    await A.locator(ALERTS).first().click().catch(() => {});
    await pause(A, 2000);
    await editRace(D, N, A, p.t, price("12.00"), "Nora raises the written answers' price to $12 (Edit, Save).");
    await waitLive(A, "#terms-offer", 40000);
    await center(A, "#terms-offer");
    D.say("Ana's page shows the new terms live: Switch / Keep ($10 → $12).");
    await offer(A, "i1 offer 1");
    await pause(A, 3000);
    await editRace(D, N, A, p.t, price("14.00"), "Nora changes the price again, to $14 (Edit, Save).");
    D.say("Ana presses Switch on the $12 offer her page shows: stopped once (“changed the terms again”), and the box now offers $14.");
    await A.locator(SWITCH).click();
    await pause(A, 3500);
    await lines(A, "i1 first switch");
    await offer(A, "i1 offer after first switch");
    await toTop(A, 2500);
    await center(A, "#terms-offer");
    await pause(A, 2500);
    await editRace(D, N, A, p.t, price("16.00"), "Before Ana presses again, Nora changes the price a third time, to $16 (Edit, Save).");
    D.say("Ana presses Switch again (her page still offers $14): a newer offer exists, so it stops again, now with $16.");
    await A.locator(SWITCH).click();
    await pause(A, 3500);
    await lines(A, "i1 second switch");
    await offer(A, "i1 offer after second switch");
    await toTop(A, 2500);
    await center(A, "#terms-offer");
    await pause(A, 2500);
    D.say("Third press, on the newest offer: Ana switches to $16.");
    await A.locator(SWITCH).click();
    await pause(A, 4000);
    await lines(A, "i1 third switch");
    console.log("   [i1] contract price:", sql(`select "writtenCents" from "Contract" where id = '${p.s}'`));
    await waitLive(N, "text=/switched to the new terms/", 30000);
    D.say("Nora's page shows that Ana switched. Keep works the same way: a Keep naming an older offer stops with the newest.");
    await pause(N, 6000);
    await D.finish();
    X.noteScene(D, { page: "Switch / Keep" });
  });

  // ---------- I2: an offer withdrawn after a stopped Switch (one line), a new offer starts clean (Keep), Leave loads the new terms at once ----------
  scene("i2", async () => {
    const p = await pair();
    const { N, A } = await both(p, `/app/tests/${p.t}`, `/app/sessions/${p.s}`);
    const D = X.duo("i2-switch-keep-withdrawn-new-leave", "Switch / Keep · a withdrawn offer, a new offer starts clean, Leave loads the new terms");
    D.start([N, A]);
    await editRace(D, N, A, p.t, price("12.00"), "Nora raises the price to $12 (Edit, Save).");
    await waitLive(A, "#terms-offer", 40000);
    await center(A, "#terms-offer");
    await pause(A, 2000);
    await editRace(D, N, A, p.t, price("14.00"), "Nora changes it again, to $14 (Edit, Save).");
    D.say("Ana presses Switch (her page shows $12): stopped once, the box moves to $14.");
    const ans = A.waitForResponse((r) => r.url().endsWith("/terms") && r.request().method() === "POST", { timeout: 20000 }).then((r) => r.status(), () => "none");
    await A.locator(SWITCH).click();
    console.log("   [i2] first Switch:", await ans);
    await pause(A, 3000);
    await lines(A, "i2 switch stopped");
    D.say("Nora sets the price back to $10, Ana's own terms (off camera): the offer is withdrawn.");
    await apiEdit(p.nora, p.t, { writtenCents: "10.00" });
    await N.reload();
    await waitLive(A, "text=/no longer on offer/", 45000);
    await center(A, "text=/no longer on offer/");
    D.say("After the live update one line is left: “Your Switch to the new terms didn't go through: These terms are no longer on offer.”");
    await lines(A, "i2 withdrawn line");
    await pause(A, 5000);
    // A new offer starts clean (three price changes used up: the team allows 3 more first, off camera, as an admin does).
    await X.adminDo("allow-critical-changes", p.t);
    D.say("With that line showing, Nora offers $15 (off camera; the team first allowed more price changes): Switch / Keep appear without the old line.");
    await apiEdit(p.nora, p.t, { writtenCents: "15.00" });
    await N.reload();
    await waitLive(A, "#terms-offer button", 45000);
    await center(A, "#terms-offer");
    await pause(A, 1500);
    await lines(A, "i2 new offer");
    await pause(A, 3000);
    D.say("Ana presses Keep my current terms: it goes ahead (“Kept your current terms.”).");
    await A.locator(KEEP).click();
    await pause(A, 4500);
    await lines(A, "i2 kept");
    // Leave loads the new terms at once.
    await center(A, "#leave");
    await pause(A, 1500);
    await editRace(D, N, A, p.t, price("17.00"), "Nora raises the price to $17 (Edit, Save).");
    D.say("Ana presses Leave this test before her page updates: one line under Leave, and Switch / Keep with $17 appear at once at the top (no scroll).");
    await X.pressConfirm(A, A.locator("#leave button", { hasText: "Leave this test" }).first(), "Leave this test");
    const t0 = Date.now();
    const shown = await A.waitForSelector("#terms-offer", { timeout: 15000 }).then(() => true, () => false);
    console.log(`   [i2] Switch / Keep ${shown ? "appeared" : "did NOT appear"} ${((Date.now() - t0) / 1000).toFixed(1)} s after Leave; scrollY ${await A.evaluate(() => scrollY)}`);
    await pause(A, 2500);
    await lines(A, "i2 leave line");
    await toTop(A, 2500);
    await center(A, "#terms-offer");
    await pause(A, 3000);
    D.say("Same for Rate: a Rate stopped by new terms loads Switch / Keep at once.");
    await pause(A, 5000);
    await D.finish();
    X.noteScene(D, { page: "Switch / Keep" });
  });
};
