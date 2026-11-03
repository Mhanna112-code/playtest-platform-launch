// Stops only the process tree started by start.cjs (its pids.json), never anything else.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const pids = JSON.parse(fs.readFileSync(path.join(__dirname, "logs", "pids.json"), "utf8"));
for (const [name, pid] of Object.entries(pids)) {
  try { execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }); console.log("stopped", name, pid); } catch { console.log("not running", name, pid); }
}
