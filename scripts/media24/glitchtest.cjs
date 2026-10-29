// Which action makes a recording show a smaller frame? Records /terms and does one kind of action at known times.
process.env.PLAYWRIGHT_BROWSERS_PATH = require("path").join(require("os").tmpdir(), "playtest-lite-evidence-pw");
const { chromium } = require("C:/Users/march/Projects/playtest-platform/node_modules/playwright");
const { execFileSync } = require("child_process");
const FF = "C:/Users/march/Projects/playtest-platform/node_modules/ffmpeg-static/ffmpeg.exe";
const path = require("path");
(async () => {
  const b = await chromium.launch({ channel: "chrome" });
  const mode = process.argv[2] || "viewport";
  const phone = process.argv[3] === "phone";
  const vp = phone ? { width: 375, height: 812 } : { width: 1280, height: 900 };
  const c = await b.newContext({ viewport: vp, ...(phone ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}), recordVideo: { dir: __dirname + "/gt", size: vp } });
  const p = await c.newPage();
  const t0 = Date.now();
  await p.goto("http://localhost:3450/terms");
  await p.waitForTimeout(2000);
  const marks = [];
  for (let i = 0; i < 4; i++) {
    marks.push(((Date.now() - t0) / 1000).toFixed(1));
    if (mode === "viewport") await p.screenshot({ path: __dirname + "/gt/x.png" });
    if (mode === "clip") await p.screenshot({ path: __dirname + "/gt/x.png", clip: { x: 10, y: 100, width: 300, height: 200 } });
    if (mode === "cdp") { const s = await c.newCDPSession(p); await s.send("Page.captureScreenshot", { format: "png" }); await s.detach(); }
    if (mode === "goto") await p.goto("http://localhost:3450/terms?x=" + i);
    if (mode === "scroll") await p.evaluate(() => window.scrollBy(0, 400));
    await p.waitForTimeout(1500);
  }
  const v = p.video();
  await c.close();
  const f = await v.path();
  await b.close();
  const out = execFileSync(FF, ["-hide_banner", "-i", f, "-vf", `crop=20:${vp.height}:${vp.width - 22}:0,signalstats,metadata=print:file=-`, "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] }).toString();
  let t = 0; const hits = [];
  for (const line of out.split(/\r?\n/)) { let m = /pts_time:([\d.]+)/.exec(line); if (m) t = Number(m[1]); m = /YMIN=(\d+)/.exec(line); if (m && Number(m[1]) >= 120 && Number(m[1]) <= 132) hits.push(t.toFixed(2)); }
  console.log(mode, phone ? "phone" : "desktop", "actions at", marks.join(" "), "gray frames at", hits.join(" ") || "none");
})();
