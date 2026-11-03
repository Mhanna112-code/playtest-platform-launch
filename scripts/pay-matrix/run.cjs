// The payment stop matrix (§159) recordings: the 3517 server (this worktree, rec_paymatrix schema, Stripe TEST mode) recorded beside the Stripe viewer (3518).
// Throwaway accounts only (rec+…@playtest.test). One short clip per row; each row's Stripe listing is saved next to it (<name>.stripe.json).
//   MEDIA_OUT=<folder> node scripts/pay-matrix/run.cjs A B C D E F G H I J
// A caption bar is drawn at the bottom of the app's page for each step (plain words). The rows' results (PASS or App bug) go to cases.json in MEDIA_OUT.
/* eslint-disable */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const L = require("./lib.cjs");
const { sql, post, ok, sleep, lit } = L;
const CARD_ASK = "4000 0027 6000 3184"; // always asks the bank (3D Secure)
const CARD_OK = "4242 4242 4242 4242";
const CARD_DISPUTE = "4000 0000 0000 0259"; // goes through, then Stripe opens a real (test) dispute on it
const log = (...a) => console.log("  ", ...a);
const CASES = path.join(L.OUT, "cases.json");
const cases = fs.existsSync(CASES) ? JSON.parse(fs.readFileSync(CASES, "utf8")) : [];
const saveCase = (c) => { const i = cases.findIndex((x) => x.title === c.title); if (i >= 0) cases[i] = c; else cases.push(c); fs.writeFileSync(CASES, JSON.stringify(cases, null, 2)); };
const STATE = path.join(L.OUT, "state.json");

// ---------- the world (made once, kept in state.json so a row can be run again) ----------
async function world() {
  if (fs.existsSync(STATE)) {
    const s = JSON.parse(fs.readFileSync(STATE, "utf8"));
    const back = async (x) => Object.assign(await L.newPage(), x);
    for (const k of Object.keys(s)) {
      const p = await L.newPage();
      await p.context().addCookies(s[k].cookies);
      Object.assign(p, { email: s[k].email, name: s[k].name, uid: s[k].uid });
      s[k] = p;
    }
    void back;
    return s;
  }
  const d1 = await L.account("pm-dev", "Nora Lane", "developer");
  await L.addCard(d1, CARD_OK);
  const d2 = await L.account("pm-dev3ds", "Omar Reyes", "developer");
  await L.addCard(d2, CARD_ASK, { tds: true });
  const ana = await L.account("pm-ana", "Ana Silva", "tester");
  const ben = await L.account("pm-ben", "Ben Okafor", "tester");
  await L.connect(ana);
  await L.connect(ben);
  const admin = await L.admin();
  const W = { d1, d2, ana, ben, admin };
  const out = {};
  for (const [k, p] of Object.entries(W)) out[k] = { email: p.email, name: p.name, uid: p.uid, cookies: await p.context().cookies() };
  fs.writeFileSync(STATE, JSON.stringify(out, null, 2));
  return W;
}

// ---------- API steps (setup, and the other side's actions during a clip) ----------
const now = () => new Date().toISOString();
let runN = Date.now() % 1000;
async function mkTest(dev, title0, over = {}) {
  const title = `${title0} · ${++runN}`;
  return L.postTest(dev, { productName: title, title, recordingCents: "10.00", liveRateCents: "30.00", liveMinutes: 30, ...over });
}
async function joinWritten(t, testId) {
  const s = await L.join(t, testId);
  await L.sendWritten(t, s);
  return { s, sub: L.subOf(s) };
}
async function sendRec(t, s) {
  const st = ok(await post(t, `/api/sessions/${s}/recording-start`, { filename: "run.webm", size: 16, contentType: "video/webm" }), "recording start");
  await t.context().request.put(L.BASE + st.uploadUrl, { data: Buffer.from("tiny test video!"), headers: { "content-type": "video/webm" } });
  ok(await post(t, `/api/sessions/${s}/recording-done`, { recordingId: st.recordingId }), "recording done");
  ok(await post(t, `/api/sessions/${s}/recording-send`, { seenAt: now(), confirmed: true }), "recording send");
  return sql(`select id from "Submission" where "contractId" = ${lit(s)} and kind = 'recording'`);
}
/** Pay through the route (setup): with a card that asks the bank, the bank's real check page is completed. */
async function payApi(dev, kind, id, cents, reason = "") {
  const r = await post(dev, "/api/review", { kind, id, amount: (cents / 100).toFixed(2), tickedCents: cents, reason, payKey: crypto.randomUUID(), seenAt: now(), confirmed: true });
  if (!r.ok) throw new Error(`pay failed: ${JSON.stringify(r.body).slice(0, 300)}`);
  if (r.body.requiresAction) await finishCheck(dev, r.body);
  return r.body;
}
async function finishCheck(dev, a) {
  if (a.checkUrl) {
    const P = await L.newPage({ from: dev });
    await P.goto(a.checkUrl);
    await P.waitForTimeout(2000);
    await L.threeDS(P, true);
    await P.waitForTimeout(2500);
    await P.context().close();
  }
  return ok(await post(dev, "/api/payments/confirm", { paymentId: a.paymentId }), "finish check");
}
async function disputeApi(t, s, kind, id) {
  ok(await post(t, `/api/sessions/${s}/dispute`, { kind, id, reason: "I did everything the listing asked for.", seenAt: now(), confirmed: true }), "dispute");
  return sql(`select id from "Dispute" where "contractId" = ${lit(s)} order by "createdAt" desc limit 1`);
}
const decide = async (admin, disputeId, total, tickCents) => ok(await post(admin, "/api/admin/decide", { id: disputeId, total, tickCents }), "decide");
const ignore = (testId, keys) => sql(`update "Test" set "ignoredAlerts" = ARRAY[${keys.map(lit).join(",")}]::text[] where id = ${lit(testId)}`);
const testerAlertsOff = (t, off) => sql(`update "User" set "testerAlertsOff" = ${off} where id = ${lit(t.uid)}`);
function openChoice(subId, testId) {
  sql(`update "Submission" set "sentAt" = ${L.U} - interval '15 days', "payBy" = ${L.U} - interval '1 day', "choiceOfferedAt" = ${L.U} - interval '1 day', "choiceBy" = ${L.U} + interval '6 days' where id = ${lit(subId)}`);
  sql(`update "Test" set "openUntil" = ${L.U} - interval '1 day' where id = ${lit(testId)}`);
}
/** A booked call for this tester (requested by the developer, accepted), then moved to the past and measured at 30 minutes, so Pay shows for it. */
async function pastCall(dev, t, testId, s) {
  const at = new Date(Date.now() + 48 * 3600000); at.setUTCSeconds(0, 0);
  ok(await post(dev, `/api/tests/${testId}/request-time`, { seenAt: now(), confirmed: true, contractIds: [s], startsAt: at.toISOString() }), "request time");
  const q = sql(`select id from "CallRequest" where "contractId" = ${lit(s)} and status = 'pending' order by "createdAt" desc limit 1`);
  ok(await post(t, `/api/sessions/${s}/answer-request`, { requestId: q, action: "accept", seenAt: now(), confirmed: true }), "accept");
  const call = sql(`select id from "Call" where "contractId" = ${lit(s)} and status = 'booked' order by "createdAt" desc limit 1`);
  sql(`update "Call" set "startsAt" = ${L.U} - interval '3 hours', "measuredMinutes" = 30, "measuredAt" = ${L.U} - interval '2 hours', "measuredFrom" = ${L.U} - interval '3 hours', "measuredTo" = ${L.U} - interval '150 minutes', "endedAt" = ${L.U} - interval '150 minutes' where id = ${lit(call)}`);
  sql(`update "CallSlot" set "startsAt" = ${L.U} - interval '3 hours' where id = (select "slotId" from "Call" where id = ${lit(call)})`);
  return call;
}

// ---------- the recorded page ----------
async function caption(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById("__cap");
    if (!el) { el = document.createElement("div"); el.id = "__cap"; el.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:rgba(10,14,30,.92);color:#fff;font:600 17px/1.35 system-ui,Segoe UI,Arial,sans-serif;padding:10px 16px;border-top:3px solid #f5a524;pointer-events:none"; document.body.appendChild(el); }
    el.textContent = t;
  }, text).catch(() => {});
}
async function capWait(page, text, ms = 1800) { await caption(page, text); await page.waitForTimeout(ms); }
async function openPage(page, url, target) {
  await page.goto(url);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
  if (target) await page.locator(target).first().evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
}
/** The Pay (or Pay more) box of a piece: amount typed, tick ticked, reason when asked. */
async function fillPay(page, id, cents, reason = "") {
  const amt = page.locator(`#amt-${id}`).last();
  await amt.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await amt.fill((cents / 100).toFixed(2));
  const box = amt.locator("xpath=ancestor::div[contains(@class,'space-y-3')][1]");
  const why = box.locator(`#why-${id}`);
  if (reason && (await why.count())) await why.fill(reason);
  const tick = box.locator(`#tick-${id}`);
  if (await tick.count()) await tick.check();
  return box;
}
const payButton = (box) => box.locator("button.btn-green").first();
/** The second press: the page may have redrawn the box after the stop (amount or tick cleared): filled again only if the button is disabled. */
async function pressAgain(page, id, cents, reason = "") {
  await page.waitForTimeout(400);
  let box = page.locator(`#amt-${id}`).last().locator("xpath=ancestor::div[contains(@class,'space-y-3')][1]");
  if (await payButton(box).isDisabled().catch(() => true)) {
    const st = { amt: await page.locator(`#amt-${id}`).last().inputValue().catch(() => "?"), tick: await page.locator(`#tick-${id}`).last().isChecked().catch(() => "?") };
    console.log("   . button disabled before the second press; box:", JSON.stringify(st));
    box = await fillPay(page, id, cents, reason);
  }
  await payButton(box).click();
}
async function stopText(page, root = "body") {
  const b = page.locator(`${root} [data-stop-box]`).first();
  try { await b.waitFor({ timeout: 15000 }); } catch { return ""; }
  await b.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
  return (await b.innerText()).replace(/\s+/g, " ").trim();
}
const paysOf = (devUid) => sql(`select coalesce(string_agg(kind || ':' || status || ' $' || ("amountCents"/100.0)::numeric(10,2), ', ' order by "createdAt"), '') from "Payment" where "developerId" = ${lit(devUid)}`);
const waitPaid = (where, ms = 60000) => L.waitSql(`select count(*) from "Payment" where ${where} and status in ('charged','not_set_up')`, (v) => Number(v) > 0, ms);

function verdict(name, title, explanation, good, bug) {
  const v = good ? `${explanation} PASS.` : `${explanation} App bug: ${bug}`;
  saveCase({ title, desktop: `${name}.webm`, phone: null, explanation: v, stripe: `${name}.stripe.json` });
  console.log(`   ${good ? "PASS" : "BUG "} ${title}`);
  return good;
}

// ---------- rows ----------
/** A common test for a 4242 developer: Ana's written answers paid $4.00 and disputed, Ana's recording sent (unpaid), Ben's written answers sent (unpaid). */
async function decisionWorld(W, title, dev = W.d1) {
  const t = await mkTest(dev, title);
  const a = await joinWritten(W.ana, t);
  const rec = await sendRec(W.ana, a.s);
  const b = await joinWritten(W.ben, t);
  await payApi(dev, "submission", a.sub, 400, "Only half of the answers were useful.");
  const dispute = await disputeApi(W.ana, a.s, "submission", a.sub);
  return { t, a, rec, b, dispute };
}

async function A(W) {
  const name = "a-pay-same-tester-decision";
  const X = await decisionWorld(W, "Harbor Run A");
  ignore(X.t, ["disputes", "admin"]);
  const pr = await L.pair(W.d1, W.d1, "A · Pay after the team's decision on the SAME tester", [W.ana]);
  await openPage(pr.app, `/app/tests/${X.t}`);
  await capWait(pr.app, "Nora's test page is open. Alerts: “Disputes” and “Decisions by the team” are ticked off (ignored).", 2500);
  const box = await fillPay(pr.app, X.rec, 1000);
  await capWait(pr.app, "Meanwhile the team decides Ana's dispute about her WRITTEN ANSWERS: $10 in all (Stripe charges Nora $6 more).", 600);
  await decide(W.admin, X.dispute, "10.00", 600);
  await pr.app.waitForTimeout(1500);
  await capWait(pr.app, "Nora presses Pay on Ana's RECORDING (the page hasn't shown the decision yet)…", 600);
  await payButton(box).click();
  const st = await stopText(pr.app);
  await capWait(pr.app, st ? "Stops once, naming the decision about Ana — even though Decisions by the team is ticked off. Nothing charged yet." : "No stop box appeared.", 3500);
  const before = paysOf(W.d1.uid);
  await pressAgain(pr.app, X.rec, 1000);
  await capWait(pr.app, "Second press: the Pay goes through. Stripe (right): a new $10.00 payment Succeeded.", 600);
  const paid = await waitPaid(`"submissionId" = ${lit(X.rec)}`);
  await pr.app.waitForTimeout(3000);
  await L.pairVideo(pr, name, "", "A");
  const s = L.stripeOut(W.d1, name, "A");
  const good = /The team decided Ana Silva's dispute/.test(st) && Number(paid) > 0 && s.paymentIntents.some((p) => p.amount === "10.00" && p.status === "succeeded");
  return verdict(name, "A · Pay on the same tester after the team's decision (Decisions ticked off)",
    `Nora's page was open with “Decisions by the team” ticked off. The team decided Ana's dispute about her written answers; Nora then pressed Pay on Ana's recording. The first press stopped once, naming “The team decided Ana Silva's dispute…”, and charged nothing; the second press paid $10.00 (Stripe: Succeeded; the decision's own $6.00 charge is also there).`,
    good, `stop box: “${st || "none"}”; payments: ${before} → ${paysOf(W.d1.uid)}`);
}

async function B(W) {
  let all = true;
  for (const ticked of [false, true]) {
    const name = ticked ? "b2-pay-other-tester-decisions-on" : "b1-pay-other-tester-decisions-off";
    const X = await decisionWorld(W, `Harbor Run B${ticked ? 2 : 1}`);
    ignore(X.t, ticked ? ["disputes"] : ["disputes", "admin"]);
    const pr = await L.pair(W.d1, W.d1, `B · Pay on ANOTHER tester after a decision · Decisions ${ticked ? "ON" : "ticked OFF"}`, [W.ana, W.ben]);
    await openPage(pr.app, `/app/tests/${X.t}`);
    await capWait(pr.app, ticked ? "Alerts: “Decisions by the team” is ON (not ignored)." : "Alerts: “Decisions by the team” is ticked OFF (ignored).", 2500);
    const box = await fillPay(pr.app, X.b.sub, 1000);
    await capWait(pr.app, "Meanwhile the team decides ANA's dispute ($10 in all).", 600);
    await decide(W.admin, X.dispute, "10.00", 600);
    await pr.app.waitForTimeout(1500);
    await capWait(pr.app, "Nora presses Pay on BEN's written answers…", 600);
    await payButton(box).click();
    let st = "";
    if (ticked) {
      st = await stopText(pr.app);
      await capWait(pr.app, st ? "Decisions ON: it stops once, naming Ana's decision. Nothing charged." : "No stop box appeared.", 3500);
      await pressAgain(pr.app, X.b.sub, 1000);
      await capWait(pr.app, "Second press: paid. Stripe: $10.00 Succeeded.", 600);
    } else {
      await pr.app.waitForTimeout(2500);
      st = (await pr.app.locator("[data-stop-box]").count()) ? await stopText(pr.app) : "";
      await capWait(pr.app, st ? "It stopped (it shouldn't have)." : "Decisions ticked off and it's another tester: it goes straight through. Stripe: $10.00 Succeeded.", 600);
    }
    const paid = await waitPaid(`"submissionId" = ${lit(X.b.sub)}`);
    await pr.app.waitForTimeout(3000);
    await L.pairVideo(pr, name, "", "B");
    const s = L.stripeOut(W.d1, name, "B");
    const good = (ticked ? /The team decided Ana Silva's dispute/.test(st) : !st) && Number(paid) > 0 && s.paymentIntents.some((p) => p.amount === "10.00" && p.status === "succeeded");
    all = verdict(name, `B${ticked ? 2 : 1} · Pay on another tester after a decision, Decisions ${ticked ? "on" : "ticked off"}`,
      ticked ? "“Decisions by the team” on. The team decided Ana's dispute; Nora pressed Pay on Ben's written answers: it stopped once naming the decision, and the second press paid $10.00 (Stripe: Succeeded)."
        : "“Decisions by the team” ticked off. The team decided Ana's dispute; Nora pressed Pay on Ben's written answers: it went straight through (a decision about another tester follows the Alerts ticks) and Stripe shows $10.00 Succeeded.",
      good, `stop box: “${st || "none"}”; paid rows: ${paid}`) && all;
  }
  return all;
}

async function C(W) {
  const name = "c-pay-more-same-tester-decision";
  const X = await decisionWorld(W, "Harbor Run C");
  await payApi(W.d1, "submission", X.rec, 500, "Half of the recording was silent.");
  ignore(X.t, ["disputes", "admin"]);
  const pr = await L.pair(W.d1, W.d1, "C · Pay more after the team's decision on the SAME tester", [W.ana]);
  await openPage(pr.app, `/app/tests/${X.t}`);
  await capWait(pr.app, "Ana's recording was paid $5.00. Alerts: “Decisions by the team” ticked off.", 2500);
  const box = await fillPay(pr.app, X.rec, 200);
  await capWait(pr.app, "Meanwhile the team decides Ana's dispute about her written answers ($10 in all).", 600);
  await decide(W.admin, X.dispute, "10.00", 600);
  await pr.app.waitForTimeout(1500);
  await capWait(pr.app, "Nora presses Pay more ($2.00) on Ana's recording…", 600);
  await payButton(box).click();
  const st = await stopText(pr.app);
  await capWait(pr.app, st ? "Stops once, naming the decision about Ana. Nothing charged." : "No stop box appeared.", 3500);
  await pressAgain(pr.app, X.rec, 200);
  await capWait(pr.app, "Second press: Pay more goes through. Stripe: $2.00 Succeeded.", 600);
  const paid = await waitPaid(`"submissionId" = ${lit(X.rec)} and kind = 'extra'`);
  await pr.app.waitForTimeout(3000);
  await L.pairVideo(pr, name, "", "C");
  const s = L.stripeOut(W.d1, name, "C");
  const good = /The team decided Ana Silva's dispute/.test(st) && Number(paid) > 0 && s.paymentIntents.some((p) => p.amount === "2.00" && p.status === "succeeded");
  return verdict(name, "C · Pay more on the same tester after the team's decision (Decisions ticked off)",
    "Ana's recording was already paid $5.00; “Decisions by the team” ticked off. The team decided Ana's dispute about her written answers; Nora's Pay more ($2.00) on Ana's recording stopped once naming the decision, and the second press paid it (Stripe: $2.00 Succeeded).",
    good, `stop box: “${st || "none"}”; extra rows: ${paid}`);
}

async function D(W) {
  const name = "d-confirm-bank-after-decision";
  const t = await mkTest(W.d2, "Harbor Run D");
  const a = await joinWritten(W.ana, t);
  const rec = await sendRec(W.ana, a.s);
  await payApi(W.d2, "submission", a.sub, 400, "Only half of the answers were useful.");
  const dispute = await disputeApi(W.ana, a.s, "submission", a.sub);
  ignore(t, ["disputes", "admin", "payments"]);
  // Ana charges for her recording while Omar is away: card 3184 asks the bank, so it waits as "Confirm with your bank".
  openChoice(rec, t);
  const ch = await post(W.ana, `/api/sessions/${a.s}/choose`, { choice: "charge", submissionId: rec, amount: "10.00", tickedCents: 1000, seenAt: now(), confirmed: true });
  log("Ana's Charge:", ch.status);
  await L.waitAction(rec);
  const waitId = sql(`select id from "Payment" where "submissionId" = ${lit(rec)} order by "createdAt" desc limit 1`);
  const pr = await L.pair(W.d2, W.d2, "D · Confirm with your bank after a decision on that tester (card 3184)", [W.ana]);
  await openPage(pr.app, `/app/tests/${t}`, `[data-bank-waiting="${waitId}"]`);
  await capWait(pr.app, "Ana's $10.00 Charge waits for Omar's bank (card 3184). Alerts: Disputes, Decisions and Payments ticked off.", 2500);
  await capWait(pr.app, "Meanwhile the team decides Ana's dispute about her written answers (pay stays at $4.00: nothing charged).", 600);
  await decide(W.admin, dispute, "4.00", 0);
  await pr.app.waitForTimeout(1500);
  const btn = pr.app.locator(`[data-bank-waiting="${waitId}"] button`).first();
  await btn.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await capWait(pr.app, "Omar presses our “Confirm with your bank” button…", 600);
  await btn.click();
  const st = await stopText(pr.app, `[data-bank-waiting="${waitId}"]`).then((x) => x || stopText(pr.app));
  const noFrame = !(await pr.app.locator("[data-bank-check]").count());
  await capWait(pr.app, st ? "Stops once at OUR button, naming the decision — the bank's page has not opened. Nothing charged." : "No stop box appeared.", 3500);
  await btn.click();
  await capWait(pr.app, "Second press: the bank's own page opens inline (Stripe's 3D Secure test page). Its only button we press is Complete.", 3000);
  await L.threeDS(pr.app, true, 60000);
  const paid = await L.waitSql(`select status from "Payment" where id = ${lit(waitId)}`, (v) => v === "charged", 60000);
  await capWait(pr.app, "Complete → paid. Stripe: the $10.00 payment Succeeded with 3D Secure authenticated.", 4000);
  await L.pairVideo(pr, name, "", "D");
  const s = L.stripeOut(W.d2, name, "D");
  const good = /The team decided Ana Silva's dispute/.test(st) && noFrame && paid === "charged" && s.paymentIntents.some((p) => p.amount === "10.00" && p.status === "succeeded");
  return verdict(name, "D · Confirm with your bank on a waiting charge after a decision on that tester (card 3184)",
    "Ana's $10.00 Charge, made while Omar was away, waited for his bank (card 3184). The team decided Ana's dispute about her written answers (Decisions ticked off). Omar's first press on our “Confirm with your bank” stopped once naming the decision, before any bank page opened; the second press opened Stripe's own 3D Secure page inline, whose only button pressed was Complete, and the payment went through (Stripe: $10.00 Succeeded).",
    good, `stop box: “${st || "none"}”; bank frame before the stop: ${!noFrame}; payment: ${paid}`);
}

async function E(W) {
  const name = "e-pay-own-check-after-change";
  const t = await mkTest(W.d2, "Harbor Run E");
  const a = await joinWritten(W.ana, t);
  const pr = await L.pair(W.d2, W.d2, "E · Pay with card 3184 after an unseen change: stop first, then the bank", [W.ana]);
  await openPage(pr.app, `/app/tests/${t}`);
  await capWait(pr.app, "Omar (card 3184: every payment asks the bank) has the test page open.", 2500);
  const box = await fillPay(pr.app, a.sub, 1000);
  await capWait(pr.app, "Meanwhile Ana adds more to her written answers.", 600);
  ok(await post(W.ana, `/api/sessions/${a.s}/written-add`, { text: "One more thing: the map button hides behind the sail on small screens.", seenAt: now(), confirmed: true }), "add");
  await pr.app.waitForTimeout(1200);
  await capWait(pr.app, "Omar presses Pay…", 600);
  await payButton(box).click();
  const st = await stopText(pr.app);
  const noFrame = !(await pr.app.locator("[data-bank-check]").count());
  await capWait(pr.app, st ? "Stops once at OUR Pay button, naming Ana's addition — no bank page opened, nothing charged." : "No stop box appeared.", 3500);
  await pressAgain(pr.app, a.sub, 1000);
  await capWait(pr.app, "Second press: the bank's page opens under Pay. Complete is its only button.", 3000);
  await L.threeDS(pr.app, true, 60000);
  const paid = await waitPaid(`"submissionId" = ${lit(a.sub)}`);
  await capWait(pr.app, "Complete → paid; the check closes by itself. Stripe: $10.00 Succeeded, 3D Secure authenticated.", 4000);
  await L.pairVideo(pr, name, "", "E");
  const s = L.stripeOut(W.d2, name, "E");
  const good = /added to (her|their) written answers/.test(st) && noFrame && Number(paid) > 0 && s.paymentIntents.some((p) => p.amount === "10.00" && p.status === "succeeded" && p.created > new Date(Date.now() - 600000).toISOString());
  return verdict(name, "E · Pay's own bank check (card 3184) after an unseen change",
    "Omar's card asks the bank on every payment. Ana added to her written answers after his page loaded; his first Pay stopped once at our button naming the addition, with no bank page opened and nothing charged. The second press opened Stripe's own 3D Secure page under Pay; Complete (its only button) paid it, and the check closed by itself (Stripe: $10.00 Succeeded).",
    good, `stop box: “${st || "none"}”; bank frame before the stop: ${!noFrame}`);
}

async function F(W) {
  let all = true;
  const variants = [
    { k: "f1", same: true, off: false }, { k: "f2", same: true, off: true },
    { k: "f3", same: false, off: false }, { k: "f4", same: false, off: true },
  ].filter((v) => !process.env.ONLY_F || process.env.ONLY_F.split(",").includes(v.k));
  for (const v of variants) {
    const name = `${v.k}-pay-after-addition-${v.same ? "same" : "other"}-part-work-${v.off ? "off" : "on"}`;
    const t = await mkTest(W.d1, `Harbor Run ${v.k.toUpperCase()}`);
    const a = await joinWritten(W.ana, t);
    const rec = v.same ? null : await sendRec(W.ana, a.s);
    if (v.off) ignore(t, ["work"]);
    const target = v.same ? a.sub : rec;
    const shouldStop = v.same || !v.off;
    const pr = await L.pair(W.d1, W.d1, `F · Ana adds to her written answers; Pay on ${v.same ? "THOSE answers" : "her RECORDING"} · “Work sent” ${v.off ? "ticked OFF" : "ON"}`, [W.ana]);
    await openPage(pr.app, `/app/tests/${t}`);
    await capWait(pr.app, `Alerts: “Work sent” is ${v.off ? "ticked OFF (ignored)" : "ON"}.`, 2500);
    const box = await fillPay(pr.app, target, 1000);
    await capWait(pr.app, "Meanwhile Ana adds more to her WRITTEN ANSWERS.", 600);
    ok(await post(W.ana, `/api/sessions/${a.s}/written-add`, { text: "One more thing: the map button hides behind the sail on small screens.", seenAt: now(), confirmed: true }), "add");
    await pr.app.waitForTimeout(1200);
    await capWait(pr.app, `Nora presses Pay on Ana's ${v.same ? "written answers (the part Ana just added to)" : "recording (another part)"}…`, 600);
    await payButton(box).click();
    let st = "";
    if (shouldStop) {
      st = await stopText(pr.app);
      await capWait(pr.app, st ? (v.same && v.off ? "Stops once, naming the addition — work on the part being paid stops even with “Work sent” ticked off. Nothing charged." : "Stops once, naming Ana's addition. Nothing charged.") : "No stop box appeared.", 3500);
      await pressAgain(pr.app, target, 1000);
      await capWait(pr.app, "Second press: paid. Stripe: $10.00 Succeeded.", 600);
    } else {
      await pr.app.waitForTimeout(2500);
      st = (await pr.app.locator("[data-stop-box]").count()) ? await stopText(pr.app) : "";
      await capWait(pr.app, st ? "It stopped (it shouldn't have)." : "Work on ANOTHER part with “Work sent” ticked off: no stop. Paid at once — Stripe: $10.00 Succeeded.", 600);
    }
    const paid = await waitPaid(`"submissionId" = ${lit(target)}`);
    await pr.app.waitForTimeout(3000);
    await L.pairVideo(pr, name, "", "F");
    const s = L.stripeOut(W.d1, name, "F");
    const good = (shouldStop ? /added to (her|their) written answers/.test(st) : !st) && Number(paid) > 0 && s.paymentIntents.some((p) => p.amount === "10.00" && p.status === "succeeded");
    const expl = v.same
      ? `“Work sent” ${v.off ? "ticked off" : "on"}. Ana added to her written answers after Nora's page loaded; Nora's Pay on those answers stopped once naming the addition${v.off ? " (the same part always stops, whatever the tick)" : ""}, and the second press paid $10.00 (Stripe: Succeeded).`
      : v.off ? "“Work sent” ticked off. Ana added to her written answers after Nora's page loaded; Nora's Pay on Ana's recording (another part) went straight through (Stripe: $10.00 Succeeded)."
        : "“Work sent” on. Ana added to her written answers after Nora's page loaded; Nora's Pay on Ana's recording (another part) stopped once naming the addition, and the second press paid $10.00 (Stripe: Succeeded).";
    all = verdict(name, `${v.k.toUpperCase()} · Ana adds to her written answers, then Pay on ${v.same ? "those answers" : "her recording"} · “Work sent” ${v.off ? "ticked off" : "on"}`, expl, good, `stop box: “${st || "none"}”`) && all;
  }
  return all;
}

async function G(W) {
  let all = true;
  for (const off of [false, true]) {
    const name = off ? "g2-tester-leaves-leaving-off" : "g1-tester-leaves-leaving-on";
    const t = await mkTest(W.d1, `Harbor Run G${off ? 2 : 1}`);
    const a = await L.join(W.ana, t);
    const b = await joinWritten(W.ben, t);
    if (off) ignore(t, ["leaving"]);
    const pr = await L.pair(W.d1, W.d1, `G · A tester leaves · Alerts “Testers leaving” ${off ? "ticked OFF" : "ON"}`, [W.ben]);
    await openPage(pr.app, `/app/tests/${t}`);
    await capWait(pr.app, `Alerts: “Testers leaving” is ${off ? "ticked OFF (ignored)" : "ON"}.`, 2500);
    const box = await fillPay(pr.app, b.sub, 1000);
    await capWait(pr.app, "Meanwhile Ana leaves the test.", 600);
    ok(await post(W.ana, `/api/sessions/${a}/leave`, { seenAt: now(), confirmed: true }), "leave");
    await pr.app.waitForTimeout(1200);
    await capWait(pr.app, "Nora presses Pay on BEN's written answers…", 600);
    await payButton(box).click();
    let st = "";
    if (!off) {
      st = await stopText(pr.app);
      await capWait(pr.app, st ? "Stops once: “Ana Silva left the test”. Nothing charged." : "No stop box appeared.", 3500);
      await pressAgain(pr.app, b.sub, 1000);
      await capWait(pr.app, "Second press: paid. Stripe: $10.00 Succeeded.", 600);
    } else {
      await pr.app.waitForTimeout(2500);
      st = (await pr.app.locator("[data-stop-box]").count()) ? await stopText(pr.app) : "";
      await capWait(pr.app, st ? "It stopped (it shouldn't have)." : "“Testers leaving” ticked off: straight through. Stripe: $10.00 Succeeded.", 600);
    }
    const paid = await waitPaid(`"submissionId" = ${lit(b.sub)}`);
    await pr.app.waitForTimeout(3000);
    await L.pairVideo(pr, name, "", "G");
    const s = L.stripeOut(W.d1, name, "G");
    const good = (off ? !st : /Ana Silva left the test/.test(st)) && Number(paid) > 0 && s.paymentIntents.some((p) => p.amount === "10.00" && p.status === "succeeded");
    all = verdict(name, `G${off ? 2 : 1} · A tester leaves, then Pay on another · “Testers leaving” ${off ? "ticked off" : "on"}`,
      off ? "“Testers leaving” ticked off. Ana left after Nora's page loaded; Nora's Pay on Ben's answers went straight through (Stripe: $10.00 Succeeded)."
        : "“Testers leaving” on. Ana left after Nora's page loaded; Nora's Pay on Ben's answers stopped once naming “Ana Silva left the test”, the second press paid $10.00 (Stripe: Succeeded).",
      good, `stop box: “${st || "none"}”`) && all;
  }
  return all;
}

/** Tester side: Ana's written answers and recording both open for Charge / Let it go on a 4242 developer's test. */
async function choiceWorld(W, title) {
  const t = await mkTest(W.d1, title);
  const a = await joinWritten(W.ana, t);
  const rec = await sendRec(W.ana, a.s);
  openChoice(a.sub, t);
  openChoice(rec, t);
  return { t, a, rec };
}
async function chargeBox(page, part) {
  const root = page.locator(`#part-${part}`).first();
  await root.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
  return root;
}
async function H(W) {
  const rows = [
    // [name, title, alertsOff, what happens meanwhile, press, expect]
    { name: "h1-charge-same-part-paid-alerts-off", title: "H1 · Ana's Charge after Nora paid THAT part (Ana's Alerts Off)", off: true, press: "charge", part: "written", ev: "same" },
    { name: "h2-charge-other-part-paid-alerts-on", title: "H2 · Ana's Charge after Nora paid her OTHER part (Alerts On)", off: false, press: "charge", part: "written", ev: "other" },
    { name: "h3-letgo-other-part-paid-alerts-off", title: "H3 · Ana's Let it go after Nora paid her OTHER part (Alerts Off)", off: true, press: "letgo", part: "written", ev: "other" },
    { name: "h4-charge-decision-alerts-off", title: "H4 · Ana's Charge after the team's decision on her dispute (Alerts Off)", off: true, press: "charge", part: "written", ev: "decision" },
    { name: "h5-letgo-decision-alerts-on", title: "H5 · Ana's Let it go after the team's decision on her dispute (Alerts On)", off: false, press: "letgo", part: "written", ev: "decision" },
  ];
  let all = true;
  for (const r of rows) {
    if (process.env.ONLY_H && !process.env.ONLY_H.split(",").includes(r.name.slice(0, 2))) continue;
    const X = await choiceWorld(W, `Harbor Run ${r.name.slice(0, 2).toUpperCase()}`);
    testerAlertsOff(W.ana, r.off);
    let dispute = "";
    if (r.ev === "decision") {
      // Nora paid the recording $4.00 and Ana disputed it (before her page loaded).
      sql(`update "Submission" set "choiceOfferedAt" = null where id = ${lit(X.rec)}`);
      await payApi(W.d1, "submission", X.rec, 400, "Half of the recording was silent.");
      dispute = await disputeApi(W.ana, X.a.s, "submission", X.rec);
    }
    const pr = await L.pair(W.ana, W.d1, r.title, [W.ana]);
    await openPage(pr.app, `/app/sessions/${X.a.s}`, `#part-${r.part}`);
    await capWait(pr.app, `Ana's page is open. Her Alerts are ${r.off ? "OFF" : "ON"}. Her written answers are open for Charge / Let it go.`, 2500);
    const root = await chargeBox(pr.app, r.part);
    const evText = r.ev === "same" ? "Meanwhile Nora pays $10.00 for Ana's WRITTEN ANSWERS (the part Ana is about to charge)." : r.ev === "other" ? "Meanwhile Nora pays $10.00 for Ana's RECORDING (her other part)." : "Meanwhile the team decides Ana's dispute about her recording (the pay stays at $4.00).";
    await capWait(pr.app, evText, 600);
    if (r.ev === "same") await payApi(W.d1, "submission", X.a.sub, 1000);
    else if (r.ev === "other") await payApi(W.d1, "submission", X.rec, 1000);
    else await decide(W.admin, dispute, "4.00", 0);
    await pr.app.waitForTimeout(1200);
    const pressIt = async () => {
      if (r.press === "charge") await root.locator("button.btn", { hasText: /^Charge/ }).first().click();
      else { await root.locator("[data-letgo-tick] input").first().check(); await root.locator("button", { hasText: /^Let it go$/ }).first().click(); }
    };
    await capWait(pr.app, `Ana presses ${r.press === "charge" ? "Charge" : "Let it go"} on her written answers…`, 600);
    await pressIt();
    const st = await stopText(pr.app);
    const refusal = st && /paid \$10\.00 for this meanwhile/.test(st);
    const wantStop = r.ev !== "other" || !r.off;
    let after = "";
    if (refusal) await capWait(pr.app, "Nora's payment left nothing to charge: refused, naming it (“Nora Lane paid $10.00 for this meanwhile”). Stripe: no charge from Ana's press.", 4000);
    else if (st) {
      await capWait(pr.app, `Stops once, naming it — ${r.off ? "even with Ana's Alerts Off" : "Ana's Alerts are On"}. Nothing charged.`, 3500);
      await pressIt();
      after = r.press === "charge" ? "Second press: Charge goes through. Stripe: Nora is charged $10.00 (Succeeded)." : "Second press: Let it go goes through (nothing is charged).";
      await capWait(pr.app, after, 600);
    } else {
      await capWait(pr.app, r.press === "charge" ? "No stop (a payment on her OTHER part follows her Alerts: Off). Charge goes through: Stripe $10.00 Succeeded." : "No stop (a payment on her OTHER part follows her Alerts: Off). Let it go goes through.", 600);
    }
    const done = await L.waitSql(`select coalesce((select case when reason <> '' then reason else 'paid' end from "Review" where "submissionId" = ${lit(X.a.sub)}), '')`, (v) => !!v, 30000);
    await pr.app.waitForTimeout(3500);
    await L.pairVideo(pr, r.name, "", "H");
    const s = L.stripeOut(W.d1, r.name, "H");
    const named = r.ev === "decision" ? /The team decided your dispute about your recording/.test(st) : /paid \$10\.00 for your recording/.test(st);
    const good = r.ev === "same" ? refusal : wantStop ? named && !!done : !st && !!done;
    const expl = r.ev === "same" ? "Ana's Alerts Off. Nora paid $10.00 for Ana's written answers after Ana's page loaded; Ana's Charge on that same part was refused, naming it (“Nora Lane paid $10.00 for this meanwhile.”): nothing was left to charge, and Stripe shows no charge from Ana's press."
      : r.ev === "other" ? (r.off ? `Ana's Alerts Off. Nora paid $10.00 for Ana's recording (her other part) after Ana's page loaded; Ana's ${r.press === "charge" ? "Charge" : "Let it go"} on her written answers went straight through (a payment on another part follows her Alerts).` : `Ana's Alerts On. Nora paid $10.00 for Ana's recording after Ana's page loaded; Ana's ${r.press === "charge" ? "Charge" : "Let it go"} on her written answers stopped once naming “Nora Lane paid $10.00 for your recording”; the second press went through${r.press === "charge" ? " (Stripe: $10.00 Succeeded)" : ""}.`)
      : `Ana's Alerts ${r.off ? "Off" : "On"}. The team decided Ana's dispute about her recording after her page loaded; her ${r.press === "charge" ? "Charge" : "Let it go"} on her written answers stopped once naming “The team decided your dispute about your recording…”; the second press went through${r.press === "charge" ? " (Stripe: $10.00 Succeeded)" : ""}.`;
    all = verdict(r.name, r.title, expl, good, `stop box: “${st || "none"}”; review: ${done || "none"}`) && all;
  }
  return all;
}

async function I(W) {
  const name = "i-pay-owed-chargebacks";
  // A fresh developer (a chargeback hold pauses all their tests): Ben paid with 4242, then the card changed to 0259 (Stripe opens a real dispute on what it pays).
  const dev = await L.account("pm-devcb", "Lena Park", "developer");
  await L.addCard(dev, CARD_OK);
  const t = await mkTest(dev, "Harbor Run I");
  const a = await joinWritten(W.ana, t);
  const b = await joinWritten(W.ben, t);
  await payApi(dev, "submission", b.sub, 1000);
  const benPi = sql(`select "stripePaymentIntentId" from "Payment" where "submissionId" = ${lit(b.sub)} and status = 'charged'`);
  await L.addCard(dev, CARD_DISPUTE);
  await payApi(dev, "submission", a.sub, 1000);
  const anaPi = sql(`select "stripePaymentIntentId" from "Payment" where "submissionId" = ${lit(a.sub)} and status = 'charged'`);
  log("waiting for Stripe's real dispute on Ana's payment (webhook through stripe listen)…");
  await L.waitSql(`select coalesce(chargeback, '') from "Payment" where "stripePaymentIntentId" = ${lit(anaPi)}`, (v) => v === "open", 120000);
  await L.verifyCard(dev);
  const pr = await L.pair(dev, dev, "I · Pay what you owe after a new chargeback and a changed disputed amount", [W.ana, W.ben]);
  await openPage(pr.app, "/app/payments", "#owed");
  await capWait(pr.app, "Lena's Payments: Stripe's real dispute on Ana's $10 payment is owed ($10 + $15 fee = $25.00). Card verified.", 3000);
  await capWait(pr.app, "Meanwhile the bank reverses Ben's $10 payment too (a new chargeback).", 600);
  L.appfn("chargeback", benPi);
  await pr.app.waitForTimeout(1000);
  const btn = pr.app.locator("#owed button", { hasText: /Pay what you owe|Reserve|Pay/ }).first();
  await btn.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
  await capWait(pr.app, "Lena presses Pay what you owe (her page still shows $25.00)…", 600);
  await btn.click();
  const st1 = await stopText(pr.app, "#owed").then((x) => x || stopText(pr.app));
  await capWait(pr.app, st1 ? "Stops once with the new total ($50.00), naming Ben's chargeback. Nothing reserved." : "No stop box appeared.", 3500);
  await capWait(pr.app, "Before the second press, the bank lowers the disputed amount of Ana's payment to $6.", 600);
  const ch = L.appfn("disputeamount", `${anaPi}:600`);
  log("dispute amount:", JSON.stringify(ch));
  await pr.app.waitForTimeout(800);
  await btn.click();
  await pr.app.waitForTimeout(2500);
  const st2 = await stopText(pr.app, "#owed").then((x) => x || stopText(pr.app));
  await capWait(pr.app, /changed: now \$46/.test(st2) ? "Stops once more: “What you owe changed: now $46.00”. Nothing reserved." : `Second press: ${st2 || "no stop"}`, 3500);
  await btn.click();
  const res = await L.waitSql(`select coalesce(string_agg(status || ' $' || ("amountCents"/100.0)::numeric(10,2), ','), '') from "Payment" where "developerId" = ${lit(dev.uid)} and kind = 'owed'`, (v) => /\$46\.00/.test(v), 60000);
  await capWait(pr.app, "Third press: $46.00 is reserved on the card (Stripe: $46.00 Uncaptured — taken when the team approves lifting the hold).", 4500);
  await L.pairVideo(pr, name, "", "I");
  const s = L.stripeOut(dev, name, "I");
  const good = /Added to what you owe meanwhile/.test(st1) && /\$50\.00/.test(st1) && /What you owe changed: now \$46\.00/.test(st2) && s.paymentIntents.some((p) => p.amount === "46.00" && p.status === "requires_capture");
  return verdict(name, "I · Pay what you owe after a new chargeback and a changed disputed amount",
    "Lena owed $25.00 for Stripe's real (test) dispute on Ana's $10 payment (card 0259) and had verified her card. A new chargeback on Ben's $10 payment came in (the app's chargeback function — what Stripe's dispute webhook calls — since Stripe can't dispute a 4242 payment): her press stopped once with “Added to what you owe meanwhile … New total $50.00”. The bank then lowered Ana's disputed amount to $6 (the function charge.dispute.updated calls): the next press stopped once with “What you owe changed: now $46.00”. The third press reserved $46.00 (Stripe: Uncaptured).",
    good, `first: “${st1 || "none"}”; second: “${st2 || "none"}”; owed rows: ${res}`);
}

async function J(W) {
  const name = "j-pay-call-same-tester-decision";
  const X = await decisionWorld(W, "Harbor Run J");
  const call = await pastCall(W.d1, W.ana, X.t, X.a.s);
  ignore(X.t, ["disputes", "admin"]);
  const pr = await L.pair(W.d1, W.d1, "J · Pay on a CALL part after the team's decision on that tester", [W.ana]);
  await openPage(pr.app, `/app/tests/${X.t}`);
  await capWait(pr.app, "Ana's 30-minute live call is over and measured. Alerts: “Decisions by the team” ticked off.", 2500);
  const amt = pr.app.locator(`#amt-${call}`).last();
  await amt.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = amt.locator("xpath=ancestor::div[contains(@class,'space-y-3')][1]");
  if (!(await amt.inputValue())) await amt.fill("15.00");
  const cents = Math.round(Number(await amt.inputValue()) * 100);
  const tick = box.locator(`#tick-${call}`);
  if (await tick.count()) await tick.check();
  await capWait(pr.app, "Meanwhile the team decides Ana's dispute about her written answers ($10 in all).", 600);
  await decide(W.admin, X.dispute, "10.00", 600);
  await pr.app.waitForTimeout(1500);
  await capWait(pr.app, "Nora presses Pay on Ana's live call…", 600);
  await payButton(box).click();
  const st = await stopText(pr.app);
  await capWait(pr.app, st ? "Stops once, naming the decision about Ana (a call part follows the same rule). Nothing charged." : "No stop box appeared.", 3500);
  await pressAgain(pr.app, call, cents);
  await capWait(pr.app, `Second press: paid. Stripe: $${(cents / 100).toFixed(2)} Succeeded.`, 600);
  const paid = await waitPaid(`"callId" = ${lit(call)}`);
  await pr.app.waitForTimeout(3000);
  await L.pairVideo(pr, name, "", "J");
  const s = L.stripeOut(W.d1, name, "J");
  const good = /The team decided Ana Silva's dispute/.test(st) && Number(paid) > 0 && s.paymentIntents.some((p) => p.amount === (cents / 100).toFixed(2) && p.status === "succeeded");
  return verdict(name, "J · Pay on a call part after the team's decision on the same tester (Decisions ticked off)",
    `Ana's live call was over and measured; “Decisions by the team” ticked off. The team decided Ana's dispute about her written answers; Nora's Pay on Ana's call stopped once naming the decision, and the second press paid $${(cents / 100).toFixed(2)} (Stripe: Succeeded).`,
    good, `stop box: “${st || "none"}”; paid rows: ${paid}`);
}

(async () => {
  const want = process.argv.slice(2);
  await L.start();
  const W = await world();
  const rows = { A, B, C, D, E, F, G, H, I, J };
  for (const k of want) {
    console.log(`== ${k}`);
    try { await rows[k](W); } catch (e) { console.log(`   ! ${k} failed:`, String(e.stack || e).slice(0, 1500)); }
  }
  L.writeMade();
  await L.stop();
})();
