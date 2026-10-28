// (Owner, Oct 30, batch 15 section 12) Settings checked loudly. ONE list of problems, each with a plain fix, shared by:
// - scripts/check-config.cjs, run before `next build`: a problem marked `stopsBuild` fails the build, so on Vercel the old version stays live;
// - src/instrumentation.ts: every problem logged once at server start;
// - the admin dashboard's red box (only OWNER_EMAIL sees it; every admin when it's unset).
// Plain CommonJS so the build script can run it with no compiler.

const DAY = 86_400_000;
const R2_KEYS = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];

/** Is this the live site? On Vercel its own VERCEL_ENV says (a preview build isn't); elsewhere NODE_ENV. */
function isProduction(env) {
  return env.VERCEL_ENV ? env.VERCEL_ENV === "production" : env.NODE_ENV === "production";
}

/**
 * Every problem with the settings, as { message, stopsBuild }.
 * @param {Record<string, string | undefined>} env
 * @param {Date} [now]
 * @returns {{ message: string; stopsBuild: boolean }[]}
 */
function configProblems(env, now = new Date()) {
  const v = (k) => (env[k] ?? "").trim();
  const out = [];
  const add = (message, stopsBuild = false) => out.push({ message, stopsBuild });
  const prod = isProduction(env);
  if (prod && !v("RESEND_API_KEY")) add("Emails aren't being sent: RESEND_API_KEY is missing.", true);
  const free = v("FREE_UNTIL");
  if (free) {
    const d = new Date(free);
    // A past date is fine: it means free has ended (it can be set, changed or cleared at any time after launch).
    if (isNaN(d.getTime())) add(`FREE_UNTIL isn't a valid date ("${free}"). Developers stay free until it's fixed.`, true);
    else if (d.getTime() > now.getTime() && d.getTime() - now.getTime() < 30 * DAY)
      add(`FREE_UNTIL is less than 30 days ahead (${d.toISOString().slice(0, 10)}): developers are told 30 days before free ends, so set it at least 30 days ahead.`);
  }
  const sk = v("STRIPE_SECRET_KEY");
  if (sk) {
    const live = sk.startsWith("sk_live_");
    if (!v("STRIPE_PUBLISHABLE_KEY")) add("STRIPE_SECRET_KEY is set without STRIPE_PUBLISHABLE_KEY: set it, or banks can't ask developers to confirm a payment in the page.", live);
    if (!v("STRIPE_WEBHOOK_SECRET")) add("STRIPE_SECRET_KEY is set without STRIPE_WEBHOOK_SECRET: set the platform webhook's signing secret, or chargebacks and renewals are missed.", live);
    if (!v("STRIPE_CONNECT_WEBHOOK_SECRET")) add("STRIPE_SECRET_KEY is set without STRIPE_CONNECT_WEBHOOK_SECRET: set the Connect webhook's signing secret, or payout problems are missed.", live);
  }
  const r2 = R2_KEYS.filter((k) => v(k));
  if (r2.length > 0 && r2.length < R2_KEYS.length)
    add(`Only some R2 settings are set (missing ${R2_KEYS.filter((k) => !v(k)).join(", ")}): set all four, or uploads go to the server's own disk.`, true);
  if (prod) {
    if (!v("CRON_SECRET")) add("CRON_SECRET is missing: the daily job can't run (reminders, Charge, retries).");
    if (!v("ADMIN_EMAILS")) add("ADMIN_EMAILS is missing: nobody can open the admin console.");
    if (!v("APP_URL")) add("APP_URL is missing: links in emails and Stripe's return pages may point to the wrong address.");
  }
  if (v("OUTAGE_CHECKS") === "1" && !v("HEALTH_KEY")) add("OUTAGE_CHECKS=1 without HEALTH_KEY: the uptime service's alerts are refused, so outages are never recorded.");
  return out;
}

module.exports = { configProblems, isProduction };
