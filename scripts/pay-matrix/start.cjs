// Starts supervisor.cjs detached (stripe listen + the 3517 dev server + the viewer on 3518). Stops here unless both Stripe keys are test keys.
const { spawn } = require("child_process");
const path = require("path");
require("./env.cjs").stripeKeys();
const p = spawn(process.execPath, [path.join(__dirname, "supervisor.cjs")], { detached: true, stdio: "ignore", windowsHide: true });
p.unref();
console.log("supervisor pid", p.pid);
