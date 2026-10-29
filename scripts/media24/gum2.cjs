process.env.PLAYWRIGHT_BROWSERS_PATH = require("path").join(require("os").tmpdir(), "playtest-lite-evidence-pw");
const { chromium } = require("C:/Users/march/Projects/playtest-platform/node_modules/playwright");
(async () => {
  const b = await chromium.launch({ channel: "chrome", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const pages = [];
  const b2 = await chromium.launch({ channel: "chrome", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  for (let i = 0; i < 2; i++) { const c = await (i ? b2 : b).newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: __dirname + "/gt", size: { width: 1280, height: 900 } } }); await c.grantPermissions(["camera","microphone"]).catch(e=>console.log("grant",e.message)); const p = await c.newPage(); await p.goto("http://localhost:3450/terms"); pages.push(p); }
  for (const p of pages) console.log(await p.evaluate(async () => { try { const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); return s.getTracks().map((t) => t.kind + ":" + t.label).join(","); } catch (e) { return "ERR " + e.name + " " + e.message; } }));
  await b.close(); process.exit(0);
})();
