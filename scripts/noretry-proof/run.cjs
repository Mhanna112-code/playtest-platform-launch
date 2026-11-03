// The noretry recordings (§148/§149 evidence), copied from scripts/payments-proof: the 3490 server (pl-noretry worktree, "noretry" schema, Stripe TEST mode), the Stripe viewer on 3491.
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

// ---------------------------------------------------------------- noretry proof (§148, §149) ----------------------------------------------------------------
const CARD_DECLINE = "4000 0000 0000 0341"; // saves fine, every charge is declined
const CARD_DISPUTE = "4000 0000 0000 0259"; // charges go through, then Stripe opens a (fraudulent, full) dispute
const stripeCount = (d) => appfn("stripe", d.uid);
const dash = async (page) => { await page.goto(`/app`); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1500); };
const bell = async (page) => { await page.goto(`/app/notifications`); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1500); };
const bellLines = (d, like) => sql(`select text from "Notification" where "userId" = '${d.uid}' and text like ${L.lit(like)} order by "createdAt"`);
const tags = async (SC, W, n) => { const out = []; for (let i = 0; i < n; i++) { const t = await testerTag(W.ts[i], W.w.s[i]); out.push(`${NAMES[i]}: ${t}`); } note(SC, `testers' tags: ${out.join("; ")}`); return out; };
const piLine = (r) => r.paymentIntents.map((p) => `$${p.amount} ${p.status}${p.card ? " card " + p.card : ""}${p.last_payment_error ? " (" + p.last_payment_error + ")" : ""}${p.stripe_dispute !== "none" ? " dispute=" + p.stripe_dispute : ""}`).join("; ");
/** Two tester Charges made while the developer (card 3184) was away: two "Confirm with your bank" items on the old card. */
async function twoWaiting(prefix, devName) {
  const W = await world(prefix, devName, 2);
  const p0 = await tCharge(W, 0), p1 = await tCharge(W, 1);
  await L.waitAction(W.w.sub[0]); await L.waitAction(W.w.sub[1]);
  return { W, p: [p0, p1] };
}

// (a) A payment hold with debts: saving a card charges nothing; Pay what you owe then pays on it.
async function A() {
  const SC = "A";
  const W = await world("a", "Ada Park", 2);
  const p0 = await tCharge(W, 0), p1 = await tCharge(W, 1);
  await L.waitAction(W.w.sub[0]); await L.waitAction(W.w.sub[1]);
  runOut(p0); runOut(p1);
  const pr = await L.pair(W.d, W.d, "A · Ada Park: card saved during a hold");
  await payments(pr.app);
  await L.pairShot(pr, "A1-before", "Before: a payment hold owing $20.00 (two Charges the bank never confirmed), card Visa 3184.", SC, "#owed");
  const before = L.stripeOut(W.d, "A1-before", SC, "before the card is saved");
  await L.addCard(pr.app, CARD_OK);
  await pr.app.waitForTimeout(2500);
  const savedLine = await pr.app.locator("main").getByText("Card saved.").count();
  await L.pairShot(pr, "A2-card-saved", "After saving Visa 4242: Payments reads just “Card saved.”; the owed box still owes $20.00 and the hold stays; nothing was charged.", SC, "main");
  const after = L.stripeOut(W.d, "A2-card-saved", SC, "no new PaymentIntent after saving the card");
  note(SC, `"Card saved." shown: ${savedLine > 0}; PaymentIntents before/after saving: ${before.count} -> ${after.count}; hold=${L.holdOf(W.d.uid)}; rows: ${rows(W.d)}; "We charged your card" lines: ${bellLines(W.d, "We charged your card%") || "none"}`);
  await payments(pr.app);
  await L.pairShot(pr, "A3-owed-box", "The owed box's rule line: “What you owe is charged when you press Pay what you owe.”", SC, "#owed");
  await pressOwed(pr.app, { complete: null });
  note(SC, `Pay what you owe: ${await waitOne(W.d, ["bundled"])}`);
  await sleep(2500);
  await payments(pr.app);
  await L.pairShot(pr, "A4-paid-on-new-card", "Pay what you owe pressed: ONE payment of $20.00 on the new Visa 4242; the hold lifted.", SC, "main");
  const fin = L.stripeOut(W.d, "A4-paid-on-new-card", SC, "one new succeeded PaymentIntent, on 4242");
  note(SC, `after the press: hold=${L.holdOf(W.d.uid)}; Stripe: ${piLine(fin)}`);
  await L.pairVideo(pr, "A-card-saved-during-hold", "A · A card saved during a payment hold charges nothing; Pay what you owe then pays on it.", SC);
}

// (b) No hold, two Charges waiting on the old card; a new card that pays: old checks canceled at Stripe, one payment on the new card.
async function B() {
  const SC = "B";
  const { W } = await twoWaiting("b", "Bo Lund");
  const pr = await L.pair(W.d, W.d, "B · Bo Lund: two waiting Charges, new card pays");
  await testPage(pr.app, W.w.t);
  await L.pairShot(pr, "B1-two-confirms", "Two testers' Charges made while Bo was away wait for “Confirm with your bank” on the old card (3184): two PaymentIntents waiting at Stripe.", SC, "[data-bank-waiting]");
  L.stripeOut(W.d, "B1-two-confirms", SC, "two waiting PaymentIntents on the old card");
  await L.addCard(pr.app, CARD_OK);
  note(SC, `combined: ${await waitOne(W.d, ["bundled", "needs_confirmation", "cancelled"])}`);
  await sleep(2500);
  await L.pairShot(pr, "B2-card-saved", "Visa 4242 saved: “Card saved.”; both old checks canceled at Stripe and the two Charges made again as ONE $20.00 payment on the new card, which went through.", SC, "main");
  await testPage(pr.app, W.w.t);
  await L.pairShot(pr, "B3-test-page", "The test page: no “Confirm with your bank” left; both parts paid.", SC, "main");
  const s = L.stripeOut(W.d, "B3-test-page", SC, "two canceled (old card), one succeeded $20.00 (new card)");
  await tags(SC, W, 2);
  note(SC, `Stripe: ${piLine(s)}; rows: ${rows(W.d)}`);
  await L.pairVideo(pr, "B-new-card-pays", "B · Two waiting Charges; a new card that pays: old checks canceled, one payment on the new card.", SC);
}

// (b2) The new card's bank ASKS for the combined payment: one new Confirm for the total; approved -> each paid once. And (b2x) left 3 days.
async function B2() {
  const SC = "B2";
  const { W } = await twoWaiting("b2", "Bree Moss");
  const pr = await L.pair(W.d, W.d, "B2 · Bree Moss: new card asks the bank");
  await dash(pr.app);
  await L.pairShot(pr, "B2-1-dashboard-before", "Before: the dashboard's “Your bank wants you to confirm” lists the two Charges on the old card (3184).", SC, "#bank-to-confirm");
  await payments(pr.app);
  await L.pairShot(pr, "B2-2-payments-before", "Before: Payments' confirm list, the same two items.", SC, "[data-confirm-list]");
  L.stripeOut(W.d, "B2-2-payments-before", SC, "two waiting PaymentIntents on the old card");
  const t0 = new Date().toISOString();
  await L.addCard(pr.app, CARD_ASK, { tds: true });
  await waitOne(W.d, ["needs_confirmation"]);
  const comb = one(W.d);
  note(SC, `combined: $${comb.cents / 100} ${comb.status} (${comb.note}); old rows: ${rows(W.d)}`);
  await dash(pr.app);
  await L.pairShot(pr, "B2-3-dashboard-after", "After saving a new 3184 card: the two old items are gone; ONE new item for the $20.00 total, with its new 3-day deadline.", SC, "#bank-to-confirm");
  await payments(pr.app);
  await L.pairShot(pr, "B2-4-payments-after", "Payments: “Card saved.”, and the confirm list has the one new item for $20.00 listing both Charges.", SC, "[data-confirm-list]");
  const s1 = L.stripeOut(W.d, "B2-4-payments-after", SC, "two old PaymentIntents canceled; the new $20.00 one waiting for the bank");
  note(SC, `Stripe after the save: ${piLine(s1)}`);
  await bell(pr.app);
  await L.pairShot(pr, "B2-5-bell", "The bell: the new “Your bank wants you to confirm a $20.00 payment by …” line with its new deadline.", SC, "main");
  note(SC, `bell lines since the save: ${sql(`select text from "Notification" where "userId" = '${W.d.uid}' and "createdAt" >= '${t0}' order by "createdAt"`).replace(/\n/g, " | ")}`);
  await payments(pr.app);
  await confirmItem(pr.app, comb.id);
  note(SC, `approved: ${await waitOne(W.d, ["bundled"])}`);
  await sleep(2500);
  await payments(pr.app);
  await L.pairShot(pr, "B2-6-approved", "Approved on the bank's page: the one payment went through; each Charge paid once.", SC, "main");
  const s2 = L.stripeOut(W.d, "B2-6-approved", SC, "the new $20.00 PaymentIntent succeeded; old ones canceled");
  await tags(SC, W, 2);
  note(SC, `Stripe: ${piLine(s2)}; rows: ${rows(W.d)}; receipts: ${bellLines(W.d, "Receipt:%").replace(/\n/g, " | ")}`);
  await L.pairVideo(pr, "B2-new-card-asks", "B2 · The new card's bank asks: the two old confirms become ONE new confirm for the total; approved, each paid once.", SC);
}
async function B2X() {
  const SC = "B2X";
  const { W } = await twoWaiting("b2x", "Bram Ito");
  const pr = await L.pair(W.d, W.d, "B2X · Bram Ito: the new confirm left 3 days");
  await L.addCard(pr.app, CARD_ASK, { tds: true });
  await waitOne(W.d, ["needs_confirmation"]);
  const comb = one(W.d);
  await payments(pr.app);
  await L.pairShot(pr, "B2X-1-waiting", "The new card asked the bank: one $20.00 “Confirm with your bank” for both Charges.", SC, "[data-confirm-list]");
  runOut(comb.id);
  await sleep(2000);
  await payments(pr.app);
  await L.pairShot(pr, "B2X-2-ran-out", "Left 3 days: canceled at Stripe, nothing charged; each Charge counts as declined: two debts and a payment hold.", SC, "main");
  const s = L.stripeOut(W.d, "B2X-2-ran-out", SC, "the $20.00 check canceled at Stripe");
  const tg = await tags(SC, W, 2);
  await L.shot(W.ts[0], "B2X-3-tester", `${NAMES[0]}'s part reads “${tg[0].split(": ")[1]}” (no hold words).`, SC, "[data-part-status]");
  note(SC, `hold=${L.holdOf(W.d.uid)}; Stripe: ${piLine(s)}; rows: ${rows(W.d)}`);
  await L.pairVideo(pr, "B2X-left-3-days", "B2X · The new card's confirm left 3 days: each Charge becomes a debt and a payment hold.", SC);
}

// (b3) The new card DECLINES the combined payment.
async function B3() {
  const SC = "B3";
  const { W } = await twoWaiting("b3", "Cy Park");
  const pr = await L.pair(W.d, W.d, "B3 · Cy Park: new card declines");
  await L.addCard(pr.app, CARD_DECLINE);
  await L.waitSql(`select coalesce("holdStartedAt"::text, '') from "User" where id = '${W.d.uid}'`, (v) => v !== "", 60000);
  await sleep(2500);
  await payments(pr.app);
  await L.pairShot(pr, "B3-1-declined", "A new card that declines (0341): both old checks canceled; the one $20.00 payment declined; each Charge is now a debt, and a payment hold.", SC, "main");
  const s = L.stripeOut(W.d, "B3-1-declined", SC, "two old canceled, the $20.00 one declined");
  const tg = await tags(SC, W, 2);
  await L.shot(W.ts[0], "B3-2-tester", `${NAMES[0]}'s part reads “${tg[0].split(": ")[1]}” (no hold words).`, SC, "[data-part-status]");
  note(SC, `hold=${L.holdOf(W.d.uid)}; Stripe: ${piLine(s)}; rows: ${rows(W.d)}; developer's lines: ${sql(`select text from "Notification" where "userId" = '${W.d.uid}' order by "createdAt" desc limit 3`).replace(/\n/g, " | ")}`);
  await L.pairVideo(pr, "B3-new-card-declines", "B3 · A new card that declines the combined payment: each Charge becomes a debt; testers see a delay.", SC);
}

// (b4) A chargeback on the combined payment: full (card 0259, Stripe opens a real dispute), and partial (§133, the webhook's amount).
async function B4() {
  const SC = "B4";
  const { W } = await twoWaiting("b4", "Di Ross");
  const pr = await L.pair(W.d, W.d, "B4 · Di Ross: chargeback on the combined payment");
  await L.addCard(pr.app, CARD_DISPUTE);
  await waitOne(W.d, ["bundled"]);
  const comb = one(W.d);
  note(SC, `combined $${comb.cents / 100} paid (${comb.pi}); rows: ${rows(W.d)}`);
  let st = "";
  for (let i = 0; i < 20 && !/dispute=/.test(st); i++) { await sleep(3000); st = piLine(stripeCount(W.d)); }
  note(SC, `Stripe opened its dispute: ${st}`);
  note(SC, `chargeback (what the webhook calls): ${JSON.stringify(appfn("chargeback", comb.pi))}; again: ${JSON.stringify(appfn("chargeback", comb.pi))}`);
  await sleep(1500);
  await payments(pr.app);
  await L.pairShot(pr, "B4-1-full", "The combined $20.00 payment disputed at Stripe: ONE chargeback for the whole $20.00 and ONE $15 fee; the reversed lines name each Charge it covered.", SC, "#owed");
  const s = L.stripeOut(W.d, "B4-1-full", SC, "the $20.00 PaymentIntent disputed");
  await tags(SC, W, 2);
  note(SC, `hold=${L.holdOf(W.d.uid)}; owed lines: ${sql(`select coalesce(string_agg(text, ' | '), '') from "Notification" where "userId" = '${W.d.uid}' and text like 'Your bank reversed%'`)}; rows: ${rows(W.d)}; Stripe: ${piLine(s)}`);
  await L.pairVideo(pr, "B4-chargeback-full", "B4 · A chargeback on the combined payment: one chargeback for the whole amount, one fee; testers stay paid.", SC);
}
async function B4P() {
  const SC = "B4P";
  const { W } = await twoWaiting("b4p", "Dev Rao");
  const pr = await L.pair(W.d, W.d, "B4P · Dev Rao: partial chargeback");
  await L.addCard(pr.app, CARD_OK);
  await waitOne(W.d, ["bundled"]);
  const comb = one(W.d);
  note(SC, `partial chargeback $15.00 of $20.00 (the webhook's dispute amount; Stripe test mode can't open a partial dispute): ${JSON.stringify(appfn("chargeback", `${comb.pi}:1500`))}`);
  await sleep(1500);
  await payments(pr.app);
  await L.pairShot(pr, "B4P-1-partial", "A partial chargeback ($15.00 of the $20.00 combined payment): one chargeback for $15.00 and one $15 fee, naming what the payment covered.", SC, "#owed");
  L.stripeOut(W.d, "B4P-1-partial", SC, "the $20.00 PaymentIntent succeeded (the dispute is simulated through the webhook's function)");
  await tags(SC, W, 2);
  note(SC, `hold=${L.holdOf(W.d.uid)}; rows: ${rows(W.d)}`);
  await L.pairVideo(pr, "B4P-chargeback-partial", "B4P · A partial chargeback on the combined payment.", SC);
}

// (c) Pay what you owe's own bank check open; a new card cancels it; nothing charged until the press.
async function C() {
  const SC = "C";
  const W = await world("c", "Cass Bell", 1);
  await holdVia(W, 0);
  const pr = await L.pair(W.d, W.d, "C · Cass Bell: Pay what you owe's check open");
  await pressOwed(pr.app, { complete: null });
  await waitOne(W.d, ["needs_action"]);
  const old = one(W.d);
  await pr.app.waitForTimeout(3000);
  await L.pairShot(pr, "C1-check-open", "Pay what you owe pressed on the old card (3184): the bank's page is open under the button.", SC, "#owed");
  L.stripeOut(W.d, "C1-check-open", SC, "Pay what you owe's PaymentIntent waiting for the bank");
  const tab2 = await L.newPage({ from: W.d });
  await L.addCard(tab2, CARD_OK);
  await L.shot(tab2, "C2-card-saved", "In another tab Visa 4242 is saved: “Card saved.”; nothing charged.", SC, "main");
  await sleep(2000);
  note(SC, `old check now: ${sql(`select status || ' ' || coalesce("actionPi", '-') from "Payment" where id = '${old.id}'`)}`);
  const s = L.stripeOut(W.d, "C2-card-saved", SC, "the old check canceled at Stripe; no new PaymentIntent");
  note(SC, `Stripe: ${piLine(s)}`);
  // The first tab finishes the old bank page.
  await pr.app.bringToFront();
  await L.threeDS(pr.app, true, 15000);
  await pr.app.waitForTimeout(3500);
  await L.pairShot(pr, "C3-old-page", "The first tab finishing the old bank page: nothing is charged (the check was canceled).", SC, "#owed");
  const r = await post(pr.app, "/api/payments/confirm", { paymentId: old.id });
  note(SC, `old tab's finish: ${r.status} ${JSON.stringify(r.body)}`);
  await payments(pr.app);
  await L.pairShot(pr, "C4-payable", "Payments: the debt is payable again (no “Waiting for your bank”), the hold stays.", SC, "#owed");
  await pressOwed(pr.app, { complete: null });
  note(SC, `press: ${await waitOne(W.d, ["bundled"])}`);
  await sleep(2500);
  await payments(pr.app);
  await L.pairShot(pr, "C5-paid", "Pay what you owe pressed: paid on the new card; the hold lifted.", SC, "main");
  const f = L.stripeOut(W.d, "C5-paid", SC, "old canceled; one succeeded on 4242");
  note(SC, `hold=${L.holdOf(W.d.uid)}; Stripe: ${piLine(f)}`);
  await tab2.context().close();
  await L.pairVideo(pr, "C-owed-check-open", "C · Pay what you owe's own check open: a new card cancels it, nothing charged until the press.", SC);
}

// (d) The developer's own Pay check open on the old card; card saved; Pay again pays on the new card.
async function D() {
  const SC = "D";
  const d = await dev("d-dev", "Dot Weir", CARD_ASK);
  const ts = await testers("d", NAMES.slice(0, 1));
  const w = await L.writtenTest(d, ts);
  const sub = w.sub[0];
  const pr = await L.pair(d, d, "D · Dot Weir: own Pay check open");
  const payBody = () => ({ kind: "submission", id: sub, amount: "10.00", tickedCents: 1000, seenAt: L.nowIso(), confirmed: true, payKey: require("crypto").randomUUID() });
  const first = await post(pr.app, "/api/review", payBody());
  note(SC, `Pay on the old card: ${first.status} requiresAction=${!!first.body.requiresAction}`);
  const check = sql(`select id || '|' || coalesce("actionPi", '') from "Payment" where "submissionId" = '${sub}' and status = 'needs_action'`).split("|");
  await testPage(pr.app, w.t);
  await L.pairShot(pr, "D1-pay-check-open", "Dot pressed Pay $10.00 on the old card (3184): the bank's check is open (the piece is locked meanwhile).", SC, "main");
  L.stripeOut(d, "D1-pay-check-open", SC, "Pay's PaymentIntent waiting for the bank");
  const tab2 = await L.newPage({ from: d });
  await L.addCard(tab2, CARD_OK);
  await L.shot(tab2, "D2-card-saved", "Visa 4242 saved in another tab: “Card saved.”", SC, "main");
  await sleep(2000);
  note(SC, `old Pay check now: ${sql(`select status || ' ' || coalesce("actionPi", '-') from "Payment" where id = '${check[0]}'`)}; review rows: ${sql(`select count(*) from "Review" where "submissionId" = '${sub}'`)}`);
  const s = L.stripeOut(d, "D2-card-saved", SC, "Pay's check canceled at Stripe; nothing charged");
  note(SC, `Stripe: ${piLine(s)}`);
  const late = await post(pr.app, "/api/payments/confirm", { paymentId: check[0] });
  note(SC, `old tab finishing the bank page: ${late.status} ${JSON.stringify(late.body)}`);
  fs.writeFileSync(path.join(L.OUT, "D3-old-tab-response.json"), JSON.stringify({ status: late.status, body: late.body }, null, 2));
  await testPage(pr.app, w.t);
  await L.pairShot(pr, "D3-payable-again", "The piece is free again: Pay shows as before; nothing was charged.", SC, "main");
  const again = await post(pr.app, "/api/review", payBody());
  note(SC, `Pay again: ${again.status} ${JSON.stringify(again.body).slice(0, 160)}`);
  await sleep(2000);
  await testPage(pr.app, w.t);
  await L.pairShot(pr, "D4-paid", "Pay pressed again: $10.00 paid on the new Visa 4242.", SC, "main");
  const f = L.stripeOut(d, "D4-paid", SC, "old canceled; one succeeded on 4242");
  note(SC, `Stripe: ${piLine(f)}; rows: ${L.payRows(d.uid).replace(/\n/g, "; ")}`);
  await tab2.context().close();
  await L.pairVideo(pr, "D-own-pay-check", "D · The developer's own Pay check open: a new card cancels it; Pay again pays on the new card.", SC);
}

// (E) Decide: less / equal / more than what's paid after a Pay more since the admin's page loaded.
async function decideCase(SC, prefix, devName, moreCents) {
  const d = await dev(`${prefix}-dev`, devName, CARD_OK);
  const ts = await testers(prefix, NAMES.slice(0, 1));
  const w = await L.writtenTest(d, ts);
  const sub = w.sub[0], s = w.s[0];
  ok(await post(d, "/api/review", { kind: "submission", id: sub, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful", seenAt: L.nowIso(), confirmed: true, payKey: require("crypto").randomUUID() }), "pay $4");
  ok(await post(ts[0], `/api/sessions/${s}/dispute`, { kind: "submission", id: sub, reason: "I answered every question fully", seenAt: L.nowIso(), confirmed: true }), "dispute");
  const dispute = sql(`select id from "Dispute" where "submissionId" = '${sub}'`);
  const A = await admin();
  const app = await L.newPage({ from: A, video: true });
  await app.goto(`/admin?at=${Date.now()}#disputes`);
  await app.waitForLoadState("networkidle").catch(() => {});
  await app.waitForTimeout(2500);
  await app.addStyleTag({ content: "[data-scroll-box]{max-height:none!important;overflow:visible!important}" }).catch(() => {});
  const row = app.locator(`[data-dispute-row="${dispute}"]`).first();
  for (let i = 0; i < 20 && !(await row.count()); i++) { await app.locator('[data-scroll-box="disputes"]').first().evaluate((b) => { b.scrollTop = b.scrollHeight; }).catch(() => {}); await app.waitForTimeout(600); }
  await L.shot(app, `${SC}-1-admin-loaded`, "The admin's page loads: Ana's written answers paid $4.00 (range from $4.00).", SC, row);
  // The admin types $10.00 on the page that still shows $4.00 paid (the tick for $6.00 more) ...
  await row.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await app.locator(`#total-${dispute}`).fill("10.00");
  await app.waitForTimeout(500);
  const tick = row.locator("[data-decide-tick] input");
  if (await tick.count()) await tick.check();
  await app.waitForTimeout(400);
  await L.shot(app, `${SC}-1b-admin-typed`, "The admin types a total of $10.00 on the page showing $4.00 paid, ticking the $6.00 raise it names.", SC, row);
  const before = appfn("stripe", d.uid).count;
  // ... the developer's Pay more lands meanwhile (before the console's next redraw) ...
  const m = await post(d, `/api/tests/${w.t}/pay-extra`, { seenAt: L.nowIso(), contractId: s, submissionId: sub, amount: (moreCents / 100).toFixed(2), tickedCents: moreCents, payKey: require("crypto").randomUUID() });
  note(SC, `developer's Pay more $${(moreCents / 100).toFixed(2)}: ${m.status}; paid now $${((400 + moreCents) / 100).toFixed(2)}`);
  // ... and the admin presses Decide.
  await row.locator("button", { hasText: /^Decide$/ }).click();
  await app.waitForTimeout(3500);
  const msg = await row.locator("[data-decide-msg], [data-decide-done]").first().innerText().catch(() => "");
  const range = await row.locator("[data-dispute-range]").innerText().catch(() => "");
  await L.shot(app, `${SC}-3-admin-after`, "The admin's row right after Decide $10.00.", SC, row.locator("button", { hasText: /^Decide$/ }).first());
  const after = appfn("stripe", d.uid);
  const dsp = sql(`select status || ' ' || coalesce("decidedCents"::text, '-') from "Dispute" where id = '${dispute}'`);
  note(SC, `Decide $10.00: message “${msg}”; range now “${range}”; dispute ${dsp}; Stripe PaymentIntents ${before} -> ${after.count} (${piLine(after)}); test line: ${sql(`select coalesce(string_agg(text, ' | '), '') from "TestEvent" where "testId" = '${w.t}' and kind = 'admin'`)}`);
  await testPage(d, w.t);
  await L.shot(d, `${SC}-4-dev-test-page-after`, "The developer's test page after the admin's Decide.", SC, "main");
  if (moreCents > 600) {
    await app.bringToFront();
    await app.locator(`#total-${dispute}`).fill(((400 + moreCents) / 100).toFixed(2));
    await app.waitForTimeout(500);
    await row.locator("button", { hasText: /^Decide$/ }).click();
    await app.waitForTimeout(3500);
    await L.shot(app, `${SC}-5-admin-decides-paid`, `The admin then decides $${((400 + moreCents) / 100).toFixed(2)} (what's paid): it goes through, nothing charged.`, SC, row.locator("button", { hasText: /^Decide$/ }).first());
    note(SC, `then Decide $${((400 + moreCents) / 100).toFixed(2)}: dispute ${sql(`select status || ' ' || coalesce("decidedCents"::text, '-') from "Dispute" where id = '${dispute}'`)}; Stripe PaymentIntents now ${appfn("stripe", d.uid).count}; test line: ${sql(`select coalesce(string_agg(text, ' | '), '') from "TestEvent" where "testId" = '${w.t}' and kind = 'admin'`)}`);
  }
  const v = app.video(); await app.context().close(); const dst = path.join(L.OUT, `${SC}-decide.webm`); await v.saveAs(dst);
  L.record(`${SC}-decide.webm`, "The admin's Decide.", SC);
  return { d, w, dispute, row, msg };
}
const E1 = () => decideCase("E1", "e1", "Eve Hunt", 300);
const E2 = () => decideCase("E2", "e2", "Fin Gale", 600);
const E3 = () => decideCase("E3", "e3", "Gil Shaw", 800);

const SCEN = { A, B, B2, B2X, B3, B4, B4P, C, D, E1, E2, E3 };
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
