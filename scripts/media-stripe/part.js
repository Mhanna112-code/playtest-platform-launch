// (Oct 29) The Stripe test-mode run: pasted into scripts/media.cjs by scripts/media-stripe/assemble.cjs (every harness helper is in scope). Runs against the
// 3460 server (scripts/media-stripe/start.cjs: the worktree, the playtest_lite_media database, the Stripe TEST key, `stripe listen`) and the Stripe viewer on 3461.
// Each Stripe step is shown beside the app: the viewer reads the objects from Stripe's API in test mode (the Dashboard needs the owner's sign-in).
{
  const ST_SEC = "Stripe test mode (Oct 29)", EM_SEC = "Real emails (Oct 29)";
  const addSections = () => {
    const want = [
      [ST_SEC, "Real Stripe payments in TEST MODE (the owner's sandbox keys, `stripe listen` forwarding the webhooks to a separate 3460 server), each shown beside the app with a local viewer that reads the same objects from Stripe's API: card setup in Stripe Checkout, Pay with the 80% going to the tester, Stripe's real 3D Secure frame, a declined card and the payment hold, a chargeback with the reservation (Uncaptured) and the team's Approve (Succeeded), and the testers' payout accounts."],
      [EM_SEC, "Real emails through Resend (the owner approved sending only to their own marchanna111+… aliases, at most 15): the app's side and Resend's own status for each email id."],
    ];
    for (const [t, e] of want) if (!SECTIONS.some(([x]) => x === t)) SECTIONS.push([t, e]);
  };
  const Stripe = require("C:/Users/march/Projects/playtest-lite/node_modules/stripe");
  const { stripeKeys } = require("C:/Users/march/Projects/playtest-lite/scripts/media-stripe/env.cjs");
  const stripe = new Stripe(stripeKeys().sk); // (throws unless it is a test key; never printed)
  const VIEW = "http://localhost:3461";
  const PANEL_V = { viewport: { width: 640, height: 900 } };
  const U = "(now() at time zone 'utc')";
  const st = { stripe };

  /** The Stripe viewer for these accounts, recording (its own video, joined beside the app's). */
  const panel = async (dev, testers = [], title = "") => {
    const c = await browser.newContext({ ...PANEL_V, recordVideo: { dir: VTMP, size: PANEL_V.viewport } });
    const p = await c.newPage();
    p.t0 = Date.now();
    await p.goto(`${VIEW}/panel?dev=${encodeURIComponent(dev ? dev.email : "")}&testers=${encodeURIComponent(testers.map((t) => t.email).join(","))}&title=${encodeURIComponent(title)}`);
    await p.waitForTimeout(2500);
    return p;
  };
  /** The app's screen as it is, and the viewer beside it, as one picture (both scaled to 900 high). `target` is scrolled to the middle of the app's screen first. */
  const pairShot = async (app, pan, name, caption, target) => {
    await app.bringToFront();
    await closeTimerPopups(app);
    if (target) {
      const loc = typeof target === "string" ? app.locator(target).first() : target;
      await loc.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
    }
    await app.waitForTimeout(700);
    await pan.waitForTimeout(1800); // (the viewer polls every 1.5 s)
    const a = path.join(VTMP, `pa-${Date.now()}.png`), b = path.join(VTMP, `pb-${Date.now()}.png`);
    await (app._raw || app.screenshot.bind(app))({ path: a });
    await pan.screenshot({ path: b });
    const file = `${name}${SFX}.png`;
    execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", a, "-i", b, "-filter_complex", "[0:v]scale=-2:900,setsar=1,pad=iw+8:ih:0:0:0x101826[x];[1:v]scale=-2:900,setsar=1[y];[x][y]hstack=inputs=2", path.join(OUT, file)]);
    record(file, caption, "image");
    return file;
  };
  /** A recorded app page and a recorded viewer, started together. */
  const pairRec = async (from, dev, testers, title) => {
    const app = await rec(V, from);
    const pan = await panel(dev, testers, title);
    return { app, pan, fromA: () => at(app), fromP: () => at(pan) };
  };
  const pairVideo = async (pr, fa, fp, name, caption) => {
    finishVideo([{ file: await saveVideo(pr.app, `${name}-a.webm`), from: fa }, { file: await saveVideo(pr.pan, `${name}-p.webm`), from: fp }], name, caption);
  };

  // ---------- Stripe's own pages ----------
  /** Stripe's 3D Secure test page (inside the app's inline frame, or Checkout's): Complete or Fail. */
  const threeDS = async (page, okay, ms = 60000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      for (const f of page.frames()) {
        const b = f.locator(okay ? "#test-source-authorize-3ds" : "#test-source-fail-3ds");
        if (await b.isVisible().catch(() => false)) {
          await page.waitForTimeout(1500); // (so the recording shows the bank's page)
          await b.click();
          return true;
        }
      }
      await page.waitForTimeout(500);
    }
    console.log("   ! no 3D Secure page found; frames:", page.frames().map((f) => f.url().slice(0, 90)).join(" | "));
    return false;
  };
  /** Add a card (or Change card) on Payments: Stripe Checkout in setup mode with a test card number; Link left unticked. `tds` completes Checkout's 3D Secure. */
  const addCard = async (page, number, { tds = false, name = page.name || "Test Cardholder" } = {}) => {
    await page.goto("/app/payments");
    await pause(page, 1200);
    await page.locator("form button", { hasText: /(Add a card|Change card)/ }).first().click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
    await page.waitForTimeout(2500);
    const acc = page.locator("[data-testid=card-accordion-item-button]");
    if (await acc.count()) await acc.dispatchEvent("click");
    await page.locator("#cardNumber").waitFor({ timeout: 30000 });
    await page.locator("#cardNumber").pressSequentially(number.replace(/\s/g, ""), { delay: 35 });
    await page.locator("#cardExpiry").pressSequentially("1230", { delay: 35 });
    await page.locator("#cardCvc").pressSequentially("123", { delay: 35 });
    if (await page.locator("#billingName").isVisible().catch(() => false)) await page.locator("#billingName").fill(name);
    if (await page.locator("#billingPostalCode").isVisible().catch(() => false)) await page.locator("#billingPostalCode").fill("10001");
    const link = page.locator("#enableStripePass");
    if (await link.isChecked().catch(() => false)) await link.uncheck({ force: true });
    await pause(page, 900);
    await page.locator("[data-testid=hosted-payment-submit-button], button[type=submit]").first().click();
    if (tds) await threeDS(page, true, 60000);
    await page.waitForURL(/localhost:3460/, { timeout: 90000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await pause(page, 1200);
  };
  // A tester's payout account. Stripe's hosted Express onboarding asks an automated browser to solve an hCaptcha (which this recording never does), so the account
  // is finished through Stripe's API instead: a test Custom account (transfers only) with Stripe's test identity and bank values, put on the tester's row.
  const IND = (t) => ({ first_name: t.name.split(" ")[0], last_name: t.name.split(" ").slice(1).join(" ") || "Tester", dob: { day: 1, month: 1, year: 1901 }, ssn_last_4: "0000", id_number: "000000000", phone: "+15555550100", email: t.email, address: { line1: "address_full_match", city: "New York", state: "NY", postal_code: "10001", country: "US" } });
  const FULL = (t) => ({ individual: IND(t), external_account: "btok_us_verified", tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "127.0.0.1" } });
  const connectApi = async (t, complete) => {
    const a = await stripe.accounts.create({
      type: "custom", country: "US", email: t.email, business_type: "individual", capabilities: { transfers: { requested: true } },
      business_profile: { mcc: "5734", url: "https://playtest-tester.dev", product_description: "Testing games and apps" }, metadata: { recording: "stripe-media", userId: t.uid },
      ...(complete ? FULL(t) : { individual: { first_name: IND(t).first_name, last_name: IND(t).last_name, email: t.email } }),
    });
    own(`update "User" set "stripeAccountId" = '${a.id}', "payoutsReady" = false where email = ${lit(t.email)}`);
    t.acct = a.id;
    return a.id;
  };
  const finishConnect = (t) => stripe.accounts.update(t.acct, FULL(t));
  /** Back from Stripe's setup (the return URL Stripe's onboarding sends the tester to): the app reads the account from Stripe. */
  const payoutReturn = async (t) => { await t.goto("/api/payments/payout-return"); await pause(t, 1500); };
  /** One of the app's clock jobs for one of this run's accounts (scripts/media-stripe/appfn.cjs: the app's own code, the media database, the test key). */
  const appfn = (action, email, extra = []) => execFileSync(process.execPath, [path.join(__dirname, "media-stripe", "appfn.cjs"), action, email, ...extra], { encoding: "utf8", env: process.env }).trim();

  // ---------- the app ----------
  const piece = (page, subId) => page.locator(`#piece-${subId}`);
  /** Press Pay on one piece (the every-payment tick first). */
  const pressPay = async (page, subId, { amount, why } = {}) => {
    const box = piece(page, subId);
    await box.evaluate((el) => el.scrollIntoView({ block: "center" }));
    if (amount) { await box.locator(`#amt-${subId}`).fill(amount); await box.locator(`#why-${subId}`).fill(why); await pause(page, 500); }
    await box.locator("[data-pay-tick] input").first().check();
    await pause(page, 600);
    await box.locator("button", { hasText: /^Pay$/ }).first().click();
  };
  const testPage = async (page, testId) => {
    await page.goto(`/app/tests/${testId}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await pause(page, 1500);
  };
  const chargeApi2 = (tester, s, sub, cents) => post(tester, `/api/sessions/${s}/choose`, { choice: "charge", seenAt: nowIso(), confirmed: true, submissionId: sub, tickedCents: cents }).then((r) => ok(r, "charge"));
  const piOfSub = (subId) => sql(`select coalesce("stripePaymentIntentId", '') from "Payment" where "submissionId" = '${subId}' order by "createdAt" desc limit 1`);
  /** A written test with these testers' answers sent. Returns { t, s: [sessionIds], sub: [submissionIds] }. */
  const writtenTest = async (dev, testers, over = {}) => {
    const t = await postTest(dev, { productName: "Harbor Run", title: "Harbor Run: first 3 levels", writtenCents: "10.00", ...over });
    const s = [], sub = [];
    for (const x of testers) { const id = await join(x, t); await sendWritten(x, id); s.push(id); sub.push(subOf(id)); }
    return { t, s, sub };
  };
  const waitSql = async (q, want, ms = 60000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = sql(q); if (want(v)) return v; await new Promise((r) => setTimeout(r, 1500)); }
    console.log("   ! waitSql timed out:", q.slice(0, 120));
    return sql(q);
  };

  /** The "Confirm with your bank" box for the latest payment on this piece. */
  const bankBox = (page, sub) => page.locator(`[data-bank-waiting="${sql(`select id from "Payment" where "submissionId" = '${sub}' order by "createdAt" desc limit 1`)}"]`).first();
  const waitAction = (sub) => waitSql(`select coalesce("actionPi", '') from "Payment" where "submissionId" = '${sub}' order by "createdAt" desc limit 1`, (v) => v.startsWith("pi_"), 60000);
  const paid = (sub) => waitSql(`select status from "Payment" where "submissionId" = '${sub}' order by "createdAt" desc limit 1`, (v) => v === "charged");

  // ======================= 1 and 2: payout accounts, and Pay with 4242 =======================
  group("st1", async () => {
    addSections();
    sec(ST_SEC);
    const dana = await account(`dev+stripe${TS}a@playtest.test`, "Dana Brooks", "developer", "they");
    const ana = await account(`tester+stripe${TS}a@playtest.test`, "Ana Silva", "tester", "they");
    const ben = await account(`tester+stripe${TS}b@playtest.test`, "Ben Okafor", "tester", "they");

    // The developer saves the test card 4242 in Stripe Checkout.
    {
      const pr = await pairRec(dana, dana, [], "Dana Brooks (developer)");
      const fa = pr.fromA(), fp = pr.fromP();
      await addCard(pr.app, "4242 4242 4242 4242", { name: dana.name });
      await pairShot(pr.app, pr.pan, "stripe-card-saved", "Card saved in Stripe Checkout | Dana's Payments after Stripe Checkout (setup mode, test card 4242 4242 4242 4242): the app shows the saved card, and Stripe (right, read from its API in test mode) has the customer with “Card on file: visa •••• 4242” and no payments yet.", "main");
      await pause(pr.app, 1500);
      await pairVideo(pr, fa, fp, "stripe-card-checkout", "Add a card | Dana presses Add a card, types the test card 4242 4242 4242 4242 into Stripe's own Checkout page (Link left unticked) and presses Save; back on Payments the card is saved, and Stripe's API (right) shows it on the customer.");
    }

    // Tester Ana: Stripe's hosted Express onboarding, then the account finished through the API.
    {
      const pr = await pairRec(ana, null, [ana], "Ana Silva (tester)");
      const fa = pr.fromA(), fp = pr.fromP();
      await pr.app.goto("/app/payments");
      await pause(pr.app, 1500);
      await pr.app.locator("button", { hasText: "Connect a payout account" }).click();
      await pr.app.waitForURL(/connect\.stripe\.com/, { timeout: 60000 });
      await pr.app.waitForTimeout(5000);
      await pairShot(pr.app, pr.pan, "stripe-connect-onboarding", "Stripe's Express onboarding | Connect a payout account opens Stripe's own onboarding in test mode (“You're using a test account with test data.”, “Use test phone number”); Stripe already made the Express account (right).");
      await pr.app.getByRole("button", { name: "Use test phone number" }).first().click().catch(() => {});
      await pr.app.waitForTimeout(5000);
      await pairShot(pr.app, pr.pan, "stripe-connect-captcha", "Stopped at Stripe's CAPTCHA | In the recording's automated browser Stripe answers “Use test phone number” with an hCaptcha puzzle; the recording doesn't solve CAPTCHAs, so it stops here and finishes the payout account through Stripe's API instead (next pictures).");
      await pause(pr.app, 1200);
      await pairVideo(pr, fa, fp, "stripe-connect-start", "Connect a payout account | Ana presses Connect a payout account and lands on Stripe's hosted Express onboarding in test mode; the automated browser is given an hCaptcha puzzle at the first step, so the hosted onboarding stops there.");
    }
    await connectApi(ana, true);
    await connectApi(ben, false);
    {
      const pr = await pairRec(ana, null, [ana, ben], "Ana Silva and Ben Okafor (testers)");
      const fa = pr.fromA(), fp = pr.fromP();
      await payoutReturn(pr.app);
      await pr.app.waitForSelector("main");
      await pause(pr.app, 1500);
      await pairShot(pr.app, pr.pan, "stripe-connect-ana-ready", "Ana's payouts are on | Ana's account finished with Stripe's test identity and bank values (through Stripe's API, a test Custom account); back on Payments (Stripe's return address) the app reads it from Stripe: Stripe shows “Payouts enabled · transfers active” (right).", "main");
      await pairVideo(pr, fa, fp, "stripe-connect-return", "Back from setup | Ana comes back to Payments the way Stripe's onboarding returns them; the app asks Stripe and turns the payout account on. Ben's account (right) is still unfinished.");
    }
    await payoutReturn(ben);
    await shot(ben, "stripe-connect-ben-pending", "Ben's setup isn't finished | Ben came back from Stripe before finishing: the app asked Stripe and the payout account isn't ready yet.", "main");

    // 2. Pay on written answers with 4242: the receipt, the PaymentIntent Succeeded, 80% to Ana; Ben paid before finishing setup (waiting).
    const w = await writtenTest(dana, [ana, ben], { productName: "Harbor Run", title: "Harbor Run: first 3 levels", writtenCents: "10.00" });
    {
      const pr = await pairRec(dana, dana, [ana, ben], "Dana Brooks pays Ana Silva and Ben Okafor (card 4242)");
      const fa = pr.fromA(), fp = pr.fromP();
      await testPage(pr.app, w.t);
      await pressPay(pr.app, w.sub[0]);
      await paid(w.sub[0]);
      await pause(pr.app, 4000);
      await pairShot(pr.app, pr.pan, "stripe-pay-4242", "Pay with 4242 | Dana presses Pay on Ana's written answers ($10.00): the app marks them paid, and Stripe shows the PaymentIntent “Succeeded” on visa •••• 4242, sent to Ana's connected account with a $2.00 platform fee, and the $10.00 transfer to Ana less that fee: Ana keeps $8.00, the 80%. Ana's answers leave Needs you; their row under Testers reads “paid $10.00 of $10.00”.", pr.app.locator("text=/paid \$10\.00 of \$10\.00/").first());
      await testPage(pr.app, w.t);
      await pressPay(pr.app, w.sub[1]);
      await paid(w.sub[1]);
      await pause(pr.app, 4000);
      await pairShot(pr.app, pr.pan, "stripe-pay-ben-waiting", "Paid before payout setup | Dana pays Ben's answers too: Stripe shows the second PaymentIntent “Succeeded” with no connected account (the money stays with the platform) and no transfer to Ben, because Ben's payout setup isn't finished.", pr.app.locator("text=/paid \$10\.00 of \$10\.00/").last());
      await pairVideo(pr, fa, fp, "stripe-pay-video", "Pay, twice | Dana pays Ana's and Ben's answers with the saved 4242 card; Stripe (right) shows each PaymentIntent arriving “Succeeded”: Ana's goes to their connected account with the platform's $2.00 fee, Ben's stays on the platform until Ben's setup is done.");
    }
    await openBell(dana);
    await shot(dana, "stripe-pay-receipt", "The receipt | Dana's bell after the two payments.", bellList(dana));
    await ana.goto("/app/payments");
    await pause(ana, 1500);
    await shot(ana, "stripe-pay-ana-earnings", "Ana's earnings | Ana's Payments after Dana's Pay.", "main");

    // 1. Ben finishes setup: the waiting $8.00 goes out on its own.
    {
      await ben.goto("/app/payments");
      const pr = await pairRec(ben, null, [ben], "Ben Okafor (tester)");
      const fa = pr.fromA(), fp = pr.fromP();
      await pr.app.goto("/app/payments");
      await pause(pr.app, 2000);
      await pairShot(pr.app, pr.pan, "stripe-waiting-before", "Waiting for setup | Ben's Payments before finishing payout setup: their $8.00 waits; Stripe (right) has no transfer to Ben.", "main");
      await finishConnect(ben); // Stripe then sends account.updated to the app (through `stripe listen`)
      await waitSql(`select "transferStatus" from "Payment" where "submissionId" = '${w.sub[1]}' order by "createdAt" desc limit 1`, (v) => v === "sent", 90000);
      await pause(pr.app, 4000);
      await pr.app.reload();
      await pause(pr.app, 2500);
      await pairShot(pr.app, pr.pan, "stripe-waiting-sent", "Sent when setup completes | Ben's account is finished (Stripe's test values, through its API); Stripe's account.updated webhook reaches the app, which sends the waiting $8.00 at once: Stripe shows the $8.00 transfer to Ben (right).", "main");
      await pairVideo(pr, fa, fp, "stripe-waiting-video", "Waiting, then sent | Ben's payout account is finished while their Payments is open; Stripe's webhook arrives and the app sends the $8.00 that waited: the transfer appears in Stripe (right).");
    }
    await openBell(ben);
    await shot(ben, "stripe-waiting-bell", "Ben's notice | “Your payout setup is done: $8.00 on its way.”", bellList(ben));
  }, { section: ST_SEC });

  /** Testers with finished payout accounts (through the API, as in st1), read back by the app. */
  const readyTesters = async (list) => { for (const t of list) { await connectApi(t, true); await payoutReturn(t); } };
  /** The inline bank check under a button: wait for Stripe's page inside it. */
  const bankFrame = async (page, ms = 60000) => {
    const box = page.locator("[data-bank-check=bank]").first();
    await box.waitFor({ timeout: ms });
    await box.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (page.frames().some((f) => /hooks\.stripe\.com|3d_secure/.test(f.url()))) {
        for (const f of page.frames()) if (await f.locator("#test-source-authorize-3ds").isVisible().catch(() => false)) return box;
      }
      await page.waitForTimeout(500);
    }
    return box;
  };


  // ======================= 3: Stripe's real 3D Secure frame (4000 0027 6000 3184) =======================
  group("st3", async () => {
    addSections();
    sec(ST_SEC);
    const cleo = await account(`dev+stripe${TS}c@playtest.test`, "Cleo Park", "developer", "they");
    const ana = await account(`tester+stripe${TS}ca@playtest.test`, "Ana Silva", "tester", "they");
    const ben = await account(`tester+stripe${TS}cb@playtest.test`, "Ben Okafor", "tester", "they");
    const cid = await account(`tester+stripe${TS}cc@playtest.test`, "Cid Moreau", "tester", "they");
    await readyTesters([ana, ben, cid]);
    {
      const pr = await pairRec(cleo, cleo, [], "Cleo Park (developer)");
      const fa = pr.fromA(), fp = pr.fromP();
      await addCard(pr.app, "4000 0027 6000 3184", { tds: true, name: cleo.name });
      await pairShot(pr.app, pr.pan, "stripe-3ds-card-saved", "A card that always asks the bank | Cleo saves the test card 4000 0027 6000 3184 in Stripe Checkout (Stripe's 3D Secure page opened inside Checkout and was completed); Stripe shows “Card on file: visa •••• 3184”.", "main");
      await pairVideo(pr, fa, fp, "stripe-3ds-checkout", "Saving the 3D Secure card | Cleo types 4000 0027 6000 3184 into Stripe Checkout; Stripe's own 3D Secure test page opens over Checkout, Cleo completes it, and the card is saved.");
    }
    const dee = await account(`tester+stripe${TS}cd@playtest.test`, "Dee Park", "tester", "they");
    const eve = await account(`tester+stripe${TS}ce@playtest.test`, "Eve Grant", "tester", "they");
    await readyTesters([dee, eve]);
    const w = await writtenTest(cleo, [ana, ben, cid, dee, eve], { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"], writtenCents: "10.00" });
    // App bug: Pay with a card that needs the bank's check loses the check (the piece leaves Needs you at once).
    {
      const pr = await pairRec(cleo, cleo, [ana, ben, cid, dee, eve], "Cleo Park presses Pay (card 3184)");
      const fa = pr.fromA(), fp = pr.fromP();
      await testPage(pr.app, w.t);
      await pressPay(pr.app, w.sub[3], { amount: "6.00", why: "Two of the answers were very short." });
      st.payFrame = await pr.app.locator("[data-bank-check=bank]").first().waitFor({ timeout: 20000 }).then(() => true, () => false);
      if (st.payFrame) {
        // The check shows under Pay: complete it here, and fail it on Eve's answers.
        await bankFrame(pr.app);
        await pairShot(pr.app, pr.pan, "stripe-3ds-pay-frame", "Stripe's real 3D Secure frame under Pay | Cleo presses Pay on Dee's answers ($6.00, with the reason Dee reads: “Two of the answers were very short.”): the bank's check opens right under the button, Stripe's own 3D Secure test page (“Complete” / “Fail”); meanwhile Stripe shows the PaymentIntent “Incomplete”.", "[data-bank-check=bank]");
        await threeDS(pr.app, true);
        await paid(w.sub[3]);
        await pause(pr.app, 4000);
        await pairShot(pr.app, pr.pan, "stripe-3ds-pay-done", "Completed: paid | After Complete on the bank's page the app marks Dee's answers paid ($6.00 of $10.00), and Stripe shows the PaymentIntent “Succeeded” with “3D Secure: authenticated” and the transfer to Dee.", pr.app.locator("text=/paid \\$6\\.00 of \\$10\\.00/").first());
        await testPage(pr.app, w.t);
        await pressPay(pr.app, w.sub[4]);
        await bankFrame(pr.app);
        await pause(pr.app, 1000);
        await threeDS(pr.app, false);
        await pause(pr.app, 6000);
        await pairShot(pr.app, pr.pan, "stripe-3ds-pay-failed", "Failed: nothing charged | Cleo presses Pay on Eve's answers and fails the bank's check (“Fail” on Stripe's test page): Stripe shows that PaymentIntent “Failed”, and nothing is charged.", piece(pr.app, w.sub[4]));
        await pairVideo(pr, fa, fp, "stripe-3ds-pay-video", "3D Secure under Pay | Pay on Dee's answers opens Stripe's real 3D Secure page under the button: Complete, and it's paid (Stripe: Succeeded). Pay on Eve's answers: Fail, and nothing is charged (Stripe: Failed).");
      } else {
      await waitAction(w.sub[3]);
      await pause(pr.app, 9000);
      await pr.app.evaluate(() => window.scrollTo(0, 0));
      await pairShot(pr.app, pr.pan, "stripe-bug-3ds-pay", "App bug: the bank's check under Pay disappears | Cleo presses Pay on Dee's answers with the 3D Secure card: Stripe made the PaymentIntent and waits for the check (“Incomplete”, right), but Dee's answers leave Needs you within seconds and the inline bank check goes with them (it lives in src/app/app/tests/[id]/PayBox.tsx), so Stripe's 3D Secure page never shows and the payment waits until it times out.", "main");
      await pairVideo(pr, fa, fp, "stripe-bug-3ds-pay-video", "App bug: 3D Secure under Pay | Cleo ticks and presses Pay on Dee's answers: Stripe answers that the bank wants a check (Incomplete), but the piece and its inline check vanish from the page, so there is nothing to complete.");
      }
    }
    for (const s of w.s.slice(0, 3)) openCharge(s, w.t);
    // The bank's check under “Confirm with your bank”, for charges the testers made while Cleo was away.
    await chargeUI(ana, w.s[0]);
    await waitAction(w.sub[0]);
    await pause(ana, 2000);
    await shot(ana, "stripe-away-tester-charge", "Ana charges | Ana presses Charge on their unpaid answers: Cleo's card needs the bank's check, so the payment waits for Cleo to confirm.", "main");
    await chargeUI(ben, w.s[1]);
    await waitAction(w.sub[1]);
    {
      const pr = await pairRec(cleo, cleo, [ana, ben, cid], "Cleo Park: Confirm with your bank (card 3184)");
      const fa = pr.fromA(), fp = pr.fromP();
      await testPage(pr.app, w.t);
      let box = bankBox(pr.app, w.sub[0]);
      await pairShot(pr.app, pr.pan, "stripe-3ds-waiting", "Charged while away: the bank wants a check | Ana's and Ben's Charges were made off-session and Stripe asked for authentication: Cleo's test page shows “Confirm with your bank” on each, and Stripe shows both PaymentIntents “Incomplete”.", box);
      await box.locator("button", { hasText: "Confirm with your bank" }).click();
      await bankFrame(pr.app);
      await pairShot(pr.app, pr.pan, "stripe-3ds-frame", "Stripe's real 3D Secure frame | Confirm with your bank opens Stripe's own 3D Secure test page inline, under the button (“Complete” / “Fail”).", "[data-bank-check=bank]");
      await threeDS(pr.app, true);
      await paid(w.sub[0]);
      await pause(pr.app, 3500);
      await pairShot(pr.app, pr.pan, "stripe-3ds-done", "Completed: paid | After Complete on the bank's page, Ana's charge goes through: the app shows it paid, and Stripe shows the PaymentIntent “Succeeded” with “3D Secure: authenticated” and the transfer to Ana.", pr.app.locator("text=/paid \$10\.00 of \$10\.00/").first());
      await testPage(pr.app, w.t);
      box = bankBox(pr.app, w.sub[1]);
      await box.locator("button", { hasText: "Confirm with your bank" }).click();
      await bankFrame(pr.app);
      await pause(pr.app, 1000);
      await threeDS(pr.app, false);
      await pause(pr.app, 6000);
      await pairShot(pr.app, pr.pan, "stripe-3ds-failed", "Failed: nothing charged | On Ben's charge the bank's check is failed (“Fail” on Stripe's test page): the app says the bank didn't confirm it and nothing was charged; Stripe shows that PaymentIntent “Failed”.", box);
      await pairVideo(pr, fa, fp, "stripe-3ds-video", "3D Secure, complete and fail | Confirm with your bank on Ana's charge opens Stripe's real 3D Secure page: Complete, and it's paid (Stripe: Succeeded). On Ben's charge: Fail, and nothing is charged (Stripe: Failed).");
    }
    // Confirm stops once for the changes (Ana's dispute, another tab's payment), then the second press opens the bank's check.
    await chargeUI(cid, w.s[2]);
    await waitAction(w.sub[2]);
    {
      const pr = await pairRec(cleo, cleo, [ana, ben, cid], "Cleo Park: Confirm stops once");
      const fa = pr.fromA(), fp = pr.fromP();
      await testPage(pr.app, w.t);
      const box = bankBox(pr.app, w.sub[2]);
      await box.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await pause(pr.app, 1500);
      ok(await sessionDo(dee, w.s[3], "dispute", { kind: "submission", id: w.sub[3], reason: "I answered every question in full." }), "dispute");
      // Another tab: Cleo pays what Ben's charge needs (Confirm with your bank there, completed).
      const D2 = await same(cleo);
      await testPage(D2, w.t);
      const b2 = bankBox(D2, w.sub[1]);
      const again = b2.locator("button", { hasText: "Confirm with your bank" });
      if (await again.count()) {
        await again.click();
        await bankFrame(D2);
        await threeDS(D2, true);
        await waitSql(`select status from "Payment" where "submissionId" = '${w.sub[1]}' and status = 'charged' limit 1`, (v) => v === "charged", 60000);
      } else console.log("   ! Ben's charge has no Confirm with your bank after the failed check:", (await b2.innerText()).replace(/\s+/g, " ").slice(0, 300));
      await D2.context().close();
      await pause(pr.app, 2000);
      await box.locator("button", { hasText: "Confirm with your bank" }).click();
      await box.locator("text=/again to go ahead/").waitFor({ timeout: 30000 }).catch(() => console.log("   ! no stop box"));
      await pause(pr.app, 1500);
      await pairShot(pr.app, pr.pan, "stripe-away-stop", "Confirm stops once | Since Cleo's page opened, Dee disputed and another tab confirmed Ben's charge (Stripe shows it “Succeeded”): the first press of Confirm with your bank on Cid's charge stops once in the blue box under it.", box);
      await box.locator("button", { hasText: "Confirm with your bank" }).click();
      await bankFrame(pr.app);
      await pairShot(pr.app, pr.pan, "stripe-away-frame", "The second press opens the check | The second press opens Stripe's real 3D Secure page inline, under the button.", "[data-bank-check=bank]");
      await threeDS(pr.app, true);
      await paid(w.sub[2]);
      await pause(pr.app, 3500);
      await pairShot(pr.app, pr.pan, "stripe-away-done", "Confirmed: paid | Cid's charge went through after the bank's check: the app shows it paid and Stripe shows the PaymentIntent “Succeeded” with the transfer to Cid.", pr.app.locator("text=/paid \$10\.00 of \$10\.00/").last());
      await pairVideo(pr, fa, fp, "stripe-away-video", "Confirm with your bank stops once | Cid's Charge waits for Cleo's bank. Meanwhile Dee disputes and another tab confirms Ben's charge; Confirm with your bank on Cid's stops once, the second press opens Stripe's 3D Secure page, Cleo completes it, and Stripe shows the payment Succeeded.");
    }
  }, { section: ST_SEC });

  // ======================= 4: a declined card (0341), the payment hold, a Charge added, the retries =======================
  group("st4", async () => {
    addSections();
    sec(ST_SEC);
    const eli = await account(`dev+stripe${TS}e@playtest.test`, "Eli Navarro", "developer", "they");
    const fay = await account(`tester+stripe${TS}ef@playtest.test`, "Fay Lin", "tester", "they");
    const gus = await account(`tester+stripe${TS}eg@playtest.test`, "Gus Adler", "tester", "they");
    await readyTesters([fay, gus]);
    await addCard(eli, "4000 0000 0000 0341", { name: eli.name });
    const w = await writtenTest(eli, [fay, gus], { productName: "Tide Tracker", title: "Tide Tracker: widgets", categories: ["Productivity"], writtenCents: "10.00" });
    {
      const pr = await pairRec(eli, eli, [fay, gus], "Eli Navarro (card 0341: declines on charge)");
      const fa = pr.fromA(), fp = pr.fromP();
      await pr.app.goto("/app/payments");
      await pause(pr.app, 2500);
      await testPage(pr.app, w.t);
      await pressPay(pr.app, w.sub[0]);
      await waitSql(`select coalesce("holdStartedAt"::text, '') from "User" where id = '${eli.uid}'`, (v) => !!v, 60000);
      await pause(pr.app, 3000);
      await pairShot(pr.app, pr.pan, "stripe-decline-pay", "Declined under Pay | The answer under Pay on Fay's answers after Stripe declined the 0341 card; Stripe shows the PaymentIntent “Failed” (declined: generic_decline).", piece(pr.app, w.sub[0]));
      await pr.app.goto("/app");
      await pause(pr.app, 3000);
      await pairShot(pr.app, pr.pan, "stripe-decline-hold", "Declined: a payment hold | Eli presses Pay on Fay's answers; the card (test card 4000 0000 0000 0341: saved fine, declines on charge) is declined, so Eli's account goes on a payment hold. Stripe shows the PaymentIntent “Failed” (declined: generic_decline). The dashboard opens with the blue box about the hold, and the test card reads “Paused: payment hold” and “Payment failed”.", "[data-restricted-box]");
      openCharge(w.s[1], w.t);
      await chargeUI(gus, w.s[1]);
      await waitSql(`select status from "Payment" where "submissionId" = '${w.sub[1]}' order by "createdAt" desc limit 1`, (v) => !!v, 60000);
      await pr.app.goto("/app/payments");
      await pr.app.waitForSelector("#owed");
      await pause(pr.app, 3500);
      await pairShot(pr.app, pr.pan, "stripe-decline-charge-added", "A Charge during the hold is added | Gus presses Charge during the hold: it's added to what Eli owes (Payments lists both) and nothing is sent to Stripe; Stripe still shows only Fay's failed PaymentIntent.", "#owed");
      await pairVideo(pr, fa, fp, "stripe-decline-video", "Declined, then added | Eli's Pay on Fay's answers is declined by Stripe (Failed) and Eli's account goes on a payment hold; Gus's Charge during the hold is added to what's owed with no new payment in Stripe.");
    }
    await fay.goto(`/app/sessions/${w.s[0]}`);
    await pause(fay, 2000);
    await shot(fay, "stripe-decline-fay", "Fay's side | Fay's session page after the declined payment (testers never read “hold” or “declined” about a developer).", "main");
    {
      const pr = await pairRec(eli, eli, [fay, gus], "Eli Navarro: automatic retries");
      const fa = pr.fromA(), fp = pr.fromP();
      await pr.app.goto("/app/payments");
      await pr.app.waitForSelector("#owed");
      await pause(pr.app, 2500);
      console.log("   retry:", appfn("retry", eli.email));
      await pause(pr.app, 2000);
      await pr.app.reload();
      await pr.app.waitForSelector("#owed");
      await pause(pr.app, 3000);
      await pairShot(pr.app, pr.pan, "stripe-retry-declined", "The automatic retry declines | The daily automatic retry runs (the app's own retry, for this account only): Stripe shows two more PaymentIntents “Failed” on •••• 0341, and Payments shows the last try and the next one, with what's owed unchanged.", "#owed");
      await addCard(pr.app, "4242 4242 4242 4242", { name: eli.name });
      await waitSql(`select coalesce("holdStartedAt"::text, 'none') from "User" where id = '${eli.uid}'`, (v) => v === "none", 60000);
      await pr.app.goto("/app/payments");
      await pause(pr.app, 3500);
      await pairShot(pr.app, pr.pan, "stripe-retry-paid", "The card change pays what's owed | Eli changes the card to 4242 in Stripe Checkout and the app retries what's owed at once: Stripe shows two PaymentIntents “Succeeded” on •••• 4242 (to Fay's and Gus's accounts), nothing is owed any more and the hold is lifted.", "main");
      await pairVideo(pr, fa, fp, "stripe-retry-video", "Retries | The daily retry declines on 0341 (two more Failed in Stripe); Eli changes the card to 4242 in Stripe Checkout and the app retries at once: both payments Succeeded, nothing is owed and the hold lifts.");
    }
    await openBell(eli);
    await shot(eli, "stripe-retry-bell", "One bell line for the retry | Eli's bell after the retry.", bellList(eli));
  }, { section: ST_SEC });

  // ======================= 5: chargeback (0259) → chargeback hold, reservation, Approve; Don't approve; expiry =======================
  /** Verify a card on the chargeback steps through the page: Verify a card should show Stripe's card form (Payment Element). True when the form appeared. */
  const verifyFormUI = async (P) => {
    await P.goto("/app/payments");
    await P.waitForSelector("[data-chargeback-steps]");
    await pause(P, 3000);
    await P.locator("[data-chargeback-steps] button", { hasText: "Verify a card" }).click();
    return P.locator("[data-chargeback-steps] iframe").first().waitFor({ timeout: 20000 }).then(() => true, () => false);
  };
  /**
   * App bug workaround: the page's card form never mounts, so the same check is driven through the app's own route (/api/payments/verify-card): the SetupIntent
   * with request_three_d_secure "any", confirmed with Stripe's test card that always asks the bank (pm_card_authenticationRequired = 4000 0027 6000 3184), the
   * bank's real 3D Secure page (opened in this page, completed), then the app's finish step. Returns once the app counts the card as verified.
   */
  const verifyViaApi = async (P, onBankPage) => {
    const a = ok(await post(P, "/api/payments/verify-card", { check: true }), "verify start");
    const b = ok(await post(P, "/api/payments/verify-card", { setupIntent: a.setupIntentId, paymentMethod: "pm_card_authenticationRequired" }), "verify confirm");
    if (b.checkUrl) {
      await P.goto(b.checkUrl);
      await P.waitForTimeout(3000);
      if (onBankPage) await onBankPage();
      await threeDS(P, true);
      await P.waitForTimeout(3000);
    }
    ok(await post(P, "/api/payments/verify-card", { setupIntent: a.setupIntentId, finish: true }), "verify finish");
    await P.goto("/app/payments");
    await P.waitForSelector("[data-chargeback-steps]");
    await pause(P, 2500);
  };
  const reserveReal = async (P) => {
    await P.goto("/app/payments");
    await P.waitForSelector("#owed");
    await pause(P, 2500);
    await P.locator("#owed button:not([disabled])", { hasText: /Pay what you owe/ }).click();
  };
  const cbRow2 = async (A, uid) => {
    await A.goto(`/admin?at=${Date.now()}#chargebacks`);
    const sel = `[data-chargeback-hold="${uid}"]`;
    await pageTo(A, "chargebacks", sel);
    const row = A.locator(sel).first();
    await row.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await pause(A, 900);
    return row;
  };
  /** A developer with the 0259 card, a tester paid: Stripe opens a dispute on that payment, and the webhook starts the chargeback hold. */
  const disputedDev = async (key, devName, testerName) => {
    const dev = await account(`dev+stripe${TS}${key}@playtest.test`, devName, "developer", "they");
    const tester = await account(`tester+stripe${TS}${key}t@playtest.test`, testerName, "tester", "they");
    await readyTesters([tester]);
    await addCard(dev, "4000 0000 0000 0259", { name: devName });
    const w = await writtenTest(dev, [tester], { productName: "Harbor Run", title: "Harbor Run: first 3 levels", writtenCents: "10.00" });
    return { dev, tester, w };
  };
  group("st5", async () => {
    addSections();
    sec(ST_SEC);
    const admin = await adminAccount();
    const { dev: hal, tester: ivy, w } = await disputedDev("h", "Hal Bishop", "Ivy Chen");
    {
      const pr = await pairRec(hal, hal, [ivy], "Hal Bishop (card 0259: a dispute follows the charge)");
      const fa = pr.fromA(), fp = pr.fromP();
      await pr.app.goto("/app/payments");
      await pause(pr.app, 2000);
      // (Pay fails on real Stripe, see stripe-bug-pay: the payment is Ivy's Charge, made off-session.)
      openCharge(w.s[0], w.t);
      await chargeUI(ivy, w.s[0]);
      await paid(w.sub[0]);
      await pr.app.reload();
      await pause(pr.app, 3000);
      await pairShot(pr.app, pr.pan, "stripe-cb-paid", "Paid with 0259 | Ivy charges Hal for their answers; Hal's card is the test card 4000 0000 0000 0259: Stripe shows the PaymentIntent “Succeeded”, and this test card makes the bank dispute it moments later.", "main");
      await waitSql(`select coalesce("holdReason", '') from "User" where id = '${hal.uid}'`, (v) => v === "chargeback", 120000);
      await pr.app.goto("/app/payments");
      await pr.app.waitForSelector("[data-chargeback-steps]");
      await pause(pr.app, 3000);
      await pairShot(pr.app, pr.pan, "stripe-cb-hold", "The dispute arrives: chargeback hold | Stripe opened a dispute (fraudulent, needs response) and sent charge.dispute.created; the app puts Hal on a chargeback hold with its three steps and what's owed ($10.00 + the $15 fee). Stripe shows the payment “Disputed”.", "[data-chargeback-steps]");
      await pairVideo(pr, fa, fp, "stripe-cb-video", "A dispute starts a chargeback hold | Hal pays with 0259 (Succeeded); moments later Stripe's dispute reaches the app through the webhook and Payments turns into the chargeback steps.");
    }
    // No automatic retry during a chargeback hold.
    console.log("   retry during the chargeback hold:", appfn("retry", hal.email));
    {
      const pr = await pairRec(hal, hal, [ivy], "Hal Bishop: verify, then reserve");
      const fa = pr.fromA(), fp = pr.fromP();
      const formOk = await verifyFormUI(pr.app);
      if (!formOk) {
        await pause(pr.app, 1500);
        await pr.app.locator("[data-chargeback-steps] button", { hasText: "Verify this card" }).click().catch(() => {});
        await pause(pr.app, 4000);
        await pairShot(pr.app, pr.pan, "stripe-bug-verify-form", "App bug: no card form under Verify a card | No automatic retry ran during the chargeback hold (the daily retry did nothing; Stripe has no new payment). Hal presses Verify a card: the button turns into “Verify this card” but Stripe's card form never appears (src/components/ChargebackSteps.tsx: the Payment Element is never mounted), and pressing it says “Could not find a ready element to create a payment method from.”", "[data-chargeback-steps]");
      }
      // The same check through the app's own route (the card form is missing): Stripe's real 3D Secure page, completed.
      await verifyViaApi(pr.app, () => pairShot(pr.app, pr.pan, "stripe-cb-verify-frame", "The bank's real 3D Secure page | The card check through the app's own route (the page's form is missing): Stripe asks the bank for test card 4000 0027 6000 3184, and its 3D Secure test page opens (“Complete” / “Fail”)."));
      await pairShot(pr.app, pr.pan, "stripe-cb-verified", "Card verified | After Complete, the app's finish step reads the SetupIntent from Stripe: “A card verified with 3D Secure” is ticked and Pay what you owe can be pressed.", "[data-chargeback-steps]");
      await reserveReal(pr.app).catch(() => {});
      st.reserved = await pr.app.waitForSelector("text=/Reserved \\$/", { timeout: 15000 }).then(() => true, () => false);
      if (!st.reserved && (await threeDS(pr.app, true, 15000))) st.reserved = await pr.app.waitForSelector("text=/Reserved \\$/", { timeout: 45000 }).then(() => true, () => false);
      if (!st.reserved) {
        await pause(pr.app, 3000);
        const owedText = (await pr.app.locator("#owed").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400);
        console.log("   ! no reservation:", owedText);
        await pairShot(pr.app, pr.pan, "stripe-bug-reserve", `App bug: Pay what you owe didn't reserve | Pay what you owe during the chargeback hold should reserve what's owed on the card (Stripe: Uncaptured); here the box reads: “${owedText.slice(-200)}” and Stripe shows no reservation (right).`, "#owed");
        await pairVideo(pr, fa, fp, "stripe-cb-verify-video", "Verify, then Pay what you owe | Hal verifies a card with Stripe's card form and the bank's real 3D Secure page (the step is ticked); Pay what you owe then doesn't reserve anything (app bug).");
        return;
      }
      await pr.app.reload();
      await pause(pr.app, 3000);
      await pairShot(pr.app, pr.pan, "stripe-cb-reserved", "Reserved: Uncaptured | Pay what you owe (after the bank's check) reserves the $25.00 on the card: the app shows the reserved line, and Stripe shows a manual-capture PaymentIntent “Uncaptured”.", "#owed");
      await pairVideo(pr, fa, fp, "stripe-cb-reserve-video", "Verify, then reserve | Hal verifies a card with Stripe's 3D Secure page, then presses Pay what you owe: the bank's check again, and the amount is reserved (Stripe: Uncaptured), not taken.");
    }
    {
      const pr = await pairRec(admin, hal, [ivy], "The team's Approve");
      const fa = pr.fromA(), fp = pr.fromP();
      const row = await cbRow2(pr.app, hal.uid);
      await pairShot(pr.app, pr.pan, "stripe-cb-admin-row", "The team's row | The admin console's chargeback row for Hal: card verified ✓ and what's owed reserved ✓, with Approve; Stripe shows the reservation “Uncaptured”.", row);
      await row.locator("button", { hasText: /^Approve$/ }).click();
      await waitSql(`select count(*) from "Reservation" where "developerId" = '${hal.uid}' and status = 'captured'`, (v) => Number(v) > 0, 60000);
      await pause(pr.app, 3500);
      await pairShot(pr.app, pr.pan, "stripe-cb-approved", "Approve takes it | Approve captures the reservation and lifts the hold in one step: Stripe shows the same PaymentIntent “Succeeded”.", "main");
      await pairVideo(pr, fa, fp, "stripe-cb-approve-video", "Approve | The team presses Approve on Hal's row: the reservation is captured (Stripe: Uncaptured → Succeeded) and the hold lifts.");
    }
    await openBell(hal);
    await shot(hal, "stripe-cb-notice", "The single notice | Hal's bell: one line, “The team approved lifting your hold: the $25.00 reserved on your card was taken, and your tests are running again.”", bellList(hal));

    // Don't approve (released: Canceled), then a reservation that expires.
    const { dev: jo, tester: kai, w: w2 } = await disputedDev("j", "Jo Rivera", "Kai Moss");
    openCharge(w2.s[0], w2.t);
    await chargeUI(kai, w2.s[0]);
    await waitSql(`select coalesce("holdReason", '') from "User" where id = '${jo.uid}'`, (v) => v === "chargeback", 120000);
    await verifyViaApi(jo);
    await reserveReal(jo);
    await threeDS(jo, true);
    await jo.waitForSelector("text=/Reserved \\$/", { timeout: 60000 }).catch(() => console.log("   ! no reserved line"));
    {
      const pr = await pairRec(admin, jo, [kai], "The team: Don't approve");
      const fa = pr.fromA(), fp = pr.fromP();
      let row = await cbRow2(pr.app, jo.uid);
      const span = row.locator("span", { has: pr.app.locator("button", { hasText: "Don't approve" }) }).last();
      const why = span.locator("textarea, input").first();
      if (await why.count()) await why.fill("The bank's case is still open.");
      await pause(pr.app, 1200);
      await span.locator("button", { hasText: "Don't approve" }).click();
      await waitSql(`select count(*) from "Reservation" where "developerId" = '${jo.uid}' and status = 'cancelled'`, (v) => Number(v) > 0, 60000);
      await pause(pr.app, 3500);
      row = await cbRow2(pr.app, jo.uid);
      await pairShot(pr.app, pr.pan, "stripe-cb-declined", "Don't approve releases it | The team presses Don't approve: the reservation is released and nothing is taken; Stripe shows that PaymentIntent “Canceled”.", row);
      await pairVideo(pr, fa, fp, "stripe-cb-decline-video", "Don't approve | The team presses Don't approve on Jo's row: the authorization is cancelled (Stripe: Uncaptured → Canceled), and the hold stays.");
    }
    await reserveReal(jo);
    await threeDS(jo, true);
    await jo.waitForSelector("text=/Reserved \\$/", { timeout: 60000 }).catch(() => console.log("   ! no reserved line"));
    {
      const pr = await pairRec(jo, jo, [kai], "Jo Rivera: a reservation that expires");
      const fa = pr.fromA(), fp = pr.fromP();
      await pr.app.goto("/app/payments");
      await pause(pr.app, 2500);
      const r = sql(`select id || '|' || coalesce("stripePaymentIntentId", '') from "Reservation" where "developerId" = '${jo.uid}' and status = 'reserved' order by "createdAt" desc limit 1`).split("|");
      // Stripe can't be fast-forwarded: the authorization is cancelled through the API as Stripe does when it lapses, and the app's date moved.
      await stripe.paymentIntents.cancel(r[1]);
      own(`update "Reservation" set "expiresAt" = ${U} - interval '1 minute' where id = '${r[0]}'`);
      await pause(pr.app, 2500);
      await pr.app.reload();
      await pr.app.waitForSelector("[data-reserve-expired]", { timeout: 30000 }).catch(() => console.log("   ! no expired line"));
      await pause(pr.app, 2500);
      await pairShot(pr.app, pr.pan, "stripe-cb-expired", "The reservation expired | Stripe can't be fast-forwarded 7 days: the authorization was cancelled through Stripe's API as Stripe does when it lapses, and the app's expiry date moved; Payments says “Your reservation expired…” and Stripe shows “Canceled”.", "#owed");
      await pairVideo(pr, fa, fp, "stripe-cb-expire-video", "Expiry | The authorization is cancelled through Stripe's API (as at its 7-day lapse) and the app's date moved: Jo's Payments shows the reservation expired and asks for Pay what you owe again.");
    }
    const row = await cbRow2(admin, jo.uid);
    await shot(admin, "stripe-cb-expired-admin", "The team's row: Reservation expired | The admin's chargeback row for Jo says “Reservation expired”.", row);
  }, { section: ST_SEC });

  // The picture after Approve, from the developer's side (the admin console scrolls away from the row once it's approved).
  group("st5x", async () => {
    addSections();
    sec(ST_SEC);
    const email = process.env.ST5X_DEV, temail = process.env.ST5X_TESTER;
    if (!/@playtest.test$/.test(email || "") || !/@playtest.test$/.test(temail || "")) throw new Error("ST5X_DEV / ST5X_TESTER: this run's throwaway accounts");
    const D = await ctx(V);
    ok(await post(D, "/api/auth/login", { email, password: PASSWORD }), "login");
    const pr = await pairRec(D, { email }, [{ email: temail }], "Hal Bishop after the team's Approve");
    await pr.app.goto("/app/payments");
    await pause(pr.app, 3000);
    await pairShot(pr.app, pr.pan, "stripe-cb-approved", "Approve takes it | Approve captured the reservation and lifted the hold in one step: Hal's Payments no longer shows the chargeback steps, and Stripe shows the same $25.00 PaymentIntent “Succeeded” (“captured $25.00”).", "main");
  }, { section: ST_SEC });

  // ======================= 6: subscription (not run on Oct 29: the subscription code still expects the old invoice shape; the coordinator asked to skip it) =======================
  group("st6", async () => {
    addSections();
    sec(ST_SEC);
    const kit = await account(`dev+stripe${TS}k@playtest.test`, "Kit Ward", "developer", "they");
    await addCard(kit, "4242 4242 4242 4242", { name: kit.name });
    const pr = await pairRec(kit, kit, [], "Kit Ward: Subscribe");
    const fa = pr.fromA(), fp = pr.fromP();
    await pr.app.goto("/app/payments");
    await pause(pr.app, 2500);
    await pr.app.locator("button", { hasText: /Subscribe for \$7\/month/ }).click();
    await pause(pr.app, 8000);
    await pairShot(pr.app, pr.pan, "stripe-sub-subscribe", "Subscribe | Kit presses Subscribe for $7/month with the 4242 card.", "#subscription");
    const subId = sql(`select coalesce("subscriptionId", '') from "User" where id = '${kit.uid}'`);
    if (subId.startsWith("sub_")) {
      // The renewal: Stripe can't be fast-forwarded a month, so the billing date is moved to now through Stripe's API (Stripe then bills and sends invoice.paid).
      await stripe.subscriptions.update(subId, { billing_cycle_anchor: "now", proration_behavior: "none" });
      await pause(pr.app, 8000);
      await pr.app.reload();
      await pause(pr.app, 3000);
      await pairShot(pr.app, pr.pan, "stripe-sub-renewed", "The renewal | The billing date was moved to now through Stripe's API (a month can't be fast-forwarded): Stripe bills the renewal and sends invoice.paid, and the app records it.", "#subscription");
    }
    await pairVideo(pr, fa, fp, "stripe-sub-video", "Subscribe | Kit subscribes for $7/month on the saved 4242 card.");
  }, { section: ST_SEC });

  // ======================= 7: real emails through Resend (the 3460 server started with EMAIL=1: resend-guard.cjs lets only marchanna111+pt…@gmail.com through, 15 at most) =======================
  group("em", async () => {
    addSections();
    sec(EM_SEC);
    const LOGF = path.join(process.env.MEDIA_STRIPE_LOGS || path.join(__dirname, "media-stripe", "logs"), "resend-sends.jsonl");
    const sends = () => (fs.existsSync(LOGF) ? fs.readFileSync(LOGF, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
    const seen = new Set(sends().map((x) => JSON.stringify(x)));
    /** The next email the app sent to `to` (from the guard's log: its Resend id and subject). */
    const nextId = async (to, ms = 90000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        for (const s of sends()) {
          const k = JSON.stringify(s);
          if (seen.has(k)) continue;
          if (s.refused) { seen.add(k); console.log("   ! guard refused an email:", s.why, s.subject); continue; }
          if (s.sent && s.id && [].concat(s.to).includes(to)) { seen.add(k); console.log(`   email ${s.n}: ${s.subject} -> ${s.id}`); return s; }
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      throw new Error("no email to " + to);
    };
    const tag = String(T0).slice(-7);
    const devEmail = `marchanna111+ptdev${tag}@gmail.com`, testerEmail = `marchanna111+pttester${tag}@gmail.com`;
    const mine = (q) => { if (!q.includes(lit(devEmail)) && !q.includes(lit(testerEmail))) throw new Error("not this part's own accounts"); return sql(q); };
    const emailPage = async (id) => { const c = await browser.newContext({ ...PANEL_V }); const p = await c.newPage(); await p.goto(`${VIEW}/email?id=${encodeURIComponent(id)}`); await p.waitForTimeout(1500); return p; };
    const ids = [];

    // 1. A sign-up through the form: the confirmation email.
    sql(`delete from "LoginAttempt" where kind = 'signup' and ip in ('::1', '127.0.0.1', '::ffff:127.0.0.1')`);
    const D = await ctx(V);
    D.email = devEmail; D.name = "Marc Tester Dev";
    await D.goto("/signup");
    await D.locator("input[name=role][value=developer]").check();
    await D.fill("#name", D.name);
    await D.fill("#email", devEmail);
    await D.fill("#password", PASSWORD);
    await D.check("#acceptTerms");
    await D.check("#over18");
    await pause(D, 600);
    await D.locator("form button.btn.w-full").last().click();
    await D.waitForURL((u) => !/\/signup/.test(u.pathname), { timeout: 60000 });
    await pause(D, 2500);
    const e1 = await nextId(devEmail);
    ids.push(e1.id);
    let E = await emailPage(e1.id);
    await pairShot(D, E, "email-real-signup", `The sign-up confirmation, really sent | Left: the app right after the sign-up form (the owner's alias ${devEmail}). Right: the same email read back from Resend's API by its id, “${e1.subject}”, with Resend's status.`, "main");
    await E.context().close();
    D.uid = userId(devEmail);
    mine(`update "User" set "emailVerifiedAt" = ${U} where email = ${lit(devEmail)}`); // (the email's link confirms it; the recording doesn't open the owner's inbox)
    await post(D, "/api/profile", { name: D.name, pronoun: "they", isDeveloper: true, isTester: false, devices: ["Windows PC"], languages: ["English"], categories: [] });
    // The tester (through the sign-up API: a second confirmation email).
    const T = await ctx(V);
    ok(await post(T, "/api/auth/signup", { email: testerEmail, password: PASSWORD, role: "tester", name: "Marc Tester", acceptTerms: true, over18: true }), "tester sign-up");
    const e2 = await nextId(testerEmail);
    ids.push(e2.id);
    T.email = testerEmail; T.name = "Marc Tester"; T.uid = userId(testerEmail);
    mine(`update "User" set "emailVerifiedAt" = ${U} where email = ${lit(testerEmail)}`);
    await post(T, "/api/profile", { name: T.name, pronoun: "they", isDeveloper: false, isTester: true, devices: ["Windows PC"], languages: ["English"], categories: [] });
    const a = await stripe.accounts.create({ type: "custom", country: "US", email: testerEmail, business_type: "individual", capabilities: { transfers: { requested: true } }, business_profile: { mcc: "5734", url: "https://playtest-tester.dev", product_description: "Testing games and apps" }, metadata: { recording: "stripe-media" }, ...FULL(T) });
    mine(`update "User" set "stripeAccountId" = '${a.id}' where email = ${lit(testerEmail)}`);
    await payoutReturn(T);

    // 2. A charge made while away that the bank wants confirmed: "Your bank wants you to confirm" (in the developer's email).
    await addCard(D, "4000 0027 6000 3184", { tds: true, name: D.name });
    const w = await writtenTest(D, [T], { productName: "Harbor Run", title: "Harbor Run: first 3 levels", writtenCents: "10.00" });
    openCharge(w.s[0], w.t);
    await chargeUI(T, w.s[0]);
    await waitAction(w.sub[0]);
    console.log("   summaries (developer):", appfn("summaries", devEmail, ["email=1"]));
    const e3 = await nextId(devEmail);
    ids.push(e3.id);
    await openBell(D);
    E = await emailPage(e3.id);
    await pairShot(D, E, "email-real-bank", `“Your bank wants you to confirm”, really sent | Left: the developer's bell with the bank-confirmation line. Right: their email “${e3.subject}” read back from Resend, carrying that line.`, bellList(D));
    await E.context().close();

    // 3. Confirmed (Stripe's 3D Secure page): the receipt (developer) and the paid line (tester).
    await testPage(D, w.t);
    await bankBox(D, w.sub[0]).locator("button", { hasText: "Confirm with your bank" }).click();
    await bankFrame(D);
    await threeDS(D, true);
    await paid(w.sub[0]);
    mine(`update "User" set "lastSummaryAt" = ${U} - interval '2 days' where email = ${lit(devEmail)}`); // (the next day's email, without waiting a day)
    console.log("   summaries (developer):", appfn("summaries", devEmail, ["email=1"]));
    const e4 = await nextId(devEmail);
    ids.push(e4.id);
    console.log("   summaries (tester):", appfn("summaries", testerEmail, ["email=1"]));
    const e5 = await nextId(testerEmail);
    ids.push(e5.id);
    await openBell(D);
    E = await emailPage(e4.id);
    await pairShot(D, E, "email-real-receipt", `The payment receipt, really sent | Left: the developer's bell after confirming with the bank. Right: their next email “${e4.subject}” from Resend, with the receipt line.`, bellList(D));
    await E.context().close();
    await openBell(T);
    E = await emailPage(e5.id);
    await pairShot(T, E, "email-real-paid", `The tester's paid line, really sent | Left: the tester's bell. Right: their email “${e5.subject}” from Resend, with the paid line.`, bellList(T));
    await E.context().close();

    // Resend's status for every email id (sent, then delivered).
    await new Promise((r) => setTimeout(r, 45000));
    const S = await browser.newContext({ viewport: { width: 1280, height: 900 } }).then((c) => c.newPage());
    await S.goto(`${VIEW}/emails?ids=${ids.join(",")}`);
    await S.waitForTimeout(4000);
    await S.screenshot({ path: path.join(OUT, `email-real-status${SFX}.png`) });
    record(`email-real-status${SFX}.png`, `Resend's status for each email | All ${ids.length} emails of this part, each by its Resend id, read from Resend's API (GET /emails/{id}): subject, recipient (the owner's own +pt aliases) and Resend's last event.`, "image");
    console.log("   statuses:", JSON.stringify(await (await fetch(`${VIEW}/emails-data?ids=${ids.join(",")}`)).json()).replace(/marchanna111\+/g, "…+").slice(0, 1500));
  }, { section: EM_SEC });
}
