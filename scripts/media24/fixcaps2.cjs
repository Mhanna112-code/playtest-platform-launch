const fs = require("fs"), path = require("path");
const OUT = "C:/Users/march/Projects/playtest-lite/docs/media";
const F = path.join(OUT, "captions.json"), lock = path.join(OUT, ".captions-lock");
for (let i = 0; ; i++) { try { fs.mkdirSync(lock); break; } catch { if (i > 300) throw new Error("locked"); require("child_process").execSync("ping -n 2 127.0.0.1 >nul"); } }
try {
  const c = JSON.parse(fs.readFileSync(F, "utf8"));
  const set = (file, title, caption) => { if (!c[file]) return console.log("no entry", file); c[file].title = title; c[file].caption = caption; };
  const both = (base, title, cap, capPhone = cap) => { set(base + ".png", title, cap); if (c[base + "-phone.png"]) set(base + "-phone.png", title, capPhone); };
  both("outage-real-before-dev", "A real outage: before (developer)", "Nora's test page while the site is up: Ana's written answers waiting in Needs you (“Listing: $10.00 for written answers”), with a call booked for later today.");
  both("outage-real-before-tester", "A real outage: before (tester)", "Ana's session page while the site is up: “Your deadline on Harbor Run: first 3 levels is in 5 hours 59 minutes: send your work before then.” and “Due Oct 29, 2026 · 5 h 59 min left”.");
  set("outage-real-down-dev.png", "A real outage: the site is down", "The server was really stopped at 07:37 (local): reloading Nora's test page shows the browser's own page, “This site can't be reached · localhost refused to connect · ERR_CONNECTION_REFUSED”.");
  set("outage-real-down-tester-phone.png", "A real outage: the site is down", "Ana's page on a phone, reloaded while the server is stopped: “This site can't be reached”.");
  both("outage-real-after-dev", "A real outage: after the restart (developer)", "The server answers again at 07:53 after 16 real minutes stopped: no “The site was down” line, and Ana's answers still read “sent Thu, Oct 29, 7:36 AM”; nothing moved, because no outage was recorded.");
  both("outage-real-after-tester", "A real outage: after the restart (tester)", "“Your deadline on Harbor Run: first 3 levels is in 5 hours 42 minutes” and “Due Oct 29, 2026 · 5 h 43 min left”: 16 minutes less than before the stop, because the deadline didn't move (no outage was recorded).");
  const v = "The server was really stopped at 07:37 and started again at 07:53 (local); about 16 real minutes of waiting were trimmed from this video. Nora's test page (left) and Ana's session page (right): before, the browser's “This site can't be reached” while it's down, and after the restart the same dates as before: no outage was recorded and no clock moved.";
  set("outage-real.webm", "A real outage, 16 minutes", v);
  set("outage-real-phone.webm", "A real outage, 16 minutes", v);
  set("outage-real-admin.png", "The admin's Outages after the real stop", "Only the two older outages from Oct 28 (simulated, alerts sent by hand) are listed; the real 16-minute stop isn't: the stand-in's “down” alert couldn't reach the stopped server, and the “up” alert alone records nothing.");
  set("outage-real-pinger.png", "The stand-in for UptimeRobot", "What the local stand-in saw each minute: “keyed /api/health → no answer (ECONNREFUSED)” from 07:38 to 07:53, “down alert → not delivered: ECONNREFUSED”, then “up alert → 200 {\"ok\":true,\"type\":\"up\",\"outage\":null}”.");
  fs.writeFileSync(F, JSON.stringify(c, null, 2));
  console.log("ok");
} finally { fs.rmSync(lock, { recursive: true, force: true }); }
