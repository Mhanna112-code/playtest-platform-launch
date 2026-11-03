// Runs the 3490 dev server from the pl-rec worktree (rec schema, Stripe test keys); every output line is passed through the key filter. Its PID goes to logs/next.pid.
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { env, WT, red } = require("./env.cjs");
const LOG = path.join(__dirname, "logs");
fs.mkdirSync(LOG, { recursive: true });
const p = spawn(process.execPath, [path.join(WT, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", "3490"], { cwd: WT, env: env(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
fs.writeFileSync(path.join(LOG, "next.pid"), String(p.pid));
fs.writeFileSync(path.join(LOG, "serve.pid"), String(process.pid));
p.stdout.on("data", (c) => process.stdout.write(red(c)));
p.stderr.on("data", (c) => process.stderr.write(red(c)));
p.on("exit", (c) => { console.log("next exited", c); process.exit(c ?? 0); });
