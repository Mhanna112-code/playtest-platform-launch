// Shared helpers for the partial-dispute proof (scripts/partial-dispute/run.cjs): the 3485 server (rec_dispute schema, Stripe TEST mode), throwaway accounts
// (rec+…@playtest.test), Playwright (playtest-platform's copy, the installed Chrome) for the app's pages and Stripe's own pages (Checkout, the bank's 3D Secure test
// page), and the Stripe listing saved for each step (<step>.stripe.json and a readable <step>.stripe.md). Based on scripts/payments-proof/lib.cjs.
/* eslint-disable */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { appfn } = require("./appfn.cjs");
const { WT, PORT, SCHEMA, red } = require("./env.cjs");
const { chromium } = require("C:/Users/march/Projects/playtest-platform/node_modules/playwright");

const BASE = `http://localhost:${PORT}`;
const OUT = path.join(WT, "docs", "media", "partial-dispute");
fs.mkdirSync(OUT, { recursive: true });
const PASSWORD = /const PASSWORD = "([^"]+)"/.exec(fs.readFileSync(path.join(WT, "scripts", "evidence.cjs"), "utf8"))[1];
const V = { viewport: { width: 1280, height: 900 } };
const TS = process.env.TS || String(Date.now()).slice(-6);
const PSQL = "C:/Program Files/PostgreSQL/16/bin/psql.exe";

const sql = (q) => execFileSync(PSQL, ["-h", "localhost", "-p", "5499", "-U", "postgres", "-d", "playtest_lite", "-t", "-A", "-F", "|", "-c", q], { env: { ...process.env, PGOPTIONS: `-c search_path=${SCHEMA}` } }).toString().replace(/\r/g, "").trim();
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const userId = (email) => sql(`select id from "User" where email = ${lit(email)}`);
const U = "(now() at time zone 'utc')";
const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("  ", ...a.map((x) => red(typeof x === "string" ? x : JSON.stringify(x))));

let browser;
async function start() {
  // Stripe's 3D Secure test page (a public site, in the app's frame) returns to the app on localhost; Chrome's Local Network Access blocks that on a test machine, so
  // the check is turned off for this local proof browser only (as for the payments proof).
  browser = await chromium.launch({ channel: "chrome", args: ["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults"] });
  return browser;
}
async function stop() { await browser?.close(); }
const hideDevBadge = (c) => c.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "nextjs-portal{display:none!important}"; document.head.appendChild(s); }));
async function newPage({ from } = {}) {
  const c = await browser.newContext({ ...V, baseURL: BASE, ...(from ? { storageState: await from.context().storageState() } : {}) });
  c.setDefaultTimeout(20000);
  c.setDefaultNavigationTimeout(90000);
  await hideDevBadge(c);
  const p = await c.newPage();
  const g = p.goto.bind(p);
  p.goto = async (u, o) => {
    for (let i = 0; ; i++) {
      try { return await g(u, o); } catch (e) {
        if (i >= 3 || !/ERR_ABORTED|interrupted by another navigation|Timeout|ERR_CONNECTION_REFUSED/.test(String(e))) throw e;
        await p.waitForTimeout(2000);
      }
    }
  };
  if (from) Object.assign(p, { email: from.email, name: from.name, uid: from.uid });
  return p;
}
const post = async (page, p, data = {}) => {
  if (p === "/api/tests" || /\/(edit|post-draft)$/.test(p)) data = { payRulesOk: true, ...data };
  const r = await page.context().request.post(BASE + p, { data, headers: { "content-type": "application/json" }, timeout: 180000 });
  const body = await r.json().catch(() => ({}));
  return { status: r.status(), ok: r.ok(), body };
};
const ok = (r, what) => { if (!r.ok) throw new Error(`${what} failed: ${red(JSON.stringify(r.body)).slice(0, 400)}`); return r.body; };

async function account(key, name, role) {
  const email = `rec+pd${key}${TS}@playtest.test`;
  const p = await newPage();
  sql(`delete from "LoginAttempt"`);
  const r = await post(p, "/api/auth/signup", { email, password: PASSWORD, role, name, acceptTerms: true, over18: true });
  if (!r.ok) throw new Error("sign-up failed for " + email + " " + JSON.stringify(r.body));
  sql(`update "User" set "emailVerifiedAt" = ${U} where email = ${lit(email)}`);
  await post(p, "/api/profile", { name, pronoun: "they", isDeveloper: role !== "tester", isTester: role !== "developer", devices: ["Windows PC"], languages: ["English"], categories: [] });
  Object.assign(p, { email, name, uid: userId(email) });
  return p;
}
/** The team's account: an admin (the server's ADMIN_EMAILS names it, so the chargeback emails go to it, in the outbox). */
async function admin(email) {
  const p = await newPage();
  sql(`delete from "LoginAttempt"`);
  const r = await post(p, "/api/auth/signup", { email, password: PASSWORD, role: "developer", name: "Rec Admin", acceptTerms: true, over18: true });
  sql(`update "User" set "emailVerifiedAt" = ${U}, "isAdmin" = true where email = ${lit(email)}`);
  if (!r.ok) { sql(`delete from "LoginAttempt"`); const s = await post(p, "/api/auth/login", { email, password: PASSWORD }); ok(s, "admin sign-in (the account was made by an earlier run)"); }
  Object.assign(p, { email, name: "Rec Admin", uid: userId(email) });
  return p;
}
const day = (n) => { const d = new Date(Date.now() + n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const LISTING = {
  productName: "Harbor Run", title: "Harbor Run", description: "Sail through the first three harbors and tell us where the controls or the map get confusing.",
  buildUrl: "https://example.com/harbor-run", categories: ["Game"], devices: [], languages: [], mature: false, matureWhy: "", ndaText: "",
  spots: "5", writtenCents: "244.67", recordingCents: null, liveRateCents: null, liveMinutes: null,
  writtenRequired: true, recordingRequired: false, liveRequired: false, questions: ["What did you like?", "Where did you get stuck?"], joinMode: "anyone",
  confirmHigh: ["written"], // the tick “I confirm this part pays more than $200.”
};
async function postTest(dev, over = {}) { return ok(await post(dev, "/api/tests", { ...LISTING, openUntil: day(14), ...over, accessKeys: "" }), "post test").id; }
async function join(tester, testId) { return ok(await post(tester, `/api/tests/${testId}/join`, { seenAt: nowIso(), confirmed: true, anyway: true, ndaAccepted: true, acceptNda: true }), "join").sessionId; }
const ANSWERS = ["The boat handling feels great once you get used to the wind.", "On the second bridge I couldn't tell where to go next at all."];
async function sendWritten(tester, sessionId) { ok(await post(tester, `/api/sessions/${sessionId}/written`, { answers: ANSWERS, notes: "", seenAt: nowIso(), confirmed: true }), "send written"); }
const subOf = (sessionId) => sql(`select id from "Submission" where "contractId" = '${sessionId}' order by "sentAt" desc limit 1`);
/** Charge opens for this tester's part (as the daily job does once 7 days and the tester's deadline have passed): the dates moved in the rec_dispute schema. */
function openCharge(sessionId, testId) {
  sql(`update "Submission" set "sentAt" = ${U} - interval '15 days', "payBy" = ${U} - interval '1 day', "choiceOfferedAt" = ${U} - interval '1 day', "choiceBy" = ${U} + interval '6 days' where id = '${subOf(sessionId)}'`);
  sql(`update "Contract" set "dueAt" = ${U} - interval '1 day' where id = '${sessionId}'`);
  sql(`update "Test" set "openUntil" = ${U} - interval '1 day' where id = '${testId}'`);
}
/** The tester presses Charge on their session page (the amount typed in its box; the tick when it's over $200). */
async function chargeUI(page, sessionId, amount) {
  await page.goto(`/app/sessions/${sessionId}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const box = page.locator("[data-charge-amount] input, input[name=chargeAmount]").first();
  if (amount && (await box.count())) { await box.fill(amount); }
  const btn = page.locator("button", { hasText: /^Charge / }).first();
  await btn.scrollIntoViewIfNeeded();
  const tick = page.locator("[data-charge-tick] input");
  if (await tick.count()) await tick.first().check();
  await btn.click();
}
const chargeApi = (tester, s, sub, cents) => post(tester, `/api/sessions/${s}/choose`, { choice: "charge", seenAt: nowIso(), confirmed: true, submissionId: sub, amount: (cents / 100).toFixed(2), tickedCents: cents });
const waitSql = async (q, want, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = sql(q); if (want(v)) return v; await sleep(1000); }
  log("! waitSql timed out:", q.slice(0, 160));
  return sql(q);
};

// ---------- Stripe's own pages ----------
async function threeDS(page, okay = true, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (const f of page.frames()) {
      const b = f.locator(okay ? "#test-source-authorize-3ds" : "#test-source-fail-3ds");
      if (await b.isVisible().catch(() => false)) { await page.waitForTimeout(1500); await b.click(); return true; }
    }
    await page.waitForTimeout(500);
  }
  log("! no 3D Secure page found");
  return false;
}
/** Add (or change) the card on Payments: Stripe Checkout (setup mode), Link left unticked; `tds` completes the bank's check. */
async function addCard(page, number, { tds = false } = {}) {
  await page.goto("/app/payments");
  await page.waitForTimeout(1200);
  await page.locator("form button", { hasText: /(Add a card|Change card)/ }).first().click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 90000 });
  await page.waitForTimeout(2500);
  const acc = page.locator("[data-testid=card-accordion-item-button]");
  if (await acc.count()) await acc.dispatchEvent("click");
  await page.locator("#cardNumber").waitFor({ timeout: 30000 });
  await page.locator("#cardNumber").pressSequentially(number.replace(/\s/g, ""), { delay: 30 });
  await page.locator("#cardExpiry").pressSequentially("1230", { delay: 30 });
  await page.locator("#cardCvc").pressSequentially("123", { delay: 30 });
  if (await page.locator("#billingName").isVisible().catch(() => false)) await page.locator("#billingName").fill(page.name || "Test Cardholder");
  if (await page.locator("#billingPostalCode").isVisible().catch(() => false)) await page.locator("#billingPostalCode").fill("10001");
  const link = page.locator("#enableStripePass");
  if (await link.isChecked().catch(() => false)) await link.uncheck({ force: true });
  await page.waitForTimeout(800);
  await page.locator("[data-testid=hosted-payment-submit-button], button[type=submit]").first().click();
  if (tds) await threeDS(page, true, 60000);
  await page.waitForURL(new RegExp(`localhost:${PORT}`), { timeout: 120000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1000);
}
/** The chargeback hold's card check through the app's route (a SetupIntent with Stripe's always-asks test card, the bank's real 3D Secure page, finish). */
async function verifyCard(P) {
  const a = ok(await post(P, "/api/payments/verify-card", { check: true }), "verify start");
  const b = ok(await post(P, "/api/payments/verify-card", { setupIntent: a.setupIntentId, paymentMethod: "pm_card_authenticationRequired" }), "verify confirm");
  if (b.checkUrl) { await P.goto(b.checkUrl); await P.waitForTimeout(2500); await threeDS(P, true); await P.waitForTimeout(2500); }
  ok(await post(P, "/api/payments/verify-card", { setupIntent: a.setupIntentId, finish: true }), "verify finish");
}

// ---------- what each step saves ----------
const made = [];
function record(file, caption, step) { made.push({ file, caption, step }); log(`+ ${file}  (${caption})`); }
async function shot(page, name, caption, step, target, { full = false } = {}) {
  if (target) { const loc = typeof target === "string" ? page.locator(target).first() : target; await loc.evaluate((el) => el.scrollIntoView({ block: "start" })).catch(() => {}); }
  await page.waitForTimeout(700);
  const file = `${name}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage: full });
  record(file, caption, step);
  return file;
}
/** An element only (a box, a row), with some room around it. */
async function shotOf(page, name, caption, step, target) {
  const loc = typeof target === "string" ? page.locator(target).first() : target;
  await loc.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
  await page.waitForTimeout(700);
  const file = `${name}.png`;
  await loc.screenshot({ path: path.join(OUT, file) });
  record(file, caption, step);
  return file;
}
const mdCell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
/** The developer's Stripe objects (PaymentIntents, their charges, refunds and disputes) listed through Stripe's API, saved as JSON and a readable Markdown table. */
function stripeOut(dev, name, step, note = "") {
  const r = appfn("stripe", dev.uid);
  fs.writeFileSync(path.join(OUT, `${name}.stripe.json`), JSON.stringify({ step, note, ...r }, null, 2) + "\n");
  const lines = [
    `# ${step}: Stripe objects for ${r.customer} (${r.stripe_customer})`, "", note ? `${note}\n` : "", `Listed through Stripe's API in test mode at ${r.at}. JSON: [${name}.stripe.json](${name}.stripe.json).`, "",
    "| PaymentIntent | Amount | Received | Status | Description | Metadata | Charge (amount / captured / refunded) | Disputes | App rows |",
    "|---|---|---|---|---|---|---|---|---|",
    ...r.paymentIntents.map((p) => `| \`${p.id}\` | $${p.amount} | $${p.amount_received} | ${p.status}${p.capture_method === "manual" ? " (manual capture)" : ""} | ${mdCell(p.description)} | ${mdCell(Object.entries(p.metadata || {}).map(([k, v]) => `${k}=${v}`).join(", "))} | ${p.charge ? `\`${p.charge.id}\` $${p.charge.amount} / $${p.charge.amount_captured} / $${p.charge.amount_refunded}${p.charge.refunds.length ? ` (refunds: ${p.charge.refunds.map((x) => `${x.id} $${x.amount} ${x.status}`).join(", ")})` : ""}${p.charge.disputed ? " · disputed" : ""}` : "none"} | ${p.disputes.length ? p.disputes.map((d) => `\`${d.id}\` $${d.amount} ${d.status} (${d.reason}; fee $${d.stripe_fee}; evidence due ${d.evidence_due_by})`).join("; ") : "none"} | ${mdCell(p.app_rows.map((x) => `${x.kind} ${x.status} $${x.amount}${x.chargeback ? ` chargeback=${x.chargeback}` : ""}${x.reversed ? ` reversed=$${x.reversed}` : ""}`).concat(p.app_reservations.map((x) => `reservation ${x.status} $${x.amount}`)).join("; "))} |`),
    "",
  ];
  fs.writeFileSync(path.join(OUT, `${name}.stripe.md`), lines.join("\n"));
  record(`${name}.stripe.json`, `Stripe: ${r.count} PaymentIntents${note ? " · " + note : ""}`, step);
  record(`${name}.stripe.md`, "the same, as a table", step);
  return r;
}
function writeMade(file = "made.json") { fs.writeFileSync(path.join(OUT, file), JSON.stringify(made, null, 2) + "\n"); }
const payRows = (devId) => sql(`select kind || ':' || status || coalesce(' cb=' || nullif(chargeback, ''), '') || ' $' || to_char("amountCents"/100.0, 'FM999990.00') || coalesce(' reversed=$' || to_char("reversedCents"/100.0, 'FM999990.00'), '') from "Payment" where "developerId" = '${devId}' order by "createdAt"`);
const holdOf = (devId) => sql(`select coalesce("holdReason", '') || '|' || coalesce("holdStartedAt"::text, 'none') from "User" where id = '${devId}'`);

module.exports = { BASE, OUT, TS, PORT, sql, lit, U, nowIso, sleep, log, start, stop, newPage, post, ok, account, admin, postTest, join, sendWritten, subOf, openCharge, chargeUI, chargeApi, waitSql, threeDS, addCard, verifyCard, shot, shotOf, stripeOut, record, made, writeMade, appfn, payRows, holdOf };
