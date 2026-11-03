// Runs the 3485 dev server from the pl-dispute worktree (rec_dispute schema, Stripe test keys); every output line passes through the key filter.
//   node scripts/partial-dispute/serve.cjs <log dir>     (the next PID goes to <log dir>/next.pid; nothing is written into the repository)
/* eslint-disable */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { env, WT, red, PORT } = require("./env.cjs");
const LOG = path.resolve(process.argv[2] || path.join(require("os").tmpdir(), "partial-dispute-logs"));
fs.mkdirSync(LOG, { recursive: true });
const p = spawn(process.execPath, [path.join(WT, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(PORT)], { cwd: WT, env: env(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
fs.writeFileSync(path.join(LOG, "next.pid"), String(p.pid));
fs.writeFileSync(path.join(LOG, "serve.pid"), String(process.pid));
p.stdout.on("data", (c) => process.stdout.write(red(c)));
p.stderr.on("data", (c) => process.stderr.write(red(c)));
p.on("exit", (c) => { console.log("next exited", c); process.exit(c ?? 0); });
