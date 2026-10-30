// ---------- (Oct 29 late media run, part q: screenshots only, desktop) Batch 29, Calls: paying, and the owner's leftovers ----------
{
  const B29 = "Batch 29 (Oct 29)", CP = "Calls: paying", CAPS = "Caps", B28 = "Batch 28 (Oct 29)", B27 = "Batch 27 (Oct 29)", B26 = "Batch 26 (Oct 29)";
  const patient = () => {
    if (browser._patient) return;
    browser._patient = true;
    const orig = browser.newContext.bind(browser);
    browser.newContext = async (o) => {
      const c = await orig(o);
      const st = c.setDefaultTimeout.bind(c), sn = c.setDefaultNavigationTimeout.bind(c);
      c.setDefaultTimeout = (ms) => st(Math.max(ms, 30000));
      c.setDefaultNavigationTimeout = (ms) => sn(Math.max(ms, 180000));
      return c;
    };
  };
  const again = async (fn, what) => {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) {
        if (i >= 2) throw e;
        console.log(`   (retrying ${what}: ${String(e.message || e).split("\n")[0].slice(0, 120)})`);
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  };
  const acct = async (email, ...rest) => {
    for (let i = 0; ; i++) {
      try { return await account(i ? email.replace("@", `r${i}@`) : email, ...rest); } catch (e) {
        if (i >= 2) throw e;
        console.log(`   (retrying the account: ${String(e.message || e).split(String.fromCharCode(10))[0].slice(0, 120)})`);
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  };
  const postT = (dev, over) => again(() => postTest(dev, over), "post a test");
  const subD = (dev) => again(() => subscribeDev(dev), "subscribe").catch((e) => console.log("   ! subscribe:", String(e.message).slice(0, 120)));
  const sendW = (t, s, a) => again(() => sendWritten(t, s, a), "send");
  const joinR = (t, id) => again(() => join(t, id), "join");
  const openR = (p, url, sel) => again(async () => { await p.goto(url, { timeout: 180000 }); if (sel) await p.waitForSelector(sel, { timeout: 60000 }); await pause(p, 700); }, "open " + url);
  const say = async (page, sel) => (await page.locator(sel).first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  const q = (s) => `“${s}”`;
  const utc = "(now() at time zone 'utc')";
  const payApi = async (dev, subId, dollars, reason = "") => {
    ensureCard(dev.email);
    const cents = Math.round(Number(dollars) * 100);
    return ok(await post(dev, "/api/review", { action: "pay", kind: "submission", id: subId, amount: dollars, reason, tickedCents: cents, over200: cents > 20000, payKey: require("crypto").randomUUID(), seenAt: nowIso(), confirmed: true }), "pay");
  };
  /** A step that may fail on its own without losing the rest of the group. */
  const step = async (what, fn) => { try { await fn(); } catch (e) { console.log(`   ! STEP FAILED (${what}):`, String(e.message || e).split("\n")[0].slice(0, 300)); } };
  // The page's own live checks (/api/live), so a change is made just after one and the press comes well before the next (as a person pressing within seconds).
  const watchPolls = (p) => {
    if (p._polls) return;
    p._polls = []; p._watchFrom = Date.now();
    p.on("framenavigated", (fr) => { if (fr === p.mainFrame()) { p._polls = []; p._watchFrom = Date.now(); } });
    p.on("request", (r) => { if (r.url().includes("/api/live?")) p._polls.push(Date.now()); });
  };
  /** Waits until 1.5-3 s after one of the page's checks (they repeat every ~20 s), so the next is far away. */
  const quiet = async (p) => {
    watchPolls(p);
    const end = Date.now() + 90000;
    while (Date.now() < end) {
      const last = p._polls[p._polls.length - 1];
      if (last && Date.now() - last >= 1500 && Date.now() - last < 3000) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    console.log("   ! no quiet moment on", p.url());
    return false;
  };
  const answered = (p, re) => p.waitForResponse((r) => re.test(r.url().split("?")[0]) && r.request().method() === "POST", { timeout: 120000 }).then(async (r) => ({ status: r.status(), body: await r.text().catch(() => "") }), () => null);
  /** A press and its answer; logs the answer. */
  const press = async (p, btn, re, name) => {
    const r = answered(p, re);
    await btn.click();
    const a = await r;
    console.log(`   ${name}: ${a ? a.status + " " + a.body.slice(0, 220) : "no answer"}`);
    return a;
  };
  /** After a refused press: follows the button and the kept line for up to 25 s; returns { goneMs, kept }. */
  const watchKept = async (p, btn) => {
    const t0 = Date.now();
    let goneMs = null, kept = "";
    while (Date.now() - t0 < 25000) {
      if (goneMs == null && !(await btn.isVisible().catch(() => false))) goneMs = Date.now() - t0;
      const k = p.locator("[data-kept-refusal]").first();
      if (await k.isVisible().catch(() => false)) { kept = (await k.innerText().catch(() => "")).replace(/\s+/g, " ").trim(); break; }
      if (goneMs != null && Date.now() - t0 > 11000) break;
      await p.waitForTimeout(150);
    }
    console.log(`   button gone: ${goneMs == null ? "never" : goneMs + " ms"}; kept line: ${kept || "none"}`);
    return { goneMs, kept };
  };

  // ---------- q0: files already recorded by the paused run (looked at one by one), and the bell stacks of batch 29 copied into its section ----------
  group("q0", async () => {
    const add = (file, caption, section) => { SEC = section; record(file, caption, file.endsWith(".webm") ? "video" : "image"); };
    add("cap-02-over-room.png", "Pay more over the room is refused | $10 and then $500 already paid on Ines's written answers: typing 600.00 in Pay more shows “This is more than this piece can be paid (up to $490 more, $1,000 in all).” in red under “up to $490.00 more ($1,000.00 in all)”.", CAPS);
    add("cap-03-dev-paid-most.png", "At the cap: the developer | After a last Pay more of $490, Ines's row reads “Sent Oct 29, 2026 · paid $1,000.00 of $10.00” and, where Pay more was, “Paid the most this piece can be paid ($1,000.00).”; “Paid in all: $1,000.00”.", CAPS);
    add("b28-08-01-reserved.png", "§8 Pay what you owe, reserved | During a chargeback hold the developer's Pay what you owe reserved the money: “Reserved $27.00: it's taken when the team approves lifting your hold.”", B28);
    add("b28-08-02-added-since.png", "§8 A Charge after the reservation | Jun charged for their written answers after the reservation: the dashboard box reads “Reserved $27.00: it's taken when the team approves lifting your hold. $10.00 added since will be charged right after.”, lists “Jun Abara's written answers $10.00 · charged by the tester while your tests were paused” and offers “Pay what you owe ($10.00)”.", B28);
    add("b28-08-03-admin-row.png", "§8 The admin's row: Approve still works | The hold row reads “Chargeback hold: card verified ✓, owed reserved ✓ ($27.00 reserved · $10.00 added since (charged after the hold lifts))”, with Approve and “Don't approve: release the reservation”; the added $10 doesn't block Approve.", B28);
    // Batch 29 §21-§31: the stacks were recorded for "Bell and emails"; the same pictures are listed here under their batch 29 items.
    const copy = (from, to, caption) => { fs.copyFileSync(path.join(OUT, from), path.join(OUT, to)); add(to, caption, B29); };
    copy("bell-01-dev-list.png", "b29-22-01-dev-stacks.png", "§22, §31 The developer's new stacks | Vera's bell: “Closing soon: 4 pieces close by Nov 5 (Kit's written answers on “Sky Lab: tutorial”, …)”, “Pay now: 4 pieces on 2 tests: their testers can charge or let them go (the first closes Nov 1)”, “Ratings to give · 2 updates today” and “Payments and holds · 2 updates today” (“Your bank wants you to confirm 2 payments ($22.00 in all): the first by Nov 1”).");
    copy("bell-05-tester-list.png", "b29-22-02-tester-stacks.png", "§21-§24 The tester's new stacks | Kit's bell: “Ratings to give · 4 updates today”, “Charge or let go: 2 pieces on 2 tests (the first closes Nov 1)”, “Applications and invites · 3 updates today” and “Joined · 2 updates today”.");
    copy("bell-06-tester-stacks.png", "b29-23-01-applications-joined.png", "§23, §24 Applications and invites, Joined, expanded | Under “Applications and invites · 3 updates today”: “Vera Holt updated “Lumen Notes private beta”: your invite was sent again on the new listing.” and two “…'s listing changed, so your application was closed. You can apply again on the current listing.” lines from two tests; under “Joined · 2 updates today”: “Your application to “Glow Garden: night levels” wasn't accepted” and “You're in: Night Market demo”. Each line opens its own page.");
    copy("bell-number-01-three-lines.png", "b29-28-01-bell-number.png", "§28 The bell's number counts entries | Three testers joined “Harbor Run: first 3 levels”: one stack, “Harbor Run: first 3 levels · 3 updates today”, with 3 unread lines, and the bell's number reads 1.");
    copy("bell-number-02-expanded.png", "b29-28-02-expanded.png", "§28 Read only when opened | Expanding the stack shows “Ola Brandt joined …”, “Jun Abara joined …” and “Kit Moreau joined “Harbor Run: first 3 levels””, marks them read, and the bell shows no number any more.");
  }, { section: B29 });

  // ---------- q1: Batch 29 §11 (stopped tests keep stop-once), §36 (the refusal line kept where the button was), §38 (the $1,000 in all) ----------
  group("q1", async () => {
    patient();
    const yara = await acct(`dev+media${TS}q1@playtest.test`, "Yara Quint", "developer", "they");
    await subD(yara);
    ensureCard(yara.email);
    const names = ["Zed Okoro", "Lena Fisk", "Mia Sorel", "Nia Brook", "Owen Hale", "Ivo Marr"];
    const T = {};
    for (const n of names) T[n.split(" ")[0]] = await acct(`tester+media${TS}q1${n[0].toLowerCase()}@playtest.test`, n, "tester", "they");
    const t = await postT(yara, { title: "Tidewater: harbor levels", productName: "Tidewater", writtenCents: "10.00", spots: "6" });
    const S = {};
    for (const k of Object.keys(T)) S[k] = await joinR(T[k], t);
    for (const k of ["Zed", "Lena", "Nia", "Owen", "Ivo"]) await sendW(T[k], S[k]);
    const sub = {};
    for (const k of ["Zed", "Lena", "Nia", "Owen", "Ivo"]) sub[k] = subOf(S[k]);

    // §38 a piece's cap is the part's max in all: the Pay box hint, the refusal, the paid-most lines.
    await step("caps", async () => {
      await openR(yara, `/app/tests/${t}`, `#piece-${sub.Ivo}`);
      const box = yara.locator(`#piece-${sub.Ivo}`);
      console.log("   Ivo box:", await say(yara, `#piece-${sub.Ivo}`));
      await shot(yara, "b29-38-01-pay-hint", "§38 The Pay box: $1,000 in all | Ivo's written answers ($10.00 listing): the Amount box starts at 10.00 with the hint “up to $1,000.00 in all” beside it.", `#piece-${sub.Ivo}`);
      const amt = box.locator("input[inputmode], input[type=text], input[type=number]").first();
      await amt.fill("");
      await amt.pressSequentially("1200", { delay: 60 });
      await pause(yara, 900);
      console.log("   Ivo over:", await say(yara, `#piece-${sub.Ivo}`));
      const over = await say(yara, `#piece-${sub.Ivo} [data-over-cap]`);
      await shot(yara, "b29-38-02-pay-over", `§38 Over $1,000 in all is refused | Typing 1200 in the Pay box: ${q(over || "(see the picture)")} in red, and Pay doesn't go.`, `#piece-${sub.Ivo}`);
      await payApi(yara, sub.Ivo, "1000.00");
      await openR(yara, `/app/tests/${t}`, `#tester-${S.Ivo}`);
      const most = await say(yara, `#tester-${S.Ivo} [data-paid-most]`);
      console.log("   Ivo row:", await say(yara, `#tester-${S.Ivo}`));
      await shot(yara, "b29-38-03-paid-most", `§38 At the cap: the developer | Ivo's answers paid $1,000.00 in one Pay: the row reads ${q(most || "(see the picture)")} where Pay more was.`, `#tester-${S.Ivo}`);
      const ivo = T.Ivo;
      await openR(ivo, `/app/sessions/${S.Ivo}`, "#part-written");
      const line = await say(ivo, "#part-written [data-pay-more-state]");
      console.log("   Ivo part:", await say(ivo, "#part-written"));
      await shot(ivo, "b29-38-04-tester-most", `§38 At the cap: the tester | Ivo's written answers: ${q(line || "(see the picture)")}`, "#part-written");
    });

    // §36 (a) Pay after another tab paid: the first press stops once, the second is refused, the line stays where the Pay box was.
    await step("pay after another tab", async () => {
      const P = await same(yara);
      await openR(P, `/app/tests/${t}`, `#piece-${sub.Zed}`);
      const payBtn = P.locator(`#piece-${sub.Zed} button`, { hasText: /^Pay$/ }).first();
      await payBtn.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await P.locator(`#piece-${sub.Zed} [data-pay-tick] input`).first().check();
      await quiet(P);
      await payApi(yara, sub.Zed, "10.00");
      const a1 = await press(P, payBtn, /api\/review$/, "pay 1");
      if (a1 && /stop_once/.test(a1.body)) {
        await P.locator(`#piece-${sub.Zed} [data-stop-box]`).first().waitFor({ timeout: 15000 }).catch(() => {});
        await pause(P, 700);
        const st = await say(P, `#piece-${sub.Zed} [data-stop-box]`);
        await shot(P, "b29-12-01-pay-stops", `§12 Your own Pay in another tab stops Pay once | Zed's answers were paid in another tab a moment before: “Your Pay on Zed Okoro's written answers didn't go through.” Since you opened this page: ${q((/You paid Zed[^·]+· [0-9:]+ [AP]M/.exec(st) || [st])[0])} and “Press Pay again to go ahead.”`, `#piece-${sub.Zed} [data-stop-box]`);
        await press(P, payBtn, /api\/review$/, "pay 2");
      }
      const w = await watchKept(P, payBtn);
      await pause(P, 300);
      await shot(P, "b29-36-01-pay-refused", w.kept ? `§36 The refusal stays where Pay was | The second Pay was refused (already paid in the other tab); the page redrew without the Pay box ${w.goneMs != null ? `(${(w.goneMs / 1000).toFixed(1)} s after the answer)` : ""} and the line ${q(w.kept)} stays where the button was.` : `§36 Pay refused after another tab paid | The second Pay was refused; ${w.goneMs == null ? "the Pay box was still on the page 25 s later" : "the page redrew without the Pay box"} and no kept line showed (see the picture).`);
      await P.context().close();
    });

    // §36 (b) Charge after the developer paid elsewhere.
    await step("charge after pay", async () => {
      openCharge(S.Lena, t);
      own(`update "Test" set "openUntil" = ${utc} + interval '10 days' where id = '${t}'`);
      const C = await same(T.Lena);
      await openR(C, `/app/sessions/${S.Lena}`, "#part-written");
      const chargeBtn = C.locator("button", { hasText: /^Charge / }).first();
      await chargeBtn.waitFor({ timeout: 60000 });
      await chargeBtn.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await quiet(C);
      await payApi(yara, sub.Lena, "10.00");
      const a1 = await press(C, chargeBtn, /choose$/, "charge 1");
      if (a1 && /stop_once/.test(a1.body)) {
        await pause(C, 1200);
        await shot(C, "b29-13-00-charge-stops", `§13 Charge stops once for the developer's payment | ${q(await say(C, "[data-stop-box]"))}`, "#part-written");
        await press(C, chargeBtn, /choose$/, "charge 2");
      }
      const w = await watchKept(C, chargeBtn);
      await shot(C, "b29-36-02-charge-refused", w.kept ? `§36 The refusal stays where Charge was | Lena's Charge, on a page opened before Yara paid elsewhere, is refused; the page redrew without the Charge box and ${q(w.kept)} stays where the button was.` : `§36 Charge refused after the developer paid | Lena's Charge is refused; ${w.goneMs == null ? "App bug: 25 s later the Charge box and its buttons were still on the page (no redraw)" : "the page redrew without the Charge box, with no kept line"} (see the picture).`);
      await C.context().close();
    });

    // §36 (c) Withdraw on a request the developer has just declined.
    await step("withdraw", async () => {
      const when = localAt(3, 15, 0);
      ok(await post(T.Zed, `/api/sessions/${S.Zed}/request-time`, { ...go, minutes: 30, times: [when.toISOString()] }), "tester's request");
      const reqId = sql(`select id from "CallRequest" where "contractId" = '${S.Zed}' and status = 'pending' order by "createdAt" desc limit 1`);
      const W = await same(T.Zed);
      await openR(W, `/app/sessions/${S.Zed}`, `#req-${reqId}`);
      const wBtn = W.locator(`#req-${reqId} button`, { hasText: /^Withdraw$/ });
      await wBtn.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await quiet(W);
      ok(await post(yara, `/api/tests/${t}/answer-request`, { ...go, requestId: reqId, contractId: S.Zed, action: "decline" }), "decline");
      const a = await press(W, wBtn, /answer-request$/, "withdraw");
      if (a && /stop_once/.test(a.body)) { await pause(W, 800); await shot(W, "b29-11-00-withdraw-stops", `Withdraw stops once | ${q(await say(W, "[data-stop-box]"))}`); await press(W, wBtn, /answer-request$/, "withdraw 2"); }
      const w = await watchKept(W, wBtn);
      await shot(W, "b29-36-03-withdraw-refused", w.kept ? `§36 Withdraw on a closed request (the line says “Answer”) | Zed's request was declined by Yara a moment before; Withdraw is refused, the request leaves the list (“No call requests waiting.”) and ${q(w.kept)} stays where Withdraw was. App bug: the kept line names the press “Answer” instead of “Withdraw”.` : `§36 Withdraw on a closed request | Withdraw is refused; ${w.goneMs == null ? "the Withdraw button was still there 25 s later" : "the row redrew without Withdraw"} and no kept line showed (see the picture).`);
      await W.context().close();
    });

    // §36 (d) Send after the test stopped, and §11: the stop itself stops Nia's Charge once; the developer's page on the stopped test stops Pay once for Nia's Charge.
    await step("stop", async () => {
      openCharge(S.Nia, t);
      own(`update "Test" set "openUntil" = ${utc} + interval '10 days' where id = '${t}'`);
      const M = await same(T.Mia), N = await same(T.Nia);
      await openR(M, `/app/sessions/${S.Mia}`, "#a0");
      await M.locator("#a0").fill("The harbor music is lovely and the boat steers well.");
      await M.locator("#a1").fill("I got stuck at the second bridge: the sign is hard to read.");
      const sBtn = M.locator("button", { hasText: /^Send my answers$/ }).first();
      await sBtn.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await openR(N, `/app/sessions/${S.Nia}`, "#part-written");
      const nBtn = N.locator("button", { hasText: /^Charge / }).first();
      await nBtn.waitFor({ timeout: 60000 });
      await nBtn.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await quiet(N);
      await stopTest(yara, t);
      await N.bringToFront();
      const n1 = await press(N, nBtn, /choose$/, "nia charge 1");
      await N.locator("[data-stop-box]").first().waitFor({ timeout: 20000 }).catch(() => {});
      await pause(N, 800);
      const nst = await say(N, "[data-stop-box]");
      if (nst) await shot(N, "b29-11-01-charge-stops-for-stop", nst ? `§11 On a stopped test, Charge still stops once | Nia's page was opened before Yara stopped the test: the first Charge stops once: “Your Charge didn't go through.” Since you opened this page: ${q((/Yara Quint stopped this test at [0-9:]+ [AP]M./.exec(nst) || [nst])[0])}, with “Turn off alerts” and “Press Charge again to go ahead.”` : `§11 Charge on a stopped test | The first Charge from a page opened before the stop: ${n1 ? n1.body.slice(0, 160) : "no answer"} (see the picture).`, "#part-written");
      const a = await press(M, sBtn, /written$/, "send");
      if (a && /stop_once/.test(a.body)) { await pause(M, 800); await shot(M, "b29-11-00-send-stops", `Send stops once | ${q(await say(M, "[data-stop-box]"))}`); await press(M, sBtn, /written$/, "send 2"); }
      const w = await watchKept(M, sBtn);
      await pause(M, 500);
      await shot(M, "b29-36-04-send-refused", w.kept ? `§36 Send after the test stopped | Mia's answers, typed on a page opened before Yara stopped the test: Send is refused, the page redraws as stopped and ${q(w.kept)} stays where Send was.` : `§36 Send after the test stopped | Mia's answers, typed on a page opened before Yara stopped the test: Send is refused and the page reloads at its top, where the stopped box names the press: ${q((await say(M, "main .info, main [role=status]")).split(" “")[0] || "(see the picture)")}; no separate kept line, since the box at the top says it.`);
      // §11: Nia's page was opened before the stop.
      const D = await same(yara);
      await openR(D, `/app/tests/${t}`, `#piece-${sub.Owen}`);
      const payBtn = D.locator(`#piece-${sub.Owen} button`, { hasText: /^Pay$/ }).first();
      await payBtn.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await D.locator(`#piece-${sub.Owen} [data-pay-tick] input`).first().check();
      await quiet(D);
      if (nst) await press(N, nBtn, /choose$/, "nia charge 2");
      await pause(N, 1500);
      const d1 = await press(D, payBtn, /api\/review$/, "owen pay 1");
      await D.locator(`#piece-${sub.Owen} [data-stop-box]`).first().waitFor({ timeout: 20000 }).catch(() => {});
      await pause(D, 800);
      const dst = await say(D, `#piece-${sub.Owen} [data-stop-box]`);
      if (dst) await shot(D, "b29-11-02-pay-stops-stopped-test", dst ? `§11 The developer on a stopped test | Yara's test page, opened after the stop: Nia charged meanwhile, and Pay on Owen's answers stops once: “Your Pay on Owen Hale's written answers didn't go through.” Since you opened this page: “Nia Brook charged $10.00 for their written answers”, “Don't stop me for: Payments (going through or failing)” and “Press Pay again to go ahead.”` : `§11 The developer on a stopped test | Pay on Owen's answers after Nia's Charge: ${d1 ? d1.body.slice(0, 160) : "no answer"} (see the picture).`, `#piece-${sub.Owen}`);
      if (dst) {
        await press(D, payBtn, /api\/review$/, "owen pay 2");
        await pause(D, 2500);
      }
      await openR(N, `/app/sessions/${S.Nia}`, "#part-written");
      if (nst) await shot(N, "b29-11-03-charged-after-stop", "§11 The second press goes ahead | Nia's part after the second Charge on the stopped test: “Paid $10.00: you get $8.00 (…) · “Charged by the tester after 7 days without a review.”” and “Yara Quint has paid $10.00 for this. It can be paid more, up to $1,000.00 in all.”", "#part-written");
    });
  }, { section: B29, fake: true });

  // ---------- q2: Batch 29 §12, §13: your own changes in another tab stop Edit's Save, the test page, the session page and the join page once ----------
  group("q2", async () => {
    patient();
    const dev = await acct(`dev+media${TS}q2@playtest.test`, "Odile Marsh", "developer", "they");
    await subD(dev);
    ensureCard(dev.email);
    const pim = await acct(`tester+media${TS}q2p@playtest.test`, "Pim Achebe", "tester", "they");
    const sol = await acct(`tester+media${TS}q2s@playtest.test`, "Sol Varga", "tester", "they");
    const kit = await acct(`tester+media${TS}q2k@playtest.test`, "Kit Moreau", "tester", "they");
    const t = await postT(dev, { productName: "Lantern Bay", title: "Lantern Bay: harbor tour", writtenCents: "10.00", liveRateCents: "30.00", spots: "4" });
    const tApp = await postT(dev, { productName: "Lantern Bay", title: "Lantern Bay: night market", joinMode: "apply", writtenCents: "10.00", spots: "4" });
    const sP = await joinR(pim, t), sS = await joinR(sol, t);
    await sendW(pim, sP, ["The lighthouse view is lovely.", "The market streets all look the same."]);
    await sendW(sol, sS, ["The boat ride felt smooth.", "I lost the path after the bridge."]);
    const subP = subOf(sP), subS = subOf(sS);
    sql(`delete from "KeptForm" where key = 'test:edit:${t}' and "userId" = '${dev.uid}'`);

    await step("edit save", async () => {
      const E = await same(dev);
      await openR(E, `/app/tests/${t}/edit`, "#spots");
      await E.locator("#description").click();
      await E.keyboard.press("End");
      await E.keyboard.type(" Start at the lighthouse.", { delay: 10 });
      if (await E.locator("#payRulesOk").count()) await E.locator("#payRulesOk").check().catch(() => {});
      await saveBtn(E).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
      await quiet(E);
      await payApi(dev, subP, "10.00");
      const a = await press(E, saveBtn(E).first(), /edit$/, "save 1");
      await E.locator("[data-stop-box]").first().waitFor({ timeout: 20000 }).catch(() => {});
      await pause(E, 800);
      const st = await say(E, "[data-stop-box]");
      await shot(E, "b29-12-02-edit-save-stops", st ? `§12 Edit's Save stops once for your own Pay in another tab | ${q(st)}` : `§12 Edit's Save after a Pay in another tab | ${a ? a.body.slice(0, 160) : "no answer"} (see the picture).`, st ? E.locator("[data-stop-box]").first().locator("xpath=..") : undefined);
      if (st) {
        await press(E, saveBtn(E).first(), /edit$/, "save 2");
        await E.waitForURL(/saved=1|\/app\/tests\/[^/]+$/, { timeout: 60000 }).catch(() => {});
        await pause(E, 1200);
        console.log("   after second save:", E.url());
      }
      await E.context().close();
    });

    await step("request after edit", async () => {
      const D = await same(dev);
      await openR(D, `/app/tests/${t}`, "#calls");
      await unfold(D, "#calls");
      await D.locator("#calls fieldset label", { hasText: "Sol Varga" }).locator("input").check();
      await D.locator("#calls [aria-label='Requested time 1']").fill(dtLocal(localAt(5, 11, 0)));
      await D.locator("#calls [aria-label='Length in minutes']").fill("30");
      const btn = D.locator("#calls button", { hasText: /^Request a time$/ }).first();
      await btn.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await quiet(D);
      await apiEdit(dev, t, { spots: "5" });
      await press(D, btn, /request-time$/, "request 1");
      const box = D.locator("#calls [data-stop-box]").first();
      await box.waitFor({ timeout: 20000 }).catch(() => {});
      await pause(D, 800);
      const st = await say(D, "#calls [data-stop-box]");
      if (st) await shotSpan(D, "b29-12-03-request-stops", `§12 Request a time stops once for your own Edit save | Spots were saved on Edit in another tab a moment before: ${q(st)}`, btn, box, 16, 12);
      else await shot(D, "b29-12-03-request-stops", "§12 Request a time after an Edit save in another tab | No stop box showed (see the picture).", "#calls");
      if (st) {
        await press(D, btn, /request-time$/, "request 2");
        await pause(D, 2500);
        console.log("   after second request:", (await say(D, "#calls")).slice(0, 300));
      }
      // The top box on this page: the lines it picked up.
      await D.evaluate(() => window.scrollTo(0, 0));
      await pause(D, 800);
      const top = await say(D, "[data-live-top]");
      console.log("   top box:", top);
      if (top) await shot(D, "b29-12-04-top-box", `§12 The same lines in the top box | ${q(top.slice(0, 300))}`, "[data-live-top]");
      await D.context().close();
    });

    await step("tester charge after own request", async () => {
      openCharge(sS, t);
      own(`update "Test" set "openUntil" = ${utc} + interval '10 days' where id = '${t}'`);
      const C = await same(sol);
      await openR(C, `/app/sessions/${sS}`, "#part-written");
      const cBtn = C.locator("button", { hasText: /^Charge / }).first();
      await cBtn.waitFor({ timeout: 60000 });
      await cBtn.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await quiet(C);
      ok(await post(sol, `/api/sessions/${sS}/request-time`, { ...go, minutes: 30, times: [localAt(4, 15, 0).toISOString()] }), "tester request");
      await press(C, cBtn, /choose$/, "charge 1");
      await C.locator("[data-stop-box]").first().waitFor({ timeout: 20000 }).catch(() => {});
      await pause(C, 800);
      const st = await say(C, "[data-stop-box]");
      await shot(C, "b29-13-01-charge-stops", st ? `§13 The tester's own call request in another tab stops Charge once | ${q(st)}` : "§13 Charge after a call request in another tab | No stop box showed (see the picture).", "#part-written");
      if (st) {
        await press(C, cBtn, /choose$/, "charge 2");
        await pause(C, 3000);
        await openR(C, `/app/sessions/${sS}`, "#part-written");
        await shot(C, "b29-13-02-charge-second", "§13 The second press goes ahead | Pressed again, Charge goes through: “Paid $10.00: you get $8.00 (…) · “Charged by the tester after 7 days without a review.”” and “Odile Marsh has paid $10.00 for this. It can be paid more, up to $1,000.00 in all.”", "#part-written");
      }
      await C.context().close();
    });

    await step("join page", async () => {
      const J = await same(kit);
      await openR(J, `/app/find/${tApp}`, "main");
      const applyBtn = J.locator("button", { hasText: /Apply to join/ }).first();
      await applyBtn.waitFor({ timeout: 60000 });
      await applyBtn.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await quiet(J);
      const r = await post(kit, `/api/tests/${tApp}/apply`, { seenAt: nowIso(), confirmed: true, anyway: true, ndaAccepted: true, acceptNda: true, note: "" });
      console.log("   apply in the other tab:", r.status);
      await press(J, applyBtn, /apply$/, "apply 1");
      await J.waitForSelector("#join-card [data-stop-box], #join-card [data-refusal], [data-stop-box]", { timeout: 20000 }).catch(() => {});
      await pause(J, 1200);
      const st = await say(J, "[data-stop-box]");
      console.log("   join card:", await say(J, "#join-card"));
      await shot(J, "b29-13-03-apply-stops", st ? `§13 The join page: Apply stops once | Kit applied in another tab a moment before: ${q(st)}` : `§13 The join page after Apply in another tab | ${q((await say(J, "#join-card")).slice(0, 200))}`, (await J.locator("#join-card").count()) ? "#join-card" : undefined);
      if (st && (await applyBtn.isVisible().catch(() => false))) {
        await press(J, applyBtn, /apply$/, "apply 2");
        await pause(J, 2500);
        await shot(J, "b29-13-04-apply-second", "§13 The second press goes ahead | Pressed again: “Application sent. You'll hear back when the developer answers.” (the stop box stays above it; the database still holds one application, the one from the other tab).", (await J.locator("#join-card").count()) ? "#join-card" : undefined);
      }
      await J.context().close();
    });
  }, { section: B29, fake: true });

  // ---------- q3: Batch 29 §27: the tester's deadline reminders stack in "Deadlines" across tests ----------
  group("q3", async () => {
    patient();
    const dev = await acct(`dev+media${TS}q3@playtest.test`, "Vera Holt", "developer", "they");
    await subD(dev);
    const kit = await acct(`tester+media${TS}q3k@playtest.test`, "Kit Moreau", "tester", "they");
    const t1 = await postT(dev, { productName: "Sky Lab", title: "Sky Lab: tutorial" });
    const t2 = await postT(dev, { productName: "Harbor Run", title: "Harbor Run: first 3 levels" });
    const s1 = await joinR(kit, t1), s2 = await joinR(kit, t2);
    // Joined 11 days ago; own deadlines 2.5 and 2.7 days ahead (the 3-day mark).
    own(`update "Contract" set "joinedAt" = ${utc} - interval '11 days', "dueAt" = ${utc} + interval '60 hours' where id = '${s1}'`);
    own(`update "Contract" set "joinedAt" = ${utc} - interval '11 days', "dueAt" = ${utc} + interval '65 hours' where id = '${s2}'`);
    const r = await fetch(`${BASE}/api/cron/daily`, { headers: { authorization: "Bearer media-cron" } });
    console.log("   daily job:", r.status);
    await openR(kit, "/app/notifications", "main");
    console.log("   bell:", (await say(kit, "main")).slice(0, 500));
    await shot(kit, "b29-27-01-deadlines", `§27 Deadlines stack across tests | Kit's bell after the daily job: one entry, “Deadlines · 2 tests today”, for both tests' reminders, the newest line under it (${q((/Your deadline on [^.]+./.exec(await say(kit, "main")) || [""])[0])}).`, bellList(kit));
    await openBell(kit);
    console.log("   bell open:", (await say(kit, "main")).slice(0, 700));
    await shot(kit, "b29-27-02-deadlines-open", `§27 Expanded, one line per test | ${[...(await say(kit, "main")).matchAll(/Your deadline on “[^”]+” is [A-Z][a-z]{2} d+: send your work before then./g)].slice(1).map((m) => q(m[0])).join(" and ")}, each opening its session page.`, bellList(kit));
  }, { section: B29, fake: true });

  // ---------- q4: Calls: paying (a listed call beside an unlisted one; screenshots only), and the $1,000 for a tester's calls ----------
  const retype = async (page, sel, text, ms = 60) => { await page.locator(sel).fill(""); await page.locator(sel).click(); await page.keyboard.type(text, { delay: ms }); };
  const tookPlaceNow = (callId, devId, testerId, from, len) => own(`begin; insert into "CallPresence" (id, "callId", "userId", side, "startAt", "endAt") values ('pr' || md5(random()::text), '${callId}', '${devId}', 'developer', ${utcNow} - interval '${from - 1} minutes', ${utcNow} - interval '${from - 1 - len} minutes'), ('pr' || md5(random()::text), '${callId}', '${testerId}', 'tester', ${utcNow} - interval '${from - 1} minutes', ${utcNow} - interval '${from - 1 - len} minutes'); update "Call" set "startsAt" = ${utcNow} - interval '${from} minutes', "devJoinedAt" = ${utcNow} - interval '${from} minutes', "testerJoinedAt" = ${utcNow} - interval '${from} minutes' where id = '${callId}'; commit;`);
  const tickPay = async (page, scope) => { const t = page.locator(`${scope} [data-pay-tick] input`).first(); if (await t.count()) await t.check(); };
  const sweepLong = async (done, what) => {
    const end = Date.now() + 240000;
    while (Date.now() < end) {
      fetch(`${BASE}/api/health?key=${HEALTH_KEY}`).catch(() => null);
      for (let i = 0; i < 10 && Date.now() < end; i++) { await new Promise((r) => setTimeout(r, 2000)); if (done()) return true; }
    }
    console.log("   ! sweep: nothing yet for", what);
    return false;
  };
  group("q4", async () => {
    patient();
    const yara = await acct(`dev+media${TS}q4@playtest.test`, "Yara Quint", "developer", "they");
    await subD(yara);
    ensureCard(yara.email);
    const zed = await acct(`tester+media${TS}q4z@playtest.test`, "Zed Okoro", "tester", "they");
    const lena = await acct(`tester+media${TS}q4l@playtest.test`, "Lena Fisk", "tester", "they");
    const tL = await postT(yara, { title: "Tidewater: listed calls", productName: "Tidewater", writtenCents: null, writtenRequired: false, questions: [], liveRateCents: "60.00", spots: "4" });
    const tU = await postT(yara, { title: "Tidewater: open feedback", productName: "Tidewater", writtenCents: "10.00", liveRateCents: null, spots: "4" });
    const sZ = await joinR(zed, tL), sL = await joinR(lena, tU);
    const cA = await bookCall(yara, zed, tL, sZ, 30, 30);
    const cB = await bookCall(yara, zed, tL, sZ, 54, 30);
    const cU1 = await bookCall(yara, lena, tU, sL, 31, 30);
    const cU2 = await bookCall(yara, lena, tU, sL, 55, 30);
    tookPlaceNow(cA, yara.uid, zed.uid, 95, 30);
    tookPlaceNow(cB, yara.uid, zed.uid, 60 * 24 * 2, 25);
    tookPlaceNow(cU1, yara.uid, lena.uid, 95, 30);
    tookPlaceNow(cU2, yara.uid, lena.uid, 60 * 24 * 9, 20);
    await openR(yara, `/app/tests/${tL}`, `#call-${cA}`);
    await openR(yara, `/app/tests/${tU}`, `#call-${cU1}`);
    await openR(yara, `/app/tests/${tL}`, `#call-${cA}`);
    console.log("   measured:", sql(`select id || ' ' || coalesce("measuredMinutes"::text, '-') || ' payBy ' || coalesce(to_char("payBy", 'MM-DD HH24:MI'), '-') from "Call" where id in ('${cA}', '${cB}', '${cU1}', '${cU2}')`).replace(/\n/g, " | "));
    const autoA = await say(yara, `#call-${cA} p:has-text("charged automatically")`), autoB = await say(yara, `#call-${cB} p:has-text("charged automatically")`);
    console.log("   A box:", await say(yara, `#call-${cA}`));
    await shot(yara, "cp-01-listed-paybox", `Listed call: the Pay box | Zed's listed call (30 min measured): the box starts at the contract rate × the measured minutes, “Listing: $60/h × 30 min = $30.00”, Rate 60.00 and Amount 30.00, “up to $100.00 in all” ($200/h × 30 min), and under it ${q(autoA)}`, `#call-${cA}`);
    await shot(yara, "cp-02-listed-auto-line", `Listed call: charged automatically if not paid | Zed's other call, 2 days ago (25 min measured): “Listing: $60/h × 25 min = $25.00”, “up to $83.33 in all”, and ${q(autoB)}`, `#call-${cB}`);
    await openR(yara, `/app/tests/${tU}`, `#call-${cU1}`);
    console.log("   U1 box:", await say(yara, `#call-${cU1}`));
    await shot(yara, "cp-03-unlisted-paybox", "Unlisted call: the empty Pay box | Lena's call on a test whose listing has no calls: “Not listed”, an empty Rate (its grey hint “up to $200” cut short in the narrow box) and Amount, “up to $100.00 ($200/h × 30 min)”, and “This part isn't listed: pay any amount, $0 included. Lena Fisk can dispute the amount once.”; no automatic-charge line.", `#call-${cU1}`);
    await openR(zed, `/app/sessions/${sZ}`, "#part-live");
    console.log("   Zed live:", await say(zed, "#part-live"));
    const autoT = await say(zed, "#part-live [data-auto-charge]");
    await shot(zed, "cp-04-tester-listed-rows", `The tester's listed calls | Zed's session page: each call row reads “… · waiting for Yara Quint to pay” with a line like ${q(autoT)} under it; no Charge or Let it go for listed calls.`, "#part-live");
    await openR(lena, `/app/sessions/${sL}`, "#part-live");
    console.log("   Lena live:", await say(lena, "#part-live"));
    await shot(lena, "cp-05-tester-unlisted-rows", "The tester's unlisted calls | Lena's session page: “Not listed · Paid so far $0.00” and each call “… · waiting for Yara Quint to pay”, with no date and no automatic charge (the older call is already 9 days old).", "#part-live");
    await openR(yara, `/app/tests/${tL}`, `#call-${cA}`);
    await retype(yara, `#rate-${cA}`, "40");
    await pause(yara, 900);
    await shot(yara, "cp-06-listed-rate-follows", "Listed call: the amount follows the rate | Yara types a rate of 40 ($/h) and the amount follows: “20.00” (40 × 30 min); below the listing's $30.00 the note turns required: “Say why you're paying less than the listing's $30.00 (the tester reads it).”", `#call-${cA}`);
    await retype(yara, `#amt-${cA}`, "24.50");
    await pause(yara, 900);
    await shot(yara, "cp-07-listed-amount-follows", "Listed call: the rate follows the amount | Typing the amount instead works the other way: $24.50 for 30 minutes sets the rate to “49.00”; the note is still required below $30.00.", `#call-${cA}`);
    await step("pay listed", async () => {
      await retype(yara, `#rate-${cA}`, "40");
      await retype(yara, `#why-${cA}`, "We ended early: the build crashed twice, so half the call was waiting.", 5);
      await tickPay(yara, `#call-${cA}`);
      await pause(yara, 500);
      await press(yara, yara.locator(`#call-${cA} button`, { hasText: /^Pay$/ }).first(), /api\/review$/, "pay A");
      await pause(yara, 2500);
    });
    await openR(yara, `/app/tests/${tU}`, `#call-${cU1}`);
    await retype(yara, `#rate-${cU1}`, "45");
    await pause(yara, 900);
    await shot(yara, "cp-08-unlisted-rate-follows", "Unlisted call: a rate typed, the amount follows | In the empty box Yara types 45 ($/h): the amount follows (“22.50” for 30 min), beside it “up to $100.00 ($200/h × 30 min)”; the note stays optional.", `#call-${cU1}`);
    await retype(yara, `#rate-${cU1}`, "250");
    await pause(yara, 900);
    await shot(yara, "cp-09-unlisted-over-200", "Unlisted call: at most $200 an hour | A rate of 250 makes $125.00, over the call's room: “This is more than you can pay for this call (up to $100.00 at $200 an hour).” in red, and Pay doesn't go.", `#call-${cU1}`);
    await retype(yara, `#amt-${cU1}`, "0");
    await pause(yara, 900);
    await shot(yara, "cp-10-unlisted-zero-note", "Unlisted call: $0 needs a note | At $0 (the rate follows: “0.00”) the note turns required: “Say why you're paying $0 (the tester reads it).”; no payment tick at $0.", `#call-${cU1}`);
    await step("pay unlisted 0", async () => {
      await retype(yara, `#why-${cU1}`, "Thanks for the chat! This one was a quick hello, so no pay; the next call is paid.", 5);
      await pause(yara, 500);
      await press(yara, yara.locator(`#call-${cU1} button`, { hasText: /^Pay$/ }).first(), /api\/review$/, "pay U1");
      await pause(yara, 2500);
    });
    console.log("   payments:", sql(`select coalesce("callId", '-') || ' ' || "amountCents" || ' ' || status from "Payment" where "callId" in ('${cA}', '${cU1}')`).replace(/\n/g, " | "));
    await step("tester rows after pay", async () => {
      await openR(zed, `/app/sessions/${sZ}`, "#part-live");
      console.log("   Zed after pay:", await say(zed, "#part-live"));
      await shot(zed, "cp-11-tester-listed-paid-below", "The tester: paid below, with the reason | Zed's call paid $20.00 for 30 minutes (below $60/h × 30 min) shows Yara's reason and Dispute the pay; the other call still waits for its automatic charge (see the picture for the exact lines).", "#part-live");
      await openR(lena, `/app/sessions/${sL}`, "#part-live");
      console.log("   Lena after pay:", await say(lena, "#part-live"));
      await shot(lena, "cp-12-tester-unlisted-zero", "The tester: $0 with the note | Lena's unlisted call paid $0 shows Yara's note and Dispute the pay; the older call is still “waiting for Yara Quint to pay” (see the picture).", "#part-live");
    });
    await step("pay more", async () => {
      await openR(yara, `/app/tests/${tL}`, `#tester-${sZ}`);
      await unfold(yara, `[data-pay-more="${cA}"]`);
      await yara.evaluate(() => document.querySelectorAll("[data-calls-fold]").forEach((d) => (d.open = true)));
      await pause(yara, 600);
      console.log("   pay more:", await say(yara, `[data-pay-more="${cA}"]`));
      await retype(yara, `[data-pay-more="${cA}"] input[data-amount]`, "90");
      await pause(yara, 900);
      const over = await say(yara, `[data-pay-more="${cA}"] [data-over-cap]`);
      await shot(yara, "cp-13-listed-pay-more-over", `Listed call: Pay more up to the call's cap | After paying $20.00 the call keeps a Pay more box on Zed's row; typing $90.00: ${q(over || "(see the picture)")}, the cap being $200/h × the 30 measured minutes ($100.00).`, yara.locator(`#tester-${sZ} li[data-over-call="${cA}"]`));
      await retype(yara, `[data-pay-more="${cA}"] input[data-amount]`, "80.00");
      await tickPay(yara, `[data-pay-more="${cA}"]`);
      await pause(yara, 500);
      await press(yara, yara.locator(`[data-pay-more="${cA}"] button`, { hasText: /^Pay more$/ }).first(), /api\/review$|pay-extra$/, "pay more");
      await pause(yara, 2500);
      await openR(yara, `/app/tests/${tL}`, `#tester-${sZ}`);
      await yara.evaluate(() => document.querySelectorAll("[data-calls-fold]").forEach((d) => (d.open = true)));
      await pause(yara, 600);
      const mostLine = await say(yara, `#tester-${sZ} li[data-over-call="${cA}"] [data-paid-most]`);
      console.log("   after pay more:", await say(yara, `#tester-${sZ} li[data-over-call="${cA}"]`));
      await shot(yara, "cp-14-listed-paid-most", `Listed call: paid the most it can be | After a Pay more of $80.00 the call has $100.00 in all and reads ${q(mostLine || "(see the picture)")}, with no Pay more box left.`, yara.locator(`#tester-${sZ} li[data-over-call="${cA}"]`));
    });
    await step("auto charge", async () => {
      const mv = "interval '6 days'";
      own(`update "Call" set "startsAt" = "startsAt" - ${mv}, "devJoinedAt" = "devJoinedAt" - ${mv}, "testerJoinedAt" = "testerJoinedAt" - ${mv}, "measuredFrom" = "measuredFrom" - ${mv}, "measuredTo" = "measuredTo" - ${mv}, "measuredAt" = "measuredAt" - ${mv}, "endedAt" = "endedAt" - ${mv}, "payBy" = "payBy" - ${mv} where id = '${cB}'`);
      sql(`update "CallPresence" set "startAt" = "startAt" - ${mv}, "endAt" = "endAt" - ${mv} where "callId" = '${cB}'`);
      await sweepLong(() => sql(`select count(*) from "Payment" where "callId" = '${cB}'`) !== "0", "call B's automatic charge");
      console.log("   B charged:", sql(`select "amountCents" || ' ' || status from "Payment" where "callId" = '${cB}'`));
      await openBell(yara);
      console.log("   yara bell:", (await say(yara, "main")).slice(0, 600));
      await shot(yara, "cp-15-auto-receipt", "The automatic charge: the developer's receipt | 7 days after the other call (its dates moved back), the 5-minute sweep charged it; Yara's bell shows the receipt (see the picture for its words).", bellList(yara));
      await openR(yara, `/app/tests/${tL}`, `#tester-${sZ}`);
      await yara.evaluate(() => document.querySelectorAll("[data-calls-fold]").forEach((d) => (d.open = true)));
      await pause(yara, 600);
      console.log("   dev B row:", await say(yara, `#tester-${sZ} li[data-over-call="${cB}"]`));
      await shot(yara, "cp-16-auto-dev-row", "The automatic charge on the developer's row | The call now reads paid $25.00 (25 min × $60/h), with Pay more still open up to its cap (see the picture).", yara.locator(`#tester-${sZ} li[data-over-call="${cB}"]`));
      await openBell(zed);
      console.log("   zed bell:", (await say(zed, "main")).slice(0, 600));
      await shot(zed, "cp-17-auto-tester-bell", "The automatic charge: the tester's line | Zed's bell (see the picture for the line about the call's payment).", bellList(zed));
      await openR(zed, `/app/sessions/${sZ}`, "#part-live");
      console.log("   Zed after auto:", await say(zed, "#part-live"));
      await shot(zed, "cp-18-auto-tester-row", "The automatic charge on the tester's page | Zed's call rows after the automatic charge (see the picture).", "#part-live");
    });
    await step("weekly line", async () => {
      const r = await fetch(`${BASE}/api/cron/daily`, { headers: { authorization: "Bearer media-cron" } });
      console.log("   daily job:", r.status);
      await openBell(yara);
      console.log("   yara bell 2:", (await say(yara, "main")).slice(0, 800));
      await shot(yara, "cp-19-unlisted-weekly-line", "Unlisted call: the weekly line | Lena's older unlisted call, 9 days old and unpaid, is never charged: the daily job gives Yara the weekly “Pay your calls” line (see the picture).", bellList(yara));
      await openR(lena, `/app/sessions/${sL}`, "#part-live");
      console.log("   Lena after 9 days:", await say(lena, "#part-live"));
      await shot(lena, "cp-20-unlisted-no-charge", "Unlisted call: no Charge for the tester | 9 days after Lena's older call it still reads “waiting for Yara Quint to pay”: no Charge, no Let it go and no automatic charge for an unlisted call.", "#part-live");
    });
    await step("calls $1,000", async () => {
      const tC = await postT(yara, { title: "Tidewater: long calls", productName: "Tidewater", writtenCents: null, writtenRequired: false, questions: [], liveRateCents: "200.00", spots: "4" });
      const sC = await joinR(zed, tC);
      await again(() => bookCall(yara, zed, tC, sC, 30, 180), "book call 1");
      await again(() => bookCall(yara, zed, tC, sC, 60, 114), "book call 2");
      await openR(zed, `/app/sessions/${sC}`, "#part-live");
      const warnT = await say(zed, "#part-live [data-calls-warning]");
      console.log("   tester live:", await say(zed, "#part-live"));
      await shot(zed, "cp-21-calls-left-tester", `The $1,000 for a tester's calls: the grey line | Two booked calls at $200/h (180 and 114 minutes) take $980 of the $1,000: Zed's page reads ${q(warnT || "(see the picture)")}`, "#part-live");
      await openR(yara, `/app/tests/${tC}`, "#calls");
      await unfold(yara, "#calls");
      await yara.locator("#calls fieldset label", { hasText: "Zed Okoro" }).locator("input").check();
      await yara.locator("#calls [aria-label='Requested time 1']").fill(dtLocal(localAt(4, 15, 0)));
      await yara.locator("#calls [aria-label='Length in minutes']").fill("30");
      await pause(yara, 1000);
      const warnD = await say(yara, "#calls [data-calls-warning]");
      console.log("   dev calls:", (await say(yara, "#calls")).slice(0, 600));
      const btn = yara.locator("#calls button", { hasText: /^Request a time$/ }).first();
      await press(yara, btn, /request-time$/, "request over");
      await pause(yara, 1800);
      const ref = await say(yara, "#calls .err, #calls [data-refusal]");
      console.log("   refusal:", ref);
      await shot(yara, "cp-22-calls-cap-refused", `The $1,000 for a tester's calls: booking refused | ${warnD ? `Ticking Zed shows ${q(warnD)}; ` : ""}a 30-minute call at $200/h ($100) is refused: ${q(ref || "(see the picture)")}`, "#calls");
    });
  }, { section: CP, fake: true });

  // ---------- q5: Add a card opens Stripe (the fake) ----------
  group("q5", async () => {
    patient();
    const nora = await acct(`dev+media${TS}q5@playtest.test`, "Nora Lane", "developer", "they");
    await openR(nora, "/app/payments", "main");
    const btn = nora.locator("button", { hasText: /Add a card|Change card/ }).first();
    await btn.waitFor({ timeout: 30000 });
    await btn.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await shot(nora, "pay-card-01-add", "Add a card | Nora's Payments page with no card yet: the Add a card button (a form posted to this site, which sends the browser on to Stripe).", btn.locator("xpath=ancestor::section[1]"));
    const nav = nora.waitForNavigation({ timeout: 60000 }).catch(() => null);
    await btn.click();
    await nav;
    await pause(nora, 2500);
    console.log("   after Add a card:", nora.url(), "|", (await say(nora, "main")).slice(0, 300));
    await shot(nora, "pay-card-02-after", `Add a card: where it goes | After the press the browser is at ${q(new URL(nora.url()).pathname + new URL(nora.url()).search)} (see the picture: on this media server the fake Stripe stands in for Checkout).`);
  }, { section: "Payments", fake: true });

  // ---------- q6: review dates for testers who joined on different days (one 14-day test, three testers; fake Stripe) ----------
  group("q6", async () => {
    patient();
    const nora = await acct(`dev+media${TS}q6@playtest.test`, "Nora Lane", "developer", "they");
    await subD(nora);
    ensureCard(nora.email);
    const ana = await acct(`tester+media${TS}q6a@playtest.test`, "Ana Silva", "tester", "they");
    const ben = await acct(`tester+media${TS}q6b@playtest.test`, "Ben Okafor", "tester", "they");
    const cam = await acct(`tester+media${TS}q6c@playtest.test`, "Cam Reyes", "tester", "they");
    const t = await postT(nora, { title: "Harbor Run: review dates", openUntil: day(14) });
    const sA = await joinR(ana, t), sB = await joinR(ben, t), sC = await joinR(cam, t);
    for (const [x, s] of [[ana, sA], [ben, sB], [cam, sC]]) await sendW(x, s);
    const subA = subOf(sA), subB = subOf(sB), subC = subOf(sC);
    const ago = (d) => `${utc} - interval '${d} days'`;
    // Today is day 14 of the test (it opened 13 days ago). Ana joined day 1 (deadline day 15) and sent day 3; Ben joined day 10 (deadline day 24) and sent day 12;
    // Cam joined day 2 (deadline day 16) and sent today, day 14.
    own(`update "Test" set "createdAt" = ${ago(13)}, "openUntil" = ${ago(-1)} where id = '${t}'`);
    const place = (s, sub, joined, sent) => {
      own(`update "Contract" set "joinedAt" = ${ago(joined)}, "dueAt" = ${ago(joined - 14)} where id = '${s}'`);
      own(`update "Submission" set "sentAt" = ${ago(sent)}, "updatedAt" = ${ago(sent)}, "payBy" = ${ago(sent - 7)} where id = '${sub}'`);
    };
    place(sA, subA, 13, 11);
    place(sB, subB, 4, 2);
    place(sC, subC, 12, 0);
    const lines = {};
    for (const [k, x, s] of [["Ana", ana, sA], ["Ben", ben, sB], ["Cam", cam, sC]]) {
      await openR(x, `/app/sessions/${s}`, "#part-written");
      lines[k] = await say(x, "#part-written [data-charge-opens]");
      console.log(`   ${k}:`, lines[k], "|", (await say(x, "#part-written")).slice(0, 200));
    }
    await shot(ana, "rd-01-ana", `Review dates: joined day 1, sent day 3 | Ana joined on day 1 (own deadline day 15) and sent on day 3: the date is their deadline, not 7 days after sending (day 10): ${q(lines.Ana)}`, "#part-written");
    await shot(ben, "rd-02-ben", `Review dates: joined day 10, sent day 12 | Ben joined on day 10 (own deadline day 24) and sent on day 12: the date is their own deadline, day 24, whatever the others' deadlines: ${q(lines.Ben)}`, "#part-written");
    await shot(cam, "rd-03-cam", `Review dates: sent 2 days before the deadline | Cam joined on day 2 (own deadline day 16) and sent today, day 14: the date is 7 days after sending (day 21), so the developer still has a full week: ${q(lines.Cam)}`, "#part-written");
    await openR(nora, `/app/tests/${t}`, `#piece-${subA}`);
    const dl = {};
    for (const [k, sub] of [["Ana", subA], ["Ben", subB], ["Cam", subC]]) { dl[k] = await say(nora, `#piece-${sub} p:has-text("If you don't pay by")`); console.log(`   dev ${k}:`, dl[k]); }
    await shot(nora, "rd-04-dev-ana", `Review dates: the developer's side | Nora's Pay box for Ana: ${q(dl.Ana)}`, `#piece-${subA}`);
    await shot(nora, "rd-05-dev-ben", `Review dates: the developer's side | Nora's Pay box for Ben: ${q(dl.Ben)}`, `#piece-${subB}`);
    await shot(nora, "rd-06-dev-cam", `Review dates: the developer's side | Nora's Pay box for Cam: ${q(dl.Cam)}`, `#piece-${subC}`);
  }, { section: "Charge timing", fake: true });

  // ---------- qc: the Calls: paying captions, settled after looking at each picture of q4's run (Oct 29, 8:24 PM) ----------
  group("qc", async () => {
    const add = (file, caption) => { SEC = CP; record(file, caption, "image"); };
    add("cp-04-tester-listed-rows.png", "The tester's listed calls | Zed's session page: each call reads “… · waiting for Yara Quint to pay”, with “If Yara Quint doesn't pay by Nov 4, it's charged automatically.” and “If Yara Quint doesn't pay by Nov 6, it's charged automatically.” under them; no Charge or Let it go for listed calls. The Oct 29 call's date reads Nov 6 here but Nov 5 on Yara's Pay box (the 7 days end at 7:20 PM Central, after midnight UTC): the two sides count the date in different time zones.");
    add("cp-11-tester-listed-paid-below.png", "The tester: paid below, with the reason | Zed's Oct 29 call: “paid $20.00”, then “Paid $20.00 ($40.00/h): you get $16.00 (…) · “We ended early: the build crashed twice, so half the call was waiting.”” and “Yara Quint has paid $20.00 for this. It can be paid more, up to $100.00 in all.” with Dispute the pay; the older call still reads “waiting for Yara Quint to pay” and “If Yara Quint doesn't pay by Nov 3, it's charged automatically.”");
    add("cp-12-tester-unlisted-zero.png", "The tester: $0 with the note | Lena's unlisted call: “Paid $0: “Thanks for the chat! This one was a quick hello, so no pay; the next call is paid.”” and “Yara Quint has paid $0.00 for this. It can be paid more, up to $100.00 in all.”, with Dispute the pay; the older call is still “waiting for Yara Quint to pay”.");
    add("cp-13-listed-pay-more-over.png", "Listed call: Pay more up to the call's cap | After paying $20.00 the call (“Took place · 30 min · paid $20.00”) keeps a Pay more box, “up to $80.00 more ($100.00 in all)”; typing 90 shows “This is more than this piece can be paid (up to $80 more, $100 in all).” in red. The cap is $200/h × the 30 measured minutes.");
    add("cp-14-listed-paid-most.png", "Listed call: paid the most it can be | After a Pay more of $80.00: “Took place · 30 min · paid $100.00” and “Paid the most this piece can be paid ($100.00).”, with no Pay more box left.");
    add("cp-15-auto-receipt.png", "The automatic charge: the developer's receipt | 7 days after the other call (its dates moved back), the 5-minute sweep charged it: “Receipt: you paid $25.00 for Zed Okoro's call on Oct 21 (charged automatically after 7 days)”, above the receipts for the $80.00 extra payment and the $20.00 call.");
    add("cp-16-auto-dev-row.png", "The automatic charge on the developer's row | The call now reads “Took place · 25 min · paid $25.00” (25 min × $60/h), and Pay more stays open: “up to $58.33 more ($83.33 in all)”.");
    add("cp-17-auto-tester-bell.png", "The automatic charge: the tester's line | Zed's bell: “Yara Quint paid you $25.00 for your call on Oct 21”, on its own line beside the “You were paid · 2 updates today” stack (the $20.00 pay and the $80.00 more).");
    add("cp-18-auto-tester-row.png", "The automatic charge on the tester's page | Zed's Oct 21 call: “Paid $25.00 ($60.00/h): you get $20.00 (…) · “Charged automatically 7 days after the call.”” and “Yara Quint has paid $25.00 for this. It can be paid more, up to $83.33 in all.”, with Dispute the pay; the other call at its cap: “This part is already paid the most it can be ($100.00).” with Dispute disabled.");
    add("cp-19-unlisted-weekly-line.png", "Unlisted call: the weekly line | Lena's older unlisted call, 9 days old and unpaid, is never charged: the daily job gives Yara “Pay your calls: your call with Lena Fisk on “Tidewater: open feedback” isn't paid yet (any amount, $0 included).” (in that test's stack for the day).");
    add("cp-22-calls-cap-refused.png", "The $1,000 for a tester's calls: booking refused | Two booked calls (180 and 114 min at $200/h) leave “$20.00 left of the $1,000 for calls with Zed Okoro on this test.” under Zed's name; a 30-minute request ($100) is refused before it is sent: “Calls with Zed Okoro on this test can come to at most $1,000; $20.00 is left, so this call can't be booked.” App bug: the same line shows twice and “Fix the 2 mistakes above, then press Request a time again.” lists it twice.");
  }, { section: CP });

  // ---------- qc2: review-date captions, settled after looking at q6's pictures (Oct 29, 8:36 PM run) ----------
  group("qc2", async () => {
    const add = (file, caption) => { SEC = "Charge timing"; record(file, caption, "image"); };
    add("rd-01-ana.png", "Review dates: joined day 1, sent day 3 | One 14-day test that opened Oct 16 (day 1). Ana joined on day 1 (own deadline day 15, Oct 30) and sent on day 3 (Oct 18): the date is their deadline, not 7 days after sending (day 10). Ana reads “If Nora Lane hasn't paid by Oct 31, you can charge or let it go then.”: App bug, one day later than the Oct 30 on Nora's Pay box (rd-04).");
    add("rd-02-ben.png", "Review dates: joined day 10, sent day 12 | Ben joined on day 10 (Oct 25; own deadline day 24, Nov 8) and sent on day 12 (Oct 27): the date is their own deadline, whatever the others' deadlines. Ben reads “If Nora Lane hasn't paid by Nov 9, you can charge or let it go then.” (Nora's Pay box says Nov 8, rd-05).");
    add("rd-03-cam.png", "Review dates: sent 2 days before the deadline | Cam joined on day 2 (own deadline day 16, Oct 31) and sent today, day 14 (Oct 29): the date is 7 days after sending (day 21), so Nora still has a full week. Cam reads “If Nora Lane hasn't paid by Nov 6, you can charge or let it go then.” (Nora's Pay box says Nov 5, rd-06).");
    add("rd-04-dev-ana.png", "Review dates: the developer's side, Ana | Nora's Pay box for Ana's answers (sent Sun, Oct 18): “If you don't pay by Oct 30, Ana Silva can charge you $10.00, their contract price, or let it go.” (day 15, Ana's own deadline).");
    add("rd-05-dev-ben.png", "Review dates: the developer's side, Ben | Nora's Pay box for Ben's answers (sent Tue, Oct 27): “If you don't pay by Nov 8, Ben Okafor can charge you $10.00, their contract price, or let it go.” (day 24, Ben's own deadline).");
    add("rd-06-dev-cam.png", "Review dates: the developer's side, Cam | Nora's Pay box for Cam's answers (sent today, Thu, Oct 29): “If you don't pay by Nov 5, Cam Reyes can charge you $10.00, their contract price, or let it go.” (day 21, 7 days after sending).");
  }, { section: "Charge timing" });

  // ---------- qc3: Charge timing captions the earlier run left as "See the picture" (late sending with Charge open; looked at Oct 29 evening) ----------
  group("qc3", async () => {
    const add = (file, caption) => { SEC = "Charge timing"; record(file, caption, "image"); };
    add("ct-07-tester-parts.png", "The tester's three parts | Ines's page: the written answers (sent Mon, Oct 19, on time) past their review date, with “Wren Castell didn't review your written answers in 7 days: charge $10.00 or let it go.” and Charge / Let it go; the listed recording sent late (“Sent Thu, Oct 29, 3:53 PM”, “Sent late (deadline was Oct 27, 2026)”) with its own date, “If Wren Castell hasn't paid by Nov 5, you can charge or let it go then.”; and an unlisted call (“Not listed”, “waiting for Wren Castell to pay”, no Charge).");
    add("ct-07-dev-needs.png", "The developer's Needs you | “Ines Duarte · 3 parts to pay”: the written answers (sent Mon, Oct 19) with Pay at $10.00 and no pay-by line (Charge is already open); the unlisted call with an empty box (“up to $96.67 ($200/h × 29 min)”, any amount, $0 included); and the recording marked “Sent late (deadline was Oct 27, 2026)” with “If you don't pay by Nov 5, Ines Duarte can charge you $15.00, their contract price, or let it go.”");
    add("ct-07-tester-later.png", "8 days later: the tester | The same three parts 8 days on (dates moved back): the written answers and now the late recording (“Sent late (deadline was Oct 19, 2026)”) both read “Wren Castell didn't review your … in 7 days: charge … or let it go.” with Charge / Let it go; the unlisted call still “waiting for Wren Castell to pay”, never a Charge.");
    add("ct-07-dev-later.png", "8 days later: the developer | Wren's Needs you still offers Pay on all three parts: the written answers ($10.00), the late recording ($15.00, “Sent late (deadline was Oct 19, 2026)”) and the unlisted call (empty box, “up to $96.67”); none has a pay-by line any more, since Charge is open for both listed parts.");
    add("ct-06-dev-both.png", "The developer's Needs you | Ben's answers (sent Thu, Oct 15; Ben's own deadline has passed, so Charge is open: no pay-by line) and Cleo's (sent Sat, Oct 24; Cleo joined later) with “If you don't pay by Nov 6, Cleo Brandt can charge you $10.00, their contract price, or let it go.”");
    add("ct-05-paid-refused.png", "Once paid: the update press | Ines's written form with an extra sentence typed after the answers were paid, caught while the press says “Sending…” (the part still reads “Not sent yet” on this old page); the refusal line itself isn't in this picture, see “Once paid, an update can't be sent”.");
  }, { section: "Charge timing" });

  // ---------- qc4: captions for the earlier parts' groups (pA5, pA6, pA8, pB5, pC7, pE4) re-run screenshots-only, settled after looking at each picture ----------
  group("qc4", async () => {
    const add = (section, file, caption) => { SEC = section; record(file, caption, "image"); };
    add(B27, "b27-01-01-moved-up.png", "§1 The press goes to Switch / Keep | Tavi presses Send my answers while Quinn's new terms are open: nothing is sent; the page moves up to the box, highlighted: “Quinn Harlow updated the listing: written $10 → $12.” with Switch to the new terms and Keep my current terms.");
    add(B27, "b27-01-04-kept-sent.png", "§1 Keep unlocks Send | After Keep my current terms the box is gone and Send my answers goes through: “Written answers: Under review · Sent Thu, Oct 29, 8:48 PM” with “If Quinn Harlow hasn't paid by Nov 12, you can charge or let it go then.”; the form now offers Send my updated answers.");
    add(B27, "b27-01-06-old-page-top.png", "§1 An old page | Uma's page was opened before the offer and showed no box; their Send my answers is refused by the server and the page loads the offer at the top: “Quinn Harlow updated the listing: written $10 → $12.”, with Switch / Keep.");
    add(B27, "b27-01-08-dispute-not-blocked.png", "§1 Dispute isn't blocked | Wren has the same open offer at the top and disputes their $0 answers (“Paid $0: “The answers are too short to use.””): it goes through, “You disputed this: waiting for the team.”");
    add(B27, "b27-02-01-stopped.png", "§2 Go to the next round stops once | Tavi sent updated answers after Quinn's page loaded: “Your Go to the next round didn't go through.” Since you opened this page: “Tavi Ross updated their written answers · 8:49 PM”, “Don't stop me for: Work sent” and “Press Go to the next round again to go ahead.”");
    add(B27, "b27-02-02-draft.png", "§2 The second press opens the draft | Post a test: “A draft: Lantern Bay: kelp maze (round 2). Check the details, then press Post the test to open it for testers.”");
    add(B27, "b27-05-01-before.png", "§5 Two admins, one paused test | The second admin's console (the plain Tests list): “Lantern Bay: harbor lights” · paused by the first admin (these throwaway admins show by their email), with Lift the pause.");
    add(B27, "b27-05-02-after.png", "§5 The row follows | The first admin lifted the pause on their own console: this row turns into Pause live with no reload, reading “open · paused by …, lifted by … at Thu, Oct 29, 8:49 PM”.");
    add(B27, "b27-05-03-searched-before.png", "§5 A searched list | The Tests list searched for “deep trench”: “Lantern Bay: deep trench” · paused by …, with Lift the pause.");
    add(B27, "b27-05-04-searched-after.png", "§5 The searched row follows too | That pause is lifted on the other console: the searched row turns into Pause live, “open · paused by …, lifted by … at Thu, Oct 29, 8:49 PM”.");
    add("Tester session page", "alerts-02-on-stop.png", "Tester Alerts On: Charge stops once | Odile's Pay was declined just before Pim's press (their tests paused): “Your Charge didn't go through.” Since you opened this page: “This test was paused at 8:54 PM.”, “Turn off alerts” and “Press Charge again to go ahead.” (the delayed-pay line itself isn't in this box; the pause is).");
    add(B28, "b28-15-tester-dispute.png", "§15 A listed part paid above its listing can be disputed | Ben's answers ($10.00 listing) were paid $20.00: Dispute the pay opens with “Why should the pay be higher? (the team and the developer read it)” and “You can dispute this once. Our team decides; a decision can only raise the pay, up to $980.00 more.”");
    add(B28, "b28-15-admin-row.png", "§15 The admin's form, with the chat fold | “Listing $10.00 · Paid for this piece $20.00”, the open fold “Their chat on this test (2)” (Ben: “… Could we say $60 for the lot?”, Wren: “Yes, $60 in all for the full map notes is fair.”), “$20.00 paid · can raise up to $980.00 more” and “Total pay for this piece $ … $20.00-$1000.00”.");
    add(B28, "b28-15-admin-decided.png", "§15 Decided up to the cap | “Paid for this piece $60.00” and “Decided Thu, Oct 29, 8:58 PM by …: $60.00 in all · “They agreed $60 in all in the chat.””.");
    add(B28, "b28-15-tester-decided.png", "§15 The tester after the decision | “Paid so far $60.00”, “The team decided: $60.00 in all · “They agreed $60 in all in the chat.”.” (a stray full stop after the quote) and “The developer's side: “I meant $60 if the notes came with screenshots.””.");
    add(B28, "b28-08-04-receipt.png", "§8 Charged right after the lift | After the team's Approve went through, Vera's bell has the added amount's own receipt: “Receipt: you paid $10.00 for Jun Abara's written answers (charged by them after 7 days)”.");
    add(B28, "b28-08-05-tester-paid.png", "§8 The tester is paid | Jun's bell: “Vera Holt paid $10.00 for your written answers” and ““Harbor Run: first 3 levels” is running again”; nothing about the developer's hold or chargeback.");
  }, { section: B28 });

  // ---------- qc5: the Add a card captions (looked at both pictures) ----------
  group("qc5", async () => {
    const add = (file, caption) => { SEC = "Payments"; record(file, caption, "image"); };
    add("pay-card-01-add.png", "Add a card | Nora's Payments page with no card yet: “No card yet. You're charged only when you press Pay, for exactly the amount you tick.”, the Add a card button and “Card details are entered on Stripe's page and never reach this site.”");
    add("pay-card-02-after.png", "Add a card on the media server | The press posts the form to the site and comes back to Payments with “We couldn't save the card. Try again.”: the fake Stripe used for these recordings has no Checkout page, so Stripe's own card form can only be shown on the Stripe test-mode server.");
  }, { section: "Payments" });
}
