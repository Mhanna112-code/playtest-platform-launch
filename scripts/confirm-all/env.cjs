// Environment for the Confirm all (§147) recording server: the pl-confirmall worktree, port 3460, the "rec_confirmall" schema of the local 5499 database, Stripe TEST keys only.
// Built from the worktree's .env without printing any value.
const fs = require("fs");
const path = require("path");
const WT = path.resolve(__dirname, "../..");
function parse() {
  const out = {};
  for (const line of fs.readFileSync(path.join(WT, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
function recUrl(u) {
  const url = new URL(u);
  if (!/^(localhost|127\.0\.0\.1)$/.test(url.hostname) || url.port !== "5499") throw new Error("the recording database must be on localhost:5499");
  url.search = "?schema=rec_confirmall";
  return url.toString();
}
function stripeKeys() {
  const e = parse();
  const sk = (e.STRIPE_SECRET_KEY || "").trim(), pk = (e.STRIPE_PUBLISHABLE_KEY || "").trim();
  if (!sk.startsWith("sk_test_")) throw new Error("STRIPE_SECRET_KEY is not a test key: stopping");
  if (!pk.startsWith("pk_test_")) throw new Error("STRIPE_PUBLISHABLE_KEY is not a test key: stopping");
  return { sk, pk };
}
function env({ webhookSecret = "" } = {}) {
  const e = parse();
  const db = recUrl(e.DATABASE_URL);
  const { sk, pk } = stripeKeys();
  return {
    ...process.env,
    DATABASE_URL: db, DIRECT_URL: db, TEST_DATABASE_URL: "",
    NEXT_DIST_DIR: ".next-3460", APP_URL: "http://localhost:3460",
    STRIPE_SECRET_KEY: sk, STRIPE_PUBLISHABLE_KEY: pk, STRIPE_ALLOW_LIVE: "", STRIPE_FAKE: "",
    STRIPE_WEBHOOK_SECRET: webhookSecret, STRIPE_CONNECT_WEBHOOK_SECRET: webhookSecret,
    RESEND_API_KEY: "", EMAIL_FROM: "", ALLOW_DEV_OUTBOX: "1",
    ADMIN_EMAILS: "", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", R2_ACCOUNT_ID: "", R2_ACCESS_KEY_ID: "", R2_SECRET_ACCESS_KEY: "", R2_BUCKET: "",
    SKIP_EMAIL_CONFIRM: "1", OUTAGE_CHECKS: "", HEALTH_KEY: "", CRON_SECRET: "rec-cron-confirmall",
  };
}
const red = (s) => String(s).replace(/whsec_[A-Za-z0-9]+/g, "whsec_[hidden]").replace(/\b(sk|pk|rk)_(test|live)_[A-Za-z0-9]+/g, "$1_$2_[hidden]").replace(/postgres(ql)?:\/\/\S+/g, "[db]");
module.exports = { env, parse, stripeKeys, WT, red };
