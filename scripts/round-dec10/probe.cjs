// Probe: lists the session page's and the test page's buttons and ids (to write the scenes). Not a recording.
const X = require("./lib.cjs");
(async () => {
  await X.launch();
  const nora = await X.account("pn", "Nora Lane", "developer");
  const ana = await X.account("pa", "Ana Silva", "tester");
  const t = await X.postTest(nora, { recordingCents: "15.00", liveRateCents: "30.00", liveMinutes: "30", spots: "3" });
  const s = await X.join(ana, t);
  await X.sendWritten(ana, s);
  const dump = async (p, url) => {
    await p.goto(url); await p.waitForSelector("main h1"); await p.waitForTimeout(2500);
    const r = await p.evaluate(() => ({
      ids: [...document.querySelectorAll("main [id]")].map((e) => `${e.tagName.toLowerCase()}#${e.id}`).slice(0, 80),
      buttons: [...document.querySelectorAll("main button, main a.btn")].map((b) => `${b.textContent.trim().slice(0, 50)}${b.disabled ? " (disabled)" : ""}${b.title ? " [" + b.title.slice(0, 80) + "]" : ""}`),
      data: [...new Set([...document.querySelectorAll("main *")].flatMap((e) => [...e.attributes].map((a) => a.name).filter((n) => n.startsWith("data-"))))],
      h2: [...document.querySelectorAll("main h2, main h3, main summary")].map((h) => h.textContent.trim().slice(0, 60)),
    }));
    console.log(url, JSON.stringify(r, null, 1));
  };
  await dump(ana, `/app/sessions/${s}`);
  await dump(nora, `/app/tests/${t}`);
  await dump(ana, `/app/find/${t}`);
  console.log("ids", t, s);
  await X.L.browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
