// Builds the media server's environment from playtest-lite's .env without printing any value.
const fs = require("fs");
const ROOT = "C:/Users/march/Projects/playtest-lite";
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
  return url.toString();
}
function env() {
  const e = parse();
  const db = mediaUrl(e.DATABASE_URL);
  return {
    ...process.env,
    DATABASE_URL: db, DIRECT_URL: db,
    NEXT_DIST_DIR: ".next-3450", APP_URL: "http://localhost:3450", STRIPE_FAKE: "1", CRON_SECRET: "media-cron",
    OUTAGE_CHECKS: "1", HEALTH_KEY: "media-health", FREE_UNTIL: "2026-10-01T00:00:00Z",
    // never real keys on the media server: the fake Stripe and the dev outbox
    STRIPE_SECRET_KEY: "", STRIPE_PUBLISHABLE_KEY: "", STRIPE_WEBHOOK_SECRET: "", RESEND_API_KEY: "", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "",
  };
}
module.exports = { env, ROOT };
