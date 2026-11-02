// Shared helpers for the payments-proof recordings (scripts/payments-proof/run.cjs): the 3480 server (rec schema, Stripe TEST mode), the Stripe viewer on 3481,
// throwaway accounts (…@playtest.test), Playwright (playtest-platform's copy, Chrome) recording the app beside the viewer, and the Stripe listing saved next to each clip.
/* eslint-disable */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { appfn } = require("./appfn.cjs");
const { stripeKeys, WT } = require("./env.cjs");
const PW = "C:/Users/march/Projects/playtest-platform/node_modules/playwright";
const FFMPEG = "C:/Users/march/Projects/playtest-platform/node_modules/ffmpeg-static/ffmpeg.exe";
(function useLocalFfmpeg() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return;
  const cache = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (fs.existsSync(cache) && fs.readdirSync(cache).some((d) => /^ffmpeg-/.test(d))) return;
  const rev = require(PW + "/node_modules/playwright-core/browsers.json").browsers.find((b) => b.name === "ffmpeg").revision;
  const dst = path.join(os.tmpdir(), "playtest-lite-evidence-pw", `ffmpeg-${rev}`, "ffmpeg-win64.exe");
  if (!fs.existsSync(dst)) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(FFMPEG, dst); }
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(os.tmpdir(), "playtest-lite-evidence-pw");
})();
const { chromium } = require(PW);
const Stripe = require(path.join(WT, "node_modules", "stripe"));
const stripe = new Stripe(stripeKeys().sk); // throws unless it is a test key; never printed

const BASE = "http://localhost:3480";
const VIEW = "http://localhost:3481";
const OUT = path.join(WT, "docs", "media", "payments-proof");
fs.mkdirSync(OUT, { recursive: true });
const VTMP = fs.mkdtempSync(path.join(os.tmpdir(), "pp-video-"));
const PASSWORD = /const PASSWORD = "([^"]+)"/.exec(fs.readFileSync(path.join(WT, "scripts", "evidence.cjs"), "utf8"))[1];
const V = { viewport: { width: 1280, height: 900 } };
const PANEL = { viewport: { width: 640, height: 900 } };
const TS = process.env.TS || String(Date.now()).slice(-7);

const sql = (q) => execFileSync("psql", ["-h", "localhost", "-p", "5499", "-U", "postgres", "-d", "playtest_lite", "-t", "-A", "-F", "|", "-c", q], { env: { ...process.env, PGOPTIONS: "-c search_path=rec" } }).toString().replace(/\r/g, "").trim();
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const userId = (email) => sql(`select id from "User" where email = ${lit(email)}`);
const U = "(now() at time zone 'utc')";
const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser;
async function start() { // Stripe's 3D Secure page (a public site, inside the app's frame) returns to the app on localhost; Chrome's Local Network Access blocks that from a test machine
  // ("The connection is blocked because it was initiated by a public page…"), so the check is turned off for this local recording browser only.
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", args: ["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults"] }); return browser; }
async function stop() { await browser?.close(); }

const hideDevBadge = (c) => c.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "nextjs-portal{display:none!important}"; document.head.appendChild(s); }));
async function newPage({ from, video = false, opts = V } = {}) {
  const c = await browser.newContext({ ...opts, baseURL: BASE, ...(from ? { storageState: await from.context().storageState() } : {}), ...(video ? { recordVideo: { dir: VTMP, size: opts.viewport } } : {}) });
  c.setDefaultTimeout(20000);
  c.setDefaultNavigationTimeout(60000);
  await hideDevBadge(c);
  const p = await c.newPage();
  p.t0 = Date.now();
  if (from) Object.assign(p, { email: from.email, name: from.name, uid: from.uid });
  return p;
}
const post = async (page, p, data = {}) => {
  if (p === "/api/tests" || /\/(edit|post-draft)$/.test(p)) data = { payRulesOk: true, ...data };
  const r = await page.context().request.post(BASE + p, { data, headers: { "content-type": "application/json" }, timeout: 120000 });
  const body = await r.json().catch(() => ({}));
  return { status: r.status(), ok: r.ok(), body };
};
const ok = (r, what) => { if (!r.ok) throw new Error(`${what} failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };

async function account(key, name, role) {
  const email = `rec+${key}${TS}@playtest.test`;
  const p = await newPage();
  sql(`delete from "LoginAttempt"`);
  const r = await post(p, "/api/auth/signup", { email, password: PASSWORD, role, name, acceptTerms: true, over18: true });
  if (!r.ok) throw new Error("sign-up failed for " + email + " " + JSON.stringify(r.body));
  sql(`update "User" set "emailVerifiedAt" = ${U} where email = ${lit(email)}`);
  await post(p, "/api/profile", { name, pronoun: "they", isDeveloper: role !== "tester", isTester: role !== "developer", devices: ["Windows PC"], languages: ["English"], categories: [] });
  Object.assign(p, { email, name, uid: userId(email) });
  return p;
}
async function admin() {
  const a = await account("admin", "Rec Admin", "developer");
  sql(`update "User" set "isAdmin" = true where id = '${a.uid}'`);
  return a;
}
const day = (n) => { const d = new Date(Date.now() + n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const LISTING = {
  productName: "Harbor Run", title: "Harbor Run: first 3 levels", description: "Sail through the first three harbors and tell us where the controls or the map get confusing.",
  buildUrl: "https://example.com/harbor-run", categories: ["Game"], devices: [], languages: [], mature: false, matureWhy: "", ndaText: "",
  spots: "5", writtenCents: "10.00", recordingCents: null, liveRateCents: null, liveMinutes: null,
  writtenRequired: true, recordingRequired: false, liveRequired: false, questions: ["What did you like?", "Where did you get stuck?"], joinMode: "anyone",
};
async function postTest(dev, over = {}) { return ok(await post(dev, "/api/tests", { ...LISTING, openUntil: day(14), ...over, accessKeys: "" }), "post test").id; }
async function join(tester, testId) { return ok(await post(tester, `/api/tests/${testId}/join`, { seenAt: nowIso(), confirmed: true, anyway: true, ndaAccepted: true, acceptNda: true }), "join").sessionId; }
const ANSWERS = ["The boat handling feels great once you get used to the wind.", "On the second bridge I couldn't tell where to go next at all."];
async function sendWritten(tester, sessionId) { ok(await post(tester, `/api/sessions/${sessionId}/written`, { answers: ANSWERS, notes: "", seenAt: nowIso(), confirmed: true }), "send written"); }
const subOf = (sessionId) => sql(`select id from "Submission" where "contractId" = '${sessionId}' order by "sentAt" desc limit 1`);
async function writtenTest(dev, testers, over = {}) {
  const t = await postTest(dev, over);
  const s = [], sub = [];
  for (const x of testers) { const id = await join(x, t); await sendWritten(x, id); s.push(id); sub.push(subOf(id)); }
  return { t, s, sub };
}
/** Charge opens for this tester's part (as the daily job does once 7 days and Open until have passed): the dates moved in the rec schema. */
function openCharge(sessionId, testId) {
  sql(`update "Submission" set "sentAt" = ${U} - interval '15 days', "payBy" = ${U} - interval '1 day', "choiceOfferedAt" = ${U} - interval '1 day', "choiceBy" = ${U} + interval '6 days' where id = '${subOf(sessionId)}'`);
  sql(`update "Test" set "openUntil" = ${U} - interval '1 day' where id = '${testId}'`);
}
/** The tester presses Charge on their session page. */
async function chargeUI(page, sessionId) {
  await page.goto(`/app/sessions/${sessionId}`);
  const btn = page.locator("button", { hasText: /^Charge / }).first();
  await btn.scrollIntoViewIfNeeded();
  const tick = page.locator("[data-charge-tick] input");
  if (await tick.count()) await tick.first().check();
  await btn.click();
}
const chargeApi = (tester, s, sub, cents = 1000) => post(tester, `/api/sessions/${s}/choose`, { choice: "charge", seenAt: nowIso(), confirmed: true, submissionId: sub, tickedCents: cents });
const waitSql = async (q, want, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = sql(q); if (want(v)) return v; await sleep(1000); }
  console.log("   ! waitSql timed out:", q.slice(0, 160));
  return sql(q);
};
const lastPay = (sub) => sql(`select id from "Payment" where "submissionId" = '${sub}' order by "createdAt" desc limit 1`);
const waitAction = (sub) => waitSql(`select coalesce("actionPi", '') from "Payment" where "submissionId" = '${sub}' order by "createdAt" desc limit 1`, (v) => v.startsWith("pi_"), 90000);

// ---------- Stripe's own pages ----------
async function threeDS(page, okay, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (const f of page.frames()) {
      const b = f.locator(okay ? "#test-source-authorize-3ds" : "#test-source-fail-3ds");
      if (await b.isVisible().catch(() => false)) { await page.waitForTimeout(1500); await b.click(); return true; }
    }
    await page.waitForTimeout(500);
  }
  console.log("   ! no 3D Secure page found");
  return false;
}
/** Add (or change) the card on Payments: Stripe Checkout (setup mode), Link left unticked; `tds` completes the bank's check. */
async function addCard(page, number, { tds = false } = {}) {
  await page.goto("/app/payments");
  await page.waitForTimeout(1200);
  await page.locator("form button", { hasText: /(Add a card|Change card)/ }).first().click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
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
  await page.waitForURL(/localhost:3480/, { timeout: 90000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1000);
}
/** The chargeback hold's card check through the app's route (the SetupIntent with Stripe's always-asks test card, the bank's real 3D Secure page, finish). */
async function verifyCard(P) {
  const a = ok(await post(P, "/api/payments/verify-card", { check: true }), "verify start");
  const b = ok(await post(P, "/api/payments/verify-card", { setupIntent: a.setupIntentId, paymentMethod: "pm_card_authenticationRequired" }), "verify confirm");
  if (b.checkUrl) { await P.goto(b.checkUrl); await P.waitForTimeout(2500); await threeDS(P, true); await P.waitForTimeout(2500); }
  ok(await post(P, "/api/payments/verify-card", { setupIntent: a.setupIntentId, finish: true }), "verify finish");
}

// ---------- recording ----------
async function panel(dev, title) {
  const p = await newPage({ video: true, opts: PANEL });
  await p.goto(`${VIEW}/panel?dev=${encodeURIComponent(dev.email)}&testers=&title=${encodeURIComponent(title)}`);
  await p.waitForTimeout(2500);
  return p;
}
/** A recorded app page signed in as `who` and the recorded Stripe viewer for `dev`, started together. */
async function pair(who, dev, title) {
  const app = await newPage({ from: who, video: true });
  const pan = await panel(dev, title);
  return { app, pan };
}
const made = [];
function record(file, caption, scenario) { made.push({ file, caption, scenario }); console.log(`   + ${file}  (${caption})`); }
async function pairShot(pr, name, caption, scenario, target) {
  const { app, pan } = pr;
  await app.bringToFront();
  if (target) { const loc = typeof target === "string" ? app.locator(target).first() : target; await loc.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {}); }
  await app.waitForTimeout(700);
  await pan.waitForTimeout(1800);
  const a = path.join(VTMP, `a-${Date.now()}.png`), b = path.join(VTMP, `b-${Date.now()}.png`);
  await app.screenshot({ path: a });
  await pan.screenshot({ path: b });
  const file = `${name}.png`;
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", a, "-i", b, "-filter_complex", "[0:v]scale=-2:900,setsar=1,pad=iw+8:ih:0:0:0x101826[x];[1:v]scale=-2:900,setsar=1[y];[x][y]hstack=inputs=2", path.join(OUT, file)]);
  record(file, caption, scenario);
  return file;
}
async function shot(page, name, caption, scenario, target) {
  if (target) { const loc = typeof target === "string" ? page.locator(target).first() : target; await loc.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {}); }
  await page.waitForTimeout(600);
  const file = `${name}.png`;
  await page.screenshot({ path: path.join(OUT, file) });
  record(file, caption, scenario);
  return file;
}
async function pairVideo(pr, name, caption, scenario) {
  const save = async (p, f) => { const v = p.video(); await p.context().close(); const dst = path.join(VTMP, f); await v.saveAs(dst); return dst; };
  const a = await save(pr.app, `${name}-a.webm`), b = await save(pr.pan, `${name}-p.webm`);
  // the viewer started ~ the same moment as the app (pair); trim the viewer by the difference
  const skip = Math.max(0, (pr.pan.t0 - pr.app.t0) / 1000);
  const file = `${name}.webm`;
  for (let kbps = 1000; ; kbps = Math.floor(kbps * 0.6)) {
    execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", a, "-itsoffset", String(skip.toFixed(2)), "-i", b, "-filter_complex", "[0:v]scale=-2:720,setsar=1,pad=iw+8:ih:0:0:0x101826[x];[1:v]scale=-2:720,setsar=1[y];[x][y]hstack=inputs=2:shortest=1[v]", "-map", "[v]", "-c:v", "libvpx", "-b:v", `${kbps}k`, "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`, "-crf", "12", "-an", path.join(OUT, file)]);
    if (fs.statSync(path.join(OUT, file)).size <= 9 * 1024 * 1024 || kbps < 250) break;
  }
  record(file, caption, scenario);
  return file;
}
/** The developer's PaymentIntents at Stripe (amount, status, last_payment_error, created, dispute status) saved next to the clip. */
function stripeOut(dev, name, scenario, note = "") {
  const r = appfn("stripe", dev.uid);
  const file = `${name}.stripe.json`;
  fs.writeFileSync(path.join(OUT, file), JSON.stringify({ at: nowIso(), note, ...r }, null, 2));
  const line = r.paymentIntents.map((p) => `${p.amount} ${p.status}${p.last_payment_error ? " (" + p.last_payment_error + ")" : ""}${p.stripe_dispute !== "none" ? " dispute=" + p.stripe_dispute : ""} [${p.app_rows}]`).join("; ");
  console.log(`   = ${file}: ${r.count} PaymentIntents, ${r.succeeded} succeeded: ${line}`);
  record(file, `Stripe: ${r.count} PaymentIntents, ${r.succeeded} succeeded${note ? " · " + note : ""}`, scenario);
  return r;
}
function writeMade(file = "made.json") {
  const f = path.join(OUT, file);
  const old = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : [];
  const keep = old.filter((o) => !made.some((m) => m.file === o.file));
  fs.writeFileSync(f, JSON.stringify([...keep, ...made], null, 2));
}
const payRows = (devId) => sql(`select kind || ':' || status || coalesce(' cb=' || nullif(chargeback, ''), '') || ' $' || ("amountCents"/100.0)::text || coalesce(' covered_by=' || left("coveredById", 6), '') from "Payment" where "developerId" = '${devId}' order by "createdAt"`);
const holdOf = (devId) => sql(`select coalesce("holdReason", '') || '|' || coalesce("holdStartedAt"::text, 'none') from "User" where id = '${devId}'`);

module.exports = { BASE, OUT, VTMP, TS, sql, lit, U, nowIso, sleep, start, stop, newPage, post, ok, account, admin, postTest, join, sendWritten, subOf, writtenTest, openCharge, chargeUI, chargeApi, waitSql, lastPay, waitAction, threeDS, addCard, verifyCard, pair, pairShot, shot, pairVideo, stripeOut, record, made, writeMade, appfn, stripe, payRows, holdOf, get browser() { return browser; } };
