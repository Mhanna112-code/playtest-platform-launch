// The Confirm all (§147) recordings: the 3460 server (this worktree, rec_confirmall schema, Stripe TEST mode), the app recorded beside the Stripe viewer (3461),
// the developer's PaymentIntents saved next to each clip (<name>.stripe.json). Throwaway accounts only (rec+…@playtest.test).
//   MEDIA_OUT=<folder> node scripts/confirm-all/run.cjs A B S
// A: three charges (two testers, two tests) waiting for the bank on card 3184 → Confirm all → one bank check → approved.
// B: the same on card 3178 (asks the bank, then declines for insufficient funds) → Confirm all → approved at the bank, then declined → each back to its own Confirm.
// S: the box and Payments with the button, desktop 1280 and phone 390.
/* eslint-disable */
const fs = require("fs");
const path = require("path");
const L = require("./lib.cjs");
const { sql, post, ok, sleep } = L;
const CARD_ASK = "4000 0027 6000 3184"; // always asks the bank (3D Secure), on-session and off-session
const CARD_ASK_DECLINE = "4000 0082 6000 3178"; // always asks the bank, then declines (insufficient funds) once approved
const log = (...a) => console.log("  ", ...a);
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 900 } };

async function world(prefix, card) {
  const d = await L.account(`${prefix}-dev`, "Nora Lane", "developer");
  await L.addCard(d, card, { tds: true });
  const ana = await L.account(`${prefix}-ana`, "Ana Silva", "tester");
  const ben = await L.account(`${prefix}-ben`, "Ben Okafor", "tester");
  // Payout accounts (Stripe Connect, test mode) so each tester's share is really transferred.
  await L.connect(ana);
  await L.connect(ben);
  const harbor = await L.postTest(d, {});
  const sky = await L.postTest(d, { productName: "Sky Lab", title: "Sky Lab", writtenCents: "12.00" });
  const parts = [];
  for (const [t, testId, cents] of [[ana, harbor, 1000], [ben, harbor, 1000], [ana, sky, 1200]]) {
    const s = await L.join(t, testId);
    await L.sendWritten(t, s);
    parts.push({ t, s, testId, cents, sub: L.subOf(s) });
  }
  for (const p of parts) L.openCharge(p.s, p.testId);
  // Each tester's Charge is made while the developer is away: the bank asks (card 31xx off-session), so each waits as its own "Confirm with your bank".
  for (const p of parts) {
    const r = await L.chargeApi(p.t, p.s, p.sub, p.cents);
    log(`Charge ${p.t.name}: ${r.status}`);
    await L.waitAction(p.sub);
  }
  log("waiting:", L.payRows(d.uid).replace(/\n/g, "; "));
  return { d, ana, ben, harbor, sky, parts };
}

const dash = async (page) => { await page.goto("/app"); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1500); };
const payments = async (page) => { await page.goto("/app/payments"); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1500); };
async function pressAll(page, root) {
  const btn = page.locator(`${root} [data-confirm-all-button]`).first();
  await btn.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(1200);
  await btn.click();
  await page.waitForTimeout(3000);
  if (await page.locator(`${root} [data-stop-box]`).count()) { await btn.click(); await page.waitForTimeout(3000); }
  await page.locator(`${root} [data-bank-check]`).first().evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
}

async function A() {
  const SC = "A";
  const W = await world(`ca${L.TS}a`, CARD_ASK);
  const pr = await L.pair(W.d, W.d, "Confirm all: three charges, one bank check", [W.ana, W.ben]);
  await dash(pr.app);
  await pr.app.locator("#bank-to-confirm").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await pr.app.waitForTimeout(2500);
  await L.pairShot(pr, "a1-box-before", "Dashboard: three charges waiting for the bank (two testers, two tests); Stripe: three PaymentIntents Incomplete.", SC, "#bank-to-confirm");
  await pressAll(pr.app, "#bank-to-confirm");
  await pr.app.waitForTimeout(3000);
  await L.pairShot(pr, "a2-one-check", "Confirm all pressed: ONE bank check opens under the button; Stripe: the three old ones Canceled, one $32.00 Incomplete.", SC, "#bank-to-confirm [data-bank-check]");
  await L.threeDS(pr.app, true, 60000);
  await L.waitSql(`select status from "Payment" where "developerId" = '${W.d.uid}' and kind = 'owed' order by "createdAt" desc limit 1`, (v) => v === "bundled", 90000);
  await pr.app.waitForTimeout(4000);
  await dash(pr.app);
  await pr.app.waitForTimeout(3000);
  await L.pairShot(pr, "a3-approved", "Approved: the box is empty; Stripe: one $32.00 Succeeded, the three old ones Canceled, two transfers to the testers.", SC, "main");
  await L.pairVideo(pr, "a-confirm-all-approved", "Confirm all with card 3184: one bank check, approved; Stripe beside it.", SC);
  const st = L.stripeOut(W.d, "a-stripe", SC, "after approve");
  const bell = sql(`select text from "Notification" where "userId" = '${W.d.uid}' and text like 'We charged your card%'`);
  const tAna = sql(`select string_agg(text, ' | ') from "Notification" where "userId" = '${W.ana.uid}' and text like 'Nora Lane paid%'`);
  const tBen = sql(`select string_agg(text, ' | ') from "Notification" where "userId" = '${W.ben.uid}' and text like 'Nora Lane paid%'`);
  const P = await L.newPage({ from: W.d });
  await P.goto("/app/notifications").catch(() => {});
  await P.waitForTimeout(1500);
  await L.shot(P, "a4-receipt", "The developer's one receipt line naming every item.", SC, "main");
  await P.context().close();
  return { st, bell, tAna, tBen, rows: L.payRows(W.d.uid), W };
}

/** A tester's own page: the part's status tag (Paid / Payment may be delayed). */
async function tag(t, s) {
  await t.goto(`/app/sessions/${s}`);
  await t.waitForLoadState("networkidle").catch(() => {});
  await t.waitForTimeout(1200);
  return (await t.locator("[data-part-status]").first().innerText().catch(() => "?")).trim();
}
/** Confirm all through its route, the bank's real page approved, then the finish (as the page's inline check does). */
async function confirmAllApi(W) {
  const ids = sql(`select string_agg(id, ',' order by "createdAt") from "Payment" where "developerId" = '${W.d.uid}' and kind = 'review' and status = 'needs_confirmation'`).split(",");
  const total = W.parts.reduce((a, p) => a + p.cents, 0);
  const r = ok(await post(W.d, "/api/payments/confirm-all", { seenTotalCents: total, seenIds: ids }), "confirm all");
  const P = await L.newPage({ from: W.d });
  await P.goto(r.confirm.checkUrl);
  await P.waitForTimeout(2000);
  await L.threeDS(P, true);
  await P.waitForTimeout(2500);
  await P.context().close();
  ok(await post(W.d, "/api/payments/confirm", { paymentId: r.confirm.paymentId }), "finish");
  return r.confirm.paymentId;
}
const oneRow = (d) => sql(`select id || '|' || coalesce("stripePaymentIntentId", '') || '|' || status from "Payment" where "developerId" = '${d.uid}' and kind = 'owed' and note = 'press:all' order by "createdAt" desc limit 1`).split("|");

/** C (full) and P (partial): a bank dispute on the combined payment (the function Stripe's charge.dispute.created webhook calls; a dispute can't be raised on a 3184 payment). */
async function chargeback(SC, W, cents, label) {
  const [, pi] = oneRow(W.d);
  const r = L.appfn("chargeback", cents ? `${pi}:${cents}` : pi);
  log(`chargeback ${label}: ${JSON.stringify(r)}`);
  const pr = await L.pair(W.d, W.d, `Confirm all: a bank dispute on the combined payment (${label})`, [W.ana, W.ben]);
  await payments(pr.app);
  await L.pairShot(pr, `${SC.toLowerCase()}1-owed`, `${label} dispute on the $32.00 Confirm all payment: owed once (+ one $15 fee), the line lists what it covered.`, SC, "#owed");
  await pr.app.context().close(); await pr.pan.context().close();
  const owed = sql(`select string_agg(kind || ':' || status || ' cb=' || chargeback || ' reversed=' || coalesce("reversedCents"::text, 'all') || ' $' || ("amountCents"/100.0)::numeric(10,2), '; ') from "Payment" where "developerId" = '${W.d.uid}' and chargeback <> ''`);
  const tags = [await tag(W.ana, W.parts[0].s), await tag(W.ben, W.parts[1].s), await tag(W.ana, W.parts[2].s)];
  await W.ana.goto(`/app/sessions/${W.parts[0].s}`); await W.ana.waitForTimeout(1200);
  await L.shot(W.ana, `${SC.toLowerCase()}2-tester-paid`, "The tester's page after the dispute: still Paid (no hold or chargeback words).", SC, "[data-part-status]");
  const st = L.stripeOut(W.d, `${SC.toLowerCase()}-stripe`, SC, `after the ${label} dispute`);
  return { owed, tags, hold: L.holdOf(W.d.uid), st };
}

/** D: Confirm all left open past the earliest of its items' dates: none confirmed. */
async function D() {
  const SC = "D";
  const W = await world(`ca${L.TS}d`, CARD_ASK);
  // Ben's charge must be confirmed within 4 minutes (moved for this throwaway account): Confirm all's check then ends then too.
  const ben = sql(`select id from "Payment" where "submissionId" = '${W.parts[1].sub}' order by "createdAt" desc limit 1`);
  sql(`update "Payment" set "actionBy" = (now() at time zone 'utc') + interval '4 minutes' where id = '${ben}'`);
  const pr = await L.pair(W.d, W.d, "Confirm all: left open past the earliest date", [W.ana, W.ben]);
  await dash(pr.app);
  await pr.app.locator("#bank-to-confirm").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await pr.app.waitForTimeout(2000);
  await L.pairShot(pr, "d1-before", "Three charges waiting; Ben Okafor's must be confirmed within 4 minutes (the earliest).", SC, "#bank-to-confirm");
  await pressAll(pr.app, "#bank-to-confirm");
  await pr.app.waitForTimeout(3000);
  const by = sql(`select "actionBy"::text from "Payment" where "developerId" = '${W.d.uid}' and kind = 'owed' order by "createdAt" desc limit 1`);
  await L.pairShot(pr, "d2-open", `Confirm all's one check is open and left unanswered; its deadline is the earliest item's (${by} UTC).`, SC, "#bank-to-confirm [data-bank-check]");
  await L.pairVideo(pr, "d-confirm-all-left-open", "Confirm all pressed and the bank's page left open (then the earliest date passes).", SC);
  const left = Number(sql(`select extract(epoch from ("actionBy" - (now() at time zone 'utc'))) from "Payment" where id = '${ben}'`));
  log(`waiting ${Math.round(left)} s for the earliest date to pass`);
  await sleep(Math.max(0, left * 1000) + 15000);
  L.appfn("expire");
  const pr2 = await L.pair(W.d, W.d, "Confirm all: after the earliest date passed", [W.ana, W.ben]);
  await payments(pr2.app);
  await L.pairShot(pr2, "d3-after-payments", "After the earliest date: none confirmed. The first counts as declined (a payment hold, added to what you owe); the others wait for the lift. Stripe: all four Canceled.", SC, "main");
  await dash(pr2.app);
  await L.pairShot(pr2, "d4-after-dashboard", "The dashboard after: no Confirm all, the payment hold.", SC, "main");
  await pr2.app.context().close(); await pr2.pan.context().close();
  const st = L.stripeOut(W.d, "d-stripe", SC, "after the earliest date passed");
  const states = sql(`select string_agg(status, ', ' order by "createdAt") from "Payment" where "developerId" = '${W.d.uid}' and kind = 'review'`);
  return { st, states, hold: L.holdOf(W.d.uid), tags: [await tag(W.ana, W.parts[0].s), await tag(W.ben, W.parts[1].s)] };
}


async function B() {
  const SC = "B";
  const W = await world(`ca${L.TS}b`, CARD_ASK_DECLINE);
  const pr = await L.pair(W.d, W.d, "Confirm all: the bank declines the total", [W.ana, W.ben]);
  await payments(pr.app);
  await pr.app.locator("#confirm").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await pr.app.waitForTimeout(2500);
  const before = sql(`select string_agg(id || '=' || "actionBy"::text, ',' order by "createdAt") from "Payment" where "developerId" = '${W.d.uid}' and kind = 'review'`);
  await L.pairShot(pr, "b1-payments-before", "Payments: the three charges waiting, each with its own date; Confirm all above them.", SC, "#confirm");
  await pressAll(pr.app, "#confirm");
  await pr.app.waitForTimeout(2500);
  await L.threeDS(pr.app, true, 60000); // approved at the bank's page, then the card declines the total (insufficient funds)
  await L.waitSql(`select status from "Payment" where "developerId" = '${W.d.uid}' and kind = 'owed' order by "createdAt" desc limit 1`, (v) => v === "cancelled", 90000);
  await pr.app.waitForTimeout(3500);
  await L.pairShot(pr, "b2-declined", "Declined at the bank: nothing charged; each charge back to its own Confirm with your bank (a new check each, same dates).", SC, "#confirm");
  await payments(pr.app);
  await pr.app.locator("#confirm").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await pr.app.waitForTimeout(3000);
  await L.pairShot(pr, "b3-back", "After the redraw: the three charges listed again with their original confirm-by dates.", SC, "#confirm");
  await dash(pr.app);
  await pr.app.locator("#bank-to-confirm").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await pr.app.waitForTimeout(2500);
  await L.pairShot(pr, "b4-dashboard-back", "Dashboard: each charge is a new confirm again (original dates); Stripe: the $32.00 declined, a new Incomplete check per charge.", SC, "#bank-to-confirm");
  await pr.app.goto("/app/notifications");
  await pr.app.waitForTimeout(2000);
  await L.pairShot(pr, "b5-bell", "Notifications: the bank line for the three waiting charges, sent again (unread).", SC);
  await L.pairVideo(pr, "b-confirm-all-declined", "Confirm all with card 3178: the bank declines the total; each back to its own Confirm.", SC);
  const st = L.stripeOut(W.d, "b-stripe", SC, "after the decline");
  const after = sql(`select string_agg(id || '=' || "actionBy"::text, ',' order by "createdAt") from "Payment" where "developerId" = '${W.d.uid}' and kind = 'review'`);
  const states = sql(`select string_agg(status || ':' || coalesce(left("actionPi", 12), '-'), ', ' order by "createdAt") from "Payment" where "developerId" = '${W.d.uid}' and kind = 'review'`);
  const bell = sql(`select text || ' | read=' || coalesce("readAt"::text, 'no') from "Notification" where "userId" = '${W.d.uid}' and "reminderKey" like 'bankwait:%' order by "createdAt" desc limit 1`);
  return { st, before, after, sameDates: before === after, states, bell, W };
}

async function S(W) {
  const SC = "S";
  W = W ?? (await world(`ca${L.TS}s`, CARD_ASK));
  for (const [opts, tag] of [[DESK, "desktop"], [PHONE, "phone"]]) {
    const p = await L.newPage({ from: W.d, opts });
    await dash(p);
    await p.locator("#bank-to-confirm").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await p.waitForTimeout(800);
    await L.shot(p, `s-dashboard-${tag}`, `Dashboard box with Confirm all (${tag}).`, SC);
    await payments(p);
    await p.locator("#confirm").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await p.waitForTimeout(800);
    await L.shot(p, `s-payments-${tag}`, `Payments' confirm list with Confirm all (${tag}).`, SC);
    await p.context().close();
  }
}

/** T: the over-$200 tick. Confirm all whose total crosses $200 after the page drew (stops once, the tick appears), and a single item over $200 (its own tick). */
async function T() {
  const SC = "T";
  const d = await L.account(`ca${L.TS}t-dev`, "Nora Lane", "developer");
  await L.addCard(d, CARD_ASK, { tds: true });
  const ana = await L.account(`ca${L.TS}t-ana`, "Ana Silva", "tester");
  const ben = await L.account(`ca${L.TS}t-ben`, "Ben Okafor", "tester");
  await L.connect(ana);
  await L.connect(ben);
  const harbor = await L.postTest(d, { writtenCents: "90.00" });
  const sky = await L.postTest(d, { productName: "Sky Lab", title: "Sky Lab", writtenCents: "30.00" });
  const deep = await L.postTest(d, { productName: "Deep Dive", title: "Deep Dive", writtenCents: "250.00" });
  const parts = [];
  for (const [t, testId, cents] of [[ana, harbor, 9000], [ben, harbor, 9000], [ana, sky, 3000], [ben, deep, 25000]]) {
    const s = await L.join(t, testId);
    await L.sendWritten(t, s);
    L.openCharge(s, testId);
    parts.push({ t, s, testId, cents, sub: L.subOf(s) });
  }
  const charge = async (p) => { const r = await post(p.t, `/api/sessions/${p.s}/choose`, { choice: "charge", seenAt: L.nowIso(), confirmed: true, submissionId: p.sub, tickedCents: p.cents, over200: p.cents > 20000 }); log(`Charge ${p.t.name} $${p.cents / 100}: ${r.status}`); await L.waitAction(p.sub); };
  await charge(parts[0]);
  await charge(parts[1]);
  const pr = await L.pair(d, d, "Confirm all: over $200 needs the tick", [ana, ben]);
  // This tab drew its box before the third charge came in (its live refresh held back, as a slow or background tab).
  await pr.app.route("**/api/pulse**", (r) => r.abort());
  await dash(pr.app);
  await pr.app.locator("#bank-to-confirm").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await pr.app.waitForTimeout(1500);
  await L.pairShot(pr, "t1-180", "The page shows Confirm all (2) · $180.00: under $200, no tick.", SC, "#bank-to-confirm");
  await charge(parts[2]); // $30.00 more: $210.00 in all
  for (const [opts, tag] of [[DESK, "desktop"], [PHONE, "phone"]]) {
    const p = await L.newPage({ from: d, opts });
    await dash(p);
    await p.locator("#bank-to-confirm").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await p.waitForTimeout(800);
    await L.shot(p, `t0-all-tick-${tag}`, `A freshly drawn box: Confirm all (3) · $210.00 with the over-$200 tick, the button off until ticked (${tag}).`, SC);
    await p.context().close();
  }
  await pr.app.waitForTimeout(1500);
  const btn = pr.app.locator("#bank-to-confirm [data-confirm-all-button]").first();
  await btn.click();
  await pr.app.waitForTimeout(3000);
  await L.pairShot(pr, "t2-stop-tick", "Pressed: it stops once naming the new charge; the total is now $210.00, so the line asks for the tick, and the tick appears.", SC, "#bank-to-confirm [data-stop-box]");
  await pr.app.locator("#bank-to-confirm [data-over-tick] input").first().check();
  await pr.app.waitForTimeout(1000);
  await btn.click();
  await pr.app.waitForTimeout(3500);
  await L.threeDS(pr.app, true, 60000);
  await L.waitSql(`select status from "Payment" where "developerId" = '${d.uid}' and kind = 'owed' order by "createdAt" desc limit 1`, (v) => v === "bundled", 90000);
  await pr.app.waitForTimeout(3000);
  await L.pairShot(pr, "t3-paid", "Ticked and pressed again: one bank check for $210.00, approved; Stripe: one $210.00 Succeeded, three old ones Canceled.", SC, "main");
  await L.pairVideo(pr, "t-confirm-all-tick", "Confirm all crossing $200: stops once, tick, then one bank check.", SC);
  const st = L.stripeOut(d, "t-stripe", SC, "after the $210.00 Confirm all");
  // A single charge over $200: its own Confirm with your bank needs the tick too.
  await charge(parts[3]);
  for (const [opts, tag] of [[DESK, "desktop"], [PHONE, "phone"]]) {
    const p = await L.newPage({ from: d, opts });
    await dash(p);
    await p.locator("#bank-to-confirm").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await p.waitForTimeout(800);
    await L.shot(p, `t4-single-${tag}`, `A single $250.00 charge: the over-$200 tick next to its Confirm with your bank, the button off until ticked (${tag}).`, SC);
    await payments(p);
    await p.locator("#confirm").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await p.waitForTimeout(800);
    await L.shot(p, `t5-payments-${tag}`, `Payments' confirm list: the $250.00 charge links to its test page's Confirm (${tag}).`, SC);
    await p.context().close();
  }
  return { st };
}

(async () => {
  const which = process.argv.slice(2);
  await L.start();
  const out = {};
  try {
    if (which.includes("A")) out.A = await A();
    if (which.includes("C") && out.A) out.C = await chargeback("C", out.A.W, null, "full");
    if (which.includes("P")) { const W = await world(`ca${L.TS}p`, CARD_ASK); await confirmAllApi(W); out.P = await chargeback("P", W, 1500, "partial: $15.00 of $32.00"); }
    if (which.includes("T")) out.T = await T();
    if (which.includes("B")) { out.B = await B(); }
    if (which.includes("S")) await S(out.B?.W);
    if (which.includes("D")) out.D = await D();
  } catch (e) {
    console.error("RUN FAILED:", e && e.stack ? e.stack.slice(0, 1500) : e);
  } finally {
    if (out.B) delete out.B.W;
    if (out.A) delete out.A.W;
    fs.writeFileSync(path.join(L.OUT, `run-${Date.now()}.json`), JSON.stringify(out, null, 2));
    L.writeMade();
    await L.stop();
  }
})();
