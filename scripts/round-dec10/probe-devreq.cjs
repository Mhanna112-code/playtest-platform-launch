// Probe (not a recording): the developer's call-request controls on the test page.
const X = require("./lib.cjs");
(async () => {
  await X.launch();
  const nora = await X.account("pdn", "Nora Lane", "developer");
  const ana = await X.account("pda", "Ana Silva", "tester");
  const t = await X.postTest(nora, { liveRateCents: "30.00", liveMinutes: "30" });
  const s = await X.join(ana, t);
  const d = new Date(Date.now() + 3 * 86400000); d.setMinutes(0, 0, 0);
  console.log((await X.post(ana, `/api/sessions/${s}/request-time`, { confirmed: true, seenAt: X.nowIso(), minutes: 30, times: [d.toISOString()] })).status);
  const N = X.safe(await nora.context().newPage());
  await N.goto(`/app/tests/${t}`); await N.waitForSelector("main h1"); await N.waitForTimeout(3000);
  const out = await N.evaluate(() => [...document.querySelectorAll("main button, main summary, main select")].filter((b) => /accept|decline|request|answer/i.test(b.textContent || "")).map((b) => {
    const chain = []; for (let n = b.parentElement; n && n.tagName !== "MAIN"; n = n.parentElement) if (n.id || n.tagName === "DETAILS") chain.push(n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") + (n.tagName === "DETAILS" ? (n.open ? "[open]" : "[closed]") : ""));
    return `${b.tagName} "${(b.textContent || "").trim().slice(0, 40)}" visible=${b.getClientRects().length > 0} in ${chain.slice(0, 5).join(" < ")}`;
  }));
  console.log(out.join("\n"));
  await X.L.browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
