// Environment for the partial-dispute proof server (docs/media/partial-dispute/): the pl-dispute worktree, port 3485, the "rec_dispute" schema of the local 5499
// database, Stripe TEST keys only. Built from the worktree's .env without printing any value. The local webhook secret stays set: the server checks the signature
// of the events the proof delivers (webhook.cjs signs them with the same secret).
/* eslint-disable */
const fs = require("fs");
const path = require("path");
const WT = path.resolve(__dirname, "../..");
const PORT = 3485;
const SCHEMA = "rec_dispute";
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
  if (!/^(localhost|127\.0\.0\.1)$/.test(url.hostname) || url.port !== "5499") throw new Error("the proof database must be on localhost:5499");
  url.search = `?schema=${SCHEMA}`;
  return url.toString();
}
function stripeKeys() {
  const e = parse();
  const sk = (e.STRIPE_SECRET_KEY || "").trim(), pk = (e.STRIPE_PUBLISHABLE_KEY || "").trim(), whsec = (e.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!sk.startsWith("sk_test_")) throw new Error("STRIPE_SECRET_KEY is not a test key: stopping");
  if (!pk.startsWith("pk_test_")) throw new Error("STRIPE_PUBLISHABLE_KEY is not a test key: stopping");
  if (!whsec.startsWith("whsec_")) throw new Error("STRIPE_WEBHOOK_SECRET is not set: stopping");
  return { sk, pk, whsec };
}
const ADMIN_EMAIL = `rec+pdadmin@playtest.test`;
function env() {
  const e = parse();
  const db = recUrl(e.DATABASE_URL);
  const { sk, pk, whsec } = stripeKeys();
  return {
    ...process.env,
    DATABASE_URL: db, DIRECT_URL: db, TEST_DATABASE_URL: "",
    NEXT_DIST_DIR: `.next-${PORT}`, APP_URL: `http://localhost:${PORT}`,
    STRIPE_SECRET_KEY: sk, STRIPE_PUBLISHABLE_KEY: pk, STRIPE_ALLOW_LIVE: "", STRIPE_FAKE: "",
    STRIPE_WEBHOOK_SECRET: whsec, STRIPE_CONNECT_WEBHOOK_SECRET: "",
    // No real emails: every email lands in the rec_dispute schema's outbox (the admins' chargeback emails are read from there).
    RESEND_API_KEY: "", EMAIL_FROM: "", ALLOW_DEV_OUTBOX: "1",
    ADMIN_EMAILS: ADMIN_EMAIL, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", R2_ACCOUNT_ID: "", R2_ACCESS_KEY_ID: "", R2_SECRET_ACCESS_KEY: "", R2_BUCKET: "",
    SKIP_EMAIL_CONFIRM: "1", OUTAGE_CHECKS: "", HEALTH_KEY: "", CRON_SECRET: "rec-cron",
  };
}
/** Hides any key, secret or database address in a line before it is printed or saved. */
const red = (s) => String(s).replace(/whsec_[A-Za-z0-9]+/g, "whsec_[hidden]").replace(/\b(sk|pk|rk)_(test|live)_[A-Za-z0-9]+/g, "$1_$2_[hidden]").replace(/postgres(ql)?:\/\/\S+/g, "[db]").replace(/(pi|seti)_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/g, "[client secret hidden]");
module.exports = { env, parse, stripeKeys, WT, red, PORT, SCHEMA, ADMIN_EMAIL };
