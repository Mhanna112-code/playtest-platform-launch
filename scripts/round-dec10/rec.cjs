// Dec 10 media round: the recordings (docs/media/round-dec10/). Run against the 3450 media server only (see env.cjs / start3450.cjs; warm.cjs first):
//   node scripts/round-dec10/rec.cjs a1,a2      (the scenes to record; all when none named)
// Each scene (scenes/*.cjs) records Nora (developer, left) and Ana (tester, right) side by side with captions; scenes.json collects each video's steps for INDEX.md.
/* eslint-disable */
const fs = require("fs");
const path = require("path");
const X = require("./lib.cjs");
const scenes = {};
const scene = (id, fn) => { scenes[id] = fn; };
for (const f of fs.readdirSync(path.join(__dirname, "scenes")).filter((f) => f.endsWith(".cjs")).sort()) require(path.join(__dirname, "scenes", f))(scene);

(async () => {
  await X.launch();
  const want = (process.argv[2] || Object.keys(scenes).join(",")).split(",");
  const results = [];
  for (const id of want) {
    if (!scenes[id]) { console.log("no scene", id); continue; }
    console.log("==", id, new Date().toTimeString().slice(0, 8));
    try {
      X.resetAdmin();
      await scenes[id]();
      results.push(`${id}: pass`);
    } catch (e) {
      results.push(`${id}: FAILED`);
      console.log("   FAILED", id, String(e.stack || e).split("\n").slice(0, 5).join(" | "));
      let k = 0;
      for (const c of X.L.browser.contexts()) for (const pg of c.pages()) await pg.screenshot({ path: path.join(X.VTMP, `${id}-FAILED-${++k}.png`) }).catch(() => {});
      console.log("   failure shots in", X.VTMP);
    }
    for (const c of X.L.browser.contexts()) await c.close().catch(() => {});
  }
  await X.L.browser.close();
  console.log("results:\n  " + results.join("\n  "));
})();
