// Stops the processes start.cjs started, by their PIDs (each with its children), and nothing else.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const LOGDIR = process.env.MEDIA_STRIPE_LOGS || path.join(__dirname, "logs");
const pids = JSON.parse(fs.readFileSync(path.join(LOGDIR, "pids.json"), "utf8"));
for (const name of ["next", "next-email", "listen", "viewer", "supervisor"]) {
  if (!pids[name]) continue;
  const r = spawnSync("taskkill", ["/PID", String(pids[name]), "/T", "/F"], { encoding: "utf8" });
  console.log(name, pids[name], (r.stdout || r.stderr || "").trim().split("\n")[0]);
}
