process.env.PLAYWRIGHT_BROWSERS_PATH = require("path").join(require("os").tmpdir(), "playtest-lite-evidence-pw");
const { chromium } = require("C:/Users/march/Projects/playtest-platform/node_modules/playwright");
const race = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r("TIMEOUT"), ms))]);
(async () => {
  const b = await chromium.launch({ channel: "chrome", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--disable-features=WebRtcHideLocalIpsWithMdns"] });
  const pages = [];
  for (let i = 0; i < 2; i++) { const c = await b.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: __dirname + "/gt", size: { width: 1280, height: 900 } } }); await c.grantPermissions(["camera", "microphone"]); await c.route("http://localhost:9/**", (r) => r.fulfill({ contentType: "text/html", body: "<p>x</p>" })); const p = await c.newPage(); await p.goto("http://localhost:9/x"); pages.push(p); }
  const t0 = Date.now();
  const r = await Promise.all(pages.map((p) => race(p.evaluate(async () => { try { const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); return s.getTracks().map((t) => t.kind).join(","); } catch (e) { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); return "audio-only after " + e.name; } catch (e2) { return "ERR " + e2.name; } } }), 30000)));
  console.log(r, Date.now() - t0, "ms");
  await b.close(); process.exit(0);
})();
