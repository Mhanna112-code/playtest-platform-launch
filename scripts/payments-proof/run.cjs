// The payments-proof recordings (docs/media/payments-proof/): each scenario on the 3480 server (pl-rec worktree, rec schema, Stripe TEST mode), the app recorded beside
// the Stripe viewer (3481), and the developer's PaymentIntents saved next to each clip (<name>.stripe.json). Throwaway accounts only (rec+…@playtest.test).
//   node scripts/payments-proof/run.cjs A B C D E G     (from PowerShell; Chrome)
// Webhooks can't reach localhost: a chargeback is opened by calling the function the webhook calls (holds.chargebackOpened with the PaymentIntent id, appfn.mts).
/* eslint-disable */
const fs = require("fs");
const path = require("path");
const L = require("./lib.cjs");
const { sql, post, ok, sleep, appfn } = L;
const CARD_ASK = "4000 0027 6000 3184"; // always asks the bank (3D Secure), on-session and off-session
const CARD_OK = "4242 4242 4242 4242";
const log = (...a) => console.log("  ", ...a);
const results = {};
const note = (sc, line) => { line = String(line).replace(/pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/g, "[client secret hidden]"); (results[sc] ??= []).push(line); log(`[${sc}] ${line}`); };
const rows = (dev) => L.payRows(dev.uid).replace(/\n/g, "; ");

async function dev(key, name, card = CARD_ASK) {
  const d = await L.account(key, name, "developer");
  await L.addCard(d, card, { tds: card === CARD_ASK });
  return d;
}
async function testers(prefix, names) {
  const out = [];
  for (let i = 0; i < names.length; i++) out.push(await L.account(`${prefix}-t${i + 1}`, names[i], "tester"));
  return out;
}
const NAMES = ["Ana Silva", "Ben Okafor", "Cid Moreau", "Dee Lin"];
async function world(prefix, devName, n, card = CARD_ASK) {
  const d = await dev(`${prefix}-dev`, devName, card);
  const ts = await testers(prefix, NAMES.slice(0, n));
  const w = await L.writtenTest(d, ts);
  for (const s of w.s) L.openCharge(s, w.t);
  return { d, ts, w };
}
const testPage = async (page, t) => { await page.goto(`/app/tests/${t}`); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1500); };
const payments = async (page) => { await page.goto(`/app/payments`); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1500); };
const bankBox = (page, payId) => page.locator(`[data-bank-waiting="${payId}"]`).first();
/** A tester presses Charge (made while the developer is away); with card 3184 the bank asks: a 3-day "Confirm with your bank" item. Returns the Payment id. */
async function tCharge(W, i) {
  await L.chargeUI(W.ts[i], W.w.s[i]).catch((e) => log("Charge button:", String(e.message).slice(0, 120)));
  const n = await L.waitSql(`select count(*) from "Payment" where "submissionId" = '${W.w.sub[i]}'`, (v) => Number(v) > 0, 30000);
  if (!Number(n)) { const r = await L.chargeApi(W.ts[i], W.w.s[i], W.w.sub[i], 1000); log(`Charge for ${NAMES[i]} through the same route (the page's press didn't register): ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`); await L.waitSql(`select count(*) from "Payment" where "submissionId" = '${W.w.sub[i]}'`, (v) => Number(v) > 0, 30000); }
  await sleep(1500);
  return L.lastPay(W.w.sub[i]);
}
/** A "Confirm with your bank" item's 3 days run out (moved in the rec schema), then the clock (confirm.expireActions). */
function runOut(payId) {
  sql(`update "Payment" set "actionBy" = (now() at time zone 'utc') - interval '1 minute' where id = '${payId}'`);
  return appfn("expire");
}
/** A tester's Charge whose check runs out: a debt and a payment hold. */
async function holdVia(W, i) { const p = await tCharge(W, i); await L.waitAction(W.w.sub[i]); runOut(p); return p; }
const one = (d) => { const r = sql(`select id || '|' || status || '|' || coalesce("actionPi", '') || '|' || coalesce("stripePaymentIntentId", '') || '|' || "amountCents" || '|' || note from "Payment" where "developerId" = '${d.uid}' and kind = 'owed' order by "createdAt" desc limit 1`).split("|"); return { id: r[0], status: r[1], actionPi: r[2], pi: r[3] || r[2], cents: Number(r[4]), note: r[5] }; };
const waitOne = (d, want, ms = 90000) => L.waitSql(`select status from "Payment" where "developerId" = '${d.uid}' and kind = 'owed' order by "createdAt" desc limit 1`, (v) => want.includes(v), ms);
/** Pay what you owe on Payments (the button; a stop-once box is pressed through). With card 3184 the bank's real 3D Secure page opens under it: `complete` true/false, null = leave it open. */
async function pressOwed(page, { complete = true, before } = {}) {
  await payments(page);
  const btn = page.locator("#owed button", { hasText: /Pay what you owe/ }).first();
  await btn.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(800);
  await btn.click();
  await page.waitForTimeout(2500);
  if (await page.locator("#owed").getByText("Press again").count()) { await btn.click(); await page.waitForTimeout(2000); }
  if (complete === null) return;
  if (before) await before();
  await L.threeDS(page, complete, 45000);
}
/** "Confirm with your bank" on an item (test page or Payments), the bank's real page: complete. `hold`: the page's finish request is held back until released (a race). */
async function confirmItem(page, payId, { hold = false } = {}) {
  let release = () => {};
  if (hold) {
    const gate = new Promise((r) => (release = r));
    let n = 0;
    await page.route("**/api/payments/confirm", async (route) => {
      const raw = route.request().postData() || "";
      if (n++ === 0 || raw.includes("\"start\":true")) return route.continue(); // the start (opens the bank's page) goes through; the finish is held
      await gate;
      return route.continue();
    });
  }
  const box = bankBox(page, payId);
  await box.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(700);
  await box.locator("button", { hasText: "Confirm with your bank" }).click();
  await page.waitForTimeout(2500);
  if (await box.getByText("Press again").count()) await box.locator("button", { hasText: "Confirm with your bank" }).click();
  await L.threeDS(page, true, 45000);
  return { box, release };
}
async function adminRow(A, d) {
  await A.goto(`/admin?at=${Date.now()}#chargebacks`);
  await A.waitForLoadState("networkidle").catch(() => {});
  await A.waitForTimeout(2000);
  const row = A.locator(`[data-chargeback-hold="${d.uid}"]`).first();
  for (let i = 0; i < 20 && !(await row.count()); i++) {
    await A.locator('[data-scroll-box="chargebacks"]').first().evaluate((b) => { b.scrollTop = b.scrollHeight; }).catch(() => {});
    await A.waitForTimeout(600);
  }
  await row.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
  return row;
}
async function testerTag(t, s) {
  await t.goto(`/app/sessions/${s}`);
  await t.waitForLoadState("networkidle").catch(() => {});
  await t.waitForTimeout(1000);
  return (await t.locator("[data-part-status]").first().innerText().catch(() => "?")).trim();
}
let ADMIN = null;
const admin = async () => (ADMIN ??= await L.admin());
/** The chargeback steps cleared: card verified (Stripe SetupIntent + the bank's real page), Pay what you owe's reservation (3184: the bank's page), the team's Approve. */
async function clearSteps(SC, pr, d, label) {
  await L.verifyCard(pr.app);
  await payments(pr.app);
  await L.pairShot(pr, `${label}-verified`, "Chargeback steps: card verified with 3D Secure.", SC, "[data-chargeback-steps]");
  await pressOwed(pr.app, { complete: true });
  await L.waitSql(`select count(*) from "Reservation" where "developerId" = '${d.uid}' and status = 'reserved'`, (v) => Number(v) > 0, 60000);
  await payments(pr.app);
  await L.pairShot(pr, `${label}-reserved`, "Pay what you owe reserved what's owed on the card (Stripe: Uncaptured).", SC, "main");
  const A = await admin();
  const row = await adminRow(A, d);
  await L.shot(A, `${label}-admin-row`, "The admin's Chargeback holds row: card verified ✓, owed reserved ✓, the chargebacks listed, Approve.", SC, row);
  const r = await post(A, "/api/admin/approve-chargeback", { id: d.uid, note: "" });
  note(SC, `admin Approve: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  await sleep(4000);
}

// ======================= A. Pause on hold =======================
async function A() {
  const SC = "A";
  const W = await world("a", "Ada Park", 3);
  const pr = await L.pair(W.d, W.d, "A · Ada Park (card 3184): pause on hold");
  await testPage(pr.app, W.w.t);
  const pays = [];
  for (let i = 0; i < 3; i++) pays.push(await tCharge(W, i));
  for (const sub of W.w.sub) await L.waitAction(sub);
  await testPage(pr.app, W.w.t);
  await L.pairShot(pr, "A1-three-confirms", "Three testers pressed Charge while Ada was away; card 3184 makes the bank ask on each (Stripe: requires_payment_method / authentication_required), so the test page shows three “Confirm with your bank” items.", SC, bankBox(pr.app, pays[0]));
  L.stripeOut(W.d, "A1-three-confirms", SC, "three PaymentIntents waiting for the bank's check");
  const old = await L.newPage({ from: W.d, video: true });
  await testPage(old, W.w.t);
  const before = appfn("stripe", W.d.uid).count;
  await old.bringToFront();
  const box = bankBox(old, pays[1]);
  await box.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
  // The hold starts now; the old tab hasn't redrawn yet (it would move to the dashboard on its next status check). To keep it "old" for the press, its background
  // polls (account status, page freshness) are held back for these seconds; the press itself goes to the server as usual.
  await old.route(/\/api\/(account\/status|pulse|live|account\/changes)/, (r) => r.abort());
  runOut(pays[0]);
  const resp = old.waitForResponse((r) => r.url().includes("/api/payments/confirm") && r.request().method() === "POST", { timeout: 60000 });
  await box.locator("button", { hasText: "Confirm with your bank" }).click();
  const rr = await resp;
  const rb = await rr.json().catch(() => ({}));
  const shown = await old.getByText("This payment is paused until your tests resume.").first().waitFor({ timeout: 4000 }).then(() => true, () => false);
  fs.writeFileSync(path.join(L.OUT, "A3-old-tab-response.json"), JSON.stringify({ status: rr.status(), body: rb, shownOnPage: shown }, null, 2));
  note(SC, `Ana's check ran out: hold=${L.holdOf(W.d.uid)}; rows: ${rows(W.d)}`);
  note(SC, `old-tab Confirm on Ben's: HTTP ${rr.status()} ${JSON.stringify(rb)}; shown under the button: ${shown}`);
  await L.shot(old, "A3-old-tab-refused", "An old tab still showing Ben's “Confirm with your bank”: pressed, it is refused with “This payment is paused until your tests resume.” and nothing is charged.", SC, box);
  const v = old.video(); await old.context().close(); await v.saveAs(path.join(L.OUT, "A3-old-tab-refused.webm"));
  L.record("A3-old-tab-refused.webm", "The old tab's Confirm with your bank on a paused charge: refused, nothing charged.", SC);
  const after = L.stripeOut(W.d, "A3-old-tab-refused", SC, "no new PaymentIntent after the refused Confirm");
  note(SC, `PaymentIntents before/after the old tab's Confirm: ${before} -> ${after.count}`);
  await payments(pr.app);
  await L.pairShot(pr, "A2-paused", "Ana's check ran out: it's a debt and a payment hold started. Ben's and Cid's checks were cancelled at Stripe (Canceled) and wait; (§125) Pay what you owe lists the debt AND both waiting charges ($30.00).", SC, "#owed");
  L.stripeOut(W.d, "A2-paused", SC, "Ana's expired check and the two paused checks: all cancelled at Stripe");
  await pressOwed(pr.app, { complete: true });
  note(SC, `one payment: ${await waitOne(W.d, ["bundled"])}`);
  await payments(pr.app);
  await L.pairShot(pr, "A4-one-payment", "(§125) Pay what you owe: ONE payment for the debt and both waiting charges ($30.00), the bank's real 3D Secure page completed; the hold lifted with nothing left to charge.", SC, "main");
  const fin = L.stripeOut(W.d, "A4-one-payment", SC, "one succeeded PaymentIntent ($30.00) for all three");
  note(SC, `final: hold=${L.holdOf(W.d.uid)}; Stripe ${fin.count} PIs, ${fin.succeeded} succeeded; rows: ${rows(W.d)}`);
  for (let i = 0; i < 3; i++) note(SC, `${NAMES[i]}'s tag: ${await testerTag(W.ts[i], W.w.s[i])}`);
  await L.pairVideo(pr, "A-pause-on-hold", "A · Pause on hold: three confirms; one runs out -> a debt and a hold; the other two cancelled at Stripe and waiting; Pay what you owe pays all three as one payment.", SC);
}

// ======================= B. Approve vs cancel race =======================
async function B() {
  const SC = "B";
  const W = await world("b", "Bea Quinn", 3);
  // Two Charges waiting for the bank, then a NEW card (3184 again): both checks cancelled at Stripe and made as ONE combined payment on the new card (one confirm item).
  const p0 = await tCharge(W, 0), p1 = await tCharge(W, 1);
  await L.waitAction(W.w.sub[0]); await L.waitAction(W.w.sub[1]);
  await L.addCard(W.d, CARD_ASK, { tds: true });
  await waitOne(W.d, ["needs_confirmation"]);
  const comb = one(W.d);
  note(SC, `combined payment ${comb.cents / 100} ${comb.status} (${comb.note}); rows: ${rows(W.d)}`);
  // A third Charge, its own check (this one will run out and start the hold).
  const p2 = await tCharge(W, 2);
  await L.waitAction(W.w.sub[2]);
  const pr = await L.pair(W.d, W.d, "B · Bea Quinn: approve vs a hold starting");
  await payments(pr.app);
  await L.pairShot(pr, "B1-waiting", "A combined payment for two Charges waits for the bank (one item listing both), and a third Charge has its own check.", SC, "[data-confirm-list]");
  L.stripeOut(W.d, "B1-waiting", SC, "the combined payment and the third check waiting");
  // Bea completes the bank's page for the combined payment; the app's finish is held back while the third check runs out and a hold starts (which pauses waiting checks).
  const c = await confirmItem(pr.app, comb.id, { hold: true });
  // Wait until Stripe says the bank approved it (the app hasn't heard yet: its finish is held back).
  let st = "";
  for (let i = 0; i < 20 && st !== "succeeded"; i++) { await sleep(2500); st = appfn("stripe", W.d.uid).paymentIntents.filter((x) => x.id === comb.actionPi).map((x) => x.status).join(); }
  note(SC, `at Stripe now: ${st}`);
  runOut(p2);
  note(SC, `hold started: ${L.holdOf(W.d.uid)}; combined now ${one(W.d).status}`);
  c.release();
  await sleep(6000);
  await payments(pr.app);
  await L.pairShot(pr, "B2-one-outcome", "Exactly one outcome: the hold's pause tried to cancel the combined payment at Stripe, Stripe said it had already gone through, so it was recorded as paid (both Charges paid) and never charged again; the held-back Confirm then finished as already done.", SC, "main");
  const s = L.stripeOut(W.d, "B2-one-outcome", SC, "one succeeded PaymentIntent for the combined payment");
  note(SC, `combined final: ${one(W.d).status}; succeeded at Stripe: ${s.succeeded}; rows: ${rows(W.d)}`);
  await L.pairVideo(pr, "B-approve-vs-hold", "B · Approve vs cancel: the combined payment's bank check completed at the moment a hold starts; one outcome (paid), one charge at Stripe.", SC);
}

// ======================= C. Chargebacks on Pay what you owe and on the after-lift combined payment =======================
async function C() {
  const SC = "C";
  const W = await world("c", "Cal Reyes", 4);
  await holdVia(W, 0);
  const pr = await L.pair(W.d, W.d, "C · Cal Reyes: two chargebacks");
  await pressOwed(pr.app, { complete: true });
  await waitOne(W.d, ["bundled"]);
  const o1 = one(W.d);
  const cb1 = appfn("chargeback", o1.pi); // the same second as the approval
  note(SC, `Pay what you owe ${o1.cents / 100} ${o1.status}; chargeback #1 opened: ${cb1}; hold=${L.holdOf(W.d.uid)}`);
  await payments(pr.app);
  await L.pairShot(pr, "C1-chargeback-hold", "Pay what you owe went through ($10.00) and the bank reversed it the same second: a chargeback hold owing $10.00 + ONE chargeback fee.", SC, "main");
  L.stripeOut(W.d, "C1-chargeback-hold", SC, "one succeeded payment, disputed (opened via chargebackOpened)");
  // Two testers charge after the reservation is made (they wait for the lift).
  await L.verifyCard(pr.app);
  await pressOwed(pr.app, { complete: true });
  await L.waitSql(`select count(*) from "Reservation" where "developerId" = '${W.d.uid}' and status = 'reserved'`, (v) => Number(v) > 0, 60000);
  await tCharge(W, 1); await tCharge(W, 2);
  note(SC, `after reservation, two Charges: ${rows(W.d)}`);
  const A = await admin();
  let row = await adminRow(A, W.d);
  await L.shot(A, "C2-admin-row-1", "The team's row: card verified ✓, owed reserved ✓, the first chargeback.", SC, row);
  ok(await post(A, "/api/admin/approve-chargeback", { id: W.d.uid, note: "" }), "approve");
  await waitOne(W.d, ["needs_confirmation", "bundled"]);
  const comb = one(W.d);
  note(SC, `lift: hold=${L.holdOf(W.d.uid)}; combined payment ${comb.cents / 100} ${comb.status}`);
  await payments(pr.app);
  await L.pairShot(pr, "C3-combined", "Approve took the reservation and lifted the hold; the two Charges made during the hold are ONE combined payment ($20.00), one “Confirm with your bank” item listing each.", SC, "[data-confirm-list]");
  await confirmItem(pr.app, comb.id);
  await waitOne(W.d, ["bundled"]);
  const cb2 = appfn("chargeback", one(W.d).pi);
  note(SC, `combined approved; chargeback #2 opened: ${cb2}; hold=${L.holdOf(W.d.uid)}`);
  await payments(pr.app);
  await L.pairShot(pr, "C4-second-chargeback", "The combined payment was approved, then reversed too: a chargeback hold again owing $20.00 + one fee.", SC, "main");
  row = await adminRow(A, W.d);
  await L.shot(A, "C5-admin-row-both", "The admin's Chargeback holds row for Cal lists both chargebacks.", SC, row);
  for (let i = 0; i < 3; i++) { const tag = await testerTag(W.ts[i], W.w.s[i]); note(SC, `${NAMES[i]}'s tag: ${tag}`); if (i === 1) await L.shot(W.ts[i], "C6-tester-paid", `${NAMES[i]}'s part still reads “${tag}”.`, SC, "[data-part-status]"); }
  const s = L.stripeOut(W.d, "C-final", SC, "Pay what you owe, the reservation (captured), the combined payment");
  note(SC, `Stripe: ${s.count} PIs, ${s.succeeded} succeeded; rows: ${rows(W.d)}`);
  await L.pairVideo(pr, "C-two-chargebacks", "C · Chargeback on Pay what you owe, cleared; the after-lift combined payment approved and reversed: one hold each time, amount + one fee.", SC);
}

// ======================= D. One payment for the debt and the waiting charges, then a chargeback =======================
async function D() {
  const SC = "D";
  const W = await world("d", "Dana Fox", 3);
  await holdVia(W, 0);
  await tCharge(W, 1); await tCharge(W, 2); // during the hold: waiting
  const pr = await L.pair(W.d, W.d, "D · Dana Fox: one payment, one chargeback");
  await payments(pr.app);
  await L.pairShot(pr, "D1-box", "(§125) The box lists the debt AND both Charges made during the hold; Pay what you owe's total is all three ($30.00).", SC, "#owed");
  await pressOwed(pr.app, { complete: true });
  await waitOne(W.d, ["bundled"]);
  const o = one(W.d);
  await sleep(3000);
  await payments(pr.app);
  await L.pairShot(pr, "D2-paid", "One payment ($30.00) approved: all three paid by it, the hold lifted, nothing left to charge afterwards.", SC, "main");
  L.stripeOut(W.d, "D2-paid", SC, "one succeeded PaymentIntent");
  note(SC, `chargeback: ${appfn("chargeback", o.pi)}; again: ${appfn("chargeback", o.pi)}; hold=${L.holdOf(W.d.uid)}`);
  await payments(pr.app);
  await L.pairShot(pr, "D3-one-hold", "One chargeback on it: ONE chargeback hold owing $30.00 + one fee; there's no second payment to dispute.", SC, "main");
  const s = L.stripeOut(W.d, "D3-one-hold", SC, "still exactly one succeeded PaymentIntent");
  note(SC, `Stripe: ${s.count} PIs, ${s.succeeded} succeeded; deferred left: ${sql(`select count(*) from "Payment" where "developerId" = '${W.d.uid}' and status = 'deferred'`)}; rows: ${rows(W.d)}`);
  await L.pairVideo(pr, "D-one-payment-one-chargeback", "D · Pay what you owe covers the debt and the waiting charges as one payment; one chargeback -> one hold, amount + one fee.", SC);
}

// ======================= E. The double-charge cases =======================
const eWant = (k) => !process.env.EONLY || process.env.EONLY.split(",").includes(k);
async function E() {
  const SC = "E";
  // E1. Pay what you owe in two tabs at once (card 3184: two debts from Charges whose checks ran out).
  if (eWant("1")) {
    const W = await world("e1", "Eli Hart", 2);
    const p0 = await tCharge(W, 0), p1 = await tCharge(W, 1);
    await L.waitAction(W.w.sub[0]); await L.waitAction(W.w.sub[1]);
    runOut(p0); runOut(p1);
    const pr = await L.pair(W.d, W.d, "E1 · Pay what you owe in two tabs");
    const tab2 = await L.newPage({ from: W.d });
    await payments(pr.app); await payments(tab2);
    const b1 = pr.app.locator("#owed button", { hasText: /Pay what you owe/ }).first(), b2 = tab2.locator("#owed button", { hasText: /Pay what you owe/ }).first();
    const r2 = tab2.waitForResponse((r) => r.url().includes("/api/payments/owed") && r.request().method() === "POST", { timeout: 60000 }).catch(() => null);
    await Promise.all([b1.click(), b2.click()]);
    const got = await r2;
    note(SC, `E1 tab 2's press: ${got ? got.status() + " " + JSON.stringify(await got.json().catch(() => ({}))).slice(0, 200) : "no response"}`);
    await sleep(3000);
    await L.shot(tab2, "E1-tab2", "The other tab's press at the same moment charged nothing (the one payment had claimed both debts; this tab's box now waits for the bank).", SC, "#owed");
    // Whichever tab holds the bank's page completes it.
    for (const p of [pr.app, tab2]) if (await L.threeDS(p, true, 15000)) break;
    await waitOne(W.d, ["bundled"]);
    await sleep(3000);
    await L.pairShot(pr, "E1-one-charge", "Pay what you owe pressed in two tabs at once: ONE payment ($20.00) at Stripe.", SC, "main");
    const s = L.stripeOut(W.d, "E1-one-charge", SC, "the two expired checks (canceled) + ONE Pay what you owe");
    note(SC, `E1: Stripe ${s.count} PIs, ${s.succeeded} succeeded; owed payments made: ${sql(`select count(*) from "Payment" where "developerId" = '${W.d.uid}' and kind = 'owed'`)}`);
    await tab2.context().close();
    await L.pairVideo(pr, "E1-two-tabs", "E1 · Pay what you owe pressed in two tabs at once: one charge.", SC);
  }
  // E2. Confirm in one tab while saving a new card in another.
  if (eWant("2")) {
    const W = await world("e2", "Fay Orr", 1);
    const p = await tCharge(W, 0); await L.waitAction(W.w.sub[0]);
    const pr = await L.pair(W.d, W.d, "E2 · Confirm while a new card is saved");
    await testPage(pr.app, W.w.t);
    const c = await confirmItem(pr.app, p, { hold: true });
    await sleep(3000);
    const tab2 = await L.newPage({ from: W.d });
    await L.addCard(tab2, CARD_ASK, { tds: true });
    c.release();
    await sleep(6000);
    await testPage(pr.app, W.w.t);
    await L.pairShot(pr, "E2-one-charge", "Confirm with your bank completed in one tab while a new card was saved in another: the new card's cancel found it already paid, so it's recorded paid and nothing is charged on the new card.", SC, "main");
    const s = L.stripeOut(W.d, "E2-one-charge", SC, "one succeeded PaymentIntent");
    note(SC, `E2: payment ${sql(`select status from "Payment" where id = '${p}'`)}; Stripe ${s.count} PIs, ${s.succeeded} succeeded`);
    await tab2.context().close();
    await L.pairVideo(pr, "E2-confirm-vs-new-card", "E2 · Confirm in one tab, a new card in another: one charge.", SC);
  }
  // E3. Approving a check at the moment its 3 days run out.
  if (eWant("3")) {
    const W = await world("e3", "Gus Vale", 1);
    const p = await tCharge(W, 0); await L.waitAction(W.w.sub[0]);
    const pr = await L.pair(W.d, W.d, "E3 · approve as the 3 days run out");
    await testPage(pr.app, W.w.t);
    const c = await confirmItem(pr.app, p, { hold: true });
    await sleep(3000);
    note(SC, `E3 clock: ${JSON.stringify(runOut(p))}`);
    c.release();
    await sleep(6000);
    await testPage(pr.app, W.w.t);
    await L.pairShot(pr, "E3-one-charge", "Approved at the moment its 3 days ran out: the clock's cancel found it already paid at Stripe, so it's recorded paid (no debt, no hold), charged once.", SC, "main");
    const s = L.stripeOut(W.d, "E3-one-charge", SC, "one succeeded PaymentIntent");
    note(SC, `E3: payment ${sql(`select status from "Payment" where id = '${p}'`)}; hold=${L.holdOf(W.d.uid)}; Stripe ${s.succeeded} succeeded`);
    await L.pairVideo(pr, "E3-approve-vs-expiry", "E3 · Approve at the moment the 3 days run out: one charge.", SC);
  }
  // E4. A daily retry while a check is open; the whole box locked; Cancel this check unlocks it.
  if (eWant("4")) {
    const W = await world("e4", "Hal Bishop", 2);
    await holdVia(W, 0);
    await tCharge(W, 1);
    sql(`update "User" set "holdRetryAt" = null, "holdRetries" = 0 where id = '${W.d.uid}'`);
    note(SC, `E4 retry #1: ${JSON.stringify(appfn("retry", W.d.uid))}`);
    const o = one(W.d);
    const pr = await L.pair(W.d, W.d, "E4 · a daily retry while a check is open");
    await payments(pr.app);
    await L.pairShot(pr, "E4-locked", "The daily retry's one payment ($20.00: the debt and the waiting Charge) waits for the bank: every line says “Waiting for your bank”, with Cancel this check.", SC, "#owed");
    const before = appfn("stripe", W.d.uid).count;
    sql(`update "User" set "holdRetryAt" = (now() at time zone 'utc') - interval '2 days' where id = '${W.d.uid}'`);
    note(SC, `E4 daily job: ${JSON.stringify(appfn("daily"))}`);
    const tab2 = await L.newPage({ from: W.d });
    const r2 = await post(tab2, "/api/payments/owed", {});
    note(SC, `E4 another tab's press: ${r2.status} ${JSON.stringify(r2.body).slice(0, 160)}`);
    await tab2.context().close();
    const mid = L.stripeOut(W.d, "E4-after-retry", SC, "no new PaymentIntent from the daily job or the second press");
    note(SC, `E4 PaymentIntents before/after daily job + press: ${before} -> ${mid.count}`);
    await payments(pr.app);
    await pr.app.locator(`[data-cancel-check="${o.id}"]`).first().click();
    await sleep(4000);
    await payments(pr.app);
    await L.pairShot(pr, "E4-unlocked", "Cancel this check: cancelled at Stripe (Canceled), the box is payable again at once.", SC, "#owed");
    L.stripeOut(W.d, "E4-unlocked", SC, "the retry's PaymentIntent canceled");
    await L.pairVideo(pr, "E4-retry-while-open", "E4 · A daily retry and a second press while the one payment's check is open: nothing charged; Cancel this check unlocks the box.", SC);
  }
  // E5. A chargeback on the one total payment covering several debts.
  if (eWant("5")) {
    const W = await world("e5", "Ivy Moss", 2);
    const p0 = await tCharge(W, 0), p1 = await tCharge(W, 1);
    await L.waitAction(W.w.sub[0]); await L.waitAction(W.w.sub[1]);
    runOut(p0); runOut(p1);
    note(SC, `E5 debts: ${rows(W.d)}`);
    const pr = await L.pair(W.d, W.d, "E5 · chargeback on the one total");
    await pressOwed(pr.app, { complete: true });
    await waitOne(W.d, ["bundled"]);
    const o = one(W.d);
    note(SC, `E5 chargeback x2: ${appfn("chargeback", o.pi)} ${appfn("chargeback", o.pi)}`);
    await payments(pr.app);
    await L.pairShot(pr, "E5-once", "A chargeback on the one $20.00 payment that paid both debts: owed once, $20.00 + ONE fee; a second notice changes nothing.", SC, "main");
    const s = L.stripeOut(W.d, "E5-once", SC, "one succeeded PaymentIntent for both debts");
    note(SC, `E5: owed now ${sql(`select string_agg(kind || ' ' || "amountCents", ', ') from "Payment" where "developerId" = '${W.d.uid}' and chargeback = 'open'`)}; Stripe ${s.succeeded} succeeded`);
    await L.pairVideo(pr, "E5-chargeback-one-total", "E5 · A chargeback on the one total payment: the amount once + one fee.", SC);
  }
  // E6. Pay what you owe's 3-day check approved at the same moment as a new card; E7. one that runs out.
  if (eWant("6")) {
    const W = await world("e6", "Jo Rivera", 2);
    await holdVia(W, 0);
    sql(`update "User" set "holdRetryAt" = null, "holdRetries" = 0 where id = '${W.d.uid}'`);
    appfn("retry", W.d.uid);
    const o = one(W.d);
    const pr = await L.pair(W.d, W.d, "E6 · approve vs a new card");
    await payments(pr.app);
    const c = await confirmItem(pr.app, o.id, { hold: true });
    await sleep(3000);
    const tab2 = await L.newPage({ from: W.d });
    await L.addCard(tab2, CARD_ASK, { tds: true });
    c.release();
    await sleep(6000);
    await payments(pr.app);
    await L.pairShot(pr, "E6-one-charge", "Pay what you owe's check approved while a new card was saved: one outcome, one charge.", SC, "main");
    const s = L.stripeOut(W.d, "E6-one-charge", SC, "one succeeded PaymentIntent");
    note(SC, `E6: one payment ${one(W.d).status}; hold=${L.holdOf(W.d.uid)}; Stripe ${s.succeeded} succeeded`);
    await tab2.context().close();
    await L.pairVideo(pr, "E6-owed-check-vs-new-card", "E6 · Pay what you owe's bank check approved at the moment a new card is saved: one charge.", SC);
  }
  if (eWant("7")) {
    const W = await world("e7", "Kai Dunn", 2);
    await holdVia(W, 0);
    await tCharge(W, 1);
    sql(`update "User" set "holdRetryAt" = null, "holdRetries" = 0 where id = '${W.d.uid}'`);
    appfn("retry", W.d.uid);
    const o = one(W.d);
    runOut(o.id);
    const pr = await L.pair(W.d, W.d, "E7 · Pay what you owe's check runs out");
    await payments(pr.app);
    await L.pairShot(pr, "E7-ran-out", "Pay what you owe's 3-day check ran out: cancelled at Stripe, nothing charged; the debt stays owed and the Charge keeps waiting; the box unlocks and says “Your bank check ran out on …: nothing was charged. Pay again or change your card.”", SC, "#owed");
    const s = L.stripeOut(W.d, "E7-ran-out", SC, "the one payment canceled; nothing succeeded");
    note(SC, `E7: ${rows(W.d)}; Stripe ${s.succeeded} succeeded; line: ${(await pr.app.locator("[data-check-ran-out]").innerText().catch(() => "(none)"))}`);
    await L.pairVideo(pr, "E7-check-ran-out", "E7 · Pay what you owe's 3-day check runs out: nothing charged, the box unlocks.", SC);
  }
}

// ======================= G. The owner's full chain =======================
async function G() {
  const SC = "G";
  const W = await world("g", "Gia Moreno", 3);
  await holdVia(W, 0);
  const pr = await L.pair(W.d, W.d, "G · Gia Moreno: the full chain");
  await payments(pr.app);
  await L.pairShot(pr, "G1-hold", "A payment hold: Ana's Charge wasn't confirmed in 3 days.", SC, "#owed");
  // Pay what you owe: the bank's check opens (3184); while it is open Ben charges.
  await pressOwed(pr.app, { complete: null });
  await L.waitSql(`select count(*) from "Payment" where "developerId" = '${W.d.uid}' and kind = 'owed' and status = 'needs_action'`, (v) => Number(v) > 0, 60000);
  await tCharge(W, 1);
  note(SC, `Ben's Charge during the open check: ${rows(W.d)}`);
  const tab2 = await L.newPage({ from: W.d });
  await payments(tab2);
  await L.shot(tab2, "G2-late-charge", "While Pay what you owe's bank check is open, Ben charges: his $10.00 is NOT added to it (the payment stays $10.00); his line reads “Charged right after the payment above goes through”.", SC, "#owed");
  await tab2.context().close();
  await L.threeDS(pr.app, true, 45000);
  await waitOne(W.d, ["needs_confirmation", "bundled"], 90000);
  await sleep(3000);
  const owe = sql(`select id || '|' || coalesce("stripePaymentIntentId", '') from "Payment" where "developerId" = '${W.d.uid}' and kind = 'owed' and note = 'press' order by "createdAt" desc limit 1`).split("|");
  const comb = one(W.d);
  note(SC, `approved; hold=${L.holdOf(W.d.uid)}; Pay what you owe ${owe[0]} ${sql(`select status from "Payment" where id='${owe[0]}'`)}; then combined ${comb.cents / 100} ${comb.status}`);
  await payments(pr.app);
  await L.pairShot(pr, "G3-combined", "Approved: the hold lifted, and Ben's late Charge was made right after as one combined payment (card 3184: one “Confirm with your bank” item).", SC, "main");
  await confirmItem(pr.app, comb.id);
  await waitOne(W.d, ["bundled"]);
  L.stripeOut(W.d, "G3-combined", SC, "two succeeded payments: Pay what you owe and the combined one");
  note(SC, `chargeback #1 (Pay what you owe): ${appfn("chargeback", owe[1])}; hold=${L.holdOf(W.d.uid)}`);
  await payments(pr.app);
  await L.pairShot(pr, "G4-chargeback-1", "Chargeback #1 on Pay what you owe: one chargeback hold owing $10.00 + one fee.", SC, "main");
  note(SC, `chargeback #2 (combined): ${appfn("chargeback", one(W.d).pi)}; hold=${L.holdOf(W.d.uid)}; open chargebacks: ${sql(`select count(*) from "Payment" where "developerId" = '${W.d.uid}' and chargeback = 'open'`)}`);
  await payments(pr.app);
  await L.pairShot(pr, "G5-chargeback-2", "Chargeback #2 on the combined payment: added to the SAME hold ($10.00 + fee and $10.00 + fee).", SC, "main");
  const A = await admin();
  const row = await adminRow(A, W.d);
  await L.shot(A, "G6-admin-row", "The admin's Chargeback holds row for Gia lists both chargebacks.", SC, row);
  for (let i = 0; i < 2; i++) { const tag = await testerTag(W.ts[i], W.w.s[i]); note(SC, `${NAMES[i]}'s tag: ${tag}`); await L.shot(W.ts[i], `G7-tester-${i + 1}`, `${NAMES[i]}'s part reads “${tag}” (no hold or chargeback words).`, SC, "[data-part-status]"); }
  const s = L.stripeOut(W.d, "G7-stripe", SC, "exactly two succeeded payments, both disputed (via chargebackOpened), no third charge");
  note(SC, `Stripe: ${s.count} PIs, ${s.succeeded} succeeded`);
  await clearSteps(SC, pr, W.d, "G8");
  await payments(pr.app);
  await L.pairShot(pr, "G9-lifted", "The chargeback steps cleared (card verified, reservation, the team's Approve): the hold lifted.", SC, "main");
  const f = L.stripeOut(W.d, "G9-lifted", SC, "Pay what you owe, the combined payment, the reservation captured");
  note(SC, `final: hold=${L.holdOf(W.d.uid)}; Stripe ${f.count} PIs, ${f.succeeded} succeeded; rows: ${rows(W.d)}`);
  for (let i = 0; i < 2; i++) note(SC, `${NAMES[i]}'s tag after: ${await testerTag(W.ts[i], W.w.s[i])}`);
  await L.pairVideo(pr, "G-full-chain", "G · The owner's full chain: a late Charge during Pay what you owe's check, the lift, the combined payment, two chargebacks on one hold, the steps cleared.", SC);
}

// ======================= H. A hold starting cancels waiting checks at once; Verify a card's cancel is a safety net =======================
async function H() {
  const SC = "H";
  const W = await world("h", "Hana Ito", 3);
  const p0 = await tCharge(W, 0), p1 = await tCharge(W, 1);
  await L.waitAction(W.w.sub[0]); await L.waitAction(W.w.sub[1]);
  const pr = await L.pair(W.d, W.d, "H · Hana Ito: a hold cancels waiting checks; Verify a card");
  await payments(pr.app);
  await L.pairShot(pr, "H1-two-checks", "Two Charges wait for Hana's bank (Stripe: waiting for authentication).", SC, "[data-confirm-list]");
  L.stripeOut(W.d, "H1-two-checks", SC, "two PaymentIntents waiting");
  // A chargeback on an earlier payment: Cid's Charge went through on the card before (made directly at Stripe for this test: a 4242 test payment recorded as Cid's).
  const pi = await L.stripe.paymentIntents.create({ amount: 1000, currency: "usd", customer: sql(`select "stripeCustomerId" from "User" where id = '${W.d.uid}'`), payment_method: "pm_card_visa", confirm: true, off_session: true, description: "Playtest: Cid Moreau's written answers (an earlier payment, for this test)" });
  sql(`insert into "Payment" (id, kind, "submissionId", "contractId", "developerId", "testerId", "amountCents", "feeCents", "testerCents", status, "stripePaymentIntentId", "settledAt") select 'hpay' || substr(md5(random()::text), 1, 20), 'review', '${W.w.sub[2]}', '${W.w.s[2]}', '${W.d.uid}', "testerId", 1000, 200, 800, 'charged', '${pi.id}', now() from "Contract" where id = '${W.w.s[2]}'`);
  const t0 = Date.now();
  note(SC, `chargeback on Cid's payment: ${appfn("chargeback", pi.id)}; hold=${L.holdOf(W.d.uid)}`);
  const at = L.stripeOut(W.d, "H2-hold-started", SC, "right after the hold started: both waiting checks canceled at Stripe");
  note(SC, `seconds after the hold started: ${((Date.now() - t0) / 1000).toFixed(0)}; statuses: ${at.paymentIntents.map((x) => x.amount + " " + x.status + (x.canceled_at ? " canceled_at " + x.canceled_at : "")).join("; ")}`);
  await payments(pr.app);
  await L.pairShot(pr, "H2-hold-started", "The chargeback hold started: at that moment both waiting checks were cancelled at Stripe (Canceled) and wait for the lift.", SC, "main");
  // Verify a card (step 1) with no open check: nothing at Stripe changes.
  const before = appfn("stripe", W.d.uid);
  await L.verifyCard(pr.app);
  const after = appfn("stripe", W.d.uid);
  note(SC, `Verify a card with nothing open: PaymentIntents ${before.count} -> ${after.count}; statuses unchanged: ${JSON.stringify(before.paymentIntents.map((x) => x.status)) === JSON.stringify(after.paymentIntents.map((x) => x.status))}`);
  await payments(pr.app);
  await L.pairShot(pr, "H3-verified-nothing-to-cancel", "Verify a card (chargeback step 1): nothing was left to cancel, so nothing changed at Stripe.", SC, "[data-chargeback-steps]");
  L.stripeOut(W.d, "H3-verified-nothing-to-cancel", SC, "unchanged");
  // Pay what you owe: the reservation's bank check opens (3184) and is left open; Verify a card again meanwhile: the open reservation check is cancelled at Stripe.
  await pressOwed(pr.app, { complete: null });
  await L.waitSql(`select count(*) from "Reservation" where "developerId" = '${W.d.uid}' and status = 'needs_action'`, (v) => Number(v) > 0, 60000);
  const res = sql(`select "stripePaymentIntentId" from "Reservation" where "developerId" = '${W.d.uid}' and status = 'needs_action' limit 1`);
  L.stripeOut(W.d, "H4-reservation-open", SC, "the reservation's PaymentIntent waiting for the bank");
  const tab2 = await L.newPage({ from: W.d });
  await L.verifyCard(tab2);
  await tab2.context().close();
  const res2 = L.stripeOut(W.d, "H5-verify-cancelled-reservation", SC, "the open reservation check canceled by Verify a card");
  note(SC, `reservation ${res} at Stripe after Verify: ${res2.paymentIntents.filter((x) => x.id === res).map((x) => x.status).join()}; app: ${sql(`select status from "Reservation" where "stripePaymentIntentId" = '${res}'`)}`);
  await payments(pr.app);
  await L.pairShot(pr, "H5-verify-cancelled-reservation", "Verify a card while Pay what you owe's reservation check was open (on the old card): that check is cancelled at Stripe (Canceled); Pay what you owe reserves again on the new card.", SC, "main");
  await L.pairVideo(pr, "H-hold-cancels-checks", "H · A hold cancels every waiting check at once; Verify a card finds nothing left, except a reservation check left open, which it cancels.", SC);
}

// ======================= I. A chargeback on an OLDER payment while Pay what you owe's check is open =======================
/** An earlier payment that went through for Cid (made directly at Stripe with the 4242 test card and recorded as Cid's: card 3184 always asks the bank). */
async function olderPayment(W, i) {
  const pi = await L.stripe.paymentIntents.create({ amount: 700, currency: "usd", customer: sql(`select "stripeCustomerId" from "User" where id = '${W.d.uid}'`), payment_method: "pm_card_visa", confirm: true, off_session: true, description: "Playtest: an earlier payment for Cid Moreau's written answers" });
  sql(`insert into "Payment" (id, kind, "submissionId", "contractId", "developerId", "testerId", "amountCents", "feeCents", "testerCents", status, "stripePaymentIntentId", "settledAt") select 'ipay' || substr(md5(random()::text), 1, 20), 'review', '${W.w.sub[i]}', '${W.w.s[i]}', '${W.d.uid}', "testerId", 700, 140, 560, 'charged', '${pi.id}', now() from "Contract" where id = '${W.w.s[i]}'`);
  return pi.id;
}
async function I() {
  const SC = "I";
  for (const branch of ["approve", "verify"]) {
    const W = await world(`i${branch[0]}`, branch === "approve" ? "Iris Lund" : "Ivo Park", 3);
    const older = await olderPayment(W, 2);
    await holdVia(W, 0);
    const pr = await L.pair(W.d, W.d, `I · ${W.d.name}: a chargeback while Pay what you owe's check is open`);
    const oldTab = await L.newPage({ from: W.d });
    await payments(oldTab); // a page that shows $10.00 owed
    // It stays as loaded (its background redraw checks are held back), so it hasn't shown the chargeback when pressed.
    await oldTab.route(/\/api\/(account\/status|pulse|live|account\/changes)/, (r) => r.abort());
    await pressOwed(pr.app, { complete: null });
    await L.waitSql(`select count(*) from "Payment" where "developerId" = '${W.d.uid}' and kind = 'owed' and status = 'needs_action'`, (v) => Number(v) > 0, 60000);
    const o = one(W.d);
    await L.pairShot(pr, `I-${branch}-1-check-open`, "Pay what you owe ($10.00, fixed at the press): the bank's real 3D Secure page is open under the button.", SC, "#owed");
    note(SC, `[${branch}] chargeback on the older $7.00 payment: ${appfn("chargeback", older)}; hold=${L.holdOf(W.d.uid)}; open check ${o.id} ${one(W.d).status} ${o.cents / 100}`);
    L.stripeOut(W.d, `I-${branch}-2-chargeback`, SC, "the older payment disputed (via chargebackOpened); the one payment's check still open");
    if (branch === "approve") {
      // (4) The old page (still showing $10.00) presses Pay what you owe: it stops once naming the chargeback, charging nothing.
      const btn = oldTab.locator("#owed button", { hasText: /Pay what you owe/ }).first();
      const resp = oldTab.waitForResponse((r) => r.url().includes("/api/payments/owed") && r.request().method() === "POST", { timeout: 60000 }).catch(() => null);
      await btn.click({ timeout: 10000 }).catch((e) => note(SC, "old page's button: " + String(e.message).slice(0, 120)));
      const got = await resp;
      const rb = got ? await got.json().catch(() => ({})) : { none: "no request (the button was disabled)" };
      await oldTab.waitForTimeout(1500);
      note(SC, `[approve] the old page's press: ${JSON.stringify(rb).slice(0, 300)}`);
      await L.shot(oldTab, "I-approve-3-old-page-stops", "A page that hadn't shown the chargeback: Pay what you owe stops once, naming it (“Your bank reversed a $7 payment: $7 + $15 chargeback fee”), and charges nothing.", SC, "#owed");
      // (1) Approving the open check pays exactly what it covered.
      await pr.app.bringToFront();
      await L.threeDS(pr.app, true, 45000);
      await waitOne(W.d, ["bundled"]);
      await sleep(3000);
      await payments(pr.app);
      await L.pairShot(pr, "I-approve-4-paid-8", "Approved: exactly the $10.00 it covered was paid (Ana's debt); (2) the box now shows the reversed $7 + $15 fee under the chargeback steps; the hold stays (a chargeback hold).", SC, "main");
      const s = L.stripeOut(W.d, "I-approve-4-paid", SC, "the older payment (disputed) and the one $10.00 payment; nothing more");
      note(SC, `[approve] one payment ${one(W.d).cents / 100} ${one(W.d).status}; Stripe ${s.count} PIs, ${s.succeeded} succeeded; hold=${L.holdOf(W.d.uid)}; rows: ${rows(W.d)}`);
    } else {
      // (3) Verify a card while the check is still open: cancelled at Stripe first.
      const tab2 = await L.newPage({ from: W.d });
      await L.verifyCard(tab2);
      await tab2.context().close();
      await sleep(2000);
      const s = L.stripeOut(W.d, "I-verify-3-cancelled", SC, "the open one payment's PaymentIntent canceled by Verify a card");
      note(SC, `[verify] one payment now ${one(W.d).status}; its PI at Stripe: ${s.paymentIntents.filter((x) => x.id === o.actionPi).map((x) => x.status).join()}; Stripe succeeded: ${s.succeeded}`);
      await payments(pr.app);
      await L.pairShot(pr, "I-verify-3-cancelled", "Verify a card while that check was still open: the check is cancelled at Stripe first (Canceled); nothing charged on either card; Pay what you owe now reserves the debt and the reversed payment + fee.", SC, "main");
    }
    await oldTab.context().close();
    await L.pairVideo(pr, `I-${branch}`, branch === "approve" ? "I · A chargeback arrives while Pay what you owe's check is open: an old page's press stops once naming it; approving the check pays exactly what it covered." : "I · Verify a card while Pay what you owe's check is open: the check is cancelled at Stripe first.", SC);
  }
}

// ======================= J. (I, part 4) The old page's press after the chargeback: stops once naming it =======================
async function J() {
  const SC = "J";
  const W = await world("ij", "Ines Roy", 3);
  const older = await olderPayment(W, 2);
  await holdVia(W, 0);
  const pr = await L.pair(W.d, W.d, "I · Ines Roy: an old page's press after the chargeback");
  const oldTab = await L.newPage({ from: W.d, video: true });
  await payments(oldTab);
  // The old page stays as loaded: every background GET it makes is held back (only its own press goes through).
  await oldTab.route("**/api/**", (r) => (r.request().method() === "GET" ? r.abort() : r.continue()));
  await pressOwed(pr.app, { complete: null });
  await L.waitSql(`select count(*) from "Payment" where "developerId" = '${W.d.uid}' and kind = 'owed' and status = 'needs_action'`, (v) => Number(v) > 0, 60000);
  note(SC, `[old page] chargeback on the older $7.00 payment: ${appfn("chargeback", older)}; hold=${L.holdOf(W.d.uid)}`);
  await oldTab.bringToFront();
  const btn = oldTab.locator("#owed button", { hasText: /Pay what you owe/ }).first();
  const resp = oldTab.waitForResponse((r) => r.url().includes("/api/payments/owed") && r.request().method() === "POST", { timeout: 60000 }).catch(() => null);
  await btn.click({ timeout: 10000 }).catch((e) => note(SC, "old page's button: " + String(e.message).slice(0, 120)));
  const got = await resp;
  const rb = got ? await got.json().catch(() => ({})) : { none: "no request" };
  fs.writeFileSync(path.join(L.OUT, "I-old-page-response.json"), JSON.stringify({ status: got ? got.status() : null, body: rb }, null, 2));
  note(SC, `[old page] press: ${JSON.stringify(rb).slice(0, 400)}`);
  await oldTab.waitForTimeout(1500);
  await L.shot(oldTab, "I-old-page-stops", "A page that hadn't shown the chargeback: Pay what you owe stops once, naming it (“Your bank reversed a $7 payment: $7 + $15 chargeback fee”), and charges nothing.", SC, "#owed");
  const v = oldTab.video(); await oldTab.context().close(); await v.saveAs(path.join(L.OUT, "I-old-page-stops.webm"));
  L.record("I-old-page-stops.webm", "The old page's Pay what you owe after the chargeback: stops once naming it; nothing charged.", SC);
  const s = L.stripeOut(W.d, "I-old-page-stops", SC, "no new PaymentIntent from the old page's press");
  note(SC, `[old page] Stripe ${s.count} PIs, ${s.succeeded} succeeded`);
  await pr.app.context().close(); await pr.pan.context().close();
}

const SCEN = { A, B, C, D, E, G, H, I, J };
(async () => {
  await L.start();
  for (const k of process.argv.slice(2)) {
    console.log(`== ${k}`);
    try { await SCEN[k](); } catch (e) { console.error(`!! ${k} failed:`, e.stack || e); note(k, "ERROR " + String(e.message || e).slice(0, 300)); }
    L.writeMade();
    fs.writeFileSync(path.join(L.OUT, `results-${k}.json`), JSON.stringify(results[k] ?? [], null, 2));
  }
  await L.stop();
})();
