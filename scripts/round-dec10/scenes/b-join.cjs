// B. The join page (Ana): Join / Apply / Withdraw / Ask to rejoin / No thanks with Nora editing (the one line), and the refusals (full, paused, Open until,
// invite only). G. The invites-and-applications changes (pauses, fills and edits keep them open; invite only closes applications; a test closing on its own
// rings invitees), with both people's bells.
/* eslint-disable */
const X = require("../lib.cjs");
const { pause, center, lines, waitLive, waitPulse, apiEdit, visible, textOf, sql, own, utcNow, post, ok, go, nowIso } = X;
const { pair, both, noraPrepares, noraSaves, toTop, editRace , reveal } = require("../common.cjs");
const JOINBTN = "#join-card button.btn:has-text('Join this test'), #join-card button.btn:has-text('Apply to join'), #join-card button.btn:has-text('Ask to rejoin')";
const joinBtn = (A) => A.locator(JOINBTN).first();
const invite = async (nora, t, uid) => ok(await post(nora, `/api/tests/${t}/invite`, { ...go, seenAt: nowIso(), testerIds: [uid] }), "invite");
/** A third person (Ben or Cam), a tester, through the API. */
const third = (tag, name, pronoun = "he") => X.account(tag, name, "tester", pronoun);
/** Ana's bell: the header's number, then the bell list (opened in her window), then back. */
async function bell(P, back) {
  await P.goto("/app/notifications");
  await P.waitForSelector("main h1");
  await pause(P, 1200);
  for (const b of await P.locator("[data-bell-stack] > button[aria-expanded=false]").all()) await b.click().catch(() => {});
  await pause(P, 3500);
  console.log(`   [bell ${P.label}]`, (await textOf(P, "main")).slice(0, 500));
  if (back) { await P.goto(back); await P.waitForSelector("main h1").catch(() => console.log("   ! no h1 on", back)); await pause(P, 1000); }
}
const bellCount = (uid) => sql(`select count(*) from "Notification" where "userId" = '${uid}'`);

module.exports = (scene) => {
  // ---------- B1: the one line on Join, Apply, Withdraw, Ask to rejoin and No thanks (Nora edits the listing) ----------
  scene("b1", async () => {
    const p = await pair({}, false);
    const t2 = await X.postTest(p.nora, { title: "Night Harbor", joinMode: "apply" });
    const t3 = await X.postTest(p.nora, { title: "Storm Coast" });
    const t4 = await X.postTest(p.nora, { title: "Open Sea Run" });
    // Ana was in Storm Coast and left it (so she can ask to rejoin); Nora invited her to Open Sea Run.
    const s3 = await X.join(p.ana, t3);
    ok(await post(p.ana, `/api/sessions/${s3}/leave`, { ...go, seenAt: nowIso() }), "leave");
    await invite(p.nora, t4, p.ana.uid);
    const { N, A } = await both(p, `/app/tests/${p.t}`, `/app/find/${p.t}`);
    const D = X.duo("b1-join-page-stop-lines", "Join page · Join, Apply, Withdraw, Ask to rejoin, No thanks: the one-line stop");
    D.start([N, A]);
    await center(A, "#join-card");
    await pause(A, 2000);
    // Join
    await editRace(D, N, A, p.t, undefined, "Ana reads the listing. Nora edits it in her window (Edit, Save).");
    D.say("Ana presses Join this test before her page updates: one blue line under the button; the change is in the box at the top.");
    await joinBtn(A).click();
    await pause(A, 3500);
    await lines(A, "b1 join line");
    await toTop(A, 3000);
    await center(A, "#join-card");
    await pause(A, 1500);
    D.say("Pressed again: Ana joins (her session page opens).");
    await joinBtn(A).click();
    await A.waitForURL(/\/app\/sessions\//, { timeout: 30000 }).catch(() => console.log("   ! no session page"));
    await pause(A, 3000);
    // Apply, then Withdraw
    D.say("Night Harbor takes applications. Ana writes a note.");
    await A.goto(`/app/find/${t2}`);
    await A.waitForSelector("#join-card");
    await N.goto(`/app/tests/${t2}`);
    await center(A, "#join-card");
    const note = A.locator("#join-card textarea").first();
    if (await note.count()) await X.typeIn(A, "#join-card textarea", "I play a lot of sailing games and can test on Windows.", 10);
    await editRace(D, N, A, t2, " Bring a controller if you have one.", "Nora edits the listing (Edit, Save).");
    D.say("Apply: one line; pressed again, the application goes to Nora.");
    await joinBtn(A).click();
    await pause(A, 3500);
    await lines(A, "b1 apply line");
    await joinBtn(A).click();
    await pause(A, 4000);
    await lines(A, "b1 applied");
    await N.reload();
    await pause(N, 2000);
    await waitPulse(A, 25000);
    D.say("Nora changes the tester deadline (7 → 10 days, off camera): it no longer closes applications. Ana presses Withdraw application before her page updates.");
    await apiEdit(p.nora, t2, { deadlineDays: "10" });
    N.reload().catch(() => {});
    await A.locator("button:has-text('Withdraw application')").first().click().catch((e) => console.log("   ! Withdraw:", String(e.message).slice(0, 100)));
    await pause(A, 3500);
    await lines(A, "b1 withdraw");
    D.say("It goes straight through: a deadline change isn't one of the join page's changes. (Nora's edits can't stop Withdraw now: the edits the join page lists close the application first, and Withdraw then goes quietly.)");
    await pause(A, 7000);
    // Ask to rejoin
    D.say("Storm Coast: Ana left it earlier, so she can ask to rejoin.");
    await A.goto(`/app/find/${t3}`);
    await A.waitForSelector("#join-card");
    await N.goto(`/app/tests/${t3}`);
    await center(A, "#join-card");
    await editRace(D, N, A, t3, " Mind the rocks.", "Nora edits Storm Coast's listing (Edit, Save).");
    D.say("Ask to rejoin: one line; pressed again, Nora gets the request.");
    await joinBtn(A).click();
    await pause(A, 3500);
    await lines(A, "b1 rejoin line");
    await joinBtn(A).click();
    await pause(A, 4000);
    await lines(A, "b1 rejoin asked");
    // No thanks
    D.say("Open Sea Run: Nora invited Ana. The invite has Join and No thanks.");
    await A.goto(`/app/find/${t4}`);
    await A.waitForSelector("main h1");
    await N.goto(`/app/tests/${t4}`);
    await center(A, "button:has-text('No thanks')");
    await editRace(D, N, A, t4, " Watch the tide.", "Nora edits Open Sea Run's listing (Edit, Save).");
    D.say("No thanks: one line; pressed again, the invite is declined (Ana goes to her dashboard).");
    await A.locator("button:has-text('No thanks')").first().click();
    await pause(A, 3500);
    await lines(A, "b1 no thanks line");
    await A.locator("button:has-text('No thanks')").first().click().catch(() => {});
    await pause(A, 4000);
    await N.reload();
    await pause(N, 3000);
    D.say("On the join page these lines stop the press whatever Ana's Alerts are. No thanks isn't stopped by “full” or “a spot opened” lines.");
    await pause(A, 6000);
    await D.finish();
    X.noteScene(D, { page: "Join page" });
  });

  // ---------- B2: the refusals on the join page: full, paused, Open until passed, invite only ----------
  scene("b2", async () => {
    const p = await pair({ spots: "1" }, false);
    const ben = await third(`${p.tag}b`, "Ben Okafor");
    const tP = await X.postTest(p.nora, { title: "Night Harbor" });
    const tO = await X.postTest(p.nora, { title: "Storm Coast" });
    const tI = await X.postTest(p.nora, { title: "Open Sea Run", joinMode: "apply" });
    const { N, A } = await both(p, `/app/tests/${p.t}`, `/app/find/${p.t}`);
    const D = X.duo("b2-join-page-refusals", "Join page · refused for good: full, paused, Open until passed, invite only");
    D.start([N, A]);
    await center(A, "#join-card");
    await pause(A, 2000);
    // Full
    await waitPulse(A, 25000);
    D.say("Harbor Run has 1 spot. Ben joins it (off camera); Nora's page shows it full.");
    await X.join(ben, p.t);
    await N.reload();
    await pause(N, 1500);
    D.say("Ana presses Join this test before her page updates: refused, the test is full.");
    await joinBtn(A).click();
    await pause(A, 4000);
    await lines(A, "b2 full");
    await pause(A, 4000);
    D.say("Same for Apply and Ask to rejoin. The page redraws without the join card.");
    await pause(A, 4000);
    // Paused
    await A.goto(`/app/find/${tP}`);
    await A.waitForSelector("#join-card");
    await N.goto(`/app/tests/${tP}`);
    await center(A, "#join-card");
    await waitPulse(A, 25000);
    D.say("Night Harbor: the team pauses it (an admin, off camera); Nora's page shows the pause.");
    await X.adminDo("pause-test", tP);
    await N.reload();
    D.say("Ana presses Join: “This test isn't taking new testers right now” (never says why; the same for a hold or a suspension).");
    await joinBtn(A).click();
    await pause(A, 4500);
    await lines(A, "b2 paused");
    await pause(A, 4000);
    // Open until passed
    await A.goto(`/app/find/${tO}`);
    await A.waitForSelector("#join-card");
    await N.goto(`/app/tests/${tO}`);
    await center(A, "#join-card");
    await waitPulse(A, 25000);
    D.say("Storm Coast: its Open until passes (moved to yesterday in the database, as the clock would).");
    own(`update "Test" set "openUntil" = ${utcNow} - interval '1 hour' where id = '${tO}'`);
    await N.reload();
    D.say("Ana presses Join: refused, the test closed to new testers on that date.");
    await joinBtn(A).click();
    await pause(A, 4500);
    await lines(A, "b2 open until");
    await pause(A, 4000);
    // Invite only
    await A.goto(`/app/find/${tI}`);
    await A.waitForSelector("#join-card");
    await center(A, "#join-card");
    const note = A.locator("#join-card textarea").first();
    if (await note.count()) await X.typeIn(A, "#join-card textarea", "I'd love to try the open sea level.", 10);
    await editRace(D, N, A, tI, async (E) => {
      await center(E, "#joinMode");
      await E.locator("#joinMode").selectOption({ label: /invite/i }).catch(async () => E.locator("#joinMode").selectOption("invite").catch((e) => console.log("   ! joinMode:", e.message.split("\n")[0])));
    }, "Open Sea Run takes applications. Nora switches it to invite only (Edit, How testers join, Save).");
    D.say("Ana presses Apply: first the one line (the listing changed).");
    await joinBtn(A).click();
    await pause(A, 3500);
    await lines(A, "b2 invite-only line");
    D.say("Pressed again: refused, the test is invite only.");
    await joinBtn(A).click().catch(() => {});
    await pause(A, 4000);
    await lines(A, "b2 invite only");
    await pause(A, 3000);
    D.say("Same for Join. Ask to rejoin is never refused for invite only.");
    await pause(A, 5000);
    await D.finish();
    X.noteScene(D, { page: "Join page" });
  });

  // ---------- G1: a pause keeps open invites (no bell for Ana; Join refused while paused; works after the lift) ----------
  scene("g1", async () => {
    const p = await pair({}, false);
    await invite(p.nora, p.t, p.ana.uid);
    const { N, A } = await both(p, `/app/tests/${p.t}`, `/app/notifications`);
    const D = X.duo("g1-pause-keeps-invites", "Invites · a pause keeps the invite open (no bell for Ana)");
    D.start([N, A]);
    D.say("Nora invited Ana; Ana's bell has the invite.");
    await pause(A, 3500);
    await A.goto(`/app/find/${p.t}`);
    await A.waitForSelector("#join-card");
    await center(A, "#join-card");
    await pause(A, 1500);
    const before = bellCount(p.ana.uid);
    await waitPulse(A, 25000);
    D.say("The team pauses the test (an admin, off camera). Nora's page shows the pause.");
    await X.adminDo("pause-test", p.t);
    N.reload().catch(() => {});
    await pause(A, 1500);
    D.say("Ana presses Join on the invite before her page updates: refused, “This test isn't taking new testers right now”.");
    await A.locator(JOINBTN).first().click().catch((e) => console.log("   ! join:", String(e.message).slice(0, 100)));
    await pause(A, 4000);
    await lines(A, "g1 join paused");
    await pause(A, 3000);
    const after = bellCount(p.ana.uid);
    console.log(`   [g1] Ana's bell lines ${before} -> ${after}`);
    await bell(A, `/app/find/${p.t}`);
    D.say(`Ana's bell: nothing new about the pause (${before} line${before === "1" ? "" : "s"} before, ${after} after). Her invite stays open.`);
    await pause(A, 3000);
    D.say("The team lifts the pause. Ana's same invite works: she joins.");
    await X.adminDo("unpause-test", p.t);
    N.reload().catch(() => {});
    await A.reload();
    await A.waitForSelector("#join-card").catch(() => {});
    await center(A, "#join-card");
    await pause(A, 1500);
    await A.locator(JOINBTN).first().click().catch((e) => console.log("   ! join 2:", String(e.message).slice(0, 100)));
    await A.waitForURL(/\/app\/sessions\//, { timeout: 30000 }).catch(() => console.log("   ! no session page"));
    await pause(A, 2500);
    console.log("   [g1] invite:", sql(`select status from "Invite" where "testerId" = '${p.ana.uid}'`));
    await N.reload().catch(() => {});
    D.say("The same for a payment hold or a suspension of Nora: invites stay open and the invitee hears nothing.");
    await pause(N, 6000);
    await D.finish();
    X.noteScene(D, { page: "Invites and applications" });
  });

  // ---------- G2: a full test keeps pending applications; Accept refused while full; invitees told full / spot opened ----------
  scene("g2", async () => {
    const p = await pair({ spots: "1", joinMode: "apply" }, false);
    const ben = await third(`${p.tag}b`, "Ben Okafor");
    const cam = await third(`${p.tag}c`, "Cam Lee", "they");
    ok(await post(p.ana, `/api/tests/${p.t}/apply`, { ...go, seenAt: nowIso(), note: "" }), "Ana applies");
    ok(await post(ben, `/api/tests/${p.t}/apply`, { ...go, seenAt: nowIso(), note: "" }), "Ben applies");
    await invite(p.nora, p.t, cam.uid);
    const { N, A } = await both(p, `/app/tests/${p.t}`, `/app/find/${p.t}`);
    const D = X.duo("g2-full-keeps-applications", "Applications · a full test keeps them open; Accept waits for a spot");
    D.start([N, A]);
    const apps = N.locator("li[id^=item-app-]").first();
    await reveal(N, "li[id^=item-app-]");
    await pause(N, 2000);
    D.say("One spot. Ana and Ben applied; Cam is invited. Nora accepts Ben.");
    const benRow = N.locator("li[id^=item-app-]", { hasText: "Ben Okafor" }).first();
    await benRow.locator("button:has-text('Accept')").first().click().catch((e) => console.log("   ! accept Ben:", e.message.split("\n")[0]));
    await pause(N, 4000);
    const beforeA = bellCount(p.ana.uid), beforeC = bellCount(cam.uid);
    D.say("The test is full. Ana's application stays pending; her page and bell say nothing about it.");
    await A.reload();
    await A.waitForSelector("main h1");
    await pause(A, 3000);
    console.log("   [g2] Ana's join page:", (await textOf(A, "main")).slice(0, 400));
    await bell(A, `/app/find/${p.t}`);
    console.log(`   [g2] bells: Ana ${beforeA} -> ${bellCount(p.ana.uid)}, Cam ${beforeC} -> ${bellCount(cam.uid)}`);
    D.say("Nora presses Accept on Ana: refused, the test is full.");
    await N.reload();
    await N.waitForSelector("main h1");
    await pause(N, 2500);
    const anaRow = N.locator("li[id^=item-app-]", { hasText: "Ana Silva" }).first();
    await reveal(N, "li[id^=item-app-]");
    await anaRow.locator("button:has-text('Accept')").first().click().catch((e) => console.log("   ! accept Ana:", e.message.split("\n")[0]));
    await pause(N, 4000);
    await lines(N, "g2 accept full");
    D.say("Cam (invited) is told the test is full; Ana (applied) is told nothing.");
    console.log("   [g2] Cam's lines:", sql(`select string_agg(text, ' | ') from "Notification" where "userId" = '${cam.uid}'`));
    await pause(N, 4000);
    D.say("Nora adds a spot (Spots 1 → 2, off camera). Accept on Ana now goes ahead; Cam is told a spot opened.");
    await apiEdit(p.nora, p.t, { spots: "2" });
    await N.reload();
    await N.waitForSelector("main h1");
    await pause(N, 2500);
    const anaRow2 = N.locator("li[id^=item-app-]", { hasText: "Ana Silva" }).first();
    await reveal(N, "li[id^=item-app-]");
    await pause(N, 1500);
    await anaRow2.locator("button:has-text('Accept')").first().click().catch((e) => console.log("   ! accept Ana 2:", e.message.split("\n")[0]));
    await pause(N, 4000);
    await lines(N, "g2 accept after spot");
    console.log("   [g2] Cam's lines:", sql(`select string_agg(text, ' | ') from "Notification" where "userId" = '${cam.uid}'`));
    await bell(A);
    D.say("Ana's bell: she's in.");
    await pause(A, 4000);
    await D.finish();
    X.noteScene(D, { page: "Invites and applications" });
  });

  // ---------- G3: an edit no longer re-sends invites; switching to invite only closes applications; a test closing on its own rings invitees ----------
  scene("g3", async () => {
    const p = await pair({}, false);
    const ben = await third(`${p.tag}b`, "Ben Okafor");
    const tA = await X.postTest(p.nora, { title: "Night Harbor", joinMode: "apply" });
    const tC = await X.postTest(p.nora, { title: "Storm Coast" });
    await invite(p.nora, p.t, p.ana.uid);
    await invite(p.nora, tC, p.ana.uid);
    ok(await post(p.ana, `/api/tests/${tA}/apply`, { ...go, seenAt: nowIso(), note: "" }), "Ana applies");
    const { N, A } = await both(p, `/app/tests/${p.t}`, `/app/find/${p.t}`);
    const D = X.duo("g3-edits-invite-only-closing", "Invites · an edit keeps the invite; invite only closes applications; a closing test rings invitees");
    D.start([N, A]);
    await center(A, "#join-card, button:has-text('No thanks')");
    await pause(A, 2000);
    const b0 = bellCount(p.ana.uid);
    await editRace(D, N, A, p.t, " Try the night harbor too.", "Nora invited Ana. Now she edits the listing (Edit, Save): the invite is NOT sent again.");
    await pause(A, 1000);
    D.say("Ana presses Join before her page updates: one line, the edit in the top box.");
    await A.locator(JOINBTN).first().click().catch(() => {});
    await pause(A, 3500);
    await lines(A, "g3 join line");
    await toTop(A, 3000);
    console.log(`   [g3] Ana's bell lines ${b0} -> ${bellCount(p.ana.uid)} (no re-sent invite)`);
    D.say(`No new bell line for Ana (${b0} before, ${bellCount(p.ana.uid)} after). Pressed again, Join goes ahead.`);
    await A.locator(JOINBTN).first().click().catch(() => {});
    await A.waitForURL(/\/app\/sessions\//, { timeout: 30000 }).catch(() => console.log("   ! no session page"));
    await pause(A, 3000);
    // invite only closes the application
    D.say("Night Harbor: Ana applied. Nora switches it to invite only and edits the steps in the same Save.");
    await N.goto(`/app/tests/${tA}/edit`);
    await N.waitForSelector("#description");
    await center(N, "#joinMode");
    await N.locator("#joinMode").selectOption("invite").catch((e) => console.log("   ! joinMode:", e.message.split("\n")[0]));
    await N.locator("#description").click();
    await N.keyboard.press("End");
    await N.keyboard.type(" Invited players only.", { delay: 25 });
    await noraSaves(N);
    await pause(N, 2000);
    await bell(A, `/app/find/${tA}`);
    D.say("Ana's bell and her join page: her application was closed because the test is now invite only (not “the listing changed”).");
    console.log("   [g3] Ana's lines:", sql(`select string_agg(text, ' | ' order by "createdAt") from "Notification" where "userId" = '${p.ana.uid}'`));
    await pause(A, 5000);
    // A test closing on its own
    D.say("Storm Coast: Ana is invited. Its Open until passes with nobody working (moved in the database, as the clock would): the test closes on its own.");
    await N.goto(`/app/tests/${tC}`);
    await N.waitForSelector("main h1");
    own(`update "Test" set "openUntil" = ${utcNow} - interval '1 hour' where id = '${tC}'`);
    await pause(N, 1000);
    await N.reload();
    await pause(N, 4000);
    await waitLive(N, "text=/ended|closed/i", 20000);
    await bell(A, `/app/find/${tC}`);
    console.log("   [g3] Ana's lines:", sql(`select string_agg(text, ' | ' order by "createdAt") from "Notification" where "userId" = '${p.ana.uid}'`));
    D.say("Ana's bell rings: “Your invite to “Storm Coast” was closed.”");
    await pause(A, 5000);
    await D.finish();
    X.noteScene(D, { page: "Invites and applications" });
  });
};
