// Probe (not a recording): which listing edits stop Withdraw application once (non-closing fields).
const X = require("./lib.cjs");
(async () => {
  await X.launch();
  const nora = await X.account("pwn", "Nora Lane", "developer");
  X.post.quiet = true;
  for (const [field, val] of [["deadlineDays", "10"], ["spots", "6"], ["openUntil", X.day(20)], ["categories", ["Game", "Puzzle"]], ["title", "Harbor Run levels"]]) {
    const ana = await X.account(`pwa${field.slice(0, 4)}`, "Ana Silva", "tester");
    const t = await X.postTest(nora, { joinMode: "apply", title: `Harbor ${field}`.slice(0, 20).padEnd(10, "x") });
    await X.post(ana, `/api/tests/${t}/apply`, { confirmed: true, seenAt: X.nowIso(), note: "" });
    const seen = X.nowIso();
    await new Promise((r) => setTimeout(r, 1200));
    const e = await X.post(nora, `/api/tests/${t}/edit`, { version: (await X.get(nora, `/api/tests/${t}/listing`)).version, fields: { [field]: val }, confirmed: true, keysAdd: [], keysRemove: [], payRulesOk: true });
    const w = await X.post(ana, `/api/tests/${t}/withdraw-application`, { seenAt: seen });
    console.log(field, "edit", e.status, "| withdraw:", w.status, JSON.stringify(w.body).slice(0, 160));
  }
  await X.L.browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
