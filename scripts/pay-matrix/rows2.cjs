// Rows K–O of the payment stop matrix recordings (the owner's later decisions, Nov 3). Loaded by run.cjs, which passes its helpers in (`H`).
/* eslint-disable */
const crypto = require("crypto");

module.exports = (H) => {
  const { L, sql, lit, ok, post, now, log, mkTest, joinWritten, sendRec, payApi, disputeApi, decide, ignore, openChoice, caption, capWait, openPage, fillPay, payButton, pressAgain, stopText, waitPaid, verdict, CARD_ASK } = H;
  const tick200 = async (page, id) => { const t = page.locator(`#over-${id}`).last(); if (await t.count()) await t.check(); };
  const payMoreApi = (dev, testId, contractId, submissionId, cents, extra = {}) =>
    post(dev, `/api/tests/${testId}/pay-extra`, { contractId, submissionId, amount: (cents / 100).toFixed(2), tickedCents: cents, ...(cents > 20000 ? { over200: true } : {}), payKey: crypto.randomUUID(), seenAt: now(), confirmed: true, ...extra });
  const chargeApiNow = (t, s, sub, cents = 1000) => post(t, `/api/sessions/${s}/choose`, { choice: "charge", submissionId: sub, amount: (cents / 100).toFixed(2), tickedCents: cents, seenAt: now(), confirmed: true });

  async function K(W) {
    const name = "k-tester-leaves-same-tester-always-stops";
    const t = await mkTest(W.d1, "Harbor Run K");
    const a = await joinWritten(W.ana, t);
    const b = await joinWritten(W.ben, t);
    ignore(t, ["leaving"]);
    const pr = await L.pair(W.d1, W.d1, "K · The tester leaving always stops Pay on HER parts (Testers leaving ticked off)", [W.ana, W.ben]);
    await openPage(pr.app, `/app/tests/${t}`);
    await capWait(pr.app, "Alerts: “Testers leaving” is ticked OFF.", 2200);
    const box = await fillPay(pr.app, a.sub, 1000);
    await capWait(pr.app, "Meanwhile Ana leaves the test.", 500);
    ok(await post(W.ana, `/api/sessions/${a.s}/leave`, { seenAt: now(), confirmed: true }), "leave");
    await pr.app.waitForTimeout(1000);
    await capWait(pr.app, "Nora presses Pay on ANA's written answers…", 500);
    await payButton(box).click();
    const st = await stopText(pr.app);
    await capWait(pr.app, st ? "Stops once: “Ana Silva left the test” — her own parts always stop, whatever the tick. Nothing charged." : "No stop box appeared.", 3500);
    await pressAgain(pr.app, a.sub, 1000);
    await capWait(pr.app, "Second press: paid. Stripe: $10.00 Succeeded.", 600);
    await waitPaid(`"submissionId" = ${lit(a.sub)}`);
    await pr.app.waitForTimeout(2500);
    const box2 = await fillPay(pr.app, b.sub, 1000);
    await capWait(pr.app, "Pay on BEN's answers (another tester; the tick is off): straight through.", 600);
    await payButton(box2).click();
    await pr.app.waitForTimeout(2500);
    const st2 = (await pr.app.locator("[data-stop-box]").count()) ? await stopText(pr.app) : "";
    const paidB = await waitPaid(`"submissionId" = ${lit(b.sub)}`);
    await capWait(pr.app, "Stripe: Ben's $10.00 Succeeded too.", 8000);
    await L.pairVideo(pr, name, "", "K");
    L.stripeOut(W.d1, name, "K");
    const good = /Ana Silva left the test/.test(st) && !/left the test/.test(st2) && Number(paidB) > 0;
    return verdict(name, "K · A tester leaving always stops Pay on her own parts (“Testers leaving” ticked off); another tester's Pay goes through",
      "“Testers leaving” ticked off. Ana left after Nora's page loaded: Nora's Pay on Ana's written answers stopped once naming “Ana Silva left the test” and the second press paid $10.00; Nora's Pay on Ben's answers went straight through (Stripe: both $10.00 Succeeded).",
      good, `Ana's stop: “${st || "none"}”; Ben's: “${st2 || "none"}”`);
  }

  async function Lrow(W) {
    const name = "l-confirm-all-stops-for-item-decision";
    const t = await mkTest(W.d2, "Harbor Run L");
    const a = await joinWritten(W.ana, t);
    const rec = await sendRec(W.ana, a.s);
    const b = await joinWritten(W.ben, t);
    await payApi(W.d2, "submission", a.sub, 400, "Only half of the answers were useful.");
    const dispute = await disputeApi(W.ana, a.s, "submission", a.sub);
    openChoice(rec, t); openChoice(b.sub, t);
    log("Ana's Charge:", (await chargeApiNow(W.ana, a.s, rec)).status, "Ben's:", (await chargeApiNow(W.ben, b.s, b.sub)).status);
    await L.waitAction(rec); await L.waitAction(b.sub);
    ignore(t, ["disputes", "admin", "payments"]);
    const pr = await L.pair(W.d2, W.d2, "L · Confirm all stops once for the team's decision about one item's tester", [W.ana, W.ben]);
    await openPage(pr.app, "/app", "#bank-to-confirm");
    await capWait(pr.app, "Omar's dashboard: Ana's and Ben's $10.00 Charges wait for his bank (card 3184). Decisions by the team ticked off.", 2500);
    await capWait(pr.app, "Meanwhile the team decides Ana's dispute about her written answers (the pay stays at $4.00).", 500);
    await decide(W.admin, dispute, "4.00", 0);
    await pr.app.waitForTimeout(1200);
    const btn = pr.app.locator("#bank-to-confirm [data-confirm-all-button]").first();
    await btn.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await capWait(pr.app, "Omar presses Confirm all (2) · $20.00…", 500);
    await btn.click();
    const st = await stopText(pr.app, "#bank-to-confirm");
    const noFrame = !(await pr.app.locator("#bank-to-confirm [data-bank-check]").count());
    await capWait(pr.app, st ? "Stops once at OUR button, naming the decision and the item it's about (Ana's recording). No bank page yet; nothing charged." : "No stop box appeared.", 4000);
    await btn.click();
    await capWait(pr.app, "Second press: ONE bank check for both. Complete is the bank page's only button.", 2500);
    await L.threeDS(pr.app, true, 60000);
    const one = await L.waitSql(`select status from "Payment" where "developerId" = ${lit(W.d2.uid)} and kind = 'owed' and note = 'press:all' order by "createdAt" desc limit 1`, (v) => v === "bundled" || v === "charged", 60000);
    await capWait(pr.app, "Complete → both paid as ONE payment. Stripe: one $20.00 Succeeded; the two old checks Canceled.", 8000);
    await L.pairVideo(pr, name, "", "L");
    const s = L.stripeOut(W.d2, name, "L");
    const good = /The team decided Ana Silva's dispute/.test(st) && /for Ana Silva's recording/.test(st) && noFrame && !!one && s.paymentIntents.some((p) => p.amount === "20.00" && p.status === "succeeded");
    return verdict(name, "L · Confirm all stops once for the team's decision about one item's tester (Decisions ticked off), then pays as one",
      "Ana's and Ben's $10.00 Charges waited for Omar's bank (card 3184); “Decisions by the team” ticked off. The team decided Ana's dispute after the dashboard loaded: Confirm all stopped once at our button, naming the decision “· for Ana Silva's recording …” (the item it's about), with no bank page opened. The second press opened ONE bank check; Complete paid both as one payment (Stripe: $20.00 Succeeded, the two old checks Canceled).",
      good, `stop: “${st || "none"}”; one payment: ${one}`);
  }

  async function M(W) {
    const name = "m-pay-waits-for-testers-charge";
    const t = await mkTest(W.d2, "Harbor Run M");
    const a = await joinWritten(W.ana, t);
    openChoice(a.sub, t);
    const pr = await L.pairTabs(W.d2, W.d2, "M · Pay waits while Ana's Charge waits for the bank (card 3184)", [W.ana]);
    const [t1, t2] = pr.apps;
    await openPage(t1, `/app/tests/${t}`);
    await openPage(t2, `/app/tests/${t}`);
    const box = await fillPay(t2, a.sub, 100000);
    await tick200(t2, a.sub);
    await capWait(t2, "Tab 2: Omar has typed Pay $1,000.00 on Ana's written answers (the most a part can be paid).", 2200);
    await capWait(t2, "Meanwhile Ana presses Charge ($10.00): Omar's card asks the bank, so her charge waits for “Confirm with your bank”.", 500);
    const ch = await chargeApiNow(W.ana, a.s, a.sub);
    await L.waitAction(a.sub);
    await capWait(t2, "Tab 2 presses Pay before its page has redrawn…", 400);
    await payButton(box).click();
    await t2.waitForTimeout(1500);
    const refusal = (await t2.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
    const refused = /Confirm Ana Silva's \$10\.00 charge with your bank first/.test(refusal);
    await capWait(t2, refused ? "Refused (nothing charged): “Confirm Ana Silva's $10.00 charge with your bank first.” — not a stop: it can't go ahead." : "No refusal seen.", 3500);
    const greyed = await t2.locator("[data-pay-more-waits]").first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
    if (greyed) await t2.locator("[data-pay-more-waits]").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
    await capWait(t2, greyed ? "Tab 2 redrew live: the part's box is the greyed Pay more box with the same line." : "Tab 2 didn't grey out.", 3000);
    await openPage(t1, `/app/tests/${t}`, "[data-bank-waiting]");
    await capWait(t1, "Tab 1: Omar presses “Confirm with your bank” on Ana's $10.00 charge.", 500);
    await t1.locator("[data-bank-waiting] button").first().click();
    await t1.waitForTimeout(2500);
    if (await t1.locator("[data-stop-box]").count()) { await t1.locator("[data-bank-waiting] button").first().click(); await t1.waitForTimeout(2500); }
    await L.threeDS(t1, true, 60000);
    const paid = await L.waitSql(`select status from "Payment" where "submissionId" = ${lit(a.sub)} and kind = 'review' order by "createdAt" desc limit 1`, (v) => v === "charged", 60000);
    await capWait(t1, "Complete → Stripe: Ana's $10.00 Succeeded.", 2500);
    const roomLoc = t2.locator("[data-pay-room]").filter({ hasText: /990/ }).first();
    const room = await roomLoc.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
    if (room) await roomLoc.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await capWait(t2, room ? "Tab 2 redrew: Pay more is enabled again — “up to $990.00 more”." : "Tab 2 didn't show the room left.", 3000);
    const more = await fillPay(t2, a.sub, 500);
    await payButton(more).click();
    await capWait(t2, "Tab 2 pays $5.00 more: the bank asks (card 3184); Complete.", 2500);
    await L.threeDS(t2, true, 60000);
    const paidMore = await L.waitSql(`select count(*) from "Payment" where "submissionId" = ${lit(a.sub)} and kind = 'extra' and status = 'charged'`, (v) => Number(v) > 0, 60000);
    await capWait(t2, "Stripe: $5.00 more Succeeded. In all $15.00, never above $1,000.00.", 8000);
    await L.pairVideo(pr, name, "", "M");
    L.stripeOut(W.d2, name, "M");
    const good = ch.ok && refused && greyed && paid === "charged" && room && Number(paidMore) > 0;
    return verdict(name, "M · The part's Pay waits while the tester's Charge waits for the bank (replaces D1)",
      "Tab 2 had Pay $1,000.00 typed on Ana's written answers. Ana charged $10.00 and Omar's card (3184) asked the bank, so her charge waited. Tab 2's Pay, pressed before its page redrew, was refused with “Confirm Ana Silva's $10.00 charge with your bank first.” (nothing charged, never a stop-once); tab 2 then redrew live into the greyed Pay more box with that line. Tab 1 confirmed with the bank (Stripe: $10.00 Succeeded); tab 2 redrew with Pay more “up to $990.00 more” and paid $5.00 more through its own bank check (Stripe: Succeeded).",
      good, `refusal: ${refused}; greyed: ${greyed}; charge: ${paid}; room shown: ${room}; pay more: ${paidMore}`);
  }

  async function N(W) {
    const name = "n-dispute-nothing-left-after-pay-more";
    const t = await mkTest(W.d1, "Harbor Run N");
    const a = await joinWritten(W.ana, t);
    await payApi(W.d1, "submission", a.sub, 400, "Only half of the answers were useful.");
    const pr = await L.pair(W.ana, W.d1, "N · Ana's Dispute after Nora paid the most it can be", [W.ana]);
    await openPage(pr.app, `/app/sessions/${a.s}`, "#part-written");
    const part = pr.app.locator("#part-written").first();
    await part.locator("summary", { hasText: "Dispute the pay" }).first().click();
    await part.locator(`#d-${a.sub}`).fill("I answered every question fully, with screenshots.");
    await capWait(pr.app, "Ana's page: her answers were paid $4.00; she has typed a dispute.", 2500);
    await capWait(pr.app, "Meanwhile Nora pays $996.00 more: the part is now paid $1,000.00, the most it can be.", 500);
    const m = await payMoreApi(W.d1, t, a.s, a.sub, 99600);
    log("pay more:", m.status, JSON.stringify(m.body).slice(0, 200));
    await pr.app.waitForTimeout(800);
    await capWait(pr.app, "Ana presses Send the dispute…", 500);
    await part.locator("button", { hasText: "Send the dispute" }).first().click();
    await pr.app.waitForTimeout(2000);
    const line = ((await pr.app.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").match(/Nora Lane paid \$996\.00 more meanwhile \([^)]*\): this part is now paid the most it can be \(\$1,000\.00\), so there's nothing to dispute\./) || [""])[0];
    const stop = await part.locator("[data-stop-box]").count();
    await pr.app.locator("text=more meanwhile").first().evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
    await capWait(pr.app, line ? "What Ana saw: ONE refusal in the blue box naming Nora's payment — nothing to press again." : "No refusal line appeared.", 8000);
    await L.pairVideo(pr, name, "", "N");
    L.stripeOut(W.d1, name, "N");
    const good = m.ok && /Nora Lane paid \$996\.00 more meanwhile \(.*\): this part is now paid the most it can be \(\$1,000\.00\), so there's nothing to dispute\./.test(line) && !stop;
    return verdict(name, "N · Dispute after a Pay more took the part to its most: one refusal on Ana's screen",
      `Ana's written answers were paid $4.00 and she had typed a dispute. Nora paid $996.00 more (Stripe: Succeeded), taking the part to $1,000.00. What Ana saw on her press, in the blue box: “${line || "(none)"}” — one refusal, no stop to press again.`,
      good, `line: “${line}”; stop boxes: ${stop}`);
  }

  async function O(W) {
    const name = "o-suspended-with-bank-pages-open";
    const dev = await L.account("pm-devsus", "Rita Gomez", "developer");
    await L.addCard(dev, CARD_ASK, { tds: true });
    const t = await mkTest(dev, "Harbor Run O");
    const a = await joinWritten(W.ana, t);
    const b = await joinWritten(W.ben, t);
    openChoice(b.sub, t);
    log("Ben's Charge:", (await chargeApiNow(W.ben, b.s, b.sub)).status);
    await L.waitAction(b.sub);
    const benPay = sql(`select id from "Payment" where "submissionId" = ${lit(b.sub)} order by "createdAt" desc limit 1`);
    const pr = await L.pairTabs(dev, dev, "O · Suspended while two bank pages are open (card 3184)", [W.ana, W.ben]);
    const [t1, t2] = pr.apps;
    await openPage(t1, `/app/tests/${t}`);
    await openPage(t2, `/app/tests/${t}`, `[data-bank-waiting="${benPay}"]`);
    const box = await fillPay(t1, a.sub, 1000);
    await capWait(t1, "Tab 1: Rita presses Pay on Ana's answers ($10.00): her bank's page opens.", 500);
    await payButton(box).click();
    await t1.locator("[data-bank-check]").first().waitFor({ timeout: 30000 }).catch(() => {});
    await capWait(t2, "Tab 2: Rita presses “Confirm with your bank” on Ben's waiting $10.00 Charge: its bank page opens too.", 500);
    await t2.locator(`[data-bank-waiting="${benPay}"] button`).first().click();
    await t2.locator("[data-bank-check]").first().waitFor({ timeout: 30000 }).catch(() => {});
    await t2.waitForTimeout(2000);
    await capWait(t1, "The team suspends Rita's developer side now.", 500);
    ok(await post(W.admin, "/api/admin/suspend", { id: dev.uid, note: "Recording: suspended mid-payment", side: "developer" }), "suspend");
    await t1.waitForTimeout(1500);
    await capWait(t2, "Tab 2: Complete on Ben's charge (a tester's waiting charge is NOT cancelled by the suspension)…", 500);
    await L.threeDS(t2, true, 60000);
    const benDone = await L.waitSql(`select status from "Payment" where id = ${lit(benPay)}`, (v) => v === "charged", 60000);
    await capWait(t2, benDone === "charged" ? "→ Ben's $10.00 went through and is recorded normally (Stripe: Succeeded)." : `Ben's charge: ${benDone}`, 3000);
    await capWait(t1, "Tab 1: Complete on Rita's own Pay (the suspension cancelled it at Stripe)…", 500);
    await L.threeDS(t1, true, 20000);
    await t1.waitForTimeout(5000);
    const own = sql(`select status from "Payment" where "submissionId" = ${lit(a.sub)} order by "createdAt" desc limit 1`);
    const note = (await t1.locator("[data-bank-not-confirmed], [data-stop-box], [data-refusal]").first().innerText().catch(() => "")).replace(/\s+/g, " ");
    await capWait(t1, `→ ${note || "(no line)"} Stripe: that $10.00 Canceled; nothing charged.`, 4000);
    const again = await post(dev, "/api/review", { kind: "submission", id: a.sub, amount: "10.00", tickedCents: 1000, payKey: crypto.randomUUID(), seenAt: now(), confirmed: true });
    await capWait(t1, `A new Pay while suspended is refused: “${again.body?.error?.message || again.status}”`, 4000);
    await L.pairVideo(pr, name, "", "O");
    const s = L.stripeOut(dev, name, "O");
    const good = benDone === "charged" && own === "cancelled" && again.status === 403 && s.paymentIntents.some((p) => p.status === "canceled");
    return verdict(name, "O · Suspended while bank pages are open: own Pay cancelled, tester's charge completes; new presses refused",
      `Rita (card 3184) had two bank pages open: her own Pay on Ana's answers (tab 1) and Confirm with your bank on Ben's waiting $10.00 Charge (tab 2). The team suspended her developer side. Tab 2's Complete went through and was recorded normally (Stripe: Succeeded). Tab 1's own Pay had been cancelled at Stripe by the suspension: its Complete charged nothing (“${note}”; Stripe: Canceled), and the part is unpaid again. A new Pay while suspended was refused: “${again.body?.error?.message ?? again.status}”.`,
      good, `Ben: ${benDone}; own Pay: ${own}; new Pay: ${again.status}`);
  }

  return { K, L: Lrow, M, N, O };
};
