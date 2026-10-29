// The environment for the Stripe test-mode recording server (port 3460, the playtest_lite_media database), built from playtest-lite's .env without printing any value.
// Stripe keys must be TEST keys (sk_test_ / pk_test_): anything else throws. RESEND_API_KEY is passed only when `withEmail` (the real-email part).
const fs = require("fs");
const ROOT = "C:/Users/march/Projects/playtest-lite";
const WT = "C:/Users/march/Projects/playtest-lite-stripe";
function parse() {
  const out = {};
  for (const line of fs.readFileSync(ROOT + "/.env", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
function mediaUrl(u) {
  const url = new URL(u);
  if (!/^\/playtest_lite$/.test(url.pathname)) throw new Error("unexpected database name in DATABASE_URL (not printed)");
  url.pathname = "/playtest_lite_media";
  if (!/^(localhost|127\.0\.0\.1)$/.test(url.hostname) || url.port !== "5499") throw new Error("the media database must be on localhost:5499");
  return url.toString();
}
/** The test keys, checked by prefix only. */
function stripeKeys() {
  const e = parse();
  const sk = (e.STRIPE_SECRET_KEY || "").trim(), pk = (e.STRIPE_PUBLISHABLE_KEY || "").trim();
  if (!sk.startsWith("sk_test_")) throw new Error("STRIPE_SECRET_KEY is not a test key: stopping");
  if (!pk.startsWith("pk_test_")) throw new Error("STRIPE_PUBLISHABLE_KEY is not a test key: stopping");
  return { sk, pk };
}
/** The sender: .env's EMAIL_FROM, unless it is the example.com placeholder (Resend refuses an unverified domain): then playtest-platform's sender on the verified domain. */
function sender(from) {
  if (from && !/@example\.com>?$/i.test(from.trim())) return from;
  const m = /^EMAIL_FROM\s*=\s*(.*)$/m.exec(fs.readFileSync("C:/Users/march/Projects/playtest-platform/.env", "utf8"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : from;
}
function env({ webhookSecret = "", withEmail = false } = {}) {
  const e = parse();
  const db = mediaUrl(e.DATABASE_URL);
  const { sk, pk } = stripeKeys();
  return {
    ...process.env,
    DATABASE_URL: db, DIRECT_URL: db, TEST_DATABASE_URL: "",
    NEXT_DIST_DIR: ".next-3460", APP_URL: "http://localhost:3460",
    STRIPE_SECRET_KEY: sk, STRIPE_PUBLISHABLE_KEY: pk, STRIPE_ALLOW_LIVE: "", STRIPE_FAKE: "",
    STRIPE_WEBHOOK_SECRET: webhookSecret, STRIPE_CONNECT_WEBHOOK_SECRET: webhookSecret,
    RESEND_API_KEY: withEmail ? (e.RESEND_API_KEY || "") : "", EMAIL_FROM: withEmail ? sender(e.EMAIL_FROM) : "",
    // no other outside services; no admin emails; launch over (the subscription flow is on)
    ADMIN_EMAILS: "", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", R2_ACCOUNT_ID: "", R2_ACCESS_KEY_ID: "", R2_SECRET_ACCESS_KEY: "", R2_BUCKET: "",
    SKIP_EMAIL_CONFIRM: "", ALLOW_DEV_OUTBOX: "", OUTAGE_CHECKS: "", HEALTH_KEY: "", CRON_SECRET: "stripe-media-cron",
    FREE_UNTIL: "2026-10-01T00:00:00Z",
  };
}
module.exports = { env, parse, stripeKeys, mediaUrl, ROOT, WT };
