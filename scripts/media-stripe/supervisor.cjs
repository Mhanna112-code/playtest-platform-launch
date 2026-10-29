// Runs the Stripe test-mode recording setup and keeps it running: `stripe listen` (test key, forwarding to 3460), the app's dev server on 3460 (the
// playtest-lite-stripe worktree, the playtest_lite_media database) and the Stripe viewer on 3461. Started detached by start.cjs; stopped with stop.cjs
// (taskkill of this process tree only). Every log line is passed through a filter that blanks keys and secrets; no key or secret is ever written.
// EMAIL=1: the real-email part (RESEND_API_KEY on, with resend-guard.cjs preloaded: only marchanna111+pt…@gmail.com, at most 15 emails).
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { env, stripeKeys, WT } = require("./env.cjs");
const STRIPE = "C:/Users/march/AppData/Local/Microsoft/WinGet/Packages/Stripe.StripeCli_Microsoft.Winget.Source_8wekyb3d8bbwe/stripe.exe";
const LOGDIR = process.env.MEDIA_STRIPE_LOGS || path.join(__dirname, "logs");
fs.mkdirSync(LOGDIR, { recursive: true });
const withEmail = process.env.EMAIL === "1";
const red = (s) => String(s).replace(/whsec_[A-Za-z0-9]+/g, "whsec_[hidden]").replace(/\b(sk|pk|rk)_(test|live)_[A-Za-z0-9]+/g, "$1_$2_[hidden]").replace(/\bre_[A-Za-z0-9_]{12,}/g, "re_[hidden]");
const logTo = (name) => {
  const f = fs.openSync(path.join(LOGDIR, `${name}.log`), "a");
  return (chunk) => fs.writeSync(f, red(chunk));
};
const sup = logTo("supervisor");
const pids = { supervisor: process.pid };
const savePids = () => fs.writeFileSync(path.join(LOGDIR, "pids.json"), JSON.stringify(pids, null, 2));
function run(name, cmd, args, opts) {
  const out = logTo(name);
  const p = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  p.stdout.on("data", out);
  p.stderr.on("data", out);
  p.on("exit", (c) => sup(`${new Date().toISOString()} ${name} exited ${c}\n`));
  pids[name] = p.pid;
  savePids();
  return p;
}
const { sk } = stripeKeys();
// The CLI's signing secret for this key (kept in memory only).
const secret = execFileSync(STRIPE, ["listen", "--api-key", sk, "--print-secret"], { encoding: "utf8", windowsHide: true }).trim();
if (!/^whsec_/.test(secret)) throw new Error("stripe listen --print-secret gave no signing secret");
const EVENTS = "account.updated,charge.dispute.created,charge.dispute.closed,customer.subscription.deleted,invoice.paid,invoice.payment_failed,invoice.payment_action_required,payout.paid,payout.failed,payment_intent.amount_capturable_updated,payment_intent.canceled";
run("listen", STRIPE, ["listen", "--api-key", sk, "--events", EVENTS, "--forward-to", "localhost:3460/api/stripe/webhook", "--forward-connect-to", "localhost:3460/api/stripe/webhook"], {});
const appEnv = env({ webhookSecret: secret, withEmail });
if (withEmail) {
  appEnv.NODE_OPTIONS = `${appEnv.NODE_OPTIONS || ""} --require ${path.join(__dirname, "resend-guard.cjs").replace(/\\/g, "/")}`.trim();
  appEnv.RESEND_GUARD_DIR = LOGDIR;
}
run(withEmail ? "next-email" : "next", process.execPath, [path.join(WT, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", "3460"], { cwd: WT, env: appEnv });
run("viewer", process.execPath, [path.join(__dirname, "viewer.cjs")], { env: { ...process.env, VIEWER_PORT: "3461" } });
sup(`${new Date().toISOString()} started (email ${withEmail ? "on" : "off"})\n`);
