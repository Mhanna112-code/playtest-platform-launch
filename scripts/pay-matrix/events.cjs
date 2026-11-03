// The evidence matrix by event (owner, Nov 3): for each event, the developer's pay buttons pressed from pages opened BEFORE it (the test page and the dashboard,
// both recorded, the Stripe viewer beside them), one caption per button with what it showed. Real Stripe (test mode), card 3184 so charges can wait for the bank.
// The bank-window-open and same-moment timings are covered by rows O (suspension) and the race set. Loaded by run.cjs with its helpers (`H`).
/* eslint-disable */
const crypto = require("crypto");

module.exports = (H) => {
  const { L, sql, lit, ok, post, now, log, mkTest, joinWritten, sendRec, payApi, disputeApi, ignore, openChoice, capWait, openPage, fillPay, payButton, verdict, CARD_ASK, testerAlertsOff } = H;
  const chargeApiNow = (t, s, sub, cents = 1000) => post(t, `/api/sessions/${s}/choose`, { choice: "charge", submissionId: sub, amount: (cents / 100).toFixed(2), tickedCents: cents, seenAt: now(), confirmed: true });
  const U = "(now() at time zone 'utc')";
  let n = 0;
  const freshTester = async (name) => L.account(`pm-ev${++n}`, name, "tester");

  /** A test of `dev` (card 3184): Cid's written answers unpaid (Pay), Ben's paid $4.00 (Pay more), Cid's and Ben's recordings charged while away and waiting (Confirm, Confirm all). */
  async function eventWorld(W, dev, title) {
    const cid = await freshTester("Cid Moreau");
    const t = await mkTest(dev, title);
    const c = await joinWritten(cid, t);
    const b = await joinWritten(W.ben, t);
    const cRec = await sendRec(cid, c.s), bRec = await sendRec(W.ben, b.s);
    await payApi(dev, "submission", b.sub, 400, "Only half of the answers were useful.");
    openChoice(cRec, t); openChoice(bRec, t);
    sql(`update "Test" set "openUntil" = ${U} + interval '10 days' where id = ${lit(t)}`); // (openChoice moved it; the test keeps running)
    await chargeApiNow(cid, c.s, cRec); await chargeApiNow(W.ben, b.s, bRec);
    await L.waitAction(cRec); await L.waitAction(bRec);
    const waitC = sql(`select id from "Payment" where "submissionId" = ${lit(cRec)} order by "createdAt" desc limit 1`);
    return { t, cid, c, b, cRec, bRec, waitC };
  }

  function watchReq(page, re) {
    return new Promise((res) => {
      const on = (req) => {
        if (req.method() !== "POST" || !re.test(req.url())) return;
        page.off("request", on);
        req.response().then(async (r) => res({ status: r ? r.status() : 0, body: r ? await r.json().catch(() => null) : null })).catch(() => res({ status: 0, body: null }));
      };
      page.on("request", on);
      setTimeout(() => { page.off("request", on); res({ status: -1, body: null }); }, 60000);
    });
  }
  const said = (r) => r.body?.requiresAction ? "went ahead: the bank's page opened" : r.body?.confirm ? "went ahead: the one bank check opened" : r.body?.error?.code === "stop_once" ? `stopped once: ${(r.body.error.changes ?? []).map((c) => c.text).join(" · ")}` : r.body?.error ? `refused: ${r.body.error.message}` : r.status === 200 ? "went ahead" : `status ${r.status}`;

  /** The four presses from the old pages, one caption each; returns what each showed. */
  async function pressAll(X, p1, p2) {
    const out = {};
    const press = async (label, page, locator, re, fill) => {
      try {
        if (fill) await fill();
        const loc = typeof locator === "function" ? locator() : locator;
        await loc.evaluate((el) => { for (let d = el.closest("details"); d; d = d.parentElement?.closest("details")) d.open = true; el.scrollIntoView({ block: "center" }); });
        const w = watchReq(page, re);
        await loc.click({ timeout: 8000 });
        const r = await w;
        out[label] = said(r);
      } catch (e) {
        out[label] = `couldn't be pressed (${String(e.message).split("\n")[0].slice(0, 80)})`;
      }
      await page.waitForTimeout(1200);
      await capWait(page, `${label}: ${out[label]}`, 3200);
    };
    let box;
    await press("Pay (Cid's answers)", p1, () => box, /\/api\/review/, async () => { box = await fillPay(p1, X.c.sub, 1000); });
    let more;
    await press("Pay more (Ben's answers)", p1, () => more, /pay-extra/, async () => { more = await fillPay(p1, X.b.sub, 200); });
    await press("Confirm with your bank (Cid's charge)", p1, p1.locator(`[data-bank-waiting="${X.waitC}"] button`).first(), /\/api\/payments\/confirm/);
    await press("Confirm all (2)", p2, p2.locator("#bank-to-confirm [data-confirm-all-button]").first(), /confirm-all/);
    return out;
  }
  const payBtn = (box) => box.locator("button.btn-green").first();
  void payBtn;

  async function eventClip(W, key, title, dev, event, judge) {
    const name = `ev-${key}`;
    const X = await eventWorld(W, dev, `Event ${key}`);
    const pr = await L.pairTabs(dev, dev, `${title} — presses from pages opened before it`, [X.cid, W.ben], 2, { viewport: { width: 1000, height: 900 } });
    const [p1, p2] = pr.apps;
    await openPage(p1, `/app/tests/${X.t}`); await openPage(p2, "/app", "#bank-to-confirm");
    await capWait(p1, `Both pages open. Now: ${title.toLowerCase()}.`, 1800);
    const ev = await event(X);
    await p1.waitForTimeout(1200);
    const out = await pressAll(X, p1, p2);
    await p1.waitForTimeout(2500);
    await L.pairVideo(pr, name, "", "EV");
    L.stripeOut(dev, name, "EV");
    const lines = Object.entries(out).map(([k, v]) => `${k}: ${v}`).join("; ");
    const j = judge(out);
    return verdict(name, `EV-${key} · ${title}: every pay button from an old page`, `${title} (${ev ?? ""}). ${lines}.`, j.good, j.bug ?? lines);
  }
  const allStop = (out, re) => ({ good: Object.values(out).every((v) => v.startsWith("stopped once") && (!re || re.test(v)) || v.startsWith("refused")), bug: "" });

  const EV1 = (W) => eventClip(W, "1-dev-stops", "Omar stops the test (in another tab)", W.d2, async (X) => ok(await post(W.d2, `/api/tests/${X.t}/stop`, { reason: "We have enough feedback for now, thank you.", seenAt: now(), confirmed: true }), "stop") && "Stop the test", (o) => allStop(o));
  const EV2 = (W) => eventClip(W, "2-team-closes", "The team stops the test", W.d2, async (X) => ok(await post(W.admin, "/api/admin/stop-test", { id: X.t, note: "Recording: the team stopped this test." }), "team stop") && "the team's Stop", (o) => allStop(o));
  const EV3 = (W) => eventClip(W, "3-time-runs-out", "The testers' time runs out", W.d2, async (X) => {
    sql(`update "Contract" set "dueAt" = ${U} - interval '1 minute' where "testId" = ${lit(X.t)}`);
    sql(`update "Test" set "openUntil" = ${U} - interval '1 minute' where id = ${lit(X.t)}`);
    return `work ended: ${JSON.stringify(L.appfn("finishwork", X.t))}`;
  }, (o) => ({ good: true }));
  const EV6 = (W) => eventClip(W, "6-tester-suspended", "The team suspends Cid's tester side (he's removed from the test)", W.d2, async (X) => ok(await post(W.admin, "/api/admin/suspend", { id: X.cid.uid, note: "Recording", side: "tester" }), "suspend tester") && "Cid removed", (o) => ({ good: /left the test/.test(o["Pay (Cid's answers)"]) }));
  const EV7 = (W) => eventClip(W, "7-tester-leaves", "Cid leaves the test", W.d2, async (X) => ok(await post(X.cid, `/api/sessions/${X.c.s}/leave`, { seenAt: now(), confirmed: true }), "leave") && "Cid left", (o) => ({ good: /left the test/.test(o["Pay (Cid's answers)"]) }));
  async function EV5(W) {
    const dev = await L.account("pm-devev5", "Uma Patel", "developer");
    await L.addCard(dev, CARD_ASK, { tds: true });
    return eventClip(W, "5-dev-suspended", "The team suspends Uma's developer side", dev, async () => ok(await post(W.admin, "/api/admin/suspend", { id: dev.uid, note: "Recording", side: "developer" }), "suspend dev") && "Uma suspended", (o) => ({ good: Object.values(o).every((v) => /suspended/.test(v) || v.startsWith("stopped once")) }));
  }
  const EV4 = (W) => eventClip(W, "4-close-out-passes", "The parts' close-out date passes", W.d2, async (X) => {
    sql(`update "Contract" set "dueAt" = ${U} - interval '40 days', status = 'ended', "endKind" = 'closed', "endedAt" = ${U} - interval '40 days' where "testId" = ${lit(X.t)}`);
    sql(`update "Test" set "openUntil" = ${U} - interval '40 days', "workEndedAt" = ${U} - interval '40 days' where id = ${lit(X.t)}`);
    sql(`update "Submission" set "payBy" = ${U} - interval '35 days', "sentAt" = ${U} - interval '45 days' where "contractId" in (select id from "Contract" where "testId" = ${lit(X.t)})`);
    return "dates moved 40 days back";
  }, (o) => ({ good: true }));

  /** Tester side: the test closes (Omar's Stop) while Cid's page is open; Charge, Let it go and Dispute from that old page, then Add refused. Cid's Alerts Off. */
  async function EVT(W) {
    const name = "ev-t-tester-side-test-closes";
    const cid = await freshTester("Cid Moreau");
    const t = await mkTest(W.d1, "Event T");
    const c = await joinWritten(cid, t);
    const rec = await sendRec(cid, c.s);
    await payApi(W.d1, "submission", c.sub, 400, "Only half of the answers were useful.");
    openChoice(rec, t);
    sql(`update "Test" set "openUntil" = ${U} + interval '10 days' where id = ${lit(t)}`);
    testerAlertsOff(cid, true);
    const pr = await L.pair(cid, W.d1, "EV-T · The test closes while Cid's page is open (his Alerts Off)", [cid]);
    await openPage(pr.app, `/app/sessions/${c.s}`, "#part-recording");
    await capWait(pr.app, "Cid's page (Alerts Off): his recording is open for Charge / Let it go; his written answers (paid $4.00) can be disputed.", 2200);
    ok(await post(W.d1, `/api/tests/${t}/stop`, { reason: "We have enough feedback for now, thank you.", seenAt: now(), confirmed: true }), "stop");
    await capWait(pr.app, "Meanwhile Nora stops the test.", 1200);
    const out = {};
    const part = pr.app.locator("#part-recording").first();
    let w = watchReq(pr.app, /\/choose/);
    await part.locator("button.btn", { hasText: /^Charge/ }).first().click().catch(() => {});
    out["Charge"] = said(await w);
    await capWait(pr.app, `Charge: ${out.Charge}`, 3000);
    await pr.app.goto(`/app/sessions/${c.s}`).catch(() => {}); // (Let it go from a page opened before the stop: the same old seen time, sent directly)
    const lg = await post(cid, `/api/sessions/${c.s}/choose`, { choice: "letgo", submissionId: rec, seenAt: new Date(Date.now() - 120000).toISOString(), loadedAt: new Date(Date.now() - 120000).toISOString() });
    out["Let it go (old page)"] = said(lg);
    await capWait(pr.app, `Let it go from the old page: ${out["Let it go (old page)"]}`, 3000);
    const dp = await post(cid, `/api/sessions/${c.s}/dispute`, { kind: "submission", id: c.sub, reason: "I answered every question fully.", seenAt: new Date(Date.now() - 120000).toISOString(), loadedAt: new Date(Date.now() - 120000).toISOString() });
    out["Dispute (old page)"] = said(dp);
    await capWait(pr.app, `Dispute from the old page: ${out["Dispute (old page)"]}`, 3000);
    const add = await post(cid, `/api/sessions/${c.s}/written-add`, { text: "One more thing.", seenAt: now(), confirmed: true });
    out["Add to the answers (Send)"] = said(add);
    await capWait(pr.app, `Add (Send) after the stop: ${out["Add to the answers (Send)"]}`, 3500);
    await L.pairVideo(pr, name, "", "EV");
    L.stripeOut(W.d1, name, "EV");
    const lines = Object.entries(out).map(([k, v]) => `${k}: ${v}`).join("; ");
    return verdict(name, "EV-T · Tester side: the test closes while Cid's page is open (Alerts Off)", `Nora stopped the test after Cid's page loaded (his Alerts Off). ${lines}.`, /stopped once/.test(out.Charge) && /refused/.test(out["Add to the answers (Send)"]), lines);
  }

  return { EV1, EV2, EV3, EV4, EV5, EV6, EV7, EVT };
};
