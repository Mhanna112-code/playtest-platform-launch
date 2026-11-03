// Shared helpers for the payment stop matrix (§159) recordings (scripts/pay-matrix/run.cjs), copied from scripts/confirm-all: the 3517 server (rec_paymatrix schema, Stripe TEST mode), the Stripe viewer on 3518,
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

const BASE = "http://localhost:3517";
const VIEW = "http://localhost:3518";
const OUT = process.env.MEDIA_OUT || path.join(WT, "docs", "media", "pay-matrix");
fs.mkdirSync(OUT, { recursive: true });
const VTMP = fs.mkdtempSync(path.join(os.tmpdir(), "pp-video-"));
const PASSWORD = /const PASSWORD = "([^"]+)"/.exec(fs.readFileSync(path.join(WT, "scripts", "evidence.cjs"), "utf8"))[1];
const V = { viewport: { width: 1280, height: 900 } };
const PANEL = { viewport: { width: 640, height: 900 } };
const TS = process.env.TS || String(Date.now()).slice(-7);

const sql = (q) => execFileSync("psql", ["-h", "localhost", "-p", "5499", "-U", "postgres", "-d", "playtest_lite", "-t", "-A", "-F", "|", "-c", q], { env: { ...process.env, PGOPTIONS: "-c search_path=rec_paymatrix" } }).toString().replace(/\r/g, "").trim();
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const userId = (email) => sql(`select id from "User" where email = ${lit(email)}`);
const U = "(now() at time zone 'utc')";
const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser;
async function start() { // Stripe's 3D Secure page (a public site, inside the app's frame) returns to the app on localhost; Chrome's Local Network Access blocks that from a test machine
  // ("The connection is blocked because it was initiated by a public page…"), so the check is turned off for this local recording browser only.
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", args: ["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults"] }); return browser; }
async function stop() { await browser?.close(); try { fs.rmSync(VTMP, { recursive: true, force: true }); } catch {} }

const hideDevBadge = (c) => c.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "nextjs-portal{display:none!important}"; document.head.appendChild(s); }));
async function newPage({ from, video = false, opts = V } = {}) {
  const c = await browser.newContext({ ...opts, baseURL: BASE, ...(from ? { storageState: await from.context().storageState() } : {}), ...(video ? { recordVideo: { dir: VTMP, size: opts.viewport } } : {}) });
  c.setDefaultTimeout(20000);
  c.setDefaultNavigationTimeout(60000);
  await hideDevBadge(c);
  const p = await c.newPage();
  // A page whose own reload (a redraw) is under way interrupts the next goto; the dev server can be slow to compile a page: try again.
  const g = p.goto.bind(p);
  p.goto = async (u, o) => {
    for (let i = 0; ; i++) {
      try { return await g(u, o); } catch (e) {
        if (i >= 2 || !/ERR_ABORTED|interrupted by another navigation|Timeout/.test(String(e))) throw e;
        await p.waitForTimeout(1500);
      }
    }
  };
  p.t0 = Date.now();
  if (from) Object.assign(p, { email: from.email, name: from.name, uid: from.uid });
  return p;
}
const post = async (page, p, data = {}) => {
  if (p === "/api/tests" || /\/(edit|post-draft)$/.test(p)) data = { payRulesOk: true, ...data };
  // (This machine is slow now and then: a press the server rolled back (500, its transaction timed out) is sent again.)
  for (let i = 0; ; i++) {
    const r = await page.context().request.post(BASE + p, { data, headers: { "content-type": "application/json" }, timeout: 180000 });
    const body = await r.json().catch(() => ({}));
    if (r.status() === 500 && i < 3) { console.log("   ! 500 on", p, "- again"); await sleep(4000); continue; }
    return { status: r.status(), ok: r.ok(), body };
  }
};
const ok = (r, what) => { if (!r.ok) throw new Error(`${what} failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };

async function account(key, name, role) {
  const email = `rec+${key}${TS}@playtest.test`;
  const p = await newPage();
  sql(`delete from "LoginAttempt"`);
  const r = await post(p, "/api/auth/signup", { email, password: PASSWORD, role, name, acceptTerms: true, over18: true, devices: ["Windows PC"], languages: ["English"] });
  if (!r.ok) throw new Error("sign-up failed for " + email + " " + JSON.stringify(r.body));
  sql(`update "User" set "emailVerifiedAt" = ${U} where email = ${lit(email)}`);
  await post(p, "/api/profile", { name, pronoun: "they", isDeveloper: role !== "tester", isTester: role !== "developer", devices: ["Windows PC"], languages: ["English"], categories: [] });
  Object.assign(p, { email, name, uid: userId(email) });
  return p;
}
/** A tester's Stripe Connect account (TEST mode, a custom account filled with Stripe's test identity), read by the app from its payout return. */
async function connect(t) {
  const [first, ...rest] = t.name.split(" ");
  const a = await stripe.accounts.create({ type: "custom", country: "US", email: t.email, business_type: "individual", capabilities: { transfers: { requested: true } },
    business_profile: { mcc: "5734", url: "https://playtest-tester.dev", product_description: "Testing games and apps" }, metadata: { recording: "pay-matrix" },
    individual: { first_name: first, last_name: rest.join(" ") || "Tester", dob: { day: 1, month: 1, year: 1901 }, ssn_last_4: "0000", id_number: "000000000", phone: "+15555550100", email: t.email, address: { line1: "address_full_match", city: "New York", state: "NY", postal_code: "10001", country: "US" } },
    external_account: "btok_us_verified", tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "127.0.0.1" } });
  sql(`update "User" set "stripeAccountId" = '${a.id}' where id = '${t.uid}'`);
  for (let i = 0; i < 10; i++) {
    await t.goto("/api/payments/payout-return").catch(() => {});
    await t.waitForTimeout(1500);
    if (sql(`select "payoutsReady" from "User" where id = '${t.uid}'`) === "t") return a.id;
    await sleep(3000);
  }
  console.log("   ! payouts not ready for", t.name);
  return a.id;
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
  // (R10) `hold`: the card is typed in Stripe Checkout and its Save is pressed only when the caller says (`page.saveCard()`).
  if (arguments[2] && arguments[2].hold) { page.saveCard = () => page.locator("[data-testid=hosted-payment-submit-button], button[type=submit]").first().click(); return; }
  await page.locator("[data-testid=hosted-payment-submit-button], button[type=submit]").first().click();
  if (tds) await threeDS(page, true, 60000);
  // (The dev server restarts its worker now and then: a refused connection on the way back is retried once it answers again.)
  await page.waitForURL(/localhost:3517/, { timeout: 90000 }).catch(async (e) => {
    if (!/ERR_CONNECTION_REFUSED/.test(String(e))) throw e;
    for (let i = 0; i < 30; i++) { await page.waitForTimeout(2000); try { await page.reload(); if (!(await page.content()).includes("ERR_CONNECTION_REFUSED")) break; } catch { /* still down */ } }
  });
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
async function panel(dev, title, testers = []) {
  const p = await newPage({ video: true, opts: PANEL });
  await p.goto(`${VIEW}/panel?dev=${encodeURIComponent(dev.email)}&testers=${encodeURIComponent(testers.map((t) => t.email).join(","))}&title=${encodeURIComponent(title)}`);
  await p.waitForTimeout(2500);
  return p;
}
/** A recorded app page signed in as `who` and the recorded Stripe viewer for `dev`, started together. */
async function pair(who, dev, title, testers = []) {
  const app = await newPage({ from: who, video: true });
  const pan = await panel(dev, title, testers);
  return { app, pan };
}
/** Two (or more) recorded app tabs of the same person (`from`, each its own window: two tabs of the same account) and the viewer. */
async function pairTabs(who, dev, title, testers = [], n = 2, opts = { viewport: { width: 900, height: 900 } }) {
  const apps = [];
  for (let i = 0; i < n; i++) apps.push(await newPage({ from: who, video: true, opts }));
  const pan = await panel(dev, title, testers);
  return { app: apps[0], apps, pan };
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
/**
 * The recorded pages side by side (the app's tab or tabs, then the Stripe viewer), from `pr.mark` (the moment the clip's story starts: set by the run when its page
 * is ready, so loading isn't in the clip). Each page's own video starts when its context was made (`t0`): each input is cut at mark - t0, so they line up.
 */
async function pairVideo(pr, name, caption, scenario) {
  const pages = [...(pr.apps || [pr.app]), pr.pan];
  const save = async (p, f) => { const v = p.video(); await p.context().close(); const dst = path.join(VTMP, f); await v.saveAs(dst); try { fs.unlinkSync(await v.path()); } catch {} return dst; };
  const files = [];
  for (let i = 0; i < pages.length; i++) files.push(await save(pages[i], `${name}-${i}.webm`));
  const mark = pr.mark || pages.map((p) => p.mark).filter(Boolean).sort()[0] || Math.max(...pages.map((p) => p.t0));
  const args = ["-y", "-loglevel", "error"];
  pages.forEach((p, i) => { args.push("-ss", Math.max(0, (mark - p.t0) / 1000).toFixed(2), "-i", files[i]); });
  const h = 720;
  const chain = pages.map((_, i) => `[${i}:v]setpts=PTS-STARTPTS,scale=-2:${h},setsar=1${i < pages.length - 1 ? ",pad=iw+8:ih:0:0:0x101826" : ""}[v${i}]`).join(";");
  const filter = `${chain};${pages.map((_, i) => `[v${i}]`).join("")}hstack=inputs=${pages.length}:shortest=1[v]`;
  const file = `${name}.webm`;
  for (let kbps = 1000; ; kbps = Math.floor(kbps * 0.6)) {
    execFileSync(FFMPEG, [...args, "-filter_complex", filter, "-map", "[v]", "-c:v", "libvpx", "-b:v", `${kbps}k`, "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`, "-crf", "12", "-an", path.join(OUT, file)]);
    if (fs.statSync(path.join(OUT, file)).size <= 9 * 1024 * 1024 || kbps < 250) break;
  }
  for (const f of files) try { fs.unlinkSync(f); } catch {}
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

/** Stripe Checkout is slow to open now and then: tried again (up to 3 times). */
async function addCardRetry(page, number, o) {
  for (let i = 0; ; i++) {
    try { return await addCard(page, number, o); } catch (e) { if (i >= 2) throw e; console.log("   ! add card again:", String(e.message).slice(0, 100)); await page.waitForTimeout(3000); }
  }
}
module.exports = { addCardOnce: addCard, pairTabs, connect, BASE, OUT, VTMP, TS, sql, lit, U, nowIso, sleep, start, stop, newPage, post, ok, account, admin, postTest, join, sendWritten, subOf, writtenTest, openCharge, chargeUI, chargeApi, waitSql, lastPay, waitAction, threeDS, addCard: addCardRetry, verifyCard, pair, pairShot, shot, pairVideo, stripeOut, record, made, writeMade, appfn, stripe, payRows, holdOf, get browser() { return browser; } };
