    const joinBtn = Tinv.locator("button", { hasText: /^Join this test$/ }).first();
    const canJoin = await joinBtn.isVisible().catch(() => false);
    if (canJoin) for (const cb of await Tinv.locator("main input[type=checkbox]").all()) await cb.check().catch(() => {});
    else console.log("   ! stale join: no Join button on the invite page:", (await say(Tinv, "main")).slice(0, 300));
    await pause(Dinv, 1000);
    // The block (Rio, in another tab), then every press at once, before any page's next update.
    await blockDev(rio, nora);
    const press = (what, p) => p.catch((e) => console.log(`   ! ${what} press:`, String(e.message).split("\n")[0]));
    await Promise.all([
      press("invite", Dinv.locator("#invite button", { hasText: /^Invite$/ }).click()),
      press("pay", Dpay.locator(`#piece-${sub} button`, { hasText: /^Pay$/ }).first().click()),
      press("request", Dreq.click("#calls button:has-text('Request a time')")),
      press("send", Tsend.locator("button", { hasText: /^Send my answers$/ }).first().click()),
      press("join call", Tjoin.locator("[data-join-call] button").first().click()),
      canJoin ? press("join", joinBtn.click()) : null,
    ]);
    // Each page's answer (the server can be slow tonight).
    const answered = (page, sel) => page.waitForSelector(sel, { timeout: 60000 }).catch(() => console.log("   ! no answer for", sel, "on", page.url()));
    await Promise.all([
      answered(Dinv, "#invite [data-stop-box], #invite .err, #invite .info, #invite [role=alert]"),
      answered(Dpay, `#piece-${sub} [data-stop-box], #piece-${sub} .err, #piece-${sub} .info, #piece-${sub} [role=alert], text=/Paid \\$/`),
      answered(Dreq, "#calls [data-stop-box], #calls .err, #calls .info, #calls [role=alert]"),
      answered(Tsend, "#part-written ~ * .err, [data-stop-box], form .err, form [role=alert], .info"),
      answered(Tjoin, "[data-join-call] .err, [data-join-call] [role=alert], [data-join-call=gone]"),
    ]);
    await pause(Dinv, 1500);
    console.log("   invite race:", (await say(Dinv, "#invite")).slice(-400));
    await shot(Dinv, "blk-02-invite", "Invite vs the block | Nora's Invite, ticked on a page opened before the block.", "#invite");
    console.log("   pay race:", (await say(Dpay, `#piece-${sub}`)).slice(-400));
    await shot(Dpay, "blk-02-pay", "Pay vs the block | Nora's Pay on Rio's sent answers, from a page opened before the block.", `#piece-${sub}`);
    console.log("   request race:", (await say(Dreq, "#calls")).slice(0, 600));
    await shot(Dreq, "blk-02-request", "Request a time vs the block | Nora's Request a time for Rio, from a page opened before the block.", liveSession(Dreq));
    console.log("   send race:", (await say(Tsend, "main")).slice(0, 300));
    await shot(Tsend, "blk-02-send", "Send vs the block | Rio's Send, from a session page opened before the block.", Tsend.locator("#a0").locator("xpath=ancestor::form[1]"));
    console.log("   join race:", await say(Tjoin, "[data-join-call]"));
    if (await Tjoin.locator("[data-join-call]").count()) await shot(Tjoin, "blk-02-join-call", "Join call vs the block | Rio's Join call on the call starting in 5 minutes, from a page opened before the block.", Tjoin.locator("[data-join-call]").first().locator("xpath=ancestor::*[self::li or self::section][1]"));
    if (canJoin) {
      await pause(Tinv, 1500);
      console.log("   stale join:", (await say(Tinv, "main")).slice(-400));
      await shot(Tinv, "blk-02-stale-join", "A stale Join on a closed invite | Rio's join page for the invite-only test, opened before the block: Join is refused.", joinBtn.locator("xpath=ancestor::*[self::form or self::section or self::div][1]"));
    }
    // The second presses: Invite and Pay again.
    await Dinv.locator("#invite button", { hasText: /^Invite$/ }).click().catch(() => {});
    await Dpay.locator(`#piece-${sub} button`, { hasText: /^Pay$/ }).first().click().catch(() => {});
    await pause(Dinv, 6000);
    console.log("   invite second press:", (await say(Dinv, "#invite")).slice(-400), "| invites to Rio on tC:", sql(`select count(*) from "Invite" where "testId" = '${tC}'`));
    await shot(Dinv, "blk-02-invite-again", "Invite pressed again | The second press after the block.", "#invite");
    await Dpay.waitForSelector("text=/Paid \\$|paid \\$10\\.00 of/", { timeout: 40000 }).catch(() => {});
    console.log("   pay second press:", (await say(Dpay, `#piece-${sub}`)).slice(-300), "| payments:", sql(`select count(*) from "Payment" where "submissionId" = '${sub}' and status = 'charged'`));
    await shot(Dpay, "blk-02-pay-again", "Pay pressed again | The second press pays Rio's sent answers: sent work stays payable after a block.", Dpay.locator(`#piece-${sub}`).count().then((n) => (n ? `#piece-${sub}` : undefined)) ? `#piece-${sub}` : undefined);
