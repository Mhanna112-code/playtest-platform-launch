// D. Two copies of one page (the same person, two tabs of one browser): the new copy waits "Saving changes in other tab…" (buttons locked) while the old copy's
// press is on its way, then redraws with it; "Open now"; the ~10 s takeover (the old press still goes through, the old copy goes to the dashboard); drafts kept.
// H. Offline: an offline press; a copy whose claim failed (offline at open) claiming again alone, and leaving when another copy claimed meanwhile.
// The old copy's press is slowed on purpose: its answer is held back on the way to the browser (a slow connection) for the seconds the caption says.
/* eslint-disable */
const X = require("../lib.cjs");
const { pause, center, lines, waitLive, waitPulse, visible, textOf, sql, own, utcNow, post, ok, go, nowIso } = X;
const { pair, SEND, REQ, toTop, fillRequest, reveal } = require("../common.cjs");

/** Holds the answer to this page's matching press for `ms` (the press reaches the server at once; its answer arrives late). */
async function holdAnswer(P, re, ms) {
  await P.route(re, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const resp = await route.fetch();
    await new Promise((r) => setTimeout(r, ms));
    await route.fulfill({ response: resp }).catch(() => {});
  });
}
/** What the copy shows about the handover now (for the log). */
async function handover(P, label) {
  const wait = await visible(P, "[data-handover]");
  const disabled = await P.evaluate(() => [...document.querySelectorAll("main button")].filter((b) => b.disabled || b.closest("[inert]") || getComputedStyle(b).pointerEvents === "none").length).catch(() => -1);
  const all = await P.evaluate(() => document.querySelectorAll("main button").length).catch(() => -1);
  console.log(`   [${label}] waiting line: ${wait} ${wait ? "“" + (await textOf(P, "[data-handover]")) + "”" : ""}; buttons locked ${disabled}/${all}; url ${P.url().replace(X.BASE, "")}; moved line: ${await P.locator("text=/opened somewhere else/").count()}`);
}
/** Two recorded tabs of one person: tab 1 on url1 (opened first), tab 2 parked on the dashboard. */
async function twoTabs(who, url1, labels = ["Tab 1 (opened first)", "Tab 2 (opened second)"]) {
  const T1 = await X.recPage(who, `${who.name} · ${labels[0]}`);
  const T2 = await X.recTab(T1, `${who.name} · ${labels[1]}`);
  await Promise.all([T1.goto(url1), T2.goto("/app")]);
  await T1.waitForSelector("main h1");
  await T2.waitForSelector("main h1");
  await pause(T1, 1500);
  return { T1, T2 };
}
const watchPost = (P, tag) => P.on("response", async (r) => {
  if (r.request().method() !== "POST" || /pulse|\/live|seen|kept|timezone|visits/.test(r.url())) return;
  console.log(`   (${tag} ${new Date().toTimeString().slice(0, 8)}) ${r.url().replace(X.BASE, "")} -> ${r.status()} ${(await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160)}`);
});

module.exports = (scene) => {
  // ---------- D1: the session page ----------
  scene("d1", async () => {
    const p = await pair({ liveRateCents: "30.00", liveMinutes: "30" });
    const url = `/app/sessions/${p.s}`;
    const { T1, T2 } = await twoTabs(p.ana, url);
    watchPost(T1, "tab 1"); watchPost(T2, "tab 2");
    const D = X.duo("d1-two-copies-session-page", "Two copies · the session page: wait, redraw, Open now, the 10-second takeover");
    D.start([T1, T2]);
    await center(T1, "#written");
    D.say("Tab 1: Ana types her answers.");
    await X.typeIn(T1, "#a0", X.ANS[0], 6);
    await X.typeIn(T1, "#a1", X.ANS[1], 6);
    await holdAnswer(T1, /\/written$/, 9000);
    D.say("Tab 1: Send Answers. Its answer is held 9 s on the way back (a slow connection).");
    await T1.locator(SEND).click();
    await pause(T1, 1200);
    D.say("Tab 2 opens the same page: “Saving changes in other tab…” with Open now; every button is locked while it waits.");
    await T2.goto(url);
    await T2.waitForSelector("main h1");
    await pause(T2, 1500);
    await handover(T2, "d1 tab 2 waiting");
    await center(T2, "#written");
    await pause(T2, 3500);
    await handover(T2, "d1 tab 2 still waiting");
    D.say("Tab 1's press finishes; tab 1 hands over and goes to the dashboard (“This page was opened somewhere else.”). Tab 2 redraws with the sent answers.");
    await pause(T2, 7000);
    await handover(T1, "d1 tab 1 after");
    await handover(T2, "d1 tab 2 after");
    await T1.unroute(/\/written$/);
    await pause(T2, 3000);
    // Open now: tab 2 holds the page; its Add is held 25 s; tab 1 comes back and presses Open now.
    await X.unfold(T2, "[data-add-more=written]");
    await center(T2, "[data-add-more=written]");
    D.say("Tab 2 now holds the page. Ana adds to her answer there; its answer is held 25 s.");
    await T2.locator("[data-add-more=written]").first().evaluate((el) => el.click());
    await pause(T2, 800);
    await X.typeIn(T2, "[data-add-box] textarea", "One more thing: the lighthouse level has no checkpoint before the storm.", 6);
    await holdAnswer(T2, /\/written-add$/, 25000);
    await T2.locator("[data-add-send=written]").first().click();
    await pause(T2, 1200);
    D.say("Tab 1 opens the page again: it waits. Ana presses Open now: tab 1 takes the page at once.");
    await T1.goto(url);
    await T1.waitForSelector("main h1");
    await pause(T1, 2500);
    await handover(T1, "d1 tab 1 waiting (2)");
    await T1.locator("[data-handover-now]").click().catch((e) => console.log("   ! Open now:", e.message.split("\n")[0]));
    await pause(T1, 3000);
    await handover(T1, "d1 tab 1 after Open now");
    D.say("Tab 2's Add still goes through when its answer arrives; tab 2 then goes to the dashboard. Tab 1 shows the addition.");
    await T2.waitForURL(/\/app(\?|$)/, { timeout: 40000 }).catch(() => console.log("   ! tab 2 didn't leave"));
    await pause(T2, 2000);
    await handover(T2, "d1 tab 2 after its press");
    await T1.reload();
    await T1.waitForSelector("main h1");
    await X.unfold(T1, "[data-add-more=written]");
    await center(T1, "[data-add-more=written]");
    await pause(T1, 3000);
    await T2.unroute(/\/written-add$/);
    // The draft tab 2 left (its Add was on its way when tab 1 took the page with Open now), then the ~10 s takeover: tab 1's Add held 18 s.
    await T1.evaluate(() => document.querySelectorAll("#written details").forEach((d) => (d.open = true)));
    await T1.locator("[data-add-more=written]").first().click().catch(() => {});
    await pause(T1, 1500);
    const left = await T1.locator("[data-add-box] textarea").first().inputValue().catch(() => "");
    console.log("   [d1] tab 1's first Add box after Open now:", JSON.stringify(left));
    await center(T1, "[data-add-box]");
    D.say(left ? `Found: tab 1's Add box on the first question holds “${left.slice(0, 45)}…” as an unsent draft, though tab 2's addition with these words went through.` : "Tab 1's Add box on the first question is empty: tab 2's addition went through.");
    await pause(T1, 6000);
    D.say("Tab 1 holds the page. Ana asks Nora for a call (Request a time); its answer is held 18 s.");
    await fillRequest(T1);
    await holdAnswer(T1, /\/request-time$/, 18000);
    await T1.locator(REQ).first().click().catch((e) => console.log("   ! request:", String(e.message).slice(0, 100)));
    await pause(T1, 1000);
    D.say("Tab 2 opens the page and waits; nobody presses Open now. After about 10 s it takes the page by itself.");
    const t0 = Date.now();
    await T2.goto(url);
    await T2.waitForSelector("main h1");
    await handover(T2, "d1 tab 2 waiting (3)");
    await T2.waitForSelector("[data-handover]", { state: "detached", timeout: 20000 }).catch(() => {});
    console.log(`   [d1] tab 2 took the page after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await handover(T2, "d1 tab 2 took over");
    await pause(T2, 2000);
    D.say("Tab 1's press still goes through when its answer arrives; tab 1 then goes to the dashboard (“This page was opened somewhere else.”).");
    await T1.waitForURL(/\/app(\?|$)/, { timeout: 30000 }).catch(() => console.log("   ! tab 1 didn't leave"));
    await pause(T1, 2500);
    await handover(T1, "d1 tab 1 after (3)");
    console.log("   [d1] additions:", sql(`select count(*) from "Submission" where "contractId" = '${p.s}'`));
    await T2.reload();
    await T2.waitForSelector("main h1");
    await reveal(T2, "[data-your-requests]");
    console.log("   [d1] requests:", sql(`select count(*) from "CallRequest" where "contractId" = '${p.s}'`));
    console.log("   [d1] tab 2 draft boxes:", await T2.locator("[data-add-box] textarea").count(), JSON.stringify(await T2.locator("[data-add-box] textarea").evaluateAll((els) => els.map((e) => e.value))));
    D.say("Tab 2 (reloaded): tab 1's call request is on the page.");
    await pause(T2, 6000);
    await D.finish();
    X.noteScene(D, { page: "Two copies" });
  });

  // ---------- D2: the test page and Edit (one claim for both), the join page ----------
  scene("d2", async () => {
    const p = await pair({ joinMode: "apply" }, false);
    const tJ = await X.postTest(p.nora, { title: "Night Harbor", joinMode: "apply" });
    ok(await post(p.ana, `/api/tests/${p.t}/apply`, { ...go, seenAt: nowIso(), note: "" }), "apply");
    const { T1, T2 } = await twoTabs(p.nora, `/app/tests/${p.t}`);
    watchPost(T1, "tab 1"); watchPost(T2, "tab 2");
    const D = X.duo("d2-two-copies-test-page-edit", "Two copies · Nora's test page and Edit (one page for both), then Edit twice");
    D.start([T1, T2]);
    await reveal(T1, "li[id^=item-app-]");
    await pause(T1, 1500);
    await holdAnswer(T1, /\/application$/, 9000);
    D.say("Tab 1 (test page): Nora accepts Ana's application; its answer is held 9 s.");
    await T1.locator("li[id^=item-app-] button:has-text('Accept')").first().click();
    await pause(T1, 1000);
    D.say("Tab 2 opens Edit for the same test (the test page and Edit are one page): it waits, buttons locked.");
    await T2.goto(`/app/tests/${p.t}/edit`);
    await T2.waitForSelector("main h1");
    await pause(T2, 2000);
    await handover(T2, "d2 edit waiting");
    await pause(T2, 3000);
    D.say("Tab 1's Accept finishes; tab 1 goes to the dashboard. Tab 2's Edit is unlocked and drawn again with the change.");
    await pause(T2, 7000);
    await handover(T1, "d2 tab 1 after");
    await handover(T2, "d2 tab 2 after");
    await T1.unroute(/\/application$/);
    // Edit in both tabs: tab 2 types in the steps (not saved), tab 1 opens Edit with Open now.
    D.say("Tab 2 types a change in Edit (not saved). Tab 1 opens Edit too: tab 2 has no press on its way, so tab 1 takes it at once and tab 2 leaves, keeping its typing as a draft.");
    await T2.locator("#description").click();
    await T2.keyboard.press("End");
    await T2.keyboard.type(" Draft from tab 2: try the night harbor.", { delay: 20 });
    await pause(T2, 1500);
    await T1.goto(`/app/tests/${p.t}/edit`);
    await T1.waitForSelector("#description");
    await pause(T1, 4000);
    await handover(T2, "d2 tab 2 after tab 1 opened Edit");
    console.log("   [d2] tab 1 description:", (await T1.locator("#description").inputValue()).slice(-60));
    await center(T1, "#description");
    await pause(T1, 4000);
    // The join page (Ana, two tabs).
    await D.finish();
    X.noteScene(D, { page: "Two copies" });

    const { T1: J1, T2: J2 } = await twoTabs(p.ana, `/app/find/${tJ}`);
    watchPost(J1, "join tab 1"); watchPost(J2, "join tab 2");
    const E = X.duo("d3-two-copies-join-page", "Two copies · the join page");
    E.start([J1, J2]);
    await center(J1, "#join-card");
    const nb = J1.locator("#join-card textarea").first();
    if (await nb.count()) await X.typeIn(J1, "#join-card textarea", "I can test on Windows this week.", 8);
    await holdAnswer(J1, /\/apply$/, 9000);
    E.say("Tab 1: Ana presses Apply to join; its answer is held 9 s.");
    await J1.locator("#join-card button.btn").first().click();
    await pause(J1, 1000);
    E.say("Tab 2 opens the same join page: “Saving changes in other tab…”, buttons locked.");
    await J2.goto(`/app/find/${tJ}`);
    await J2.waitForSelector("main h1");
    await pause(J2, 2000);
    await handover(J2, "d3 tab 2 waiting");
    await pause(J2, 2500);
    E.say("Tab 1's Apply finishes; tab 1 goes to the dashboard; tab 2 redraws showing the application.");
    await pause(J2, 7000);
    await handover(J1, "d3 tab 1 after");
    await handover(J2, "d3 tab 2 after");
    await pause(J2, 2000);
    await E.finish();
    X.noteScene(E, { page: "Two copies" });
  });

  // ---------- D4: Profile, Payments and Notifications (short) ----------
  scene("d4", async () => {
    const p = await pair({}, false);
    const { T1, T2 } = await twoTabs(p.ana, "/app/profile");
    watchPost(T1, "tab 1"); watchPost(T2, "tab 2");
    const D = X.duo("d4-two-copies-account-pages", "Two copies · Profile, Notifications and Payments");
    D.start([T1, T2]);
    await pause(T1, 1500);
    D.say("Profile, tab 1: Ana picks a pronoun and presses Save profile; its answer is held 8 s.");
    await T1.locator("#pronoun").selectOption({ index: 2 }).catch(() => {});
    await holdAnswer(T1, /\/api\/profile$/, 8000);
    await T1.locator("main button.btn", { hasText: /Save profile/ }).first().click();
    await pause(T1, 1000);
    D.say("Tab 2 opens Profile: it waits (buttons locked), then redraws with the saved pronoun; tab 1 goes to the dashboard.");
    await T2.goto("/app/profile");
    await T2.waitForSelector("main h1");
    await pause(T2, 2000);
    await handover(T2, "d4 profile waiting");
    await pause(T2, 8000);
    await handover(T1, "d4 profile tab 1 after");
    await handover(T2, "d4 profile tab 2 after");
    await T1.unroute(/\/api\/profile$/);
    // Notifications
    await T1.goto("/app/notifications");
    await T1.waitForSelector("main h1");
    await pause(T1, 1500);
    D.say("Notifications, tab 1: Ana turns email Off and presses Save; its answer is held 8 s.");
    await X.unfold(T1, "input[name=emailOn]");
    await T1.locator("input[name=emailOn]").first().check().catch(() => {});
    await holdAnswer(T1, /\/api\/account\/notify$/, 8000);
    await T1.locator("main button.btn", { hasText: /^Save$/ }).first().click().catch((e) => console.log("   ! notify save:", e.message.split("\n")[0]));
    await pause(T1, 1000);
    D.say("Tab 2 opens Notifications: it waits, then shows email Off; tab 1 goes to the dashboard.");
    await T2.goto("/app/notifications");
    await T2.waitForSelector("main h1");
    await pause(T2, 2000);
    await handover(T2, "d4 notifications waiting");
    await pause(T2, 8000);
    await handover(T1, "d4 notifications tab 1 after");
    await handover(T2, "d4 notifications tab 2 after");
    await T1.unroute(/\/api\/account\/notify$/);
    // Payments: Open now (a press that leaves for Stripe isn't held here: tab 2 just opens it with tab 1 idle)
    await T1.goto("/app/payments");
    await T1.waitForSelector("main h1");
    await pause(T1, 1500);
    D.say("Payments: tab 1 has it open with no press on its way. Tab 2 opens Payments: it takes the page at once; tab 1 goes to the dashboard.");
    await T2.goto("/app/payments");
    await T2.waitForSelector("main h1");
    await pause(T2, 4000);
    await handover(T1, "d4 payments tab 1 after");
    await handover(T2, "d4 payments tab 2 after");
    D.say("Payments' presses (Connect a payout account, Change card) go on to Stripe's own pages, so a new copy rarely finds one on its way; the same wait applies when it does.");
    await pause(T2, 7000);
    await D.finish();
    X.noteScene(D, { page: "Two copies" });
  });

  // ---------- H1: offline ----------
  scene("h1", async () => {
    const p = await pair();
    const url = `/app/sessions/${p.s}`;
    const T1 = await X.recPage(p.ana, "Ana · browser 1");
    const T2 = await X.recPage(p.ana, "Ana · browser 2 (another window)");
    await Promise.all([T1.goto(url), T2.goto("/app")]);
    await T1.waitForSelector("main h1");
    watchPost(T1, "tab 1"); watchPost(T2, "tab 2");
    const D = X.duo("h1-offline", "Offline · an offline press; a copy that opened offline claims again, or leaves");
    D.start([T1, T2]);
    await center(T1, "#written");
    D.say("Browser 1: Ana types her answers, then her connection drops.");
    await X.typeIn(T1, "#a0", X.ANS[0], 6);
    await X.typeIn(T1, "#a1", X.ANS[1], 6);
    await T1.context().setOffline(true);
    await pause(T1, 1000);
    D.say("She presses Send Answers while offline. (The media server is a development server: its pages show without their styles while offline. The line under the button is the app's.)");
    await T1.locator(SEND).click();
    await pause(T1, 3000);
    await lines(T1, "h1 offline press");
    console.log("   [h1] offline line:", await T1.locator("text=/seem to be offline/").count());
    await pause(T1, 3000);
    D.say("Back online, she presses again: it goes through.");
    await T1.context().setOffline(false);
    await pause(T1, 1500);
    await T1.locator(SEND).click();
    await pause(T1, 4000);
    await lines(T1, "h1 back online");
    // A copy whose claim failed (offline at open), alone: claims again when back online.
    await T2.goto("/app");
    await T1.goto("/app");
    await pause(T1, 1500);
    D.say("Browser 1 opens the session page, but the connection drops just as it opens: its claim on the page fails (no other copy is open).");
    await T1.route(/\/api\/page-claim/, (r) => r.abort("internetdisconnected"));
    await T1.goto(url);
    await T1.waitForSelector("main h1");
    await T1.context().setOffline(true);
    await T1.unroute(/\/api\/page-claim/);
    await pause(T1, 3000);
    D.say("Back online: browser 1 claims the page again by itself and stays (nobody else opened it).");
    const claimed = T1.waitForResponse((r) => /page-claim/.test(r.url()) && r.request().method() === "POST", { timeout: 15000 }).then(async (r) => `${r.status()} ${await r.text()}`).catch(() => "no claim");
    await T1.context().setOffline(false);
    console.log("   [h1] claim again:", await claimed);
    await pause(T1, 3000);
    await handover(T1, "h1 alone, back online");
    // The same, but another copy opened meanwhile: the late copy leaves (drafts kept).
    D.say("Again browser 1 opens offline (claim failed). Ana types a draft addition there.");
    await T1.goto("/app");
    await T1.route(/\/api\/page-claim/, (r) => r.abort("internetdisconnected"));
    await T1.goto(url);
    await T1.waitForSelector("main h1");
    await T1.context().setOffline(true);
    await T1.unroute(/\/api\/page-claim/);
    await X.unfold(T1, "[data-add-more=written]");
    await center(T1, "[data-add-more=written]");
    await T1.locator("[data-add-more=written]").first().click().catch(() => {});
    await X.typeIn(T1, "[data-add-box] textarea", "Draft written offline: the storm level needs a checkpoint.", 6);
    await pause(T1, 1000);
    D.say("Meanwhile browser 2 (another window, still online) opens the same page and claims it.");
    await T2.goto(url).catch(() => {});
    await pause(T2, 2500);
    D.say("Browser 1 comes back online: another copy claimed the page after it loaded, so browser 1 leaves for the dashboard (“This page was opened somewhere else.”), keeping its draft.");
    await T1.context().setOffline(false);
    await pause(T1, 5000);
    await handover(T1, "h1 late copy");
    await handover(T2, "h1 other copy");
    await T2.reload().catch(() => {});
    await T2.waitForSelector("main h1").catch(() => {});
    await pause(T2, 2500);
    await X.unfold(T2, "[data-add-more=written]");
    await center(T2, "[data-add-more=written]");
    D.say("Browser 2 opens Add to this answer: the draft browser 1 typed offline is there.");
    await T2.locator("[data-add-more=written]").first().evaluate((el) => el.click()).catch(() => {});
    await pause(T2, 2000);
    await center(T2, "[data-add-box]");
    console.log("   [h1] tab 2 draft boxes:", JSON.stringify(await T2.locator("[data-add-box] textarea").evaluateAll((els) => els.map((e) => e.value)).catch(() => [])));
    await pause(T2, 5000);
    await D.finish();
    X.noteScene(D, { page: "Offline" });
  });
  // ---------- D5: the ~10 s takeover on the join page (Apply locks the page; its answer is held 16 s) ----------
  scene("d5", async () => {
    const p = await pair({ joinMode: "apply" }, false);
    const url = `/app/find/${p.t}`;
    const { T1, T2 } = await twoTabs(p.ana, url);
    watchPost(T1, "tab 1"); watchPost(T2, "tab 2");
    await pause(T1, 4000); // (the page just loaded: its buttons wait for its claim)
    const D = X.duo("d5-two-copies-ten-second-takeover", "Two copies · the 10-second takeover while the old press is on its way");
    D.start([T1, T2]);
    await center(T1, "#join-card");
    const nb = T1.locator("#join-card textarea").first();
    if (await nb.count()) await X.typeIn(T1, "#join-card textarea", "I can test on Windows this week.", 8);
    await pause(T1, 1500);
    await holdAnswer(T1, new RegExp("/apply$"), 16000);
    D.say("Tab 1: Ana presses Apply to join; its answer is held 16 s (a slow connection).");
    await T1.locator("#join-card button.btn").first().click();
    await pause(T1, 1000);
    D.say("Tab 2 opens the same join page: “Saving changes in other tab…”. Nobody presses Open now.");
    const t0 = Date.now();
    await T2.goto(url);
    await T2.waitForSelector("main h1");
    await pause(T2, 1500);
    await handover(T2, "d5 tab 2 waiting");
    await T2.waitForSelector("[data-handover]", { state: "detached", timeout: 25000 }).catch(() => {});
    const took = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`   [d5] tab 2 took the page after ${took} s`);
    D.say(`After about 10 s (here ${took} s from opening) tab 2 takes the page by itself, while tab 1's Apply is still on its way.`);
    await handover(T2, "d5 tab 2 took over");
    await pause(T2, 2500);
    D.say("Tab 1's Apply still goes through when its answer arrives; then tab 1 goes to the dashboard (“This page was opened somewhere else.”).");
    await T1.waitForURL((u) => new URL(u).pathname === "/app", { timeout: 30000 }).catch(() => console.log("   ! tab 1 didn't leave"));
    await pause(T1, 2500);
    await handover(T1, "d5 tab 1 after");
    console.log("   [d5] application:", sql(`select status from "Application" where "testId" = '${p.t}'`));
    D.say("Tab 2, reloaded, shows the application.");
    await T2.reload();
    await T2.waitForSelector("main h1");
    await center(T2, "#join-card, main");
    await pause(T2, 5000);
    await D.finish();
    X.noteScene(D, { page: "Two copies" });
  });
};
