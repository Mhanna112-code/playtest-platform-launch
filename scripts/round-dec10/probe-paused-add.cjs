// Probe (not a recording): what Ana's Add box shows after an Add refused because the team paused the test (the page not yet updated).
const X = require("./lib.cjs");
(async () => {
  await X.launch();
  const nora = await X.account("ppn", "Nora Lane", "developer");
  const ana = await X.account("ppa", "Ana Silva", "tester");
  const t = await X.postTest(nora, {});
  const s = await X.join(ana, t);
  await X.sendWritten(ana, s);
  const A = X.safe(await ana.context().newPage());
  await A.goto(`/app/sessions/${s}`);
  await A.waitForSelector("main h1");
  await A.waitForTimeout(3000);
  await X.unfold(A, "[data-add-more=written]");
  await A.locator("[data-add-more=written]").first().click();
  await X.typeIn(A, "[data-add-box] textarea", "One more thing: the lighthouse level has no checkpoint before the storm.", 2);
  await X.waitPulse(A);
  await X.adminDo("pause-test", t);
  const resp = A.waitForResponse((r) => /written-add/.test(r.url()));
  await A.locator("[data-add-send=written]").first().click();
  console.log("answer:", (await resp).status());
  for (const ms of [300, 1500, 5000]) {
    await A.waitForTimeout(ms);
    const box = await A.evaluate(() => { const b = document.querySelector("[data-add-box]"); return b ? b.innerText.replace(/\s+/g, " ").slice(0, 600) : "(no add box)"; });
    const any = await A.evaluate(() => [...document.querySelectorAll("p, [role=status]")].map((p) => p.innerText.trim()).filter((t) => /didn't go through|paused/i.test(t)).slice(0, 8));
    console.log(`after +${ms} ms:`, box, "\n   lines:", JSON.stringify(any));
  }
  await X.L.browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
