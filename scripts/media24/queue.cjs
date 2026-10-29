// node queue.cjs <name> <group[:sizes]> ...: runs scripts/media.cjs once per group (ONLY=<group>), one after another, logging to logs/q-<name>.log,
// and the results to logs/q-<name>.results. sizes default desktop,phone (e.g. blk1:phone).
const { spawnSync } = require("child_process");
const fs = require("fs"), path = require("path");
const [name, ...items] = process.argv.slice(2);
const log = path.join(__dirname, "logs", `q-${name}.log`), res = path.join(__dirname, "logs", `q-${name}.results`);
for (const it of items) {
  if (fs.existsSync(path.join(__dirname, "STOP-QUEUES"))) { fs.appendFileSync(res, `stopped before ${it}\n`); break; }
  const [g, sizes = "desktop,phone"] = it.split(":");
  const t0 = Date.now();
  fs.appendFileSync(log, `\n######## ${g} ${sizes} ${new Date().toTimeString().slice(0, 8)}\n`);
  const r = spawnSync(process.execPath, ["scripts/media.cjs"], {
    cwd: "C:/Users/march/Projects/playtest-lite",
    env: { ...process.env, BROWSER_CHANNEL: "chrome", BASE: "http://localhost:3450", MEDIA_DB: "playtest_lite_media", ONLY: g, SIZES: sizes },
    encoding: "utf8", maxBuffer: 1 << 28, timeout: 45 * 60000,
  });
  fs.appendFileSync(log, (r.stdout || "") + (r.stderr || ""));
  const results = /results:\n([\s\S]*?)\ndone:/.exec(r.stdout || "");
  fs.appendFileSync(res, `${g} ${sizes} ${Math.round((Date.now() - t0) / 60000)} min: ${results ? results[1].trim().replace(/\s+/g, " ") : "NO RESULT (exit " + r.status + (r.error ? " " + r.error.code : "") + ")"}\n`);
}
fs.appendFileSync(res, "queue done\n");
