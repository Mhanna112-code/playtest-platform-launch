// E. The account pages (Profile, Notifications, Payments, Account) for a developer and a tester: the kept box "Changed in another tab or device since you opened
// this page:" with real lines, each from another page or Stripe (one page at a time: the same page can't be open twice, except a copy whose claim failed).
// F. Edit's Save: its kept box (the team's pause since Edit opened; access keys), and the "Before / Now / What you typed" box through a copy whose claim failed.
// J. Home: Confirm all with your bank (kept box), the Calls box's Cancel while restricted (kept box).
/* eslint-disable */
const X = require("../lib.cjs");
const { pause, center, lines, waitLive, waitPulse, visible, textOf, sql, own, utcNow, post, ok, go, nowIso } = X;
const { pair, toTop, saveEdit } = require("../common.cjs");
const NEWPW = "harbor-run-new-pass-2026";
const box = async (P, label) => {
  const b = await X.texts(P, P.locator("[data-stop-box]"));
  console.log(`   [${label}] boxes: ${JSON.stringify(b.map((x) => x.slice(0, 400)))}`);
  return b;
};
/** Two recorded tabs of one person (one browser): left and right. */
async function tabs(who, l, r, labels) {
  const L = await X.recPage(who, `${who.name} · ${labels[0]}`);
  const R = await X.recTab(L, `${who.name} · ${labels[1]}`);
  await Promise.all([L.goto(l), R.goto(r)]);
  await L.waitForSelector("main h1");
  await R.waitForSelector("main h1");
  require("../common.cjs").watch(L, "tab 1");
  require("../common.cjs").watch(R, "tab 2");
  await pause(L, 2500);
  return { L, R };
}
async function changePassword(L, from) {
  await L.goto("/app/account");
  await L.waitForSelector("#password");
  await center(L, "#password");
  await L.locator("#current").fill(from).catch(() => {});
  await L.locator("#new-password").fill(NEWPW);
  await L.locator("#confirm-password").fill(NEWPW);
  await pause(L, 600);
  await L.locator("#password button", { hasText: /Save the new password/ }).click();
  await pause(L, 3000);
}
const saveNotify = (R) => R.locator("main button.btn", { hasText: /^Save$/ }).first();
/** Stripe telling the app (its webhook, the fake's signature) that this person's payout account is now ready. */
async function payoutReady(who) {
  const acct = `acct_fake_${who.uid}`;
  own(`update "User" set "stripeAccountId" = '${acct}' where id = '${who.uid}'`);
  const r = await fetch(`${X.BASE}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": "fake", "content-type": "application/json" }, body: JSON.stringify({ type: "account.updated", account: acct, data: { object: { id: acct, payouts_enabled: true, charges_enabled: true, details_submitted: true, capabilities: { transfers: "active" } } } }) });
  console.log("   [payout webhook]", r.status, (await r.text()).slice(0, 120), "ready:", sql(`select "payoutsReady" from "User" where id = '${who.uid}'`));
}

module.exports = (scene) => {
  // ---------- E1: the developer (Nora) ----------
  scene("e1", async () => {
    const p = await pair({}, false);
    const nora = p.nora;
    const { L, R } = await tabs(nora, "/app/account", "/app/notifications", ["tab 1", "tab 2"]);
    const D = X.duo("e1-account-pages-developer", "Account pages · Nora: changes from another tab, in the kept box");
    D.start([L, R]);
    // Notifications <- password
    D.say("Tab 2: Notifications is open. In tab 1 (Account), Nora changes her password.");
    await changePassword(L, X.PASSWORD || "");
    D.say("Tab 2: she turns email Off and presses Save: the kept box “Changed in another tab or device since you opened this page:” lists “Password changed at …”.");
    await X.unfold(R, "input[name=emailOn]");
    await R.locator("input[name=emailOn]").first().check().catch(() => {});
    await saveNotify(R).click();
    await pause(R, 3500);
    await box(R, "e1 notifications");
    await pause(R, 4000);
    D.say("Save again: it goes ahead.");
    await saveNotify(R).click();
    await pause(R, 3500);
    await box(R, "e1 notifications 2");
    // Account <- email (Notifications)
    D.say("Tab 1 opens Account again (a second Account page is allowed: it isn't one-at-a-time). Tab 2 (Notifications) switches email back On, Daily, and saves.");
    await L.goto("/app/account");
    await L.waitForSelector("main h1");
    await pause(L, 1500);
    await X.unfold(R, "input[name=emailOn]");
    await R.locator("input[name=emailOn]").nth(1).check().catch(() => {});
    await saveNotify(R).click();
    await pause(R, 3000);
    D.say("Tab 1: Nora presses “Start testing too” (add the tester side): the kept box lists “Email: Off → Daily”.");
    const add = L.locator("[data-other-side] button").first();
    await add.scrollIntoViewIfNeeded().catch(() => {});
    await add.click().catch((e) => console.log("   ! add side:", e.message.split("\n")[0]));
    await pause(L, 3500);
    await box(L, "e1 account side");
    await pause(L, 4000);
    D.say("Pressed again: the tester side is added (tab 1 goes on to her tester profile).");
    await add.click().catch(() => {});
    await pause(L, 5000);
    // Profile: nothing from another page can reach Nora's profile now (Sides came with tab 1's own move to it) -> say so.
    D.say("Profile: what reaches it from another page is “Sides” (Account) or “Name” (only Profile itself). Adding a side opens Profile in that same tab, which takes the page from any other Profile copy, so Nora's Profile can't show this box now; Ana's video shows it.");
    await pause(L, 8000);
    // Payments <- Stripe (payout ready)
    D.say("Tab 2 opens Payments. Stripe tells the app her payout account is now connected (as after setup on her phone; the fake Stripe's message).");
    await R.goto("/app/payments");
    await R.waitForSelector("main h1");
    own(`update "User" set "stripeAccountId" = 'acct_fake_${nora.uid}' where id = '${nora.uid}'`);
    await R.reload();
    await R.waitForSelector("main h1");
    await pause(R, 2500);
    await payoutReady(nora);
    await pause(R, 1500);
    D.say("Nora presses the payout button in tab 2: the kept box lists “Payout account: not connected → connected”.");
    const card = R.locator("main form button", { hasText: /Continue setup|Connect a payout account|Change payout details/ }).first();
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await card.click().catch((e) => console.log("   ! card:", e.message.split("\n")[0]));
    await R.waitForLoadState("load").catch(() => {});
    await pause(R, 3500);
    await box(R, "e1 payments");
    console.log("   [e1] payments url:", R.url());
    await pause(R, 5000);
    await D.finish();
    X.noteScene(D, { page: "Account pages" });
  });

  // ---------- E2: the tester (Ana) ----------
  scene("e2", async () => {
    const p = await pair({}, false);
    const ana = p.ana;
    const { L, R } = await tabs(ana, "/app/account", "/app/profile", ["tab 1", "tab 2"]);
    const D = X.duo("e2-account-pages-tester", "Account pages · Ana: changes from another tab or Stripe, in the kept box");
    D.start([L, R]);
    D.say("Tab 2: Profile is open. In tab 1 (Account), Ana adds the developer side.");
    const add = L.locator("[data-other-side] button").first();
    await add.scrollIntoViewIfNeeded().catch(() => {});
    await add.click().catch((e) => console.log("   ! add dev:", e.message.split("\n")[0]));
    await pause(L, 1200);
    D.say("Tab 2: she picks another device and presses Save profile.");
    const dev = R.locator("#devices input[type=checkbox]").nth(2);
    if (await dev.count()) await dev.check().catch(() => {});
    const save = R.locator("main button.btn", { hasText: /Save profile/ }).first();
    await save.scrollIntoViewIfNeeded().catch(() => {});
    await save.click();
    await pause(R, 3500);
    const pb = await box(R, "e2 profile");
    D.say(pb.length ? "The kept box: “Changed in another tab or device since you opened this page: Sides: Tester → Developer and tester”." : "No box: the page had already updated its sides quietly, so Save sent the new value (a field changed to the same value isn't listed).");
    await pause(R, 4000);
    D.say(pb.length ? "Save profile again: it goes ahead." : "Saved.");
    await save.click();
    await pause(R, 3500);
    // Notifications <- name (Profile)
    D.say("Tab 1 opens Notifications. In tab 2 (Profile), Ana changes her name to “Ana S. Silva” and saves.");
    await L.goto("/app/notifications");
    await L.waitForSelector("main h1");
    await R.locator("#name").fill("Ana S. Silva");
    await R.locator("main button.btn", { hasText: /Save profile/ }).first().click();
    await pause(R, 3500);
    const again = await box(R, "e2 name save");
    if (again.length) {
      D.say("Found: this Save profile is stopped again with the same “Sides” line, though the last Save profile on this page went ahead (and saved this page's sides over it). Pressed again, the name is saved.");
      await pause(R, 5000);
      await R.locator("main button.btn", { hasText: /Save profile/ }).first().click();
      await pause(R, 3500);
      await box(R, "e2 name save 2");
    }
    D.say("Tab 1: Ana changes her email setting and presses Save: the kept box lists “Name: Ana Silva → Ana S. Silva”.");
    await X.unfold(L, "input[name=emailOn]");
    await L.locator("input[name=emailPref]").nth(1).check().catch(() => L.locator("input[name=emailOn]").first().check().catch(() => {}));
    await saveNotify(L).click();
    await pause(L, 3500);
    await box(L, "e2 notifications");
    await pause(L, 4000);
    await saveNotify(L).click();
    await pause(L, 2500);
    // Account <- email (Notifications)
    D.say("Tab 2 opens Account. Tab 1 (Notifications) turns email Off and saves (it goes ahead).");
    await R.goto("/app/account");
    await R.waitForSelector("main h1");
    await X.unfold(L, "input[name=emailOn]");
    await L.locator("input[name=emailOn]").first().check().catch(() => {});
    await saveNotify(L).click();
    await pause(L, 3000);
    await box(L, "e2 notifications off");
    D.say("Tab 2: Ana changes her password: the kept box lists “Email: … → Off” first; pressed again, the password is saved.");
    await center(R, "#password");
    await R.locator("#current").fill(X.PASSWORD || "").catch(() => {});
    await R.locator("#new-password").fill(NEWPW);
    await R.locator("#confirm-password").fill(NEWPW);
    await R.locator("#password button", { hasText: /Save the new password/ }).click();
    await pause(R, 3500);
    await box(R, "e2 account password");
    await pause(R, 4000);
    await R.locator("#password button", { hasText: /Save the new password/ }).click().catch(() => {});
    await pause(R, 3500);
    await box(R, "e2 account password 2");
    // Payments <- Stripe
    D.say("Tab 2 opens Payments. Stripe tells the app Ana's payout account is connected (the fake Stripe's message, as after setup on her phone).");
    await R.goto("/app/payments");
    await R.waitForSelector("main h1");
    own(`update "User" set "stripeAccountId" = 'acct_fake_${ana.uid}' where id = '${ana.uid}'`);
    await R.reload();
    await R.waitForSelector("main h1");
    await pause(R, 2000);
    await payoutReady(ana);
    D.say("Ana presses the payout button: the kept box lists “Payout account: not connected → connected”.");
    const btn = R.locator("main form button", { hasText: /Continue setup|Connect a payout account|Change payout details/ }).first();
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click().catch((e) => console.log("   ! payout:", e.message.split("\n")[0]));
    await R.waitForLoadState("load").catch(() => {});
    await pause(R, 3500);
    await box(R, "e2 payments");
    console.log("   [e2] payments url:", R.url());
    await pause(R, 5000);
    await D.finish();
    X.noteScene(D, { page: "Account pages" });
  });

  // ---------- F1: Edit's Save, its kept box (the team's pause since Edit opened), and Before / Now / What you typed through a copy whose claim failed ----------
  scene("f1", async () => {
    const p = await pair();
    const N = await X.recPage(p.nora, "Nora · browser 1");
    const M = await X.recPage(p.nora, "Nora · browser 2 (another window)");
    await Promise.all([N.goto(`/app/tests/${p.t}/edit`), M.goto("/app")]);
    await N.waitForSelector("#description");
    await M.waitForSelector("main h1");
    const D = X.duo("f1-edit-save-kept-box", "Edit · Save keeps its own box; why Before / Now / What you typed can't show now");
    D.start([N, M]);
    await center(N, "#description");
    D.say("Browser 1: Nora types a change in Edit.");
    await N.locator("#description").click();
    await N.keyboard.press("End");
    await N.keyboard.type(" Try the night harbor too.", { delay: 20 });
    D.say("The team pauses the test (an admin, off camera), then lifts the pause, both after Edit opened.");
    await X.adminDo("pause-test", p.t);
    await pause(N, 1500);
    await X.adminDo("unpause-test", p.t);
    D.say("Nora presses Save: Edit keeps its full box under Save (“Your Save didn't go through. Since you opened this page: …”), not the one line.");
    await saveEdit(N, 3500);
    await box(N, "f1 save after pause+lift");
    await pause(N, 5000);
    D.say("Save again: it goes ahead.");
    await saveEdit(N, 3500);
    await box(N, "f1 save 2");
    // Before / Now / What you typed: browser 2 holds Edit; browser 1 opens Edit offline (claim fails); browser 2 saves; browser 1 back online claims (browser 2 claimed before it loaded) and saves the same field.
    D.say("Browser 2 opens Edit (it holds the page). Browser 1 opens Edit too, but offline just as it opens: its claim fails, so browser 2 keeps the page.");
    await M.goto(`/app/tests/${p.t}/edit`);
    await M.waitForSelector("#description");
    await pause(M, 2000);
    await N.route(/\/api\/page-claim/, (r) => r.abort("internetdisconnected"));
    await N.goto(`/app/tests/${p.t}/edit`);
    await N.waitForSelector("#description");
    await N.context().setOffline(true);
    await N.unroute(/\/api\/page-claim/);
    await pause(N, 1500);
    D.say("Offline, browser 1 types its own version of the steps (not saved).");
    await N.locator("#description").click().catch(() => {});
    await N.keyboard.press("End");
    await N.keyboard.type(" Draft typed offline in browser 1.", { delay: 20 });
    D.say("Browser 2 changes the steps and saves (Edit's Save loads Edit again, which claims the page again).");
    await M.locator("#description").fill("Sail through the first three harbors at night and tell us where the lights or the map get confusing.");
    await saveEdit(M, 2500);
    D.say("Browser 1 comes back online: a copy claimed the page after browser 1 loaded, so browser 1 leaves for the dashboard (“This page was opened somewhere else.”), its typing kept as a draft.");
    await N.context().setOffline(false);
    await pause(N, 5000);
    console.log("   [f1] browser 1 url:", N.url(), "moved line:", await N.locator("text=/opened somewhere else/").count());
    D.say("So Edit's three-value box (Before / Now / What you typed) can't be reached now: any other Save of the same test claims the page after this copy loaded, and this copy leaves before its own Save.");
    await M.reload().catch(() => {});
    await M.waitForSelector("#description").catch(() => {});
    await center(M, "#description");
    await pause(M, 7000);
    await D.finish();
    X.noteScene(D, { page: "Edit" });
  });

  // ---------- J1: Home: Confirm all with your bank (kept box), and the Calls box's Cancel while restricted (kept box) ----------
  scene("j1", async () => {
    const p = await pair();
    const ben = await X.account(`${p.tag}b`, "Ben Okafor", "tester", "he");
    const cam = await X.account(`${p.tag}c`, "Cam Lee", "tester", "they");
    own(`update "User" set "stripeCustomerId" = 'cus_fake_' || id, "stripePaymentMethodId" = 'pm_card_authenticationRequired' where id = '${p.nora.uid}'`);
    const sB = await X.join(ben, p.t), sC = await X.join(cam, p.t);
    for (const [who, s] of [[p.ana, p.s], [ben, sB], [cam, sC]]) {
      await X.sendWritten(who, s);
      own(`update "Submission" set "sentAt" = ${utcNow} - interval '15 days', "payBy" = ${utcNow} - interval '1 day', "choiceOfferedAt" = ${utcNow} - interval '1 day', "choiceBy" = ${utcNow} + interval '6 days' where "contractId" = '${s}'`);
    }
    own(`update "Test" set "openUntil" = ${utcNow} - interval '1 day' where id = '${p.t}'`);
    const charge = async (who, s) => {
      const sub = X.subOf(s);
      const r = await post(who, `/api/sessions/${s}/choose`, { ...go, seenAt: nowIso(), submissionId: sub, choice: "charge", amount: "10.00" });
      console.log(`   [j1] ${who.name} charges:`, r.status, JSON.stringify(r.body).slice(0, 160));
    };
    await charge(p.ana, p.s);
    await charge(ben, sB);
    const N = await X.recPage(p.nora, "Nora (developer) · Home");
    const A = await X.recPage(cam, "Cam (tester)");
    await Promise.all([N.goto("/app"), A.goto(`/app/sessions/${sC}`)]);
    require("../common.cjs").watch(N, "Nora");
    require("../common.cjs").watch(A, "Cam");
    await N.waitForSelector("main h1");
    await A.waitForSelector("main h1");
    const D = X.duo("j1-home-kept-boxes", "Home · Confirm all with your bank, and the Calls box's Cancel while restricted (full boxes)");
    D.start([N, A]);
    await center(N, "[data-confirm-all-button]");
    D.say("Ana and Ben charged Nora for unreviewed answers; her bank wants to confirm: Home shows “Confirm all (2)”.");
    await pause(N, 3000);
    await X.waitPulse(N, 25000);
    D.say("Cam charges too (in his window), after Nora's Home loaded.");
    const btn = A.locator("button", { hasText: /^Charge / }).first();
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click().catch((e) => console.log("   ! Cam charge:", e.message.split("\n")[0]));
    await pause(A, 1200);
    D.say("Nora presses Confirm all: Home keeps the full box under it (what changed, then “Press Confirm all again to go ahead.”).");
    const ca = N.waitForResponse((r) => r.url().endsWith("/api/payments/confirm-all"), { timeout: 60000 }).then((r) => r.status(), () => "none");
    await N.locator("[data-confirm-all-button]").click().catch((e) => console.log("   ! confirm all:", String(e.message).slice(0, 100)));
    console.log("   [j1] confirm all answer:", await ca);
    await pause(N, 3500);
    await box(N, "j1 confirm all");
    await pause(N, 5000);
    D.say("Pressed again: the bank's check opens (the fake Stripe's stand-in); Nora confirms.");
    await N.locator("[data-confirm-all-button]").click().catch(() => {});
    const bank = N.locator("[data-bank-check=stand-in]").first();
    if (await bank.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false)) {
      await bank.scrollIntoViewIfNeeded().catch(() => {});
      await pause(N, 2500);
      await bank.locator("[data-bank-confirm]").click().catch(() => {});
    } else console.log("   ! no bank stand-in");
    await pause(N, 5000);
    await box(N, "j1 after confirm");
    // The Calls box while restricted.
    // (5 days ahead: a pause or suspension cancels calls in the next 3 days)
    const callAt = new Date(Date.now() + 5 * 86400000); callAt.setMinutes(0, 0, 0);
    ok(await post(p.nora, `/api/tests/${p.t}/request-time`, { ...go, contractIds: [p.s], minutes: 30, times: [callAt.toISOString()] }), "request a time");
    const reqId = sql(`select id from "CallRequest" where "contractId" = '${p.s}' and status = 'pending' order by "createdAt" desc limit 1`);
    ok(await post(p.ana, `/api/sessions/${p.s}/answer-request`, { ...go, requestId: reqId, action: "accept" }), "accept");
    await X.adminDo("suspend", p.nora.uid, { side: "developer", note: "Checking a report about this account.", since: nowIso(), from: nowIso() });
    const AA = A; // (Cam's window stays; Ana's actions happen off camera)
    await N.reload();
    await N.waitForSelector("main h1");
    const menu = N.locator("[data-cancel-menu] summary").first();
    await menu.scrollIntoViewIfNeeded().catch(() => console.log("   ! no Cancel in the Calls box"));
    D.say("The team suspends Nora (an admin, off camera). Home's Calls box keeps a Cancel for her booked call with Ana.");
    await pause(N, 3000);
    await menu.click().catch(() => {});
    await pause(N, 1200);
    D.say("After Nora's Home loaded, the team also pauses the test (off camera). Nora presses Cancel this call: Home keeps the full box, under the row.");
    await X.adminDo("pause-test", p.t);
    await pause(N, 1000);
    await N.locator("[data-cancel-menu] button", { hasText: "Cancel this call" }).first().click().catch((e) => console.log("   ! cancel:", e.message.split("\n")[0]));
    await pause(N, 3500);
    await box(N, "j1 cancel restricted");
    await pause(N, 5000);
    D.say("Pressed again: the call is cancelled.");
    await N.locator("[data-cancel-menu] button", { hasText: "Cancel this call" }).first().click().catch(() => {});
    await pause(N, 4000);
    await box(N, "j1 cancel 2");
    await pause(N, 3000);
    await D.finish();
    X.noteScene(D, { page: "Home" });
  });
};
