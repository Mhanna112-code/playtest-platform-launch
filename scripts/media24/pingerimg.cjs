process.env.PLAYWRIGHT_BROWSERS_PATH = require("path").join(require("os").tmpdir(), "playtest-lite-evidence-pw");
const { chromium } = require("C:/Users/march/Projects/playtest-platform/node_modules/playwright");
const fs = require("fs");
const log = fs.readFileSync(__dirname + "/logs/outreal.log", "utf8");
const block = log.split("pinger log:")[1].split("   + ")[0].split("\n").map((l) => l.trim()).filter(Boolean);
const extra = log.split("\n").filter((l) => /\[pinger\] 07:5[4-9]/.test(l)).map((l) => l.replace(/.*\[pinger\] /, ""));
const lines = [...block, ...extra];
(async () => {
  const b = await chromium.launch({ channel: "chrome" });
  const p = await b.newPage({ viewport: { width: 1100, height: 140 + lines.length * 21 } });
  await p.setContent(`<pre style="font:14px/1.5 ui-monospace,monospace;padding:16px;background:#0b1020;color:#cbd5e1;margin:0">The stand-in for UptimeRobot (a local script): keyed /api/health every minute,\nthe "down" alert after two failed checks in a row and the "up" alert on the first success after it,\nboth to the app's alert webhook (/api/health/alert, as UptimeRobot's webhook contact would).\n\n${lines.map((l) => l.replace(/[<>&]/g, "")).join("\n")}</pre>`);
  await p.screenshot({ path: "C:/Users/march/Projects/playtest-lite/docs/media/outage-real-pinger.png", fullPage: true });
  await b.close();
  console.log(lines.length, "lines");
})();
