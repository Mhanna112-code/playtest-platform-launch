// Warms the 3450 dev server (each page and API route compiled once) so the recordings don't wait for compiles. Not a recording.
const X = require("./lib.cjs");
(async () => {
  await X.launch();
  const t0 = Date.now();
  const nora = await X.account("wn", "Nora Lane", "developer");
  const ana = await X.account("wa", "Ana Silva", "tester");
  const t = await X.postTest(nora, { recordingCents: "15.00", liveRateCents: "30.00", liveMinutes: "30" });
  const s = await X.join(ana, t);
  const pages = [[nora, `/app/tests/${t}`], [nora, `/app/tests/${t}/edit`], [ana, `/app/sessions/${s}`], [ana, `/app/find/${t}`], [nora, "/app"], [ana, "/app"], [nora, "/app/profile"], [nora, "/app/payments"],
    [nora, "/app/notifications"], [nora, "/app/account"], [ana, `/app/chat/${s}`], [ana, "/app/find"], [nora, "/app/tests/new"], [nora, `/app/testers/${ana.uid}`]];
  await Promise.all(pages.map(async ([who, u]) => { const p = await who.context().newPage(); const a = Date.now(); await p.goto(X.BASE + u, { timeout: 300000 }).catch((e) => console.log("!", u, e.message.split("\n")[0])); console.log("page", u, ((Date.now() - a) / 1000).toFixed(0), "s"); await p.waitForTimeout(4000); await p.close(); }));
  const apis = ["/api/account/alerts", "/api/account/notify", "/api/account/side", "/api/account/tester-alerts", "/api/admin/pause-test", "/api/auth/password", "/api/blocks", "/api/calls/x/join", "/api/chat/open", "/api/excerpts", "/api/invites/x",
    "/api/payments/card", "/api/payments/confirm", "/api/payments/confirm-all", "/api/payments/owed", "/api/payments/subscription", "/api/profile", "/api/review", `/api/sessions/${s}/written`, `/api/tests/${t}/invite`, "/api/stripe/webhook", "/api/page-handover", "/api/notifications/read", "/api/reports"];
  await Promise.all(apis.map(async (u) => { const a = Date.now(); X.post.quiet = true; await X.post(nora, u, {}).catch(() => {}); console.log("api", u, ((Date.now() - a) / 1000).toFixed(0), "s"); }));
  console.log("warm in", ((Date.now() - t0) / 1000).toFixed(0), "s");
  await X.L.browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
