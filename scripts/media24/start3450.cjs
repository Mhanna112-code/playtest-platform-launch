// Starts the media server on 3450 (detached), logs to server-<n>.log, writes its PID to server.pid.
const { env, ROOT } = require("./mediaenv.cjs");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const log = path.join(__dirname, `server-${Date.now()}.log`);
const fd = fs.openSync(log, "a");
const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const p = spawn(process.execPath, [nextBin, "dev", "-p", "3450"], { cwd: ROOT, env: env(), detached: true, stdio: ["ignore", fd, fd], windowsHide: true });
p.unref();
fs.writeFileSync(path.join(__dirname, "server.pid"), String(p.pid));
console.log("started pid", p.pid, "log", log);
