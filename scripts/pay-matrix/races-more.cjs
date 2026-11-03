// More races (R7a, R9, R10): loaded by races.cjs with its helpers.
/* eslint-disable */
const crypto = require("crypto");
const path = require("path");
const { spawn } = require("child_process");

module.exports = (H, R) => {
  const { L, sql, lit, post, now, log, mkTest, joinWritten, openChoice, capWait, openPage, fillPay, payButton, verdict, CARD_ASK, CARD_OK } = H;
  const { race, fire, order, msg, clickWatched, chargeApiNow } = R;

  /** An appfn call that doesn't block (the race's other press runs meanwhile), timed. */
  function appfnAsync(action, arg = "") {
    return new Promise((res) => {
      const t0 = Date.now();
      const p = spawn(process.execPath, [path.join(__dirname, "appfn.cjs"), action, arg], { cwd: path.join(__dirname, "..", ".."), windowsHide: true });
      let out = "";
      p.stdout.on("data", (c) => (out += c));
      p.on("exit", () => res({ t0, t1: Date.now(), status: 200, body: out.slice(0, 300) }));
    });
  }

  // ---------- R7a · Pay what you owe in two tabs ----------
  const R7a = (W) => race("r7a-pay-owed-two-tabs", "R7 · Pay what you owe in two tabs at once", async () => {
    const dev = await L.account(`pm-devr7${Date.now() % 1000}`, "Sam Ortiz", "developer");
    await L.addCard(dev, "4000 0000 0000 0341");
    const t = await mkTest(dev, "Race R7");
    const a = await joinWritten(W.ana, t);
    const r = await post(dev, "/api/review", { kind: "submission", id: a.sub, amount: "10.00", tickedCents: 1000, payKey: crypto.randomUUID(), seenAt: now(), confirmed: true });
    log("declined Pay:", r.status);
    await L.addCard(dev, CARD_OK);
    const pr = await L.pairTabs(dev, dev, "R7 · Pay what you owe ($10.00) in two tabs at once", [W.ana]);
    const [p1, p2] = pr.apps;
    await openPage(p1, "/app/payments", "#owed"); await openPage(p2, "/app/payments", "#owed");
    await capWait(p1, "Sam owes $10.00 (a declined Pay; his card is now 4242). Both tabs press Pay what you owe at the same moment.", 1500);
    const btn = (p) => p.locator("#owed button").filter({ hasText: /Pay what you owe|Pay \$/ }).first();
    return {
      pr, stripeDev: dev, an: "Tab 1", bn: "Tab 2",
      A: clickWatched(p1, btn(p1), /\/api\/payments\/owed/), B: clickWatched(p2, btn(p2), /\/api\/payments\/owed/),
      after: async (f) => {
        await p1.waitForTimeout(4000);
        const n = Number(sql(`select count(*) from "Payment" where "developerId" = ${lit(dev.uid)} and kind = 'owed' and status in ('bundled','charged')`));
        const cap = `${order(f, "Tab 1", "Tab 2")}. Tab 1: ${msg(f.ra)}. Tab 2: ${msg(f.rb)}. One payment.`;
        await capWait(p1, cap, 2500); await capWait(p2, cap, 4500);
        return { n };
      },
      judge: (f, r) => ({ good: r.n === 1, text: `Tab 1: “${msg(f.ra)}”; tab 2: “${msg(f.rb)}”. One payment at Stripe ($10.00 Succeeded).`, bug: `${r.n} payments` }),
    };
  });

  // ---------- R9 · an old tab's Confirm with your bank vs a payment hold starting ----------
  async function holdWorld(W, key) {
    const dev = await L.account(`pm-devr9${key}${Date.now() % 1000}`, "Vera Long", "developer");
    await L.addCard(dev, CARD_ASK, { tds: true });
    const cid = await L.account(`pm-cid9${key}${Date.now() % 1000}`, "Cid Moreau", "tester");
    const t = await mkTest(dev, `Race R9${key}`);
    const c = await joinWritten(cid, t), b = await joinWritten(W.ben, t);
    openChoice(c.sub, t); openChoice(b.sub, t);
    sql(`update "Test" set "openUntil" = (now() at time zone 'utc') + interval '10 days' where id = ${lit(t)}`);
    await chargeApiNow(cid, c.s, c.sub); await chargeApiNow(W.ben, b.s, b.sub);
    await L.waitAction(c.sub); await L.waitAction(b.sub);
    const cPay = sql(`select id from "Payment" where "submissionId" = ${lit(c.sub)} order by "createdAt" desc limit 1`);
    // (Ben's 3 days are run out only right before the race: a page load runs the same clock and would start the hold before it.)
    const expireBen = () => sql(`update "Payment" set "actionBy" = (now() at time zone 'utc') - interval '1 minute' where "submissionId" = ${lit(b.sub)} and "actionPi" is not null`);
    return { dev, cid, t, c, b, cPay, expireBen };
  }
  async function R9(W, confirmFirst) {
    const key = confirmFirst ? "a" : "b";
    const name = `r9${key}-confirm-vs-hold-${confirmFirst ? "confirm-first" : "hold-first"}`;
    const X = await holdWorld(W, key);
    const sel = `[data-bank-waiting="${X.cPay}"]`;
    const pr = await L.pairTabs(X.dev, X.dev, `R9 · An old tab's Confirm with your bank vs a payment hold starting (${confirmFirst ? "Confirm first" : "hold first"})`, [X.cid, W.ben], 1, { viewport: { width: 1100, height: 900 } });
    const p = pr.apps[0];
    await openPage(p, `/app/tests/${X.t}`, sel);
    await capWait(p, "Cid's $10.00 charge waits for Vera's bank. Ben's charge ran out of its 3 days: the clock's next run declines it and starts a payment hold.", 2000);
    const A = clickWatched(p, p.locator(`${sel} button`).first(), /\/api\/payments\/confirm/);
    X.expireBen();
    const B = () => appfnAsync("expire");
    const f = await fire(A, B, confirmFirst ? 150 : -2500);
    await p.waitForTimeout(2500);
    const opened = (await p.locator("[data-bank-check]").count()) > 0;
    let after = "";
    if (opened) {
      await capWait(p, `${order(f, "Vera's Confirm", "the hold (the clock)")}. The bank's page opened; the hold then cancels this check at Stripe. Complete…`, 1500);
      await L.threeDS(p, true, 20000);
      await p.waitForTimeout(6000);
      after = (await p.locator(`${sel}, [data-bank-not-confirmed], [data-refusal]`).first().innerText().catch(() => "")).replace(/\s+/g, " ");
    } else after = msg(f.ra);
    const st = sql(`select status from "Payment" where id = ${lit(X.cPay)}`);
    const hold = sql(`select coalesce("holdReason",'') from "User" where id = ${lit(X.dev.uid)}`);
    await capWait(p, `${order(f, "Vera's Confirm", "the hold (the clock)")}. Vera saw: “${after}”. Cid's charge: ${st}; hold: ${hold || "none"}.`, 6000);
    await L.pairVideo(pr, name, "", "R");
    const s = L.stripeOut(X.dev, name, "R");
    const charged = s.paymentIntents.filter((x) => x.status === "succeeded").length;
    return verdict(name, `R9${key} · An old tab's Confirm with your bank vs a payment hold starting (${confirmFirst ? "Confirm first" : "hold first"})`,
      `${order(f, "Vera's Confirm", "the hold (the clock declining Ben's expired charge)")}. ${opened ? "The bank's page opened, then the hold cancelled that check at Stripe; Complete charged nothing" : "The Confirm was answered after the hold started"}: Vera saw “${after}”. Cid's charge is ${st} (it waits for the lift); hold: ${hold || "none"}; Stripe: ${charged} succeeded.`,
      hold === "unpaid" && charged === 0 && st !== "charged", `charge ${st}; hold ${hold}; succeeded ${charged}`);
  }

  // ---------- R10 · Complete on Pay's bank page vs saving a new card ----------
  async function R10(W, completeFirst) {
    const key = completeFirst ? "a" : "b";
    const name = `r10${key}-complete-vs-new-card-${completeFirst ? "complete-first" : "save-first"}`;
    const dev = await L.account(`pm-devr10${key}${Date.now() % 1000}`, "Kai Brooks", "developer");
    await L.addCard(dev, CARD_ASK, { tds: true });
    const t = await mkTest(dev, `Race R10${key}`);
    const a = await joinWritten(W.ana, t);
    const pr = await L.pairTabs(dev, dev, `R10 · Complete on Pay's bank page vs a new card saved in another tab (${completeFirst ? "Complete first" : "save first"})`, [W.ana]);
    const [p1, p2] = pr.apps;
    await openPage(p1, `/app/tests/${t}`);
    await L.addCardOnce(p2, CARD_OK, { hold: true });
    p2.mark = Date.now();
    const box = await fillPay(p1, a.sub, 1000);
    await payButton(box).click();
    await p1.locator("[data-bank-check]").first().waitFor({ timeout: 30000 }).catch(() => {});
    await p1.waitForTimeout(2500);
    await capWait(p1, "Tab 1: Pay $10.00 — the bank's page is open (card 3184). Tab 2: a new card (4242) typed in Stripe Checkout.", 1500);
    const doComplete = async () => { const s = Date.now(); await L.threeDS(p1, true, 20000); return { t0: s, t1: Date.now(), status: 200 }; };
    const doSave = async () => { const s = Date.now(); await p2.saveCard(); await p2.waitForURL(/localhost:3517/, { timeout: 60000 }).catch(() => {}); return { t0: s, t1: Date.now(), status: 200 }; };
    const f = await fire(doComplete, doSave, completeFirst ? 400 : -3000);
    await p1.waitForTimeout(6000);
    const line = (await p1.locator("[data-bank-not-confirmed], [data-stop-box], [data-refusal], [data-pay-box]").first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    const pays = sql(`select coalesce(string_agg(status, ','), '') from "Payment" where "submissionId" = ${lit(a.sub)}`);
    const saved = sql(`select coalesce("stripePaymentMethodId", '') from "User" where id = ${lit(dev.uid)}`);
    await capWait(p1, `${completeFirst ? "Complete" : "The card save"} went first (by ${f.gap} ms). Tab 1 shows: “${line}”. Payment: ${pays}.`, 8000);
    await L.pairVideo(pr, name, "", "R");
    const s = L.stripeOut(dev, name, "R");
    const ok10 = s.paymentIntents.filter((x) => x.status === "succeeded").length;
    const good = completeFirst ? ok10 === 1 && /charged/.test(pays) && !/cancelled: nothing was charged/.test(line) : ok10 === 0 && /cancelled/.test(pays);
    return verdict(name, `R10${key} · Complete on Pay's bank page vs a new card saved in another tab (${completeFirst ? "Complete first" : "save first"})`,
      `${completeFirst ? "Complete" : "The new card's Save"} was pressed first (${f.gap} ms apart). ${completeFirst ? `The payment went through on the old card and is recorded paid once (Stripe: ${ok10} Succeeded); tab 1 shows “${line}” (no “cancelled”).` : `The save cancelled the open check at Stripe first; Complete then charged nothing: tab 1 shows “${line}”; the part is payable again (Stripe: ${ok10} Succeeded).`} Card saved: ${saved ? "yes" : "no"}.`,
      good, `payments: ${pays}; succeeded: ${ok10}; line: ${line}`);
  }

  return { R7a, R9a: (W) => R9(W, true), R9b: (W) => R9(W, false), R10a: (W) => R10(W, true), R10b: (W) => R10(W, false) };
};
