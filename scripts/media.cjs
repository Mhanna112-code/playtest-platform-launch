// Records the screenshots and videos for the design doc and the owner's report into docs/media/, each at two sizes:
// desktop (1280x900) as <name>.png / <name>.webm and phone (375x812) as <name>-phone.png / <name>-phone.webm.
// (Batch 15) Run every group against ONE isolated server and database, never the owner's dev server: start the 3450 server below with
// DATABASE_URL / DIRECT_URL pointing at playtest_lite_media, then: $env:BASE="http://localhost:3450"; $env:MEDIA_DB="playtest_lite_media"; node scripts/media.cjs
// Needs the app running on BASE (default http://localhost:3400) with the dev outbox. The money, outage and plan groups need a
// second dev server on FAKE_BASE (default http://localhost:3450) started with STRIPE_FAKE=1, OUTAGE_CHECKS=1,
// HEALTH_KEY=media-health and FREE_UNTIL set to a past date (see FAKE_ENV below); they are skipped when it isn't running.
// Uses fresh throwaway accounts (dev+media<ts>@playtest.test …) and touches only those accounts' rows when it sets up a state
// directly in the database (the outage group is the one exception: an outage moves every running clock, as in the app).
// Usage: node scripts/media.cjs                      (everything, both sizes)
//        ONLY=dash,edit node scripts/media.cjs       (just those groups; the accounts and tests are made again each run)
//        SIZES=phone ONLY=dash node scripts/media.cjs (one size)
// Groups (see the group() calls): every, dash, post, edit, testpage, tpvideo, tpstop, check, and the report's money, outage,
// holds, alerts, emails, admin, admins2, excerpts, long, keysrace, changedq, paused, stopped, drafts, plans, tester, settings.
// docs/media/captions.json maps each file to its caption (and the report's title and section);
// docs/media/report-manifest.json lists the report's sections and cases, each with its desktop and phone files.
/* eslint-disable */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const PW = "C:/Users/march/Projects/playtest-platform/node_modules/playwright";
const FFMPEG = "C:/Users/march/Projects/playtest-platform/node_modules/ffmpeg-static/ffmpeg.exe";
// Video needs Playwright's ffmpeg: the ffmpeg-static copy through a private browsers path (as scripts/evidence.cjs).
(function useLocalFfmpeg() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return;
  const cache = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (fs.existsSync(cache) && fs.readdirSync(cache).some((d) => /^ffmpeg-/.test(d))) return;
  const rev = require(PW + "/node_modules/playwright-core/browsers.json").browsers.find((b) => b.name === "ffmpeg").revision;
  if (!fs.existsSync(FFMPEG)) return;
  const dst = path.join(os.tmpdir(), "playtest-lite-evidence-pw", `ffmpeg-${rev}`, "ffmpeg-win64.exe");
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(FFMPEG, dst);
  }
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(os.tmpdir(), "playtest-lite-evidence-pw");
})();
const { chromium } = require(PW);

const MAIN = process.env.BASE || "http://localhost:3400";
// The second dev server (fake Stripe, outage checks, a past FREE_UNTIL), for the groups marked { fake: true }:
// $env:NEXT_DIST_DIR=".next-3450"; $env:APP_URL="http://localhost:3450"; $env:STRIPE_FAKE="1"; $env:CRON_SECRET="media-cron";
// $env:OUTAGE_CHECKS="1"; $env:HEALTH_KEY="media-health"; $env:FREE_UNTIL="2026-10-01T00:00:00Z"; npx next dev -p 3450
const FAKE = process.env.FAKE_BASE || "http://localhost:3450";
const HEALTH_KEY = process.env.HEALTH_KEY || "media-health";
let BASE = MAIN; // the server the current group runs against
const OUT = path.join(__dirname, "..", "docs", "media");
const VTMP = fs.mkdtempSync(path.join(os.tmpdir(), "pt-media-video-"));
const T0 = Date.now();
let TS = String(T0); // per size: T0 + "d" / "p", so the two sizes never share an account
// The local test password is the one scripts/evidence.cjs uses (read from there, never printed).
const PASSWORD = /const PASSWORD = "([^"]+)"/.exec(fs.readFileSync(path.join(__dirname, "evidence.cjs"), "utf8"))[1];
const PHONE = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 900 } };
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const SIZES = (process.env.SIZES || "desktop,phone").split(",").filter(Boolean);
fs.mkdirSync(path.join(OUT, "checks"), { recursive: true }); // checks/: visual-check pictures, not doc markers
const made = []; // every file written this run, with its caption
let browser;
// The size being recorded: V = the browser options every page opens with, SFX = the file-name suffix ("" or "-phone").
let V = DESKTOP, SFX = "", SIZE = "desktop";
const phone = () => SIZE === "phone";
// The report section the next files belong to (each group sets its own; sec() changes it inside a group), and the group's place.
let SEC = "", GROUP = "", GORDER = 0, SEQ = 0;
const sec = (s) => { SEC = s; };

// ---------- database (only this run's own accounts) ----------
// (Batch 15) The database the server under BASE uses (MEDIA_DB): the media server runs on its own copy, never the dev data.
const MEDIA_DB = process.env.MEDIA_DB || "playtest_lite";
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-p", "5499", "-U", "postgres", "-d", MEDIA_DB, "-t", "-A", "-c", q]).toString().split(String.fromCharCode(13)).join("").trim();
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const userId = (email) => sql(`select id from "User" where email = ${lit(email)}`);
/** Runs SQL only after checking that every user it names is one of this run's throwaway accounts. */
function own(q) {
  if (!/@playtest\.test/.test(q) && !/where id = '/.test(q) && !/"testId" = '/.test(q) && !/where "id" in/.test(q)) throw new Error("own(): the query must name this run's own rows");
  return sql(q);
}

// ---------- pages ----------
async function ctx(opts = V, video = false) {
  const c = await browser.newContext({ ...opts, baseURL: BASE, ...(video ? { recordVideo: { dir: VTMP, size: opts.viewport } } : {}) });
  c.setDefaultTimeout(15000);
  c.setDefaultNavigationTimeout(45000); // (the dev server can be slow to render a busy page)
  await hideDevBadge(c);
  const p = await c.newPage();
  return safeGoto(p);
}
/** A page whose own reload (e.g. after an admin button) is still under way aborts the next goto: try once more. */
function safeGoto(p) {
  const g = p.goto.bind(p);
  p.goto = async (u, o) => {
    try {
      return await g(u, o);
    } catch (e) {
      if (!/ERR_ABORTED|interrupted by another navigation/.test(String(e))) throw e;
      await p.waitForTimeout(1000);
      return g(u, o);
    }
  };
  const r = p.reload.bind(p);
  p.reload = async (o) => {
    try {
      return await r(o);
    } catch (e) {
      if (!/ERR_ABORTED|interrupted by another navigation|detached/.test(String(e))) throw e;
      await p.waitForTimeout(1500);
      return r(o);
    }
  };
  return p;
}
/** A second page signed in as the same person (cookies copied), optionally recording video. */
async function same(page, opts = V, video = false) {
  const c = await browser.newContext({ ...opts, baseURL: BASE, storageState: await page.context().storageState(), ...(video ? { recordVideo: { dir: VTMP, size: opts.viewport } } : {}) });
  c.setDefaultTimeout(15000);
  c.setDefaultNavigationTimeout(45000); // (the dev server can be slow to render a busy page)
  await hideDevBadge(c);
  return safeGoto(await c.newPage());
}
/** The Next.js dev-tools badge is not part of the app: hide it in pictures. */
const hideDevBadge = (c) => c.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "nextjs-portal{display:none!important}"; document.head.appendChild(s); }));
const post = async (page, p, data = {}) => {
  const r = await page.context().request.post(BASE + p, { data, headers: { "content-type": "application/json" }, timeout: 90000 }); // (a dev server compiles a route on its first call)
  const body = await r.json().catch(() => ({}));
  if (!r.ok() && !post.quiet) console.log("   ! POST", p, r.status(), JSON.stringify(body).slice(0, 300));
  return { status: r.status(), ok: r.ok(), body };
};
const nowIso = () => new Date().toISOString();

/** A new account through the sign-up API (name, role, Terms), email confirmed, a tester profile when testing. */
async function account(email, name, role, pronoun = "they", tester = {}) {
  const p = await ctx(tester.phone ? PHONE : tester.desktop ? DESKTOP : V);
  // (Batch 15 section 7) Sign-ups are limited per network (10 an hour): the recorder makes many accounts from this machine, so it clears its own local count first
  // (in the media database only).
  if (MEDIA_DB !== "playtest_lite") sql(`delete from "LoginAttempt" where kind = 'signup' and ip in ('::1', '127.0.0.1', '::ffff:127.0.0.1')`);
  const r = await post(p, "/api/auth/signup", { email, password: PASSWORD, role, name, acceptTerms: true });
  if (!r.ok) throw new Error("sign-up failed for " + email);
  own(`update "User" set "emailVerifiedAt" = (now() at time zone 'utc') where email = ${lit(email)}`);
  await post(p, "/api/profile", { name, pronoun, isDeveloper: role !== "tester", isTester: role !== "developer", devices: tester.devices ?? ["Windows PC"], languages: tester.languages ?? ["English"], categories: [] });
  p.email = email;
  p.name = name;
  p.uid = userId(email);
  return p;
}

/** A date n days from today (YYYY-MM-DD, local), as the date fields take it. (Batch 12: Open until is 3 to 30 days ahead.) */
const day = (n) => { const d = new Date(Date.now() + n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const LISTING = {
  productName: "Harbor Run", title: "Harbor Run: first 3 levels", description: "Sail through the first three harbors and tell us where the controls or the map get confusing.",
  buildUrl: "https://example.com/harbor-run", categories: ["Game"], devices: [], languages: [], mature: false, matureWhy: "", ndaText: "",
  spots: "5", writtenCents: "10.00", recordingCents: null, liveRateCents: null, liveMinutes: null,
  writtenRequired: true, recordingRequired: false, liveRequired: false, questions: ["What did you like?", "Where did you get stuck?"], joinMode: "anyone",
};
/** Posts a test through the API (the same checks as the form); returns its id. Open until defaults to 14 days ahead. */
async function postTest(dev, over = {}) {
  const r = await post(dev, "/api/tests", { ...LISTING, openUntil: day(14), ...over, accessKeys: over.accessKeys ?? "" });
  if (!r.ok) throw new Error("post failed: " + JSON.stringify(r.body).slice(0, 300));
  return r.body.id;
}
async function join(tester, testId) {
  const r = await post(tester, `/api/tests/${testId}/join`, { seenAt: nowIso(), confirmed: true, anyway: true, ndaAccepted: true, acceptNda: true });
  if (!r.ok) throw new Error(`join failed (${tester.name}): ` + JSON.stringify(r.body).slice(0, 300));
  return r.body.sessionId;
}
async function sendWritten(tester, sessionId, answers = ["The boat handling feels great.", "The second bridge: I couldn't tell where to go."]) {
  const r = await post(tester, `/api/sessions/${sessionId}/written`, { answers, notes: "", seenAt: nowIso(), confirmed: true });
  if (!r.ok) throw new Error("written failed: " + JSON.stringify(r.body).slice(0, 300));
}

// ---------- files ----------
/**
 * One file written. `caption` may start with "Title | ": the title goes to the report, the rest is the caption (one sentence).
 * The base name (without "-phone") pairs the desktop and phone files of one case in the report manifest.
 */
function record(file, caption, kind) {
  const m = /^(.*?) \| (.*)$/s.exec(caption);
  const title = m ? m[1] : "", text = m ? m[2] : caption;
  const base = file.replace(/\.(png|webm)$/, "").replace(/-phone$/, "");
  made.push({ file, caption: text, kind, title, base, size: SIZE, section: SEC, group: GROUP, order: GORDER * 1000 + ++SEQ });
  console.log(`   + ${file}  (${text})`);
}
/** A screenshot of the whole page, or of one element (with a little room around it). */
async function shot(page, name, caption, target, after) {
  await page.bringToFront();
  await closeTimerPopups(page);
  await page.waitForTimeout(400);
  const file = `${name}${SFX}.png`;
  if (target) {
    const loc = typeof target === "string" ? page.locator(target).first() : target;
    await loc.waitFor({ state: "visible" });
    // From the top of the page, so the sticky header stays at the top and never covers the element.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    if (after) await after();
    const b = await loc.boundingBox();
    if (!b) throw new Error("no box for " + name);
    const sy = await page.evaluate(() => window.scrollY);
    const pad = 12, y = Math.max(0, b.y + sy - pad);
    // On a phone the picture always takes the full screen width (the element fills it anyway), so nothing is ever cut at the sides.
    const x = phone() ? 0 : Math.max(0, b.x - pad), width = phone() ? page.viewportSize().width : Math.min(page.viewportSize().width - x, b.width + 2 * pad);
    await page.screenshot({ path: path.join(OUT, file), fullPage: true, clip: { x, y, width, height: b.height + 2 * pad } });
  } else await page.screenshot({ path: path.join(OUT, file), fullPage: false });
  record(file, caption, "image");
  return file;
}
/** The whole page, top to bottom (long pages such as dashboards). */
async function shotFull(page, name, caption) {
  await page.bringToFront();
  await closeTimerPopups(page);
  await page.waitForTimeout(400);
  const file = `${name}${SFX}.png`;
  await page.evaluate(() => window.scrollTo(0, 0)); // (the sticky header stays at the top of the picture)
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  record(file, caption, "image");
  return file;
}
/** A Post / Edit form field with its label and notes: the nearest block holding the label of the input with this id. */
const field = (page, id) => page.locator("#" + id).locator(`xpath=ancestor::div[label[@for='${id}']][1]`);
/** Types text into a field one key at a time (so the recording shows it), `ms` between keys. */
async function typeSlow(page, selector, text, ms = 25) {
  await page.locator(selector).click();
  await page.keyboard.type(text, { delay: ms });
}
/** A screenshot of everything from the top of one element to the bottom of another (with a little room above and below). */
async function shotSpan(page, name, caption, from, to, padTop = 12, padBottom = 12) {
  await page.bringToFront();
  await closeTimerPopups(page);
  await page.waitForTimeout(400);
  const loc = (t) => (typeof t === "string" ? page.locator(t).first() : t);
  const a = loc(from), b = loc(to);
  await a.waitFor({ state: "visible" });
  await b.waitFor({ state: "visible" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  const [ba, bb] = [await a.boundingBox(), await b.boundingBox()];
  if (!ba || !bb) throw new Error("no box for " + name);
  const sy = await page.evaluate(() => window.scrollY);
  const x = phone() ? 0 : Math.max(0, Math.min(ba.x, bb.x) - 12), right = phone() ? page.viewportSize().width : Math.max(ba.x + ba.width, bb.x + bb.width) + 12;
  const y = Math.max(0, Math.min(ba.y, bb.y) + sy - padTop), bottom = Math.max(ba.y + ba.height, bb.y + bb.height) + sy + padBottom;
  const file = `${name}${SFX}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage: true, clip: { x, y, width: Math.min(page.viewportSize().width - x, right - x), height: bottom - y } });
  record(file, caption, "image");
  return file;
}
/** Saves a recorded page's video (closing its context). */
async function saveVideo(page, file) {
  const v = page.video();
  await page.context().close();
  const dst = path.join(VTMP, file);
  await v.saveAs(dst);
  return dst;
}
/** Recordings ({ file, from } = seconds to skip at the start), side by side when two, as WebM in docs/media. */
const MAX_VIDEO_BYTES = 7.5 * 1024 * 1024; // (owner) each video under about 8 MB
function finishVideo(parts, name, caption, { secs } = {}) {
  const file = `${name}${SFX}.webm`;
  const out = path.join(OUT, file);
  // Encoded at 1200k; a long one is encoded again at a lower rate until it fits under MAX_VIDEO_BYTES.
  for (let kbps = 1200; ; kbps = Math.floor(kbps * 0.6)) {
    const args = ["-y", "-loglevel", "error"];
    for (const p of parts) args.push("-ss", String(Math.max(0, p.from || 0).toFixed(2)), ...(secs ? ["-t", String(secs)] : []), "-i", p.file);
    if (parts.length === 2) args.push("-filter_complex", "[0:v]scale=-2:720,setsar=1,pad=iw+8:ih:0:0:0x101826[a];[1:v]scale=-2:720,setsar=1[b];[a][b]hstack=inputs=2:shortest=1[v]", "-map", "[v]");
    args.push("-c:v", "libvpx", "-b:v", `${kbps}k`, "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`, "-crf", "12", "-an", out);
    execFileSync(FFMPEG, args);
    if (fs.statSync(out).size <= MAX_VIDEO_BYTES || kbps < 250) break;
  }
  record(file, caption, "video");
}
/** A recorded page: { page, t0 } (t0 = when its recording began). */
async function rec(opts = V, from) {
  const t0 = Date.now();
  const page = from ? await same(from, opts, true) : await ctx(opts, true);
  page.t0 = t0;
  return page;
}
/** Seconds into this page's recording right now (where the useful part starts). */
const at = (page) => (Date.now() - page.t0) / 1000;
const pause = (page, ms = 900) => page.waitForTimeout(ms);

// ---------- run ----------
const groups = [];
/** A group of scenarios: `section` = the report section its files go to (sec() changes it), `fake` = runs on the fake-Stripe server. */
const group = (id, fn, opts = {}) => groups.push({ id, fn, ...opts });

// ---------- more helpers ----------
const ok = (r, what) => {
  if (!r.ok) throw new Error(`${what} failed: ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
};
const go = { confirmed: true }; // a press that goes ahead (no stop-once box to show)
let adminP = null; // one admin per run
function adminAccount() {
  return (adminP ??= account(`admin+media${TS}${GROUP}@playtest.test`, "Media Admin", "developer", "they").then((a) => {
    own(`update "User" set "isAdmin" = true where email = ${lit(a.email)}`);
    return a;
  }));
}
const adminDo = (admin, action, id, more = {}) => post(admin, `/api/admin/${action}`, { id, note: "Media pass check", ...more }).then((r) => ok(r, "admin " + action));
const stopTest = (dev, id) => post(dev, `/api/tests/${id}/stop`, go).then((r) => ok(r, "stop"));
const nextRound = (dev, id) => post(dev, `/api/tests/${id}/next-round`, go).then((r) => ok(r, "next round"));
/** Calls are requests: the developer requests a time, the tester accepts it → booked. Returns the call id. */
async function bookCall(dev, tester, testId, sessionId, hoursAhead, minutes = 30) {
  const d = new Date(Date.now() + hoursAhead * 3600000);
  d.setSeconds(0, 0);
  ok(await post(dev, `/api/tests/${testId}/request-time`, { ...go, contractIds: [sessionId], minutes, times: [d.toISOString()] }), "request a time");
  const reqId = sql(`select id from "CallRequest" where "contractId" = '${sessionId}' and status = 'pending' order by "createdAt" desc limit 1`);
  ok(await post(tester, `/api/sessions/${sessionId}/answer-request`, { ...go, requestId: reqId, action: "accept" }), "accept the request");
  return sql(`select id from "Call" where "contractId" = '${sessionId}' and status = 'booked' order by "createdAt" desc limit 1`);
}
/** The test card on the developer dashboard with this title. */
const card = (page, title) => page.locator("[data-test-card]", { has: page.locator(`text="${title}"`) }).first();
const hold = (email, reason = "unpaid") => own(`update "User" set "holdStartedAt" = (now() at time zone 'utc') - interval '2 hours', "holdReason" = '${reason}', "holdCount" = "holdCount" + 1 where email = ${lit(email)}`);
const tick = (page) => page.evaluate(() => window.dispatchEvent(new Event("live-tick"))).catch(() => {});
/** Waits for a live update to reach the page (its own 20-second refresh, nudged so the recording stays short). */
async function waitLive(page, selector, ms = 25000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) return true;
    await tick(page);
    await page.waitForTimeout(700);
  }
  console.log("   ! waitLive: nothing for", selector, "on", page.url());
  return false;
}

// ---------- Developer dashboard ----------
group("dash", async () => {
  const nora = await account(`dev+media${TS}@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}a@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}b@playtest.test`, "Ben Okafor", "tester", "he");
  const admin = await adminAccount();
  // Three very different tests.
  const harbor = await postTest(nora, { recordingCents: "15.00", liveRateCents: "30.00", spots: "6" });
  const sA = await join(ana, harbor);
  await join(ben, harbor);
  await bookCall(nora, ana, harbor, sA, 30);
  const budget = await postTest(nora, { productName: "Budget Buddy", title: "Budget Buddy: sign-up flow", description: "Create an account and set up your first budget. Tell us where you hesitate.", buildUrl: "https://example.com/budget-buddy", categories: ["Finance", "Productivity"], writtenCents: "0", writtenRequired: false, questions: ["Which step took longest?"], spots: "10" });
  await join(ben, budget);
  const lumen = await postTest(nora, { productName: "Lumen Notes", title: "Lumen Notes private beta", description: "Install the beta with your key and write three notes.", buildUrl: "https://example.com/lumen", categories: ["Productivity", "AI"], writtenCents: "12.00", joinMode: "invite", spots: "4", ndaText: "Don't share screenshots of the beta.", accessKeys: "LUMEN-01\nLUMEN-02\nLUMEN-03\nLUMEN-04\nLUMEN-05", openUntil: day(28) });
  // Four states: work waiting, full, paused (another developer on a payment hold), stopped.
  const sky = await postTest(nora, { productName: "Sky Lab", title: "Sky Lab: tutorial", description: "Play the tutorial and answer two questions.", categories: ["Education", "Game"], writtenCents: "8.00", spots: "4" });
  const sSky = await join(ana, sky);
  await sendWritten(ana, sSky);
  const chef = await postTest(nora, { productName: "Pocket Chef", title: "Pocket Chef: recipe search", description: "Search for three recipes and save one.", categories: ["Shopping"], writtenCents: "6.00", spots: "2" });
  await join(ana, chef);
  await join(ben, chef);
  const night = await postTest(nora, { productName: "Night Market", title: "Night Market demo", description: "Walk through the market and buy one item.", categories: ["Game"], writtenCents: "9.00", spots: "3" });
  await join(ben, night);
  await stopTest(nora, night);
  // Draft (a next round) and Closed after 7 days paused.
  await nextRound(nora, harbor);
  const coral = await postTest(nora, { productName: "Coral Quest", title: "Coral Quest: boss fight", description: "Beat the first boss and tell us how fair it felt.", categories: ["Game"], writtenCents: "10.00", spots: "3" });
  await adminDo(admin, "pause-test", coral);
  await adminDo(admin, "close-paused", coral);
  // A second developer on a payment hold.
  const omar = await account(`dev+media${TS}o@playtest.test`, "Omar Reyes", "developer", "he");
  const tide = await postTest(omar, { productName: "Tide Tracker", title: "Tide Tracker: widgets", description: "Add the tide widget to your home screen and check it twice a day.", categories: ["Productivity"], writtenCents: "7.00", recordingCents: "12.00", spots: "5" });
  const sT = await join(ana, tide);
  await bookCall(omar, ana, tide, sT, 50).catch(() => {}); // (no live part: no call)
  hold(omar.email);

  await nora.goto("/app");
  await nora.waitForSelector("[data-test-card]");
  await shot(nora, "dash-card-game", "Game test card | A game test with written answers, a recording and live calls", card(nora, "Harbor Run: first 3 levels"));
  await shot(nora, "dash-card-free", "Free test card | A free web-app test (Finance, Productivity): its written answers pay nothing", card(nora, "Budget Buddy: sign-up flow"));
  await shot(nora, "dash-card-invite", "Invite-only card | An invite-only test with access keys and an NDA", card(nora, "Lumen Notes private beta"));
  await shot(nora, "dash-card-work-waiting", "Work waiting | An open test with work waiting for review", card(nora, "Sky Lab: tutorial"));
  await shot(nora, "dash-card-full", "Full | A full test: 2 of 2 spots taken", card(nora, "Pocket Chef: recipe search"));
  await shot(nora, "dash-card-stopped", "Stopped | A stopped test: no longer taking testers or work", card(nora, "Night Market demo"));
  await shot(nora, "dash-card-draft", "Draft | Draft: the next round, not open yet", card(nora, "Harbor Run: first 3 levels (round 2)"));
  await shot(nora, "dash-card-closed", "Closed | Closed after 7 days paused", card(nora, "Coral Quest: boss fight"));
  await shot(nora, "checks/dash-needs-review-and-calls", "Visual check: Needs review and Calls boxes", nora.locator("#needs-review"));
  await nora.screenshot({ path: path.join(VTMP, "check-dash-full.png"), fullPage: true });
  await omar.goto("/app");
  await omar.waitForSelector("[data-restricted-box]");
  await omar.locator("[data-restricted-box] button", { hasText: /Show \d+ more/ }).first().click().catch(() => {});
  await shot(omar, "dash-blue-box", "Blue box on a hold | Payment hold: the blue box at the top of the developer dashboard", omar.locator("[data-restricted-box]"));
  await shot(omar, "dash-card-paused", "Paused | A paused test (payment hold)", card(omar, "Tide Tracker: widgets"));
  await omar.screenshot({ path: path.join(VTMP, "check-dash-hold-full.png"), fullPage: true });
  await ana.goto("/app");
  await ana.screenshot({ path: path.join(VTMP, "check-tester-dash.png"), fullPage: true });
}, { section: "Developer dashboard" });

// ---------- Every page ----------
group("every", async () => {
  // A deleted account: the other open tab goes to the login page with the red notice.
  const kai = await account(`tester+media${TS}k@playtest.test`, "Kai Moreno", "tester", "they");
  const other = await same(kai);
  await other.goto("/app/find");
  await kai.goto("/app/account");
  ok(await post(kai, "/api/account/delete", { confirmed: true }), "delete account");
  await other.waitForURL(/\/login\?gone=1/, { timeout: 30000 });
  await shot(other, "every-deleted-account", "Deleted in another tab | Kai deleted their account in another tab: this tab is signed out with the red notice");

  // A hold that starts while pages are open: the test page and Edit move to the top of the dashboard.
  const dev = await account(`dev+media${TS}r@playtest.test`, "Rosa Diaz", "developer", "she");
  const ana = await account(`tester+media${TS}ra@playtest.test`, "Ana Silva", "tester", "she");
  const t = await postTest(dev, { productName: "Glow Garden", title: "Glow Garden: night levels", categories: ["Game"], writtenCents: "9.00" });
  await join(ana, t);
  const a = await rec(V, dev), b = await rec(V, dev);
  await a.goto(`/app/tests/${t}`);
  await b.goto(`/app/tests/${t}/edit`);
  await b.locator("#description").scrollIntoViewIfNeeded();
  const fromA = at(a), fromB = at(b);
  await pause(a, 2500);
  hold(dev.email);
  await Promise.all([a.waitForURL((u) => u.pathname === "/app", { timeout: 30000 }), b.waitForURL((u) => u.pathname === "/app", { timeout: 30000 })]);
  await a.waitForSelector("[data-restricted-box]");
  await b.waitForSelector("[data-restricted-box]");
  await pause(a, 3000);
  finishVideo([{ file: await saveVideo(a, "every-routing-a.webm"), from: fromA }, { file: await saveVideo(b, "every-routing-b.webm"), from: fromB }], "every-hold-routing",
    "Hold starts: pages move | A payment hold starts while the test page (left) and Edit (right) are open: both move to the dashboard top, where the blue box explains");
}, { section: "Every page" });

// ---------- Post a test ----------
group("post", async () => {
  const dev = await account(`dev+media${TS}m@playtest.test`, "Mina Park", "developer", "she");
  const ana = await account(`tester+media${TS}ma@playtest.test`, "Ana Silva", "tester", "she");
  const dee = await account(`tester+media${TS}md@playtest.test`, "Dee Moss", "tester", "they");
  await dev.goto("/app/tests/new");
  await dev.waitForSelector("#productName");
  await shotSpan(dev, "post-required-mark", "Required fields | The top of Post a test: “* marks the fields you have to fill in”", "main h1", field(dev, "productName"));
  await dev.fill("#productName", "Harbor Run");
  await dev.fill("#title", "Harbor Run: first 3 levels");
  await dev.fill("#description", "Sail through the first three harbors and tell us where the controls or the map get confusing.");
  await shotSpan(dev, "post-counters", "Counters | Counters on Product (up to 60), Name of this test (up to 60) and What should testers do (up to 1,000)", field(dev, "productName"), field(dev, "description"));

  // Video: filling in and posting a test, landing on its page.
  const v = await rec(V, dev);
  await v.goto("/app/tests/new");
  await v.waitForSelector("#productName");
  const from = at(v);
  await typeSlow(v, "#productName", "Pebble Path");
  await typeSlow(v, "#title", "Pebble Path: daily puzzle");
  await typeSlow(v, "#description", "Solve today's puzzle and tell us where you got stuck.", 15);
  await v.fill("#buildUrl", "https://example.com/pebble-path");
  await v.click("label:has-text('Game') >> nth=0");
  await v.click("label:has-text('Productivity') >> nth=0"); // (Productivity starts ticked: untick it)
  await v.locator("#writtenPrice").fill("8.00");
  await typeSlow(v, "#questions", "What did you like?\nWhere did you get stuck?", 15);
  await v.locator("#spots").fill("6");
  await v.locator("#openUntil").fill(day(14));
  await v.locator("#joinMode").scrollIntoViewIfNeeded();
  await pause(v, 800);
  await v.click("button:has-text('Post the test')");
  await v.waitForURL((u) => /\/app\/tests\/\w+$/.test(u.pathname) && !u.pathname.endsWith("/new"));
  await pause(v, 3000);
  const pebble = v.url().split("/").pop();
  finishVideo([{ file: await saveVideo(v, "post-flow.webm"), from }], "post-the-test", "Posting a test | Posting a test: fill in the four panels, press Post the test, land on the new test's page");

  // Where it's listed: Anyone in Find tests; Invite only only for the invited.
  await ana.goto("/app/find");
  await ana.waitForSelector("text=Pebble Path: daily puzzle");
  await shot(ana, "post-listed-find", "Listed in Find tests | Anyone can join: the new test shows in testers' Find tests", `a.card[href="/app/find/${pebble}"]`);
  const secret = await postTest(dev, { productName: "Lumen Notes", title: "Lumen Notes private beta", joinMode: "invite", categories: ["Productivity"], writtenCents: "12.00" });
  ok(await post(dev, `/api/tests/${secret}/invite`, { ...go, testerIds: [dee.uid] }), "invite");
  await dee.goto("/app");
  await dee.waitForSelector("text=Lumen Notes private beta");
  await shot(dee, "post-listed-invite", "Invite only | Invite only: not in Find tests; the invited tester sees it on their dashboard", dee.locator("section", { has: dee.locator("text=invited you to") }).first());

  // Red at the field.
  const r = await rec(V, dev);
  await r.goto("/app/tests/new");
  await r.waitForSelector("#productName");
  const fromR = at(r);
  await r.click("#productName");
  await r.click("#title");
  await r.click("#description");
  await pause(r, 500);
  await r.locator("#writtenPrice").fill("0.50");
  await r.locator("#spots").click();
  await r.locator("#spots").fill("60");
  await r.locator("#openUntil").click();
  await pause(r, 800);
  await shotSpan(r, "post-red-required-price", "Red: required, price, spots | Red at the field when you leave it: required fields empty, a price under $1, spots over the limit", field(r, "productName"), r.locator("#spots"), 12, 60);
  await r.locator("#productName").fill("Harbor Run");
  await r.locator("#title").fill("Harbor Run: first 3 levels");
  await r.locator("#description").fill("Sail through the harbors.");
  await r.locator("#writtenPrice").fill("10.00");
  await r.locator("#spots").fill("3");
  await r.locator("#buildUrl").fill("http://example.com/harbor");
  await r.locator("#questions").fill("What did you like?");
  await r.locator("#openUntil").fill(day(2));
  await r.locator("#accessKeys").fill("KEY-1\nKEY-1\nKEY-2");
  await r.locator("#openUntil").click();
  await r.locator("#accessKeys").click();
  await r.locator("#productName").click();
  await pause(r, 800);
  await shotSpan(r, "post-red-dates-keys", "Red: Open until and keys | Red when you leave the field: Open until only 2 days ahead (it must be 3 to 30), and fewer keys than spots", r.locator("h2:has-text('Who and how long')"), r.locator("#accessKeys").locator("xpath=ancestor::div[1]"));
  // Fix those two; Post then finds what only the server checks: the link and a key typed twice.
  await r.locator("#openUntil").fill(day(25));
  await r.locator("#accessKeys").fill("KEY-1\nKEY-1\nKEY-2\nKEY-3");
  await r.locator("#productName").click();
  await pause(r, 800);
  await r.click("button:has-text('Post the test')");
  await r.waitForSelector("text=/Fix the .* above/");
  await pause(r, 2500);
  finishVideo([{ file: await saveVideo(r, "post-red.webm"), from: fromR }], "post-red-checks", "Red checks, then the server | Red at the field: each box is checked when you leave it, and Post checks everything again on the server");
}, { section: "Post a test" });

// ---------- Edit test ----------
/** Another tab's Save, through the same API the form uses (the version it loaded, the fields it changed). */
async function apiEdit(dev, id, fields, keys = {}) {
  const r = await dev.context().request.get(`${BASE}/api/tests/${id}/listing`);
  const { version } = await r.json();
  return ok(await post(dev, `/api/tests/${id}/edit`, { version, fields, confirmed: true, keysAdd: keys.add ?? [], keysRemove: keys.remove ?? [] }), "edit");
}

/** (Batch 15 section 19) Edit's Free keys box holds every free key, one per line: add keys by typing new lines, remove one by deleting its line. */
async function addKeys(page, lines) {
  const box = page.locator("#keysFree");
  const now = await box.inputValue();
  await box.fill([now.trim(), lines].filter(Boolean).join("\n"));
}
async function removeKey(page, value) {
  const box = page.locator("#keysFree");
  const now = await box.inputValue();
  await box.fill(now.split("\n").filter((l) => l.trim() !== value).join("\n"));
}
const saveBtn = (page) => page.locator("form button.btn", { hasText: /^(Save|Saving…)$/ });
const panel = (page, heading) => page.locator("div.panel", { has: page.locator(`h2:has-text("${heading}")`) }).first();

group("edit", async () => {
  const dev = await account(`dev+media${TS}e@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}ea@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}eb@playtest.test`, "Ben Okafor", "tester", "he");
  const cam = await account(`tester+media${TS}ec@playtest.test`, "Cam Lee", "tester", "they");
  const admin = await adminAccount();
  const keys = "HR-1111\nHR-2222\nHR-3333\nHR-4444\nHR-5555\nHR-6666";
  const t = await postTest(dev, { spots: "5", openUntil: day(20), accessKeys: keys });
  const sA = await join(ana, t);
  const sB = await join(ben, t);
  const sC = await join(cam, t);
  ok(await post(ben, `/api/sessions/${sB}/key-broken`, go), "key broken");
  ok(await post(cam, `/api/sessions/${sC}/leave`, { ...go, reason: "No time this week" }), "leave");

  // The live box under Save.
  await dev.goto(`/app/tests/${t}/edit`);
  await dev.waitForSelector("#description");
  await sendWritten(ana, sA);
  await waitLive(dev, "[data-live-top]");
  await shotSpan(dev, "edit-live-box", "Live box under Save | Edit's live box sits under Save: Ana sent her written answers while Edit was open", saveBtn(dev), "[data-live-top]", 16, 12);

  // Dates.
  await dev.goto(`/app/tests/${t}/edit`);
  await dev.locator("#openUntil").fill(day(15));
  await dev.locator("#spots").click();
  await pause(dev, 500);
  await shot(dev, "edit-open-until", "Open until only moves later | Open until can only move later: an earlier date is red", panel(dev, "Who and how long"));
  await dev.goto(`/app/tests/${t}/edit`);
  await dev.locator("#openUntil").fill(day(35));
  await dev.locator("#spots").click();
  await pause(dev, 500);
  await shot(dev, "edit-open-until-30", "Open until at most 30 days ahead | Open until can move later, but at most 30 days from today: a later date is red", panel(dev, "Who and how long"));

  // Access keys that can't be added again.
  await dev.goto(`/app/tests/${t}/edit`);
  await addKeys(dev, "HR-1111");
  await dev.locator("#spots").click();
  await dev.waitForSelector("text=/is in use by Ana Silva/");
  await shotSpan(dev, "edit-key-in-use", "Key in use | A key in use by a working tester can't be added (red, as you type): “HR-1111 is in use by Ana Silva, so it can't be added.”", "#keys", "text=/is in use by Ana Silva/", 12, 20);
  await dev.goto(`/app/tests/${t}/edit`);
  await addKeys(dev, "HR-3333");
  await dev.locator("#spots").click();
  await dev.waitForSelector("[data-key-warnings]");
  await shot(dev, "edit-key-reported-left", "A key from a tester who left | Cam left: his key HR-3333 can be typed back into Free, with a warning only (a “Reused” tag, never a mistake)", "#keys");

  // Changed in another tab or device: A has Edit open; B saves the instructions and new keys.
  const A = await rec(V, dev), B = await rec(V, dev);
  await A.goto(`/app/tests/${t}/edit`);
  await B.goto(`/app/tests/${t}/edit`);
  // (Edit keeps unsent typing per form: clear what the key checks above left in the Add keys box.)
  await A.evaluate(() => window.scrollTo(0, 0));
  const fromA = at(A), fromB = at(B);
  await A.locator("#title").click();
  await A.keyboard.press("End");
  await typeSlow(A, "#title", " (beta)");
  await pause(A, 600);
  await B.locator("#description").fill("");
  await typeSlow(B, "#description", "Sail through all five harbors now, and tell us where the map or the controls get confusing.", 12);
  await addKeys(B, "HR-7777\nHR-8888\nHR-9999");
  await B.locator("#keysFree").scrollIntoViewIfNeeded();
  await pause(B, 600);
  await saveBtn(B).click();
  await B.waitForURL(/saved=1/);
  // A presses Save before its own refresh has shown the change: Save stops once and the fields take the new values with blue notes.
  await pause(A, 800);
  await saveBtn(A).click();
  await A.waitForSelector("text=/Press Save again/");
  await pause(A, 2500);
  await A.locator("#description").scrollIntoViewIfNeeded();
  await pause(A, 2500);
  await A.locator("#keysFree").scrollIntoViewIfNeeded();
  await pause(A, 2500);
  await shot(A, "edit-elsewhere-field", "Blue note on a field | Another tab saved new instructions: the field updates with a blue note under it", field(A, "description"));
  await shot(A, "edit-elsewhere-keys", "Blue note on keys | Keys added in another tab: the blue note under the key boxes", "#keys");
  await shotSpan(A, "edit-elsewhere-save", "Save stops once | Save stops once: “This test changed since you opened Edit. Press Save again…”", saveBtn(A), A.locator("text=/Press Save again/").locator("xpath=ancestor::*[contains(@class,'info')][1]"), 16, 12);
  finishVideo([{ file: await saveVideo(A, "edit-else-a.webm"), from: fromA }, { file: await saveVideo(B, "edit-else-b.webm"), from: fromB }], "edit-changed-elsewhere",
    "Two tabs on Edit (race) | Two tabs on Edit: the right tab saves new instructions and keys; the left tab's fields update with blue notes, and its Save stops once");

  // Red and blue at once (5 keys, 4 spots, 1 tester in: 4 free keys for 3 open spots).
  const t2 = await postTest(dev, { title: "Harbor Run: night sailing", spots: "4", openUntil: day(20), accessKeys: "NS-1\nNS-2\nNS-3\nNS-4\nNS-5" });
  await join(ana, t2);
  await dev.goto(`/app/tests/${t2}/edit`);
  await removeKey(dev, "NS-4");
  await apiEdit(dev, t2, { spots: 5 });
  await tick(dev);
  await dev.waitForSelector("text=Changed in another tab or device");
  await dev.locator("#keysFree").click();
  await dev.locator("#spots").click();
  await pause(dev, 600);
  await shotSpan(dev, "edit-red-blue-spots-keys", "Red and blue: spots and keys | You deleted a key's line; another tab added a spot (blue): now fewer free keys than open spots (red)", field(dev, "spots"), "#keys");
  await apiEdit(dev, t2, { spots: 4 });
  await dev.goto(`/app/tests/${t2}/edit`);
  await apiEdit(dev, t2, { openUntil: day(26) });
  await tick(dev);
  await dev.waitForSelector("text=Changed in another tab or device");
  await dev.locator("#openUntil").fill(day(23));
  await dev.locator("#openUntil").click();
  await dev.locator("#spots").click();
  await pause(dev, 600);
  await shot(dev, "edit-red-blue-open-until", "Red and blue: Open until | Another tab moved Open until later (blue); a date typed here before that one is now red, because Open until only moves later", panel(dev, "Who and how long"));
  await dev.goto(`/app/tests/${t2}/edit`);
  await removeKey(dev, "NS-4");
  await apiEdit(dev, t2, {}, { remove: ["NS-5"] });
  await tick(dev);
  await dev.waitForSelector("text=Changed in another tab or device");
  await dev.locator("#keysFree").click();
  await dev.locator("#spots").click();
  await pause(dev, 600);
  await shot(dev, "edit-red-blue-keys", "Red and blue: keys | You deleted one key's line; another tab removed another (blue): the free keys no longer cover the open spots (red)", "#keys");

  // 3 changes after the first join.
  const t3 = await postTest(dev, { title: "Harbor Run: storms", spots: "3" });
  await join(ana, t3);
  for (const d of ["Sail into the first storm.", "Sail into the first two storms.", "Sail into all three storms."]) await apiEdit(dev, t3, { description: d });
  await dev.goto(`/app/tests/${t3}/edit`);
  await dev.waitForSelector("[data-critical-locked]");
  await shotSpan(dev, "edit-three-changes", "3 changes per field | After 3 saves that changed the steps, the steps field locks with its note; every other limited field shows its own “Changes left: N of 3”", saveBtn(dev), "[data-critical-locked]");

  // The team stops the test while Edit is open: Save is refused and the developer goes back to the test page.
  const t4 = await postTest(dev, { title: "Harbor Run: lighthouse", spots: "3" });
  await join(ana, t4);
  const S = await rec(V, dev);
  await S.goto(`/app/tests/${t4}/edit`);
  await S.waitForSelector("#description");
  const fromS = at(S);
  await typeSlow(S, "#description", " Then climb the lighthouse.");
  await pause(S, 600);
  await adminDo(admin, "stop-test", t4, { note: "Media pass check: build link is broken" });
  await saveBtn(S).click();
  await S.waitForURL((u) => u.pathname === `/app/tests/${t4}`, { timeout: 15000 }).catch(() => {});
  await pause(S, 3500);
  await S.screenshot({ path: path.join(VTMP, "edit-admin-stop-after.png"), fullPage: true });
  finishVideo([{ file: await saveVideo(S, "edit-admin-stop.webm"), from: fromS }], "edit-team-stopped", "Team stops it during Edit | The team stops the test while Edit is open: Save is refused and the test page's banner names the press that didn't go through");
}, { section: "Edit" });

// ---------- Developer test page ----------
// (Batch 15 section 30) No Reject: the decision without money is a $0 Pay with a reason.
const rejectPiece = (dev, subId, reason) => post(dev, "/api/review", { amount: "0", kind: "submission", id: subId, reason, payKey: require("crypto").randomUUID(), seenAt: nowIso(), confirmed: true }).then((r) => ok(r, "reject"));
const subOf = (sessionId) => sql(`select id from "Submission" where "contractId" = '${sessionId}' order by "sentAt" desc limit 1`);
/** The call timer's “Covered time is up” pop-ups (one per timer on the page) would cover the pictures: close them all. */
async function closeTimerPopups(page) {
  for (let i = 0; i < 6; i++) {
    const b = page.locator("div[role=alert]", { hasText: /covered time/i }).locator("button[aria-label=Close]").first();
    if (!(await b.isVisible().catch(() => false))) break;
    await b.click().catch(() => {});
    await page.waitForTimeout(200);
  }
}
const testPanel = (page) => page.locator("section[aria-label='Test']").first();
const liveSession = (page) => page.locator("#calls").locator("xpath=ancestor::details[1]");

/** A test with people in every state: work to pay, calls booked and waiting, a call that happened, a dispute. */
async function busyTest(tag) {
  const dev = await account(`dev+media${TS}${tag}@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}${tag}a@playtest.test`, "Ana Silva", "tester", "she", { phone: true });
  const ben = await account(`tester+media${TS}${tag}b@playtest.test`, "Ben Okafor", "tester", "he", { phone: true });
  const cam = await account(`tester+media${TS}${tag}c@playtest.test`, "Cam Lee", "tester", "they");
  const t = await postTest(dev, { recordingCents: "15.00", liveRateCents: "30.00", spots: "6", questions: ["What did you like?", "Where did you get stuck?", "Would you play level 4?"], openUntil: day(20) });
  const sA = await join(ana, t), sB = await join(ben, t), sC = await join(cam, t);
  return { dev, ana, ben, cam, t, sA, sB, sC };
}

group("testpage", async () => {
  const w = await busyTest("t");
  const { dev, ana, ben, cam, t, sA, sB, sC } = w;
  const admin = await adminAccount();
  // Work to review, a call that happened (waiting for its length), calls booked and requested, a dispute.
  await sendWritten(ana, sA, ["The boat handling feels great.", "The second bridge: I couldn't tell where to go.", "Yes, if the map gets clearer."]);
  await sendWritten(cam, sC, ["Fun music.", "Nowhere really.", "Maybe."]);
  await rejectPiece(dev, subOf(sC), "The answers are too short to use.");
  ok(await post(cam, `/api/sessions/${sC}/dispute`, { ...go, kind: "submission", id: subOf(sC), reason: "I answered every question; the test didn't ask for long answers." }), "dispute");
  const past = await bookCall(dev, ben, t, sB, 26);
  const utc = "(now() at time zone 'utc')";
  own(`update "Call" set "startsAt" = ${utc} - interval '50 minutes', "devJoinedAt" = ${utc} - interval '50 minutes', "testerJoinedAt" = ${utc} - interval '49 minutes' where id = '${past}'`);
  await bookCall(dev, ana, t, sA, 52);
  await bookCall(dev, ben, t, sB, 0.13); // starts in 8 minutes: Join shows
  ok(await post(dev, `/api/tests/${t}/request-time`, { ...go, contractIds: [sC], minutes: 45, times: [new Date(Date.now() + 74 * 3600000).toISOString()] }), "request a time");
  // An "Approved only" test with requirements: applications, a rejoin ask, invite lists with missing needs.
  const dee = await account(`tester+media${TS}td@playtest.test`, "Dee Marsh", "tester", "they", { devices: ["Mac"], languages: ["English"] });
  const eli = await account(`tester+media${TS}te@playtest.test`, "Eli Novak", "tester", "he", { devices: ["iPhone"], languages: ["Polish"] });
  const fay = await account(`tester+media${TS}tf@playtest.test`, "Fay Ito", "tester", "she", { devices: ["iPhone", "iPad"], languages: ["English"] });
  const kelp = await postTest(dev, { productName: "Kelp Forest", title: "Kelp Forest: iPhone beta", categories: ["Game"], devices: ["iPhone", "iPad"], languages: ["English"], joinMode: "apply", writtenCents: "8.00", spots: "5" });
  ok(await post(fay, `/api/tests/${kelp}/apply`, { ...go, note: "I play a lot of underwater games on my iPad." }), "apply");
  ok(await post(eli, `/api/tests/${kelp}/apply`, { ...go, anyway: true, note: "I can test in English too." }), "apply (Eli)");
  // Gus was accepted earlier, left, and now asks to rejoin.
  const gus = await account(`tester+media${TS}tg@playtest.test`, "Gus Hale", "tester", "he", { devices: ["iPhone"], languages: ["English"] });
  ok(await post(gus, `/api/tests/${kelp}/apply`, { ...go, note: "Happy to help." }), "apply (Gus)");
  const appG = sql(`select id from "Application" where "testId" = '${kelp}' and "testerId" = '${gus.uid}' order by "createdAt" desc limit 1`);
  ok(await post(dev, `/api/tests/${kelp}/application`, { ...go, applicationId: appG, action: "accept" }), "accept Gus");
  const sGk = sql(`select id from "Contract" where "testId" = '${kelp}' and "testerId" = '${gus.uid}'`);
  ok(await post(gus, `/api/sessions/${sGk}/leave`, { ...go, reason: "Busy week" }), "leave kelp");
  ok(await post(gus, `/api/tests/${kelp}/rejoin-ask`, { ...go, note: "My week freed up. Can I come back?" }), "rejoin ask");

  await dev.goto(`/app/tests/${t}`);
  await dev.waitForSelector("#needs-you");
  await pause(dev, 1500);
  // (Ben's call that already happened shows the "Covered time is up" pop-up: closed so it doesn't cover the pictures.)
  await closeTimerPopups(dev);
  await shot(dev, "tp-overview", "Overview | Overview: title, status, badges, terms and spots, Open until, and the Edit, Alerts, Next round, End early and Stop buttons", testPanel(dev));
  await shot(dev, "tp-needs-you", "Needs you | Needs you, grouped per person: Pay or Reject for sent work, a call waiting for its length, a dispute waiting for your side", "#needs-you");
  await shotSpan(dev, "tp-needs-dispute-call", "A dispute and a call to log | A dispute waiting for the developer's side, and a call that happened waiting for its length", "#needs-you [id^='item-dispute-']", dev.locator("#needs-you [data-needs-person]").filter({ hasText: "Ben Okafor" }).first());
  await shot(dev, "tp-testers", "Testers panel | Testers: the avatar row with Ana's hover card, and one row per tester with parts sent, pay and their contract", "#testers-joined", async () => {
    await dev.locator("#testers-joined a[aria-label='Ana Silva: profile']").first().hover();
    await pause(dev, 700);
  });
  await shot(dev, "tp-live-session", "Live session | Live session: tick testers, request times, waiting requests, booked calls (Join shows near the start) and past calls", liveSession(dev));
  await dev.click("[data-alerts-menu] > summary");
  await pause(dev, 500);
  await shotSpan(dev, "tp-alerts", "Alerts menu | Alerts: tick what should not stop your buttons", testPanel(dev), dev.locator("[data-alerts-menu] > div, [data-alerts-menu] > *:not(summary)").last(), 12, 16);
  await dev.click("[data-alerts-menu] > summary");

  await dev.goto(`/app/tests/${kelp}`);
  await dev.waitForSelector("#needs-you");
  await shot(dev, "tp-needs-applications", "Applications and a rejoin ask | On an Approved-only test: applications to Accept or Decline, and a rejoin ask with the time they'd get back", "#needs-you");
  await dev.click("#invite > summary");
  await pause(dev, 800);
  await shot(dev, "tp-invite", "Invite testers | Invite testers: People you've worked with, Suggested and Find testers, then Invited", "#invite");
  await dev.fill("#invite input[aria-label='Find testers']", "Dee Marsh");
  await pause(dev, 1200);
  await dev.check(`#invite li[data-invite-row="${dee.uid}"] input`);
  await shot(dev, "tp-invite-find", "Find testers by name | Find testers by name: missing needs show as orange labels", "#invite");
  await dev.click("#invite button:has-text('Invite')");
  await dev.waitForSelector("[data-invite-anyway]");
  await pause(dev, 600);
  await shot(dev, "tp-invite-anyway", "Invite anyway | Invite anyway: the inline box lists the needs Dee doesn't meet", "#invite");

  // Next round: a draft copy.
  await dev.goto(`/app/tests/${t}`);
  await dev.click("button:has-text('Next round')");
  await dev.click("text=Start the next round");
  // (Oct 28) A draft opens in Post a test, filled in; Post the test opens it for testers.
  await dev.waitForURL((u) => u.pathname.startsWith("/app/tests/new") && u.search.includes("draft="), { timeout: 10000 });
  await dev.waitForSelector("[data-draft-note]");
  await shot(dev, "tp-next-round", "Next round | Next round: the draft “(round 2)” opens in Post a test, filled in; Post the test opens it for testers", "main");

  // End early: the confirm pop-up.
  await dev.goto(`/app/tests/${t}`);
  await dev.click("button:has-text('End early')");
  await dev.check("[data-end-early] label:has-text('Ben Okafor') input").catch(async () => dev.locator("[data-end-early] fieldset input").nth(1).check());
  await dev.fill("#reason", "We have what we need from you for this build: thank you!");
  await dev.click("[data-end-early] button:has-text('End their work now')");
  await dev.waitForSelector("dialog[open]");
  await pause(dev, 500);
  await shot(dev, "tp-end-early", "End early | End early: tick testers, give one reason they read, then the confirm pop-up “End their work now”");
  await dev.keyboard.press("Escape");

  // Stop: the confirm pop-up, then the stopped page and the tester's page.
  await dev.goto(`/app/tests/${t}`);
  await dev.click("button:has-text('Stop the test')");
  await dev.waitForSelector("dialog[open]");
  await pause(dev, 500);
  await shot(dev, "tp-stop-confirm", "Stop: confirm | Stop: the confirm pop-up “Are you sure you want to stop …?”");
  await dev.click("dialog[open] button:has-text('Stop the test')");
  await dev.waitForSelector("text=This test is stopped.");
  await pause(dev, 1500);
  await dev.goto(`/app/tests/${t}`);
  await shotSpan(dev, "tp-stopped", "Stopped test page | Stopped: the Stopped label and the stopped line; only what still works: Needs you, the Testers panel and past calls; Next round stays", testPanel(dev), liveSession(dev));
  await ana.goto(`/app/sessions/${sA}`);
  await pause(ana, 1000);
  await shot(ana, "tp-stopped-tester", "Stopped: the tester's page | The tester's page after Stop: the stopped line says what they can still do (phone)");
  await ana.screenshot({ path: path.join(VTMP, "check-tester-stopped-full.png"), fullPage: true });
}, { section: "Developer test page" });

group("tpvideo", async () => {
  const { dev, ana, ben, cam, t, sA, sB, sC } = await busyTest("v");
  const admin = await adminAccount();

  // Live box: Ana sends her answers, then switches to new terms; "See their contract" scrolls to her row.
  {
    const D = await rec(V, dev), T = await rec(PHONE, ana);
    await D.goto(`/app/tests/${t}`);
    await T.goto(`/app/sessions/${sA}`);
    await T.locator("#a0").scrollIntoViewIfNeeded();
    const fromD = at(D), fromT = at(T);
    await pause(T, 800);
    await T.locator("#a0").fill("The boat handling feels great.");
    await T.locator("#a1").fill("The second bridge: I couldn't tell where to go.");
    await T.locator("#a2").fill("Yes, if the map gets clearer.");
    await T.click("button:has-text('Send my answers')");
    await T.waitForSelector("text=/^Sent [A-Z]/").catch(() => {});
    await waitLive(D, "[data-live-top]");
    await pause(D, 1500);
    await apiEdit(dev, t, { writtenCents: "12.00" });
    await T.reload();
    await T.waitForSelector("button:has-text('Switch to the new terms')");
    await pause(T, 1500);
    await T.click("button:has-text('Switch to the new terms')");
    await waitLive(D, "[data-live-top] a:has-text('See their contract')");
    await pause(D, 1500);
    await shot(D, "checks/live-box-switched-new-terms", "Visual check: the live box line “Ana Silva switched to the new terms” with See their contract", "[data-live-top]");
    await D.click("[data-live-top] a:has-text('See their contract')");
    await pause(D, 3000);
    finishVideo([{ file: await saveVideo(D, "tp-live-d.webm"), from: fromD }, { file: await saveVideo(T, "tp-live-t.webm"), from: fromT }], "tp-live-box",
      "Live box (race) | The live box: Ana (right, phone) sends her answers and switches to the new terms; the developer's box updates and See their contract scrolls to her row");
  }

  // Stop-once on Pay: Ben sends his answers while the developer is about to pay Ana.
  {
    const D = await rec(V, dev), T = await rec(PHONE, ben);
    await D.goto(`/app/tests/${t}`);
    await T.goto(`/app/sessions/${sB}`);
    const sub = subOf(sA);
    await D.locator(`#amt-${sub}`).scrollIntoViewIfNeeded();
    await T.locator("#a0").scrollIntoViewIfNeeded();
    const fromD = at(D), fromT = at(T);
    await pause(D, 800);
    await T.locator("#a0").fill("Smooth sailing.");
    await T.locator("#a1").fill("The fog level was too dark.");
    await T.locator("#a2").fill("Yes.");
    await T.click("button:has-text('Send my answers')");
    await pause(T, 1500);
    await D.locator(`#piece-${sub} label:has-text('charged now') input`).first().check();
    await D.locator(`#piece-${sub} button:has-text('Pay')`).first().click();
    await D.waitForSelector(`#piece-${sub} >> text=/again/`);
    await pause(D, 2500);
    await shot(D, "tp-stop-once-pay", "Pay stops once | Stop-once on Pay: Ben sent his answers since the page loaded, listed under the button", D.locator(`#piece-${sub}`));
    await D.locator(`#piece-${sub} button:has-text('Pay')`).first().click();
    await pause(D, 3000);
    finishVideo([{ file: await saveVideo(D, "tp-once-d.webm"), from: fromD }, { file: await saveVideo(T, "tp-once-t.webm"), from: fromT }], "tp-stop-once",
      "Pay stops once (race) | Stop-once: Ben (right, phone) sends his answers while the developer presses Pay for Ana; Pay stops once and lists the change, the second press goes ahead");
  }

  // Stop-once inside a confirm pop-up: the Stop confirm fails after an unseen change.
  await dev.goto(`/app/tests/${t}`);
  await dev.click("button:has-text('Stop the test')");
  await dev.waitForSelector("dialog[open]");
  ok(await post(cam, `/api/sessions/${sC}/leave`, { ...go, reason: "Something came up" }), "leave");
  await pause(dev, 1500);
  await dev.click("dialog[open] button:has-text('Stop the test')");
  await dev.waitForSelector("text=/didn.t go through/");
  await pause(dev, 1000);
  await shot(dev, "tp-stop-once-stop", "Stop stops once | Stop-once after a pop-up: Cam left while the Stop pop-up was open; the press didn't go through and the change shows under Stop", testPanel(dev));

  // Stop-once on Invite: the ticked tester removed a device this test needs.
  const fay = await account(`tester+media${TS}vf@playtest.test`, "Fay Ito", "tester", "she", { devices: ["iPhone", "iPad"], languages: ["English"] });
  const kelp = await postTest(dev, { productName: "Kelp Forest", title: "Kelp Forest: iPhone beta", categories: ["Game"], devices: ["iPhone", "iPad"], languages: ["English"], writtenCents: "8.00", spots: "5" });
  await dev.goto(`/app/tests/${kelp}`);
  await dev.click("#invite > summary");
  await dev.fill("#invite input[aria-label='Find testers']", "Fay Ito");
  await pause(dev, 1000);
  await dev.check(`#invite li[data-invite-row="${fay.uid}"] input`);
  ok(await post(fay, "/api/profile", { name: "Fay Ito", pronoun: "she", isDeveloper: false, isTester: true, devices: ["Android phone"], languages: ["English"], categories: [] }), "profile");
  await dev.click("#invite button:has-text('Invite')");
  await dev.waitForSelector("text=/removed|which this test needs/");
  await pause(dev, 800);
  await shot(dev, "tp-stop-once-invite", "Invite stops once | Invite stops once: Fay removed iPhone and iPad from her profile after the page loaded", "#invite");

  // The team pauses the test while the developer is on it: only Stop works.
  {
    const t2 = await postTest(dev, { title: "Harbor Run: reef", spots: "3" });
    await join(ana, t2);
    const D = await rec(V, dev);
    await D.goto(`/app/tests/${t2}`);
    const from = at(D);
    await pause(D, 1500);
    await adminDo(admin, "pause-test", t2, { note: "Media pass check: we're looking at a report" });
    await D.click("button:has-text('End early')");
    await D.locator("[data-end-early] fieldset input").first().check();
    await D.fill("#reason", "Wrapping up this round early, thanks!");
    await D.click("[data-end-early] button:has-text('End their work now')");
    await D.click("dialog[open] button:has-text('End their work now')");
    await D.waitForSelector("[data-test-banner]", { timeout: 15000 });
    await pause(D, 3500);
    await D.screenshot({ path: path.join(VTMP, "tp-paused-after.png"), fullPage: true });
    finishVideo([{ file: await saveVideo(D, "tp-paused.webm"), from }], "tp-team-paused", "Team pauses the test | The team pauses the test: End early is refused (“you can only stop it”) and the banner explains");
  }

}, { section: "Developer test page" });

group("tpstop", async () => {
  // The team stops the test while the developer is requesting a call lower on the page.
  const dev = await account(`dev+media${TS}s@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}sa@playtest.test`, "Ana Silva", "tester", "she");
  const admin = await adminAccount();
  const t3 = await postTest(dev, { title: "Harbor Run: shipwreck", spots: "3", liveRateCents: "30.00" });
  await join(ana, t3);
  const D = await rec(V, dev);
  await D.goto(`/app/tests/${t3}`);
  await D.locator("#calls").scrollIntoViewIfNeeded();
  const from = at(D);
  await pause(D, 1000);
  await D.check("section[aria-label='Call requests'] label:has-text('Ana Silva') input");
  const when = new Date(Date.now() + 2 * 86400000);
  await D.fill("section[aria-label='Call requests'] input[type=datetime-local]", new Date(when.getTime() - when.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  await D.fill("section[aria-label='Call requests'] input[aria-label='Length in minutes']", "30");
  await adminDo(admin, "stop-test", t3, { note: "Media pass check: the build link is broken" });
  await pause(D, 800);
  // The page may already have moved to the top by itself (it follows a team stop live): then there is nothing left to press.
  await D.click("section[aria-label='Call requests'] >> text=Request a time", { timeout: 4000 }).catch(() => {});
  await D.waitForSelector("[data-test-banner]", { timeout: 15000 });
  await pause(D, 4000);
  await D.screenshot({ path: path.join(VTMP, "tp-stopped-team-after.png"), fullPage: true });
  finishVideo([{ file: await saveVideo(D, "tp-stopped-team.webm"), from }], "tp-team-stopped", "Team stops the test | The team stops the test while a call is being requested: the request is refused, the page moves to the top and the banner names the press that didn't go through");
}, { section: "Developer test page" });

// ---------- Visual check of tonight's tester dashboard boxes (not doc pictures; kept in the temp folder) ----------
group("check", async () => {
  const tia = await account(`tester+media${TS}ck@playtest.test`, "Tia Brooks", "tester", "she");
  const nora = await account(`dev+media${TS}ck@playtest.test`, "Nora Lane", "developer", "she");
  const omar = await account(`dev+media${TS}cko@playtest.test`, "Omar Reyes", "developer", "he");
  const a = await postTest(nora, { title: "Harbor Run: first 3 levels", recordingCents: "15.00" }); // To do
  const sa = await join(tia, a);
  const b = await postTest(nora, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"] }); // Charge or cancel
  const sb = await join(tia, b);
  await sendWritten(tia, sb);
  const utc = "(now() at time zone 'utc')";
  own(`update "Submission" set "sentAt" = ${utc} - interval '15 days', "payBy" = ${utc} - interval '1 day', "choiceOfferedAt" = ${utc} - interval '1 day' where id = '${subOf(sb)}'`); // (as the daily job does once Charge opens)
  own(`update "Test" set "openUntil" = ${utc} - interval '1 day' where id = '${b}'`);
  const c = await postTest(nora, { productName: "Pocket Chef", title: "Pocket Chef: recipe search", categories: ["Shopping"] }); // Tests you left
  const sc = await join(tia, c);
  ok(await post(tia, `/api/sessions/${sc}/leave`, { ...go, reason: "No time this week" }), "leave");
  const d = await postTest(omar, { productName: "Tide Tracker", title: "Tide Tracker: widgets", categories: ["Productivity"] }); // Paused (payment hold)
  const sd = await join(tia, d);
  hold(omar.email);
  await tia.goto("/app");
  await pause(tia, 1200);
  await shotFull(tia, "tester-dashboard-boxes", "Tester dashboard boxes | The tester dashboard: To do, Charge or cancel, Tests you left, and a test paused by its developer (tagged Paused)");
  const dk = await same(tia, DESKTOP);
  const words = /\b(hold|suspend\w*|fail\w*|chargeback\w*)\b/i;
  for (const [url, name] of [["/app", "dashboard"], [`/app/sessions/${sd}`, "paused-session"], [`/app/sessions/${sb}`, "charge-session"], ["/app/notifications", "bell"], ["/app/payments", "payments"]]) {
    await dk.goto(url);
    await pause(dk, 1000);
    const text = await dk.locator("main").innerText();
    const hit = text.split("\n").filter((l) => words.test(l));
    console.log(`   tester ${name}: ${hit.length ? "FOUND " + JSON.stringify(hit.slice(0, 5)) : "clean"}`);
    await dk.screenshot({ path: path.join(VTMP, `check-tester-${name}.png`), fullPage: true });
  }
}, { section: "Tester dashboard and Find" });

// ---------- Payments: money flows, on the second server's fake Stripe ----------
/** A saved card on the fake Stripe (no Checkout page in the fake): pm_card_visa, pm_card_declined or pm_card_authenticationRequired. */
const setCard = (email, pm) => own(`update "User" set "stripeCustomerId" = 'cus_fake_' || id, "stripePaymentMethodId" = '${pm}' where email = ${lit(email)}`);
/** A Stripe webhook event, signed the fake's way (only the fake server accepts it). */
async function webhook(type, object) {
  const r = await fetch(`${BASE}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": "fake", "content-type": "application/json" }, body: JSON.stringify({ type, data: { object } }) });
  if (!r.ok) throw new Error(`webhook ${type}: ${r.status}`);
}
/** The fake server's test-only hook (src/app/api/dev/hook): one account's share of the daily job. */
async function hook(action, email, more = {}) {
  const r = await fetch(`${BASE}/api/dev/hook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, email, ...more }) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`hook ${action}: ${r.status} ${JSON.stringify(b)}`);
  return b.result;
}
const piOf = (subId) => sql(`select "stripePaymentIntentId" from "Payment" where "submissionId" = '${subId}' and status = 'charged' order by "createdAt" desc limit 1`);
/** Pay one sent piece through the API at its listed price (the developer's own press). */
async function apiPay(dev, subId, dollars) {
  const cents = Math.round(Number(dollars) * 100);
  return ok(await post(dev, "/api/review", { action: "pay", kind: "submission", id: subId, amount: dollars, tickedCents: cents, payKey: require("crypto").randomUUID(), seenAt: nowIso(), confirmed: true }), "pay");
}
/** Press Pay on one piece of the developer test page (the amount box starts at the listing; the every-payment tick). */
async function payPiece(page, subId) {
  const box = page.locator(`#piece-${subId}`);
  await box.scrollIntoViewIfNeeded();
  await box.locator("[data-pay-tick] input").first().check();
  await pause(page, 500);
  await box.locator("button", { hasText: /^Pay$/ }).first().click();
}
/** Charge opens for this tester's part (as the daily job does once 7 days and Open until have passed). */
function openCharge(sessionId, testId) {
  const utc = "(now() at time zone 'utc')";
  own(`update "Submission" set "sentAt" = ${utc} - interval '15 days', "payBy" = ${utc} - interval '1 day', "choiceOfferedAt" = ${utc} - interval '1 day', "choiceBy" = ${utc} + interval '6 days' where id = '${subOf(sessionId)}'`);
  own(`update "Test" set "openUntil" = ${utc} - interval '1 day' where id = '${testId}'`);
}
/** The tester presses Charge on their session page (tick, then the button). */
async function chargeUI(page, sessionId) {
  await page.goto(`/app/sessions/${sessionId}`);
  const box = page.locator("label", { hasText: /charge .* now/ }).first();
  await box.scrollIntoViewIfNeeded();
  await box.locator("input").check();
  await page.locator("button", { hasText: /^Charge / }).first().click();
}
/**
 * The fake's stand-in for the bank's confirmation pop-up is the browser's confirm box, which recordings can't show: answer it, then put a labelled marker on the page
 * for a moment so the video says what was answered (it is gone before any picture).
 */
function bankPopup(page, yes, before) {
  page.once("dialog", async (d) => {
    if (before) await before();
    await page.waitForTimeout(700);
    if (yes) await d.accept(); else await d.dismiss();
    await page.evaluate((y) => {
      const el = document.createElement("div");
      el.textContent = `Fake Stripe: the bank's confirmation pop-up was answered “${y ? "Confirm" : "Cancel"}”`;
      el.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:99999;background:#fde68a;color:#111;padding:8px 14px;border-radius:10px;font:600 14px system-ui;box-shadow:0 4px 18px #0008;max-width:90vw";
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 2500);
    }, yes).catch(() => {});
  });
}
/** Waits until a selector is gone (the page's own refresh, nudged). */
async function waitGone(page, selector, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!(await page.locator(selector).first().isVisible().catch(() => false))) return true;
    await tick(page);
    await page.waitForTimeout(800);
  }
  console.log("   ! waitGone: still there", selector);
  return false;
}
const bellList = (page) => page.locator("main");
/** The bell list with every stack opened, as the person reads it after clicking each one. */
async function openBell(page) {
  await page.goto("/app/notifications");
  await page.waitForTimeout(600);
  for (const b of await page.locator("[data-bell-stack] > button[aria-expanded=false]").all()) await b.click().catch(() => {});
  await page.waitForTimeout(500);
  for (const b of await page.locator("main button", { hasText: /^Show \d+ more$/ }).all()) await b.click().catch(() => {});
  await page.waitForTimeout(300);
}

group("money", async () => {
  // 1. A declined Pay → payment hold at once → an automatic retry that fails → a new card → the retry pays → the hold lifts.
  const nora = await account(`dev+media${TS}pd@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}pda@playtest.test`, "Ana Silva", "tester", "she");
  setCard(nora.email, "pm_card_declined");
  const t = await postTest(nora, { productName: "Harbor Run", title: "Harbor Run: first 3 levels", writtenCents: "10.00" });
  const sA = await join(ana, t);
  await sendWritten(ana, sA);
  const sub = subOf(sA);
  {
    const D = await rec(V, nora);
    await D.goto(`/app/tests/${t}`);
    await D.waitForSelector(`#piece-${sub}`);
    const from = at(D);
    await pause(D, 800);
    await payPiece(D, sub);
    await D.waitForURL((u) => u.pathname === "/app", { timeout: 20000 }).catch(() => {});
    await D.waitForSelector("[data-restricted-box]", { timeout: 20000 });
    await pause(D, 3500);
    finishVideo([{ file: await saveVideo(D, "money-decline.webm"), from }], "money-decline-hold",
      "Declined Pay → hold | The card is declined on Pay: a payment hold starts at once and the page moves to the dashboard top, where the blue box says the press didn't go through and how to resume");
  }
  await nora.goto("/app");
  await nora.waitForSelector("[data-restricted-box]");
  await shot(nora, "money-hold-box", "The blue box on a payment hold | The dashboard top during a payment hold: the press didn't go through, the tests are paused with testers still in them, and “Pay what you owe” opens Payments", "[data-restricted-box]");
  await ana.goto(`/app/sessions/${sA}`);
  await pause(ana, 800);
  await shotFull(ana, "money-hold-tester", "What the tester reads | Ana's page meanwhile: the test is paused and her payment may be delayed (never “hold” or “declined”)");
  await nora.goto("/app/payments");
  await nora.waitForSelector("#owed");
  await shot(nora, "money-owed", "Pay what you owe | Payments during the hold: each declined payment listed, and one button pays them all", "#owed");
  // An automatic retry (once a day during a hold) on the same card fails: no bell, just the last and next try.
  await hook("retry", nora.email);
  await nora.reload();
  await nora.waitForSelector("[data-retry-line]");
  await shot(nora, "money-retry-failed", "A retry that fails | The daily automatic retry was declined too: no bell, the box shows the last try and the next one", "#owed");
  // A new card; the next retry pays it while Payments is open: the box disappears by itself and the hold lifts.
  setCard(nora.email, "pm_card_visa");
  {
    const P = await rec(V, nora);
    await P.goto("/app/payments");
    await P.waitForSelector("#owed");
    const from = at(P);
    await pause(P, 1500);
    await hook("retry", nora.email, { now: new Date(Date.now() + 86400000).toISOString() });
    await waitGone(P, "#owed");
    await pause(P, 2000);
    await P.goto("/app");
    await pause(P, 2500);
    finishVideo([{ file: await saveVideo(P, "money-retry.webm"), from }], "money-retry-lift",
      "A retry pays, the hold lifts | With a working card the next day's retry pays what was owed: the open Payments box disappears by itself, and the dashboard is back to normal");
  }
  await openBell(nora);
  await shot(nora, "money-retry-bells", "The developer's bell | “We charged your card $10.00 for what you owed.” and “Your tests are running again”", bellList(nora));
  await openBell(ana);
  await shot(ana, "money-retry-tester-bell", "The tester's bell | Ana reads that the test paused and ran again, and that she was paid once the payment went through", bellList(ana));

  // 2. A chargeback → $10 + the $15 fee owed → paid → the platform wins it → refunded.
  const omar = await account(`dev+media${TS}pc@playtest.test`, "Omar Reyes", "developer", "he");
  const ben = await account(`tester+media${TS}pcb@playtest.test`, "Ben Okafor", "tester", "he");
  const admin = await adminAccount();
  setCard(omar.email, "pm_card_visa");
  const t2 = await postTest(omar, { productName: "Tide Tracker", title: "Tide Tracker: widgets", categories: ["Productivity"], writtenCents: "10.00" });
  const sB = await join(ben, t2);
  await sendWritten(ben, sB);
  const subB = subOf(sB);
  await apiPay(omar, subB, "10.00");
  const pi = piOf(subB);
  {
    const D = await rec(V, omar);
    await D.goto(`/app/tests/${t2}`);
    const from = at(D);
    await pause(D, 1500);
    await webhook("charge.dispute.created", { payment_intent: pi, status: "needs_response" });
    await D.waitForURL((u) => u.pathname === "/app", { timeout: 30000 }).catch(() => {});
    await D.waitForSelector("[data-restricted-box]", { timeout: 20000 }).catch(() => {});
    await pause(D, 3000);
    finishVideo([{ file: await saveVideo(D, "money-cb.webm"), from }], "money-chargeback-starts",
      "A chargeback arrives | The bank reverses a $10 payment while the test page is open: a chargeback hold starts and the page moves to the dashboard top");
  }
  await omar.goto("/app/payments");
  await omar.waitForSelector("[data-chargeback-steps]");
  await shotSpan(omar, "money-chargeback-fee", "$10 + the $15 fee | Payments: the three steps of a chargeback hold, and what is owed: “Your bank reversed a $10 payment: $10 + $15 chargeback fee”", "[data-chargeback-steps]", "#owed");
  await admin.goto(`/admin?at=${Date.now()}#chargebacks`);
  sec("Admin console");
  await shot(admin, "admin-chargeback-open", "Admin: a chargeback hold | The admin's Chargeback holds list: the reversed payment, the card check and what is owed, and Approve (faded until both are done)", admin.locator(`[data-chargeback-hold="${omar.uid}"]`));
  sec("Payments");
  // He pays what he owes ($25) on Payments.
  await omar.locator("#owed button", { hasText: /Pay what you owe/ }).click();
  await pause(omar, 2500);
  await omar.reload();
  await omar.waitForSelector("[data-chargeback-steps]");
  await shot(omar, "money-chargeback-paid", "Paid, but still on hold | $25 paid: the chargeback hold stays until the card check and the team's Approve", "[data-chargeback-steps]");
  // The platform wins the chargeback: the $25 is refunded and the hold, with nothing left owed, lifts.
  {
    const D = await rec(V, omar);
    await D.goto("/app/payments");
    const from = at(D);
    await pause(D, 1500);
    await webhook("charge.dispute.closed", { payment_intent: pi, status: "won" });
    await waitGone(D, "[data-chargeback-steps]");
    await pause(D, 1500);
    await D.locator("text=What you've paid").scrollIntoViewIfNeeded();
    await pause(D, 3000);
    finishVideo([{ file: await saveVideo(D, "money-cbwon.webm"), from }], "money-chargeback-won",
      "The chargeback is won | The platform wins the chargeback while Payments is open: the hold lifts and the $25 paid for it is refunded, shown in What you've paid");
  }
  await omar.goto("/app/payments");
  await shot(omar, "money-chargeback-refund", "The refund line | What you've paid: the repaid chargeback marked “refunded (your bank's chargeback was reversed)”", omar.locator("section", { hasText: "What you've paid" }).first());
  await openBell(omar);
  await shot(omar, "money-chargeback-bells", "Chargeback bell lines | The developer's bell from start to end: the hold, the receipt, the refund and “Your bank's chargeback of $10.00 was reversed in your favour.”", bellList(omar));
  await admin.goto(`/admin?at=${Date.now()}#chargebacks`);
  await pause(admin, 600);
  sec("Admin console");
  await shot(admin, "admin-chargeback-won", "Admin: after a won chargeback | The developer has left the Chargeback holds list", admin.locator("#chargebacks"));
  // 3. A tester's payout account needs attention (Stripe's account.updated): a banner on Payments and a bell line every 3 days until fixed.
  sec("Payments");
  own(`update "User" set "stripeAccountId" = 'acct_fake_' || id, "payoutsReady" = true where email = ${lit(ana.email)}`);
  await webhook("account.updated", { id: sql(`select "stripeAccountId" from "User" where email = ${lit(ana.email)}`), payouts_enabled: false, details_submitted: true });
  await ana.goto("/app/payments");
  await pause(ana, 800);
  await shotFull(ana, "money-payout-problem", "A payout problem | Ana's payout account needs attention: the banner on her Payments page (and a bell line every 3 days until it's fixed)");
}, { section: "Payments", fake: true });

group("cbhold", async () => {
  // A chargeback hold lifted the long way: the 3D Secure card check, paying what is owed, and the team's Approve.
  const nora = await account(`dev+media${TS}ch@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}cha@playtest.test`, "Ana Silva", "tester", "she");
  const admin = await adminAccount();
  setCard(nora.email, "pm_card_visa");
  const t = await postTest(nora, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"], writtenCents: "12.00" });
  const sA = await join(ana, t);
  await sendWritten(ana, sA);
  const sub = subOf(sA);
  await apiPay(nora, sub, "12.00");
  const cam = await account(`tester+media${TS}chc@playtest.test`, "Cam Lee", "tester", "they");
  const sC = await join(cam, t);
  await sendWritten(cam, sC);
  await apiPay(nora, subOf(sC), "12.00");
  await webhook("charge.dispute.created", { payment_intent: piOf(sub), status: "needs_response" });
  await nora.goto("/app/payments");
  await nora.waitForSelector("[data-chargeback-steps]");
  await shotSpan(nora, "cbhold-steps", "Chargeback hold: three steps | A card verified with 3D Secure, what is owed paid ($12 + the $15 fee), and the team's approval; paying alone doesn't lift it", "[data-chargeback-steps]", "#owed");
  // A second chargeback during the hold adds to what is owed (its own bell line).
  await webhook("charge.dispute.created", { payment_intent: piOf(subOf(sC)), status: "needs_response" });
  await nora.reload();
  await nora.waitForSelector("#owed");
  await shot(nora, "cbhold-second", "A second chargeback | During the hold, another reversed payment is added: two lines of $12 + $15", "#owed");
  const D = await rec(V, nora), A = await rec(V, admin);
  await D.goto("/app/payments");
  await A.goto(`/admin?at=${Date.now()}#chargebacks`);
  const fromD = at(D), fromA = at(A);
  await pause(D, 1200);
  await D.locator("[data-chargeback-steps] button", { hasText: "Verify a card" }).click(); // (simulated in the fake: verified at once)
  await D.waitForSelector("[data-step-ok=yes]", { timeout: 15000 }).catch(() => {});
  await pause(D, 1500);
  await D.locator("#owed button", { hasText: /Pay what you owe/ }).click();
  await pause(D, 2500);
  await D.reload();
  await pause(D, 1500);
  await A.reload();
  const row = A.locator(`[data-chargeback-hold="${nora.uid}"]`);
  await row.scrollIntoViewIfNeeded();
  await pause(A, 1200);
  sec("Admin console");
  await shot(A, "cbhold-admin-ready", "Admin: ready to approve | Card verified ✓ and owed paid ✓: Approve is now available", row);
  sec("Payments");
  await row.locator("button", { hasText: "Approve" }).click();
  await A.waitForSelector("text=Done.", { timeout: 10000 }).catch(() => {});
  await pause(A, 1500);
  await D.goto("/app");
  await pause(D, 3000);
  finishVideo([{ file: await saveVideo(D, "cbhold-d.webm"), from: fromD }, { file: await saveVideo(A, "cbhold-a.webm"), from: fromA }], "cbhold-lift",
    "Card check, pay, Approve | The developer (left) verifies a card and pays what is owed; the admin (right) approves; the hold lifts and the dashboard is back to normal");
  await openBell(nora);
  await shot(nora, "cbhold-bells", "Bell lines | The chargeback hold, the receipts and “Your tests are running again”", bellList(nora));
  await openBell(ana);
  await shot(ana, "cbhold-tester-bell", "The tester's side | Ana reads that the test paused and ran again, never “chargeback” or “hold”", bellList(ana));
}, { section: "Payments", fake: true });

group("bank", async () => {
  // "Your bank wants to confirm this payment" (Stripe's requires_action): never a decline.
  const nora = await account(`dev+media${TS}bk@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}bka@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}bkb@playtest.test`, "Ben Okafor", "tester", "he");
  const cam = await account(`tester+media${TS}bkc@playtest.test`, "Cam Lee", "tester", "they");
  setCard(nora.email, "pm_card_authenticationRequired");
  const t = await postTest(nora, { productName: "Kelp Forest", title: "Kelp Forest: iPhone beta", writtenCents: "10.00", spots: "5" });
  const sA = await join(ana, t), sB = await join(ben, t), sC = await join(cam, t);
  for (const [p, s] of [[ana, sA], [ben, sB], [cam, sC]]) await sendWritten(p, s);
  const subA = subOf(sA);
  // 1. Her own press: the bank's pop-up. Cancelled: nothing charged, no hold. Confirmed: paid.
  {
    const D = await rec(V, nora);
    await D.goto(`/app/tests/${t}`);
    await D.waitForSelector(`#piece-${subA}`);
    const from = at(D);
    await pause(D, 800);
    bankPopup(D, false);
    await payPiece(D, subA);
    await D.waitForSelector(`#piece-${subA} [data-bank-not-confirmed]`, { timeout: 15000 });
    await pause(D, 2800);
    await shot(D, "bank-press-cancelled", "Not confirmed: nothing charged | The bank's pop-up was cancelled: “Your bank didn't confirm the payment, so nothing was charged.” No hold", D.locator(`#piece-${subA}`));
    bankPopup(D, true);
    await payPiece(D, subA);
    await pause(D, 4000);
    finishVideo([{ file: await saveVideo(D, "bank-press.webm"), from }], "bank-press",
      "Pay with a bank check | Nora presses Pay and her bank asks her to confirm: cancelled, nothing is charged; pressed again and confirmed, Ana is paid");
  }
  // 2. Made while she's away: Ben charges after the review window; the payment waits for her Confirm in Payments.
  openCharge(sB, t);
  await chargeUI(ben, sB);
  await ben.waitForSelector("text=/may be delayed/i", { timeout: 15000 });
  await pause(ben, 800);
  await shot(ben, "bank-away-tester", "The tester's side | Ben charged for his unreviewed answers: “Charged $10.00. Payment may be delayed.”", ben.locator("#part-written"));
  await openBell(nora);
  await shot(nora, "bank-away-bell", "Confirm it in Payments | Nora's bell (also emailed, even with email Off): “Your bank wants you to confirm a $10.00 payment. Confirm it in Payments by <date>.”", bellList(nora));
  await nora.goto("/app/payments");
  await nora.waitForSelector("[data-confirm-list]");
  await shot(nora, "bank-confirm-list", "The Confirm button | Payments lists the payment waiting for her bank, with Confirm", "[data-confirm-list]");
  bankPopup(nora, true);
  await nora.locator("[data-confirm-list] button", { hasText: "Confirm" }).first().click();
  await waitGone(nora, "[data-confirm-list]", 15000);
  await pause(nora, 1200);
  await shot(nora, "bank-confirmed", "Confirmed | After Confirm the list is gone and the payment shows in What you've paid", nora.locator("section", { hasText: "What you've paid" }).first());
  // 3. The lock: while Nora's bank pop-up for Cam's answers is open, Cam's Charge is refused.
  openCharge(sC, t);
  const subC = subOf(sC);
  await nora.goto(`/app/tests/${t}`);
  await nora.waitForSelector(`#piece-${subC}`);
  bankPopup(nora, true, async () => {
    await chargeUI(cam, sC);
    await cam.waitForSelector("text=A payment for this is being confirmed right now.", { timeout: 10000 });
    await shot(cam, "bank-locked", "Locked while the bank confirms | Cam presses Charge while Nora's bank pop-up for the same answers is open: “A payment for this is being confirmed right now.”", cam.locator("#part-written"));
  });
  await payPiece(nora, subC);
  await pause(nora, 3000);
}, { section: "Payments", fake: true });

group("plans", async () => {
  // The free plan and the $7/month subscription. The second server's FREE_UNTIL is in the past, so free-during-launch is over there.
  const nora = await account(`dev+media${TS}sb@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}sba@playtest.test`, "Ana Silva", "tester", "she");
  setCard(nora.email, "pm_card_visa");
  // Free during launch, as the owner's server runs today (FREE_UNTIL unset: free with no end).
  await nora.goto(`${MAIN}/app/payments`);
  await nora.waitForSelector("#subscription");
  await shot(nora, "plans-free-launch", "Free during launch | With FREE_UNTIL unset (today's setting) Payments says everything is included, with nothing to subscribe to yet", "#subscription");
  await nora.goto("/app/payments");
  await nora.waitForSelector("#subscription");
  await shot(nora, "plans-free-plan", "The free plan | After the free launch: one open test at a time, the perks a subscription adds, and Subscribe for $7/month", "#subscription");
  const t = await postTest(nora, { productName: "Harbor Run", title: "Harbor Run: first 3 levels" });
  await join(ana, t);
  // A second open test on the free plan.
  await nora.goto("/app/tests/new");
  await nora.waitForSelector("#productName");
  await nora.fill("#productName", "Sky Lab");
  await nora.fill("#title", "Sky Lab: tutorial");
  await nora.fill("#description", "Play the tutorial and answer two questions.");
  await nora.locator("#writtenPrice").fill("8.00");
  await nora.fill("#questions", "What did you like?");
  await nora.locator("#spots").fill("4");
  await nora.locator("#openUntil").fill(day(14));
  await nora.click("button:has-text('Post the test')");
  await nora.waitForSelector("text=/You already have an open test/");
  await pause(nora, 600);
  await shotSpan(nora, "plans-second-test", "A second open test | Post is refused under the button: “You already have an open test. Subscribe ($7/month) to run several at once.” The form keeps what was typed", "button:has-text('Post the test')", nora.locator("text=/You already have an open test/").last(), 16, 16);
  // Perk buttons stay visible with a "Subscribers" tag; a press is refused naming the perk.
  await nora.goto(`/app/tests/${t}`);
  await nora.waitForSelector("[data-subscribers-tag]");
  await nora.click("button:has-text('Next round')");
  await nora.click("text=Start the next round");
  await nora.waitForSelector("text=/Next round needs a subscription/");
  await pause(nora, 600);
  await shot(nora, "plans-perk-refused", "Perks on the free plan | Next round and Invite testers carry a “Subscribers” tag; a press is refused: “Next round needs a subscription ($7/month).”", testPanel(nora));
  // Subscribe, cancel, keep.
  await nora.goto("/app/payments");
  await nora.locator("#subscription button", { hasText: "Subscribe for" }).click();
  await nora.waitForSelector("[data-subscription=active]", { timeout: 15000 }).catch(async () => { await nora.reload(); });
  await nora.waitForSelector("[data-subscription=active]");
  await shot(nora, "plans-subscribed", "Subscribed | Active since today, renews in a month, with Cancel subscription", "#subscription");
  await nora.locator("#subscription button", { hasText: "Cancel subscription" }).click();
  await nora.waitForSelector("[data-subscription=cancelled]", { timeout: 15000 }).catch(async () => { await nora.reload(); });
  await nora.waitForSelector("[data-subscription=cancelled]");
  await shot(nora, "plans-cancelled", "Cancelled | The perks last until the end of the paid month; Keep my subscription undoes it", "#subscription");
  await nora.locator("#subscription button", { hasText: "Keep my subscription" }).click();
  await nora.waitForSelector("[data-subscription=active]", { timeout: 15000 }).catch(async () => { await nora.reload(); });
  // A renewal is declined (past due, perks continue, a notice even with email Off), then the last retry fails: it lapses, with no hold.
  setCard(nora.email, "pm_card_declined");
  own(`update "User" set "subscriptionRenewsAt" = (now() at time zone 'utc') - interval '1 hour' where email = ${lit(nora.email)}`);
  await hook("renew", nora.email);
  await nora.goto("/app/payments");
  await nora.waitForSelector("[data-subscription=past_due]");
  await shot(nora, "plans-past-due", "A declined renewal | “Your $7 subscription payment didn't go through. Update your card by <date> to keep it.” The perks continue meanwhile", "#subscription");
  {
    const D = await rec(V, nora);
    await D.goto(`/app/tests/${t}`);
    const from = at(D);
    await pause(D, 1500);
    own(`update "User" set "subscriptionPastDueAt" = (now() at time zone 'utc') - interval '8 days' where email = ${lit(nora.email)}`);
    await hook("renew", nora.email);
    await waitLive(D, "[data-live-top]:has-text('Your subscription ended')");
    await pause(D, 2500);
    await shot(D, "plans-lapsed-live", "The open page is told | The subscription lapsed while the test page was open: “Your subscription ended.” in the live box (a press would stop once for it)", "[data-live-top]");
    finishVideo([{ file: await saveVideo(D, "plans-lapse.webm"), from }], "plans-lapse",
      "The subscription lapses | The last retry fails while the test page is open: the live box says “Your subscription ended.” The running test carries on; only new uses of a perk are refused");
  }
  await nora.goto("/app/payments");
  await nora.waitForSelector("[data-subscription=lapsed]");
  await shot(nora, "plans-lapsed", "Lapsed | Back on the free plan: “Your subscription ended because the payment didn't go through.” and Subscribe again", "#subscription");
  await openBell(nora);
  await shot(nora, "plans-bells", "Subscription bell lines | Subscribed, cancelled, the declined renewal and the lapse (the last two also emailed with email Off)", bellList(nora));
}, { section: "Payments", fake: true });

// ---------- Outages ----------
group("outage", async () => {
  // The second server runs with OUTAGE_CHECKS=1: only the outside checker's keyed /api/health ping writes heartbeats, and a gap over 15 minutes is an outage.
  // A real outage moves EVERY running clock in the database and tells everyone with something running (as in the app), so this group is the one that touches
  // more than its own rows: 20 minutes later for every deadline, Open until and review clock, and one bell line each.
  const nora = await account(`dev+media${TS}og@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}oga@playtest.test`, "Ana Silva", "tester", "she");
  const admin = await adminAccount();
  const t = await postTest(nora, { productName: "Harbor Run", title: "Harbor Run: first 3 levels", liveRateCents: "30.00" });
  const sA = await join(ana, t);
  const call = await bookCall(nora, ana, t, sA, 3);
  // The admin runs a test too, so their own bell shows what everyone affected reads.
  const at2 = await postTest(admin, { productName: "Team demo", title: "Team demo: onboarding" });
  const ben = await account(`tester+media${TS}ogb@playtest.test`, "Ben Okafor", "tester", "he");
  await join(ben, at2);
  // Before: the call is booked and starts 10 minutes ago (inside the outage to come).
  own(`update "Call" set "startsAt" = (now() at time zone 'utc') - interval '10 minutes' where id = '${call}'`);
  const before = sql(`select to_char("openUntil", 'YYYY-MM-DD HH24:MI') || ' / ' || (select to_char("dueAt", 'YYYY-MM-DD HH24:MI') from "Contract" where id = '${sA}') from "Test" where id = '${t}'`);
  await nora.goto(`/app/tests/${t}`);
  await nora.locator("#calls").scrollIntoViewIfNeeded().catch(() => {});
  await shot(nora, "outage-before-dev", "Before: the developer's call | A call with Ana booked at the time the site is about to be found down", liveSession(nora));
  const D = await rec(V, nora), T = await rec(V, ana);
  await D.goto(`/app/tests/${t}`);
  await T.goto(`/app/sessions/${sA}`);
  const fromD = at(D), fromT = at(T);
  await pause(D, 1500);
  // The last heartbeat was 20 minutes ago; the checker's next ping finds the gap.
  sql(`delete from "Heartbeat" where "at" > (now() at time zone 'utc') - interval '25 minutes'`);
  sql(`insert into "Heartbeat" (id, "at") values ('media' || md5(random()::text), (now() at time zone 'utc') - interval '20 minutes')`);
  const h = await fetch(`${BASE}/api/health?key=${HEALTH_KEY}`).then((r) => r.json());
  if (!h.ok) throw new Error("health check failed");
  await Promise.all([waitLive(D, "[data-live-top]:has-text('The site was down')"), waitLive(T, "[data-live-top]:has-text('The site was down')")]);
  await pause(D, 3000);
  await shot(D, "outage-live-dev", "After: the developer's page | The live box: “The site was down from <a> to <b>. Deadlines and payment dates moved 20 min later.”", "[data-live-top]");
  await shot(T, "outage-live-tester", "After: the tester's page | Ana's session page says the same in its live box", "[data-live-top]");
  finishVideo([{ file: await saveVideo(D, "outage-d.webm"), from: fromD }, { file: await saveVideo(T, "outage-t.webm"), from: fromT }], "outage-live",
    "An outage is found | The developer's test page (left) and the tester's session page (right) are open when the health check finds a 20-minute gap: both say the site was down and every clock moved later");
  const after = sql(`select to_char("openUntil", 'YYYY-MM-DD HH24:MI') || ' / ' || (select to_char("dueAt", 'YYYY-MM-DD HH24:MI') from "Contract" where id = '${sA}') from "Test" where id = '${t}'`);
  console.log(`   outage: Open until / Ana's deadline (UTC) before ${before}, after ${after}`);
  await nora.goto(`/app/tests/${t}`);
  await nora.locator("#calls").scrollIntoViewIfNeeded().catch(() => {});
  await shot(nora, "outage-after-dev", "After: the call | The call inside the outage is cancelled “missed because the site was down”: never a no-show, nothing charged", liveSession(nora));
  await ana.goto(`/app/sessions/${sA}`);
  await pause(ana, 800);
  await shotFull(ana, "outage-after-tester", `After: the tester's page | Ana's call reads as missed because the site was down; her deadline moved 20 minutes later (UTC before / after: ${before.split(" / ")[1]} → ${after.split(" / ")[1]})`);
  await openBell(nora);
  await shot(nora, "outage-bell-dev", "The developer's bell | The outage line (its own line) and the missed call", bellList(nora));
  await openBell(ana);
  await shot(ana, "outage-bell-tester", "The tester's bell | The same two lines for Ana", bellList(ana));
  await openBell(admin);
  await shot(admin, "outage-bell-admin", "The admin's view | Admins have no outage page (not built, per the guide): an admin who runs a test gets the same bell line as everyone affected", bellList(admin));
}, { section: "Outages", fake: true, optIn: true });

// ---------- Account states: holds, suspensions, deletion ----------
group("holds", async () => {
  const nora = await account(`dev+media${TS}hs@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}hsa@playtest.test`, "Ana Silva", "tester", "she");
  const cam = await account(`tester+media${TS}hsc@playtest.test`, "Cam Lee", "tester", "they");
  const admin = await adminAccount();
  setCard(nora.email, "pm_card_declined");
  const t = await postTest(nora, { productName: "Glow Garden", title: "Glow Garden: night levels", writtenCents: "9.00", spots: "4" });
  const sA = await join(ana, t), sC = await join(cam, t);
  await sendWritten(ana, sA);
  // 1. The team suspends the developer while the test page and Messages are open: both move to the dashboard top, live.
  {
    const a = await rec(V, nora), b = await rec(V, nora);
    await a.goto(`/app/tests/${t}`);
    await b.goto("/app/messages");
    const fromA = at(a), fromB = at(b);
    await pause(a, 2000);
    await adminDo(admin, "suspend", nora.uid, { note: "Media pass check: reports from testers" });
    await Promise.all([a.waitForURL((u) => u.pathname === "/app", { timeout: 30000 }), b.waitForURL((u) => u.pathname === "/app", { timeout: 30000 })]);
    await a.waitForSelector("[data-restricted-box]");
    await pause(a, 2000);
    // A closed page typed in: Post a test sends them back to the top too.
    await b.goto("/app/tests/new");
    await b.waitForURL((u) => u.pathname === "/app", { timeout: 15000 }).catch(() => {});
    await pause(b, 2500);
    finishVideo([{ file: await saveVideo(a, "holds-sus-a.webm"), from: fromA }, { file: await saveVideo(b, "holds-sus-b.webm"), from: fromB }], "holds-suspend-routing",
      "Suspended while pages are open | The team suspends the developer while the test page (left) and Messages (right) are open: both move to the dashboard top; Post a test, typed in afterwards, is closed too");
  }
  await nora.goto("/app");
  await shot(nora, "holds-suspended-box", "The blue box: suspended | All tests paused with testers still in them, what stays open, and how to appeal through Contact us", "[data-restricted-box]");
  await nora.goto("/app/account");
  await pause(nora, 600);
  await shotFull(nora, "holds-settings-open", "Settings stays open | A suspended account keeps Settings (Contact us, email, delete account); the profile editor is hidden");
  await ana.goto(`/app/sessions/${sA}`);
  await pause(ana, 800);
  await shot(ana, "holds-tester-banner", "The tester's side | Ana's session page: the blue paused banner lists only what still works (never “suspended”)", ana.locator("main .info").first());
  // 2. A declined charge during the suspension adds a payment hold; paying it doesn't lift the suspension.
  openCharge(sA, t);
  await chargeUI(ana, sA);
  await pause(ana, 1500);
  await nora.goto("/app");
  await nora.waitForSelector("[data-restricted-why=hold]");
  await shot(nora, "holds-both", "Suspended and on hold | Ana's Charge was declined during the suspension: the same blue box now also says how to pay what is owed", "[data-restricted-box]");
  setCard(nora.email, "pm_card_visa");
  await nora.goto("/app/payments");
  await nora.locator("#owed button", { hasText: /Pay what you owe/ }).click();
  await pause(nora, 2500);
  await openBell(nora);
  await shot(nora, "holds-paid-still-suspended", "Paid, still suspended | “Your payment went through. Your tests stay paused while your account is suspended.” instead of “running again”", bellList(nora));
  // 3. The team lifts the suspension.
  await adminDo(admin, "unsuspend", nora.uid);
  await nora.goto("/app");
  await nora.waitForSelector("[data-reinstated-box]");
  await shotSpan(nora, "holds-reinstated", "Active again | The dashboard top after the team lifts the suspension: “Your account is active again”, and the tests run again", "[data-reinstated-box]", "[data-test-card]");
  // 4. A suspended tester: their session page moves to the dashboard top; after reinstatement the test waits with Ask to rejoin.
  {
    const T = await rec(V, cam);
    await T.goto(`/app/sessions/${sC}`);
    const from = at(T);
    await pause(T, 1500);
    await adminDo(admin, "suspend", cam.uid, { note: "Media pass check: copied answers" });
    await T.waitForURL((u) => u.pathname === "/app", { timeout: 30000 });
    await T.waitForSelector("[data-restricted-box]");
    await pause(T, 3000);
    await shotFull(T, "holds-tester-suspended", "A suspended tester | Cam's dashboard: removed from their tests, pay for accepted work still reaches Stripe, how to appeal, and the tests they were removed from");
    finishVideo([{ file: await saveVideo(T, "holds-tester.webm"), from }], "holds-tester-routing", "A tester is suspended | Cam's session page moves to the dashboard top, where the blue box explains");
  }
  await adminDo(admin, "unsuspend", cam.uid);
  await cam.goto("/app");
  await cam.waitForSelector("[data-removed]");
  await shot(cam, "holds-tester-reinstated", "Tester active again | The test Cam was removed from waits with “You were removed from this test” and Ask to rejoin", "[data-removed]");
  // 5. A developer deletes their account: work under review can't be paid; a part already open to Charge stays chargeable.
  const omar = await account(`dev+media${TS}hd@playtest.test`, "Omar Reyes", "developer", "he");
  const ben = await account(`tester+media${TS}hdb@playtest.test`, "Ben Okafor", "tester", "he");
  const dee = await account(`tester+media${TS}hdd@playtest.test`, "Dee Moss", "tester", "they");
  setCard(omar.email, "pm_card_visa");
  const t2 = await postTest(omar, { productName: "Tide Tracker", title: "Tide Tracker: widgets", categories: ["Productivity"], writtenCents: "7.00" });
  const sB = await join(ben, t2), sD = await join(dee, t2);
  await sendWritten(ben, sB);
  await sendWritten(dee, sD);
  openCharge(sD, t2);
  ok(await post(omar, "/api/account/delete", { confirmed: true }), "delete account");
  await ben.goto(`/app/sessions/${sB}`);
  await pause(ben, 800);
  await shot(ben, "holds-dev-deleted-review", "The developer deleted their account | Ben's answers were still under review: “Omar Reyes deleted their account, so this can't be paid.”", ben.locator("#part-written"));
  await dee.goto(`/app/sessions/${sD}`);
  await pause(dee, 800);
  await shot(dee, "holds-dev-deleted-charge", "Charge stays open | Dee's part was already open to Charge before the deletion: she can still charge or let it go", dee.locator("#part-written"));
}, { section: "Account states (holds, suspensions, deletion)", fake: true });

// ---------- Alerts: an update type that no longer stops a press ----------
group("alerts", async () => {
  const nora = await account(`dev+media${TS}al@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}ala@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}alb@playtest.test`, "Ben Okafor", "tester", "he");
  const cam = await account(`tester+media${TS}alc@playtest.test`, "Cam Lee", "tester", "they");
  const t = await postTest(nora, { productName: "Harbor Run", title: "Harbor Run: first 3 levels", writtenCents: "10.00", spots: "5" });
  const sA = await join(ana, t), sB = await join(ben, t), sC = await join(cam, t);
  await sendWritten(ana, sA);
  await sendWritten(cam, sC);
  const subA = subOf(sA), subC = subOf(sC);
  // Before: "Work sent" stops a press. Ben sends while the page is open; Pay for Ana stops once and lists it.
  {
    const D = await rec(V, nora);
    await D.goto(`/app/tests/${t}`);
    await D.waitForSelector(`#piece-${subA}`);
    const from = at(D);
    await pause(D, 800);
    await sendWritten(ben, sB, ["Smooth sailing.", "The fog level was too dark."]);
    await payPiece(D, subA);
    await D.waitForSelector(`#piece-${subA} >> text=/again/`, { timeout: 15000 });
    await pause(D, 2000);
    await shot(D, "alerts-before", "Before: Work sent stops Pay | Ben sent his answers after the page loaded: Pay stops once and lists it under the button", D.locator(`#piece-${subA}`));
    // Tick "Work sent" in Alerts.
    await D.evaluate(() => window.scrollTo(0, 0));
    await D.click("[data-alerts-menu] > summary");
    await pause(D, 600);
    await D.locator("[data-alerts-menu] label", { hasText: "Work sent" }).locator("input").check();
    await D.waitForSelector("[data-alerts-menu] >> text=Saved.");
    await pause(D, 1200);
    await shotSpan(D, "alerts-menu-ticked", "Alerts: Work sent ticked | Ticked types no longer stop your buttons; they still show, greyed, in the live box", testPanel(D), D.locator("[data-alerts-menu] > div"), 12, 16);
    await D.click("[data-alerts-menu] > summary");
    // After: Dee joins and sends; Pay for Cam goes straight through.
    const dee = await account(`tester+media${TS}ald@playtest.test`, "Dee Moss", "tester", "they");
    const sD = await join(dee, t);
    await D.reload();
    await D.waitForSelector(`#piece-${subC}`);
    await pause(D, 800);
    await sendWritten(dee, sD, ["Loved the music.", "Nowhere."]);
    await payPiece(D, subC);
    await pause(D, 3000);
    await shot(D, "alerts-after", "After: no stop | Dee sent her answers after the page loaded, but Work sent is ticked: Pay for Cam went straight through", D.locator("#testers-joined [data-tester-rows] > *", { hasText: "Cam Lee" }).first());
    // The line itself still shows in the live box, greyed.
    const eli = await account(`tester+media${TS}ale@playtest.test`, "Eli Novak", "tester", "he");
    const sE = await join(eli, t);
    await D.reload();
    await pause(D, 800);
    await sendWritten(eli, sE, ["The ships look great.", "The harbor map."]);
    await waitLive(D, "[data-live-top]");
    await pause(D, 1500);
    await shot(D, "alerts-greyed", "Still listed, greyed | A ticked type still shows in the live box, greyed (“You turned these stops off in Alerts” on hover)", "[data-live-top]");
    finishVideo([{ file: await saveVideo(D, "alerts.webm"), from }], "alerts-flow",
      "Alerts stop one kind of stop | With Work sent on, a tester's new answers stop Pay once; after ticking it in Alerts, the next Pay goes straight through and the line shows greyed");
  }
}, { section: "Developer test page" });

// ---------- Excerpt requests (batch 13) ----------
const ANSWERS = ["The boat handling feels great: tight turns, and the wake looks lovely at night.", "The second bridge: I couldn't tell where to go."];
/** A test with this tester in it, their written answers sent and paid (on the main server payments aren't set up: recorded as paid). */
async function paidPart(dev, tester, over) {
  const t = await postTest(dev, over);
  const s = await join(tester, t);
  await sendWritten(tester, s, ANSWERS);
  const sub = subOf(s);
  await apiPay(dev, sub, over.writtenCents || "10.00");
  return { t, s, sub };
}
const askExcerpt = (tester, sub, text, hideProduct = true) => post(tester, "/api/excerpts", { action: "request", submissionId: sub, index: ANSWERS.findIndex((a) => a.includes(text)), text, hideProduct });
const excerptId = (sub) => sql(`select id from "Excerpt" where "submissionId" = '${sub}' order by "createdAt" desc limit 1`);
const decide = (dev, sub, decision) => post(dev, "/api/excerpts", { action: "decide", excerptId: excerptId(sub), decision }).then((r) => ok(r, "decide excerpt"));

group("excerpts", async () => {
  const nora = await account(`dev+media${TS}ex@playtest.test`, "Nora Lane", "developer", "she");
  const omar = await account(`dev+media${TS}exo@playtest.test`, "Omar Reyes", "developer", "he");
  const ana = await account(`tester+media${TS}exa@playtest.test`, "Ana Silva", "tester", "she");
  const p1 = await paidPart(nora, ana, { productName: "Harbor Run", title: "Harbor Run: first 3 levels" });
  const p2 = await paidPart(nora, ana, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"] });
  const p3 = await paidPart(nora, ana, { productName: "Pocket Chef", title: "Pocket Chef: recipe search", categories: ["Shopping"] });
  const p4 = await paidPart(omar, ana, { productName: "Tide Tracker", title: "Tide Tracker: widgets", categories: ["Productivity"] });
  // 1. Ana asks from her session page: pick an answer, trim it, "Don't name the product" ticked by default.
  {
    const T = await rec(V, ana);
    await T.goto(`/app/sessions/${p1.s}`);
    const pick = T.locator("[data-excerpt-picker]");
    await pick.scrollIntoViewIfNeeded();
    const from = at(T);
    await pause(T, 800);
    await pick.locator("button", { hasText: "Show an excerpt on your profile" }).click();
    await pause(T, 600);
    await pick.locator("input[type=radio]").first().check();
    await T.locator(`#excerpt-text-${p1.sub}`).fill("tight turns, and the wake looks lovely at night.");
    await pause(T, 1200);
    await shot(T, "excerpt-picker", "The picker | Ana picks one paid answer and trims it (10 to 500 characters); “Don't name the product” is ticked by default", pick);
    await pick.locator("button", { hasText: "Ask the developer" }).click();
    await T.waitForSelector("[data-excerpt-pending]");
    await pause(T, 2000);
    finishVideo([{ file: await saveVideo(T, "excerpt-ask.webm"), from }], "excerpt-ask", "Asking for an excerpt | Ana opens the picker on a paid written part, trims her answer and asks Nora");
  }
  ok(await askExcerpt(ana, p2.sub, "The second bridge: I couldn't tell where to go."), "ask 2");
  ok(await askExcerpt(ana, p3.sub, "The boat handling feels great: tight turns", false), "ask 3");
  // 2. Nora's Needs you: one item per request with Allow and Deny (never a stop-once).
  await nora.goto(`/app/tests/${p3.t}`);
  await nora.waitForSelector("[data-excerpt-request]");
  sec("Developer test page");
  await shot(nora, "excerpt-needs-you", "Excerpt request in Needs you | The quote, whether it names the product, and Allow or Deny", "[data-excerpt-request]");
  await nora.locator("[data-excerpt-request] button", { hasText: "Allow" }).click();
  await pause(nora, 1500);
  await decide(nora, p1.sub, "allow");
  await decide(nora, p2.sub, "deny");
  ok(await askExcerpt(ana, p4.sub, "the wake looks lovely at night"), "ask 4");
  // Shown excerpts are on the hover card (up to 3) and in the tester's row, where the developer can take one down.
  await nora.goto(`/app/tests/${p3.t}`);
  await nora.waitForSelector("#testers-joined");
  await shot(nora, "excerpt-hover", "On the hover card | Ana's shown excerpts on her hover card", "#testers-joined", async () => {
    await nora.locator("#testers-joined a[aria-label='Ana Silva: profile']").first().hover();
    await pause(nora, 800);
  });
  await shot(nora, "excerpt-row", "In the tester's row | The excerpt shown from this test, with Take down", nora.locator("[data-shown-excerpt]").first());
  sec("Tester session page");
  await nora.goto(`/app/testers/${ana.uid}`);
  await pause(nora, 800);
  await shot(nora, "excerpt-profile", "On Ana's profile | Shown excerpts as plain quotes; the one that names the product says so", nora.locator("[data-shown-excerpts]"));
  // Take down from the row: Ana is told.
  await nora.goto(`/app/tests/${p3.t}`);
  await nora.locator("[data-shown-excerpt] button", { hasText: "Take down" }).first().click();
  await nora.locator("dialog[open] button", { hasText: /Take down/ }).click();
  await pause(nora, 1500);
  // 3. Several requests and the limit of 3 shown or pending: the 4th is refused.
  const p5 = await paidPart(nora, ana, { productName: "Night Market", title: "Night Market demo" });
  const p6 = await paidPart(nora, ana, { productName: "Coral Quest", title: "Coral Quest: boss fight" });
  ok(await askExcerpt(ana, p5.sub, "The second bridge: I couldn't tell where to go."), "ask 5");
  await ana.goto(`/app/sessions/${p6.s}`);
  const pick6 = ana.locator("[data-excerpt-picker]");
  await pick6.locator("button", { hasText: "Show an excerpt on your profile" }).click();
  await pick6.locator("input[type=radio]").first().check();
  await ana.locator(`#excerpt-text-${p6.sub}`).fill("The boat handling feels great");
  await pick6.locator("button", { hasText: "Ask the developer" }).click();
  await ana.waitForSelector("text=/at most 3 excerpts/");
  await pause(ana, 600);
  await shot(ana, "excerpt-limit", "At most 3 | A 4th request while 3 are shown or pending: “You can show at most 3 excerpts. Remove one first.”", pick6);
  // 4. The NDA case: an NDA added later hides the test's excerpts and requests; a press from an older page is refused.
  await ana.goto(`/app/sessions/${p6.s}`);
  await pick6.locator("button", { hasText: "Show an excerpt on your profile" }).click();
  await pick6.locator("input[type=radio]").first().check();
  await ana.locator(`#excerpt-text-${p6.sub}`).fill("The boat handling feels great");
  // Ana removes one from Settings to make room… then Nora adds an NDA to that test before she presses.
  ok(await post(ana, "/api/excerpts", { action: "remove", excerptId: excerptId(p5.sub) }), "remove");
  await apiEdit(nora, p6.t, { ndaText: "Don't share screenshots or details of the boss fight before launch." });
  await apiEdit(nora, p1.t, { ndaText: "Don't share screenshots of the beta." });
  await pick6.locator("button", { hasText: "Ask the developer" }).click();
  await ana.waitForSelector("text=/now has an NDA/");
  await pause(ana, 600);
  await shot(ana, "excerpt-nda-refused", "An NDA added meanwhile | Ana's page loaded before the NDA: her press is refused, “This test now has an NDA, so its work can't be shown as an excerpt.”", pick6);
  await ana.goto("/app/account");
  await ana.waitForSelector("#excerpts");
  await shot(ana, "excerpt-settings", "Ana's list in Settings | Pending, shown and denied excerpts with Remove; the one from a test that now has an NDA reads “Hidden while … has an NDA”", "#excerpts");
  await openBell(ana);
  await shot(ana, "excerpt-bells", "Decisions as bell lines | “Your excerpt from … is now on your profile.”, “Nora Lane prefers that work from … isn't shown on profiles.” and “Nora Lane took down the excerpt from …”", bellList(ana));
  // 5. A restricted developer: their test pages are closed, so pending requests wait in a box at the dashboard top, with Allow and Deny.
  hold(omar.email);
  await omar.goto("/app");
  await omar.waitForSelector("[data-excerpt-box]");
  sec("Developer dashboard");
  await shotSpan(omar, "excerpt-restricted-box", "Restricted developer: the excerpt box | Omar is on a payment hold: his test pages are closed, so Ana's request waits under the blue box with Allow and Deny", "[data-restricted-box]", "[data-excerpt-box]");
  await omar.locator("[data-excerpt-box] button", { hasText: "Allow" }).click();
  await pause(omar, 1500);
}, { section: "Tester session page" });

// ---------- Long text (batch 13 section 9; batch 14 section 5) ----------
/** Plain sentences repeated to exactly n characters (ending on a full stop). */
function textOf(n, sentences) {
  let s = "";
  for (let i = 0; s.length < n; i++) s += (s ? " " : "") + sentences[i % sentences.length];
  s = s.slice(0, n - 1).trimEnd();
  return s + ".".repeat(n - s.length);
}
const NDA_SENTENCES = ["You agree not to share the build, screenshots, recordings or anything you saw in this test with anyone outside Playtest.", "This covers social media, forums, chats and friends.", "You may describe your feedback to the developer through Playtest only.", "Confidential information stays confidential for two years after the test ends, or until the developer makes it public.", "If you are unsure whether something is confidential, ask the developer in chat before sharing it."];
const STEP_SENTENCES = ["Install the build from the link and sign in with a new account.", "Play the first three harbors without skipping the tutorial.", "Try every boat at least once and switch between them in the dock.", "Open the map from the pause menu and find the lighthouse.", "Note anything that feels slow, confusing or unfair, with the time it happened.", "When you finish, answer the questions below in as much detail as you can."];
const longQuestion = (i) => textOf(300, [`Question ${i + 1}: in harbor ${(i % 3) + 1}, think about the moment you first tried the ${["sail", "anchor", "map", "dock", "lantern"][i % 5]} controls.`, "What did you expect to happen, what actually happened, and how long did it take you to understand it?", "Please describe it step by step, mentioning anything on screen that helped or got in the way."]);
/** A formatted written answer (bold, italic and a code block), about n characters. */
function formattedAnswer(n) {
  const block = ["**Harbor 1.** The *tutorial* is clear, but the sail toggle hides behind the map button on small screens.", "```\nsteps: open map -> close map -> tap sail (twice)\nresult: the boat turns left instead of raising the sail\n```", "*Harbor 2* felt **much** better: the dock prompt shows at the right time, and the wake effect is lovely at night.", "One more thing: the lighthouse icon on the map is the same colour as the water, so I missed it twice."].join("\n\n");
  let s = "";
  while (s.length + block.length + 2 < n) s += (s ? "\n\n" : "") + block;
  return s;
}
/** A light account for crowds: signed up, confirmed and given a tester profile, with no page (API calls only). */
async function lightTester(email, name) {
  const c = await browser.newContext({ baseURL: BASE });
  const p = { context: () => c, email, name };
  const r = await post(p, "/api/auth/signup", { email, password: PASSWORD, role: "tester", name, acceptTerms: true });
  if (!r.ok) throw new Error("sign-up failed for " + email);
  own(`update "User" set "emailVerifiedAt" = (now() at time zone 'utc') where email = ${lit(email)}`);
  await post(p, "/api/profile", { name, pronoun: "they", isDeveloper: false, isTester: true, devices: ["Windows PC"], languages: ["English"], categories: [] });
  p.uid = userId(email);
  return p;
}

group("long", async () => {
  const nora = await account(`dev+media${TS}lg@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}lga@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}lgb@playtest.test`, "Ben Okafor", "tester", "he");
  const nda = textOf(1000, NDA_SENTENCES), steps = textOf(1000, STEP_SENTENCES);
  const questions = Array.from({ length: 20 }, (_, i) => longQuestion(i));
  const t = await postTest(nora, { productName: "Harbor Run", title: "Harbor Run: the long version", description: steps, ndaText: nda, questions, writtenCents: "25.00" });
  // 1,000-character steps: 3 lines then "Show more" on cards; in full on the join page.
  await ana.goto("/app/find");
  await ana.waitForSelector(`a.card[href="/app/find/${t}"]`);
  sec("Tester dashboard and Find");
  await shot(ana, "long-find-card", "1,000-character steps on a card | Find tests shows 3 lines of the steps, then Show more", `a.card[href="/app/find/${t}"]`);
  sec("Join page");
  await ana.goto(`/app/find/${t}`);
  await pause(ana, 800);
  await shotFull(ana, "long-join", "The join page with long text | The 1,000-character steps in full, the 1,000-character NDA in its scroll box, and the deadline with the time left");
  sec("Developer dashboard");
  await nora.goto("/app");
  await shot(nora, "long-dev-card", "Long steps on the developer's card | 3 lines, then Show more", card(nora, "Harbor Run: the long version"));
  // 20 questions of 300 characters in the answer form.
  const sA = await join(ana, t);
  sec("Tester session page");
  await ana.goto(`/app/sessions/${sA}`);
  await ana.waitForSelector("#a0");
  await shot(ana, "long-questions-form", "20 questions of 300 characters | The answer form shows every question in full, each with its own box and formatting bar", ana.locator("#a0").locator("xpath=ancestor::form[1]"));
  // The developer changes the questions and the NDA: the offer box shows 3 questions then "+N more", and the NDA before and offered as two scroll boxes.
  await apiEdit(nora, t, { questions: [...questions.slice(0, 19), longQuestion(19).replace("Question 20", "New Q 20")], ndaText: textOf(1000, [...NDA_SENTENCES].reverse()) });
  await ana.goto(`/app/sessions/${sA}`);
  await ana.waitForSelector("#terms-offer");
  await shot(ana, "long-offer-box", "The offer box with long text | The NDA before and offered, each in a 12-line scroll box, and the questions as 3 then “+N more”", "#terms-offer");
  await ana.locator("#terms-offer button", { hasText: "Switch to the new terms" }).click();
  await pause(ana, 2000);
  await ana.goto(`/app/sessions/${sA}`);
  await ana.locator("summary", { hasText: "Your agreed scope" }).click();
  for (const s of await ana.locator("[data-terms-history] summary").all()) await s.click();
  await pause(ana, 600);
  await shot(ana, "long-terms-history", "Terms history | “NDA then and now” as two scroll boxes and “Questions then and now” as 3 then “+N more”", "[data-terms-history]");
  // A 50,000-character written answer with formatting.
  const t2 = await postTest(nora, { productName: "Harbor Run", title: "Harbor Run: long answers", writtenCents: "40.00", questions: ["What happened in each harbor?", "Anything else?"] });
  const sB = await join(ben, t2);
  const big = formattedAnswer(49000);
  await ben.goto(`/app/sessions/${sB}`);
  await ben.waitForSelector("#a0");
  await ben.locator("#a0").fill(big);
  await ben.locator("#a1").fill("That's all, thanks!");
  await pause(ben, 600);
  const form = ben.locator("#a0").locator("xpath=ancestor::form[1]");
  await shotSpan(ben, "long-answer-counter", "A long written answer | The live counter “N / 50,000” and the Bold, Italic and Code block bar", ben.locator("[data-format-bar]").first(), ben.locator("[data-written-count]"));
  await form.locator("button", { hasText: "Send my answers" }).click();
  await ben.waitForSelector("text=/^Sent [A-Z]/", { timeout: 20000 }).catch(() => {});
  await nora.goto(`/app/tests/${t2}`);
  await nora.waitForSelector("#needs-you");
  sec("Developer test page");
  await shot(nora, "long-answer-dev", "50,000 characters, formatted | The developer reads it formatted inside the piece's scroll box (about 16 lines); the Pay box stays below, always visible", nora.locator(`#piece-${subOf(sB)}`));
}, { section: "Tester session page" });

group("many", async () => {
  // Long names and titles in rows, and a test with 50 testers.
  const longDev = "Maximiliana Alexandrina Featherstonehaugh-Worthington";
  const nora = await account(`dev+media${TS}mn@playtest.test`, longDev, "developer", "she");
  own(`update "User" set "testerLimit" = 50 where email = ${lit(nora.email)}`); // (as if earned: 50 is the most a developer can reach)
  const title = "Harbor Run: the first three harbors, the lighthouse and more";
  const t = await postTest(nora, { productName: "Harbor Run: Lighthouse Edition for iPad", title, spots: "50", writtenCents: "10.00", liveRateCents: "30.00", openUntil: day(20) });
  const first = ["Ana", "Ben", "Cam", "Dee", "Eli", "Fay", "Gus", "Hana", "Ivo", "Jun"], last = ["Silva", "Okafor", "Lee", "Moss", "Novak", "Ito", "Hale", "Kowalczyk-Brennan", "Petrov", "Abernathy-Llewellyn"];
  const testers = [];
  for (let i = 0; i < 50; i++) {
    const name = i === 0 ? "Bartholomew Cornelius Wolfgang Vanderbilt-Montgomery the Third" : `${first[i % 10]} ${last[Math.floor(i / 5) % 10]} ${i + 1}`;
    const p = await lightTester(`tester+media${TS}mn${i}@playtest.test`, name);
    const s = await join(p, t);
    testers.push({ p, s });
  }
  for (const { p, s } of testers.slice(0, 12)) await sendWritten(p, s);
  await nora.goto(`/app/tests/${t}`);
  await nora.waitForSelector("#testers-joined");
  sec("Developer test page");
  await shot(nora, "many-overview", "A long title and 50 testers | The overview keeps the long title in full where it's the main content: 50 of 50 spots used", testPanel(nora));
  await shot(nora, "many-needs-you", "12 people waiting | Needs you lists one fold per person; long names are cut with “…” and shown in full on hover", "#needs-you");
  await shot(nora, "many-testers", "50 testers | The avatar row and the tester rows in their own scroll box, so 50 rows never push the page down", "#testers-joined");
  await shot(nora, "many-live", "50 testers in Live session | The tick list of testers stays a compact list", liveSession(nora));
  sec("Developer dashboard");
  await nora.goto("/app");
  await shot(nora, "many-dev-card", "A long title on a card | Long titles are cut with “…”, the full text on hover", card(nora, title));
  sec("Tester dashboard and Find");
  const bart = testers[0].p;
  const bp = await ctx(V);
  await bp.context().addCookies(await bart.context().cookies());
  await bp.goto("/app");
  await pause(bp, 800);
  await shotFull(bp, "many-tester-dash", "Long names on the tester's side | The developer's long name and the long title in the tester's dashboard rows");
}, { section: "Developer test page" });

// ---------- The access keys race (owner, Oct 29) ----------
group("keysrace", async () => {
  // 6 spots, keys K-1…K-8; Ana is in with K-1. Free: K-2…K-8 (7) for 5 open spots.
  const nora = await account(`dev+media${TS}kr@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}kra@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}krb@playtest.test`, "Ben Okafor", "tester", "he");
  const cam = await account(`tester+media${TS}krc@playtest.test`, "Cam Lee", "tester", "they");
  const t = await postTest(nora, { productName: "Lumen Notes", title: "Lumen Notes private beta", categories: ["Productivity"], spots: "6", accessKeys: ["K-1", "K-2", "K-3", "K-4", "K-5", "K-6", "K-7", "K-8"].join("\n") });
  await join(ana, t);
  const A = await rec(V, nora), B = await rec(V, nora);
  await A.goto(`/app/tests/${t}/edit`);
  await B.goto(`/app/tests/${t}/edit`);
  for (const P of [A, B]) await P.locator("#keys").scrollIntoViewIfNeeded();
  const fromA = at(A), fromB = at(B);
  await pause(A, 800);
  // Tab A ticks K-2, K-6 and K-7 for removal and types N-1: 5 free keys for 5 open spots, fine so far.
  for (const k of ["K-2", "K-6", "K-7"]) {
    await removeKey(A, k);
    await pause(A, 300);
  }
  await addKeys(A, "N-1");
  await A.locator("#spots").click();
  await pause(A, 800);
  // Meanwhile Ben and Cam join: each is given the oldest free key, K-2 (ticked in tab A) and K-3.
  await join(ben, t);
  await join(cam, t);
  await pause(B, 1200);
  // Tab B removes K-4, K-5 and K-8 and adds B-1: 3 free keys for the 3 open spots. Its Save stops once for the two joins it hadn't seen, then saves.
  for (const k of ["K-4", "K-5", "K-8"]) {
    await removeKey(B, k);
    await pause(B, 300);
  }
  await addKeys(B, "B-1");
  await pause(B, 600);
  await saveBtn(B).click();
  await B.waitForSelector("text=/Press Save again/", { timeout: 15000 });
  await pause(B, 2500);
  await shotSpan(B, "keysrace-b-notice", "Tab B: its own blue notice | Tab B's Save stops once for the two joins it hadn't seen (K-2 and K-3 are no longer free); the second press saves", "#keys", B.locator("text=/Press Save again/").last(), 12, 16);
  await saveBtn(B).click();
  await B.waitForURL(/saved=1/, { timeout: 15000 });
  await pause(B, 2000);
  // Tab A presses Save: the blue notice lists what changed; red marks K-2 (ticked, now in use) and too few free keys for the open spots.
  await A.locator("#keys").scrollIntoViewIfNeeded();
  await saveBtn(A).click();
  await A.waitForSelector("text=/Press Save again/", { timeout: 15000 });
  await pause(A, 3000);
  await A.locator("#keys").scrollIntoViewIfNeeded();
  await pause(A, 2000);
  await shot(A, "keysrace-a-keys", "Tab A: the key boxes after the race | The blue notes name what changed (“Ben Okafor joined and was given K-2”); red marks K-2 (deleted here, given to Ben meanwhile) and too few free keys; the box already shows the current keys with A's own edits", "#keys");
  await shotSpan(A, "keysrace-a-notice", "Tab A: the notice under Save | The red mistakes and the blue “since you opened this page” list: the joins and the other tab's key changes", A.locator("p.err-field", { hasText: /^Fix the/ }).first(), A.locator("text=/Press Save again/").last(), 16, 16);
  // A's second Save, red unfixed: refused, nothing saved.
  await saveBtn(A).click();
  await pause(A, 2500);
  await shotSpan(A, "keysrace-a-second", "Tab A: the second Save | Pressed again with the red unfixed: refused, nothing saved", "#keys", saveBtn(A), 12, 16);
  // The box now shows the current free keys with A's own edits still applied (K-2 is Ben's now): A adds a key and Save goes through.
  await addKeys(A, "N-2");
  await A.locator("#spots").click();
  await pause(A, 1200);
  await saveBtn(A).click();
  await A.waitForURL(/saved=1/, { timeout: 15000 });
  await pause(A, 3000);
  finishVideo([{ file: await saveVideo(A, "keysrace-a.webm"), from: fromA }, { file: await saveVideo(B, "keysrace-b.webm"), from: fromB }], "keysrace",
    "Access keys race (two tabs) | Tab A (left) deletes K-2, K-6, K-7 and types N-1 in the Free box; Ben and Cam join and get K-2 and K-3; tab B (right) deletes K-4, K-5, K-8, adds B-1 and saves after its own blue notice; A's Save shows the blue notice and the red marks, the box refreshes with A's own edits, and A saves after adding a key");
  await nora.goto(`/app/tests/${t}`);
  await nora.waitForSelector("[data-keys-notice]");
  sec("Developer test page");
  await shot(nora, "keysrace-notice-after", "The Access keys notice afterwards | The read-only box on the test page: free keys as chips with the open spots, and each given key with its tester", "[data-keys-notice]");
}, { section: "Edit" });

// ---------- Changed questions: whole sets (batch 13 section 8; the owner's example) ----------
group("changedq", async () => {
  const nora = await account(`dev+media${TS}cq@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}cqa@playtest.test`, "Ana Silva", "tester", "she");
  const Q = ["What did you like?", "Where did you get stuck?", "Would you play level 4?"];
  const t = await postTest(nora, { productName: "Harbor Run", title: "Harbor Run: first 3 levels", questions: Q, writtenCents: "10.00" });
  const sA = await join(ana, t);
  await sendWritten(ana, sA, ["The boat handling.", "The second bridge.", "Yes."]);
  const sub = subOf(sA);
  // The developer's view before: the set Ana sent, under the questions it answered.
  await nora.goto(`/app/tests/${t}`);
  await nora.waitForSelector(`#piece-${sub}`);
  sec("Developer test page");
  await shot(nora, "changedq-dev-before", "Developer, before | Ana's sent answers under the three questions they answered", nora.locator(`#piece-${sub}`));
  // Ana starts a new draft: she changes her answer to Q1 (not sent).
  sec("Tester session page");
  await ana.goto(`/app/sessions/${sA}`);
  await ana.waitForSelector("#a0");
  await pause(ana, 2000); // (the page is interactive: what is typed is kept as a draft)
  await ana.locator("#a0").fill("The boat handling, and the night harbor: the wake looks lovely.");
  await pause(ana, 2500); // (kept on the server as "Not sent yet")
  await shot(ana, "changedq-draft", "Ana's draft | She rewrites her answer to Q1 and doesn't send it yet", ana.locator("#a0").locator("xpath=ancestor::form[1]"));
  // The developer changes only Q2 in Edit: "Changes left" for the questions drops from 3 to 2.
  sec("Edit");
  await nora.goto(`/app/tests/${t}/edit`);
  await nora.waitForSelector("#questions");
  await shot(nora, "changedq-edit-before", "Edit: questions, 3 changes left | Before the change: “Changes left: 3 of 3” next to the questions", nora.locator("#questions").locator("xpath=ancestor::div[1]"));
  await nora.locator("#questions").fill([Q[0], "Which bridge was hardest to find, and why?", Q[2]].join("\n"));
  await saveBtn(nora).click();
  await nora.waitForURL(/saved=1/);
  await nora.goto(`/app/tests/${t}/edit`);
  await nora.waitForSelector("#questions");
  await shot(nora, "changedq-edit-after", "Edit: 2 changes left | After saving the new Q2: “Changes left: 2 of 3”", nora.locator("#questions").locator("xpath=ancestor::div[1]"));
  // Ana sees the offer, switches, and her form keeps what still fits.
  sec("Tester session page");
  {
    const T = await rec(V, ana);
    await T.goto(`/app/sessions/${sA}`);
    await T.waitForSelector("#terms-offer");
    const from = at(T);
    await pause(T, 1500);
    await shot(T, "changedq-offer", "The offer | “Nora Lane updated the listing: questions changed.” Before and after, with Switch or Keep", "#terms-offer");
    await T.locator("#terms-offer button", { hasText: "Switch to the new terms" }).click();
    await T.waitForSelector("#a0");
    await pause(T, 1500);
    await T.locator("#a0").scrollIntoViewIfNeeded();
    await pause(T, 2500);
    await shot(T, "changedq-form", "The form above Send | Q1 keeps her unsent draft, Q2 is the new question and empty, Q3 is unchanged and keeps its answer", T.locator("#a0").locator("xpath=ancestor::form[1]"));
    await T.locator("[data-prev-sets] summary").first().click();
    await pause(T, 1200);
    await shot(T, "changedq-previous", "Previous questions and answers | The whole earlier set, all of Q1 to Q3, as it was: read-only, newest first", "[data-prev-sets]");
    finishVideo([{ file: await saveVideo(T, "changedq.webm"), from }], "changedq-switch", "Switching to changed questions | Ana switches: Q1's draft stays, the new Q2 starts empty, Q3 keeps its answer, and the earlier set waits in its fold");
  }
  // The developer's view after the switch (before she sends again): what was last sent, labelled with its questions.
  sec("Developer test page");
  await nora.goto(`/app/tests/${t}`);
  await nora.waitForSelector(`#piece-${sub}`);
  await shot(nora, "changedq-dev-after-switch", "Developer, after the switch | Still the set Ana last sent, labelled “Sent for the questions until <date>”, reviewed at the price it was sent at", nora.locator(`#piece-${sub}`));
  // Ana answers the new Q2 and sends again.
  await ana.goto(`/app/sessions/${sA}`);
  await ana.locator("#a1").fill("The second bridge: the sign faces the wrong way.");
  await ana.locator("#a0").locator("xpath=ancestor::form[1]").locator("button", { hasText: /^Send my/ }).click();
  await pause(ana, 2000);
  await nora.goto(`/app/tests/${t}`);
  const piece = nora.locator(`#piece-${subOf(sA)}`);
  await piece.waitFor();
  await shot(nora, "changedq-dev-after-send", "Developer, after she sends again | The new set under the current questions", piece);
  const row = nora.locator("#testers-joined [data-tester-rows] > *", { hasText: "Ana Silva" }).first();
  await row.locator("[data-prev-sets] summary").first().click().catch(() => {});
  await pause(nora, 800);
  await shot(nora, "changedq-dev-previous", "Developer: the earlier set | Ana's row keeps the earlier sent set in “Previous questions and answers”", row);
}, { section: "Tester session page" });

// ---------- The paused-test banner (batch 10 section 2, batch 11 section 5) ----------
group("paused", async () => {
  const nora = await account(`dev+media${TS}pz@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}pza@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}pzb@playtest.test`, "Ben Okafor", "tester", "he");
  const cam = await account(`tester+media${TS}pzc@playtest.test`, "Cam Lee", "tester", "they");
  const admin = await adminAccount();
  const t = await postTest(nora, { productName: "Glow Garden", title: "Glow Garden: night levels", writtenCents: "9.00", liveRateCents: "30.00", spots: "5" });
  const sA = await join(ana, t), sB = await join(ben, t);
  // Ana: sent answers now open to Charge, and a call booked. Ben: nothing sent yet.
  await sendWritten(ana, sA);
  await bookCall(nora, ana, t, sA, 30);
  openCharge(sA, t);
  own(`update "Test" set "openUntil" = (now() at time zone 'utc') + interval '10 days' where id = '${t}'`);
  // Before: Ana's page is working normally. The team pauses the test while it's open.
  {
    const T = await rec(V, ana);
    await T.goto(`/app/sessions/${sA}`);
    const from = at(T);
    await pause(T, 2000);
    await adminDo(admin, "pause-test", t, { note: "Media pass check: we're looking at a report" });
    await waitLive(T, "[data-paused]", 30000);
    if (!(await T.locator("[data-paused]").isVisible().catch(() => false))) await T.reload();
    await T.waitForSelector("[data-paused]");
    await pause(T, 3000);
    await shot(T, "paused-banner-full", "The paused banner | Ana's banner lists only what she can do now (drafts, charge or let go, rate, leave, cancel her booked call) and says her deadline is paused too", "[data-paused]");
    await T.locator("#part-written").scrollIntoViewIfNeeded().catch(() => {});
    await pause(T, 2500);
    finishVideo([{ file: await saveVideo(T, "paused.webm"), from }], "paused-live", "The test is paused while the page is open | The blue banner appears; Send, the call-request tools, Join and the chat box are hidden until it resumes");
  }
  await ana.goto(`/app/sessions/${sA}`);
  await pause(ana, 800);
  await shotFull(ana, "paused-page", "A paused session page | Only what works is shown: the banner, Charge or Let it go (payment may be delayed), Cancel on the booked call, Rate and Leave; no Send, no call requests, “Chat is paused while the test is paused.”");
  await ben.goto(`/app/sessions/${sB}`);
  await pause(ben, 800);
  await shot(ben, "paused-banner-short", "A shorter banner | Ben has nothing to charge and no calls: his banner offers only drafts, rate and leave", "[data-paused]");
  sec("Tester dashboard and Find");
  await ana.goto("/app");
  await pause(ana, 800);
  await shot(ana, "paused-dash-tag", "The Paused tag | The tester's dashboard row keeps the test with a “Paused” tag", ana.locator("[data-paused-tag]").first().locator("xpath=ancestor::li[1] | ancestor::div[contains(@class,'card')][1]").first());
  sec("Join page");
  await cam.goto(`/app/find/${t}`);
  await pause(cam, 800);
  await shotFull(cam, "paused-join", "Paused, for someone not in it | Not listed in Find tests; opening the link says “This test isn't available right now.”");
  // The pause lifts: the banner goes, and the deadline moved on by the pause.
  sec("Tester session page");
  await adminDo(admin, "unpause-test", t);
  await openBell(ana);
  await shot(ana, "paused-bells", "Paused and running again | The tester's bell: the test was paused by the team, then “… is running again” with the deadline moved on", bellList(ana));
}, { section: "Tester session page" });

// ---------- Stopped tests (batch 7 section 2) ----------
group("stopped", async () => {
  const nora = await account(`dev+media${TS}st@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}sta@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}stb@playtest.test`, "Ben Okafor", "tester", "he");
  const t = await postTest(nora, { productName: "Night Market", title: "Night Market demo", writtenCents: "9.00", liveRateCents: "30.00", spots: "4" });
  const sA = await join(ana, t), sB = await join(ben, t);
  await sendWritten(ana, sA);
  const past = await bookCall(nora, ben, t, sB, 26);
  own(`update "Call" set "startsAt" = (now() at time zone 'utc') - interval '2 hours', "devJoinedAt" = (now() at time zone 'utc') - interval '2 hours', "testerJoinedAt" = (now() at time zone 'utc') - interval '2 hours' where id = '${past}'`);
  await bookCall(nora, ben, t, sB, 40);
  // The developer stops it from the test page, with Ana's page open.
  {
    const D = await rec(V, nora), T = await rec(V, ana);
    await D.goto(`/app/tests/${t}`);
    await T.goto(`/app/sessions/${sA}`);
    const fromD = at(D), fromT = at(T);
    await pause(D, 1500);
    await D.click("button:has-text('Stop the test')");
    await D.waitForSelector("dialog[open]");
    await pause(D, 1200);
    await D.click("dialog[open] button:has-text('Stop the test')");
    await D.waitForSelector("text=This test is stopped.");
    await waitLive(T, "[data-live-top]:has-text('stopped')", 25000);
    if (!(await T.locator("text=/stopped/i").first().isVisible().catch(() => false))) await T.reload();
    await pause(T, 3000);
    finishVideo([{ file: await saveVideo(D, "stopped-d.webm"), from: fromD }, { file: await saveVideo(T, "stopped-t.webm"), from: fromT }], "stopped-live",
      "Stopping a test | The developer (left) stops the test; Ana's open page (right) says so, and both pages keep only what still works");
  }
  sec("Developer test page");
  await nora.goto(`/app/tests/${t}`);
  await pause(nora, 800);
  await shotFull(nora, "stopped-dev-page", "The stopped test page | No Edit, Stop, End early, Invite or call requests; Needs you (Pay, Reject, the call's length), the Testers panel, past calls, Alerts and Next round stay");
  sec("Tester session page");
  await ana.goto(`/app/sessions/${sA}`);
  await pause(ana, 800);
  await shotFull(ana, "stopped-tester-page", "The tester's stopped page | Her agreed scope, each part with its status, the work she sent, and what still works: Charge or Let it go later, Dispute, Rate");
  await ben.goto(`/app/sessions/${sB}`);
  await pause(ben, 800);
  await shotFull(ben, "stopped-tester-calls", "Calls after a stop | Ben's booked call was cancelled by the stop; the call that already happened stays listed");
  sec("Developer dashboard");
  await nora.goto("/app");
  await shot(nora, "stopped-dev-card", "A stopped card | Stopped, with what still needs the developer", card(nora, "Night Market demo"));
  sec("Tester dashboard and Find");
  await ana.goto("/app");
  await pause(ana, 800);
  await shotFull(ana, "stopped-tester-dash", "The tester's dashboard after a stop | The stopped test with its parts still under review");
  await openBell(ana);
  sec("Notifications and emails");
  await shot(ana, "stopped-bells", "Stop bell lines | “Nora Lane stopped …” and the cancelled call, as the testers read them", bellList(ana));
}, { section: "Developer test page" });

// ---------- Drafts (batch 7 section 3) ----------
group("drafts", async () => {
  const nora = await account(`dev+media${TS}dr@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}dra@playtest.test`, "Ana Silva", "tester", "she");
  const t = await postTest(nora, { productName: "Harbor Run", title: "Harbor Run: first 3 levels" });
  await join(ana, t);
  // Next round makes a draft and opens it in Post a test, filled in.
  {
    const D = await rec(V, nora);
    await D.goto(`/app/tests/${t}`);
    const from = at(D);
    await pause(D, 1200);
    await D.click("button:has-text('Next round')");
    await pause(D, 800);
    await D.click("text=Start the next round");
    await D.waitForURL((u) => u.pathname.startsWith("/app/tests/new") && u.search.includes("draft="), { timeout: 15000 });
    await D.waitForSelector("[data-draft-note]");
    await pause(D, 2500);
    await D.locator("#openUntil").scrollIntoViewIfNeeded();
    await pause(D, 1500);
    finishVideo([{ file: await saveVideo(D, "drafts-next.webm"), from }], "drafts-next-round", "Next round makes a draft | The draft “(round 2)” opens in Post a test, filled in from the test");
  }
  const draftId = sql(`select id from "Test" where "developerId" = '${nora.uid}' and status = 'draft' order by "createdAt" desc limit 1`);
  await nora.goto("/app");
  sec("Developer dashboard");
  await shot(nora, "drafts-card", "A draft card | Draft: the next round, not open yet; clicking it opens Post a test", card(nora, "Harbor Run: first 3 levels (round 2)"));
  sec("Post a test");
  await nora.goto(`/app/tests/${draftId}`);
  await nora.waitForURL((u) => u.pathname.startsWith("/app/tests/new"), { timeout: 15000 });
  await nora.waitForSelector("[data-draft-note]");
  await shotSpan(nora, "drafts-post-page", "A draft opens in Post a test | Its own test page and Edit redirect here; Post the test opens it for testers", "main h1", "[data-draft-note]", 12, 16);
  await nora.locator("button[aria-haspopup=dialog]", { hasText: "Delete the draft" }).scrollIntoViewIfNeeded();
  await nora.locator("button[aria-haspopup=dialog]", { hasText: "Delete the draft" }).click();
  await nora.waitForSelector("dialog[open]");
  await pause(nora, 600);
  await shot(nora, "drafts-delete", "Deleting a draft | The confirm pop-up: nobody has joined it, so nothing else changes");
  await nora.keyboard.press("Escape");
  // Post the test opens it (the developer then has 2 open tests: fine during the free launch).
  await nora.goto(`/app/tests/new?draft=${draftId}`);
  await nora.waitForSelector("[data-draft-note]");
  await nora.locator("#openUntil").fill(day(14));
  await nora.click("button:has-text('Post the test')");
  await nora.waitForURL((u) => /\/app\/tests\/\w+$/.test(u.pathname) && !u.pathname.endsWith("/new"), { timeout: 15000 });
  await pause(nora, 1500);
  await shot(nora, "drafts-posted", "Posted from the draft | Round 2 is open for testers, on its own test page", testPanel(nora));
}, { section: "Post a test" });

// ---------- Notifications and emails ----------
/** The dev outbox (emails are written there instead of sent): the newest email to this address, as received. */
async function outboxShot(page0, email, name, caption, subject) {
  // (Batch 15 section 41, M3) The dev outbox shows reset links, so only an admin can open it: read it as this run's admin.
  const page = await adminAccount();
  await page.goto("/dev/outbox");
  const mail = page.locator("div.panel", { hasText: `To ${email}` }).filter(subject ? { hasText: subject } : {}).first();
  await mail.waitFor({ timeout: 15000 });
  await shot(page, name, caption, mail);
}
const setEmail = (p, emailPref) => post(p, "/api/account/notify", { emailPref }).then((r) => ok(r, "email setting"));

group("emails", async () => {
  // Two developers and two testers: Nora and Ana on Daily email, Omar and Ben with email Off.
  const nora = await account(`dev+media${TS}em@playtest.test`, "Nora Lane", "developer", "she");
  const omar = await account(`dev+media${TS}emo@playtest.test`, "Omar Reyes", "developer", "he");
  const ana = await account(`tester+media${TS}ema@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}emb@playtest.test`, "Ben Okafor", "tester", "he");
  await setEmail(omar, "off");
  await setEmail(ben, "off");
  await openBell(ben);
  await ben.locator("summary", { hasText: "How you're notified" }).click().catch(() => {});
  await pause(ben, 600);
  await shot(ben, "emails-setting", "How you're notified | Email Off, or one email a day, week or month listing everything new; a few lines are sent even with email Off", ben.locator("main details, main section").first());
  // Nora's test: joins, sent work, a payment, then a declined one (a payment hold) and a retry that pays.
  setCard(nora.email, "pm_card_visa");
  const t = await postTest(nora, { productName: "Harbor Run", title: "Harbor Run: first 3 levels", writtenCents: "10.00", liveRateCents: "30.00" });
  const sA = await join(ana, t), sB = await join(ben, t);
  await sendWritten(ana, sA);
  await sendWritten(ben, sB);
  await apiPay(nora, subOf(sA), "10.00");
  await bookCall(nora, ana, t, sA, 50);
  setCard(nora.email, "pm_card_declined");
  await post(nora, "/api/review", { action: "pay", kind: "submission", id: subOf(sB), amount: "10.00", tickedCents: 1000, payKey: require("crypto").randomUUID(), seenAt: nowIso(), confirmed: true });
  setCard(nora.email, "pm_card_visa");
  await hook("retry", nora.email);
  // Omar (email Off): a charge made while he's away needs his bank's confirmation (a must-send line), and a subscription renewal is declined.
  setCard(omar.email, "pm_card_authenticationRequired");
  const t2 = await postTest(omar, { productName: "Tide Tracker", title: "Tide Tracker: widgets", categories: ["Productivity"], writtenCents: "7.00" });
  const sA2 = await join(ana, t2);
  await sendWritten(ana, sA2);
  openCharge(sA2, t2);
  ok(await post(ana, `/api/sessions/${sA2}/choose`, { submissionId: subOf(sA2), choice: "charge", tickedCents: 700, seenAt: nowIso(), confirmed: true }), "charge");
  // The bell, as each person reads it.
  for (const [p, name, who] of [[nora, "emails-bell-dev", "Nora (developer, Daily)"], [omar, "emails-bell-dev-off", "Omar (developer, email Off)"], [ana, "emails-bell-tester", "Ana (tester, Daily)"], [ben, "emails-bell-tester-off", "Ben (tester, email Off)"]]) {
    await openBell(p);
    await shot(p, name, `${who}: the bell | Every line as it arrived, stacked by kind and test, newest first`, bellList(p));
  }
  // The emails those lines become (the end-of-day job, run for these four accounts only through the fake server's test hook).
  for (const p of [nora, omar, ana, ben]) await hook("summaries", p.email);
  await outboxShot(nora, nora.email, "emails-summary-dev", "Nora's daily email | One email listing every update since the last one, each with its link", "Your Playtest summary");
  await outboxShot(omar, omar.email, "emails-off-dev", "Omar's email with email Off | Only the must-send lines (here: his bank wants him to confirm a payment) in one end-of-day email", "account updates");
  await outboxShot(ana, ana.email, "emails-summary-tester", "Ana's daily email | Joined, paid, booked call and the other updates, once each", "Your Playtest summary");
  const adm = await adminAccount();
  const offMail = await adm.goto("/dev/outbox").then(() => adm.locator("div.panel", { hasText: `To ${ben.email}` }).count());
  if (offMail) await outboxShot(ben, ben.email, "emails-off-tester", "Ben's email with email Off | Testers' must-send lines only; nothing else is emailed");
  else console.log("   (Ben, email Off, got no email: none of his lines is a must-send one)");
}, { section: "Notifications and emails", fake: true });

// ---------- Settings and account ----------
group("settings", async () => {
  const nora = await account(`dev+media${TS}se@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}sea@playtest.test`, "Ana Silva", "tester", "she");
  const admin = await adminAccount();
  // Some history so the delete warnings have real numbers.
  const t = await postTest(nora, { productName: "Harbor Run", title: "Harbor Run: first 3 levels", writtenCents: "10.00", recordingCents: "15.00", spots: "4" });
  const sA = await join(ana, t);
  await sendWritten(ana, sA);
  const t2 = await postTest(nora, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"], writtenCents: "8.00" });
  const sA2 = await join(ana, t2);
  await sendWritten(ana, sA2);
  openCharge(sA2, t2);
  own(`update "Test" set "openUntil" = (now() at time zone 'utc') + interval '10 days' where id = '${t2}'`);
  await nora.goto("/app/account");
  await pause(nora, 800);
  await shotFull(nora, "settings-dev", "Settings | Developer, tester or both; the profile; Contact us; email; and Delete account");
  // Contact us: the message reaches the team by email; at most 5 a day.
  await ana.goto("/app/help");
  await ana.locator("select").first().selectOption("A payment");
  await ana.locator("textarea").first().fill("My payment for Sky Lab says it may be delayed. Is anything needed from me?");
  await ana.click("button:has-text('Send to the team')");
  await pause(ana, 1500);
  await shotFull(ana, "settings-contact-sent", "Contact us | The message goes to the team by email with the sender's name and address");
  for (let i = 0; i < 4; i++) await post(ana, "/api/help", { topic: "Something else", message: `Media pass message number ${i + 2}.` });
  await ana.goto("/app/help");
  await ana.locator("select").first().selectOption("Something else");
  await ana.locator("textarea").first().fill("A sixth message today, to see the limit.");
  await ana.click("button:has-text('Send to the team')");
  await ana.waitForSelector("text=/sent 5 messages today/");
  await pause(ana, 600);
  await shot(ana, "settings-contact-limit", "Contact us: 5 a day | The 6th press: “You've sent 5 messages today. We'll reply by email.”", ana.locator("form").first());
  sec("Admin console");
  await outboxShot(admin, "owner@example.com", "admin-contact-email", "Contact us, as the team receives it | The email to the team's address, with the topic, the sender and the message", "Contact us: A payment");
  sec("Settings and account");
  // Delete account: the warnings with the real numbers.
  await ana.goto("/app/account");
  await ana.locator("button[aria-haspopup=dialog]", { hasText: /^Delete/ }).last().click();
  await ana.waitForSelector("dialog[open]");
  await pause(ana, 600);
  await shot(ana, "settings-delete-tester", "Deleting a tester account | The warning with Ana's real numbers: work under review, a part open to Charge, what happens to sent work and calls", "dialog[open]");
  await ana.keyboard.press("Escape");
  await nora.goto("/app/account");
  await nora.locator("button[aria-haspopup=dialog]", { hasText: /^Delete/ }).last().click();
  await nora.waitForSelector("dialog[open]");
  await pause(nora, 600);
  await shot(nora, "settings-delete-dev", "Deleting a developer account | Work waiting for review, parts testers can still charge and open disputes, with counts; then what deleting does", "dialog[open]");
  await nora.keyboard.press("Escape");
}, { section: "Settings and account" });

// ---------- The tester's side: dashboard, Find, the join page, the session page ----------
group("tester", async () => {
  const nora = await account(`dev+media${TS}tr@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}tra@playtest.test`, "Ana Silva", "tester", "she", { devices: ["Windows PC", "iPhone"] });
  const t = await postTest(nora, { productName: "Harbor Run", title: "Harbor Run: first 3 levels", writtenCents: "10.00", recordingCents: "15.00", liveRateCents: "30.00", openUntil: day(4), ndaText: "Don't share screenshots of the beta before launch." });
  await postTest(nora, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"], devices: ["iPhone", "iPad"], writtenCents: "8.00" });
  await postTest(nora, { productName: "Pocket Chef", title: "Pocket Chef: recipe search", categories: ["Shopping"], languages: ["Spanish"], writtenCents: "6.00" });
  sec("Tester dashboard and Find");
  await ana.goto("/app/find");
  await ana.waitForSelector(`a.card[href="/app/find/${t}"]`);
  await pause(ana, 600);
  await shotFull(ana, "tester-find", "Find tests | Open tests with their pay, parts and deadline; ones missing a need of yours say so");
  sec("Join page");
  {
    const J = await rec(V, ana);
    await J.goto(`/app/find/${t}`);
    const from = at(J);
    await pause(J, 1500);
    await shot(J, "tester-join-deadline", "The deadline before joining | “Your deadline: <date> (in 2 days …)”: Open until is every tester's deadline", "[data-join-deadline]");
    await J.locator("main").evaluate((m) => window.scrollTo(0, m.scrollHeight));
    await pause(J, 1200);
    await shotFull(J, "tester-join", "The join page | The steps, each part and its pay, the NDA to accept, and Join");
    const nda = J.locator("label", { hasText: /NDA|confidential/i }).locator("input[type=checkbox]").first();
    if (await nda.isVisible().catch(() => false)) await nda.check();
    await J.locator("button", { hasText: "Join this test" }).first().click();
    await J.waitForURL(/\/app\/sessions\//, { timeout: 15000 }).catch(() => {});
    await pause(J, 3000);
    finishVideo([{ file: await saveVideo(J, "tester-join.webm"), from }], "tester-join-flow", "Joining | Ana reads the listing, accepts the NDA and joins: she lands on her session page");
  }
  const sA = sql(`select id from "Contract" where "testId" = '${t}' and "testerId" = '${ana.uid}'`);
  sec("Tester session page");
  await ana.goto(`/app/sessions/${sA}`);
  await pause(ana, 1500);
  await shotFull(ana, "tester-session", "The session page | The live box, her agreed scope, each part, the recordings, the written part, calls and chat");
  await ana.locator("#a0").fill("**Loved** the boat handling.\n\n```\nmap -> sail: the sail didn't rise\n```");
  await pause(ana, 800);
  await shot(ana, "tester-written-form", "The written part | Bold, Italic and Code block, the live counter, and Send", ana.locator("#a0").locator("xpath=ancestor::form[1]"));
  await shot(ana, "tester-recordings", "Recordings | Record the screen here (with the microphone if allowed) or upload a file; up to 5, sent together as one piece", ana.locator("section", { hasText: "Your recordings" }).first());
  await ana.locator("#a0").locator("xpath=ancestor::form[1]").locator("button", { hasText: /^Send my/ }).click();
  await pause(ana, 2000);
  sec("Tester dashboard and Find");
  await ana.goto("/app");
  await pause(ana, 800);
  await shotFull(ana, "tester-dash", "The tester dashboard | To do (each part with Send work), the tests she's in, and invitations");
}, { section: "Tester session page" });

// ---------- The admin console: every power ----------
/** An admin list (pages of 25, shared with every account in the database): press Next until the row shows. */
async function pageTo(page, kind, selector, max = 40) {
  for (let i = 0; i < max && !(await page.locator(selector).count()); i++) {
    const next = page.locator(`[data-next="${kind}"]`);
    if (await next.isDisabled().catch(() => true)) break;
    const range = await page.locator(`[data-range="${kind}"]`).innerText();
    await next.click();
    // (Next is faded while the page loads: wait for the range to change.)
    for (let w = 0; w < 30 && (await page.locator(`[data-range="${kind}"]`).innerText()) === range; w++) await page.waitForTimeout(300);
  }
  await page.locator(selector).first().scrollIntoViewIfNeeded();
}
/** An admin button in a row: fill its fields (e.g. "Why") and press it; returns the text it shows next to it. */
async function adminPress(page, row, label, fields = {}) {
  const span = row.locator("span", { has: page.locator("button", { hasText: label }) }).last();
  for (const [aria, v] of Object.entries(fields)) await span.locator(`input[aria-label="${aria}"]`).fill(v);
  await span.locator("button", { hasText: label }).click();
  await span.locator(".ok, .err").first().waitFor({ timeout: 15000 });
  return span.locator(".ok, .err").first().innerText();
}
/** A rejected piece disputed by the tester, with the developer's side added. Returns the dispute id. */
async function disputed(dev, tester, testId, sessionId, rejectFirst = true, pay0 = false) {
  const sub = subOf(sessionId);
  if (rejectFirst) await rejectPiece(dev, sub, "The answers are too short to use.");
  if (pay0) ok(await post(dev, "/api/review", { action: "pay", kind: "submission", id: sub, amount: "0", tickedCents: 0, reason: "Nothing usable in these answers.", payKey: require("crypto").randomUUID(), seenAt: nowIso(), confirmed: true }), "pay $0");
  ok(await post(tester, `/api/sessions/${sessionId}/dispute`, { ...go, kind: "submission", id: sub, reason: rejectFirst ? "I answered every question; the test didn't ask for long answers." : "I spent an hour on this feedback; $0 isn't fair." }), "dispute");
  const id = sql(`select id from "Dispute" where "submissionId" = '${sub}'`);
  ok(await post(dev, `/api/tests/${testId}/dispute-side`, { ...go, disputeId: id, text: "The answers were one line each." }), "dispute side");
  return id;
}

group("admin", async () => {
  const admin = await adminAccount();
  const nora = await account(`dev+media${TS}ad@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}ada@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}adb@playtest.test`, "Ben Okafor", "tester", "he");
  const cam = await account(`tester+media${TS}adc@playtest.test`, "Cam Lee", "tester", "they");
  const dee = await account(`tester+media${TS}add@playtest.test`, "Dee Moss", "tester", "they");
  const t = await postTest(nora, { productName: "Harbor Run", title: "Harbor Run: first 3 levels", writtenCents: "10.00", spots: "5" });
  const sA = await join(ana, t), sC = await join(cam, t);
  await sendWritten(ana, sA);
  // An unlisted part: the test lists a recording only; Ben sends written feedback, Nora pays $0, Ben disputes.
  const t2 = await postTest(nora, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"], writtenCents: null, writtenRequired: false, recordingCents: "15.00", questions: [] });
  const sB = await join(ben, t2);
  await sendWritten(ben, sB, ["Here is an hour of notes on the tutorial: the second lesson skips the jump explanation, and the map icon is hidden behind the pause button."]);
  const dListed = await disputed(nora, ana, t, sA);
  const dUnlisted = await disputed(nora, ben, t2, sB, false, true);
  await admin.goto("/admin");
  await pause(admin, 800);
  await shot(admin, "admin-top", "The admin dashboard | The tiles (people, parts awaiting review, charged, the platform's share, owed to testers, waitlist), then open disputes first", admin.locator("main > section").first());
  await shot(admin, "admin-dispute-listed", "A dispute on a listed part | What was paid and the listing, what each side said, and the total to decide (up to the listing)", `[data-dispute-row="${dListed}"]`);
  await shot(admin, "admin-dispute-unlisted", "A dispute on an unlisted part | Ben was paid $0 for written feedback that wasn't in his contract: the admin sets an amount up to the $1,000 cap", `[data-dispute-row="${dUnlisted}"]`);
  await admin.locator(`#total-${dUnlisted}`).fill("25.00");
  await admin.locator(`#note-${dUnlisted}`).fill("Detailed and useful: $25 is fair for an unlisted part.");
  await admin.locator(`[data-dispute-row="${dUnlisted}"] button`, { hasText: "Decide" }).click();
  await pause(admin, 1500);
  await admin.goto("/admin");
  await admin.locator(`#total-${dListed}`).fill("10.00");
  await admin.locator(`[data-dispute-row="${dListed}"] button`, { hasText: "Decide" }).click();
  await pause(admin, 1500);
  await admin.goto(`/admin?at=${Date.now()}#decided`);
  await pause(admin, 600);
  await shot(admin, "admin-decided", "Decided disputes | Each decision with the amount, who decided and the note", "#decided");
  await openBell(ben);
  sec("Notifications and emails");
  await shot(ben, "admin-dispute-bell", "A decision as the tester reads it | “Your dispute on … was decided”, with the amount", bellList(ben));
  sec("Admin console");
  // Accounts: preview a suspension, suspend, lift it; delete an account.
  await admin.goto(`/admin?at=${Date.now()}#users`);
  const uRow = admin.locator(`[data-user-row="${nora.uid}"]`);
  await uRow.locator("button", { hasText: "Preview suspension" }).click();
  await uRow.locator("[data-preview]").waitFor();
  await shot(admin, "admin-preview-suspension", "Preview a suspension | What suspending Nora would do right now, before pressing Suspend", uRow);
  await adminPress(admin, uRow, "Suspend", { Why: "Media pass check: several reports" });
  await admin.goto(`/admin?at=${Date.now()}#users`);
  await shot(admin, "admin-suspended-row", "A suspended account | The row says who suspended it, when and why, with Lift the suspension", admin.locator(`[data-user-row="${nora.uid}"]`));
  await adminPress(admin, admin.locator(`[data-user-row="${nora.uid}"]`), "Lift the suspension");
  await admin.goto(`/admin?at=${Date.now()}#users`);
  await adminPress(admin, admin.locator(`[data-user-row="${dee.uid}"]`), "Delete account", { Why: "Media pass check: asked by email" });
  await admin.goto(`/admin?at=${Date.now()}#users`);
  await shot(admin, "admin-deleted-row", "A deleted account | The team deleted Dee's account: the row keeps who, when and why", admin.locator(`[data-user-row="${dee.uid}"]`));
  // Tests: pause and lift, stop; allow 3 more changes.
  const t3 = await postTest(nora, { productName: "Pocket Chef", title: "Pocket Chef: recipe search", categories: ["Shopping"], writtenCents: "6.00" });
  await join(cam, t3);
  for (const d of ["Search for one recipe.", "Search for two recipes.", "Search for three recipes."]) await apiEdit(nora, t3, { description: d });
  await admin.goto(`/admin?at=${Date.now()}#tests`);
  const tRow = admin.locator(`[data-test-row="${t3}"]`);
  await shot(admin, "admin-test-row", "A test row | Pause (with a reason), Stop (close), and Allow 3 more changes when a field used its 3", tRow);
  await adminPress(admin, tRow, "Allow 3 more changes");
  await admin.goto(`/admin?at=${Date.now()}#tests`);
  await adminPress(admin, admin.locator(`[data-test-row="${t3}"]`), "Pause", { Why: "Media pass check: checking a report" });
  await admin.goto(`/admin?at=${Date.now()}#paused-tests`);
  await pageTo(admin, "paused", `[data-paused-test="${t3}"]`);
  await shot(admin, "admin-paused-tests", "Paused tests | Each paused test closes 7 days after it was first paused: Extend moves the date later, Close now closes it", admin.locator(`[data-paused-test="${t3}"]`));
  await adminPress(admin, admin.locator(`[data-paused-test="${t3}"]`), "Extend", { "Days to add": "7" });
  await admin.goto(`/admin?at=${Date.now()}#paused-tests`);
  await pageTo(admin, "paused", `[data-paused-test="${t3}"]`);
  await shot(admin, "admin-extended", "Extended | “extended by the team” next to the new closing date", admin.locator(`[data-paused-test="${t3}"]`));
  await admin.goto(`/admin?at=${Date.now()}#tests`);
  await adminPress(admin, admin.locator(`[data-test-row="${t3}"]`), "Lift the pause");
  await admin.goto(`/admin?at=${Date.now()}#mine`);
  await shot(admin, "admin-mine", "Your actions | The tests this admin paused or stopped and the accounts they suspended, newest first", "#mine");
  // A 4th payment hold: everything is paid, and the lift waits for an admin's Approve.
  const omar = await account(`dev+media${TS}ado@playtest.test`, "Omar Reyes", "developer", "he");
  await postTest(omar, { productName: "Tide Tracker", title: "Tide Tracker: widgets", categories: ["Productivity"] });
  own(`update "User" set "holdStartedAt" = (now() at time zone 'utc') - interval '1 day', "holdReason" = 'unpaid', "holdCount" = 4 where email = ${lit(omar.email)}`);
  await post(omar, "/api/payments/owed", {}); // (nothing owed: the lift waits for the team)
  await omar.goto("/app/payments");
  await pause(omar, 600);
  sec("Payments");
  await shot(omar, "admin-lift-dev-waiting", "Paid, waiting for the team | From the 4th hold on: “You've paid what you owe. The team will review your account before your tests resume.”", "[data-hold-review-paid]");
  sec("Admin console");
  await admin.goto(`/admin?at=${Date.now()}#lifts`);
  const lRow = admin.locator(`[data-lift-row="${omar.uid}"]`);
  await shot(admin, "admin-lift", "Approve a lift | A 4th hold whose owed money is paid: Approve (with a note to the developer); the first press wins", lRow);
  await lRow.locator("input").fill("Thanks for paying. Please keep your card up to date.");
  await lRow.locator("button", { hasText: "Approve" }).click();
  await pause(admin, 1500);
  // A suspended tester's held share: released (or refunded to the developer).
  await sendWritten(cam, sC);
  await adminDo(admin, "suspend", cam.uid, { note: "Media pass check: copied answers" });
  await apiPay(nora, subOf(sC), "10.00"); // (sent work is still reviewed: Cam's share is held while suspended)
  await admin.goto(`/admin?at=${Date.now()}#held-shares`);
  await pause(admin, 600);
  await shot(admin, "admin-held-shares", "Held tester shares | A suspended tester's pay is charged but their share waits: Release to the tester, or Refund the developer", "#held-shares");
  await admin.goto(`/admin?at=${Date.now()}#payouts`);
  await shot(admin, "admin-payouts", "Payouts and payments | Shares waiting for a payout account (Send now), and the latest payments", admin.locator("section", { has: admin.locator("#payouts") }));
  await admin.goto("/admin");
  await shot(admin, "admin-needs-today", "Needs the team today | The same list the daily admin email sends", admin.locator("section", { hasText: "Needs the team today" }).first());
  // History: an admin opening a person's profile or a test's listing sees their history boxes.
  await admin.goto(`/app/developers/${nora.uid}`);
  await pause(admin, 1000);
  await shotFull(admin, "admin-history-person", "History of a person | Opened from the admin console: payments, payouts, disputes, chargebacks, holds and suspensions, tests, reports and parts, each in pages of 25");
  await admin.goto(`/app/find/${t}`);
  await pause(admin, 1000);
  await shotFull(admin, "admin-history-test", "History of a test | Its timeline, contracts and payments, as the admin sees the listing");
}, { section: "Admin console" });

// ---------- Two admins at once ----------
group("admins2", async () => {
  const a1 = await account(`admin+media${TS}x1@playtest.test`, "Ada Admin", "developer", "she");
  const a2 = await account(`admin+media${TS}x2@playtest.test`, "Bo Admin", "developer", "he");
  for (const a of [a1, a2]) own(`update "User" set "isAdmin" = true where email = ${lit(a.email)}`);
  const nora = await account(`dev+media${TS}x@playtest.test`, "Nora Lane", "developer", "she");
  const omar = await account(`dev+media${TS}xo@playtest.test`, "Omar Reyes", "developer", "he");
  const ana = await account(`tester+media${TS}xa@playtest.test`, "Ana Silva", "tester", "she");
  const dee = await account(`tester+media${TS}xd@playtest.test`, "Dee Moss", "tester", "they");
  const t = await postTest(nora, { productName: "Harbor Run", title: "Harbor Run: first 3 levels", writtenCents: "10.00" });
  const sA = await join(ana, t);
  await sendWritten(ana, sA);
  const d = await disputed(nora, ana, t, sA);
  await adminDo(a1, "suspend", omar.uid, { note: "Media pass check" });
  await adminDo(a1, "pause-test", t, { note: "Media pass check" });
  own(`update "User" set "holdStartedAt" = (now() at time zone 'utc') - interval '1 day', "holdReason" = 'unpaid', "holdCount" = 4 where email = ${lit(nora.email)}`);
  // Both admins have the console open; Ada acts first in each row, then Bo presses the same button on his older page.
  const L = await rec(V, a1), R = await rec(V, a2);
  for (const P of [L, R]) await P.goto("/admin");
  const fromL = at(L), fromR = at(R);
  await pause(L, 1500);
  const cases = [
    ["dispute", async (P) => { await P.locator(`#total-${d}`).fill("10.00"); await P.locator(`[data-dispute-row="${d}"] button`, { hasText: "Decide" }).click(); return P.locator(`[data-dispute-row="${d}"] .ok, [data-dispute-row="${d}"] .err`).first(); }, "A dispute already decided | Bo decides a dispute Ada decided a moment earlier: “This dispute was already decided by Ada Admin at <time>.”"],
    ["suspension", async (P) => { const row = P.locator(`[data-user-row="${omar.uid}"]`); await row.scrollIntoViewIfNeeded(); await row.locator("button", { hasText: "Lift the suspension" }).click(); return row.locator(".ok, .err").first(); }, "A suspension already lifted | Bo lifts a suspension Ada already lifted: “That account isn't suspended.”"],
    ["pause", async (P) => { const row = P.locator(`[data-test-row="${t}"]`); await row.scrollIntoViewIfNeeded(); await row.locator("button", { hasText: "Lift the pause" }).click(); return row.locator(".ok, .err").first(); }, "A pause already lifted | Bo lifts the team's pause Ada already lifted: “That test isn't paused by the team.”"],
    ["approve", async (P) => { const row = P.locator(`[data-lift-row="${nora.uid}"]`); await row.scrollIntoViewIfNeeded(); await row.locator("button", { hasText: "Approve" }).click(); return row.locator(".ok, .err").first(); }, "An Approve already pressed | Bo approves a lift Ada already approved: “This lift was already approved by Ada Admin at <time>.”"],
    ["deleted", async (P) => { const row = P.locator(`[data-user-row="${dee.uid}"]`); await row.scrollIntoViewIfNeeded(); const span = row.locator("span", { has: P.locator("button", { hasText: "Suspend" }) }).last(); await span.locator("input").fill("Media pass check"); await span.locator("button", { hasText: "Suspend" }).click(); return span.locator(".ok, .err").first(); }, "An account already deleted | Ada deleted Dee's account; Bo suspends it from his older page: “That account was deleted.”"],
  ];
  for (const [key, press, caption] of cases) {
    if (key === "deleted") { const span = L.locator(`[data-user-row="${dee.uid}"] span`, { has: L.locator("button", { hasText: "Delete account" }) }).last(); await span.scrollIntoViewIfNeeded(); await span.locator("input").fill("Media pass check: asked by email"); await span.locator("button", { hasText: "Delete account" }).click(); await span.locator(".ok, .err").first().waitFor(); }
    else { const m = await press(L); await m.waitFor({ timeout: 15000 }); }
    await pause(L, 1200);
    const msg = await press(R);
    await msg.waitFor({ timeout: 15000 });
    await pause(R, 1500);
    await shot(R, `admins2-${key}`, caption, msg.locator("xpath=ancestor::*[@data-dispute-row or @data-user-row or @data-test-row or @data-lift-row][1]"));
    // Both pages reload after a success; give the next case fresh pages.
    for (const P of [L, R]) { await P.goto("/admin"); await pause(P, 600); }
  }
  finishVideo([{ file: await saveVideo(L, "admins2-l.webm"), from: fromL }, { file: await saveVideo(R, "admins2-r.webm"), from: fromR }], "admins2",
    "Two admins at once | Ada (left) acts first in each row; Bo (right) presses the same button on his older page and gets the refusal: a decided dispute, a lifted suspension, a lifted pause, an approved lift, a deleted account");
}, { section: "Admin console" });

// ---------- More bell lines: listing changes, invites, chat, ratings, blocks ----------
group("bells", async () => {
  const nora = await account(`dev+media${TS}bl@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}bla@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}blb@playtest.test`, "Ben Okafor", "tester", "he");
  const cam = await account(`tester+media${TS}blc@playtest.test`, "Cam Lee", "tester", "they");
  // Ana applies to three Approved-only tests; Ben is invited to two. One Save each that changes the build link closes the applications and re-sends the invites:
  // the lines stack, one entry per kind per day.
  const tests = [];
  for (const [p, title] of [["Harbor Run", "Harbor Run: first 3 levels"], ["Sky Lab", "Sky Lab: tutorial"], ["Pocket Chef", "Pocket Chef: recipe search"]]) {
    const id = await postTest(nora, { productName: p, title, joinMode: "apply" });
    ok(await post(ana, `/api/tests/${id}/apply`, { ...go, note: "I'd love to try it." }), "apply");
    tests.push(id);
  }
  for (const id of tests.slice(0, 2)) ok(await post(nora, `/api/tests/${id}/invite`, { ...go, testerIds: [ben.uid] }), "invite");
  for (const id of tests) await apiEdit(nora, id, { buildUrl: `https://example.com/new-build-${id.slice(-4)}` });
  await openBell(ana);
  await shot(ana, "bells-applications-closed", "Applications closed, stacked | Three tests Ana applied to changed their listing: “3 tests you applied to changed: your applications were closed”, opening to list them", bellList(ana));
  await openBell(ben);
  await shot(ben, "bells-invites-resent", "Invites sent again, stacked | “2 tests you were invited to changed: your invites were sent again”", bellList(ben));
  // A working test: chat both ways, a rating and its "finished" line, and a block that ends a session.
  const t = await postTest(nora, { productName: "Glow Garden", title: "Glow Garden: night levels", writtenCents: "9.00" });
  const sC = await join(cam, t), sA = await join(ana, t);
  ok(await post(cam, `/api/sessions/${sC}/message`, { body: "Hi Nora! Is level 2 meant to be this dark?" }), "chat");
  ok(await post(nora, `/api/sessions/${sC}/message`, { body: "Yes, the lantern is the trick. Thanks for asking!" }), "chat back");
  await sendWritten(cam, sC);
  await apiPay(nora, subOf(sC), "9.00");
  ok(await post(cam, `/api/sessions/${sC}/rate`, { ...go, stars: 5, comment: "Clear steps and quick pay." }), "rate");
  ok(await post(nora, "/api/blocks", { userId: ana.uid }), "block"); // (blocks are on profiles; the tester is never told it was a block)
  await openBell(nora);
  await shot(nora, "bells-dev-misc", "More developer lines | Chat, and a tester finishing with “You can rate them for 14 days”", bellList(nora));
  await openBell(cam);
  await shot(cam, "bells-tester-misc", "More tester lines | Chat from the developer, paid, and the rating prompt", bellList(cam));
  await openBell(ana);
  await shot(ana, "bells-block", "A block, as the tester reads it | Nora blocked Ana: Ana only reads “Your session on … ended.” (a block is never revealed)", bellList(ana));
}, { section: "Notifications and emails" });

// ---------- The owner's extra plan cases: 10 open tests, a draft on the free plan, red and blue together ----------
/** Fill Post a test with a valid listing (Open until `ou` days ahead). */
async function fillPost(page, title, ou = 14) {
  await page.waitForSelector("#productName");
  await page.fill("#productName", "Reef Rescue");
  await page.fill("#title", title);
  await page.fill("#description", "Play the first reef and tell us where you got lost.");
  await page.locator("#writtenPrice").fill("8.00");
  await page.fill("#questions", "What did you like?");
  await page.locator("#spots").fill("4");
  await page.locator("#openUntil").fill(day(ou));
}
group("plans2", async () => {
  // 1. A subscriber with 10 open tests (open, full and paused all count): Post is refused; a test stopped in another tab lets the next press through.
  const nora = await account(`dev+media${TS}p2@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}p2a@playtest.test`, "Ana Silva", "tester", "she");
  const admin = await adminAccount();
  setCard(nora.email, "pm_card_visa");
  ok(await post(nora, "/api/payments/subscription", { action: "subscribe", seenAt: nowIso() }), "subscribe");
  const ids = [];
  for (let i = 1; i <= 10; i++) ids.push(await postTest(nora, { productName: "Harbor Run", title: `Harbor Run: level ${i}`, spots: i === 2 ? "1" : "3" }));
  await join(ana, ids[1]); // full
  await adminDo(admin, "pause-test", ids[2], { note: "Media pass check" }); // paused
  {
    const A = await rec(V, nora), B = await rec(V, nora);
    await A.goto("/app/tests/new");
    await B.goto(`/app/tests/${ids[9]}`);
    const fromA = at(A), fromB = at(B);
    await fillPost(A, "Reef Rescue: first reef");
    await A.click("button:has-text('Post the test')");
    await A.waitForSelector("text=/You have 10 open tests/");
    await pause(A, 2000);
    await shotSpan(A, "plans-ten-tests-notice", "10 open tests | Post is refused under the button: “You have 10 open tests, the most you can have at once. Stop or close one to post another.” The form keeps its text", "button:has-text('Post the test')", A.locator("text=/You have 10 open tests/").last(), 16, 16);
    // The second tab stops one test.
    await B.click("button:has-text('Stop the test')");
    await B.waitForSelector("dialog[open]");
    await pause(B, 800);
    await B.click("dialog[open] button:has-text('Stop the test')");
    await B.waitForSelector("text=This test is stopped.");
    await pause(B, 1500);
    // The first tab presses Post again: it goes through (a drop in the count is never a stop-once reason).
    await A.click("button:has-text('Post the test')");
    await A.waitForURL((u) => /\/app\/tests\/\w+$/.test(u.pathname) && !u.pathname.endsWith("/new"), { timeout: 20000 });
    await pause(A, 3000);
    finishVideo([{ file: await saveVideo(A, "plans-ten-a.webm"), from: fromA }, { file: await saveVideo(B, "plans-ten-b.webm"), from: fromB }], "plans-ten-tests",
      "10 open tests (two tabs) | With 10 open tests (one full, one paused) Post is refused with the blue notice and the form keeps its text (left); the other tab stops one test (right); the next Post goes through");
  }
  // 2. The free plan with an open test: a draft can't be posted either.
  const omar = await account(`dev+media${TS}p2o@playtest.test`, "Omar Reyes", "developer", "he");
  setCard(omar.email, "pm_card_visa");
  ok(await post(omar, "/api/payments/subscription", { action: "subscribe", seenAt: nowIso() }), "subscribe");
  const t = await postTest(omar, { productName: "Tide Tracker", title: "Tide Tracker: widgets", categories: ["Productivity"] });
  await nextRound(omar, t);
  const draftId = sql(`select id from "Test" where "developerId" = '${omar.uid}' and status = 'draft' order by "createdAt" desc limit 1`);
  own(`update "User" set "subscriptionStatus" = 'ended', "subscriptionEndedAt" = (now() at time zone 'utc'), "subscriptionEndReason" = 'cancelled', "subscriptionCanceling" = false where email = ${lit(omar.email)}`); // (back on the free plan)
  await omar.goto(`/app/tests/new?draft=${draftId}`);
  await omar.waitForSelector("[data-draft-note]");
  await omar.locator("#openUntil").fill(day(14));
  await omar.click("button:has-text('Post the test')");
  await omar.waitForSelector("text=/You already have an open test/");
  await pause(omar, 800);
  sec("Post a test");
  await shotSpan(omar, "plans-draft-refused", "A draft on the free plan | Omar's subscription ended and he has an open test: posting the round-2 draft is refused with “You already have an open test. Subscribe ($7/month) to run several at once.” and Open Payments", "button:has-text('Post the test')", omar.locator("text=/You already have an open test/").last(), 16, 16);
  // 4. Red at the fields and a blue server notice together: an Open until out of range plus a second open test on the free plan.
  await omar.goto("/app/tests/new");
  await fillPost(omar, "Tide Tracker: alerts", 40);
  await omar.locator("#spots").click();
  await omar.click("button:has-text('Post the test')");
  await pause(omar, 2500);
  await shotFull(omar, "post-red-and-blue", "Red first, then blue | Open until 40 days ahead on the free plan with a test already open: the red at the field stops Post in the page, so the server's blue notice can't show yet");
  await omar.locator("#openUntil").fill(day(14));
  await omar.locator("#spots").click();
  await omar.click("button:has-text('Post the test')");
  await omar.waitForSelector("text=/You already have an open test/");
  await pause(omar, 800);
  await shotSpan(omar, "post-red-and-blue-then", "…then the blue notice | With the date fixed, the next press reaches the server and the blue notice appears under Post the test", "#openUntil", omar.locator("text=/You already have an open test/").last(), 16, 16);
}, { section: "Payments", fake: true });

group("postred", async () => {
  // 3. As many red field messages at once as Post allows.
  const dev = await account(`dev+media${TS}pr@playtest.test`, "Mina Park", "developer", "she");
  const P = phone() ? await rec(V, dev) : dev;
  await P.goto("/app/tests/new");
  await P.waitForSelector("#productName");
  const from = phone() ? at(P) : 0;
  await P.locator("#writtenPrice").fill("0.50");
  await P.locator("#spots").fill("60");
  await P.locator("#openUntil").fill(day(45));
  await P.locator("#ndaText").fill("x".repeat(400) + " " + "Don't share anything you see in this test with anyone outside Playtest. ".repeat(10));
  await P.locator("#questions").fill(["What did you like?", "Q: " + "Tell us everything about the second harbor, step by step. ".repeat(6)].join("\n"));
  await P.locator("#accessKeys").fill("KEY-1\nKEY-2");
  for (const id of ["productName", "title", "description", "spots", "openUntil", "accessKeys"]) await P.locator("#" + id).click();
  await P.click("button:has-text('Post the test')");
  await pause(P, 2500);
  await shotFull(P, "post-all-red", "Every red at once | Empty required fields, a price under $1, 60 spots, Open until 45 days ahead, an NDA over 1,000 characters, a question over 300 characters and fewer keys than spots, with the list above Post the test");
  if (phone()) {
    await P.evaluate(() => window.scrollTo(0, 0));
    await pause(P, 1000);
    for (let y = 0; y < 30; y++) { await P.mouse.wheel(0, 260); await P.waitForTimeout(280); }
    await pause(P, 1500);
    finishVideo([{ file: await saveVideo(P, "post-all-red.webm"), from }], "post-all-red-scroll", "Every red at once, scrolled | The phone form from top to bottom with every red message showing");
  }
}, { section: "Post a test" });

// ---------- Edit stops once for testers' actions (the owner's extra case) ----------
group("editstop", async () => {
  const nora = await account(`dev+media${TS}es@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}esa@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}esb@playtest.test`, "Ben Okafor", "tester", "he");
  const t = await postTest(nora, { productName: "Lumen Notes", title: "Lumen Notes private beta", categories: ["Productivity"], spots: "4", accessKeys: "K-1\nK-2\nK-3\nK-4\nK-5" });
  const sA = await join(ana, t); // K-1
  const E = await rec(V, nora);
  await E.goto(`/app/tests/${t}/edit`);
  await E.waitForSelector("#description");
  await pause(E, 1500);
  const from = at(E);
  // The developer changes the instructions…
  await E.locator("#description").click();
  await E.keyboard.press("End");
  await typeSlow(E, "#description", " Then write three notes and sync them.", 30);
  await pause(E, 800);
  // …meanwhile Ana sends her written answers and Ben joins (he is given K-2).
  await sendWritten(ana, sA);
  await join(ben, t);
  await E.locator("#keys").scrollIntoViewIfNeeded();
  await pause(E, 1500);
  await saveBtn(E).click();
  await E.waitForSelector("text=/Press Save again/", { timeout: 20000 });
  await pause(E, 2500);
  await shotSpan(E, "edit-stop-tester-change", "Save stops once for testers | Ana sent written answers and Ben joined while Edit was open: Save stops once with the blue list, and the key boxes and open spots are already up to date (K-2 is now Ben's)", "#keys", E.locator("text=/Press Save again/").last(), 12, 16);
  await saveBtn(E).click();
  await E.waitForURL(/saved=1/, { timeout: 20000 });
  await pause(E, 3000);
  finishVideo([{ file: await saveVideo(E, "edit-stop-tester-change.webm"), from }], "edit-stop-tester-change-video",
    "Edit stops once, then saves | The developer edits the instructions; Ana sends her answers and Ben joins (taking free key K-2); Save stops once with the list and the updated keys; the second press saves");
}, { section: "Edit" });

// ---------- Batch 15: the launch fixes (one case or more per item; the report's "Launch fixes" section) ----------
const LF = "Launch fixes";
/** An INSERT … RETURNING id: the id (psql adds the command tag on the next line). */
const sqlId = (q) => sql(q).split(String.fromCharCode(10))[0].trim();
const utcNow = "(now() at time zone 'utc')";
/** Opens the test page and scrolls an element into view (the pictures start from the top of the page anyway). */
async function open(page, url, sel) {
  await page.goto(url);
  if (sel) await page.waitForSelector(sel, { timeout: 20000 });
  await pause(page, 700);
}
/** A call that took place: both were in the call page from `from` minutes ago for `len` minutes (presence rows), then the length is made final by a page load. */
function tookPlace(callId, devId, testerId, from = 90, len = 29) {
  own(`update "Call" set "startsAt" = ${utcNow} - interval '${from} minutes', "devJoinedAt" = ${utcNow} - interval '${from} minutes', "testerJoinedAt" = ${utcNow} - interval '${from} minutes' where id = '${callId}'`);
  sql(`insert into "CallPresence" (id, "callId", "userId", side, "startAt", "endAt") values ('pr' || md5(random()::text), '${callId}', '${devId}', 'developer', ${utcNow} - interval '${from - 1} minutes', ${utcNow} - interval '${from - 1 - len} minutes'), ('pr' || md5(random()::text), '${callId}', '${testerId}', 'tester', ${utcNow} - interval '${from - 1} minutes', ${utcNow} - interval '${from - 1 - len} minutes')`);
}
const piece = (page, id) => page.locator(`#piece-${id}, #call-${id}`).first();

group("b15pay", async () => {
  const nora = await account(`dev+media${TS}lp@playtest.test`, "Nora Lane", "developer", "she");
  setCard(nora.email, "pm_card_visa");
  const ana = await account(`tester+media${TS}lpa@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}lpb@playtest.test`, "Ben Okafor", "tester", "he");
  const t = await postTest(nora, { writtenCents: "10.00" });
  const u = await postTest(nora, { title: "Harbor Run: open feedback", writtenCents: null, questions: [], liveRateCents: "30.00" });
  const sA = await join(ana, t), sB = await join(ben, u);
  await sendWritten(ana, sA);
  ok(await post(ben, `/api/sessions/${sB}/written`, { answers: ["The map is lovely, the boat is slow."], notes: "", ...go }), "written (unlisted)");
  const subA = subOf(sA), subB = subOf(sB);
  // (§30, §31) The listed box: one green Pay, the room beside the amount, the line under the button.
  await open(nora, `/app/tests/${t}`, `#piece-${subA}`);
  await shot(nora, "b15-31-paybox", "§31 The Pay box | One green Pay; beside the amount the room left (“up to $10.00 above the listing”); the note is optional; “Ana Silva can dispute the amount once.”", `#piece-${subA}`);
  const P = await rec(V, nora);
  await open(P, `/app/tests/${t}`, `#piece-${subA}`);
  await P.locator(`#amt-${subA}`).scrollIntoViewIfNeeded();
  const from = at(P);
  await P.locator(`#amt-${subA}`).fill("");
  await typeSlow(P, `#amt-${subA}`, "25.00", 120);
  await pause(P, 1500);
  await shot(P, "b15-31-paybox-over", "§31 Over the cap, red as you type | $25.00 is more than the listing plus 100%: “This is more than you can pay above the listing (up to $10.00).” and Pay is disabled", `#piece-${subA}`);
  await P.locator(`#amt-${subA}`).fill("");
  await typeSlow(P, `#amt-${subA}`, "0", 120);
  await pause(P, 1500);
  await shot(P, "b15-30-zero-reason", "§30 $0 needs a reason | At $0 the note is required, in red at the box: “Say why you're paying $0 (the tester reads it).”", `#piece-${subA}`);
  await typeSlow(P, `#why-${subA}`, "The answers were for another build.", 30);
  await pause(P, 800);
  await P.locator(`#amt-${subA}`).fill("");
  await typeSlow(P, `#amt-${subA}`, "12.00", 120);
  await P.locator(`#piece-${subA} [data-pay-tick] input`).check();
  await pause(P, 1200);
  await P.locator(`#piece-${subA} button:has-text('Pay')`).first().click();
  await P.waitForSelector(`text=/Paid \\$12\\.00/`).catch(() => {});
  await pause(P, 2500);
  finishVideo([{ file: await saveVideo(P, "b15-31-paybox.webm"), from }], "b15-31-paybox-video", "§30 and §31 The Pay box live | An amount over the cap turns red at once; $0 asks for a reason; a valid amount with its tick pays");
  await open(nora, `/app/tests/${u}`, `#piece-${subB}`);
  await shot(nora, "b15-30-unlisted", "§30 An unlisted part | No Reject anywhere: “This part isn't listed: pay any amount, $0 included. Ben Okafor can dispute the amount once.”", `#piece-${subB}`);
  await rejectPiece(nora, subB, "Thanks, the open feedback came after we'd shipped this build.");
  await open(ben, `/app/sessions/${sB}`, "#parts");
  await shot(ben, "b15-30-paid-zero-tester", "§30 Paid $0, as the tester reads it | “Paid $0: “<reason>”” on the part; it can be disputed once like any amount", "#part-written");
}, { section: LF, fake: true });

group("b15calls", async () => {
  const nora = await account(`dev+media${TS}lc@playtest.test`, "Nora Lane", "developer", "she");
  setCard(nora.email, "pm_card_visa");
  const ana = await account(`tester+media${TS}lca@playtest.test`, "Ana Silva", "tester", "she", { phone: true });
  const t = await postTest(nora, { liveRateCents: "30.00", spots: "3" });
  const sA = await join(ana, t);
  // §40 The call page: both people open it; their pages send a heartbeat every ~10 seconds.
  const call = await bookCall(nora, ana, t, sA, 0.1);
  own(`update "Call" set "startsAt" = ${utcNow} - interval '2 minutes' where id = '${call}'`);
  const D = await rec(V, nora), T = await rec(PHONE, ana);
  await D.goto(`/app/calls/${call}`);
  await T.goto(`/app/calls/${call}`);
  const fromD = at(D), fromT = at(T);
  await pause(D, 12000);
  const beats = sql(`select count(*) from "CallPresence" where "callId" = '${call}'`);
  console.log(`   call presence rows: ${beats}`);
  finishVideo([{ file: await saveVideo(D, "b15-40-call-d.webm"), from: fromD }, { file: await saveVideo(T, "b15-40-call-t.webm"), from: fromT }], "b15-40-call-page",
    "§40 Both in the call | The developer (left) and Ana (right, phone) in the call page: “the length is measured while you're both here”; each page tells the site every ~10 seconds");
  // The call ran 29 minutes with both there (the presence the pages recorded, stretched to a whole call for the picture); both left.
  sql(`delete from "CallPresence" where "callId" = '${call}'`);
  tookPlace(call, nora.uid, ana.uid, 90, 29);
  await open(nora, `/app/tests/${t}`, `#call-${call}`);
  await shot(nora, "b15-40-measured", "§40 The measured length | “Length: 29 min (both in the call …)”; the Pay box's Rate and Amount use it; “Lower the length” is under it", `#call-${call}`);
  // Rate and Amount fill each other.
  const R = await rec(V, nora);
  await open(R, `/app/tests/${t}`, `#call-${call}`);
  await R.locator(`#rate-${call}`).scrollIntoViewIfNeeded();
  const fromR = at(R);
  await R.locator(`#rate-${call}`).fill("");
  await typeSlow(R, `#rate-${call}`, "40", 150);
  await pause(R, 1500);
  await R.locator(`#amt-${call}`).fill("");
  await typeSlow(R, `#amt-${call}`, "10.00", 150);
  await pause(R, 2000);
  await shot(R, "b15-40-rate-amount", "§40 Rate and Amount fill each other | Typing $40/h filled $19.33; typing $10.00 filled the rate back ($20.69/h); the one typed last wins on the server too", `#call-${call}`);
  finishVideo([{ file: await saveVideo(R, "b15-40-rate.webm"), from: fromR }], "b15-40-rate-amount-video", "§40 Rate and Amount, live | A rate fills the amount (rate × 29 min); an amount fills the rate (to the cent per hour)");
  // Lower the length, with a reason the tester reads.
  await open(nora, `/app/tests/${t}`, `#call-${call}`);
  await nora.locator(`#call-${call} [data-lower-length] > summary`).click();
  await nora.locator(`#call-${call} [data-lower-length] input`).fill("20");
  await nora.locator(`#lower-why-${call}`).fill("We spent the first 9 minutes fixing my microphone.");
  await shot(nora, "b15-40-lower", "§40 Lower the length | Only lower, never raise; a reason is required and the tester reads it", `#call-${call}`);
  await nora.locator(`#call-${call} [data-lower-length] button:has-text('Lower the length')`).click();
  await nora.waitForSelector("text=/lowered from 29 min/", { timeout: 20000 });
  await pause(nora, 800);
  await shot(nora, "b15-40-lowered", "§40 Lowered | “Length: 20 min (lowered from 29 min; both in the call …)” with the reason in italics; the Pay box now uses 20 minutes", `#call-${call}`);
  await open(ana, `/app/sessions/${sA}`, "#part-live");
  await shot(ana, "b15-40-tester-view", "§40 The tester's view | Ana reads the measured length, that it was lowered to 20 min, and why", "#part-live");
}, { section: LF, fake: true });

group("b15ceiling", async () => {
  const nora = await account(`dev+media${TS}lk@playtest.test`, "Nora Lane", "developer", "she");
  setCard(nora.email, "pm_card_visa");
  const ana = await account(`tester+media${TS}lka@playtest.test`, "Ana Silva", "tester", "she");
  const t = await postTest(nora, { liveRateCents: "150.00", spots: "3" });
  const sA = await join(ana, t);
  await bookCall(nora, ana, t, sA, 48, 180);
  await bookCall(nora, ana, t, sA, 72, 180);
  // $900 of the $1,000 is booked: the warning shows wherever calls are requested, offered, accepted or paid.
  const D = await rec(V, nora);
  await open(D, `/app/tests/${t}`, "#calls");
  await liveSession(D).scrollIntoViewIfNeeded();
  const from = at(D);
  await pause(D, 1500);
  await shot(D, "b15-34-warning", "§34 The warning | “$100.00 left of the $1,000 for calls with Ana Silva on this test.”: small, no stop", liveSession(D));
  await D.check("section[aria-label='Call requests'] label:has-text('Ana Silva') input");
  const when = new Date(Date.now() + 5 * 86400000);
  await D.fill("section[aria-label='Call requests'] input[type=datetime-local]", new Date(when.getTime() - when.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  await D.fill("section[aria-label='Call requests'] input[aria-label='Length in minutes']", "60");
  await pause(D, 800);
  await D.click("section[aria-label='Call requests'] >> text=Request a time");
  await D.waitForSelector("text=/can come to at most \\$1,000/", { timeout: 15000 });
  await pause(D, 2500);
  await shot(D, "b15-34-refused", "§34 Refused at the limit | “Calls with Ana Silva on this test can come to at most $1,000; $100.00 is left, so this call can't be booked.”", liveSession(D));
  finishVideo([{ file: await saveVideo(D, "b15-34.webm"), from }], "b15-34-ceiling", "§34 One $1,000 for a tester's calls | The warning under an hour's worth, then a 60-minute request at $150/h refused with what's left");
  await open(ana, `/app/sessions/${sA}`, "#part-live");
  await shot(ana, "b15-34-tester", "§34 The tester's wording | “$100.00 left of the $1,000 for your calls on this test.”", "#part-live");
}, { section: LF, fake: true });

group("b15live", async () => {
  const nora = await account(`dev+media${TS}ll@playtest.test`, "Nora Lane", "developer", "she");
  setCard(nora.email, "pm_card_visa");
  const ana = await account(`tester+media${TS}lla@playtest.test`, "Ana Silva", "tester", "she");
  const t = await postTest(nora, { liveRateCents: "30.00", spots: "3" });
  const sA = await join(ana, t);
  // 6 booked: a weekly set of 6.
  const d0 = new Date(Date.now() + 26 * 3600000); d0.setSeconds(0, 0);
  ok(await post(nora, `/api/tests/${t}/request-time`, { ...go, contractIds: [sA], minutes: 30, rows: [{ startsAt: d0.toISOString(), repeat: "weekly", count: 6 }] }), "weekly request");
  const reqId = sql(`select id from "CallRequest" where "contractId" = '${sA}' and status = 'pending' order by "createdAt" desc limit 1`);
  ok(await post(ana, `/api/sessions/${sA}/answer-request`, { ...go, requestId: reqId, action: "accept" }), "accept weekly");
  // 4 that are over: one took place (paid), one cancelled by Ana with a reason, one nobody joined, one missed when the site was down.
  const c1 = await bookCall(nora, ana, t, sA, 400);
  tookPlace(c1, nora.uid, ana.uid, 60 * 24 * 3, 29);
  await nora.goto(`/app/tests/${t}`); // the page load makes its length final
  ok(await post(nora, "/api/review", { kind: "call", id: c1, amount: "14.50", rate: "30.00", typed: "amount", tickedCents: 1450, payKey: require("crypto").randomUUID(), ...go }), "pay call");
  const mk = (h, status, by, note) => own(`insert into "Call" (id, "slotId", "contractId", "startsAt", minutes, "rateCents", status, "cancelledBy", "cancelledAt", "cancelNote", "devMarks") select 'mc' || md5(random()::text), "slotId", "contractId", ${utcNow} - interval '${h} hours', 30, 3000, '${status}', ${by ? `'${by}'` : "null"}, ${utcNow} - interval '${h + 2} hours', ${note ? lit(note) : "''"}, ARRAY[]::text[] from "Call" where id = '${c1}'`);
  mk(30, "cancelled", "tester", "My internet is down all day, sorry.");
  mk(54, "cancelled", "system", "Nobody joined, so the call was cancelled.");
  mk(80, "cancelled", "system", "missed because the site was down");
  await open(nora, `/app/tests/${t}`, "#calls");
  await liveSession(nora).scrollIntoViewIfNeeded();
  await shot(nora, "b15-33-live-session", "§33 and §42 Live session: calls ahead only | Each tester's booked calls in a scroll box about 3 calls tall, soonest first; calls that are over moved to the tester's row", liveSession(nora));
  await nora.locator(`[data-calls-fold="${sA}"] > summary`).click();
  await pause(nora, 600);
  await shot(nora, "b15-42-tester-row", "§42 The tester row's Calls (4) | Took place · 29 min · paid $14.50 (with Pay more), Cancelled by Ana Silva · <time> with her reason, Nobody joined, Missed: the site was down", `#tester-${sA}`);
  await open(ana, `/app/sessions/${sA}`, "#call-history");
  await ana.locator("#call-history > summary").click();
  await pause(ana, 600);
  await shot(ana, "b15-42-call-history", "§42 The tester's Call history | The same calls and badges on Ana's session page; her Live session keeps only the calls ahead", "#call-history");
}, { section: LF, fake: true });

group("b15stops", async () => {
  const nora = await account(`dev+media${TS}ls@playtest.test`, "Nora Lane", "developer", "she");
  setCard(nora.email, "pm_card_visa");
  const ana = await account(`tester+media${TS}lsa@playtest.test`, "Ana Silva", "tester", "she", { phone: true });
  const ben = await account(`tester+media${TS}lsb@playtest.test`, "Ben Okafor", "tester", "he");
  const t = await postTest(nora, { recordingCents: "15.00", spots: "4" });
  const sA = await join(ana, t), sB = await join(ben, t);
  // §36 The developer's stop box: Ben sends while the page is open; Pay on Ana's recording stops once.
  const recA = sqlId(`insert into "Submission" (id, "contractId", kind, "agreedCents", "sentAt", "updatedAt", "payBy", "devMarks") values ('ms' || md5(random()::text), '${sA}', 'recording', 1500, ${utcNow}, ${utcNow}, ${utcNow} + interval '7 days', ARRAY[]::text[]) returning id`);
  await open(nora, `/app/tests/${t}`, `#piece-${recA}`);
  await sendWritten(ben, sB);
  await nora.locator(`#piece-${recA} [data-pay-tick] input`).check();
  await nora.locator(`#piece-${recA} button:has-text('Pay')`).first().click();
  await nora.waitForSelector(`#piece-${recA} [data-stop-box]`);
  await pause(nora, 800);
  await shot(nora, "b15-36-dev-box", "§36 Every stop box names the press | “Your Pay on Ana Silva's recording didn't go through.” · Since you opened this page: … · the Alerts line · bold “Press Pay again to go ahead.”", `#piece-${recA}`);
  // The tester's stop-once: Ana has typed an answer; the developer pays her recording; Send stops once, the second goes.
  const T = await rec(V, ana);
  await open(T, `/app/sessions/${sA}`, "#a0");
  await T.locator("#a0").scrollIntoViewIfNeeded();
  const fromT = at(T);
  await typeSlow(T, "#a0", "The harbor lights are beautiful.", 30);
  await T.locator("#a1").fill("The second bridge.");
  await pause(T, 600);
  ok(await post(nora, "/api/review", { kind: "submission", id: recA, amount: "15.00", tickedCents: 1500, payKey: require("crypto").randomUUID(), ...go }), "pay recording");
  await pause(T, 800);
  await T.click("button:has-text('Send my answers')");
  await T.waitForSelector("[data-stop-box]");
  await pause(T, 2500);
  await shot(T, "b15-36-tester-box", "§36 The tester's stop box | Send stops once: “Your Send didn't go through.” · Nora Lane paid $15.00 for your recording · “Turn off alerts” · “Press Send again to go ahead.”", T.locator("[data-stop-box]").first());
  await T.click("button:has-text('Send my answers')");
  await T.waitForSelector("text=/^Sent [A-Z]/").catch(() => {});
  await pause(T, 2500);
  finishVideo([{ file: await saveVideo(T, "b15-36-tester.webm"), from: fromT }], "b15-36-tester-stop-once", "§36 The tester's stop-once | Ana has typed her answers; the developer pays her recording; Send stops once with the blue list; the second press sends");
  // Charge stops once after the developer paid something.
  const sub = subOf(sA);
  own(`update "Submission" set "choiceOfferedAt" = ${utcNow}, "choiceBy" = ${utcNow} + interval '7 days', "payBy" = ${utcNow} - interval '1 day' where id = '${sub}'`);
  await open(ana, `/app/sessions/${sA}`, "#part-written");
  const recB = sqlId(`insert into "Submission" (id, "contractId", kind, "agreedCents", "sentAt", "updatedAt", "payBy", "devMarks") values ('ms' || md5(random()::text), '${sB}', 'recording', 1500, ${utcNow}, ${utcNow}, ${utcNow} + interval '7 days', ARRAY[]::text[]) returning id`);
  void recB;
  await apiEdit(nora, t, { description: "Sail through the first three harbors at night." });
  await ana.locator("#part-written [data-pay-tick] input, #part-written input[type=checkbox]").first().check().catch(() => {});
  await ana.locator("#part-written button:has-text('Charge')").first().click().catch(() => {});
  await ana.waitForSelector("[data-stop-box]", { timeout: 15000 }).catch(() => {});
  await pause(ana, 800);
  await shot(ana, "b15-36-charge-stop", "§36 Charge stops once | The developer changed the listing after the page loaded: Charge stops once and names itself", "#part-written");
  // §26 Alerts Off: a change that isn't Ana's contract never stops Send; new terms still do.
  await open(ben, `/app/sessions/${sB}`, "[data-tester-alerts]");
  await shot(ben, "b15-26-toggle-on", "§26 The tester's Alerts toggle | At the top right: “Alerts: On” and its line", "[data-tester-alerts]");
  await ben.click("[data-tester-alerts] button");
  await ben.waitForSelector("[data-tester-alerts='off']");
  await shot(ben, "b15-26-toggle-off", "§26 Alerts: Off | One press, saved for all Ben's tests: only new terms from the developer stop a press now", "[data-tester-alerts]");
  await ben.reload();
  await ben.waitForSelector("#a0");
  await ben.locator("#a0").fill("Second try: the fog level is still too dark.");
  ok(await post(nora, "/api/review", { kind: "submission", id: subOf(sB), amount: "15.00", tickedCents: 1500, payKey: require("crypto").randomUUID(), ...go }), "pay Ben");
  await waitLive(ben, "[data-live-top]");
  await ben.click("button:has-text('Send my updated answers'), button:has-text('Send my answers')");
  await ben.waitForSelector("p.ok", { timeout: 15000 }).catch(() => {});
  await pause(ben, 1200);
  await shotSpan(ben, "b15-26-off-goes", "§26 Alerts Off: Send goes through | Nora paid Ben after his page loaded: the live box shows it greyed (it won't stop anything) and Send went straight through", "[data-live-top]", ben.locator("p.ok").first(), 12, 16);
  await apiEdit(nora, t, { writtenCents: "12.00" });
  await ben.locator("#a0").fill("Third try.");
  await ben.click("button:has-text('Send my updated answers'), button:has-text('Send my answers')");
  await ben.waitForSelector("#terms-offer", { timeout: 15000 }).catch(() => {});
  await pause(ben, 1500);
  await shot(ben, "b15-26-off-terms-stop", "§26 New terms still stop | With Alerts Off, a terms offer still stops the press: the page goes up to the offer box (Switch or Keep)", "#terms-offer");
  // §25 Leave never stops: after a change, Leave goes through on the first press.
  await open(ana, `/app/sessions/${sA}`, "main");
  await apiEdit(nora, t, { description: "Sail through all three harbors at night." });
  await ana.click("button:has-text('Leave')").catch(() => {});
  await ana.waitForSelector("dialog[open]").catch(() => {});
  await ana.click("dialog[open] button:has-text('Leave')").catch(() => {});
  await ana.waitForSelector("text=You left this test.", { timeout: 15000 });
  await shot(ana, "b15-25-leave", "§25 Leave never stops | The listing changed after the page loaded; Leave (after its own confirm) went through on the first press", ana.locator(".info", { hasText: "You left this test." }).first());
}, { section: LF, fake: true });

group("b15paused", async () => {
  const nora = await account(`dev+media${TS}lr@playtest.test`, "Nora Lane", "developer", "she");
  setCard(nora.email, "pm_card_visa");
  const ana = await account(`tester+media${TS}lra@playtest.test`, "Ana Silva", "tester", "she");
  const admin = await adminAccount();
  const t = await postTest(nora, { liveRateCents: "30.00", spots: "6" });
  const sA = await join(ana, t);
  // (A suspension cancels the calls in the next 3 days; these are later.)
  await bookCall(nora, ana, t, sA, 120);
  await bookCall(nora, ana, t, sA, 144);
  // Five testers dispute a $0 payment each: the dashboard box with 5 disputes scrolls.
  for (const [i, n] of ["Ben Okafor", "Cam Lee", "Dee Marsh", "Eli Novak", "Fay Ito"].entries()) {
    const x = await account(`tester+media${TS}lr${i}@playtest.test`, n, "tester", "they");
    const s = await join(x, t);
    await sendWritten(x, s);
    await rejectPiece(nora, subOf(s), "These answers are about another game.");
    ok(await post(x, `/api/sessions/${s}/dispute`, { ...go, kind: "submission", id: subOf(s), reason: "I played Harbor Run for an hour and answered both questions about it." }), "dispute");
  }
  await adminDo(admin, "suspend", nora.uid, { note: "Media pass check: several testers reported unpaid work", side: "developer" });
  const D = await rec(V, nora);
  await open(D, "/app", "[data-restricted-box]");
  const from = at(D);
  await shot(D, "b15-27-disputes-box", "§27 Disputes: add your side | While suspended, the dashboard lists each open dispute with the tester's text and the Add your side box; more than 3 scroll", "[data-dispute-box]");
  await card(D, "Harbor Run: first 3 levels").locator("a").first().click();
  await D.waitForSelector("[data-test-banner]");
  await pause(D, 1500);
  await shotFull(D, "b15-29-restricted-view", "§29 and §37 The restricted view | A suspended developer opens the test from its card: the red banner (title, reason, what's allowed), the overview with Stop and End early, Booked calls with Cancel");
  await D.locator("[data-restricted-calls] summary").first().click();
  await D.locator("[data-restricted-calls] button:has-text('Cancel this call')").first().click();
  await pause(D, 2000);
  await D.click("button:has-text('Stop the test')");
  await D.waitForSelector("dialog[open]");
  ok(await post(ana, `/api/sessions/${sA}/leave`, { ...go, reason: "Something came up" }), "leave (a change after the page loaded)");
  await D.click("dialog[open] button:has-text('Stop the test')");
  await D.waitForURL((u) => u.pathname === "/app", { timeout: 20000 }).catch(() => {});
  await D.waitForSelector("[data-done-line]").catch(() => {});
  await pause(D, 2500);
  await shot(D, "b15-29-done", "§29 Done | Stop went through silently (no stop-once, whatever changed) and the dashboard top says “Done: you stopped Harbor Run: first 3 levels.”", "[data-done-line]");
  finishVideo([{ file: await saveVideo(D, "b15-29.webm"), from }], "b15-29-restricted", "§29 A suspended developer's test page | From the card to the restricted view; a call cancelled; Stop goes through and the dashboard says it's done");
  // §37 The banner for each cause, and §39's limited Alerts.
  await adminDo(admin, "unsuspend", nora.uid, { side: "developer" });
  const t2 = await postTest(nora, { title: "Harbor Run: reef", spots: "3" });
  await join(ana, t2);
  await adminDo(admin, "pause-test", t2, { note: "Media pass check: " + "a tester reported that the build link opens a different game, so we paused this test while we look. ".repeat(10).slice(0, 975) });
  await open(nora, `/app/tests/${t2}`, "[data-test-banner]");
  await shot(nora, "b15-37-team-paused", "§37 and §20 The team paused this test | Title, the 1,000-character reason in italics in its scroll box, and at the bottom “For now you can stop this test, end testers' work early, or cancel calls.”", "[data-test-banner]");
  await nora.click("[data-alerts-menu] > summary");
  await pause(nora, 500);
  await shot(nora, "b15-39-alerts-paused", "§39 Alerts on a paused test | Only what can still happen: testers leaving, call changes, payments, disputes, the team's decisions, your own saves", nora.locator("[data-alerts-menu]"));
  await adminDo(admin, "unpause-test", t2);
  hold(nora.email);
  await open(nora, `/app/tests/${t2}`, "[data-test-banner]");
  await shot(nora, "b15-37-hold", "§37 A payment hold | “Your tests are paused until you pay what you owe.” on the same banner", "[data-test-banner]");
  own(`update "User" set "holdStartedAt" = null, "holdReason" = '' where email = ${lit(nora.email)}`);
  await stopTest(nora, t2);
  await open(nora, `/app/tests/${t2}`, "[data-test-banner]");
  await shot(nora, "b15-37-stopped", "§37 Stopped by the developer | “This test is stopped.” and what still works, built from the buttons shown (with Next round)", "[data-test-banner]");
  await nora.click("[data-alerts-menu] > summary");
  await pause(nora, 500);
  await shot(nora, "b15-39-alerts-stopped", "§39 Alerts on a stopped test | Payments, disputes, the team's decisions and your own saves only", nora.locator("[data-alerts-menu]"));
  const t3 = await postTest(nora, { title: "Harbor Run: shipwreck", spots: "3" });
  await join(ana, t3);
  await adminDo(admin, "stop-test", t3, { note: "Media pass check: the build link is broken" });
  await open(nora, `/app/tests/${t3}`, "[data-test-banner]");
  await shot(nora, "b15-37-team-stopped", "§37 The team stopped this test | The same banner; Next round isn't offered after a team stop, so the allowed line doesn't list it", "[data-test-banner]");
}, { section: LF, fake: true });

group("b15contract", async () => {
  const nora = await account(`dev+media${TS}lt@playtest.test`, "Nora Lane", "developer", "she");
  setCard(nora.email, "pm_card_visa");
  const ana = await account(`tester+media${TS}lta@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}ltb@playtest.test`, "Ben Okafor", "tester", "he");
  const cam = await account(`tester+media${TS}ltc@playtest.test`, "Cam Lee", "tester", "they");
  const t = await postTest(nora, { spots: "5" });
  const sA = await join(ana, t), sB = await join(ben, t), sC = await join(cam, t);
  void sC;
  const offerOf = (s) => sql(`select id from "TermsOffer" where "contractId" = '${s}' and status = 'open' order by "createdAt" desc limit 1`);
  await apiEdit(nora, t, { writtenCents: "12.00" });
  ok(await post(ana, `/api/sessions/${sA}/terms`, { ...go, choice: "switch", offerId: offerOf(sA) }), "switch");
  ok(await post(ben, `/api/sessions/${sB}/terms`, { ...go, choice: "keep", offerId: offerOf(sB) }), "keep");
  await apiEdit(nora, t, { title: "Harbor Run: night harbors", productName: "Harbor Run" });
  await apiEdit(nora, t, { questions: ["What did you like?", "Where did you get stuck at night?", "Would you play level 4?"] });
  ok(await post(ana, `/api/sessions/${sA}/terms`, { ...go, choice: "switch", offerId: offerOf(sA) }), "switch 2");
  await open(nora, `/app/tests/${t}`, "#contract-changes");
  await nora.click("#contract-changes > summary");
  await pause(nora, 800);
  await shot(nora, "b15-43-contract-changes", "§43 Contract changes | One entry per Save that changed terms or names, newest first: before → after, Switched / Kept / Not decided yet (names link to the rows), and each Save's effects", "#contract-changes");
  await shot(nora, "b15-24-rename-row", "§24 Renames in the tester row | “Renamed: “Harbor Run · Harbor Run: first 3 levels” → “Harbor Run · Harbor Run: night harbors”” in each working tester's contract changes", `#tester-${sA}`);
  await open(ana, `/app/sessions/${sA}`, "main");
  await ana.locator("[data-terms-history]").locator("xpath=ancestor::details[1]").evaluate((d) => { d.open = true; });
  await pause(ana, 600);
  await shot(ana, "b15-43-tester-history", "§43 The tester's own deal history | The terms she joined on, each offer and what she chose, the rename, her earlier questions, and payments, in order; never others' choices", "[data-terms-history]");
}, { section: LF, fake: true });

group("b15keys", async () => {
  const nora = await account(`dev+media${TS}ly@playtest.test`, "Nora Lane", "developer", "she");
  setCard(nora.email, "pm_card_visa");
  const ana = await account(`tester+media${TS}lya@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}lyb@playtest.test`, "Ben Okafor", "tester", "he");
  const cam = await account(`tester+media${TS}lyc@playtest.test`, "Cam Lee", "tester", "they");
  const t = await postTest(nora, { spots: "4", accessKeys: "HR-1111\nHR-2222\nHR-3333\nHR-4444\nHR-5555" });
  const sA = await join(ana, t), sB = await join(ben, t), sC = await join(cam, t);
  ok(await post(ben, `/api/sessions/${sB}/key-broken`, go), "key broken");
  ok(await post(cam, `/api/sessions/${sC}/key-broken`, go), "key broken (Cam)");
  // §45 The broken-key warning on the test page.
  await open(nora, `/app/tests/${t}`, "[data-keys-warning]");
  await shot(nora, "b15-45-warning", "§45 Keys that don't work | “2 testers' keys don't work: Ben Okafor (HR-2222), Cam Lee (HR-3333)”, each with its tick and Works now; Select all; Dismiss selected", "[data-keys-notice]");
  await nora.locator("[data-keys-warning] li", { hasText: "Ben Okafor" }).locator("input").first().check();
  await nora.locator("[data-keys-warning] li", { hasText: "Ben Okafor" }).locator("label:has-text('Works now') input").check();
  await nora.locator("[data-keys-warning] li", { hasText: "Cam Lee" }).locator("input").first().check();
  await pause(nora, 400);
  await shot(nora, "b15-45-ticked", "§45 Two ticked, one works now | “Dismiss 2”: Ben's key is marked as working again, Cam's warning is only hidden", "[data-keys-notice]");
  await nora.click("[data-keys-warning] button:has-text('Dismiss')");
  await pause(nora, 1500);
  await nora.reload();
  await nora.waitForSelector("[data-keys-notice]");
  await shot(nora, "b15-45-dismissed", "§45 Dismissed | The warning is gone; HR-2222 is no longer crossed out, HR-3333 still is", "[data-keys-notice]");
  await open(ben, `/app/sessions/${sB}`, "#access-key");
  await shot(ben, "b15-45-tester", "§45 The tester reads it | “The developer marked your key as working.” (his next older-page press stops once for it, even with Alerts Off)", "#access-key");
  // §19 and §44 The Free box, and keys typed back from testers who left.
  ok(await post(cam, `/api/sessions/${sC}/leave`, { ...go, reason: "Moving on" }), "leave");
  ok(await post(ana, `/api/sessions/${sA}/leave`, { ...go, reason: "Done" }), "leave Ana");
  await open(nora, `/app/tests/${t}/edit`, "#keysFree");
  await nora.locator("#keys").scrollIntoViewIfNeeded();
  await shot(nora, "b15-19-free-box", "§19 One Free box | Every free key one per line (“Free (2 keys · 2 open spots)”); In use lists Ben's key, and greyed, Ana's and Cam's “(left)”", "#keys");
  await addKeys(nora, "HR-1111\nHR-3333");
  await nora.locator("#spots").click();
  await pause(nora, 600);
  await shot(nora, "b15-44-reused", "§44 Typed back, with a warning | “HR-1111: reused, previously given to Ana Silva.” and “HR-3333: reported as broken by Cam Lee.”: a Reused tag, never a mistake", "#keys");
  await saveBtn(nora).click();
  await nora.waitForURL(/saved=1/, { timeout: 20000 });
  await nora.waitForSelector("[data-keys-notice]");
  await shot(nora, "b15-44-chips", "§44 The notice chips | “HR-1111 · reused (Ana Silva)” and “HR-3333 · reported as broken (Cam Lee)”", "[data-keys-notice]");
  await open(nora, `/app/tests/${t}/edit`, "#keysFree");
  await addKeys(nora, "HR-2222");
  await nora.locator("#spots").click();
  await pause(nora, 600);
  await shot(nora, "b15-19-in-use", "§19 A working tester's key | Red at once: “HR-2222 is in use by Ben Okafor, so it can't be added.”", "#keys");
}, { section: LF, fake: true });

group("b15admin", async () => {
  const nora = await account(`dev+media${TS}la@playtest.test`, "Nora Lane", "developer", "she");
  setCard(nora.email, "pm_card_visa");
  const ana = await account(`tester+media${TS}laa@playtest.test`, "Ana Silva", "tester", "she");
  const a1 = await adminAccount();
  adminP = null;
  const a2 = await account(`admin2+media${TS}${GROUP}@playtest.test`, "Second Admin", "developer", "they");
  own(`update "User" set "isAdmin" = true where email = ${lit(a2.email)}`);
  const t = await postTest(nora, { spots: "3" });
  const sA = await join(ana, t);
  await sendWritten(ana, sA, ["Long answer. " + "The harbor lights, the boat's handling, the second bridge, the map. ".repeat(140), "The second bridge."]);
  const sub = subOf(sA);
  await rejectPiece(nora, sub, "These answers don't match the build.");
  ok(await post(ana, `/api/sessions/${sA}/dispute`, { ...go, kind: "submission", id: sub, reason: "I played the build for an hour; every answer is about it." }), "dispute");
  await open(a1, "/admin", "#disputes");
  await a1.locator("#disputes [data-dispute-work] > summary").first().click();
  await pause(a1, 800);
  await shot(a1, "b15-08-see-the-work", "§8 See the work | Each dispute row opens the piece as the developer sees it: the answers under their questions in the scroll box (a 10,000-character answer here)", a1.locator("#disputes [data-dispute-row]").first());
  // §21 Two admins: one stops a test; the other sees who and is refused by name.
  const t2 = await postTest(nora, { title: "Harbor Run: reef", spots: "3" });
  await adminDo(a1, "stop-test", t2, { note: "Media pass check: broken build" });
  await open(a2, "/admin", "#disputes");
  const r = await post(a2, "/api/admin/stop-test", { id: t2, note: "Also broken" });
  console.log("   second admin's stop:", r.status, JSON.stringify(r.body).slice(0, 160));
  await a2.goto("/admin#tests");
  await pause(a2, 1200);
  await shot(a2, "b15-21-stopped-by", `§21 Which admin | The tests list names the admin by email: “stopped by ${a1.email}”; developers and testers still read “the team”`, a2.locator("text=/stopped by admin/").first().locator("xpath=ancestor::li[1]"));
  // Contact us: a 50,000-character message in the admin list, with Mark replied.
  const u = await account(`tester+media${TS}lau@playtest.test`, "Hal Jensen", "tester", "he");
  ok(await post(u, "/api/help", { topic: "A payment", message: "Hello team, here is everything that happened. " + "I sent my answers, the developer paid $0 and I disputed it; ".repeat(820) }), "contact us");
  await open(a1, "/admin", "#contact");
  await shot(a1, "b15-21-contact", "§21 Contact us in the admin list | A 50,000-character message in a scroll box about 8 lines tall, with Mark replied", a1.locator("#contact [data-contact-row]").first());
  await a1.locator("#contact [data-contact-row]").first().locator("button:has-text('Mark replied')").click();
  await pause(a1, 1500);
  await a2.goto("/admin");
  await a2.waitForSelector("#contact");
  await shot(a2, "b15-21-replied", "§21 Replied by | The other admin sees who replied and when", a2.locator("#contact [data-contact-row]").first());
}, { section: LF, fake: true });

group("b15misc", async () => {
  const nora = await account(`dev+media${TS}lm@playtest.test`, "Nora Lane", "developer", "she");
  setCard(nora.email, "pm_card_visa");
  const ana = await account(`tester+media${TS}lma@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}lmb@playtest.test`, "Ben Okafor", "tester", "he");
  // §18 Every tester gets the same days; Open until is the last day to join.
  const t = await postTest(nora, { openUntil: day(14), liveRateCents: "30.00", questions: ["What did you like? " + "Tell us about the boats, the harbors and the music in as much detail as you like. ".repeat(40), "Where did you get stuck?"], description: "Steps: " + "Open the build, sail out of the first harbor, follow the lights and note anything confusing. ".repeat(60) });
  const inviteOnly = await postTest(nora, { title: "Harbor Run: friends and family", joinMode: "invite" });
  await open(ana, "/app/find", "main");
  await shot(ana, "b15-18-find", "§18 and §38 Find tests | “14 days per tester · join by <date>”; the invite-only test is never listed, not even for invited testers", "main");
  await open(ana, `/app/find/${t}`, "main");
  await shot(ana, "b15-18-join-page", "§18, §3 and §17 The join page | “Your deadline: <date> (14 days from joining)”; a long question and 5,000-character steps in their scroll boxes", "main");
  void inviteOnly;
  const sA = await join(ana, t);
  // §38 Join everywhere; a stale Join names who cancelled and when.
  const call = await bookCall(nora, ana, t, sA, 0.12);
  await open(ana, "/app", "#upcoming-calls");
  await shot(ana, "b15-35-upcoming-join", "§35 and §38 Upcoming calls | The tester dashboard's Upcoming calls has Join while the call can be joined", "#upcoming-calls");
  await ana.reload();
  await ana.waitForSelector("#upcoming-calls button:has-text('Join call')");
  ok(await post(nora, `/api/tests/${t}/cancel-call`, { ...go, callId: call, reason: "Something came up at work" }), "cancel");
  // Pressed at once, before the page's own refresh takes the row away.
  await ana.click("#upcoming-calls button:has-text('Join call')");
  await ana.waitForSelector("text=/Your Join call didn't go through/", { timeout: 5000 });
  await shot(ana, "b15-38-stale-join", "§38 A stale Join | “Your Join call didn't go through: Nora Lane cancelled this call at <time>.” and the button leaves", "#upcoming-calls");
  // §22 End early: the button waits for a reason and a tester; the tester reads it in italics.
  const sB = await join(ben, t);
  await open(nora, `/app/tests/${t}`, "section[aria-label='Test']");
  await nora.click("button:has-text('End early')");
  await nora.locator("[data-end-early] fieldset label", { hasText: "Ben Okafor" }).locator("input").check();
  await pause(nora, 400);
  await shot(nora, "b15-22-disabled", "§22 End early waits for a reason | The button stays disabled with “Say why first” until a reason and a tester are there; the counter reads 0 / 10,000", "[data-end-early]");
  const why = "Thank you, Ben. We found what we needed in the first two harbors, so we're ending this round early. " + "We'll invite you to the next build. ".repeat(60);
  await nora.locator("#reason").fill(why);
  await pause(nora, 400);
  await shot(nora, "b15-22-enabled", "§22 Ready | With a reason (here about 2,200 characters) the button is enabled; the counter shows it", "[data-end-early]");
  ok(await post(nora, `/api/tests/${t}/end-early`, { ...go, contractIds: [sB], reason: why }), "end early");
  await open(ben, `/app/sessions/${sB}`, "main");
  await shot(ben, "b15-22-tester-reads", "§22 and §20 The tester reads why | The reason in italics in a scroll box on his page (never in the bell line)", ben.locator(".info").filter({ hasText: "ended your session" }).first());
  // §13 A press with no connection: the message under the button, and the typed text stays.
  await open(ana, `/app/sessions/${sA}`, "#a0");
  await ana.locator("#a0").fill("Typed while the connection dropped.");
  await ana.locator("#a1").fill("Still here after the failed press.");
  await ana.context().setOffline(true);
  await ana.click("button:has-text('Send my answers')");
  await ana.waitForSelector("text=/You seem to be offline/").catch(() => {});
  await pause(ana, 600);
  await shotSpan(ana, "b15-13-offline", "§13 No connection | “You seem to be offline. Check your connection and try again.” under the button; the typed answers stay", "#a0", ana.locator("text=/You seem to be offline/").first(), 12, 16);
  await ana.context().setOffline(false);
  // §16 Per-side suspension: an account with both sides keeps its tester side.
  const both = await account(`dev+media${TS}lmx@playtest.test`, "Ivy Park", "both", "she");
  const admin = await adminAccount();
  await adminDo(admin, "suspend", both.uid, { note: "Media pass check", side: "developer" });
  await open(both, "/app", "main");
  await shot(both, "b15-16-dev-side", "§16 Suspensions are per side | Ivy's developer side is paused (“Your developer account is paused”); the switch to her tester side still works", "main");
  // §1 Chat: open while the test is paused; closed only while a person is restricted.
  const sid = sA;
  await adminDo(admin, "pause-test", t, { note: "Media pass check" });
  await open(ana, `/app/chat/${sid}`, "main");
  await shot(ana, "b15-01-chat-paused-test", "§1 Chat while the test is paused | The team paused the test: the chat stays open for both", "main");
  await adminDo(admin, "unpause-test", t);
  await adminDo(admin, "suspend", nora.uid, { note: "Media pass check", side: "developer" });
  await open(ana, `/app/chat/${sid}`, "main");
  await shot(ana, "b15-01-chat-dev-suspended", "§1 Chat while the developer is restricted | “Messages are paused for now. You can still read this chat.”", "main");
}, { section: LF, fake: true });

group("b15daily", async () => {
  // The daily job on the media server's own database (CRON_SECRET=media-cron): review reminders, Charge opening, Open until heads-ups, the admin's daily email,
  // the "N applications wait" line and the suspended accounts reminder.
  const nora = await account(`dev+media${TS}ld@playtest.test`, "Nora Lane", "developer", "she");
  setCard(nora.email, "pm_card_visa");
  const ana = await account(`tester+media${TS}lda@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}ldb@playtest.test`, "Ben Okafor", "tester", "he");
  const admin = await adminAccount();
  const t = await postTest(nora, { openUntil: day(3), liveRateCents: "30.00" });
  const u = await postTest(nora, { title: "Harbor Run: open feedback", writtenCents: null, questions: [], liveRateCents: "30.00", joinMode: "apply" });
  const sA = await join(ana, t);
  await sendWritten(ana, sA);
  // A listed call left unpaid past its review date: Charge opens for it.
  const call = await bookCall(nora, ana, t, sA, 400);
  tookPlace(call, nora.uid, ana.uid, 60 * 24 * 9, 25);
  await nora.goto(`/app/tests/${t}`);
  own(`update "Contract" set "dueAt" = ${utcNow} - interval '1 day' where id = '${sA}'`);
  own(`update "Call" set "payBy" = ${utcNow} - interval '1 hour' where id = '${call}'`);
  // Unlisted written answers sent 5 days ago (review date in 2 days): the "3 days" mark is due.
  ok(await post(ben, `/api/tests/${u}/apply`, { ...go, note: "I'd love to try it." }), "apply");
  sql(`update "Submission" set "updatedAt" = ${utcNow} - interval '5 days', "payBy" = ${utcNow} + interval '2 days' where "contractId" = '${sA}'`);
  // A suspended account to review.
  const zed = await account(`tester+media${TS}ldz@playtest.test`, "Zed Ruiz", "tester", "he");
  await adminDo(admin, "suspend", zed.uid, { note: "Media pass check: spam", side: "tester" });
  const r = await fetch(`${BASE}/api/cron/daily`, { headers: { authorization: "Bearer media-cron" } });
  console.log("   daily job:", r.status, (await r.text()).slice(0, 200));
  await openBell(nora);
  await shot(nora, "b15-02-dev-bell", "§2 and §35 The developer's daily lines | Review reminders on one schedule, “N applications wait for your answer”, and a call to pay", bellList(nora));
  await openBell(ana);
  await shot(ana, "b15-15-charge-opens", "§15 Charge opens for a call | “Nora Lane didn't pay your call on <date> in 7 days: charge $12.50 or let it go” (the measured length × the rate)", bellList(ana));
  await openBell(admin);
  await shot(admin, "b15-daily-admin", "The admin's daily lines | The suspended accounts reminder (“N suspended account sides to review”) and the cases in the daily email", bellList(admin));
}, { section: LF, fake: true });

// ---------- the report manifest ----------
const SECTIONS = [
  ["Every page", "Rules every signed-in page follows: a page moves on its own when the account changes underneath it (deleted in another tab, a hold or suspension starting), and long lists stay short."],
  ["Developer dashboard", "The developer's home: one card per test with its state, the Needs review and Calls boxes, and the blue box at the top while the account is restricted."],
  ["Post a test", "The form a developer fills in to open a test: four panels, red at each field when it's left, and Post checks everything again on the server."],
  ["Edit", "Changing a running test. Some fields have 3 changes once anyone is affected, Open until only moves later, and another tab's Save shows up as blue notes before Save stops once."],
  ["Developer test page", "Everything about one test: Needs you, the testers, live calls, invites, and the buttons that stop once when something changed since the page loaded."],
  ["Tester dashboard and Find", "The tester's home and the list of tests they can join: the boxes for work to do and parts to charge, and the tags on paused or left tests."],
  ["Join page", "What a tester reads before joining: the steps, the pay, the NDA in its scroll box, and their deadline with the time left."],
  ["Tester session page", "The tester's page for one test: the written form with its counter and formatting, recordings, calls, the offer box when the terms change, and what still works when the test is paused or stopped."],
  ["Payments", "Money from start to finish on the fake Stripe: declined payments and holds, retries, chargebacks with the $15 fee, bank confirmations, and the $7 subscription."],
  ["Settings and account", "Settings, Contact us and deleting an account, with the warnings that list what happens to unpaid work."],
  ["Admin console", "What the team can do: suspend, pause, stop, decide disputes, approve lifts, allow more changes, payouts, History, and what two admins see when they act at once."],
  ["Account states (holds, suspensions, deletion)", "What a payment hold, a chargeback hold, an admin suspension and a deletion do to every open page, live: routing to the dashboard top, closed pages and banners. Testers only ever read “paused”."],
  ["Outages", "An outage is detected by the outside health check: every clock moves later by its length, calls inside it are cancelled with no fault, and open pages say so."],
  ["Notifications and emails", "Bell lines as each person reads them, stacked by kind, and the emails they become, including the few sent even with email Off."],
  ["Launch fixes", "Batch 15, item by item (§ numbers are the items in docs/BATCH-15.md): measured calls and the Pay boxes, one $1,000 for a tester's calls, one rule for every pause, stop boxes that name the press, keys, admins, and the security audit's fixes. Items with nothing on screen link to their text proof."],
];
function writeManifest(list) {
  const cases = new Map(); // base -> case
  for (const [file, m] of Object.entries(list)) {
    if (file.startsWith("checks/") || !m.section) continue;
    const base = file.replace(/\.(png|webm)$/, "").replace(/-phone$/, "") + (file.endsWith(".webm") ? ".webm" : ".png");
    const c = cases.get(base) ?? { title: "", explanation: "", kind: m.kind, section: m.section, order: m.order ?? 0, desktop: null, phone: null };
    if (file.replace(/\.(png|webm)$/, "").endsWith("-phone")) c.phone = file;
    else { c.desktop = file; c.order = m.order ?? c.order; c.section = m.section; }
    c.title = c.title || m.title || "";
    if (!c.explanation || !file.includes("-phone")) c.explanation = m.caption;
    cases.set(base, c);
  }
  const sections = SECTIONS.map(([title, explanation]) => ({
    title, explanation,
    cases: [...cases.values()].filter((c) => c.section === title).sort((a, b) => a.order - b.order)
      .map((c) => ({ title: c.title || c.explanation.split(/[:.]/)[0], explanation: c.explanation, kind: c.kind, desktop: c.desktop, phone: c.phone })),
  }));
  const unknown = [...new Set([...cases.values()].map((c) => c.section).filter((s) => !SECTIONS.some(([t]) => t === s)))];
  if (unknown.length) console.log("   ! manifest: unknown sections", unknown);
  fs.writeFileSync(path.join(OUT, "report-manifest.json"), JSON.stringify({ generated: new Date().toISOString(), sizes: { desktop: "1280x900", phone: "375x812" }, sections }, null, 2));
  console.log("manifest:", sections.map((s) => `${s.title} ${s.cases.length}`).join(" · "));
}

{
  (async () => {
    browser = await chromium.launch({ channel: "msedge" });
    const fakeUp = await fetch(`${FAKE}/api/health`).then((r) => r.ok, () => false);
    const results = [];
    for (const [gi, g] of groups.entries()) {
      if (ONLY.length && !ONLY.includes(g.id)) continue;
      // (optIn) Runs only when named in ONLY: the outage group moves every running clock in the shared database.
      if (g.optIn && !ONLY.includes(g.id)) { console.log("== skipped (opt-in, name it in ONLY):", g.id); continue; }
      for (const size of SIZES) {
        console.log("==", g.id, size);
        if (g.fake && !fakeUp) {
          console.log("   SKIPPED: the fake-Stripe server isn't running on", FAKE);
          results.push(`${g.id} ${size}: skipped`);
          continue;
        }
        SIZE = size;
        V = size === "phone" ? PHONE : DESKTOP;
        SFX = size === "phone" ? "-phone" : "";
        TS = `${T0}${size[0]}`;
        BASE = g.fake ? FAKE : MAIN;
        GROUP = g.id;
        GORDER = gi + 1;
        SEQ = 0;
        SEC = g.section || "";
        adminP = null; // a fresh admin per group and size (on the group's server)
        try {
          await g.fn();
          results.push(`${g.id} ${size}: pass`);
        } catch (e) {
          results.push(`${g.id} ${size}: FAILED`);
          console.log("   FAILED", g.id, size, String(e.stack || e).split("\n").slice(0, 4).join(" | "));
          let n = 0;
          for (const c of browser.contexts()) for (const pg of c.pages()) await pg.screenshot({ path: path.join(VTMP, `${g.id}-${size}-FAILED-${++n}.png`), fullPage: true }).catch(() => {});
          console.log("   failure shots in", VTMP);
        }
        // Close what the group left open (each group makes its own accounts).
        for (const c of browser.contexts()) await c.close().catch(() => {});
      }
    }
    await browser.close();
    const listFile = path.join(OUT, "captions.json");
    const prev = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, "utf8")) : {};
    for (const m of made) prev[m.file] = { caption: m.caption, kind: m.kind, title: m.title, section: m.section, group: m.group, order: m.order, size: m.size };
    // Files that no longer exist (renamed or dropped scenarios) leave the list.
    for (const f of Object.keys(prev)) if (!fs.existsSync(path.join(OUT, f))) delete prev[f];
    fs.writeFileSync(listFile, JSON.stringify(prev, null, 2));
    writeManifest(prev);
    console.log("results:\n  " + results.join("\n  "));
    console.log("done:", made.length, "files; temp", VTMP);
  })();
}
