// The partial-dispute proof (docs/media/partial-dispute/): REAL Stripe test-mode payments made through the app's own routes on the 3485 server (pl-dispute worktree,
// rec_dispute schema), a REAL full dispute (card 4000 0000 0000 0259) and a partial dispute delivered as Stripe sends one (a signed charge.dispute.created with the real
// PaymentIntent and charge ids and amount 9600). Each step saves screenshots, the Stripe objects listed through the API (<step>.stripe.json + .stripe.md) and notes
// (results.json). Throwaway accounts only (rec+pd…@playtest.test).
//   node scripts/partial-dispute/run.cjs          (from PowerShell: Chrome; the 3485 server must be running: serve.cjs)
/* eslint-disable */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const L = require("./lib.cjs");
const { deliver, envelope } = require("./webhook.cjs");
const { ADMIN_EMAIL } = require("./env.cjs");
const { sql, post, ok, sleep, appfn, log } = L;
const CARD_OK = "4242 4242 4242 4242";
const CARD_ASK = "4000 0027 6000 3184"; // always asks the bank (3D Secure), on-session and off-session
const CARD_DISPUTE = "4000 0000 0000 0259"; // the charge goes through, then the bank disputes the whole amount (fraudulent)
// SKIP_A=1: step A (the real 0259 dispute) was recorded by an earlier run: its files and notes are kept, its event is the template for the partial one.
const SKIP_A = process.env.SKIP_A === "1";
const prior = SKIP_A && fs.existsSync(path.join(L.OUT, "results.json")) ? JSON.parse(fs.readFileSync(path.join(L.OUT, "results.json"), "utf8")) : null;
const results = { notes: prior ? prior.notes.filter((n) => n.step.startsWith("A ")) : [], ids: prior ? Object.fromEntries(Object.entries(prior.ids).filter(([k]) => k.startsWith("full"))) : {} };
if (SKIP_A && fs.existsSync(path.join(L.OUT, "made.json"))) for (const m of JSON.parse(fs.readFileSync(path.join(L.OUT, "made.json"), "utf8"))) if (m.step.startsWith("A ")) L.made.push(m);
const note = (step, line) => { results.notes.push({ step, line }); log(`[${step}] ${line}`); };
const save = () => { fs.writeFileSync(path.join(L.OUT, "results.json"), JSON.stringify(results, null, 2) + "\n"); L.writeMade(); };

const payments = async (page) => { await page.goto(`/app/payments`); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1500); };
const section = (page, title) => page.locator("section", { has: page.locator("h2", { hasText: title }) }).first();
const paidTexts = async (page) => (await section(page, "What you've paid").locator("li").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
/** The developer presses Pay on a piece (the route the page's Pay button posts to). */
async function pay(dev, subId, cents) {
  const r = await post(dev, "/api/review", { kind: "submission", id: subId, amount: (cents / 100).toFixed(2), tickedCents: cents, over200: cents > 20000, understood: cents > 20000, payKey: crypto.randomUUID(), seenAt: L.nowIso(), confirmed: true, reason: "" });
  return ok(r, "Pay");
}
/** Pay what you owe on Payments (the button; a stop-once box pressed through). The bank's real 3D Secure page under it is completed (card 3184 always asks). */
async function pressOwed(page) {
  await payments(page);
  const btn = page.locator("#owed button", { hasText: /Pay what you owe/ }).first();
  await btn.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(800);
  await btn.click();
  await page.waitForTimeout(2500);
  if (await page.locator("#owed").getByText("Press again").count()) { await btn.click(); await page.waitForTimeout(2000); }
  await L.threeDS(page, true, 60000);
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
  return row;
}
const oneOf = (d) => { const r = sql(`select id || '|' || status || '|' || coalesce("stripePaymentIntentId", coalesce("actionPi", '')) || '|' || "amountCents" from "Payment" where "developerId" = '${d.uid}' and kind = 'owed' order by "createdAt" desc limit 1`).split("|"); return { id: r[0], status: r[1], pi: r[2], cents: Number(r[3]) }; };
const chargeOf = (listing, pi) => listing.paymentIntents.find((p) => p.id === pi)?.charge?.id;
const disputeObject = (template, pi, chargeId, amount, status = "needs_response") => ({
  ...(template ?? { object: "dispute", balance_transactions: [], currency: "usd", evidence: {}, evidence_details: { due_by: Math.floor(Date.now() / 1000) + 8 * 86400, has_evidence: false, past_due: false, submission_count: 0 }, is_charge_refundable: false, livemode: false, metadata: {}, reason: "fraudulent" }),
  id: `dp_proof_${crypto.randomBytes(6).toString("hex")}`, amount, charge: chargeId, payment_intent: pi, status, created: Math.floor(Date.now() / 1000), balance_transactions: [],
});
const hidden = (ev) => JSON.parse(JSON.stringify(ev));

(async () => {
  await L.start();
  try {
    // ---------------- A. A full dispute, for real (card 0259) ----------------
    const SA = "A full dispute (card 0259)";
    let real = null, fullDispute = null, ADM = null;
    if (SKIP_A) { real = JSON.parse(fs.readFileSync(path.join(L.OUT, "A2-real-event.json"), "utf8")); ADM = await L.admin(ADMIN_EMAIL); }
    else {
    const fred = await L.account("fred", "Fred Ortiz", "developer");
    const eve = await L.account("eve", "Eve Park", "tester");
    await L.addCard(fred, CARD_DISPUTE);
    const skyLab = await L.postTest(fred, { productName: "Sky Harbor", title: "Sky Harbor", writtenCents: "50.00" });
    const eveS = await L.join(eve, skyLab);
    await L.sendWritten(eve, eveS);
    const eveSub = L.subOf(eveS);
    await pay(fred, eveSub, 5000);
    const fredPi = sql(`select "stripePaymentIntentId" from "Payment" where "submissionId" = '${eveSub}' and status = 'charged' limit 1`);
    results.ids.fullPaymentIntent = fredPi;
    note(SA, `Fred paid Eve $50.00 with card 0259: ${fredPi}; rows: ${L.payRows(fred.uid)}`);
    // Stripe opens the dispute on its own a few seconds after the charge.
    let listing = null;
    for (let i = 0; i < 40; i++) { listing = appfn("stripe", fred.uid); if (listing.paymentIntents.some((p) => p.id === fredPi && p.disputes.length)) break; await sleep(3000); }
    fullDispute = listing.paymentIntents.find((p) => p.id === fredPi)?.disputes[0];
    note(SA, `Stripe's dispute: ${JSON.stringify(fullDispute)}`);
    await payments(fred);
    await L.shot(fred, "A1-paid-0259", "Fred's Payments right after paying Eve $50.00 with card 0259 (before Stripe's dispute reaches the app).", SA, section(fred, "What you've paid"));
    L.stripeOut(fred, "A1-paid-0259", SA, "the $50.00 payment and the dispute Stripe opened on it by itself");
    // Stripe's webhook can't reach this local server: the REAL event (from Stripe's event list) is delivered to it with a signature made with the local webhook secret.
    for (let i = 0; i < 20 && !real; i++) { real = appfn("event", fredPi); if (!real) await sleep(3000); }
    results.ids.fullEvent = real?.id ?? null;
    if (real) fs.writeFileSync(path.join(L.OUT, "A2-real-event.json"), JSON.stringify(hidden(real), null, 2) + "\n");
    const fullEv = real ?? envelope("charge.dispute.created", fullDispute);
    const d1 = await deliver(fullEv);
    note(SA, `delivered ${real ? "the real" : "a rebuilt"} charge.dispute.created (${fullEv.id}, amount ${fullEv.data.object.amount}): HTTP ${d1.status} ${d1.body}`);
    const d1again = await deliver(fullEv);
    note(SA, `the same event again: HTTP ${d1again.status} ${d1again.body}`);
    await payments(fred);
    await L.shot(fred, "A2-full-owed", "Fred's Payments after the real dispute: the chargeback steps and the owed line for the WHOLE $50 (+ $15 fee), worded as before.", SA, "[data-chargeback-steps]");
    results.ids.fullOwedLines = await fred.locator("#owed li").allInnerTexts().catch(() => []);
    L.stripeOut(fred, "A2-full-owed", SA, "the same objects: the dispute at Stripe is the whole $50.00");
    ADM = await L.admin(ADMIN_EMAIL);
    const fullRow = await adminRow(ADM, fred);
    await L.shotOf(ADM, "A3-admin-row-full", "The admin's chargeback-hold row for Fred: the whole $50.00, with the PaymentIntent id.", SA, fullRow);
    save();
    }

    // ---------------- B. Dana pays two pieces (card 4242) ----------------
    const SB = "B two pieces paid";
    const dana = await L.account("dana", "Dana Reyes", "developer");
    const T = [];
    for (const [k, n] of [["ana", "Ana Silva"], ["ben", "Ben Okafor"], ["cid", "Cid Moreau"], ["dee", "Dee Lin"]]) T.push(await L.account(k, n, "tester"));
    await L.addCard(dana, CARD_OK);
    const harbor = await L.postTest(dana);
    const S = [], SUB = [];
    for (const t of T) { const s = await L.join(t, harbor); await L.sendWritten(t, s); S.push(s); SUB.push(L.subOf(s)); }
    await pay(dana, SUB[0], 24467);
    await pay(dana, SUB[1], 24467);
    note(SB, `Dana paid Ana and Ben $244.67 each; rows: ${L.payRows(dana.uid)}`);
    await payments(dana);
    await L.shot(dana, "B1-two-paid", "Dana's What you've paid: Ana's and Ben's written answers, $244.67 each (card 4242).", SB, section(dana, "What you've paid"));
    L.stripeOut(dana, "B1-two-paid", SB, "two PaymentIntents, $244.67 each, succeeded");
    save();

    // ---------------- C. A hold, then ONE combined Pay what you owe payment ----------------
    const SC = "C one combined payment during a hold";
    await L.addCard(dana, CARD_ASK, { tds: true });
    L.openCharge(S[2], harbor); L.openCharge(S[3], harbor);
    const cidCharge = await L.chargeApi(T[2], S[2], SUB[2], 24467);
    note(SC, `Cid pressed Charge $244.67 (card 3184 asks the bank: a "Confirm with your bank" item): ${cidCharge.status} ${JSON.stringify(cidCharge.body).slice(0, 160)}`);
    const cidPay = await L.waitSql(`select id from "Payment" where "submissionId" = '${SUB[2]}' and "actionPi" is not null limit 1`, (v) => !!v, 90000);
    // Its 3 days to confirm run out (moved in the rec_dispute schema), then the clock: a declined payment, so a payment hold starts.
    sql(`update "Payment" set "actionBy" = ${L.U} - interval '1 minute' where id = '${cidPay}'`);
    appfn("expire");
    note(SC, `Cid's check ran out: hold=${L.holdOf(dana.uid)}; rows: ${L.payRows(dana.uid)}`);
    const deeCharge = await L.chargeApi(T[3], S[3], SUB[3], 20000);
    note(SC, `Dee pressed Charge $200.00 during the hold (it waits and rides along): ${deeCharge.status} ${JSON.stringify(deeCharge.body).slice(0, 160)}`);
    await payments(dana);
    await L.shot(dana, "C1-hold-owed", "Dana's payment hold: Pay what you owe lists Cid's declined charge and Dee's charge waiting for the lift, $444.67 in all.", SC, "#owed");
    L.stripeOut(dana, "C1-hold-owed", SC, "Cid's charge waited for the bank and was cancelled when its 3 days ran out; nothing was taken");
    await pressOwed(dana);
    const one = await (async () => { for (let i = 0; i < 60; i++) { const o = oneOf(dana); if (o.status === "bundled") return o; await sleep(2000); } return oneOf(dana); })();
    results.ids.combinedPaymentIntent = one.pi;
    note(SC, `Pay what you owe: ONE payment ${one.pi} for $${(one.cents / 100).toFixed(2)} (${one.status}); hold=${L.holdOf(dana.uid)}; rows: ${L.payRows(dana.uid)}`);
    await payments(dana);
    await L.shot(dana, "C2-one-payment", "After Pay what you owe ($444.67, the bank's 3D Secure test page completed): the hold lifted; Cid's and Dee's pieces are paid by that one payment.", SC, section(dana, "What you've paid"));
    const afterOne = L.stripeOut(dana, "C2-one-payment", SC, "ONE PaymentIntent for $444.67 (Pay what you owe) covering Cid's and Dee's pieces");
    for (const [i, t] of [[2, T[2]], [3, T[3]]]) { await payments(t); await L.shot(t, `C3-tester-${["", "", "cid", "dee"][i]}`, `${t.name}'s Payments: what they earn from Dana's payment.`, SC, section(t, "Your earnings")); }
    save();

    // ---------------- D. The bank disputes $96 of the $444.67 ----------------
    const SD = "D a partial dispute ($96 of $444.67)";
    const chargeId = chargeOf(afterOne, one.pi);
    const template = real?.data?.object ?? fullDispute ?? null;
    const partialEv = envelope("charge.dispute.created", disputeObject(template && { ...template }, one.pi, chargeId, 9600));
    if (real?.api_version) partialEv.api_version = real.api_version;
    fs.writeFileSync(path.join(L.OUT, "D1-partial-event.json"), JSON.stringify(partialEv, null, 2) + "\n");
    const d2 = await deliver(partialEv);
    note(SD, `delivered charge.dispute.created ${partialEv.id} (amount 9600, payment_intent ${one.pi}, charge ${chargeId}): HTTP ${d2.status} ${d2.body}`);
    const d2again = await deliver(partialEv);
    note(SD, `the same event delivered again: HTTP ${d2again.status} ${d2again.body}`);
    note(SD, `rows: ${L.payRows(dana.uid)}; hold=${L.holdOf(dana.uid)}`);
    await payments(dana);
    await L.shot(dana, "D1-partial-owed", "Dana's Payments: the chargeback steps and the owed line for $96 of the $444.67 (+ ONE $15 fee), with what that payment covered listed under it.", SD, "[data-chargeback-steps]");
    await L.shotOf(dana, "D1-partial-owed-box", "The owed box up close.", SD, "#owed");
    results.ids.partialOwedLines = await dana.locator("#owed li").allInnerTexts().catch(() => []);
    await L.shot(dana, "D2-partial-paid-list", "Dana's What you've paid while the chargeback is open: the pieces stay paid; the total takes off the $96 the bank reversed.", SD, section(dana, "What you've paid"));
    results.ids.paidListOpen = await paidTexts(dana);
    const partialRow = await adminRow(ADM, dana);
    await L.shotOf(ADM, "D3-admin-row-partial", "The admin's chargeback-hold row for Dana: $96.00 of a $444.67 payment, with the PaymentIntent id.", SD, partialRow);
    await ADM.goto("/dev/outbox"); await ADM.waitForTimeout(1500);
    await L.shot(ADM, "D4-admin-email", "The chargeback email to the admins (dev outbox, nothing is really sent): “Playtest: new chargeback of $96.00”.", SD, "main", { full: false });
    results.ids.adminEmails = sql(`select subject || ' :: ' || replace(text, chr(10), ' / ') from "OutboxEmail" where subject like 'Playtest:%chargeback%' order by "createdAt"`).split("\n");
    for (const [k, t] of [["cid", T[2]], ["dee", T[3]]]) { await payments(t); await L.shot(t, `D5-tester-${k}`, `${t.name}'s Payments after the dispute: unchanged (testers never see chargebacks).`, SD, section(t, "Your earnings")); }
    L.stripeOut(dana, "D6-partial", SD, "Stripe test mode can't open a PARTIAL dispute, so Stripe itself shows no dispute on this PaymentIntent: the event was delivered to the app as Stripe sends one");
    save();

    // ---------------- E. Stripe changes the disputed amount (charge.dispute.updated) ----------------
    const SE = "E the disputed amount changes";
    const up1 = await deliver(envelope("charge.dispute.updated", { ...partialEv.data.object, amount: 12000 }));
    note(SE, `charge.dispute.updated amount 12000 (open, nothing repaid): HTTP ${up1.status}; rows: ${L.payRows(dana.uid)}`);
    await payments(dana);
    await L.shotOf(dana, "E1-followed", "charge.dispute.updated to $120.00 while nothing is repaid: followed (now $120 + $15).", SE, "#owed");
    const up2 = await deliver(envelope("charge.dispute.updated", { ...partialEv.data.object, amount: 9600 }));
    note(SE, `charge.dispute.updated back to 9600: HTTP ${up2.status}; rows: ${L.payRows(dana.uid)}`);
    save();

    // ---------------- F. The chargeback steps: verify, reserve $111, the team's Approve ----------------
    const SF = "F chargeback steps";
    await L.verifyCard(dana);
    await pressOwed(dana);
    await L.waitSql(`select count(*) from "Reservation" where "developerId" = '${dana.uid}' and status = 'reserved'`, (v) => Number(v) > 0, 90000);
    note(SF, `reserved: ${sql(`select status || ' $' || ("amountCents"/100.0)::text || ' ' || coalesce("stripePaymentIntentId", '') from "Reservation" where "developerId" = '${dana.uid}' order by "createdAt" desc limit 1`)}`);
    await payments(dana);
    await L.shot(dana, "F1-reserved", "Card verified with 3D Secure; Pay what you owe reserved $111.00 ($96 + $15) on the card (Stripe: Uncaptured).", SF, "[data-chargeback-steps]");
    L.stripeOut(dana, "F1-reserved", SF, "the reservation: a manual-capture PaymentIntent for $111.00");
    const up3 = await deliver(envelope("charge.dispute.updated", { ...partialEv.data.object, amount: 5000 }));
    note(SF, `charge.dispute.updated to 5000 after the reservation: HTTP ${up3.status} (not followed: logged for the admins); rows: ${L.payRows(dana.uid)}`);
    await ADM.goto(`/app/developers/${dana.uid}`); await ADM.waitForLoadState("networkidle").catch(() => {}); await ADM.waitForTimeout(2500);
    const box = ADM.locator(`[data-admin-box="u-chargebacks"]`).first();
    await L.shotOf(ADM, "F2-admin-log", "The admin's Chargebacks box for Dana: the open chargeback ($96.00 of a $444.67 payment) and Stripe's amount changes, followed or not.", SF, box);
    const row = await adminRow(ADM, dana);
    await L.shotOf(ADM, "F3-admin-approve", "The admin's row before Approve: card verified, $111.00 reserved.", SF, row);
    const ap = await post(ADM, "/api/admin/approve-chargeback", { id: dana.uid, note: "" });
    note(SF, `admin Approve: ${ap.status} ${JSON.stringify(ap.body).slice(0, 200)}`);
    await sleep(3000);
    note(SF, `rows: ${L.payRows(dana.uid)}; hold=${L.holdOf(dana.uid)}`);
    await payments(dana);
    await L.shot(dana, "F4-repaid", "After the team's Approve: the hold lifted; What you've paid shows the repayment “Repaid $96 reversed from your $444.67 payment ($96 + $15 chargeback fee)”.", SF, section(dana, "What you've paid"));
    results.ids.paidListRepaid = await paidTexts(dana);
    const afterRepay = L.stripeOut(dana, "F4-repaid", SF, "the reservation captured: $111.00");
    for (const [k, t] of [["cid", T[2]], ["dee", T[3]]]) { await payments(t); await L.shot(t, `F5-tester-${k}`, `${t.name}'s Payments after the repayment: unchanged.`, SF, section(t, "Your earnings")); }
    save();

    // ---------------- G. The platform wins it: exactly what was repaid is refunded ----------------
    const SG = "G won";
    const won = await deliver(envelope("charge.dispute.closed", { ...partialEv.data.object, status: "won" }));
    note(SG, `charge.dispute.closed (won): HTTP ${won.status}; rows: ${L.payRows(dana.uid)}`);
    await sleep(2000);
    await payments(dana);
    await L.shot(dana, "G1-won", "Won: the $111.00 repayment is refunded to the card; What you've paid counts the $444.67 payment fully again.", SG, section(dana, "What you've paid"));
    results.ids.paidListWon = await paidTexts(dana);
    L.stripeOut(dana, "G1-won", SG, "the refund of exactly $111.00 on the reservation's charge");
    void afterRepay;
    save();

    // ---------------- H. Every PaymentIntent's description next to its Payments row ----------------
    const SH = "H descriptions";
    const final = appfn("stripe", dana.uid);
    const rowsByPi = sql(`select coalesce("stripePaymentIntentId", '') || '|' || id || '|' || kind || '|' || status from "Payment" where "developerId" = '${dana.uid}' and "stripePaymentIntentId" is not null order by "createdAt"`).split("\n").filter(Boolean).map((l) => l.split("|"));
    results.descriptions = final.paymentIntents.map((p) => ({ pi: p.id, amount: p.amount, status: p.status, description: p.description, rows: rowsByPi.filter((r) => r[0] === p.id).map((r) => `${r[2]} ${r[3]} (${r[1]})`) }));
    note(SH, `${results.descriptions.length} PaymentIntents listed with their descriptions`);
    results.pageLines = appfn("pagelines", dana.uid);
    fs.writeFileSync(path.join(L.OUT, "H1-descriptions.json"), JSON.stringify({ stripe: results.descriptions, page: results.pageLines }, null, 2) + "\n");
    L.record("H1-descriptions.json", "each PaymentIntent's description next to the What you've paid rows charged on it", SH);
    save();
  } catch (e) {
    console.error(String(e?.stack ?? e).replace(/whsec_[A-Za-z0-9]+/g, "whsec_[hidden]"));
    results.error = String(e?.message ?? e);
    save();
    process.exitCode = 1;
  } finally {
    await L.stop();
  }
})();
