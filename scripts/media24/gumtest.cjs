const { chromium } = require("C:/Users/march/Projects/playtest-platform/node_modules/playwright");
const race = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r("TIMEOUT"), 8000))]);
(async () => {
  const sets = [
    ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--auto-select-desktop-capture-source=Entire screen", "--enable-usermedia-screen-capturing", "--auto-accept-this-tab-capture"],
  ];
  for (const extra of sets) {
    for (const perms of [true, false]) {
      const b = await chromium.launch({ channel: "chrome", args: extra });
      const c = await b.newContext(perms ? { permissions: ["camera", "microphone"] } : {});
      const p = await c.newPage();
      await p.goto("http://localhost:3450/terms");
      const r = await race(p.evaluate(async () => { try { const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); return s.getTracks().map((t) => t.kind + ":" + t.label).join(","); } catch (e) { return "ERR " + e.name + " " + e.message; } }));
      const d = await race(p.evaluate(async () => { try { const s = await navigator.mediaDevices.getDisplayMedia({ video: true }); return s.getTracks().map((t) => t.kind + ":" + t.label).join(","); } catch (e) { return "ERR " + e.name + " " + e.message; } }));
      console.log(extra.length, perms, r, "| display:", d);
      await b.close().catch(() => {});
    }
  }
  process.exit(0);
})();
