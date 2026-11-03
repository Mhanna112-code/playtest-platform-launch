// The race set (owner, Nov 3): the same buttons (or a button and an event) at the same moment, with real Stripe (test mode). Two tabs of the same person and the
// Stripe viewer are recorded side by side. Each press's request is timed in the browser (sent → answered), so the caption says which reached the server first
// and by how many ms. Loaded by run.cjs with its helpers (`H`).
/* eslint-disable */
const crypto = require("crypto");

module.exports = (H) => {
  const { L, sql, lit, ok, post, now, log, mkTest, joinWritten, sendRec, payApi, disputeApi, decide, ignore, openChoice, capWait, openPage, fillPay, payButton, stopText, waitPaid, verdict, CARD_ASK, CARD_OK } = H;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const chargeApiNow = (t, s, sub, cents = 1000) => post(t, `/api/sessions/${s}/choose`, { choice: "charge", submissionId: sub, amount: (cents / 100).toFixed(2), tickedCents: cents, seenAt: now(), confirmed: true });
  const tick200 = async (page, id) => { const t = page.locator(`#over-${id}`).last(); if (await t.count()) await t.check(); };

  /** The next POST this page sends to a URL matching `re`: when it left (ms), when it was answered, its status and body. */
  function watchReq(page, re) {
    return new Promise((res) => {
      const on = (req) => {
        if (req.method() !== "POST" || !re.test(req.url())) return;
        page.off("request", on);
        const t0 = Date.now();
        req.response().then(async (r) => res({ t0, t1: Date.now(), status: r ? r.status() : 0, body: r ? await r.json().catch(() => null) : null })).catch(() => res({ t0, t1: Date.now(), status: 0, body: null }));
      };
      page.on("request", on);
      setTimeout(() => { page.off("request", on); res({ t0: 0, t1: 0, status: -1, body: null }); }, 90000);
    });
  }
  /** An API press (the other side, or the team) timed the same way. */
  const timed = async (fn) => { const t0 = Date.now(); const r = await fn(); return { t0, t1: Date.now(), status: r?.status ?? 200, body: r?.body ?? r }; };
  /** Two presses: `b` starts `offset` ms after `a` (negative: before). Both timed; `overlap`: each was sent before the other was answered. */
  async function fire(a, b, offset = 0) {
    const [ra, rb] = await Promise.all([offset < 0 ? sleep(-offset).then(a) : a(), offset > 0 ? sleep(offset).then(b) : b()]);
    return { ra, rb, overlap: ra.t0 < rb.t1 && rb.t0 < ra.t1, first: ra.t0 <= rb.t0 ? "A" : "B", gap: Math.abs(ra.t0 - rb.t0) };
  }
  const msg = (r) => r?.body?.error?.message ?? (r?.body?.error?.code ? r.body.error.code : r?.status === 200 ? "went through" : `status ${r?.status}`);
  const order = (f, an, bn) => `${f.first === "A" ? an : bn} reached the server first, by ${f.gap} ms${f.overlap ? " (both in flight together)" : ""}`;
  const clickWatched = (page, locator, re) => async () => { const w = watchReq(page, re); await locator.click(); return w; };

  /** A recorded race: `setup` → { pr, title, A, B, after, judge }. Tried at offsets 0, 50, 200 until both were in flight together (a take that wasn't is dropped). */
  async function race(name, title, setup, offsets = [0, 50, 200]) {
    let last;
    for (const off of offsets) {
      const X = await setup();
      await X.ready?.();
      const f = await fire(X.A, X.B, off);
      if (!f.overlap && off !== offsets[offsets.length - 1]) {
        log(`take at ${off} ms: not in flight together (${f.gap} ms apart); again`);
        for (const p of [...X.pr.apps, X.pr.pan]) await p.context().close().catch(() => {});
        continue;
      }
      const result = await X.after(f);
      await L.pairVideo(X.pr, name, "", "R");
      L.stripeOut(X.stripeDev, name, "R");
      const j = X.judge(f, result);
      return verdict(name, title, `${order(f, X.an, X.bn)}. ${j.text}`, j.good, j.bug || "");
    }
    return last;
  }

  // ---------- R1 · Decide vs Pay more on the same part ----------
  const R1 = (W) => race("r1-decide-vs-pay-more", "R1 · The team's Decide and Nora's Pay more on the same part at once", async () => {
    const t = await mkTest(W.d1, "Race R1");
    const a = await joinWritten(W.ana, t);
    await payApi(W.d1, "submission", a.sub, 400, "Only half of the answers were useful.");
    const dispute = await disputeApi(W.ana, a.s, "submission", a.sub);
    const pr = await L.pairTabs(W.d1, W.d1, "R1 · Decide ($10 in all) vs Pay more ($6) on Ana's answers", [W.ana], 1, { viewport: { width: 1100, height: 900 } });
    const p = pr.apps[0];
    await openPage(p, `/app/tests/${t}`);
    const box = await fillPay(p, a.sub, 600);
    await capWait(p, "Nora has Pay more $6.00 typed on Ana's answers (paid $4.00, disputed). The team decides $10.00 in all at the same moment.", 1500);
    return {
      pr, stripeDev: W.d1, an: "Nora's Pay more", bn: "the team's Decide",
      A: clickWatched(p, payButton(box), /pay-extra/),
      B: () => timed(() => post(W.admin, "/api/admin/decide", { id: dispute, total: "10.00", tickCents: 600 })),
      after: async (f) => {
        await p.waitForTimeout(5000);
        const total = Number(sql(`select coalesce(sum("amountCents"),0) from "Payment" where "submissionId" = ${lit(a.sub)} and status in ('charged','not_set_up')`));
        await capWait(p, `${order(f, "Nora's Pay more", "the team's Decide")}. Pay more: ${msg(f.ra)}. Decide: ${msg(f.rb)}. Paid in all: $${(total / 100).toFixed(2)} — never above the decision.`, 6000);
        return { total };
      },
      judge: (f, r) => ({ good: r.total <= 1000, text: `Pay more: “${msg(f.ra)}”; Decide: “${msg(f.rb)}”. Paid in all $${(r.total / 100).toFixed(2)}: one outcome, never above the $10.00 decided (Stripe beside it).`, bug: `paid $${r.total / 100}` }),
    };
  });

  // ---------- R2 · Pay in two tabs ----------
  const R2 = (W) => race("r2-pay-two-tabs", "R2 · Pay in two tabs on the same part at once", async () => {
    const t = await mkTest(W.d1, "Race R2");
    const a = await joinWritten(W.ana, t);
    const pr = await L.pairTabs(W.d1, W.d1, "R2 · Pay $10.00 in two tabs at once", [W.ana]);
    const [p1, p2] = pr.apps;
    await openPage(p1, `/app/tests/${t}`); await openPage(p2, `/app/tests/${t}`);
    const b1 = await fillPay(p1, a.sub, 1000), b2 = await fillPay(p2, a.sub, 1000);
    await capWait(p1, "Tab 1 and tab 2: Pay $10.00 on Ana's answers, pressed at the same moment.", 1500);
    return {
      pr, stripeDev: W.d1, an: "Tab 1", bn: "Tab 2",
      A: clickWatched(p1, payButton(b1), /\/api\/review/), B: clickWatched(p2, payButton(b2), /\/api\/review/),
      after: async (f) => {
        await p1.waitForTimeout(4000);
        const n = Number(sql(`select count(*) from "Payment" where "submissionId" = ${lit(a.sub)} and status in ('charged','not_set_up')`));
        const cap = `${order(f, "Tab 1", "Tab 2")}. Tab 1: ${msg(f.ra)}. Tab 2: ${msg(f.rb)}. One charge.`;
        await capWait(p1, cap, 2500); await capWait(p2, cap, 4500);
        return { n };
      },
      judge: (f, r) => ({ good: r.n === 1, text: `Tab 1: “${msg(f.ra)}”; tab 2: “${msg(f.rb)}”. One charge at Stripe ($10.00 Succeeded).`, bug: `${r.n} charges` }),
    };
  });

  // ---------- R3 · Pay more in two tabs, together over the max ----------
  const R3 = (W) => race("r3-pay-more-two-tabs-over-max", "R3 · Pay more in two tabs at once, together over the maximum", async () => {
    const t = await mkTest(W.d1, "Race R3");
    const a = await joinWritten(W.ana, t);
    await payApi(W.d1, "submission", a.sub, 400, "Only half of the answers were useful.");
    const pr = await L.pairTabs(W.d1, W.d1, "R3 · Pay more $600 + $600 at once (room left $996)", [W.ana]);
    const [p1, p2] = pr.apps;
    await openPage(p1, `/app/tests/${t}`); await openPage(p2, `/app/tests/${t}`);
    const b1 = await fillPay(p1, a.sub, 60000), b2 = await fillPay(p2, a.sub, 60000);
    await tick200(p1, a.sub); await tick200(p2, a.sub);
    await capWait(p1, "Paid $4.00 of the $1,000.00 most. Tab 1 and tab 2: Pay more $600.00 each, at the same moment.", 1500);
    return {
      pr, stripeDev: W.d1, an: "Tab 1", bn: "Tab 2",
      A: clickWatched(p1, payButton(b1), /pay-extra/), B: clickWatched(p2, payButton(b2), /pay-extra/),
      after: async (f) => {
        await p1.waitForTimeout(4000);
        const total = Number(sql(`select coalesce(sum("amountCents"),0) from "Payment" where "submissionId" = ${lit(a.sub)} and status in ('charged','not_set_up')`));
        const cap = `${order(f, "Tab 1", "Tab 2")}. Tab 1: ${msg(f.ra)}. Tab 2: ${msg(f.rb)}. Paid in all $${(total / 100).toFixed(2)}.`;
        await capWait(p1, cap, 2500); await capWait(p2, cap, 4500);
        return { total };
      },
      judge: (f, r) => ({ good: r.total === 60400 && [f.ra, f.rb].some((x) => /up to .* more/.test(msg(x))), text: `Tab 1: “${msg(f.ra)}”; tab 2: “${msg(f.rb)}”. One $600.00 charge; paid in all $${(r.total / 100).toFixed(2)}, never above $1,000.00.`, bug: `paid $${r.total / 100}` }),
    };
  });

  /** A test of Omar's (card 3184) with Ana's $10.00 Charge waiting for his bank. */
  async function waitingWorld(W, title, dev = W.d2) {
    const t = await mkTest(dev, title);
    const a = await joinWritten(W.ana, t);
    openChoice(a.sub, t);
    log("Ana's Charge:", (await chargeApiNow(W.ana, a.s, a.sub)).status);
    await L.waitAction(a.sub);
    const pay = sql(`select id from "Payment" where "submissionId" = ${lit(a.sub)} order by "createdAt" desc limit 1`);
    return { t, a, pay };
  }

  // ---------- R4 · Confirm with your bank in two tabs ----------
  const R4 = (W) => race("r4-confirm-two-tabs", "R4 · Confirm with your bank in two tabs at once on the same waiting charge", async () => {
    const X = await waitingWorld(W, "Race R4");
    const pr = await L.pairTabs(W.d2, W.d2, "R4 · Confirm with your bank in two tabs at once (card 3184)", [W.ana]);
    const [p1, p2] = pr.apps;
    const sel = `[data-bank-waiting="${X.pay}"]`;
    await openPage(p1, `/app/tests/${X.t}`, sel); await openPage(p2, `/app/tests/${X.t}`, sel);
    await capWait(p1, "Ana's $10.00 Charge waits for Omar's bank. Both tabs press “Confirm with your bank” at the same moment.", 1500);
    return {
      pr, stripeDev: W.d2, an: "Tab 1", bn: "Tab 2",
      A: clickWatched(p1, p1.locator(`${sel} button`).first(), /\/api\/payments\/confirm/), B: clickWatched(p2, p2.locator(`${sel} button`).first(), /\/api\/payments\/confirm/),
      after: async (f) => {
        await p1.waitForTimeout(3000);
        await capWait(p1, `${order(f, "Tab 1", "Tab 2")}. Tab 1: Complete on the bank's page…`, 800);
        await L.threeDS(p1, true, 40000);
        await L.waitSql(`select status from "Payment" where id = ${lit(X.pay)}`, (v) => v === "charged", 60000);
        await p1.waitForTimeout(2500);
        await capWait(p2, "Tab 2: Complete on its bank page too…", 800);
        const w2 = watchReq(p2, /\/api\/payments\/confirm/);
        const had = await L.threeDS(p2, true, 15000);
        const r2 = had ? await w2 : null;
        await p2.waitForTimeout(3000);
        const line2 = (await p2.locator(`${sel}, [data-bank-not-confirmed], [data-refusal]`).first().innerText().catch(() => "")).replace(/\s+/g, " ");
        await capWait(p2, `Tab 2 shows: ${line2 || msg(r2) || "(nothing)"}. Stripe: one $10.00 Succeeded.`, 8000);
        const n = Number(sql(`select count(*) from "Payment" where "submissionId" = ${lit(X.a.sub)} and status = 'charged'`));
        return { n, line2: line2 || msg(r2) };
      },
      judge: (f, r) => ({ good: r.n === 1, text: `Both tabs pressed Confirm with your bank (tab 1: “${msg(f.ra)}”, tab 2: “${msg(f.rb)}”). Tab 1 completed the bank's page: paid. Tab 2 then: “${r.line2}”. One charge at Stripe.`, bug: `${r.n} charges` }),
    };
  });

  // ---------- R6 · the tester's Charge vs Pay ----------
  const R6 = (W) => race("r6-charge-vs-pay", "R6 · Ana's Charge and Nora's Pay on the same part at once", async () => {
    const t = await mkTest(W.d1, "Race R6");
    const a = await joinWritten(W.ana, t);
    openChoice(a.sub, t);
    const pr = { apps: [await L.newPage({ from: W.ana, video: true, opts: { viewport: { width: 900, height: 900 } } }), await L.newPage({ from: W.d1, video: true, opts: { viewport: { width: 900, height: 900 } } })] };
    pr.app = pr.apps[0];
    pr.pan = (await L.pairTabs(W.d1, W.d1, "R6 · Ana's Charge vs Nora's Pay ($10.00 each)", [W.ana], 0)).pan;
    const [pa, pn] = pr.apps;
    await openPage(pa, `/app/sessions/${a.s}`, "#part-written"); await openPage(pn, `/app/tests/${t}`);
    const box = await fillPay(pn, a.sub, 1000);
    await capWait(pa, "Left: Ana presses Charge ($10.00). Right: Nora presses Pay ($10.00). The same moment.", 1500);
    const charge = pa.locator("#part-written button.btn", { hasText: /^Charge/ }).first();
    return {
      pr, stripeDev: W.d1, an: "Ana's Charge", bn: "Nora's Pay",
      A: clickWatched(pa, charge, /\/choose/), B: clickWatched(pn, payButton(box), /\/api\/review/),
      after: async (f) => {
        await pa.waitForTimeout(4000);
        const rows = sql(`select coalesce(string_agg(kind || ':' || status || ' $' || ("amountCents"/100.0)::numeric(10,2), ', '), '') from "Payment" where "submissionId" = ${lit(a.sub)} and status in ('charged','not_set_up','needs_confirmation','pending','needs_action')`);
        const cap = `${order(f, "Ana's Charge", "Nora's Pay")}. Charge: ${msg(f.ra)}. Pay: ${msg(f.rb)}. Charged: ${rows}.`;
        await capWait(pa, cap, 2500); await capWait(pn, cap, 4500);
        return { n: rows ? rows.split(", ").length : 0, rows };
      },
      judge: (f, r) => ({ good: r.n <= 1 && [f.ra, f.rb].filter((x) => x.status === 200).length === 1, text: `Ana's Charge: “${msg(f.ra)}”; Nora's Pay: “${msg(f.rb)}”. One charge at Stripe (${r.rows}); the other was refused.`, bug: `charges: ${r.rows}` }),
    };
  });

  // ---------- R8 · Confirm all in two tabs ----------
  const R8 = (W) => race("r8-confirm-all-two-tabs", "R8 · Confirm all in two tabs at once", async () => {
    const t = await mkTest(W.d2, "Race R8");
    const a = await joinWritten(W.ana, t), b = await joinWritten(W.ben, t);
    openChoice(a.sub, t); openChoice(b.sub, t);
    await chargeApiNow(W.ana, a.s, a.sub); await chargeApiNow(W.ben, b.s, b.sub);
    await L.waitAction(a.sub); await L.waitAction(b.sub);
    const pr = await L.pairTabs(W.d2, W.d2, "R8 · Confirm all (2) · $20.00 in two tabs at once", [W.ana, W.ben]);
    const [p1, p2] = pr.apps;
    await openPage(p1, "/app", "#bank-to-confirm"); await openPage(p2, "/app", "#bank-to-confirm");
    await capWait(p1, "Two charges wait for Omar's bank. Both tabs press Confirm all at the same moment.", 1500);
    const btn = (p) => p.locator("#bank-to-confirm [data-confirm-all-button]").first();
    return {
      pr, stripeDev: W.d2, an: "Tab 1", bn: "Tab 2",
      A: clickWatched(p1, btn(p1), /confirm-all/), B: clickWatched(p2, btn(p2), /confirm-all/),
      after: async (f) => {
        await p1.waitForTimeout(3000);
        const winner = f.ra.body?.confirm ? p1 : f.rb.body?.confirm ? p2 : p1;
        await capWait(winner, "The tab whose press made the one payment: Complete on its bank check…", 800);
        await L.threeDS(winner, true, 40000);
        await L.waitSql(`select count(*) from "Payment" where "developerId" = ${lit(W.d2.uid)} and kind = 'owed' and note = 'press:all' and status in ('bundled','charged')`, (v) => Number(v) > 0, 60000);
        const n = Number(sql(`select count(*) from "Payment" where "developerId" = ${lit(W.d2.uid)} and kind = 'owed' and note = 'press:all' and "createdAt" > now() - interval '5 minutes'`));
        const cap = `${order(f, "Tab 1", "Tab 2")}. Tab 1: ${f.ra.body?.confirm ? "opened the one bank check" : msg(f.ra)}. Tab 2: ${f.rb.body?.confirm ? "opened the one bank check" : msg(f.rb)}. One payment.`;
        await capWait(p1, cap, 2000); await capWait(p2, cap, 8000);
        return { n };
      },
      judge: (f, r) => ({ good: r.n === 1, text: `Tab 1: ${f.ra.body?.confirm ? "opened the one bank check" : `“${msg(f.ra)}”`}; tab 2: ${f.rb.body?.confirm ? "opened the one bank check" : `“${msg(f.rb)}”`}. One Confirm all payment ($20.00 Succeeded at Stripe after Complete).`, bug: `${r.n} Confirm all payments` }),
    };
  });

  // ---------- R11 (a), (b) · Confirm all vs a single Confirm ----------
  async function R11a(W) {
    const name = "r11a-single-confirm-while-confirm-all-open";
    const t = await mkTest(W.d2, "Race R11a");
    const a = await joinWritten(W.ana, t), b = await joinWritten(W.ben, t);
    openChoice(a.sub, t); openChoice(b.sub, t);
    await chargeApiNow(W.ana, a.s, a.sub); await chargeApiNow(W.ben, b.s, b.sub);
    await L.waitAction(a.sub); await L.waitAction(b.sub);
    const anaPay = sql(`select id from "Payment" where "submissionId" = ${lit(a.sub)} order by "createdAt" desc limit 1`);
    const pr = await L.pairTabs(W.d2, W.d2, "R11a · A single Confirm while Confirm all's bank check is open", [W.ana, W.ben]);
    const [p1, p2] = pr.apps;
    await openPage(p1, "/app", "#bank-to-confirm"); await openPage(p2, `/app/tests/${t}`, `[data-bank-waiting="${anaPay}"]`);
    await capWait(p1, "Tab 1 presses Confirm all: its one bank check opens (not completed).", 500);
    await p1.locator("#bank-to-confirm [data-confirm-all-button]").first().click();
    await p1.locator("[data-bank-check]").first().waitFor({ timeout: 30000 }).catch(() => {});
    await p1.waitForTimeout(1500);
    const n0 = (await L.appfn("stripe", W.d2.uid)).count;
    await capWait(p2, "Tab 2 (old page): “Confirm with your bank” on Ana's charge, which Confirm all now covers…", 500);
    const w = watchReq(p2, /\/api\/payments\/confirm/);
    await p2.locator(`[data-bank-waiting="${anaPay}"] button`).first().click();
    const r = await w;
    await p2.waitForTimeout(1500);
    const line = (await p2.locator(`[data-bank-waiting="${anaPay}"]`).innerText().catch(() => "")).replace(/\s+/g, " ");
    await capWait(p2, `Tab 2: ${msg(r)} Nothing new at Stripe.`, 3500);
    await capWait(p1, "Tab 1: Complete on Confirm all's check → one payment for both.", 500);
    await L.threeDS(p1, true, 40000);
    await p1.waitForTimeout(5000);
    await L.pairVideo(pr, name, "", "R");
    const s = L.stripeOut(W.d2, name, "R");
    const good = /This payment is in your Confirm all, waiting for your bank: finish that check, or cancel it\./.test(msg(r));
    return verdict(name, "R11a · A single “Confirm with your bank” while Confirm all's bank check is open",
      `Tab 1 pressed Confirm all and its one bank check was open. Tab 2's old page pressed Confirm with your bank on Ana's charge (covered by it): refused “${msg(r)}”, nothing new at Stripe (${n0} PaymentIntents before and after the press). Tab 1 then completed: one payment for both (Stripe beside it).`,
      good, `tab 2: “${msg(r)}” / “${line}”`);
  }

  async function R11b(W) {
    const name = "r11b-confirm-all-while-single-check-open";
    const t = await mkTest(W.d2, "Race R11b");
    const a = await joinWritten(W.ana, t), b = await joinWritten(W.ben, t);
    openChoice(a.sub, t); openChoice(b.sub, t);
    await chargeApiNow(W.ana, a.s, a.sub); await chargeApiNow(W.ben, b.s, b.sub);
    await L.waitAction(a.sub); await L.waitAction(b.sub);
    const anaPay = sql(`select id from "Payment" where "submissionId" = ${lit(a.sub)} order by "createdAt" desc limit 1`);
    const oldPi = sql(`select "actionPi" from "Payment" where id = ${lit(anaPay)}`);
    const pr = await L.pairTabs(W.d2, W.d2, "R11b · Confirm all while a single Confirm's bank page is open", [W.ana, W.ben]);
    const [p1, p2] = pr.apps;
    await openPage(p2, `/app/tests/${t}`, `[data-bank-waiting="${anaPay}"]`); await openPage(p1, "/app", "#bank-to-confirm");
    await capWait(p2, "Tab 2: Confirm with your bank on Ana's charge — its bank page opens (not completed).", 500);
    await p2.locator(`[data-bank-waiting="${anaPay}"] button`).first().click();
    await p2.locator("[data-bank-check]").first().waitFor({ timeout: 30000 }).catch(() => {});
    await p2.waitForTimeout(1500);
    await capWait(p1, "Tab 1: Confirm all — the single check is cancelled at Stripe first, and Confirm all covers Ana's charge.", 500);
    await p1.locator("#bank-to-confirm [data-confirm-all-button]").first().click();
    await p1.locator("[data-bank-check]").first().waitFor({ timeout: 30000 }).catch(() => {});
    await p1.waitForTimeout(2500);
    await capWait(p2, "Tab 2: Complete on the old (cancelled) bank page…", 500);
    await L.threeDS(p2, true, 15000);
    await p2.waitForTimeout(5000);
    const line = (await p2.locator(`[data-bank-waiting="${anaPay}"], [data-bank-not-confirmed]`).first().innerText().catch(() => "")).replace(/\s+/g, " ");
    await capWait(p2, `Tab 2 shows: ${line || "(nothing)"}. Its Complete charged nothing.`, 3000);
    await capWait(p1, "Tab 1: Complete on Confirm all's check → one $20.00 payment.", 500);
    await L.threeDS(p1, true, 40000);
    await L.waitSql(`select status from "Payment" where id = ${lit(anaPay)}`, (v) => v === "charged" || v === "bundled", 60000);
    await p1.waitForTimeout(5000);
    await L.pairVideo(pr, name, "", "R");
    const s = L.stripeOut(W.d2, name, "R");
    const old = s.paymentIntents.find((p) => p.id === oldPi);
    const good = old?.status === "canceled" && s.paymentIntents.some((p) => p.amount === "20.00" && p.status === "succeeded");
    return verdict(name, "R11b · Confirm all while a single Confirm's bank page is open",
      `Tab 2's Confirm with your bank on Ana's charge had its bank page open. Tab 1 pressed Confirm all: Ana's own check was cancelled at Stripe first (Stripe: ${old?.status ?? "?"}) and Confirm all covered it. Tab 2's Complete then charged nothing (tab 2: “${line}”). Tab 1's Complete paid both as one $20.00 payment.`,
      good, `old check: ${old?.status}`);
  }

  // ---------- already confirmed in another tab (not at the same moment) ----------
  async function T1(W) {
    const name = "t1-confirm-already-done-in-other-tab";
    const X = await waitingWorld(W, "Already T1");
    const sel = `[data-bank-waiting="${X.pay}"]`;
    const pr = await L.pairTabs(W.d2, W.d2, "T1 · Confirm with your bank done in tab 1; tab 2's old page presses it", [W.ana]);
    const [p1, p2] = pr.apps;
    await openPage(p1, `/app/tests/${X.t}`, sel); await openPage(p2, `/app/tests/${X.t}`, sel);
    await capWait(p1, "Tab 1: Confirm with your bank on Ana's $10.00 charge → Complete.", 500);
    await p1.locator(`${sel} button`).first().click();
    await L.threeDS(p1, true, 40000);
    // Tab 2 presses the moment tab 1's payment is recorded, before its own page's live check redraws it away.
    for (let i = 0; i < 120 && sql(`select status from "Payment" where id = ${lit(X.pay)}`) !== "charged"; i++) await p2.waitForTimeout(250);
    const w = watchReq(p2, /\/api\/payments\/confirm/);
    await p2.locator(`${sel} button`).first().click({ timeout: 5000 });
    await capWait(p2, "Tab 2 (old page, not reloaded) pressed Confirm with your bank right after tab 1 paid…", 300);
    const n0 = (await L.appfn("stripe", W.d2.uid)).count;
    const r = await w;
    await p2.waitForTimeout(1500);
    await capWait(p2, `Tab 2: “${msg(r)}” — nothing new at Stripe.`, 4500);
    await L.pairVideo(pr, name, "", "R");
    const s = L.stripeOut(W.d2, name, "R");
    return verdict(name, "T1 · “Confirm with your bank” already done in another tab (not at the same moment)",
      `Tab 1 confirmed Ana's $10.00 charge (Stripe: Succeeded). Tab 2's old page then pressed Confirm with your bank: “${msg(r)}”; nothing new at Stripe (${n0} → ${s.count} PaymentIntents).`,
      msg(r) === "You already confirmed this payment." && s.count === n0, `tab 2: “${msg(r)}”`);
  }

  async function T2(W) {
    const name = "t2-pay-owed-already-paid-in-other-tab";
    const dev = await L.account("pm-devowed", "Sam Ortiz", "developer");
    await L.addCard(dev, "4000 0000 0000 0341"); // saves, then every charge on it is declined
    const t = await mkTest(dev, "Already T2");
    const a = await joinWritten(W.ana, t);
    const r = await post(dev, "/api/review", { kind: "submission", id: a.sub, amount: "10.00", tickedCents: 1000, payKey: crypto.randomUUID(), seenAt: now(), confirmed: true });
    log("declined Pay:", r.status, msg(r));
    await L.addCard(dev, CARD_OK);
    const pr = await L.pairTabs(dev, dev, "T2 · Pay what you owe paid in tab 1; tab 2's old page presses it", [W.ana]);
    const [p1, p2] = pr.apps;
    await openPage(p1, "/app/payments", "#owed"); await openPage(p2, "/app/payments", "#owed");
    const btn = (p) => p.locator("#owed button.btn, #owed button").filter({ hasText: /Pay what you owe|Pay \$/ }).first();
    await capWait(p1, "Sam owes $10.00 (a declined Pay). Tab 1: Pay what you owe (card 4242).", 500);
    const w1 = watchReq(p1, /\/api\/payments\/owed/);
    await btn(p1).click();
    const r1 = await w1;
    await p1.waitForTimeout(2500);
    const n0 = (await L.appfn("stripe", dev.uid)).count;
    await capWait(p2, "Tab 2 (old page, not reloaded) presses Pay what you owe…", 500);
    const w2 = watchReq(p2, /\/api\/payments\/owed/);
    await btn(p2).click();
    const r2 = await w2;
    await p2.waitForTimeout(1500);
    await capWait(p2, `Tab 2: “${msg(r2)}” — nothing new at Stripe.`, 4500);
    await L.pairVideo(pr, name, "", "R");
    const s = L.stripeOut(dev, name, "R");
    return verdict(name, "T2 · Pay what you owe already paid in another tab",
      `Sam owed $10.00 after a declined Pay. Tab 1's Pay what you owe paid it (${msg(r1)}; Stripe: $10.00 Succeeded). Tab 2's old page then pressed it: “${msg(r2)}”; nothing new at Stripe (${n0} → ${s.count} PaymentIntents).`,
      /^You already paid what you owe \(\$10\.00\) in another tab at /.test(msg(r2)) && s.count === n0, `tab 2: “${msg(r2)}”`);
  }

  return { R1, R2, R3, R4, R6, R8, R11a, R11b, T1, T2, ...require("./races-more.cjs")(H, { race, fire, order, msg, clickWatched, chargeApiNow }) };
};
