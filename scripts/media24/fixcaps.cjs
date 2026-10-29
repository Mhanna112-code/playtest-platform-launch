// Fills captions.json entries lost when runs were killed (with the lock media.cjs uses), from the forks' notes and the part code, after looking at each picture.
const fs = require("fs"), path = require("path");
const OUT = "C:/Users/march/Projects/playtest-lite/docs/media";
const F = path.join(OUT, "captions.json"), lock = path.join(OUT, ".captions-lock");
for (let i = 0; ; i++) { try { fs.mkdirSync(lock); break; } catch { if (i > 300) throw new Error("locked"); require("child_process").execSync("ping -n 2 127.0.0.1 >nul"); } }
try {
  const c = JSON.parse(fs.readFileSync(F, "utf8"));
  const add = (file, section, group, order, title, caption) => {
    if (!fs.existsSync(path.join(OUT, file))) return console.log("no file", file);
    c[file] = { caption, kind: file.endsWith(".webm") ? "video" : "image", title, section, group, order, size: file.includes("-phone.") ? "phone" : "desktop" };
  };
  const B20 = "Batch 20 (Oct 29)", B22 = "Batch 22 (Oct 29)";
  add("b20-13-pill.png", B20, "b20g", 7001, "§13 While typing: the pill, no scroll", "Ben Okafor is typing an answer when the developer requests a call: the page stays put and a small “1 new update ↑” pill shows at the bottom, above Send my answers.");
  add("b20-13-live-line.png", B20, "b20g", 7002, "§13 The line in the live box", "Pressing the pill goes up to the live box, which lists the request: “Updated · 6:47 AM: Nora Lane requested a call for Mon, Nov 2, 4:00 PM”.");
  add("b20-13-video.webm", B20, "b20g", 7003, "§13 A call request while typing", "The tester keeps typing as the developer requests a call: no jump, the “1 new update ↑” pill appears; pressed, it goes up to the live box's line.");
  add("b22-05-two-admins.png", B22, "b22d", 4001, "§5 Two admins at once", "Bo presses Lift the pause a moment after Ada: “That test's pause was already lifted (by <Ada's email> at 7:08 AM).”, and the row's button is Pause again.");
  const extra = JSON.parse(fs.readFileSync(path.join(__dirname, "caps-b2324.json"), "utf8"));
  for (const [f, v] of Object.entries(extra)) if (fs.existsSync(path.join(OUT, f))) c[f] = { ...c[f], ...v };
  for (const f of Object.keys(c)) if (!fs.existsSync(path.join(OUT, f))) delete c[f];
  fs.writeFileSync(F, JSON.stringify(c, null, 2));
  console.log("captions:", Object.keys(c).length);
} finally { fs.rmSync(lock, { recursive: true, force: true }); }
