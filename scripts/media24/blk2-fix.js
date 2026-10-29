    const joinBtn = Tinv.locator("button", { hasText: /^Join this test$/ }).first();
    const canJoin = await joinBtn.waitFor({ state: "visible", timeout: 60000 }).then(() => true, () => false);
    if (canJoin) for (const cb of await Tinv.locator("main input[type=checkbox]").all()) await cb.check().catch(() => {});
    else console.log("   ! stale join: no Join button on the invite page:", (await say(Tinv, "main")).slice(0, 300));
    await pause(Dinv, 1000);
    // The block (Rio, in another tab). The server is slow tonight and the pages update on their own once it's done, so each press goes the moment the
    // database shows the block's effect (both sessions ended and the invite cancelled), before any page's next update.
    const blocking = blockDev(rio, nora).catch((e) => console.log("   ! block:", String(e.message).slice(0, 150)));
    const t0b = Date.now();
    while (Date.now() - t0b < 180000 && sql(`select count(*) from "Contract" where id in ('${s}', '${sB}') and status = 'ended'`) !== "2") await new Promise((r) => setTimeout(r, 150));
    while (Date.now() - t0b < 180000 && sql(`select status from "Invite" where "testId" = '${tInv}'`) !== "cancelled") await new Promise((r) => setTimeout(r, 150));
    console.log(`   the block's effect was in the database after ${((Date.now() - t0b) / 1000).toFixed(1)} s`);
    const press = (what, p) => p.catch((e) => console.log(`   ! ${what} press:`, String(e.message).split("\n")[0]));
    await Promise.all([
      press("invite", Dinv.locator("#invite button", { hasText: /^Invite$/ }).click()),
      press("pay", (async () => { await Dpay.locator(`#piece-${sub} [data-pay-tick] input`).first().check(); await Dpay.locator(`#piece-${sub} button`, { hasText: /^Pay$/ }).first().click(); })()),
      press("request", Dreq.click("#calls button:has-text('Request a time')")),
      press("send", Tsend.locator("button", { hasText: /^Send my answers$/ }).first().click()),
      press("join call", Tjoin.locator("[data-join-call] button").first().click()),
      canJoin ? press("join", joinBtn.click()) : null,
    ]);
    await blocking;
