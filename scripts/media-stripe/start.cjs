// Starts supervisor.cjs detached (stripe listen + the 3460 dev server + the viewer on 3461). Logs and pids.json go to MEDIA_STRIPE_LOGS (default ./logs).
//   node scripts/media-stripe/start.cjs          (EMAIL=1 for the real-email part)
//   node scripts/media-stripe/stop.cjs           (stops only that process tree)
const { spawn } = require("child_process");
const path = require("path");
require("./env.cjs").stripeKeys(); // stops here unless both Stripe keys are test keys
const p = spawn(process.execPath, [path.join(__dirname, "supervisor.cjs")], { detached: true, stdio: "ignore", windowsHide: true, env: process.env });
p.unref();
console.log("supervisor pid", p.pid);
