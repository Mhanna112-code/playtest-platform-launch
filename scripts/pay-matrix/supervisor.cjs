// The payment stop matrix (§159) recording setup: `stripe listen` (test key, forwarding to 3517), the app's dev server on 3517 (this worktree, the rec_paymatrix schema)
// and the Stripe viewer on 3518. Every log line passes a filter that blanks keys and secrets; no key or secret is written. Its pids go to logs/pids.json
// (stop.cjs ends this process tree only).
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { env, stripeKeys, WT, red } = require("./env.cjs");
const STRIPE = "C:/Users/march/AppData/Local/Microsoft/WinGet/Packages/Stripe.StripeCli_Microsoft.Winget.Source_8wekyb3d8bbwe/stripe.exe";
const LOGDIR = path.join(__dirname, "logs");
fs.mkdirSync(LOGDIR, { recursive: true });
const logTo = (name) => { const f = fs.openSync(path.join(LOGDIR, `${name}.log`), "a"); return (c) => fs.writeSync(f, red(c)); };
const sup = logTo("supervisor");
const pids = { supervisor: process.pid };
const save = () => fs.writeFileSync(path.join(LOGDIR, "pids.json"), JSON.stringify(pids, null, 2));
function run(name, cmd, args, opts) {
  const out = logTo(name);
  const p = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  p.stdout.on("data", out); p.stderr.on("data", out);
  p.on("exit", (c) => sup(`${new Date().toISOString()} ${name} exited ${c}\n`));
  pids[name] = p.pid; save();
  return p;
}
const { sk } = stripeKeys();
const secret = execFileSync(STRIPE, ["listen", "--api-key", sk, "--print-secret"], { encoding: "utf8", windowsHide: true }).trim();
if (!/^whsec_/.test(secret)) throw new Error("stripe listen --print-secret gave no signing secret");
const EVENTS = "account.updated,charge.dispute.created,charge.dispute.closed,customer.subscription.deleted,invoice.paid,invoice.payment_failed,invoice.payment_action_required,payment_intent.amount_capturable_updated,payment_intent.canceled";
run("listen", STRIPE, ["listen", "--api-key", sk, "--events", EVENTS, "--forward-to", "localhost:3517/api/stripe/webhook", "--forward-connect-to", "localhost:3517/api/stripe/webhook"], {});
// A production build (build.cjs): no compile pauses in the middle of a recording.
run("next", process.execPath, [path.join(WT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", "3517"], { cwd: WT, env: { ...env({ webhookSecret: secret }), NODE_ENV: "production" } });
run("viewer", process.execPath, [path.join(__dirname, "viewer.cjs")], { env: { ...process.env, VIEWER_PORT: "3518" } });
sup(`${new Date().toISOString()} started\n`);
