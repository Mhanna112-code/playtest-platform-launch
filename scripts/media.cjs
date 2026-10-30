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
// holds, alerts, emails, admin, admins2, excerpts, long, keysrace, changedq, paused, stopped, drafts, plans, tester, settings,
// and batch 16 (the report's "Batch 16 (Oct 28)" section): b16a to b16j.
// Batch 17 (the "Batch 17 (Oct 28)" section): b17a to b17f, plus the bank group's §11 cases; batch 18 ("Batch 18 (Oct 28)"): b18a to b18c, and b18len (§6, re-recorded with batch 19's Length row).
// Batch 19 ("Batch 19 (Oct 28)"): b19a and b19b, plus b18len's Length row; the bank group's video now pays again on the same piece after the cancelled check.
// (Batch 17 media run) The media database needs the batch 17/18 migrations: apply them with `prisma migrate deploy` pointed at playtest_lite_media only.
// (Oct 29 media run) Batch 20 ("Batch 20 (Oct 29)"): b20a to b20g (§1–§14) and b20m15 … b20q27 (§15–§28, one group per item); batch 21 ("Batch 21 (Oct 29)", the
// call room; its pages get a fake camera and microphone: the browser starts with --use-fake-device-for-media-stream and --use-fake-ui-for-media-stream): b21a to b21c;
// batch 22: b22a to b22d; batch 23: b23a to b23e; batch 24: b24a, b24b; "Blocks": blk1 to blk4; "Charge timing": ct1 to ct4 (ct4: Rate after the team's Stop);
// "Emails": emailsall (every kind of email, drawn from the dev outbox). Outages: outreal (opt-in: REALLY stops the media server for OUTAGE_MINUTES, default 16,
// with an in-process stand-in for UptimeRobot; needs MEDIA_SERVER_PIDFILE = the file holding the PID of the 3450 server you started, and MEDIA_SERVER_START = a
// node script that starts it again and rewrites that file; only that PID and its children are stopped) and outlong (opt-in: over 24 hours, waits for Approve).
// The media database needs the batch 20 to 23 migrations (age_confirmed, call_room, email_queue_reservations), applied to playtest_lite_media only.
// Edge doesn't start on the media machine since Oct 29: BROWSER_CHANNEL=chrome.
// (Oct 29) A video's frame size never changes part-way: on a page that is recording, screenshots are cut from the screen as it is, or taken from a separate page
// that isn't recording (see guardRecording / capture); never call page.screenshot with fullPage on a recording page yourself.
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
let SEC = "", GROUP = "", GORDER = 0, SEQ = 0, SUB_DEVS = false;
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
  if (video) guardRecording(p);
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
  const p = await c.newPage();
  if (video) guardRecording(p);
  return safeGoto(p);
}
/**
 * (Oct 29 media run) A video's frame size never changes part-way. Chromium takes a full-page (or taller-than-the-screen) screenshot by growing the page beyond the
 * screen for a moment, and the recording shows that as a shrunken page with grey bars. So on a page that is recording, a screenshot never reaches beyond the screen:
 * a whole page or a tall element is taken from a separate page that isn't recording (same sign-in, same address), and an element that fits on the screen is scrolled
 * into view and taken from the screen as it is (then the scroll goes back). page._raw is the plain screenshot.
 */
function guardRecording(p) {
  const raw = p.screenshot.bind(p);
  p._raw = raw;
  p.screenshot = async (o = {}) => {
    if (!o.fullPage) return raw(o);
    if (o.clip) return capture(p, o.clip, null, o.path);
    return mirrorShot(p, o.path, null);
  };
}
/** The height the sticky header (and any fixed bar at the top) covers. */
const topCover = (page) => page.evaluate(() => {
  let m = 0;
  for (const el of document.querySelectorAll("body *")) {
    const st = getComputedStyle(el);
    if (st.position !== "fixed" && st.position !== "sticky") continue;
    const r = el.getBoundingClientRect();
    if (r.top <= 1 && r.bottom > 0 && r.height < innerHeight / 3 && r.width > innerWidth / 2) m = Math.max(m, r.bottom);
  }
  return Math.ceil(m);
});
/**
 * One clip of the page (document coordinates) saved to `file`. Not recording: the usual full-page clip. Recording: from the screen when it fits under the header;
 * otherwise from a separate page (`remeasure` finds the same elements there and measures the clip again); if they aren't on that page (a box that only exists
 * after a press), the clip is taken in screen-high strips from the recording page and joined.
 */
async function capture(page, clip, remeasure, file) {
  if (!page.video()) return page.screenshot({ path: file, fullPage: true, clip });
  const raw = page._raw;
  const vp = page.viewportSize();
  const sy0 = await page.evaluate(() => window.scrollY);
  const cover = await topCover(page);
  try {
    if (clip.height <= vp.height - cover) {
      await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, clip.y - cover));
      await page.waitForTimeout(250);
      const sy = await page.evaluate(() => window.scrollY);
      const vy = clip.y - sy;
      if (vy >= (sy > 0 ? cover : 0) - 1 && vy + clip.height <= vp.height + 1) return await screenCrop(page, { ...clip, y: Math.max(0, vy), height: Math.min(clip.height, vp.height - Math.max(0, vy)) }, file);
    }
    if (remeasure) {
      const done = await mirrorShot(page, file, remeasure);
      if (done) return done;
    }
    return await stitch(page, clip, cover, file);
  } finally {
    await page.evaluate((y) => window.scrollTo(0, y), sy0).catch(() => {});
  }
}
/** A separate page that isn't recording, same sign-in and address: the whole page, or (with `remeasure`) the clip measured again there. False when it isn't there. */
async function mirrorShot(page, file, remeasure) {
  const m = await same(page, { viewport: page.viewportSize(), ...(phone() ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}) });
  try {
    await m.goto(page.url());
    await m.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await m.waitForTimeout(1200);
    await closeTimerPopups(m);
    if (!remeasure) return await m.screenshot({ path: file, fullPage: true });
    const clip = await remeasure(m).catch(() => null);
    if (!clip) { console.log("   (the tall picture isn't on a fresh page: taken in strips from the recording page)"); return false; }
    return await m.screenshot({ path: file, fullPage: true, clip });
  } finally {
    await m.context().close().catch(() => {});
  }
}
/**
 * Part of the screen as it is: the whole screen is taken (a clipped screenshot makes Chromium send the recording one frame of the clip's size, shown with grey bars),
 * then cut to the clip (screen coordinates) with ffmpeg.
 */
async function screenCrop(page, c, file) {
  const tmp = path.join(VTMP, `screen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`);
  await page._raw({ path: tmp });
  const k = phone() ? 2 : 1, r = (n) => Math.max(0, Math.round(n * k));
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", tmp, "-vf", `crop=${r(c.width)}:${r(c.height)}:${r(c.x)}:${r(c.y)}`, file]);
  return true;
}
/** The clip in screen-high strips (scrolling the recording page, never resizing it), joined top to bottom with ffmpeg. */
async function stitch(page, clip, cover, file) {
  const vp = page.viewportSize();
  const parts = [];
  let y = clip.y, left = clip.height, i = 0;
  while (left > 0.5) {
    await page.evaluate((t) => window.scrollTo(0, t), Math.max(0, y - cover));
    await page.waitForTimeout(250);
    const sy = await page.evaluate(() => window.scrollY);
    let vy = y - sy;
    const minTop = sy > 0 ? cover : 0;
    if (vy < minTop) vy = minTop;
    const h = Math.min(left, vp.height - vy);
    if (h < 1) break;
    const part = path.join(VTMP, `stitch-${Date.now()}-${i++}.png`);
    await screenCrop(page, { x: clip.x, y: vy, width: clip.width, height: h }, part);
    parts.push(part);
    y += h;
    left -= h;
  }
  if (parts.length === 1) fs.copyFileSync(parts[0], file);
  else execFileSync(FFMPEG, ["-y", "-loglevel", "error", ...parts.flatMap((p) => ["-i", p]), "-filter_complex", `vstack=inputs=${parts.length}`, file]);
  return true;
}
/** The Next.js dev-tools badge is not part of the app: hide it in pictures. */
const hideDevBadge = (c) => c.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "nextjs-portal{display:none!important}"; document.head.appendChild(s); }));
const post = async (page, p, data = {}) => {
  // (Batch 19 section 7) Post, a draft's Post and Save carry the required tick about Charge.
  if (p === "/api/tests" || /\/(edit|post-draft)$/.test(p)) data = { payRulesOk: true, ...data };
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
  const r = await post(p, "/api/auth/signup", { email, password: PASSWORD, role, name, acceptTerms: true, over18: true });
  if (!r.ok) throw new Error("sign-up failed for " + email);
  own(`update "User" set "emailVerifiedAt" = (now() at time zone 'utc') where email = ${lit(email)}`);
  await post(p, "/api/profile", { name, pronoun, isDeveloper: role !== "tester", isTester: role !== "developer", devices: tester.devices ?? ["Windows PC"], languages: tester.languages ?? ["English"], categories: [] });
  p.email = email;
  p.name = name;
  p.uid = userId(email);
  // (Batch 16 media run) The groups written for a server in its free launch run on the media server, whose launch is over: their developers subscribe.
  if (SUB_DEVS && role !== "tester") {
    own(`update "User" set "stripeCustomerId" = coalesce("stripeCustomerId", 'cus_fake_' || id), "stripePaymentMethodId" = coalesce("stripePaymentMethodId", 'pm_card_visa') where email = ${lit(email)}`);
    await post(p, "/api/payments/subscription", { action: "subscribe", seenAt: nowIso() });
  }
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
    await innerScroll(loc);
    if (after) await after();
    const b = await loc.boundingBox();
    if (!b) throw new Error("no box for " + name);
    const sy = await page.evaluate(() => window.scrollY);
    const pad = 12, y = Math.max(0, b.y + sy - pad);
    // On a phone the picture always takes the full screen width (the element fills it anyway), so nothing is ever cut at the sides.
    const x = phone() ? 0 : Math.max(0, b.x - pad), width = phone() ? page.viewportSize().width : Math.min(page.viewportSize().width - x, b.width + 2 * pad);
    const sel = typeof target === "string" ? target : loc._selector;
    // (a fresh page measures the same element again, from the top of the page, when the picture is taller than the screen)
    const remeasure = after ? null : async (m) => {
      const l = m.locator(sel).first();
      await l.waitFor({ state: "visible", timeout: 8000 });
      await m.evaluate(() => window.scrollTo(0, 0));
      await innerScroll(l);
      const bb = await l.boundingBox();
      const my = await m.evaluate(() => window.scrollY);
      const mx = phone() ? 0 : Math.max(0, bb.x - pad);
      return { x: mx, y: Math.max(0, bb.y + my - pad), width: phone() ? m.viewportSize().width : Math.min(m.viewportSize().width - mx, bb.width + 2 * pad), height: bb.height + 2 * pad };
    };
    await capture(page, { x, y, width, height: b.height + 2 * pad }, remeasure, path.join(OUT, file));
  } else await page.screenshot({ path: path.join(OUT, file), fullPage: false });
  record(file, caption, "image");
  return file;
}
/** (Batch 17 media run) An element inside a scroll box (e.g. the tester rows): its box scrolls to it, the page itself stays put. */
const innerScroll = (loc) => loc.evaluate((el) => {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (p.scrollHeight > p.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(p).overflowY)) p.scrollTop += el.getBoundingClientRect().top - p.getBoundingClientRect().top - 8;
  }
}).catch(() => {});
/** The whole page, top to bottom (long pages such as dashboards). */
async function shotFull(page, name, caption) {
  await page.bringToFront();
  await closeTimerPopups(page);
  await page.waitForTimeout(400);
  const file = `${name}${SFX}.png`;
  await page.evaluate(() => window.scrollTo(0, 0)); // (the sticky header stays at the top of the picture)
  await page.waitForTimeout(200);
  if (page.video()) await mirrorShot(page, path.join(OUT, file), null);
  else await page.screenshot({ path: path.join(OUT, file), fullPage: true });
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
  const [sa, sb] = [a._selector, b._selector];
  const remeasure = async (m) => {
    const [la, lb] = [m.locator(sa).first(), m.locator(sb).first()];
    await la.waitFor({ state: "visible", timeout: 8000 });
    await lb.waitFor({ state: "visible", timeout: 8000 });
    await m.evaluate(() => window.scrollTo(0, 0));
    const [qa, qb] = [await la.boundingBox(), await lb.boundingBox()];
    const my = await m.evaluate(() => window.scrollY);
    const mx = phone() ? 0 : Math.max(0, Math.min(qa.x, qb.x) - 12), mr = phone() ? m.viewportSize().width : Math.max(qa.x + qa.width, qb.x + qb.width) + 12;
    const t = Math.max(0, Math.min(qa.y, qb.y) + my - padTop), bt = Math.max(qa.y + qa.height, qb.y + qb.height) + my + padBottom;
    return { x: mx, y: t, width: Math.min(m.viewportSize().width - mx, mr - mx), height: bt - t };
  };
  await capture(page, { x, y, width: Math.min(page.viewportSize().width - x, right - x), height: bottom - y }, remeasure, path.join(OUT, file));
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
/** (Batch 17 §15) Stop the test needs a reason testers read. */
const STOP_WHY = "We found what we needed in this build: thank you!";
const stopTest = (dev, id) => post(dev, `/api/tests/${id}/stop`, { ...go, reason: STOP_WHY }).then((r) => ok(r, "stop"));
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
  await v.check("#payRulesOk"); // (batch 19 section 7)
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
  await r.check("#payRulesOk"); // (batch 19 section 7)
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
  await shot(dev, "edit-open-until-30", "Open until at most 30 days after the test opened | Open until can move later, but at most 30 days after the test opened (batch 16): a later date is red with the last allowed date", panel(dev, "Who and how long"));

  // Access keys that can't be added again. (Edit keeps unsent typing per form: drop what the date checks left, and let the page settle first.)
  sql(`delete from "KeptForm" where key = 'test:edit:${t}' and "userId" = '${dev.uid}'`);
  await dev.goto(`/app/tests/${t}/edit`);
  await pause(dev, 1500);
  await addKeys(dev, "HR-1111");
  await dev.locator("#spots").click();
  await dev.waitForSelector("text=/is in use by Ana Silva/");
  await shotSpan(dev, "edit-key-in-use", "Key in use | A key in use by a working tester can't be added (red, as you type): “HR-1111 is in use by Ana Silva, so it can't be added.”", "#keys", "text=/is in use by Ana Silva/", 12, 20);
  sql(`delete from "KeptForm" where key = 'test:edit:${t}' and "userId" = '${dev.uid}'`);
  await dev.goto(`/app/tests/${t}/edit`);
  await pause(dev, 1500);
  await addKeys(dev, "HR-3333");
  await dev.locator("#spots").click();
  await dev.waitForSelector("[data-key-warnings]");
  await shot(dev, "edit-key-reported-left", "A key from a tester who left | Cam left: his key HR-3333 can be typed back into Free, with a warning only (a “Reused” tag, never a mistake)", "#keys");

  // Changed in another tab or device: A has Edit open; B saves the instructions and new keys.
  // (Edit keeps unsent typing per form on the server: drop what the key checks above left, so both tabs open on the saved test.)
  sql(`delete from "KeptForm" where key = 'test:edit:${t}' and "userId" = '${dev.uid}'`);
  const A = await rec(V, dev), B = await rec(V, dev);
  await A.goto(`/app/tests/${t}/edit`);
  await B.goto(`/app/tests/${t}/edit`);
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
  // (Batch 16 sections 18 and 19) The note names the field and what it replaced ("Instructions:" and the old text); the keys are one line per kind ("Added: …").
  await A.waitForSelector("[data-field-note] >> text=Instructions:");
  await A.waitForSelector("text=Added: HR-7777, HR-8888, HR-9999");
  await shot(A, "edit-elsewhere-field", "Blue note on a field | Another tab saved new instructions: the field updates, and the blue note under it names it and what it replaced (“Instructions:” and the old text)", field(A, "description"));
  await shot(A, "edit-elsewhere-keys", "Blue note on keys | Keys added in another tab: one line under the key boxes, “Added: HR-7777, HR-8888, HR-9999”", "#keys");
  await shotSpan(A, "edit-elsewhere-save", "Save stops once | Save stops once for what this tab didn't have: “You changed the description in another tab” with what it replaced, and “Added: HR-7777, HR-8888, HR-9999”", saveBtn(A), A.locator("text=/Press Save again/").locator("xpath=ancestor::*[contains(@class,'info')][1]"), 16, 12);
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
  // Work to review, a call that happened (measured by the app), calls booked and requested, a dispute.
  await sendWritten(ana, sA, ["The boat handling feels great.", "The second bridge: I couldn't tell where to go.", "Yes, if the map gets clearer."]);
  await sendWritten(cam, sC, ["Fun music.", "Nowhere really.", "Maybe."]);
  await rejectPiece(dev, subOf(sC), "The answers are too short to use.");
  ok(await post(cam, `/api/sessions/${sC}/dispute`, { ...go, kind: "submission", id: subOf(sC), reason: "I answered every question; the test didn't ask for long answers." }), "dispute");
  const past = await bookCall(dev, ben, t, sB, 26);
  // (Batch 15 §40) The app measures the call from both people's time on the call page.
  tookPlace(past, dev.uid, ben.uid, 50, 29);
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
  await shot(dev, "tp-needs-you", "Needs you | Needs you, grouped per person: Pay for sent work, a call to pay for its measured length, a dispute waiting for your side", "#needs-you");
  await shotSpan(dev, "tp-needs-dispute-call", "A dispute and a call to pay | A dispute waiting for the developer's side, and a call that happened, measured by the app", "#needs-you [id^='item-dispute-']", dev.locator("#needs-you [data-needs-person]").filter({ hasText: "Ben Okafor" }).first());
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
  await dev.fill("dialog[open] #stop-reason", STOP_WHY); // (Batch 17 §15) the required "Why?"
  await pause(dev, 500);
  await shot(dev, "tp-stop-confirm", "Stop: confirm | Stop: the confirm pop-up “Are you sure you want to stop …?” with its required “Why?” (testers read it)");
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
  await dev.fill("dialog[open] #stop-reason", STOP_WHY); // (Batch 17 §15) the required "Why?"
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

  // The team pauses the test while the developer is on it: Stop, End early and Cancel call still work (batch 15 §23, §29).
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
    finishVideo([{ file: await saveVideo(D, "tp-paused.webm"), from }], "tp-team-paused", "Team pauses the test | The team pauses the test while Nora is on it: End early still goes through without a stop box (batch 15 §29), and the banner says what's paused and what still works");
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
/** (Batch 15) On the fake Stripe, Pay needs a card: a developer with none gets the working test card (a decline set on purpose stays). */
const ensureCard = (email) => own(`update "User" set "stripeCustomerId" = coalesce("stripeCustomerId", 'cus_fake_' || id), "stripePaymentMethodId" = 'pm_card_visa' where email = ${lit(email)} and "stripePaymentMethodId" is null`);
async function apiPay(dev, subId, dollars) {
  ensureCard(dev.email);
  const cents = Math.round(Number(dollars) * 100);
  return ok(await post(dev, "/api/review", { action: "pay", kind: "submission", id: subId, amount: dollars, tickedCents: cents, payKey: require("crypto").randomUUID(), seenAt: nowIso(), confirmed: true }), "pay");
}
/** Press Pay on one piece of the developer test page (the amount box starts at the listing; the every-payment tick). */
async function payPiece(page, subId) {
  if (page.email) ensureCard(page.email);
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
/** The tester presses Charge on their session page (batch 16 section 39: the tick only above $200, then the button). */
async function chargeUI(page, sessionId) {
  await page.goto(`/app/sessions/${sessionId}`);
  const btn = page.locator("button", { hasText: /^Charge / }).first();
  await btn.scrollIntoViewIfNeeded();
  const tick = page.locator("[data-charge-tick] input");
  if (await tick.count()) await tick.first().check();
  await btn.click();
}
/**
 * (Batch 17 §11) The fake's stand-in for the bank's check is drawn INLINE, under the pressed button ("Stand-in for your bank's check · Confirm / Cancel"), so the video
 * shows it: wait for it, run `before` while it is open, let it show a moment, then answer it. Start it before the press; await the result to know it was answered.
 */
function bankPopup(page, yes, before) {
  const answered = (async () => {
    const box = page.locator("[data-bank-check=stand-in]").first();
    await box.waitFor({ state: "visible", timeout: 20000 });
    await box.scrollIntoViewIfNeeded().catch(() => {});
    if (before) await before();
    await page.waitForTimeout(1200);
    const btn = box.locator(yes ? "[data-bank-confirm]" : "[data-bank-cancel]");
    await btn.click({ timeout: 5000 }).catch(() => btn.evaluate((b) => b.click())); // (on a phone the sticky header can sit over it)
  })();
  answered.catch((e) => console.error("[media] bank stand-in:", e.message));
  return answered;
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
  // (Batch 16 section 41) Step 1 first: Pay what you owe waits for the card check ("Verify your card first (step 1): …"). Then he pays what he owes ($25).
  await omar.locator("[data-chargeback-steps] button", { hasText: "Verify a card" }).click(); // (simulated in the fake: verified at once)
  await omar.waitForSelector("[data-step-ok=yes]", { timeout: 15000 }).catch(() => {});
  await omar.locator("#owed button", { hasText: /Pay what you owe/ }).click();
  await pause(omar, 2500);
  await omar.reload();
  await omar.waitForSelector("[data-chargeback-steps]");
  await shot(omar, "money-chargeback-paid", "Verified and paid, but still on hold | Card verified and $25 paid: “Paid. Your tests stay paused until the team approves.” The team's Approve lifts it", "[data-chargeback-steps]");
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
  const dee = await account(`tester+media${TS}bkd@playtest.test`, "Dee Park", "tester", "she");
  setCard(nora.email, "pm_card_authenticationRequired");
  const t = await postTest(nora, { productName: "Kelp Forest", title: "Kelp Forest: iPhone beta", writtenCents: "10.00", spots: "5" });
  const sA = await join(ana, t), sB = await join(ben, t), sC = await join(cam, t), sDee = await join(dee, t);
  for (const [p, s] of [[ana, sA], [ben, sB], [cam, sC], [dee, sDee]]) await sendWritten(p, s);
  const subA = subOf(sA);
  // 1. Her own press: the bank's check, inline. Cancelled: nothing charged, no hold. Confirmed: paid. (Batch 17 §11: in the Batch 17 section.)
  sec(B17);
  {
    const D = await rec(V, nora);
    await D.goto(`/app/tests/${t}`);
    await D.waitForSelector(`#piece-${subA}`);
    const from = at(D);
    await pause(D, 800);
    const cancelled = bankPopup(D, false, () => shot(D, "bank-stand-in", "§11 The bank's check, inline | Pay opens it inline, right under the button: “Stand-in for your bank's check” with Confirm and Cancel (the fake Stripe; with Stripe live, the bank's own page shows in the same place)", D.locator(`#piece-${subA}`)));
    await payPiece(D, subA);
    await cancelled;
    await D.waitForSelector(`#piece-${subA} [data-bank-not-confirmed]`, { timeout: 15000 });
    await pause(D, 2800);
    await shot(D, "bank-press-cancelled", "§11 Not confirmed: nothing charged | The bank's check was cancelled: “Your bank didn't confirm the payment, so nothing was charged.” No hold", D.locator(`#piece-${subA}`));
    // (Batch 19 §5) Pay pressed again on the same piece after the cancelled check is a new attempt with its own check: confirmed, Ana is paid.
    const confirmed = bankPopup(D, true);
    await payPiece(D, subA);
    await confirmed;
    await D.waitForSelector("text=/Paid \\$10\\.00/", { timeout: 20000 }).catch(() => console.log("   ! bank: no “Paid $10.00” after the second Pay"));
    await pause(D, 3000);
    finishVideo([{ file: await saveVideo(D, "bank-press.webm"), from }], "bank-press",
      "§11 Pay with a bank check | Nora presses Pay and her bank's check opens under it: cancelled, nothing is charged; she presses Pay again on the same answers, confirms, and Ana is paid");
  }
  sec("Payments");
  // 2. Made while she's away: Ben charges after the review window; the payment waits for her bank. (Batch 17 §11) It is confirmed on the test page, under Ben's answers:
  //    the bell line and Payments link straight to that "Confirm with your bank".
  openCharge(sB, t);
  await chargeUI(ben, sB);
  await ben.waitForSelector("text=/may be delayed/i", { timeout: 15000 });
  await pause(ben, 800);
  await shot(ben, "bank-away-tester", "The tester's side | Ben charged for his unreviewed answers: “Charged $10.00. Payment may be delayed.”", ben.locator("#part-written"));
  await openBell(nora);
  await shot(nora, "bank-away-bell", "Confirm this payment by | Nora's bell (also emailed, even with email Off): “Your bank wants you to confirm a $10.00 payment. Confirm this payment by <date>.” It opens the button on the test page", bellList(nora));
  sec(B17);
  await nora.goto("/app/payments");
  await nora.waitForSelector("[data-confirm-list]");
  await shot(nora, "bank-confirm-list", "§11 The link on Payments | Payments lists the payment waiting for her bank, with a link to “Confirm with your bank” on the test page (no Confirm of its own)", "[data-confirm-list]");
  await nora.locator("[data-confirm-list] [data-bank-link]").first().click();
  const waiting = nora.locator("[data-bank-waiting]").first();
  await waiting.waitFor({ state: "visible", timeout: 15000 });
  await pause(nora, 900);
  await shot(nora, "bank-away-button", "§11 Confirm with your bank | The link opens the test page at Ben's written answers: the piece is marked, with “Confirm with your bank” under it", waiting);
  const away = bankPopup(nora, true, () => shot(nora, "bank-away-stand-in", "§11 The same inline check | “Confirm with your bank” opens the stand-in for the bank's check right under it", waiting));
  await waiting.locator("button", { hasText: "Confirm with your bank" }).evaluate((b) => b.click()); // (on a phone the sticky header can sit over it)
  await away;
  await nora.waitForSelector("[data-bank-confirmed]", { timeout: 15000 });
  await pause(nora, 1500);
  sec("Payments");
  await nora.goto("/app/payments");
  await waitGone(nora, "[data-confirm-list]", 15000);
  await shot(nora, "bank-confirmed", "Confirmed | After Confirm the list is gone and the payment shows in What you've paid", nora.locator("section", { hasText: "What you've paid" }).first());
  // 3. The lock: while Nora's bank pop-up for Cam's answers is open, Cam's Charge is refused.
  openCharge(sC, t);
  const subC = subOf(sC);
  await nora.goto(`/app/tests/${t}`);
  await nora.waitForSelector(`#piece-${subC}`);
  const locked = bankPopup(nora, true, async () => {
    await chargeUI(cam, sC);
    await cam.waitForSelector("text=A payment for this is being confirmed right now.", { timeout: 10000 });
    await shot(cam, "bank-locked", "Locked while the bank confirms | Cam presses Charge while Nora's bank check for the same answers is open under her Pay: “A payment for this is being confirmed right now.”", cam.locator("#part-written"));
  });
  await payPiece(nora, subC);
  await locked;
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
  await nora.check("#payRulesOk"); // (batch 19 section 7)
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
  await shot(nora, "outage-before-dev", "Simulated: before | A call with Ana booked inside the 20 minutes the hand-sent alerts will call down (the site kept running)", liveSession(nora));
  const D = await rec(V, nora), T = await rec(V, ana);
  await D.goto(`/app/tests/${t}`);
  await T.goto(`/app/sessions/${sA}`);
  const fromD = at(D), fromT = at(T);
  await pause(D, 1500);
  // (Batch 15 section 10) Outages come from the uptime service's own alerts: a "down" (alertType 1) and, 20 minutes later, an "up" (alertType 2), each on the
  // server's clock. The down's stored time is moved 20 minutes back so the recording needn't wait.
  const alert = (type) => fetch(`${BASE}/api/health/alert`, { method: "POST", headers: { "content-type": "application/json", "x-health-key": HEALTH_KEY }, body: JSON.stringify({ alertType: type, alertDateTime: Math.floor(Date.now() / 1000) }) }).then((r) => r.json());
  const down = await alert(1);
  if (!down.ok) throw new Error("down alert refused: " + JSON.stringify(down));
  sql(`update "AppState" set value = to_char((now() at time zone 'utc') - interval '20 minutes', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where key = 'outage-down'`);
  const up = await alert(2);
  if (!up.ok || !up.outage) throw new Error("up alert: " + JSON.stringify(up));
  await Promise.all([waitLive(D, "[data-live-top]:has-text('The site was down')"), waitLive(T, "[data-live-top]:has-text('The site was down')")]);
  await pause(D, 3000);
  await shot(D, "outage-live-dev", "Simulated: the developer's page | The down/up alerts were sent by hand and the site kept running; the live box: “The site was down from <a> to <b>. Deadlines and payment dates moved 20 min later.”", "[data-live-top]");
  await shot(T, "outage-live-tester", "Simulated: the tester's page | Ana's session page says the same in its live box (alerts sent by hand; the site kept running)", "[data-live-top]");
  finishVideo([{ file: await saveVideo(D, "outage-d.webm"), from: fromD }, { file: await saveVideo(T, "outage-t.webm"), from: fromT }], "outage-live",
    "A simulated outage | The down and up alerts were sent by hand (the down's time moved 20 minutes back); the site kept running. The developer's test page (left) and the tester's session page (right) are open when the up alert arrives: both say the site was down and every clock moved later");
  const after = sql(`select to_char("openUntil", 'YYYY-MM-DD HH24:MI') || ' / ' || (select to_char("dueAt", 'YYYY-MM-DD HH24:MI') from "Contract" where id = '${sA}') from "Test" where id = '${t}'`);
  console.log(`   outage: Open until / Ana's deadline (UTC) before ${before}, after ${after}`);
  await nora.goto(`/app/tests/${t}`);
  await nora.locator("#calls").scrollIntoViewIfNeeded().catch(() => {});
  await shot(nora, "outage-after-dev", "Simulated: the call | The call inside the simulated outage is cancelled “missed because the site was down”: never a no-show, nothing charged", liveSession(nora));
  await ana.goto(`/app/sessions/${sA}`);
  await pause(ana, 800);
  await shotFull(ana, "outage-after-tester", `Simulated: the tester's page | Ana's call reads as missed because the site was down; her deadline moved 20 minutes later (UTC before / after: ${before.split(" / ")[1]} → ${after.split(" / ")[1]})`);
  await openBell(nora);
  await shot(nora, "outage-bell-dev", "The developer's bell | The outage line (its own line) and the missed call", bellList(nora));
  await openBell(ana);
  await shot(ana, "outage-bell-tester", "The tester's bell | The same two lines for Ana", bellList(ana));
  await openBell(admin);
  await shot(admin, "outage-bell-admin", "The admin's bell | An admin who runs a test gets the same bell line as everyone affected", bellList(admin));
  // (Batch 15 section 10) The admin console's Outages: the latest outages from the alerts (one over 24 hours would wait for Approve).
  await admin.goto("/admin#outages");
  await admin.waitForSelector("#outages");
  await shot(admin, "outage-admin", "The admin's Outages | The console lists the outages recorded from the down and up alerts (here sent by hand; the site kept running), with their length", "#outages");
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
  // 1. Ana asks from her session page: pick an answer, trim it (batch 18 §7: no "Don't name the product" tick).
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
    await shot(T, "excerpt-picker", "The picker | Ana picks one paid answer and trims it (10 to 500 characters); it will read “From” the test (no product tick since batch 18)", pick);
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
  await shot(nora, "excerpt-needs-you", "Excerpt request in Needs you | The quote, the test it's from, and Allow or Deny", "[data-excerpt-request]");
  await nora.locator("[data-excerpt-request] button", { hasText: "Allow" }).click();
  await pause(nora, 1500);
  await decide(nora, p1.sub, "allow");
  await decide(nora, p2.sub, "deny");
  ok(await askExcerpt(ana, p4.sub, "the wake looks lovely at night"), "ask 4");
  // (Batch 16 section 23) Shown excerpts are in the tester's row, where the developer can take one down, and on the profile; never on the hover card.
  await nora.goto(`/app/tests/${p3.t}`);
  await nora.waitForSelector("#testers-joined");
  await shot(nora, "excerpt-hover", "The hover card | Rating, accepted parts, the profile link and Chat with Ana: no excerpts (they're on her profile)", "#testers-joined", async () => {
    await nora.locator("#testers-joined a[aria-label='Ana Silva: profile']").first().hover();
    await pause(nora, 800);
  });
  await shot(nora, "excerpt-row", "In the tester's row | The excerpt shown from this test, with Take down", nora.locator("[data-shown-excerpt]").first());
  sec("Tester session page");
  await nora.goto(`/app/testers/${ana.uid}`);
  await pause(nora, 800);
  await shot(nora, "excerpt-profile", "On Ana's profile | Shown excerpts as plain quotes, each with the test it's from", nora.locator("[data-shown-excerpts]"));
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
  // (Batch 16 section 30) The list is on the tester's own profile now (not Settings).
  await ana.goto(`/app/testers/${userId(`tester+media${TS}exa@playtest.test`)}`);
  await ana.waitForSelector("#excerpts");
  await shot(ana, "excerpt-settings", "Ana's list on her profile | Pending, shown and denied excerpts with Remove; the one from a test that now has an NDA reads “Hidden while … has an NDA”", "#excerpts");
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
  // (Batch 15 §7) The local sign-up count per network: cleared in the media database only, as account() does.
  if (MEDIA_DB !== "playtest_lite") sql(`delete from "LoginAttempt" where kind = 'signup' and ip in ('::1', '127.0.0.1', '::ffff:127.0.0.1')`);
  const r = await post(p, "/api/auth/signup", { email, password: PASSWORD, role: "tester", name, acceptTerms: true, over18: true });
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
  // Long names and titles in rows, and a test with 50 testers (batch 31: posted at 10, then raised in the data like a test from before the flat 10).
  const longDev = "Maximiliana Alexandrina Featherstonehaugh-Worthington";
  const nora = await account(`dev+media${TS}mn@playtest.test`, longDev, "developer", "she");
  const title = "Harbor Run: the first three harbors, the lighthouse and more";
  const t = await postTest(nora, { productName: "Harbor Run: Lighthouse Edition for iPad", title, spots: "10", writtenCents: "10.00", liveRateCents: "30.00", openUntil: day(20) });
  own(`update "Test" set spots = 50 where id = ${lit(t)}`);
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
  // Tab A presses Save: the blue notice lists what changed (B's keys, always, and the joins) with the warning for K-2, which A had deleted and Ben was
  // given (batch 16 section 20: blue, not red; the page may already show it live); red only for too few free keys for the open spots.
  await A.locator("#keys").scrollIntoViewIfNeeded();
  await saveBtn(A).click();
  await A.waitForSelector("text=/Press Save again/", { timeout: 15000 });
  await A.waitForSelector("text=/joined and was given K-2, which you had deleted here/", { timeout: 15000 });
  await pause(A, 3000);
  await A.locator("#keys").scrollIntoViewIfNeeded();
  await pause(A, 2000);
  await shot(A, "keysrace-a-keys", "Tab A: the key boxes after the race | The blue note names what changed (“Added: B-1”, “Removed: K-4, K-5, K-8”, the joins) and warns “Ben Okafor joined and was given K-2, which you had deleted here.” (blue, never red); red only for too few free keys; the box already shows the current keys with A's own edits", "#keys");
  await shotSpan(A, "keysrace-a-notice", "Tab A: the notice under Save | The red mistake (too few free keys) and the blue “since you opened this page” list: the joins, the K-2 warning and the other tab's key changes", A.locator("p.err-field", { hasText: /^Fix the/ }).first(), A.locator("text=/Press Save again/").last(), 16, 16);
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
    "Access keys race (two tabs) | Tab A (left) deletes K-2, K-6, K-7 and types N-1 in the Free box; Ben and Cam join and get K-2 and K-3; tab B (right) deletes K-4, K-5, K-8, adds B-1 and saves after its own blue notice; A's Save shows the blue notice (with the K-2 warning, not red) and the red mark for too few keys, the box refreshes with A's own edits, and A saves after adding a key");
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
    await shot(T, "paused-banner-full", "The paused banner | Ana's banner lists only what she can do now (drafts, charge or let go, leave, cancel her booked call; batch 17: no rate while her answers are unreviewed) and says her deadline is paused too", "[data-paused]");
    await T.locator("#part-written").scrollIntoViewIfNeeded().catch(() => {});
    await pause(T, 2500);
    finishVideo([{ file: await saveVideo(T, "paused.webm"), from }], "paused-live", "The test is paused while the page is open | The blue banner appears; Send, the call-request tools, Join and the chat box are hidden until it resumes");
  }
  await ana.goto(`/app/sessions/${sA}`);
  await pause(ana, 800);
  await shotFull(ana, "paused-page", "A paused session page | Only what works is shown: the banner, Charge or Let it go (payment may be delayed), Cancel on the booked call and Leave, with Rate disabled until she charges or lets go; no Send, no call requests, “Chat is paused while the test is paused.”");
  await ben.goto(`/app/sessions/${sB}`);
  await pause(ben, 800);
  await shot(ben, "paused-banner-short", "A shorter banner | Ben has nothing to charge and no calls: his banner offers only drafts and leave (his answers are still in their review window, so Rate waits)", "[data-paused]");
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
    await D.fill("dialog[open] #stop-reason", STOP_WHY); // (Batch 17 §15) the required "Why?"
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
  await shotFull(nora, "stopped-dev-page", "The stopped test page | No Edit, Stop, End early, Invite or call requests; Needs you (Pay, the measured calls), the Testers panel, past calls, Alerts and Next round stay");
  sec("Tester session page");
  await ana.goto(`/app/sessions/${sA}`);
  await pause(ana, 800);
  await shotFull(ana, "stopped-tester-page", "The tester's stopped page | Her agreed scope, each part with its status, the work she sent, and what still works; Rate waits with its line (“Rating opens on <date>, or sooner if Nora Lane reviews everything you sent.”)");
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
  await nora.check("#payRulesOk"); // (batch 19 section 7)
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
  await shotFull(nora, "settings-dev", "Settings | “Nora Lane · Developer”, the developer profile link, Payments, Contact us, the password form and Delete account (batch 16: no side cards, no excerpts)");
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
/** An admin list (batch 17 §7: a scroll box that loads the next 25 near its end, shared with every account in the database): scroll it until the row shows. */
async function pageTo(page, kind, selector, max = 40) {
  const box = page.locator(`[data-scroll-box="${kind}"]`).first();
  for (let i = 0; i < max && !(await page.locator(selector).count()); i++) {
    if (await page.locator(`[data-end-line="${kind}"]`).count()) break;
    const n = await box.evaluate((b) => b.querySelectorAll("[id], [data-paused-test], [data-chargeback-hold], [data-mine-row], li").length).catch(() => 0);
    await box.evaluate((b) => { b.scrollTop = b.scrollHeight; }).catch(() => {});
    // ("Loading…" shows while the next 25 load: wait for more rows or the end line.)
    for (let w = 0; w < 30; w++) {
      await page.waitForTimeout(300);
      const now = await box.evaluate((b) => b.querySelectorAll("[id], [data-paused-test], [data-chargeback-hold], [data-mine-row], li").length).catch(() => 0);
      if (now > n || (await page.locator(`[data-end-line="${kind}"]`).count())) break;
    }
  }
  await page.locator(selector).first().scrollIntoViewIfNeeded();
}
/** An admin button in a row: fill its fields (e.g. "Why") and press it; returns the text it shows next to it. */
async function adminPress(page, row, label, fields = {}) {
  const span = row.locator("span", { has: page.locator("button", { hasText: label }) }).last();
  for (const [aria, v] of Object.entries(fields)) await span.locator(`:is(input, textarea)[aria-label="${aria}"]`).fill(v); // (batch 15 §20) a reason is a textarea
  await page.waitForTimeout(1200); // (the row's buttons work once the page has hydrated)
  await span.locator("button", { hasText: label }).click();
  // (A press that reloads the page leaves no line to read: the next step reloads anyway.)
  // (Batch 17 §6) An account's Suspend / Reinstate / Delete show a refusal under the row's buttons ([data-account-msg]), not next to the button.
  const line = span.locator(".ok, .err").or(row.locator("[data-account-msg]")).first();
  if (!(await line.waitFor({ timeout: 15000 }).then(() => true, () => false))) return "";
  return line.innerText().catch(() => "");
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
  await shot(admin, "admin-top", "The admin dashboard | The tiles (people, parts awaiting review, charged, the platform's share, owed to testers), then open disputes first", admin.locator("main > section").first());
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
  await pause(admin, 1500); // (the row's buttons work once the page has hydrated)
  await uRow.locator("button", { hasText: "Preview suspension" }).click();
  if (!(await uRow.locator("[data-preview]").waitFor({ timeout: 6000 }).then(() => true, () => false))) await uRow.locator("button", { hasText: "Preview suspension" }).click();
  await uRow.locator("[data-preview]").waitFor();
  await shot(admin, "admin-preview-suspension", "Preview a suspension | What suspending Nora would do right now, before pressing Suspend", uRow);
  await adminPress(admin, uRow, "Suspend", { Why: "Media pass check: several reports" });
  await admin.goto(`/admin?at=${Date.now()}#users`);
  await shot(admin, "admin-suspended-row", "A suspended account | The row says who suspended it (by email), when and why, with Reinstate for that side", admin.locator(`[data-user-row="${nora.uid}"]`));
  await adminPress(admin, admin.locator(`[data-user-row="${nora.uid}"]`), "Reinstate");
  await admin.goto(`/admin?at=${Date.now()}#users`);
  await pause(admin, 1500);
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
    ["dispute", async (P) => { await P.locator(`#total-${d}`).fill("10.00"); await P.locator(`[data-dispute-row="${d}"] button`, { hasText: "Decide" }).click(); return P.locator(`[data-dispute-row="${d}"] .ok, [data-dispute-row="${d}"] .err`).first(); }, "A dispute already decided | Bo decides a dispute Ada decided a moment earlier: “<Ada's email> already decided this dispute at <time>.”"],
    ["suspension", async (P) => { const row = P.locator(`[data-user-row="${omar.uid}"]`); await row.scrollIntoViewIfNeeded(); await row.locator("button", { hasText: "Reinstate" }).click(); return row.locator(".ok, .err").first(); }, "A suspension already lifted | Bo presses Reinstate on a suspension Ada already lifted: “Since this page loaded, <Ada's email> reinstated that account's developer side at <date, time>.” (batch 17 §6), and the row updates"],
    ["pause", async (P) => { const row = P.locator(`[data-test-row="${t}"]`); await row.scrollIntoViewIfNeeded(); await row.locator("button", { hasText: "Lift the pause" }).click(); return row.locator(".ok, .err").first(); }, "A pause already lifted | Bo lifts the team's pause Ada already lifted: “That test's pause was already lifted (by <Ada's email> at <time>).” (batch 22 §5), and the row's button is Pause again"],
    ["approve", async (P) => { const row = P.locator(`[data-lift-row="${nora.uid}"]`); await row.scrollIntoViewIfNeeded(); await row.locator("button", { hasText: "Approve" }).click(); return row.locator(".ok, .err").first(); }, "An Approve already pressed | Bo approves a lift Ada already approved: “This lift was already approved by Ada Admin at <time>.”"],
    ["deleted", async (P) => { const row = P.locator(`[data-user-row="${dee.uid}"]`); await row.scrollIntoViewIfNeeded(); const span = row.locator("span", { has: P.locator("button", { hasText: "Suspend" }) }).last(); await span.locator("textarea").fill("Media pass check"); await span.locator("button", { hasText: "Suspend" }).click(); return row.locator("[data-account-msg], .ok").first(); }, "An account already deleted | Ada deleted Dee's account; Bo suspends it from their older page: “That account was deleted. <Ada's email> deleted it at <date, time>.” (batch 17 §6)"],
  ];
  for (const [key, press, caption] of cases) {
    if (key === "deleted") { const span = L.locator(`[data-user-row="${dee.uid}"] span`, { has: L.locator("button", { hasText: "Delete account" }) }).last(); await span.scrollIntoViewIfNeeded(); await span.locator("textarea").fill("Media pass check: asked by email"); await span.locator("button", { hasText: "Delete account" }).click(); await span.locator(".ok, .err").first().waitFor(); }
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
    "Two admins at once | Ada (left) acts first in each row; Bo (right) presses the same button on their older page and gets the refusal: a decided dispute, a lifted suspension, a lifted pause, an approved lift, a deleted account");
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
    await A.check("#payRulesOk"); // (batch 19 section 7)
    await A.click("button:has-text('Post the test')");
    await A.waitForSelector("text=/You have 10 open tests/");
    await pause(A, 2000);
    await shotSpan(A, "plans-ten-tests-notice", "10 open tests | Post is refused under the button: “You have 10 open tests, the most you can have at once. Stop or close one to post another.” The form keeps its text", "button:has-text('Post the test')", A.locator("text=/You have 10 open tests/").last(), 16, 16);
    // The second tab stops one test.
    await B.click("button:has-text('Stop the test')");
    await B.waitForSelector("dialog[open]");
    await B.fill("dialog[open] #stop-reason", STOP_WHY); // (Batch 17 §15) the required "Why?"
    await pause(B, 800);
    await B.click("dialog[open] button:has-text('Stop the test')");
    await B.waitForSelector("text=This test is stopped.");
    await pause(B, 1500);
    // The first tab presses Post again: it goes through (a drop in the count is never a stop-once reason).
    await A.check("#payRulesOk"); // (batch 19 section 7)
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
  await omar.check("#payRulesOk"); // (batch 19 section 7)
  await omar.click("button:has-text('Post the test')");
  await omar.waitForSelector("text=/You already have an open test/");
  await pause(omar, 800);
  sec("Post a test");
  await shotSpan(omar, "plans-draft-refused", "A draft on the free plan | Omar's subscription ended and he has an open test: posting the round-2 draft is refused with “You already have an open test. Subscribe ($7/month) to run several at once.” and Open Payments", "button:has-text('Post the test')", omar.locator("text=/You already have an open test/").last(), 16, 16);
  // 4. Red at the fields and a blue server notice together: an Open until out of range plus a second open test on the free plan.
  await omar.goto("/app/tests/new");
  await fillPost(omar, "Tide Tracker: alerts", 40);
  await omar.locator("#spots").click();
  await omar.check("#payRulesOk"); // (batch 19 section 7)
  await omar.click("button:has-text('Post the test')");
  await pause(omar, 2500);
  await shotFull(omar, "post-red-and-blue", "Red first, then blue | Open until 40 days ahead on the free plan with a test already open: the red at the field stops Post in the page, so the server's blue notice can't show yet");
  await omar.locator("#openUntil").fill(day(14));
  await omar.locator("#spots").click();
  await omar.check("#payRulesOk"); // (batch 19 section 7)
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
  await P.check("#payRulesOk"); // (batch 19 section 7)
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

// ---------- (Batch 16 section 10) A press with mistakes: the list under the button matches the red fields and goes to the first ----------
group("b16mistakes", async () => {
  const dev = await account(`dev+media${TS}m16@playtest.test`, "Mina Park", "developer", "she");
  const P = await rec(V, dev);
  await P.goto("/app/tests/new");
  await fillPost(P, "First three reefs");
  // Two mistakes: Mature with "idk" as the why, and an empty title.
  await P.locator("label:has-text('Mature (18+) content') input[type=checkbox]").check();
  await P.fill("#matureWhy", "idk");
  await P.fill("#title", "");
  await P.evaluate(() => window.scrollTo(0, 0));
  await pause(P, 800);
  const from = at(P);
  await P.locator("button:has-text('Post the test')").scrollIntoViewIfNeeded();
  await pause(P, 800);
  await P.check("#payRulesOk"); // (batch 19 section 7)
  await P.click("button:has-text('Post the test')");
  await P.waitForSelector("[data-mistake-list] [data-mistake-link]");
  await pause(P, 1500);
  if ((await P.evaluate(() => document.activeElement && document.activeElement.id)) !== "title") throw new Error("the press didn't go to the title");
  const links = await P.locator("[data-mistake-link]").allTextContents();
  if (links.length !== 2 || links[0] !== "Give the test a title." || links[1] !== "Say a little more: at least 5 characters.") throw new Error("list: " + JSON.stringify(links));
  await shot(P, "b16-10-two-red", "§10 Two mistakes | Post went to the title; the title and the Mature why are red, and the list under the button links to each", "[data-mistake-list]");
  await typeSlow(P, "#title", "First three reefs", 60);
  await pause(P, 1200);
  if ((await P.locator("[data-mistake-link]").count()) !== 1) throw new Error("the title's bullet didn't go");
  await P.locator("[data-mistake-link]").first().scrollIntoViewIfNeeded();
  await pause(P, 800);
  await P.click("[data-mistake-link]:has-text('Say a little more')");
  await pause(P, 1200);
  await P.locator("#matureWhy").press("End");
  await typeSlow(P, "#matureWhy", ": sharks bite in the second reef", 50);
  await P.waitForSelector("[data-mistake-list][hidden]", { state: "attached" });
  await pause(P, 1800);
  finishVideo([{ file: await saveVideo(P, "b16-10-mistakes.webm"), from }], "b16-10-mistakes", "§10 A press with mistakes | Mature “idk” and an empty title: Post goes to the title, both are red and listed; fixing the title removes its bullet; the Mature bullet jumps to its box; fixing it, the list goes");
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
  await shot(nora, "b15-40-measured", "§40 The measured length | “Length: 29 min (both in the call …)”; the Pay box's Rate and Amount use it", `#call-${call}`);
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
  // (Batch 16 section 26) No "Lower the length" any more: the call has just Pay.
  await open(ana, `/app/sessions/${sA}`, "#part-live");
  await shot(ana, "b15-40-tester-view", "§40 The tester's view | Ana reads the measured length", "#part-live");
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
  await shot(ben, "b15-26-toggle-on", "§26 The tester's Alerts toggle | At the top right: “Alerts: On” and its line, “Stops a press once for: new terms, your key, pay, calls, delayed pay, your dispute, listing changes, other tabs.”", "[data-tester-alerts]");
  await ben.click("[data-tester-alerts] button");
  await ben.waitForSelector("[data-tester-alerts='off']");
  await shot(ben, "b15-26-toggle-off", "§26 Alerts: Off | One press, saved for all Ben's tests: the grey line now reads “Stops a press only for: new terms, your key marked as working.”", "[data-tester-alerts]");
  await ben.reload();
  await ben.waitForSelector("#a0");
  await ben.locator("#a0").fill("Second try: the fog level is still too dark.");
  ok(await post(nora, "/api/review", { kind: "submission", id: subOf(sB), amount: "15.00", tickedCents: 1500, payKey: require("crypto").randomUUID(), ...go }), "pay Ben");
  await waitLive(ben, "[data-live-top]");
  await pause(ben, 800);
  await shot(ben, "b15-26-off-greyed", "§26 Alerts Off: the live box | Nora paid Ben after his page loaded: the line shows greyed, since it won't stop anything", "[data-live-top]");
  await ben.click("button:has-text('Send my updated answers'), button:has-text('Send my answers')");
  await ben.locator("p.ok").or(ben.locator("text=/^Sent [A-Z]/")).first().waitFor({ timeout: 15000 }).catch(() => {});
  await pause(ben, 1200);
  await shot(ben, "b15-26-off-goes", "§26 Alerts Off: Send goes through | Ben pressed Send once after that payment: no stop box, his answers went straight through", "#part-written");
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
  await D.fill("dialog[open] #stop-reason", STOP_WHY); // (Batch 17 §15) the required "Why?"
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
  await subscribeDev(nora); // (several open tests: the media server's free launch is over)
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


group("b15extra", async () => {
  const nora = await account(`dev+media${TS}lx@playtest.test`, "Nora Lane", "developer", "she");
  setCard(nora.email, "pm_card_visa");
  const ana = await account(`tester+media${TS}lxa@playtest.test`, "Ana Silva", "tester", "she");
  // §14 Previous questions: what was sent, and the draft typed after it.
  const qs = ["What did you like?", "Where did you get stuck?", "Would you play level 4?"];
  const t = await postTest(nora, { questions: qs, spots: "4", liveRateCents: "30.00" });
  const sA = await join(ana, t);
  await sendWritten(ana, sA, ["The music.", "The second bridge.", "Yes."]);
  ok(await post(ana, "/api/kept", { key: `written:${sA}`, data: { answers: ["The music, and the lights at night (edited after sending).", "The second bridge.", "Yes."], notes: "", questions: qs } }), "draft");
  await apiEdit(nora, t, { questions: [qs[0], "Where did you get lost?", qs[2]] });
  const offer = sql(`select id from "TermsOffer" where "contractId" = '${sA}' and status = 'open' order by "createdAt" desc limit 1`);
  ok(await post(ana, `/api/sessions/${sA}/terms`, { ...go, choice: "switch", offerId: offer }), "switch");
  await open(ana, `/app/sessions/${sA}`, "[data-prev-sets]");
  await ana.locator("[data-prev-set] > summary").first().click();
  await ana.locator("[data-prev-version] > summary").nth(1).click().catch(() => {});
  await pause(ana, 600);
  await shot(ana, "b15-14-tester-sets", "§14 The tester's previous set | “Sent <date>” first, then “Draft (not sent)” with the edit she typed after sending; each a read-only fold", "[data-prev-sets]");
  await sendWritten(ana, sA, ["The music, and the lights at night.", "Near the lighthouse.", "Yes."]);
  await open(nora, `/app/tests/${t}`, "[data-prev-sets]");
  await nora.locator("[data-prev-set] > summary").first().click();
  await pause(nora, 600);
  await shot(nora, "b15-14-dev-sets", "§14 The developer's fold | Only what was sent: the draft never reaches the developer", nora.locator("[data-prev-sets]").first());
  // §11 Each person's own time zone in bell lines: Nora in Chicago, Ana in Tokyo, the same booked call.
  own(`update "User" set "timeZone" = 'America/Chicago' where email = ${lit(nora.email)}`);
  own(`update "User" set "timeZone" = 'Asia/Tokyo' where email = ${lit(ana.email)}`);
  await bookCall(nora, ana, t, sA, 50);
  await openBell(nora);
  await shot(nora, "b15-11-bell-chicago", "§11 Nora's bell, in Chicago time | “Booked: <day> at <time> CST”: each line is written in the reader's own zone", bellList(nora));
  await openBell(ana);
  await shot(ana, "b15-11-bell-tokyo", "§11 Ana's bell, in Tokyo time | The same booking in her zone (JST)", bellList(ana));
  // §28 The first live update scrolls up to the live box, once; while typing, a pill instead.
  const ben = await account(`tester+media${TS}lxb@playtest.test`, "Ben Okafor", "tester", "he");
  const sB = await join(ben, t);
  const D = await rec(V, nora);
  await open(D, `/app/tests/${t}`, "main");
  await D.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const fromD = at(D);
  await pause(D, 1500);
  await sendWritten(ben, sB, ["Smooth sailing.", "The fog.", "Yes."]);
  await waitLive(D, "[data-live-top]");
  await pause(D, 3000);
  finishVideo([{ file: await saveVideo(D, "b15-28-scroll.webm"), from: fromD }], "b15-28-scroll-up", "§28 The first live update scrolls up | Nora is at the bottom of the test page when Ben sends his answers: the page scrolls smoothly up to the live box and the new line flashes");
  const T = await rec(V, ana);
  await open(T, `/app/sessions/${sA}`, "#a0");
  await T.locator("#a1").scrollIntoViewIfNeeded();
  await T.locator("#a1").click();
  await T.keyboard.type("Typing my answer…", { delay: 40 });
  ok(await post(nora, "/api/review", { kind: "submission", id: subOf(sA), amount: "10.00", tickedCents: 1000, payKey: require("crypto").randomUUID(), ...go }), "pay Ana");
  await waitLive(T, "[data-live-pill]");
  await pause(T, 800);
  await shot(T, "b15-28-pill", "§28 Never mid-task | Ana is typing when Nora pays her: no scroll; a small pill “1 new update ↑” shows instead and scrolls up when pressed");
  await T.context().close();
  // §7 Sign-in: one message, then the attempt limit.
  const L = await ctx(V);
  await L.goto("/login");
  for (let i = 0; i < 6; i++) {
    await L.fill("input[type=email]", ana.email);
    await L.fill("input[type=password]", "not-the-password-" + i);
    await L.click("form button:has-text('Log in')");
    await pause(L, 900);
    if (i === 0) await shot(L, "b15-07-wrong", "§7 One message for every wrong sign-in | “Wrong email or password” (never which one)", "form");
  }
  await shot(L, "b15-07-too-many", "§7 Too many tries | After several wrong passwords: “Too many tries. Wait 15 minutes or reset your password.”", "form");
  // §35 The invite pill names 3, then “+N more” that opens.
  const kelp = await postTest(nora, { title: "Kelp Forest: devices", devices: ["iPhone", "iPad", "Android phone", "Android tablet", "Mac"], languages: ["English"], spots: "3" });
  const dee = await account(`tester+media${TS}lxd@playtest.test`, "Dee Marsh", "tester", "they", { devices: ["Windows PC"], languages: ["English"] });
  await open(nora, `/app/tests/${kelp}`, "#invite");
  await nora.click("#invite > summary");
  await nora.fill("#invite input[aria-label='Find testers']", "Dee Marsh");
  await pause(nora, 1200);
  await nora.locator(`#invite li[data-invite-row="${dee.uid}"] [data-tag-more]`).waitFor();
  await pause(nora, 800);
  await shot(nora, "b15-35-invite-pill", "§35 Missing needs on an invite row | 3 named, then “+2 more”", nora.locator(`#invite li[data-invite-row="${dee.uid}"]`), () => nora.locator(`#invite li[data-invite-row="${dee.uid}"]`).scrollIntoViewIfNeeded());
  await nora.locator(`#invite li[data-invite-row="${dee.uid}"] [data-tag-more] button`).click().catch(() => {});
  await pause(nora, 500);
  await shot(nora, "b15-35-invite-pill-open", "§35 “+2 more” opened | Every missing need, with “fewer” to fold it again", nora.locator(`#invite li[data-invite-row="${dee.uid}"]`));
  // §23 The team pauses a test while the developer has the test page (left) and Edit (right) open: the buttons go live, Save is refused and routed
  // to the banner, and Stop goes through silently even after a tester's change.
  {
    const admin = await adminAccount();
    const tp = await postTest(nora, { title: "Harbor Run: lighthouse", spots: "3" });
    const sP = await join(ana, tp);
    await join(ben, tp);
    const D = await rec(V, nora), E = await rec(V, nora);
    await open(D, `/app/tests/${tp}`, "#needs-you, main");
    await open(E, `/app/tests/${tp}/edit`, "#title");
    const fromD = at(D), fromE = at(E);
    await E.locator("#title").click();
    await E.keyboard.press("End");
    await typeSlow(E, "#title", " (night)");
    await pause(D, 1200);
    await adminDo(admin, "pause-test", tp, { note: "Media pass check: a tester reported the build link opens a different game." });
    await saveBtn(E).click();
    await E.waitForURL((u) => u.pathname === `/app/tests/${tp}`, { timeout: 20000 });
    await E.waitForSelector("[data-test-banner]");
    await waitLive(D, "[data-test-banner]", 30000);
    await pause(D, 2000);
    await shot(E, "b15-23-save-routed", "§23 Save on a team-paused test | Refused and routed to the test page: under the team's reason, the banner lists “Your Save on Harbor Run: lighthouse didn't go through.”", "[data-test-banner]");
    ok(await post(ana, `/api/sessions/${sP}/leave`, { ...go, reason: "Busy this week" }), "leave (a change after the page loaded)");
    await pause(D, 1500);
    await D.click("button:has-text('Stop the test')");
    await D.waitForSelector("dialog[open]");
    await D.fill("dialog[open] #stop-reason", STOP_WHY); // (Batch 17 §15) the required "Why?"
    await pause(D, 900);
    await D.click("dialog[open] button:has-text('Stop the test')");
    await D.waitForSelector("text=/stopped/i", { timeout: 20000 });
    await pause(D, 2500);
    await shot(D, "b15-23-stopped", "§23 Stop goes through silently | Ana left after the page loaded, yet Stop on the team-paused test went straight through, with no stop box", "[data-test-banner]");
    finishVideo([{ file: await saveVideo(D, "b15-23-d.webm"), from: fromD }, { file: await saveVideo(E, "b15-23-e.webm"), from: fromE }], "b15-23-team-pause",
      "§23 The team pauses a test while it's open | Left, the test page: the banner appears and only Stop, End early and Cancel stay; right, Edit: Save is refused and lands on the test page banner with its line; after Ana leaves, Stop goes through silently");
  }
}, { section: LF, fake: true });

// ---------- Batch 16 (owner, Oct 28): one case or more per item, in the report's "Batch 16 (Oct 28)" section (§ numbers are the items in docs/BATCH-16.md) ----------
const B16 = "Batch 16 (Oct 28)";
/** A subscribed developer (the media server's free launch is over): several open tests, Next round. */
async function subscribeDev(dev) {
  setCard(dev.email, "pm_card_visa");
  ok(await post(dev, "/api/payments/subscription", { action: "subscribe", seenAt: nowIso() }), "subscribe");
}
/** Pay a piece below or at its listing, with the reason a lower amount needs. */
async function payWith(dev, subId, dollars, reason = "") {
  ensureCard(dev.email);
  const cents = Math.round(Number(dollars) * 100);
  return ok(await post(dev, "/api/review", { action: "pay", kind: "submission", id: subId, amount: dollars, tickedCents: cents, reason, note: reason, payKey: require("crypto").randomUUID(), seenAt: nowIso(), confirmed: true }), "pay");
}
/** Opens every <details> around an element (folded panels), so the picture shows it. */
const unfold = (page, sel) => page.evaluate((s) => { let n = document.querySelector(s); while (n) { if (n.tagName === "DETAILS") n.open = true; n = n.parentElement; } }, sel);
/** "YYYY-MM-DDTHH:MM" (local) for a datetime-local box, n days ahead at h:m. */
const localAt = (n, h, m) => { const d = new Date(Date.now() + n * 86400000); d.setHours(h, m, 0, 0); return d; };
const dtLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
/** A press that may open the "Are you sure?" pop-up first: confirms it when it does. */
async function pressConfirm(page, button, confirmLabel) {
  await button.click();
  const dlg = page.locator("dialog[open]");
  if (await dlg.waitFor({ state: "visible", timeout: 2500 }).then(() => true, () => false)) {
    // (Batch 17 §15) Stop the test's pop-up has a required "Why?" (kept when the same pop-up is pressed again).
    const why = dlg.locator("#stop-reason");
    if ((await why.count()) && !(await why.inputValue())) await why.fill(STOP_WHY);
    await dlg.locator("button", { hasText: confirmLabel }).last().click();
  }
}
/** The largest plain scroll box on the page, marked for a picture. */
async function biggestScroll(page) {
  await page.evaluate(() => {
    const all = [...document.querySelectorAll("[data-scroll-list]")];
    all.forEach((e) => e.removeAttribute("data-media-pick"));
    const best = all.sort((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight))[0];
    if (best) best.setAttribute("data-media-pick", "");
  });
  return page.locator("[data-media-pick]");
}

group("b16a", async () => {
  // §4, §5, §9, §11, §13, §14, §15: the tester's Alerts line, Pays on average, the Mature box, a block, dashboard search, scroll boxes, your tests with a tester.
  const nora = await account(`dev+media${TS}ba@playtest.test`, "Nora Lane", "developer", "she");
  const omar = await account(`dev+media${TS}bao@playtest.test`, "Omar Reyes", "developer", "he");
  const nina = await account(`dev+media${TS}ban@playtest.test`, "Nina Cho", "developer", "she");
  await subscribeDev(nora);
  await subscribeDev(omar);
  const ana = await account(`tester+media${TS}baa@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}bab@playtest.test`, "Ben Okafor", "tester", "he");
  const t1 = await postTest(nora, { title: "Harbor Run: first 3 levels", spots: "6" });
  const sA = await join(ana, t1), sB = await join(ben, t1);
  // §4 The grey line under Alerts says what stops a press, for the state shown.
  {
    own(`update "User" set "testerAlertsOff" = false where email = ${lit(ana.email)}`);
    const T = await rec(V, ana);
    await open(T, `/app/sessions/${sA}`, "[data-tester-alerts]");
    const from = at(T);
    await pause(T, 1500);
    await shot(T, "b16-04-alerts-on", "§4 Alerts On | The grey line under the button lists everything that stops a press once: new terms, your key, pay, calls, delayed pay, your dispute, listing changes and other tabs.", "[data-tester-alerts]");
    await T.click("[data-tester-alerts] button");
    await T.waitForSelector("[data-tester-alerts='off']");
    await pause(T, 1500);
    await shot(T, "b16-04-alerts-off", "§4 Alerts Off | One press and the line swaps: only new terms and your key marked as working still stop a press.", "[data-tester-alerts]");
    await T.click("[data-tester-alerts] button");
    await T.waitForSelector("[data-tester-alerts='on']");
    await pause(T, 1500);
    finishVideo([{ file: await saveVideo(T, "b16-04.webm"), from }], "b16-04-alerts-video", "§4 Alerts line, live | Ana turns Alerts off and on again, and the grey line under the button changes with it each time.");
  }
  // §5 Pays on average: Ana got the full $10, Ben $5 of $10: 75% of the listing over 2 pieces of work.
  await sendWritten(ana, sA);
  await sendWritten(ben, sB);
  await payWith(nora, subOf(sA), "10.00");
  await payWith(nora, subOf(sB), "5.00", "Only the first answer was about this build.");
  const t2 = await postTest(nora, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"], spots: "6" });
  await open(ana, `/app/developers/${nora.uid}`, "section[aria-label='How this developer reviews']");
  await shotSpan(ana, "b16-05-pays-profile", "§5 Pays on average on the profile | The tile shows one share of the listing with the hint “of the listing, over 2 pieces of work”, and no accepted / partly / rejected split.", "section[aria-label='How this developer reviews']", ana.locator("section[aria-label='How this developer reviews'] + p"));
  await open(ana, `/app/find/${t2}`, "text=/How Nora Lane reviews/");
  await shot(ana, "b16-05-pays-join", "§5 Pays on average on the join page | The same value and hint in “How Nora Lane reviews” before a tester joins.", ana.locator("section.card", { hasText: "How Nora Lane reviews" }));
  // §9 The Mature box: the red line says why it's red, with a counter.
  {
    const P = await rec(V, nora);
    await P.goto("/app/tests/new");
    await P.waitForSelector("#productName");
    const box = P.locator("label:has-text('Mature (18+) content')").locator("xpath=..");
    await P.locator("label:has-text('Mature (18+) content')").scrollIntoViewIfNeeded();
    const from = at(P);
    await pause(P, 800);
    await P.locator("label:has-text('Mature (18+) content') input[type=checkbox]").check();
    await pause(P, 600);
    await P.click("#matureWhy");
    await P.click("#title");
    await P.locator("#matureWhy").scrollIntoViewIfNeeded();
    await pause(P, 1500);
    await shot(P, "b16-09-mature-empty", "§9 Mature, left empty | Left empty, the box is red with “Say why this test is mature (18+): it's required for mature content.” and the counter reads 0 / 500.", box);
    await typeSlow(P, "#matureWhy", "idk", 150);
    await P.click("#title");
    await P.locator("#matureWhy").scrollIntoViewIfNeeded();
    await pause(P, 1500);
    await shot(P, "b16-09-mature-short", "§9 Mature, too short | With “idk” the box stays red with “Say a little more: at least 5 characters.” and the counter reads 3 / 500.", box);
    await P.locator("#matureWhy").fill("");
    await typeSlow(P, "#matureWhy", "Sharks bite in the second reef", 40);
    await P.click("#title");
    await P.locator("#matureWhy").scrollIntoViewIfNeeded();
    await pause(P, 1800);
    finishVideo([{ file: await saveVideo(P, "b16-09.webm"), from }], "b16-09-mature-video", "§9 The Mature box, live | Ticking Mature and leaving the box empty, then typing “idk”, each shows its own red line; a real reason clears it, and the counter follows.");
  }
  // §11 A block hides the developer's other tests: Ana blocks Omar; a direct link to his new test shows nothing of it.
  const tO1 = await postTest(omar, { productName: "Tide Tracker", title: "Tide Tracker: widgets", categories: ["Productivity"], spots: "5" });
  await join(ana, tO1);
  ok(await post(ana, "/api/blocks", { ...go, userId: omar.uid }), "block");
  const tO2 = await postTest(omar, { productName: "Tide Tracker", title: "Tide Tracker: alarms", categories: ["Productivity"], spots: "5" });
  await open(ana, `/app/find/${tO2}`, "[data-unavailable]");
  await shot(ana, "b16-11-blocked-link", "§11 A blocked developer's test | Ana blocked Omar; his new test's direct link reads only “This test isn't available right now.”, with nothing of the listing and no word of the block.", "main");
  // §13, §14, §15: Ana in many tests (Nora's open and stopped ones, Omar's ended by the block, one of Nina's she left).
  const tN = await postTest(nina, { productName: "Pocket Chef", title: "Pocket Chef: recipe search", categories: ["Shopping"], spots: "5" });
  const sN = await join(ana, tN);
  ok(await post(ana, `/api/sessions/${sN}/leave`, { ...go, reason: "No time this week" }), "leave");
  const t3 = await postTest(nora, { productName: "Night Market", title: "Night Market demo", categories: ["Game"], spots: "5" });
  await join(ana, t3);
  await stopTest(nora, t3);
  for (const [i, n] of ["Coral Quest: boss fight", "Glow Garden: night levels", "Reef Rescue: first reef", "Lumen Notes: sync", "Budget Buddy: sign-up"].entries()) {
    const x = await postTest(nora, { productName: n.split(":")[0], title: n, spots: "5", categories: ["Game"] });
    await join(ana, x);
    if (i === 0) await join(ben, x);
  }
  {
    const T = await rec(V, ana);
    await open(T, "/app", "#devSearch");
    const from = at(T);
    await pause(T, 1200);
    await typeSlow(T, "#devSearch", "NOR", 200);
    await T.waitForSelector("[data-dev-search-row]");
    await pause(T, 1500);
    await shotSpan(T, "b16-13-search-match", "§13 Search by developer | “NOR” finds every test with Nora Lane, open or stopped, most recent first, in its own scroll box (any part of the name, any case).", "#devSearch", T.locator("[data-dev-search] [data-scroll-list]"));
    await T.locator("#devSearch").fill("");
    await typeSlow(T, "#devSearch", "omar", 200);
    await pause(T, 1500);
    await shotSpan(T, "b16-13-search-blocked", "§13 A blocked developer's past test | “omar” still finds the test Ana was in before she blocked him.", "#devSearch", T.locator("[data-dev-search] [data-scroll-list]"));
    await T.locator("#devSearch").fill("");
    await typeSlow(T, "#devSearch", "Zed", 200);
    await T.waitForSelector("[data-dev-search-none]");
    await pause(T, 1500);
    await shotSpan(T, "b16-13-search-none", "§13 No match | A name nobody matches shows “No tests with a developer named “Zed”.”", "#devSearch", "[data-dev-search-none]");
    await T.locator("#devSearch").fill("");
    await pause(T, 1500);
    finishVideo([{ file: await saveVideo(T, "b16-13.webm"), from }], "b16-13-search-video", "§13 Searching the tester dashboard | Ana types “NOR”, then “omar”, then “Zed”: matching tests appear under the box, then the no-match line; clearing it brings the dashboard back.");
  }
  // §14 Plain scroll boxes on both dashboards.
  {
    const T = await rec(V, ana);
    await open(T, "/app", "[data-scroll-list]");
    const list = await biggestScroll(T);
    await list.scrollIntoViewIfNeeded();
    const from = at(T);
    await pause(T, 1000);
    await shot(T, "b16-14-tester-box", "§14 The tester dashboard's lists | Every test is in the list, about 4 rows tall, scrolling inside its box; no “Show N more” button.", list.locator("xpath=ancestor::section[1]"));
    const b = await list.boundingBox();
    await T.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 120));
    for (let i = 0; i < 6; i++) { await T.mouse.wheel(0, 120); await T.waitForTimeout(350); }
    await pause(T, 1500);
    finishVideo([{ file: await saveVideo(T, "b16-14-t.webm"), from }], "b16-14-tester-video", "§14 Scrolling inside the box | The list scrolls on its own while its heading stays put.");
    const D = await rec(V, nora);
    await open(D, "/app", "[data-test-card]");
    const cards = await biggestScroll(D);
    await cards.scrollIntoViewIfNeeded();
    const fromD = at(D);
    await pause(D, 1000);
    await shot(D, "b16-14-dev-cards", "§14 The developer's Your tests | The card grid sits in a box about 2 card rows tall (one column on phones) and scrolls inside it.", cards.locator("xpath=ancestor::section[1]"));
    const c = await cards.boundingBox();
    await D.mouse.move(c.x + c.width / 2, c.y + Math.min(c.height / 2, 200));
    for (let i = 0; i < 8; i++) { await D.mouse.wheel(0, 160); await D.waitForTimeout(350); }
    await pause(D, 1500);
    finishVideo([{ file: await saveVideo(D, "b16-14-d.webm"), from: fromD }], "b16-14-dev-video", "§14 Scrolling the test cards | Nora's 8 tests scroll inside their box; the heading and filters above never move.");
  }
  // §15 Your tests with <name>, on a tester's profile seen by the developer.
  await open(nora, `/app/testers/${ana.uid}`, "[data-tester-tests]");
  await shot(nora, "b16-15-tests-with", "§15 Your tests with Ana Silva | Only Nora's own tests Ana joined (Nina's and Omar's never show), most recent first, each with when she joined and her state there.", "[data-tester-tests]");
  await nora.locator("[data-tests-filter='open']").uncheck();
  await pause(nora, 600);
  await shot(nora, "b16-15-closed-only", "§15 Closed only | With Open unticked, only the stopped test remains, marked Ended.", "[data-tester-tests]");
  await nora.locator("[data-tests-filter='open']").check();
  await nora.locator("[data-tests-filter='closed']").uncheck();
  await pause(nora, 600);
  await shot(nora, "b16-15-open-only", "§15 Open only | With Closed unticked, only the tests still running remain.", "[data-tester-tests]");
}, { section: B16, fake: true });

group("b16b", async () => {
  // §12 and §29 Invite search over every tester; §31 Invite stops once for requirement changes; §21 another tab's Pay and invite.
  const nora = await account(`dev+media${TS}bb@playtest.test`, "Nora Lane", "developer", "she");
  await subscribeDev(nora);
  // Names only this group uses (one per size), so a search shows this run's tester alone; an earlier run's copy is retired from the tester side.
  const FERN = phone() ? "Fern Castillo" : "Fern Abara", FAY = phone() ? "Fay Lindqvist" : "Fay Okonkwo";
  for (const n of [FERN, FAY]) own(`update "User" set "isTester" = false where name = ${lit(n)} and email like 'tester+media%@playtest.test'`);
  const fern = await account(`tester+media${TS}bbf@playtest.test`, FERN, "tester", "she");
  own(`update "User" set "createdAt" = timestamp '2025-01-15 10:00' where email = ${lit(fern.email)}`);
  // More than 500 testers newer than Fern (throwaway rows of this run when the database has fewer).
  const newer = Number(sql(`select count(*) from "User" where "isTester" and "deletedAt" is null and "createdAt" > timestamp '2025-01-15 10:00'`));
  if (newer < 520) {
    own(`insert into "User" (id, email, name, "isTester", "createdAt", "emailVerifiedAt") select 'mf' || md5(random()::text || g), 'filler+media${TS}-' || g || '@playtest.test', 'Filler ' || g, true, (now() at time zone 'utc'), (now() at time zone 'utc') from generate_series(1, ${520 - newer}) g`);
    own(`insert into "TesterProfile" (id, "userId", devices, categories, languages, "updatedAt") select 'mp' || md5(random()::text || id), id, ARRAY['Windows PC'], ARRAY[]::text[], ARRAY['English'], (now() at time zone 'utc') from "User" where email like 'filler+media${TS}-%@playtest.test'`);
  }
  console.log("   testers newer than Fern:", sql(`select count(*) from "User" where "isTester" and "deletedAt" is null and "createdAt" > timestamp '2025-01-15 10:00'`));
  const t = await postTest(nora, { spots: "6" });
  {
    const D = await rec(V, nora);
    await open(D, `/app/tests/${t}`, "#invite");
    await D.click("#invite > summary");
    await D.locator("#invite input[aria-label='Find testers']").scrollIntoViewIfNeeded();
    const from = at(D);
    await pause(D, 1000);
    await typeSlow(D, "#invite input[aria-label='Find testers']", FERN, 120);
    await D.waitForSelector(`#invite [data-invite-found] li[data-invite-row="${fern.uid}"]`, { timeout: 20000 });
    await pause(D, 1800);
    await shotSpan(D, "b16-12-invite-search", "§12 and §29 Search finds an old tester | Fern joined in January 2025, behind more than 500 newer testers: the server's search finds her, and the results sit right under the search box.", D.locator("#invite input[aria-label='Find testers']"), "#invite [data-invite-find]");
    finishVideo([{ file: await saveVideo(D, "b16-12.webm"), from }], "b16-12-invite-video", "§12 and §29 Searching by name | Typing her name asks the server, and her row appears in “Find testers” directly under the box, above the other lists.");
  }
  // §31 The test's requirements and a ticked tester's devices change in other tabs: Invite stops once naming both.
  const fay = await account(`tester+media${TS}bby@playtest.test`, FAY, "tester", "she", { devices: ["Android phone"], languages: ["English"] });
  const tR = await postTest(nora, { title: "Harbor Run: tablets", devices: ["Windows PC"], spots: "6" });
  {
    const D = await rec(V, nora);
    await open(D, `/app/tests/${tR}`, "#invite");
    await D.click("#invite > summary");
    await D.locator("#invite input[aria-label='Find testers']").scrollIntoViewIfNeeded();
    const from = at(D);
    await typeSlow(D, "#invite input[aria-label='Find testers']", FAY, 80);
    const row = D.locator(`#invite li[data-invite-row="${fay.uid}"]`).first();
    await row.waitFor({ timeout: 20000 });
    await row.locator("input[type=checkbox]").check();
    await pause(D, 1200);
    await apiEdit(nora, tR, { devices: ["iPad"] });
    ok(await post(fay, "/api/profile", { name: FAY, pronoun: "she", isDeveloper: false, isTester: true, devices: ["Android phone", "iPad"], languages: ["English"], categories: [] }), "fay profile");
    await D.locator("#invite button", { hasText: /^Invite$/ }).click();
    await D.waitForSelector("#invite [data-stop-box], #invite .info:has-text('Press Invite again')", { timeout: 15000 });
    await pause(D, 2000);
    await shot(D, "b16-31-invite-stop", "§31 Invite stops once for requirement changes | The test's devices changed in Edit (Windows PC → iPad) and the ticked tester added iPad to hers: Invite stops once naming both, and the panel shows the new tags.", "#invite");
    await D.locator("#invite button", { hasText: /^Invite$/ }).click();
    await D.waitForSelector("#invite [data-invite-msg], text=/Invited/", { timeout: 15000 }).catch(() => {});
    await pause(D, 2000);
    finishVideo([{ file: await saveVideo(D, "b16-31.webm"), from }], "b16-31-invite-video", "§31 Invite after requirement changes | Nora ticks a tester; another tab changes the test's devices and the tester adds iPad to her profile; the first Invite stops once with both changes, the second sends the invite.");
  }
  // §21 Another tab's big change stops every press once; an invite from another tab shows live.
  const ana = await account(`tester+media${TS}bba@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}bbb@playtest.test`, "Ben Okafor", "tester", "he");
  const cam = await account(`tester+media${TS}bbc@playtest.test`, "Cam Lee", "tester", "they");
  const sA = await join(ana, t), sB = await join(ben, t);
  await sendWritten(ana, sA);
  await sendWritten(ben, sB);
  const subA = subOf(sA), subB = subOf(sB);
  {
    const D = await rec(V, nora);
    await open(D, `/app/tests/${t}`, `#piece-${subB}`);
    await D.click("#invite > summary");
    await D.fill("#invite input[aria-label='Find testers']", "Cam Lee");
    await D.locator(`#invite li[data-invite-row="${cam.uid}"]`).first().waitFor({ timeout: 20000 });
    await D.locator(`#invite li[data-invite-row="${cam.uid}"]`).first().scrollIntoViewIfNeeded();
    const from = at(D);
    await pause(D, 1200);
    ok(await post(nora, `/api/tests/${t}/invite`, { ...go, testerIds: [cam.uid] }), "invite in another tab");
    await waitLive(D, "[data-live-top] >> text=/You invited Cam Lee in another tab/", 30000);
    await waitLive(D, "#invite h3:has-text('Invited')", 30000);
    await D.locator(`#invite li[data-invite-row="${cam.uid}"]`).first().scrollIntoViewIfNeeded().catch(() => {});
    await pause(D, 2000);
    await shot(D, "b16-21-live-invite", "§21 An invite from another tab, live | The live box says “You invited Cam Lee in another tab” and Cam's row in the invite panel updates at once.", "[data-live-top]");
    await shotSpan(D, "b16-21-invite-row", "§21 The invite panel updated | “Invited” now lists Cam Lee, waiting for him to join, without reloading the page.", D.locator("#invite h3", { hasText: "Invited" }), D.locator("#invite button", { hasText: "Cancel invite" }).first());
    await apiPay(nora, subA, "10.00");
    await payPiece(D, subB);
    await D.waitForSelector(`#piece-${subB} [data-stop-box]`, { timeout: 15000 });
    await pause(D, 2000);
    await shot(D, "b16-21-other-tab-stop", "§21 Another tab's Pay stops this press once | Nora paid Ana in another tab, so her Pay on Ben's answers here stops once with “You paid Ana Silva … in another tab” and “Press Pay again to go ahead.”", `#piece-${subB}`);
    await D.locator(`#piece-${subB} button`, { hasText: /^Pay$/ }).first().click();
    await D.waitForSelector("text=/Paid \\$10\\.00/", { timeout: 15000 }).catch(() => {});
    await pause(D, 2000);
    finishVideo([{ file: await saveVideo(D, "b16-21.webm"), from }], "b16-21-video", "§21 What another tab did | An invite made in another tab shows live in the panel; a Pay made in another tab stops the next Pay here once, and the second press pays.");
  }
}, { section: B16, fake: true });

group("b16c", async () => {
  // §16 to §20: Edit's Open until cap and its cross-tab notes.
  const nora = await account(`dev+media${TS}bc@playtest.test`, "Nora Lane", "developer", "she");
  await subscribeDev(nora);
  const ana = await account(`tester+media${TS}bca@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}bcb@playtest.test`, "Ben Okafor", "tester", "he");
  const t = await postTest(nora, { spots: "4", openUntil: day(14) });
  await join(ana, t);
  // §16 Open until: the cap 30 days after the test opened, and what each tester gets.
  {
    const E = await rec(V, nora);
    await open(E, `/app/tests/${t}/edit`, "#openUntil");
    await E.locator("#openUntil").scrollIntoViewIfNeeded();
    const from = at(E);
    await pause(E, 1000);
    await E.locator("#openUntil").fill(day(19));
    await E.locator("#spots").click();
    await E.waitForSelector("[data-tester-days]");
    await pause(E, 1500);
    await shot(E, "b16-16-hint", "§16 Edit's Open until hint | Edit says “only later, up to <date> (30 days after the test opened)” and what each tester gets after the change: “(14 now + 5)”.", panel(E, "Who and how long"));
    await E.locator("#openUntil").fill(day(35));
    await E.locator("#spots").click();
    await pause(E, 1500);
    await shot(E, "b16-16-cap-red", "§16 Past the cap | A date more than 30 days after the test opened turns red: “Open until can be at most 30 days after the test opened (<date>).”", panel(E, "Who and how long"));
    finishVideo([{ file: await saveVideo(E, "b16-16.webm"), from }], "b16-16-video", "§16 Moving Open until | 5 days later shows “(14 now + 5)”; a date past the 30-day cap turns red.");
  }
  // §17 and §19 (short): another tab saved the same title this tab typed (no note) and Spots 4 → 5 (one line).
  const long = "Sail through the first three harbors. " + "Steer around the rocks, collect the lanterns and dock at each pier before the tide turns. ".repeat(6);
  const t2 = await postTest(nora, { title: "Harbor Run: night", spots: "4", openUntil: day(20), description: long });
  {
    const A = await rec(V, nora);
    await open(A, `/app/tests/${t2}/edit`, "#title");
    const from = at(A);
    await A.locator("#title").click();
    await A.keyboard.press("End");
    await typeSlow(A, "#title", " (beta)", 80);
    await pause(A, 800);
    await apiEdit(nora, t2, { title: "Harbor Run: night (beta)", spots: 5 });
    await waitLive(A, "[data-field-note] >> text=/Spots: 4 → 5/", 30000);
    await A.locator("#spots").scrollIntoViewIfNeeded();
    await pause(A, 2000);
    await shot(A, "b16-17-same-title", "§17 The same value saved elsewhere | Another tab saved exactly the title typed here: no blue note, and it no longer counts as unsaved.", field(A, "title"));
    await shot(A, "b16-19-spots-line", "§19 A short field changed elsewhere | A short value changes on one line: “Changed in another tab or device at <time>: Spots: 4 → 5”.", field(A, "spots"));
    // §19 (long): this tab had typed other instructions; another tab saved new ones.
    await A.locator("#description").scrollIntoViewIfNeeded();
    await A.locator("#description").fill("");
    await typeSlow(A, "#description", "Play the night levels with the sound on and tell us when the music changes.", 25);
    await pause(A, 800);
    await apiEdit(nora, t2, { description: "Sail through all five harbors at night and tell us where the map or the controls get confusing." });
    await waitLive(A, "[data-copy-typed]", 30000);
    await A.locator("#description").scrollIntoViewIfNeeded();
    await pause(A, 1500);
    await A.evaluate(() => document.querySelectorAll("[data-live-pill]").forEach((e) => { e.style.display = "none"; }));
    await shot(A, "b16-19-before-copy", "§19 Instructions changed elsewhere | The note gives “Instructions:” and the text it replaced, folded to 3 lines with Show more, then “What you typed (not saved):” in full with a Copy button.", field(A, "description"));
    await field(A, "description").locator("button", { hasText: "Show more" }).first().click();
    await pause(A, 1200);
    await shot(A, "b16-19-before-open", "§19 Show more | The text it replaced opens in a scroll box about 8 lines tall.", field(A, "description"));
    finishVideo([{ file: await saveVideo(A, "b16-17-19.webm"), from }], "b16-17-19-video", "§17 and §19 Notes from another tab | The same title saved elsewhere brings no note; Spots shows “4 → 5” on one line; new instructions show what they replaced and what was typed here, with Copy.");
  }
  // §18 Keys: one line per kind, removals named. §20 A key deleted here and given to a joining tester: a blue line, live, never red.
  const t3 = await postTest(nora, { title: "Lumen Notes beta", spots: "3", openUntil: day(20), accessKeys: "K-1\nK-2\nK-3\nK-4\nK-5\nK-6" });
  await join(ana, t3); // K-1
  {
    const A = await rec(V, nora);
    await open(A, `/app/tests/${t3}/edit`, "#keysFree");
    await A.locator("#keysFree").scrollIntoViewIfNeeded();
    const from = at(A);
    await pause(A, 1000);
    await apiEdit(nora, t3, {}, { add: ["K-7", "K-8", "K-9"], remove: ["K-5"] });
    await waitLive(A, "#keys >> text=/Removed: K-5/", 30000);
    await A.locator("#keysFree").scrollIntoViewIfNeeded();
    await pause(A, 1800);
    await shot(A, "b16-18-keys-note", "§18 Keys changed in another tab | One line per kind: “Added: K-7, K-8, K-9” and “Removed: K-5”; the deleted key leaves this tab's Free box too.", "#keys");
    await removeKey(A, "K-2");
    await pause(A, 1200);
    await join(ben, t3); // the server still had K-2 free
    await waitLive(A, "#keys >> text=/joined and was given K-2, which you had deleted here/", 30000);
    await A.locator("#keysFree").scrollIntoViewIfNeeded();
    await pause(A, 2000);
    await shot(A, "b16-20-given-key", "§20 A key you deleted, given to a joining tester | As soon as the page sees it, a blue line says “Ben Okafor joined and was given K-2, which you had deleted here.”, and nothing is red.", "#keys");
    finishVideo([{ file: await saveVideo(A, "b16-18-20.webm"), from }], "b16-18-20-video", "§18 and §20 Keys from other tabs, live | Another tab adds three keys and removes one; then Nora deletes K-2 here and Ben joins with it: the blue line says so without any press.");
  }
}, { section: B16, fake: true });

group("b16d", async () => {
  // §24 the tester page after a stop; §25 the first press on a stopped test; §36 rounding; §39 Charge; §40 the grey call line.
  const nora = await account(`dev+media${TS}bd@playtest.test`, "Nora Lane", "developer", "she");
  await subscribeDev(nora);
  const ana = await account(`tester+media${TS}bda@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}bdb@playtest.test`, "Ben Okafor", "tester", "he");
  // (§22's Pay more line was replaced by batch 17 §19: see group b17c.)
  // §24 A stale Send after the stop: refused, and the page goes to the top where the stopped line names it.
  {
    const t = await postTest(nora, { title: "Harbor Run: lighthouse", spots: "4" });
    const s = await join(ana, t);
    const T = await rec(V, ana);
    await open(T, `/app/sessions/${s}`, "#a0");
    await T.locator("#a0").scrollIntoViewIfNeeded();
    const from = at(T);
    await typeSlow(T, "#a0", "The lighthouse beam is lovely.", 30);
    await T.locator("#a1").fill("The fog at the second pier.");
    await pause(T, 600);
    await stopTest(nora, t);
    await T.click("button:has-text('Send my answers')");
    await T.waitForSelector("[data-work-over-failed]", { timeout: 20000 });
    await pause(T, 2500);
    await shot(T, "b16-24-stale-send", "§24 A Send from an old page after the stop | The press is refused and the page jumps to the top, where the stopped line says “Nora Lane stopped the test on <date>, so your Send didn't go through.” and what still works.", "[data-stopped-line]");
    await T.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await pause(T, 1500);
    finishVideo([{ file: await saveVideo(T, "b16-24.webm"), from }], "b16-24-video", "§24 After the stop | Ana's answers are typed when Nora stops the test; her Send is refused and the page moves to the stopped line, and Send, the answer boxes and the key box are gone.");
  }
  // §25 On a stopped test a Pay goes through on the first press, even after another tab's Pay.
  {
    const t = await postTest(nora, { title: "Harbor Run: reef", spots: "4" });
    const sA = await join(ana, t), sB = await join(ben, t);
    await sendWritten(ana, sA);
    await sendWritten(ben, sB);
    await stopTest(nora, t);
    const subA = subOf(sA), subB = subOf(sB);
    const D = await rec(V, nora);
    await open(D, `/app/tests/${t}`, `#piece-${subA}`);
    await D.locator(`#piece-${subA}`).scrollIntoViewIfNeeded();
    const from = at(D);
    await pause(D, 1200);
    await apiPay(nora, subB, "10.00"); // another tab
    await payPiece(D, subA);
    await D.waitForSelector("text=/Paid \\$10\\.00/", { timeout: 15000 }).catch(() => {});
    await pause(D, 2500);
    const stopped = await D.locator(`#piece-${subA} [data-stop-box]`).count();
    if (stopped) console.log("   ! §25: the Pay stopped once");
    await shot(D, "b16-25-first-press", "§25 A stopped test: the first press goes through | Another tab paid Ben meanwhile, yet Nora's Pay on Ana's answers went straight through, with no stop box.", D.locator(`[data-pay-more="${subA}"]`).locator("xpath=ancestor::*[contains(., 'Paid in all')][1]"));
    finishVideo([{ file: await saveVideo(D, "b16-25.webm"), from }], "b16-25-video", "§25 Pay on a stopped test | Another tab pays Ben; Nora presses Pay on Ana's answers once and it goes through.");
  }
  // §36 Money boxes round to cents.
  {
    const t = await postTest(nora, { title: "Harbor Run: small change", writtenCents: "1.00", spots: "4" });
    const s = await join(ana, t);
    await sendWritten(ana, s);
    const sub = subOf(s);
    const D = await rec(V, nora);
    await open(D, `/app/tests/${t}`, `#amt-${sub}`);
    await D.locator(`#amt-${sub}`).scrollIntoViewIfNeeded();
    const from = at(D);
    await D.locator(`#amt-${sub}`).fill("");
    await typeSlow(D, `#amt-${sub}`, "1.4545", 180);
    await pause(D, 800);
    await D.locator(`#amt-${sub}`).press("Tab");
    await pause(D, 1500);
    const v = await D.locator(`#amt-${sub}`).inputValue();
    if (v !== "1.45") console.log("   ! §36: the box shows", v);
    await shot(D, "b16-36-rounded", "§36 Money boxes round to cents | “1.4545” becomes 1.45 when the box is left, so the amount charged is the one shown.", `#piece-${sub}`);
    finishVideo([{ file: await saveVideo(D, "b16-36.webm"), from }], "b16-36-video", "§36 Rounding as you leave the box | Nora types 1.4545 and moves on: the box shows 1.45, with no red.");
  }
  // §39 Charge: no tick at $9; the required tick over $200.
  {
    const t = await postTest(nora, { title: "Harbor Run: quick look", writtenCents: "9.00", spots: "4" });
    const s = await join(ana, t);
    await sendWritten(ana, s);
    openCharge(s, t);
    await open(ana, `/app/sessions/${s}`, "button:has-text('Charge Nora Lane')");
    const box = ana.locator("div[data-mistakes-root]", { has: ana.locator("button", { hasText: /^Charge / }) }).first();
    await shot(ana, "b16-39-charge-9", "§39 Charge $9.00 | There is no tick: the button names the amount (“Charge Nora Lane $9.00”) and goes through on its own.", box);
    const t2 = await postTest(nora, { title: "Harbor Run: full playthrough", writtenCents: "250.00", confirmHigh: ["written"], spots: "4" });
    const s2 = await join(ben, t2);
    await sendWritten(ben, s2);
    openCharge(s2, t2);
    await open(ben, `/app/sessions/${s2}`, "[data-charge-tick]");
    const box2 = ben.locator("div[data-mistakes-root]", { has: ben.locator("button", { hasText: /^Charge / }) }).first();
    await shot(ben, "b16-39-charge-250", "§39 Charge over $200 | The tick “Charge Nora Lane $250.00 now (over $200)” is required, and the button stays disabled until it's ticked.", box2);
  }
  // §40 The tester's call part: one grey line per call, no blue box.
  {
    const t = await postTest(nora, { title: "Harbor Run: live", liveRateCents: "30.00", spots: "4" });
    const s = await join(ana, t);
    const call = await bookCall(nora, ana, t, s, 0.1);
    tookPlace(call, nora.uid, ana.uid, 90, 29);
    await open(nora, `/app/tests/${t}`, `#call-${call}`); // (the page load makes the length final)
    await open(ana, `/app/sessions/${s}`, "#part-live");
    await ana.waitForSelector("#part-live [data-call-row]", { timeout: 15000 }).catch(() => {});
    await shot(ana, "b16-40-call-line", "§40 A held call on the tester's page | One short grey line, “<time> · 29 min · waiting for Nora Lane to pay”, instead of a blue box per call.", "#part-live");
  }
}, { section: B16, fake: true });

group("b16e", async () => {
  // §27 profile changed elsewhere; §28 a suspended tester's limited view; §30 the account page; §37 excerpts with their question; §38A an offer arriving live.
  const nora = await account(`dev+media${TS}be@playtest.test`, "Nora Lane", "developer", "she");
  await subscribeDev(nora);
  const ana = await account(`tester+media${TS}bea@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}beb@playtest.test`, "Ben Okafor", "tester", "he");
  const admin = await adminAccount();
  // §27 The profile editor: devices changed in another tab; Save stops once and keeps the typed bio.
  {
    const P = await rec(V, ben);
    await open(P, "/app/profile", "#bio");
    await P.locator("#bio").scrollIntoViewIfNeeded();
    const from = at(P);
    await typeSlow(P, "#bio", "I test racing and puzzle games on PC and tablet.", 30);
    await pause(P, 600);
    ok(await post(ben, "/api/profile", { name: "Ben Okafor", pronoun: "he", isDeveloper: false, isTester: true, devices: ["Windows PC", "iPad"], languages: ["English"], categories: [] }), "profile in another tab");
    await P.click("button:has-text('Save profile')");
    await P.waitForSelector("text=/Changed in another tab or device since you opened this page/", { timeout: 15000 });
    await pause(P, 2000);
    await shot(P, "b16-27-profile-stop", "§27 The profile changed in another tab | Save stops once with “Changed in another tab or device since you opened this page:” and “Devices: Windows PC → Windows PC, iPad”, keeping the typed bio.", P.locator(".info", { hasText: "Changed in another tab or device" }).first());
    await P.click("button:has-text('Save profile')");
    await pause(P, 2500);
    finishVideo([{ file: await saveVideo(P, "b16-27.webm"), from }], "b16-27-video", "§27 Save after a change elsewhere | Ben types his bio; another tab adds iPad to his devices; the first Save stops once naming it, the second saves the bio on top.");
  }
  // §37 An excerpt shows the question it answers.
  {
    const p = await paidPart(nora, ana, { productName: "Harbor Run", title: "Harbor Run: first 3 levels", spots: "5" });
    ok(await askExcerpt(ana, p.sub, "The second bridge: I couldn't tell where to go."), "ask");
    await open(nora, `/app/tests/${p.t}`, "[data-excerpt-request]");
    await shot(nora, "b16-37-needs-you", "§37 The excerpt request in Needs you | The question it answers sits above the quote in small grey text, then Allow or Deny.", "[data-excerpt-request]");
    await decide(nora, p.sub, "allow");
    await open(nora, `/app/testers/${ana.uid}`, "[data-shown-excerpts]");
    await shot(nora, "b16-37-profile", "§37 On the tester's profile | Each excerpt shows its question (“Where did you get stuck?”) above the quote, cut to 2 lines with Show more when long.", "[data-shown-excerpts]");
  }
  // §38A An offer that arrives while the page is open: Switch works.
  {
    const t = await postTest(nora, { title: "Harbor Run: night", spots: "5" });
    const s = await join(ana, t);
    const T = await rec(V, ana);
    await open(T, `/app/sessions/${s}`, "#a0");
    const from = at(T);
    await pause(T, 1500);
    await apiEdit(nora, t, { writtenCents: "12.00" });
    await waitLive(T, "#terms-offer", 30000);
    await T.locator("#terms-offer").scrollIntoViewIfNeeded();
    await pause(T, 2000);
    await shot(T, "b16-38-offer-live", "§38A The offer arrives live | Nora raised the price while Ana's page was open: the offer box appears with Switch and Keep.", "#terms-offer");
    await T.click("button:has-text('Switch to the new terms')");
    await T.waitForSelector("#terms-offer", { state: "detached", timeout: 15000 }).catch(() => {});
    await pause(T, 2500);
    const err = await T.locator("text=/doesn't exist|no longer on offer/").count();
    if (err) console.log("   ! §38A: Switch refused");
    await shot(T, "b16-38-switched", "§38A Switch works | The press goes through on the offer shown (never “That offer doesn't exist.”), and her written answers now pay $12.00 ($9.60 for her).", "#parts");
    finishVideo([{ file: await saveVideo(T, "b16-38.webm"), from }], "b16-38-video", "§38A Switch on an offer that arrived live | The offer box appears without a reload and Switch to the new terms goes through.");
  }
  // §28 A suspended tester: the removed-from list opens a limited view.
  {
    const t = await postTest(nora, { title: "Harbor Run: reef", spots: "5" });
    const s = await join(ben, t);
    await sendWritten(ben, s);
    await adminDo(admin, "suspend", ben.uid, { note: "Media pass check: reported for copied answers", side: "tester" });
    await open(ben, "/app", `[data-removed-open="${s}"]`);
    await shot(ben, "b16-28-removed-list", "§28 Tests you were removed from | Each row opens a limited view of that test.", ben.locator("section", { has: ben.locator(`[data-removed-open="${s}"]`) }).last());
    // (The limited view itself changed in batch 17 §10: Dispute only; see group b17c.)
  }
  // §30 The account page: the side you're on only.
  await open(nora, "/app/account", "[data-account-heading]");
  await shotFull(nora, "b16-30-account-dev", "§30 The account page, developer side | The page shows “Nora Lane · Developer”, one line to start testing too and only the Developer profile link, with no side cards, Change password link or excerpts list.");
  await open(ana, "/app/account", "[data-account-heading]");
  await shotFull(ana, "b16-30-account-tester", "§30 The account page, tester side | The page shows “Ana Silva · Tester” with “Start posting tests too” and only the Tester profile link.");
}, { section: B16, fake: true });

group("b16f", async () => {
  // §32 Invitations follow every close; §33 and §35 the Call requests panel and its clash checks.
  const nora = await account(`dev+media${TS}bf@playtest.test`, "Nora Lane", "developer", "she");
  await subscribeDev(nora);
  const ana = await account(`tester+media${TS}bfa@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}bfb@playtest.test`, "Ben Okafor", "tester", "he");
  {
    const t = await postTest(nora, { title: "Lumen Notes private beta", joinMode: "invite", spots: "4" });
    ok(await post(nora, `/api/tests/${t}/invite`, { ...go, testerIds: [ana.uid] }), "invite");
    const inv = sql(`select id from "Invite" where "testId" = '${t}' and "testerId" = '${ana.uid}' and status = 'sent'`);
    const T = await rec(V, ana);
    await open(T, "/app", "#invitations");
    const from = at(T);
    await pause(T, 2000);
    await shot(T, "b16-32-invite-card", "§32 An open invitation | Ana's dashboard shows Nora's invitation to an invite-only test.", "#invitations");
    ok(await post(nora, `/api/tests/${t}/cancel-invite`, { ...go, inviteId: inv }), "cancel invite");
    await waitGone(T, "#invitations", 30000);
    await waitLive(T, "[data-live-top] >> text=/was closed/", 15000);
    await pause(T, 2000);
    await shot(T, "b16-32-invite-closed", "§32 The invitation closes live | The card disappears and the live box says “Your invite to “Lumen Notes private beta” was closed.”", "[data-live-top]");
    finishVideo([{ file: await saveVideo(T, "b16-32.webm"), from }], "b16-32-video", "§32 A closed invitation | Nora cancels the invite while Ana's dashboard is open: the card goes and a neutral line says it closed.");
    const t2 = await postTest(nora, { title: "Lumen Notes: sync beta", joinMode: "invite", spots: "4" });
    ok(await post(nora, `/api/tests/${t2}/invite`, { ...go, testerIds: [ana.uid] }), "invite 2");
    const J = await rec(V, ana);
    await open(J, `/app/find/${t2}`, "#join-card");
    await J.locator("#join-card").scrollIntoViewIfNeeded();
    const fromJ = at(J);
    await pause(J, 1500);
    await stopTest(nora, t2);
    await J.click("#join-card button:has-text('Join this test')");
    await J.waitForSelector("p.err:has-text('This test was stopped.')", { timeout: 20000 });
    await pause(J, 2000);
    await shot(J, "b16-32-stale-join", "§32 A stale Join | The test was stopped after the page loaded: Join is refused with “This test was stopped.” (no stop box) and the join card goes.", J.locator("p.err", { hasText: "This test was stopped." }).last());
    finishVideo([{ file: await saveVideo(J, "b16-32-join.webm"), from: fromJ }], "b16-32-join-video", "§32 Join on a closed invite | Nora stops the test while Ana reads the join page; her Join is refused with the reason.");
  }
  // §33 and §35: Ana requests a time; Nora's Needs you row opens the panel; the form marks an exact match blue and an overlap red.
  {
    const t = await postTest(nora, { title: "Harbor Run: live", liveRateCents: "30.00", spots: "4" });
    const sA = await join(ana, t);
    await join(ben, t);
    const when = localAt(2, 13, 30);
    ok(await post(ana, `/api/sessions/${sA}/request-time`, { ...go, minutes: 30, rows: [{ startsAt: when.toISOString(), repeat: "once" }] }), "tester request");
    const D = await rec(V, nora);
    await open(D, `/app/tests/${t}`, "[data-needs-request]");
    await D.locator("[data-needs-request]").first().scrollIntoViewIfNeeded();
    const from = at(D);
    await pause(D, 1500);
    await shot(D, "b16-35-needs-row", "§35 A call request in Needs you | No Accept or Decline here: the whole row, and “Answer in Live session →”, open the Call requests panel.", "[data-needs-request]");
    await D.locator("[data-answer-live]").first().click();
    await pause(D, 2500);
    await shot(D, "b16-33-panel", "§33 The Call requests panel | Every waiting request in both directions, soonest first, with Accept and Decline; the one opened from Needs you is highlighted.", "[data-call-requests]");
    await D.locator("#calls fieldset label", { hasText: "Ana Silva" }).locator("input").check();
    await D.locator("[aria-label='Requested time 1']").fill(dtLocal(when));
    await D.locator("[aria-label='Length in minutes']").fill("30");
    await D.locator("[aria-label='Requested time 1']").scrollIntoViewIfNeeded();
    await D.waitForSelector("[data-clash]", { timeout: 10000 }).catch(() => {});
    await pause(D, 1800);
    await shot(D, "b16-33-exact-blue", "§33 An exact match | The time row is blue, not red: “Ana Silva asked for exactly this: Request a time books it.”", D.locator("[data-request-row]").first());
    await D.locator("[aria-label='Requested time 1']").fill(dtLocal(localAt(2, 13, 45)));
    await D.locator("[aria-label='Length in minutes']").click();
    await D.waitForSelector("[data-clash=red]", { timeout: 10000 }).catch(() => {});
    await pause(D, 1800);
    await shot(D, "b16-33-overlap-red", "§33 An overlap | The time row turns red before any press: “Overlaps Ana Silva's request for <day>, 1:30–2:00 PM.”", D.locator("[data-request-row]").first());
    await D.locator("[aria-label='Requested time 1']").fill(dtLocal(when));
    await D.locator("[aria-label='Length in minutes']").click();
    await pause(D, 1200);
    await D.click("#calls button:has-text('Request a time')");
    await D.waitForSelector("text=/Booked/", { timeout: 15000 }).catch(() => {});
    await pause(D, 2500);
    finishVideo([{ file: await saveVideo(D, "b16-33.webm"), from }], "b16-33-video", "§33 and §35 Answering a call request | The Needs you row opens the panel; the form marks Ana's exact time blue and a clashing time red; the exact time books at once.");
  }
}, { section: B16, fake: true });

group("b16g", async () => {
  // §41 A chargeback hold: verify the card first, then pay; the hold stays until the team approves.
  const nora = await account(`dev+media${TS}bg@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}bga@playtest.test`, "Ana Silva", "tester", "she");
  setCard(nora.email, "pm_card_visa");
  const t = await postTest(nora, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"], writtenCents: "12.00" });
  const sA = await join(ana, t);
  await sendWritten(ana, sA);
  const sub = subOf(sA);
  await apiPay(nora, sub, "12.00");
  await webhook("charge.dispute.created", { payment_intent: piOf(sub), status: "needs_response" });
  const D = await rec(V, nora);
  await open(D, "/app/payments", "[data-chargeback-steps]");
  await D.locator("[data-chargeback-steps]").scrollIntoViewIfNeeded();
  const from = at(D);
  await pause(D, 1500);
  await shotSpan(D, "b16-41-verify-first", "§41 Verify first | Pay what you owe stays disabled until a card is verified, with “Verify your card first (step 1): then you can pay what you owe.”", "[data-chargeback-steps]", "#owed");
  await D.locator("[data-chargeback-steps] button", { hasText: "Verify a card" }).click();
  await D.waitForSelector("[data-step-ok=yes]", { timeout: 15000 }).catch(() => {});
  await pause(D, 2000);
  await D.locator("#owed button", { hasText: /Pay what you owe/ }).click();
  await D.waitForSelector("text=/Your tests stay paused until the team approves/", { timeout: 20000 }).catch(() => {});
  await pause(D, 2500);
  await shotSpan(D, "b16-41-paid", "§41 Paid, still paused | Step 2 is ticked and the box reads “Paid. Your tests stay paused until the team approves.”, since only the team's Approve lifts the hold.", "[data-chargeback-steps]", D.locator(".info", { hasText: "Paid. Your tests stay paused" }).first());
  finishVideo([{ file: await saveVideo(D, "b16-41.webm"), from }], "b16-41-video", "§41 The chargeback steps in order | Pay what you owe waits for the card check; Nora verifies, pays, and the hold stays until the team approves.");
}, { section: B16, fake: true });

group("b16h", async () => {
  // (Owner's extra case) Stop the test, End early and Next round each stop once for a tester joining and for a call change, with Alerts on; ticking off
  // "Joins and applications" lets a join through.
  const nora = await account(`dev+media${TS}bh@playtest.test`, "Nora Lane", "developer", "she");
  await subscribeDev(nora);
  own(`update "User" set "ignoredAlerts" = ARRAY[]::text[] where email = ${lit(nora.email)}`);
  const ana = await account(`tester+media${TS}bha@playtest.test`, "Ana Silva", "tester", "she");
  const names = ["Ben Okafor", "Cam Lee", "Dee Marsh", "Eli Novak", "Fay Ito", "Gus Park"];
  const extra = [];
  for (const [i, n] of names.entries()) extra.push(await account(`tester+media${TS}bh${i}@playtest.test`, n, "tester", "they"));
  const t = await postTest(nora, { liveRateCents: "30.00", spots: "10" });
  const sA = await join(ana, t);
  const req = (h) => post(ana, `/api/sessions/${sA}/request-time`, { ...go, minutes: 30, rows: [{ startsAt: localAt(3, h, 0).toISOString(), repeat: "once" }] }).then((r) => ok(r, "tester request"));
  const box = (page) => page.locator("section[aria-label='Test']").first();
  // Next round.
  {
    const D = await rec(V, nora);
    await open(D, `/app/tests/${t}`, "section[aria-label='Test']");
    const from = at(D);
    await D.click("button:has-text('Next round')");
    await pause(D, 800);
    await join(extra[0], t);
    await D.click("button:has-text('Start the next round')");
    await D.waitForSelector("[data-stop-box]", { timeout: 15000 });
    await pause(D, 1800);
    await shot(D, "b16-x1-next-join", "Next round stops once for a join | Ben joined after the page loaded, so Next round stops once with “Your Next round didn't go through.” and the join listed.", box(D));
    await req(10);
    await D.click("button:has-text('Start the next round')");
    await D.waitForSelector("[data-stop-box] >> text=/call|request/i", { timeout: 15000 }).catch(() => {});
    await pause(D, 1800);
    await shot(D, "b16-x1-next-call", "Next round stops again for a call change | Ana requested a call after that box: the next press stops once more, now listing her request too.", box(D));
    await D.click("button:has-text('Start the next round')");
    await D.waitForURL(/\/app\/tests\/new\?draft=/, { timeout: 20000 }).catch(() => {});
    await pause(D, 2000);
    finishVideo([{ file: await saveVideo(D, "b16-x1-next.webm"), from }], "b16-x1-next-video", "Next round, stopped once twice | A join, then a call request, each stops Next round once; the third press makes the draft.");
  }
  // End early.
  {
    const D = await rec(V, nora);
    await open(D, `/app/tests/${t}`, "section[aria-label='Test']");
    const from = at(D);
    await D.click("section[aria-label='Test'] button:has-text('End early')");
    await D.locator("[data-end-early] label", { hasText: "Ana Silva" }).locator("input").check();
    await typeSlow(D, "#reason", "We have what we need from this build: thank you!", 20);
    await join(extra[1], t);
    await pressConfirm(D, D.locator("[data-end-early] button:not([data-confirm])", { hasText: "End their work now" }), "End their work now");
    await D.waitForSelector("[data-end-early] [data-stop-box]", { timeout: 15000 });
    await pause(D, 1800);
    await shot(D, "b16-x1-end-join", "End early stops once for a join | Cam joined after the page loaded, so End early stops once and lists the join.", "[data-end-early]");
    await req(12);
    await pressConfirm(D, D.locator("[data-end-early] button:not([data-confirm])", { hasText: "End their work now" }), "End their work now");
    await D.waitForSelector("[data-end-early] [data-stop-box] >> text=/call|request/i", { timeout: 15000 }).catch(() => {});
    await pause(D, 1800);
    await shot(D, "b16-x1-end-call", "End early stops again for a call change | Ana requested a call after that box: the next press stops once more, now listing her request too.", "[data-end-early]");
    await pressConfirm(D, D.locator("[data-end-early] button:not([data-confirm])", { hasText: "End their work now" }), "End their work now");
    await D.waitForSelector("text=/ended/i", { timeout: 15000 }).catch(() => {});
    await pause(D, 2500);
    finishVideo([{ file: await saveVideo(D, "b16-x1-end.webm"), from }], "b16-x1-end-video", "End early, stopped once twice | A join, then a call request, each stops End early once; the third press ends Ana's work.");
  }
  // Stop the test (a call change from a tester still working: Ben requests a call).
  {
    const sBen = sql(`select id from "Contract" where "testId" = '${t}' and "testerId" = '${extra[0].uid}'`);
    const D = await rec(V, nora);
    await open(D, `/app/tests/${t}`, "section[aria-label='Test']");
    const from = at(D);
    await pause(D, 1000);
    await join(extra[2], t);
    await pressConfirm(D, box(D).locator("button", { hasText: "Stop the test" }).first(), "Stop the test");
    await D.waitForSelector("section[aria-label='Test'] [data-stop-box]", { timeout: 15000 });
    await pause(D, 1800);
    await shot(D, "b16-x1-stop-join", "Stop the test stops once for a join | Dee joined after the page loaded, so Stop the test stops once and lists the join.", box(D));
    ok(await post(extra[0], `/api/sessions/${sBen}/request-time`, { ...go, minutes: 30, rows: [{ startsAt: localAt(4, 15, 0).toISOString(), repeat: "once" }] }), "Ben's request");
    await pressConfirm(D, box(D).locator("button", { hasText: "Stop the test" }).first(), "Stop the test");
    await D.waitForSelector("section[aria-label='Test'] [data-stop-box] >> text=/call|request/i", { timeout: 15000 }).catch(() => {});
    await pause(D, 1800);
    await shot(D, "b16-x1-stop-call", "Stop the test stops again for a call change | Ben requested a call after that box: Stop stops once more, now listing his request too.", box(D));
    await pressConfirm(D, box(D).locator("button", { hasText: "Stop the test" }).first(), "Stop the test");
    await D.waitForSelector("[data-test-banner], text=/This test is stopped/", { timeout: 15000 }).catch(() => {});
    await pause(D, 2500);
    finishVideo([{ file: await saveVideo(D, "b16-x1-stop.webm"), from }], "b16-x1-stop-video", "Stop the test, stopped once twice | A join, then a call request, each stops Stop once; the third press stops the test.");
  }
  // "Joins and applications" ticked off: a join no longer stops Stop.
  {
    const t2 = await postTest(nora, { title: "Harbor Run: reef", spots: "6" });
    await join(ana, t2);
    const D = await rec(V, nora);
    await open(D, `/app/tests/${t2}`, "[data-alerts-menu]");
    const from = at(D);
    await D.click("[data-alerts-menu] > summary");
    await pause(D, 600);
    await D.locator("[data-alerts-menu] label", { hasText: "Joins and applications" }).locator("input").check();
    await pause(D, 1200);
    await shotSpan(D, "b16-x1-alerts-joins-off", "Joins ticked off in Alerts | “Joins and applications” is ticked, so a join no longer stops Nora's buttons.", D.locator("[data-alerts-menu] > summary"), D.locator("[data-alerts-menu] label").last());
    await D.click("[data-alerts-menu] > summary");
    await join(extra[3], t2);
    await pause(D, 800);
    await pressConfirm(D, box(D).locator("button", { hasText: "Stop the test" }).first(), "Stop the test");
    await D.waitForSelector("text=/This test is stopped|stopped/", { timeout: 15000 }).catch(() => {});
    await pause(D, 2500);
    if (await D.locator("[data-stop-box]").count()) console.log("   ! joins off: Stop stopped once");
    await shot(D, "b16-x1-stop-straight", "With joins ticked off, Stop goes straight through | Eli joined after the page loaded, and the first Stop press stopped the test.", box(D));
    finishVideo([{ file: await saveVideo(D, "b16-x1-off.webm"), from }], "b16-x1-off-video", "Joins ticked off | Nora ticks “Joins and applications” in Alerts; Eli joins; Stop the test goes through on the first press.");
    own(`update "User" set "ignoredAlerts" = ARRAY[]::text[] where email = ${lit(nora.email)}`);
  }
}, { section: B16, fake: true });

group("b16i", async () => {
  // (Owner's extra case) Contract changes through three Saves with mixed choices, newest first; a tester's Terms history matching.
  const nora = await account(`dev+media${TS}bi@playtest.test`, "Nora Lane", "developer", "she");
  await subscribeDev(nora);
  const ana = await account(`tester+media${TS}bia@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}bib@playtest.test`, "Ben Okafor", "tester", "he");
  const cam = await account(`tester+media${TS}bic@playtest.test`, "Cam Lee", "tester", "they");
  const t = await postTest(nora, { spots: "5" });
  const sA = await join(ana, t), sB = await join(ben, t);
  await join(cam, t);
  const offerOf = (s) => sql(`select id from "TermsOffer" where "contractId" = '${s}' and status = 'open' order by "createdAt" desc limit 1`);
  const choose = (who, s, choice) => post(who, `/api/sessions/${s}/terms`, { ...go, choice, offerId: offerOf(s) }).then((r) => ok(r, choice));
  await apiEdit(nora, t, { writtenCents: "12.00" });
  await choose(ana, sA, "switch");
  await choose(ben, sB, "keep");
  await apiEdit(nora, t, { questions: ["What did you like?", "Where did you get lost?", "Would you play level 4?"] });
  await choose(ana, sA, "switch");
  await choose(ben, sB, "keep");
  await apiEdit(nora, t, { ndaText: "Don't share screenshots of the night levels before launch." });
  await choose(ana, sA, "keep");
  await choose(ben, sB, "switch");
  await open(nora, `/app/tests/${t}`, "[data-contract-changes]");
  await nora.click("[data-contract-changes] > summary");
  await pause(nora, 1000);
  await shot(nora, "b16-x2-contract-changes", "Contract changes after three Saves | Newest first: the NDA, the questions, then the price; each entry lists who switched and who kept (Ana switched twice then kept; Ben kept twice then switched), and Cam, who never answered, is “Not decided yet” on the open offer.", "[data-contract-changes]");
  const T = await rec(V, ana);
  await open(T, `/app/sessions/${sA}`, "main");
  await unfold(T, "[data-terms-history]");
  await T.waitForSelector("[data-terms-history]");
  await T.locator("[data-terms-history]").scrollIntoViewIfNeeded();
  const from = at(T);
  await pause(T, 1500);
  await shot(T, "b16-x2-terms-history", "Ana's Terms history | Her contract fold lists the same three offers with what she chose: switched to $12.00, switched to the new questions, kept her terms without the NDA.", "[data-terms-history]");
  for (let i = 0; i < 4; i++) { await T.mouse.wheel(0, 200); await T.waitForTimeout(400); }
  await pause(T, 1000);
  finishVideo([{ file: await saveVideo(T, "b16-x2.webm"), from }], "b16-x2-video", "The tester's Terms history | Ana's contract fold lists every offer and her choice, matching the developer's Contract changes.");
  const C = await rec(V, nora);
  await open(C, `/app/tests/${t}`, "[data-contract-changes]");
  await C.click("[data-contract-changes] > summary");
  await C.locator("[data-contract-changes]").scrollIntoViewIfNeeded();
  const fromC = at(C);
  await pause(C, 2000);
  for (let i = 0; i < 4; i++) { await C.mouse.wheel(0, 200); await C.waitForTimeout(500); }
  await pause(C, 1200);
  finishVideo([{ file: await saveVideo(C, "b16-x2-dev.webm"), from: fromC }], "b16-x2-dev-video", "The developer's Contract changes | Nora opens the panel and reads the three entries, newest first, each with Switched, Kept and Not decided yet.");
}, { section: B16, fake: true });

group("b16j", async () => {
  // (Owner's extra case) The tester's live box at the top and the stop box under the button, with Alerts On and Off.
  const nora = await account(`dev+media${TS}bj@playtest.test`, "Nora Lane", "developer", "she");
  await subscribeDev(nora);
  const ana = await account(`tester+media${TS}bja@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}bjb@playtest.test`, "Ben Okafor", "tester", "he");
  own(`update "User" set "testerAlertsOff" = false where email = ${lit(ana.email)}`);
  own(`update "User" set "testerAlertsOff" = true where email = ${lit(ben.email)}`);
  const t = await postTest(nora, { liveRateCents: "30.00", spots: "5" });
  const sA = await join(ana, t), sB = await join(ben, t);
  const offerCall = (s, h) => post(nora, `/api/tests/${t}/request-time`, { ...go, contractIds: [s], minutes: 30, rows: [{ startsAt: localAt(3, h, 0).toISOString(), repeat: "once" }] }).then((r) => ok(r, "request a time"));
  // Alerts On: the change shows in the live box; Send stops once with it under the button; the second press sends.
  {
    const T = await rec(V, ana);
    await open(T, `/app/sessions/${sA}`, "#a0");
    await T.locator("#a0").scrollIntoViewIfNeeded();
    const from = at(T);
    await typeSlow(T, "#a0", "The harbor lights are beautiful.", 30);
    await T.locator("#a1").fill("The second bridge.");
    await offerCall(sA, 15);
    await waitLive(T, "[data-live-top] li, [data-live-top] p", 30000);
    await pause(T, 1500);
    await shot(T, "b16-x3-on-live", "Alerts On: the live box | Nora's call request shows at the top of Ana's page as soon as it happens; nothing is stopped yet.", "[data-live-top]");
    await T.locator("#a1").scrollIntoViewIfNeeded();
    await T.click("button:has-text('Send my answers')");
    await T.waitForSelector("[data-stop-box]", { timeout: 15000 });
    await pause(T, 2000);
    await shot(T, "b16-x3-on-stop", "Alerts On: the stop box on press | Only when Ana presses Send does the blue box appear under it, listing the call request: “Press Send again to go ahead.”", T.locator("[data-stop-box]").first());
    await T.click("button:has-text('Send my answers')");
    await T.waitForSelector("text=/^Sent [A-Z]/", { timeout: 15000 }).catch(() => {});
    await pause(T, 2000);
    finishVideo([{ file: await saveVideo(T, "b16-x3-on.webm"), from }], "b16-x3-on-video", "Alerts On | A call request arrives in the live box at the top; Send stops once with it under the button; the second press sends.");
  }
  // Alerts Off: the same change is greyed in the live box and Send goes straight through; new terms still stop.
  {
    const T = await rec(V, ben);
    await open(T, `/app/sessions/${sB}`, "#a0");
    await T.locator("#a0").scrollIntoViewIfNeeded();
    const from = at(T);
    await typeSlow(T, "#a0", "Smooth sailing until the fog.", 30);
    await T.locator("#a1").fill("The fog level.");
    await offerCall(sB, 16);
    await waitLive(T, "[data-live-top] li, [data-live-top] p", 30000);
    await pause(T, 1500);
    await shot(T, "b16-x3-off-live", "Alerts Off: greyed in the live box | The same kind of call request shows greyed at the top of Ben's page, since it won't stop anything.", "[data-live-top]");
    await T.locator("#a1").scrollIntoViewIfNeeded();
    await T.click("button:has-text('Send my answers')");
    await T.waitForSelector("text=/^Sent [A-Z]/", { timeout: 15000 }).catch(() => {});
    await pause(T, 2000);
    if (await T.locator("[data-stop-box]").count()) console.log("   ! Alerts Off: Send stopped");
    await shot(T, "b16-x3-off-sent", "Alerts Off: Send goes straight through | Ben's answers were sent on one press, with no stop box.", "#part-written");
    await apiEdit(nora, t, { writtenCents: "12.00" });
    await T.locator("#a0").fill("Smooth sailing until the fog (edited).");
    await T.click("button:has-text('Send my updated answers'), button:has-text('Send my answers')");
    await T.waitForSelector("#terms-offer", { timeout: 15000 }).catch(() => {});
    await pause(T, 2500);
    await shot(T, "b16-x3-off-terms", "Alerts Off: new terms still stop | After Nora changed the price, Ben's Send stops and the page goes to the offer box (Switch or Keep).", "#terms-offer");
    finishVideo([{ file: await saveVideo(T, "b16-x3-off.webm"), from }], "b16-x3-off-video", "Alerts Off | A call request shows greyed and Send goes through at once; after a price change, Send stops for the new terms.");
  }
}, { section: B16, fake: true });

// ---------- Batch 17 (owner, Oct 28): one case or more per item, in the report's "Batch 17 (Oct 28)" section (§ numbers are the items in docs/BATCH-17.md) ----------
const B17 = "Batch 17 (Oct 28)";
const B18 = "Batch 18 (Oct 28)";
/** Waits for this page's next live poll to come back (so a change made right after lands before the page's next refresh: a press then comes from a page opened before it). */
const waitPulse = (page, ms = 25000, q = "") => page.waitForResponse((r) => r.url().includes("/api/pulse") && r.url().includes(q), { timeout: ms }).catch(() => null);
/** The tester's own presses on a session (the same API the page uses). */
const sessionDo = (tester, s, action, body = {}) => post(tester, `/api/sessions/${s}/${action}`, { ...go, ...body });
const rateDev = (tester, s, stars = 5, comment = "") => sessionDo(tester, s, "rate", { stars, comment }).then((r) => ok(r, "tester rate"));
const disputeOf = (tester, s, sub, reason = "I answered every question in full.") => sessionDo(tester, s, "dispute", { kind: "submission", id: sub, reason }).then((r) => ok(r, "dispute"));
/** Waits for the page's own 20-second refresh to show (or hide) something, without a reload. */
async function waitPoll(page, selector, gone = false, ms = 45000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const vis = await page.locator(selector).first().isVisible().catch(() => false);
    if (gone ? !vis : vis) return true;
    await page.waitForTimeout(700);
  }
  console.log(`   ! waitPoll: ${gone ? "still there" : "nothing for"}`, selector, "on", page.url());
  return false;
}
/** Older throwaway accounts with this display name (earlier media runs) are renamed, so a search for the name finds only this run's. */
const retireName = (name) => own(`update "User" set name = 'Earlier media run' where name like ${lit(`%${name}`)} and email like '%@playtest.test' and email not like ${lit(`%media${TS}%`)}`);

group("b17a", async () => {
  // §1 Rate disabled with its line, §16 the developer's Rate only after the tester rated, §17 Ratings to give.
  const nora = await account(`dev+media${TS}ca@playtest.test`, "Nora Lane", "developer", "she");
  await subscribeDev(nora);
  const ana = await account(`tester+media${TS}caa@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}cab@playtest.test`, "Ben Okafor", "tester", "he");
  const cam = await account(`tester+media${TS}cac@playtest.test`, "Cam Lee", "tester", "they");
  const dee = await account(`tester+media${TS}cad@playtest.test`, "Dee Park", "tester", "she");
  const t = await postTest(nora, { title: "Harbor Run: first 3 levels", spots: "6" });
  const sA = await join(ana, t), sC = await join(cam, t), sD = await join(dee, t);
  for (const [p, s] of [[ana, sA], [cam, sC], [dee, sD]]) await sendWritten(p, s);
  const subA = subOf(sA), subC = subOf(sC), subD = subOf(sD);
  // §1 Inside the review window: "Rating opens on <date>, or sooner if Nora Lane reviews everything you sent." Then Nora pays and Rate opens live.
  {
    const T = await rec(V, ana);
    await open(T, `/app/sessions/${sA}`, "#rate [data-rate-disabled]");
    await T.locator("#rate").scrollIntoViewIfNeeded();
    const from = at(T);
    await pause(T, 1500);
    await shot(T, "b17-01-rate-window", "§1 Rate waits for the review | Ana's Rate button is disabled, with one grey line under it: “Rating opens on <date>, or sooner if Nora Lane reviews everything you sent.”", "#rate");
    await apiPay(nora, subA, "10.00");
    await waitPoll(T, "#rate [data-rate-disabled]", true);
    await T.locator("#rate").scrollIntoViewIfNeeded();
    await pause(T, 2000);
    await shot(T, "b17-01-rate-open", "§1 Rate opens live | Nora paid Ana's answers while her page was open: the grey line went and Rate is enabled, without a reload.", "#rate");
    finishVideo([{ file: await saveVideo(T, "b17-01-live.webm"), from }], "b17-01-live-video", "§1 Rate opening live | Ana's Rate is disabled with its date line; Nora pays her answers and, on the page's next refresh, the line goes and Rate can be pressed.");
  }
  // §1 Charge first: Ben's answers passed their review window unreviewed (on his own test, so the others keep their dates).
  const t2 = await postTest(nora, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"], spots: "4" });
  const sB = await join(ben, t2);
  await sendWritten(ben, sB);
  openCharge(sB, t2);
  await open(ben, `/app/sessions/${sB}`, "#rate [data-rate-disabled]");
  await shot(ben, "b17-01-rate-charge", "§1 Charge first | Ben's answers were never reviewed and Charge is open: Rate is disabled with “Charge or let go of your unreviewed work first.”", "#rate");
  // §1 A dispute of hers: Cam was paid under the listing and disputed it.
  await payWith(nora, subC, "6.00", "Only the first answer was about this build.");
  await disputeOf(cam, sC, subC);
  await open(cam, `/app/sessions/${sC}`, "#rate [data-rate-disabled]");
  await shot(cam, "b17-01-rate-dispute", "§1 Their own dispute | Cam disputed what Nora paid: Rate is disabled with “Rating opens once the team decides your dispute.”", "#rate");
  // §1 (developer) Dee was paid, rated Nora, then disputed: Nora's Rate for Dee is disabled with the dispute line.
  await payWith(nora, subD, "5.00", "Only the first answer was about this build.");
  await rateDev(dee, sD, 4, "Clear steps.");
  await disputeOf(dee, sD, subD);
  // §17 Ana's dashboard lists the rating she can give.
  {
    const T = await rec(V, ana);
    await open(T, "/app", "[data-ratings-to-give]");
    await T.locator("[data-ratings-to-give]").scrollIntoViewIfNeeded();
    const from = at(T);
    await pause(T, 1500);
    await shot(T, "b17-17-tester-box", "§17 Ratings to give (tester) | Ana's dashboard lists the one rating she can give now: “Rate Nora Lane on “Harbor Run: first 3 levels””.", "[data-ratings-to-give]");
    await T.locator("[data-ratings-to-give] [data-rate-row]").first().click();
    await T.waitForURL(/\/app\/sessions\//, { timeout: 15000 });
    await pause(T, 2500);
    await shot(T, "b17-17-tester-opens", "§17 The row opens the Rate box | The session page opens at its Rate box, highlighted for a few seconds.", "#rate");
    finishVideo([{ file: await saveVideo(T, "b17-17-t.webm"), from }], "b17-17-tester-video", "§17 From Ratings to give to Rate | Ana's row opens her session page at the Rate box, highlighted.");
  }
  // §16 Nora's Rate for Ana is hidden until Ana rates; then it appears live, and Ratings to give lists it.
  {
    const D = await rec(V, nora);
    await open(D, `/app/tests/${t}`, `#tester-${sA}`);
    await D.locator(`#tester-${sA}`).scrollIntoViewIfNeeded();
    const from = at(D);
    await pause(D, 1500);
    if (await D.locator(`#rate-${sA}`).count()) console.log("   ! §16: Nora's Rate for Ana shows before Ana rated");
    await shot(D, "b17-16-hidden", "§16 Not before the tester rates | Ana's answers are paid, but she hasn't rated Nora yet: her row has no Rate box.", `#tester-${sA}`);
    await rateDev(ana, sA, 5, "Quick pay and clear steps.");
    await waitPoll(D, `#rate-${sA}`);
    await D.locator(`#rate-${sA}`).scrollIntoViewIfNeeded();
    await pause(D, 2000);
    await shot(D, "b17-16-shown", "§16 After she rated | Ana rated Nora: the Rate box for Ana appears in her row (everything she sent is settled).", `#tester-${sA}`);
    finishVideo([{ file: await saveVideo(D, "b17-16.webm"), from }], "b17-16-video", "§16 The developer rates second | Ana's row has no Rate box; Ana rates Nora, and on the page's next refresh the Rate box for Ana appears.");
  }
  await open(nora, `/app/tests/${t}`, `#tester-${sD}`);
  await unfold(nora, `#rate-${sD}`);
  await pause(nora, 500);
  await shot(nora, "b17-01-dev-dispute", "§1 The developer's side | Dee rated Nora, then disputed her pay: Nora's Rate for Dee is disabled with “Rating opens once the team decides Dee Park's dispute.”", `#rate-${sD}`);
  {
    const D = await rec(V, nora);
    await open(D, "/app", "[data-ratings-to-give]");
    await D.locator("[data-ratings-to-give]").scrollIntoViewIfNeeded();
    const from = at(D);
    await pause(D, 1500);
    await shot(D, "b17-17-dev-box", "§17 Ratings to give (developer) | Nora's dashboard lists only Ana, who rated her and is settled: “Rate Ana Silva on “Harbor Run: first 3 levels” · 14 days left”. Dee's open dispute keeps her out.", "[data-ratings-to-give]");
    await D.locator("[data-ratings-to-give] [data-rate-row]").first().click();
    await D.waitForURL(/\/app\/tests\//, { timeout: 15000 });
    await pause(D, 2500);
    finishVideo([{ file: await saveVideo(D, "b17-17-d.webm"), from }], "b17-17-dev-video", "§17 The developer's row | It opens the test page at Ana's Rate box, highlighted for a few seconds.");
  }
}, { section: B17, fake: true });

group("b17b", async () => {
  // §12 A stop while a page is open: Charge, Pay and Rate stop once with it, Cancel call is refused; §15 Stop's required reason, read by the tester.
  const nora = await account(`dev+media${TS}cb@playtest.test`, "Nora Lane", "developer", "she");
  await subscribeDev(nora);
  const ana = await account(`tester+media${TS}cba@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}cbb@playtest.test`, "Ben Okafor", "tester", "he");
  const cam = await account(`tester+media${TS}cbc@playtest.test`, "Cam Lee", "tester", "they");
  const dee = await account(`tester+media${TS}cbd@playtest.test`, "Dee Park", "tester", "she");
  const eli = await account(`tester+media${TS}cbe@playtest.test`, "Eli Novak", "tester", "he");
  const admin = await adminAccount();
  // §12 Cancel call on a page opened before Nora's Stop: refused (the stop cancelled the call).
  {
    const gus = await account(`tester+media${TS}cbg@playtest.test`, "Gus Hale", "tester", "he");
    const t = await postTest(nora, { title: "Harbor Run: harbor tour", liveRateCents: "30.00", spots: "5" });
    const sG = await join(gus, t);
    const call = await bookCall(nora, gus, t, sG, 50);
    const G = await rec(V, gus);
    await G.goto(`/app/sessions/${sG}`);
    await G.waitForSelector(`#call-${call} [data-cancel-menu]`);
    await G.locator(`#call-${call}`).scrollIntoViewIfNeeded();
    const from = at(G);
    await waitPulse(G);
    await pause(G, 800);
    await stopTest(nora, t);
    await G.locator(`#call-${call} [data-cancel-menu] summary`).click();
    await pause(G, 600);
    await G.locator(`#call-${call} button`, { hasText: "Cancel this call" }).click();
    await G.waitForSelector("text=This call was cancelled when the test stopped.", { timeout: 15000 });
    await pause(G, 1800);
    await shot(G, "b17-12-cancel-refused", "§12 Cancel call is refused | Gus's page was open before Nora stopped the test: his Cancel is refused with “This call was cancelled when the test stopped.”", G.locator(`#call-${call}`));
    finishVideo([{ file: await saveVideo(G, "b17-12-cancel.webm"), from }], "b17-12-cancel-video", "§12 Cancel after a stop | Nora stops the test while Gus's page is open; his Cancel on the booked call is refused: the stop already cancelled it.");
  }
  // §12 Nora's own Stop while Ana's and Dee's pages are open: Charge and Rate stop once with it.
  {
    const t = await postTest(nora, { title: "Harbor Run: lighthouse", spots: "5" });
    const sA = await join(ana, t), sD = await join(dee, t);
    await sendWritten(ana, sA);
    await sendWritten(dee, sD);
    await apiPay(nora, subOf(sD), "10.00");
    openCharge(sA, t);
    const R = await same(dee);
    const T = await rec(V, ana);
    await Promise.all([open(R, `/app/sessions/${sD}`, "#rate"), (async () => { await T.goto(`/app/sessions/${sA}`); await T.waitForSelector("button:has-text('Let it go')"); })()]);
    const charge = T.locator("button", { hasText: /^Charge / }).first();
    await charge.scrollIntoViewIfNeeded();
    const from = at(T);
    await Promise.all([waitPulse(T), waitPulse(R)]);
    await pause(T, 800);
    await stopTest(nora, t);
    await charge.click();
    await T.waitForSelector("[data-stop-box]", { timeout: 15000 });
    await pause(T, 1800);
    await shot(T, "b17-12-charge-once", "§12 Charge stops once | The one change listed is the stop itself: “Nora Lane stopped this test at <time>.”, then “Press Charge again to go ahead.”", T.locator("[data-stop-box]").first().locator("xpath=ancestor::*[@id][1]"));
    await T.locator("button", { hasText: /^Charge / }).first().click();
    await T.waitForSelector("text=/Charged|may be delayed/i", { timeout: 15000 }).catch(() => {});
    await pause(T, 2500);
    finishVideo([{ file: await saveVideo(T, "b17-12-own.webm"), from }], "b17-12-own-video", "§12 A stop on a page already open | Nora stops the test while Ana's page is open: Charge stops once naming the stop, and the second press charges.");
    // Rate on Dee's page opened before the stop: stops once the same way.
    await R.locator("#rate select").selectOption("5");
    await pressConfirm(R, R.locator("#rate button", { hasText: /^Rate( and finish)?$/ }).first(), "Rate and finish");
    await R.waitForSelector("#rate [data-stop-box]", { timeout: 15000 });
    await pause(R, 1200);
    await shot(R, "b17-12-rate-once", "§12 Rate stops once too | Dee's Rate from a page opened before the stop: “Nora Lane stopped this test at <time>.” Her next press rates.", "#rate");
  }
  // §12 The team's Stop: the tester reads only the time; the developer reads that the team did it.
  {
    const t = await postTest(nora, { title: "Harbor Run: reef", spots: "5" });
    const sB = await join(ben, t), sC = await join(cam, t);
    await sendWritten(ben, sB);
    await sendWritten(cam, sC);
    openCharge(sB, t);
    const subC = subOf(sC);
    ensureCard(nora.email);
    const D = await rec(V, nora), B = await rec(V, ben);
    await Promise.all([D.goto(`/app/tests/${t}`), B.goto(`/app/sessions/${sB}`)]);
    await Promise.all([D.waitForSelector(`#piece-${subC}`), B.waitForSelector("button:has-text('Let it go')")]);
    await D.locator(`#piece-${subC}`).scrollIntoViewIfNeeded();
    await B.locator("button:has-text('Let it go')").first().scrollIntoViewIfNeeded();
    const fromD = at(D), fromB = at(B);
    await Promise.all([waitPulse(D), waitPulse(B)]);
    await adminDo(admin, "stop-test", t, { note: "Media pass check: against the content rules" });
    await payPiece(D, subC);
    await D.waitForSelector(`#piece-${subC} [data-stop-box]`, { timeout: 15000 });
    await pause(D, 1200);
    await shot(D, "b17-12-team-dev", "§12 The team's Stop, for the developer | Nora's Pay from a page opened before it: “The team stopped this test at <time>.” (the reason is on her banner).", D.locator(`#piece-${subC} [data-stop-box]`));
    await pressConfirm(B, B.locator("button", { hasText: /^Let it go$/ }).first(), "Let it go");
    await B.waitForSelector("[data-stop-box]", { timeout: 15000 });
    await pause(B, 1500);
    await shot(B, "b17-12-team-tester", "§12 The team's Stop, for the tester | Ben's Let it go stops once with only “This test was stopped at <time>.”: never that the team did it, never the reason.", B.locator("[data-stop-box]").first());
    await pause(D, 800);
    finishVideo([{ file: await saveVideo(D, "b17-12-team-d.webm"), from: fromD }, { file: await saveVideo(B, "b17-12-team-b.webm"), from: fromB }], "b17-12-team-video", "§12 The team stops the test | Nora's Pay (left) stops once with “The team stopped this test at …”; Ben's Let it go (right) with only “This test was stopped at …”.");
  }
  // §15 Stop needs a reason testers read.
  {
    const t = await postTest(nora, { title: "Harbor Run: night harbor", spots: "5" });
    const sE = await join(eli, t);
    const D = await rec(V, nora);
    await open(D, `/app/tests/${t}`, "button:has-text('Stop the test')");
    const from = at(D);
    await pause(D, 1000);
    await D.locator("section[aria-label='Test'] button", { hasText: "Stop the test" }).first().click();
    await D.waitForSelector("dialog[open] #stop-reason");
    await pause(D, 1500);
    await shot(D, "b17-15-why-empty", "§15 Stop asks why | The pop-up has a required “Why? (testers read it)” box with its 0 / 10,000 counter; Stop the test stays disabled with “Say why first”.", "dialog[open]");
    await typeSlow(D, "dialog[open] #stop-reason", "We found what we needed in this build: thank you! The next round opens next week.", 22);
    await pause(D, 1200);
    await shot(D, "b17-15-why-typed", "§15 With a reason | Once the box has text the counter counts it and Stop the test can be pressed.", "dialog[open]");
    await D.locator("dialog[open] button[data-confirm='Stop the test']").click();
    await D.waitForSelector("text=/Stopped/", { timeout: 15000 }).catch(() => {});
    await pause(D, 2500);
    finishVideo([{ file: await saveVideo(D, "b17-15.webm"), from }], "b17-15-video", "§15 Stopping with a reason | Stop the test opens the pop-up; Stop stays disabled until Nora says why, then the test stops.");
    await open(eli, `/app/sessions/${sE}`, "#stopped-line");
    await shot(eli, "b17-15-tester-reads", "§15 The tester reads it | Eli's page says the test was stopped, with Nora's reason in italics in its scroll box under the line.", "#stopped-line");
  }
}, { section: B17, fake: true });

/** (Batch 17 §19) Moves a stopped test and its pieces back in time: the stop and every tester's deadline `days` ago, each piece sent `days + 10` days ago (Charge opened `days` ago). */
function stoppedDaysAgo(testId, days, unpaidSubs = [], paidSubs = []) {
  const ago = (n) => `${utcNow} - interval '${n} days'`;
  own(`update "Test" set "stoppedAt" = ${ago(days)}, "openUntil" = ${ago(days + 2)} where id = '${testId}'`);
  own(`update "Contract" set "dueAt" = ${ago(days)}, "joinedAt" = ${ago(days + 14)} where "testId" = '${testId}'`);
  for (const sub of [...unpaidSubs, ...paidSubs]) own(`update "Submission" set "sentAt" = ${ago(days + 10)}, "updatedAt" = ${ago(days + 10)}, "payBy" = ${ago(days + 3)} where id = '${sub}'`);
  for (const sub of unpaidSubs) own(`update "Submission" set "choiceOfferedAt" = ${ago(days)}, "choiceBy" = ${utcNow} + interval '${14 - days} days' where id = '${sub}'`);
}

group("b17c", async () => {
  // §10 The suspended tester's Dispute-only view; §19 the close-out lines.
  const nora = await account(`dev+media${TS}cc@playtest.test`, "Nora Lane", "developer", "she");
  await subscribeDev(nora);
  const ana = await account(`tester+media${TS}cca@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}ccb@playtest.test`, "Ben Okafor", "tester", "he");
  const cam = await account(`tester+media${TS}ccc@playtest.test`, "Cam Lee", "tester", "they");
  const dee = await account(`tester+media${TS}ccd@playtest.test`, "Dee Park", "tester", "she");
  const fay = await account(`tester+media${TS}ccf@playtest.test`, "Fay Mendes", "tester", "she");
  const admin = await adminAccount();
  // §10 Fay: paid under the listing on one test (she can dispute it), Charge open on another; then her tester side is suspended.
  {
    const ta = await postTest(nora, { title: "Harbor Run: reef", spots: "4" });
    const tb = await postTest(nora, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"], spots: "4" });
    const sa = await join(fay, ta), sb = await join(fay, tb);
    await sendWritten(fay, sa);
    await sendWritten(fay, sb);
    await payWith(nora, subOf(sa), "5.00", "Only the first answer was about this build.");
    openCharge(sb, tb);
    await adminDo(admin, "suspend", fay.uid, { note: "Media pass check: reported for copied answers", side: "tester" });
    await open(fay, `/app/sessions/${sa}`, "[data-limited-view]");
    await shotFull(fay, "b17-10-dispute-only", "§10 Only Dispute | Fay's account is paused: the page says “Your account is paused. You can still dispute a payment.” and “Dispute the pay” is the only press (no Charge, Let it go or Rate).");
    await open(fay, `/app/sessions/${sb}`, "[data-limited-view]");
    if (await fay.locator("button", { hasText: /^Charge |^Let it go$/ }).count()) console.log("   ! §10: Charge or Let it go shows in the limited view");
    await shotSpan(fay, "b17-10-no-charge", "§10 Charge waits | On her other test Charge was open, but the limited view shows no Charge or Let it go; the part stays open to Charge for when she's back.", "[data-limited-view]", "#part-written");
  }
  // §19 A test stopped 10 days ago: close-out in 4 days. Ana's unpaid answers show when Charge and Pay close; Cam's paid answers when Pay more closes.
  {
    const t = await postTest(nora, { title: "Harbor Run: lighthouse", spots: "4" });
    const sA = await join(ana, t), sC = await join(cam, t);
    await sendWritten(ana, sA);
    await sendWritten(cam, sC);
    const subA = subOf(sA), subC = subOf(sC);
    await apiPay(nora, subC, "10.00");
    await stopTest(nora, t);
    stoppedDaysAgo(t, 10, [subA], [subC]);
    await open(ana, `/app/sessions/${sA}`, "[data-charge-closes]");
    await shot(ana, "b17-19-charge-closes", "§19 Charge closes on … | In its last 7 days Ana's Charge box says “Charge closes on <date>.” (14 days after the last tester's deadline).", ana.locator("[data-charge-closes]").first().locator("xpath=ancestor::*[@id][1]"));
    await open(nora, `/app/tests/${t}`, `#piece-${subA} [data-pay-closes]`);
    await shot(nora, "b17-19-pay-closes", "§19 Pay closes on … | The same date on Nora's Needs you row for Ana's answers: “Pay closes on <date>.”", nora.locator(`#piece-${subA}`).locator("[data-pay-closes]").locator("xpath=.."));
    await unfold(nora, `[data-pay-more="${subC}"]`);
    await shot(nora, "b17-19-pay-more-closes", "§19 Pay more closes on … | Cam's paid answers keep their Pay more box, which now closes with the test's last Pay or Charge: “Pay more closes on <date>.” (no longer 30 days after the test ended).", `[data-pay-more="${subC}"]`);
  }
  // §19 A test stopped 20 days ago: close-out passed. Ben's unpaid answers closed unpaid; Dee (paid) can no longer rate.
  {
    const t = await postTest(nora, { productName: "Night Market", title: "Night Market demo", categories: ["Game"], spots: "4" });
    const sB = await join(ben, t), sD = await join(dee, t);
    await sendWritten(ben, sB);
    await sendWritten(dee, sD);
    const subB = subOf(sB), subD = subOf(sD);
    await apiPay(nora, subD, "10.00");
    await stopTest(nora, t);
    stoppedDaysAgo(t, 20, [subB], [subD]);
    await open(nora, `/app/tests/${t}`, `#tester-${sB}`);
    await unfold(nora, `#tester-${sB}`);
    await shot(nora, "b17-19-closed-not-paid", "§19 Closed unpaid (developer) | Ben's answers were never paid or charged by the close-out: his row reads “Closed on <date>: not paid.” and they left Needs you.", nora.locator(`#tester-${sB} [data-closed-not-paid]`).locator("xpath=ancestor::li[1]"));
    await open(ben, `/app/sessions/${sB}`, "[data-part-status=closed]");
    await shot(ben, "b17-19-not-paid-tester", "§19 Closed unpaid (tester) | Ben's part reads “Not paid (closed on <date>)”, with no Charge or Let it go.", "#part-written");
    await open(dee, `/app/sessions/${sD}`, "[data-rating-closed]");
    await shot(dee, "b17-19-rating-closed", "§19 Rating closed | Dee never rated Nora: after the close-out her page says “Rating closed on <date>.” instead of a Rate box.", "[data-rating-closed]");
  }
}, { section: B17, fake: true });

group("b17d", async () => {
  // §5 Admin search with ticks, §7 scroll boxes that load as you scroll, §6 Suspend / Reinstate on a profile and the Preview check.
  const nora = await account(`dev+media${TS}cd@playtest.test`, "Nora Lane", "developer", "she");
  await subscribeDev(nora);
  const ana = await account(`tester+media${TS}cda@playtest.test`, "Ana Silva", "tester", "she");
  const admin = await adminAccount();
  const admin2 = await account(`admin2+media${TS}cd@playtest.test`, "Second Admin", "developer", "they");
  own(`update "User" set "isAdmin" = true where email = ${lit(admin2.email)}`);
  // 30 of Nora's tests (each stopped after posting: 10 open at most), so her Tests list runs past one load of 25.
  for (let i = 1; i <= 30; i++) {
    const id = await postTest(nora, { title: `Harbor Run: level ${i}`, spots: "3" });
    if (i < 30) await stopTest(nora, id);
  }
  const key = `dev+media${TS}cd`;
  // §5 Accounts and Tests: a search box and ticks; only that list reloads.
  {
    const A = await rec(V, admin);
    await open(A, "/admin", "[data-list-search=users]");
    await A.locator("#users").scrollIntoViewIfNeeded();
    const from = at(A);
    await pause(A, 1200);
    await typeSlow(A, "[data-list-search=users]", "Ana Silva", 90);
    await A.waitForSelector("[data-list-heading=users] >> text=/match/", { timeout: 15000 });
    await pause(A, 1500);
    await A.locator("[data-list-tick=tester]").check();
    await pause(A, 2000);
    await shot(A, "b17-05-accounts", "§5 Accounts: search and ticks | “Ana Silva” with Tester ticked: the heading becomes “Accounts: N match” and only that list reloads (any part of a name or email, any case, over every account).", "#users");
    await A.locator("[data-list-tick=suspended]").check();
    await pause(A, 2000);
    await A.locator("[data-list-tick=suspended]").uncheck();
    await A.locator("[data-list-tick=tester]").uncheck();
    await A.locator("[data-list-search=users]").fill("");
    await pause(A, 1500);
    await A.locator("#tests").scrollIntoViewIfNeeded();
    await typeSlow(A, "[data-list-search=tests]", key, 40);
    await A.waitForSelector("[data-list-heading=tests] >> text=/match/", { timeout: 15000 });
    await pause(A, 1200);
    await A.locator("[data-list-tick=stopped]").check();
    await pause(A, 2000);
    await shot(A, "b17-05-tests", "§5 Tests: search and ticks | The developer's email with Stopped / closed ticked: “Tests: 29 match”, her one open test left out.", "#tests");
    await A.locator("[data-list-tick=stopped]").uncheck();
    await pause(A, 2000);
    finishVideo([{ file: await saveVideo(A, "b17-05.webm"), from }], "b17-05-video", "§5 Searching the admin lists | Typing a name narrows Accounts as you type, ticks narrow it further; the Tests list searches by the developer's email and its own ticks.");
  }
  // §7 The Tests box loads the next 25 as you near its end, then says “That's all (30)”.
  {
    const A = await rec(V, admin);
    await open(A, "/admin", "[data-list-search=tests]");
    await A.locator("[data-list-search=tests]").fill(key);
    await A.waitForSelector("[data-list-heading=tests] >> text=/30 match/", { timeout: 15000 });
    await A.locator("#tests").scrollIntoViewIfNeeded();
    const from = at(A);
    await pause(A, 1500);
    const box = A.locator("[data-scroll-box=tests]");
    const b = await box.boundingBox();
    await A.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    for (let i = 0; i < 14 && !(await A.locator("[data-end-line=tests]").isVisible().catch(() => false)); i++) { await A.mouse.wheel(0, 260); await A.waitForTimeout(450); }
    await A.waitForSelector("[data-end-line=tests]", { timeout: 15000 });
    await box.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await pause(A, 1800);
    await shot(A, "b17-07-end", "§7 The end of the list | Scrolling inside the box loaded the next 25 (a “Loading…” row shows meanwhile); at the end, “That's all (30)”. The heading keeps the count: “Tests: 30 match”.", "#tests");
    finishVideo([{ file: await saveVideo(A, "b17-07.webm"), from }], "b17-07-video", "§7 A box that loads as you scroll | The Tests list is a box about 10 rows tall: scrolling near its end loads the next 25, until “That's all (30)”.");
  }
  // §6 Suspend from the profile: the Preview check refuses a press made after another admin acted.
  {
    const A = await rec(V, admin);
    await open(A, `/app/testers/${ana.uid}`, "[data-admin-account]");
    await A.locator("[data-admin-account]").scrollIntoViewIfNeeded();
    const from = at(A);
    await pause(A, 1200);
    await shot(A, "b17-06-profile-actions", "§6 On the profile | Ana's profile, seen by an admin, has Preview suspension, Suspend (with its reason) and Delete account, as in the Accounts list.", "[data-admin-account]");
    await A.locator("[data-admin-account] button", { hasText: "Preview suspension" }).click();
    await A.waitForSelector("[data-admin-account] [data-preview]", { timeout: 15000 });
    await pause(A, 1500);
    await adminDo(admin2, "suspend", ana.uid, { side: "tester", note: "Media pass check: reported for copied answers" });
    await typeSlow(A, `#suspend-${ana.uid}-note`, "Copied answers on two tests", 30);
    await A.locator("[data-admin-account] button.btn-danger", { hasText: /^Suspend/ }).first().click();
    await A.waitForSelector("[data-account-msg]", { timeout: 15000 });
    await pause(A, 2000);
    await shot(A, "b17-06-since-preview", "§6 Since your Preview | Another admin suspended Ana after this Preview was loaded: the press is refused with “Since your Preview, <admin> suspended that account's tester side at <time>.” and the box now shows her suspended, with Reinstate.", "[data-admin-account]");
    await A.locator("[data-admin-account] button", { hasText: "Reinstate" }).first().click();
    await A.waitForSelector("[data-admin-account] [data-account-state=normal]", { timeout: 20000 }).catch(() => {});
    await pause(A, 2500);
    await shot(A, "b17-06-reinstated", "§6 Reinstate | Reinstate on the profile brings her tester side back; Suspend shows again.", "[data-admin-account]");
    finishVideo([{ file: await saveVideo(A, "b17-06.webm"), from }], "b17-06-video", "§6 Suspend and Reinstate on a profile | The admin loads a Preview; another admin suspends Ana meanwhile; Suspend is refused naming who and when, the box updates, and Reinstate brings her back.");
  }
}, { section: B17, fake: true });

/** (Batch 17 §8, §18) Rosa Quill's tests in every state a tester or an admin can see. */
async function rosaTests(rosa, ben, admin) {
  const mk = (product, title, over = {}) => postTest(rosa, { productName: product, title: `${product}: ${title}`, spots: "4", ...over });
  const L = {};
  L.open = await mk("Lantern Bay", "harbor lights");
  L.open2 = await mk("Driftwood", "first dive", { categories: ["Education"] });
  L.full = await mk("Tidepool", "tutorial", { spots: "1" });
  await join(ben, L.full);
  L.closing = await mk("Saltmarsh", "map", { categories: ["Productivity"] });
  own(`update "Test" set "openUntil" = ${utcNow} - interval '1 day' where id = '${L.closing}'`);
  L.paused = await mk("Kelp Kart", "race 1");
  await adminDo(admin, "pause-test", L.paused);
  L.stopped = await mk("Reef Rally", "boss fight");
  await stopTest(rosa, L.stopped);
  L.closed = await mk("Coral Cove", "night dive");
  await adminDo(admin, "pause-test", L.closed);
  await adminDo(admin, "close-paused", L.closed);
  L.invite = await mk("Moonfish", "private beta", { joinMode: "invite" });
  L.invited = await mk("Moonfish", "sync beta", { joinMode: "invite" });
  L.apply = await mk("Driftwood", "night dive", { joinMode: "apply", categories: ["Education"] });
  await nextRound(rosa, L.open);
  return L;
}

group("b17e", async () => {
  // §8 Find tests search (tester, and admins with state badges); §18 Tests visited.
  retireName("Rosa Quill");
  const rosa = await account(`dev+media${TS}ce@playtest.test`, "Rosa Quill", "developer", "she");
  await subscribeDev(rosa);
  const ana = await account(`tester+media${TS}cea@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}ceb@playtest.test`, "Ben Okafor", "tester", "he");
  const admin = await adminAccount();
  const L = await rosaTests(rosa, ben, admin);
  ok(await post(rosa, `/api/tests/${L.invited}/invite`, { ...go, testerIds: [ana.uid] }), "invite");
  // §8 The tester's search box.
  {
    const T = await rec(V, ana);
    await open(T, "/app/find?mine=0", "#findSearch");
    const from = at(T);
    await pause(T, 1200);
    await typeSlow(T, "#findSearch", "rosa q", 120);
    await T.waitForURL(/q=rosa/, { timeout: 15000 });
    await pause(T, 2000);
    await shotSpan(T, "b17-08-tester-search", "§8 Search tests or developers | “rosa q” finds Rosa Quill's tests open to join (any part of a test, product or developer name, any case), together with the chips and filters.", "[data-find-search]", T.locator("main ul.grid").first());
    await T.locator("#findSearch").fill("");
    await typeSlow(T, "#findSearch", "Zed Quarry", 120);
    await T.waitForSelector("[data-find-none]", { timeout: 15000 });
    await pause(T, 1800);
    await shotSpan(T, "b17-08-tester-none", "§8 No match | “No open tests match “Zed Quarry”.”", "[data-find-search]", "[data-find-none]");
    finishVideo([{ file: await saveVideo(T, "b17-08-t.webm"), from }], "b17-08-tester-video", "§8 Searching Find tests | Ana types a developer's name and the list narrows as she types; a name nobody matches shows the no-match line.");
  }
  // §8 Admins get Find tests too: every test, with its state, and tick boxes for the states.
  {
    const A = await rec(V, admin);
    await open(A, "/admin", "[data-admin-find]");
    const from = at(A);
    await pause(A, 1000);
    await A.click("[data-admin-find]");
    await A.waitForSelector("#findSearch");
    await typeSlow(A, "#findSearch", "Rosa Quill", 90);
    await A.waitForURL(/q=Rosa/, { timeout: 15000 });
    await A.waitForSelector("[data-test-state]");
    await pause(A, 2000);
    await shotFull(A, "b17-08-admin-states", "§8 Admins' Find tests | The admin header's Find tests lists every test, each card with its state: Open, Full, Joining closed, Paused, Stopped, Closed, Draft, Invite only (no Join or Apply).");
    for (const s of ["Paused", "Stopped", "Closed"]) { await A.locator("[data-state-ticks] label", { hasText: new RegExp("^\\s*" + s + "\\s*$") }).locator("input").click(); await pause(A, 2500); }
    await pause(A, 1500);
    await shotSpan(A, "b17-08-admin-ticks", "§8 The state ticks | Paused, Stopped and Closed ticked: only those cards remain.", "[data-state-ticks]", A.locator("main ul.grid").first());
    finishVideo([{ file: await saveVideo(A, "b17-08-a.webm"), from }], "b17-08-admin-video", "§8 Find tests for the team | From the admin header: search a developer, read each test's state, tick states to narrow the list.");
  }
  // §18 Tests visited: Ana opens join pages of tests she never joins.
  ok(await post(ana, `/api/tests/${L.apply}/apply`, { seenAt: nowIso(), confirmed: true, anyway: true, note: "I play a lot of diving games." }), "apply");
  for (const id of [L.closed, L.stopped, L.paused, L.closing, L.full, L.invite, L.invited, L.apply, L.open2]) {
    await ana.goto(`/app/find/${id}`);
    await pause(ana, 400);
  }
  {
    const T = await rec(V, ana);
    await open(T, "/app", "#tests-visited");
    await T.locator("#tests-visited").scrollIntoViewIfNeeded();
    const from = at(T);
    await pause(T, 1500);
    await shot(T, "b17-18-visited", "§18 Tests visited | Every join page Ana opened but never joined, latest first, with its state now: Accepting testers, Applied (waiting), Invited, and further down the box Invite only, Full, Closed to new testers on <date>, Paused, Stopped, Closed.", "#tests-visited");
    const list = T.locator("#tests-visited [data-scroll-list]").first();
    const b = await list.boundingBox().catch(() => null);
    if (b) { await T.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 120)); for (let i = 0; i < 5; i++) { await T.mouse.wheel(0, 160); await T.waitForTimeout(350); } }
    await pause(T, 800);
    await T.locator(`[data-remove-visit="${L.closed}"]`).click();
    await waitPoll(T, `[data-visited="${L.closed}"]`, true, 10000);
    await pause(T, 1800);
    await T.locator(`[data-visited-open="${L.invite}"]`).click();
    await T.waitForSelector("[data-unavailable]", { timeout: 15000 });
    await pause(T, 2000);
    await shot(T, "b17-18-invite-only", "§18 An invite-only card | Its card says “Invite only”; the join page shows only “This test isn't available right now.”, nothing of the listing.", "main");
    finishVideo([{ file: await saveVideo(T, "b17-18.webm"), from }], "b17-18-video", "§18 Tests visited | Ana scrolls her visited tests, removes the closed one with ×, then opens the invite-only card: “This test isn't available right now.”");
  }
}, { section: B17, fake: true });

group("b17f", async () => {
  // §9 A developer profile's Open tests stay current (live, and a stale click); §4 No thanks on an invite re-sent on a new listing.
  const omar = await account(`dev+media${TS}cf@playtest.test`, "Omar Reyes", "developer", "he");
  await subscribeDev(omar);
  const ana = await account(`tester+media${TS}cfa@playtest.test`, "Ana Silva", "tester", "she");
  const admin = await adminAccount();
  const mk = (title, over = {}) => postTest(omar, { productName: "Tide Tracker", title: `Tide Tracker: ${title}`, categories: ["Productivity"], spots: "4", ...over });
  const widgets = await mk("widgets"), alarms = await mk("alarms"), sync = await mk("sync");
  const link = (P, id) => P.locator(`a[href^="/app/find/${id}"]`);
  // §9 Live: Omar stops a test while Ana has his profile open; it leaves her list on the page's next refresh.
  {
    const T = await rec(V, ana);
    await open(T, `/app/developers/${omar.uid}`, `a[href^="/app/find/${alarms}"]`);
    const list = T.locator("section.card", { has: T.locator("h2", { hasText: "Open tests" }) });
    await list.scrollIntoViewIfNeeded();
    const from = at(T);
    await pause(T, 1500);
    await shot(T, "b17-09-open-tests", "§9 Open tests on a developer's profile | Ana sees Omar's three open tests.", list);
    await stopTest(omar, alarms);
    await waitPoll(T, `a[href^="/app/find/${alarms}"]`, true);
    await pause(T, 2000);
    await shot(T, "b17-09-live", "§9 It stays current | Omar stopped “Tide Tracker: alarms” while the profile was open: it left the list on the page's own refresh, no reload.", list);
    finishVideo([{ file: await saveVideo(T, "b17-09-live.webm"), from }], "b17-09-live-video", "§9 Open tests, live | Omar stops one of his tests while Ana reads his profile; it leaves her list on the next refresh.");
  }
  // §9 A stale click: the team pauses a test just before Ana clicks it on the profile she opened earlier.
  {
    const T = await rec(V, ana);
    await T.goto(`/app/developers/${omar.uid}`);
    await waitPulse(T);
    await link(T, widgets).first().scrollIntoViewIfNeeded();
    const from = at(T);
    await pause(T, 1000);
    await adminDo(admin, "pause-test", widgets);
    await link(T, widgets).first().click();
    await T.waitForSelector("[data-profile-gone]", { timeout: 15000 });
    await pause(T, 2000);
    await shot(T, "b17-09-stale-click", "§9 A stale click | The test paused after Ana's profile page loaded: its page shows only “This test isn't available right now.” and a link back, nothing of the listing.", "main");
    await pause(T, 1000);
    finishVideo([{ file: await saveVideo(T, "b17-09-stale.webm"), from }], "b17-09-stale-video", "§9 A stale click | Ana clicks a test the team has just paused on the profile she opened earlier: its page shows only the refusal, with a link back.");
  }
  // §4 No thanks on an invite that was re-sent on a new listing: it stops once (blue), the next press says no thanks.
  {
    const t = await mk("private beta", { joinMode: "invite" });
    ok(await post(omar, `/api/tests/${t}/invite`, { ...go, testerIds: [ana.uid] }), "invite");
    const T = await rec(V, ana);
    await T.goto("/app");
    await T.waitForSelector("#invitations");
    await waitPulse(T, 25000, "invites=1");
    await T.locator("#invitations").scrollIntoViewIfNeeded();
    const from = at(T);
    await pause(T, 1200);
    await apiEdit(omar, t, { description: "Install the private beta and set two alarms for the morning tide." });
    await T.locator("#invitations button", { hasText: "No thanks" }).first().click();
    await T.waitForSelector("#invitations [data-stop-box]", { timeout: 15000 });
    await pause(T, 2000);
    await shot(T, "b17-04-no-thanks-once", "§4 No thanks on a re-sent invite | Omar changed the listing, so the invite was sent again: No thanks stops once in blue with “Omar Reyes updated … your invite was sent again on the new listing” and the new listing, instead of a refusal.", T.locator("#invitations [data-stop-box]").first());
    await T.locator("#invitations button", { hasText: "No thanks" }).first().click();
    await waitPoll(T, "#invitations", true, 15000);
    await pause(T, 2000);
    finishVideo([{ file: await saveVideo(T, "b17-04.webm"), from }], "b17-04-video", "§4 No thanks, re-sent | The first press stops once with the new listing; the second says no thanks and the card goes.");
  }
}, { section: B17, fake: true });

// ---------- Batch 18 (owner, Oct 28 evening): the report's "Batch 18 (Oct 28)" section (§ numbers are the items in docs/BATCH-18.md) ----------
group("b18a", async () => {
  // §1 Agreeing to updated Terms on Post and on Join, §2 the Terms' What changed, §8 the switch line, §7 excerpts without the product tick and under an NDA.
  const nora = await account(`dev+media${TS}da@playtest.test`, "Nora Lane", "developer", "she");
  await subscribeDev(nora);
  const ana = await account(`tester+media${TS}daa@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}dab@playtest.test`, "Ben Okafor", "tester", "he");
  const t = await postTest(nora, { title: "Harbor Run: first 3 levels", spots: "5" });
  // §1 Post: Nora accepted version 1 of the Terms; posting her next round asks her to agree to version 2 first.
  {
    await nextRound(nora, t);
    const draftId = sql(`select id from "Test" where "developerId" = '${nora.uid}' and status = 'draft' order by "createdAt" desc limit 1`);
    own(`update "User" set "termsVersion" = 1 where email = ${lit(nora.email)}`);
    const D = await rec(V, nora);
    await D.goto(`/app/tests/new?draft=${draftId}`);
    await D.waitForSelector("[data-draft-note]");
    await D.locator("#openUntil").fill(day(14));
    const btn = D.locator("button", { hasText: "Post the test" });
    await btn.scrollIntoViewIfNeeded();
    const from = at(D);
    await pause(D, 1000);
    await btn.click();
    await D.waitForSelector("[data-terms-again]", { timeout: 15000 });
    await pause(D, 1800);
    await shotSpan(D, "b18-01-post-box", "§1 Updated Terms on Post | Nora's first press of Post the test shows the box under it: “We updated our Terms of Use. Read what changed.” with the tick “I agree to the updated Terms”.", btn, "[data-terms-again]");
    await D.locator("#agree-terms").check();
    await pause(D, 900);
    await btn.click();
    await D.waitForURL((u) => /\/app\/tests\/\w+$/.test(u.pathname) && !u.pathname.endsWith("/new"), { timeout: 20000 });
    await pause(D, 2000);
    finishVideo([{ file: await saveVideo(D, "b18-01-post.webm"), from }], "b18-01-post-video", "§1 Agreeing on Post | The first press shows the Terms box; Nora ticks “I agree to the updated Terms” and the next press posts the round.");
  }
  // §1 Join: the same box under Join for a tester on the older version.
  {
    const t2 = await postTest(nora, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"], spots: "5" });
    own(`update "User" set "termsVersion" = 1 where email = ${lit(ben.email)}`);
    const T = await rec(V, ben);
    await open(T, `/app/find/${t2}`, "button.btn:has-text('Join')");
    const btn = T.locator("button.btn", { hasText: /Join/ }).first();
    await btn.scrollIntoViewIfNeeded();
    const from = at(T);
    await pause(T, 1000);
    await btn.click();
    await T.waitForSelector("[data-terms-again]", { timeout: 15000 });
    await pause(T, 1800);
    await shotSpan(T, "b18-01-join-box", "§1 Updated Terms on Join | Ben's Join shows the same box under the button; nothing else he does is blocked.", btn, "[data-terms-again]");
    await T.locator("#agree-terms").check();
    await pause(T, 900);
    await btn.click();
    await T.waitForURL(/\/app\/sessions\//, { timeout: 20000 });
    await pause(T, 2000);
    finishVideo([{ file: await saveVideo(T, "b18-01-join.webm"), from }], "b18-01-join-video", "§1 Agreeing on Join | Join shows the Terms box; Ben ticks it and the next press joins.");
  }
  // §2 The Terms page opens at "What changed".
  await open(ana, "/terms#what-changed", "[data-what-changed]");
  await shot(ana, "b18-02-what-changed", "§2 What changed | “Read what changed” opens the Terms at a short note for version 2: the content rule now matches the Mature line, calls end at the $1,000, every call uses Jitsi, and agreeing again.", "[data-what-changed]");
  // §8 The switch line: Ana sent answers, then Nora changed the questions.
  {
    const sA = await join(ana, t);
    await sendWritten(ana, sA);
    await apiEdit(nora, t, { questions: ["What did you like?", "Which harbor was the hardest to sail into?"] });
    await open(ana, `/app/sessions/${sA}`, "[data-switch-questions]");
    await shot(ana, "b18-08-switch-line", "§8 Old answers stay payable | The Switch / Keep box for changed questions adds: “Switching means answering the new questions: send your updated answers. Answers you already sent stay payable at $10.00.” (the price they were sent at)", "#terms-offer");
  }
  // §7 Excerpts: no "Don't name the product" tick; a request pending when the test gets an NDA can still be allowed, into hidden.
  {
    const p = await paidPart(nora, ben, { productName: "Night Market", title: "Night Market demo", categories: ["Game"] });
    const T = await rec(V, ben);
    await open(T, `/app/sessions/${p.s}`, "[data-excerpt-picker]");
    const pick = T.locator("[data-excerpt-picker]");
    await pick.scrollIntoViewIfNeeded();
    const from = at(T);
    await pick.locator("button", { hasText: "Show an excerpt on your profile" }).click();
    await pause(T, 600);
    await pick.locator("input[type=radio]").first().check();
    await T.locator(`#excerpt-text-${p.sub}`).fill("tight turns, and the wake looks lovely at night.");
    await pause(T, 1200);
    if (await pick.locator("text=/name the product/i").count()) console.log("   ! §7: the product tick is still there");
    await shot(T, "b18-07-picker", "§7 No product tick | The excerpt picker has no “Don't name the product” tick any more: an excerpt always reads “From Night Market demo”.", pick);
    await pick.locator("button", { hasText: "Ask the developer" }).click();
    await T.waitForSelector("[data-excerpt-pending]", { timeout: 15000 });
    await pause(T, 1500);
    finishVideo([{ file: await saveVideo(T, "b18-07-ask.webm"), from }], "b18-07-ask-video", "§7 Asking for an excerpt | Ben picks a paid answer, trims it and asks Nora: no product tick.");
    await apiEdit(nora, p.t, { ndaText: "Don't share screenshots or details of the market before launch." });
    await open(nora, `/app/tests/${p.t}`, "[data-excerpt-request]");
    await shot(nora, "b18-07-nda-request", "§7 Pending when the NDA came | Nora added an NDA after Ben asked: the request can still be allowed, and says it will stay hidden while the NDA is on.", "[data-excerpt-request]");
    await nora.locator("[data-excerpt-request] button", { hasText: "Allow" }).click();
    await pause(nora, 2000);
    await open(ben, `/app/testers/${ben.uid}`, "#excerpts");
    await shot(ben, "b18-07-allowed-hidden", "§7 Allowed into hidden | Ben's list reads “Allowed · hidden while Night Market demo has an NDA”: it shows on his profile if the NDA is removed.", "#excerpts");
  }
}, { section: B18, fake: true });

group("b18b", async () => {
  // §4 The avatar row: "+N more joined · M open".
  const nora = await account(`dev+media${TS}db@playtest.test`, "Nora Lane", "developer", "she");
  await subscribeDev(nora);
  const t = await postTest(nora, { title: "Harbor Run: open beta", spots: "10" });
  // (Batch 31: every new test takes at most 10 testers; a test posted before that keeps its spots. This one is given 40, as such an older test, to show the row.)
  own(`update "Test" set spots = 40 where id = '${t}'`);
  const names = ["Ana Silva", "Ben Okafor", "Cam Lee", "Dee Park", "Eli Novak", "Fay Mendes", "Gus Hale", "Hana Ito", "Ivo Brandt", "Jo Kim", "Kai Moreno", "Lia Costa", "Max Weber", "Noor Aziz"];
  for (const [i, n] of names.entries()) {
    const p = await account(`tester+media${TS}db${i}@playtest.test`, n, "tester", "they");
    await join(p, t);
    await p.context().close();
  }
  await open(nora, `/app/tests/${t}`, "[data-seats-more]");
  await shot(nora, "b18-04-avatars", "§4 The avatar row | 12 circles, then “+2 more joined · 26 open”: the joined testers beyond the circles, and the spots still open.", nora.locator("[data-seats-more]").locator("xpath=.."));
}, { section: B18, fake: true });

group("b18c", async () => {
  // §3 a call ending at the $1,000, §6 the Length cap, §9 a call in progress never cut, §10 and §12 the call page's lines, §13 Check your call setup.
  const nora = await account(`dev+media${TS}dc@playtest.test`, "Nora Lane", "developer", "she");
  await subscribeDev(nora);
  const ana = await account(`tester+media${TS}dca@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}dcb@playtest.test`, "Ben Okafor", "tester", "he");
  const cam = await account(`tester+media${TS}dcc@playtest.test`, "Cam Lee", "tester", "they");
  const dee = await account(`tester+media${TS}dcd@playtest.test`, "Dee Park", "tester", "she");
  const t = await postTest(nora, { title: "Harbor Run: live", liveRateCents: "150.00", spots: "6" });
  const sA = await join(ana, t), sB = await join(ben, t), sC = await join(cam, t), sD = await join(dee, t);
  // §6 (the Length cap) is recorded by its own group, b18len.
  // §3 Ana's calls: two long ones leave $100, so her call in progress (60 minutes booked at $150/h) ends at 40 minutes.
  await bookCall(nora, ana, t, sA, 100, 180);
  const a2 = await bookCall(nora, ana, t, sA, 124, 150);
  const a3 = await bookCall(nora, ana, t, sA, 148, 60);
  own(`update "Call" set minutes = 180 where id = '${a2}'`);
  const startCall = (call, devId, testerId, ago) => {
    own(`update "Call" set "startsAt" = ${utcNow} - interval '${ago} minutes', "devJoinedAt" = ${utcNow} - interval '${ago} minutes', "testerJoinedAt" = ${utcNow} - interval '${ago} minutes' where id = '${call}'`);
    sql(`insert into "CallPresence" (id, "callId", "userId", side, "startAt", "endAt") values ('pr' || md5(random()::text), '${call}', '${devId}', 'developer', ${utcNow} - interval '${ago} minutes', ${utcNow}), ('pr' || md5(random()::text), '${call}', '${testerId}', 'tester', ${utcNow} - interval '${ago} minutes', ${utcNow})`);
  };
  const shiftCall = (call, mins, ends = true) => {
    own(`update "Call" set "startsAt" = "startsAt" - interval '${mins} minutes', "devJoinedAt" = "devJoinedAt" - interval '${mins} minutes', "testerJoinedAt" = "testerJoinedAt" - interval '${mins} minutes' where id = '${call}'`);
    sql(`update "CallPresence" set "startAt" = "startAt" - interval '${mins} minutes'${ends ? `, "endAt" = "endAt" - interval '${mins} minutes'` : ""} where "callId" = '${call}'`);
  };
  startCall(a3, nora.uid, ana.uid, 32);
  {
    const D = await rec(V, nora), T = await rec(V, ana);
    await Promise.all([D.goto(`/app/calls/${a3}`), T.goto(`/app/calls/${a3}`)]);
    await Promise.all([D.waitForSelector("[data-call-cap]", { timeout: 20000 }), T.waitForSelector("[data-call-cap]", { timeout: 20000 })]);
    const fromD = at(D), fromT = at(T);
    await pause(D, 2000);
    await shot(D, "b18-03-warning", "§3 The warning | From 10 minutes before, Nora's call page says “This call ends at <time>: the $1,000 for calls with Ana Silva on this test is reached.”", "main");
    await shot(T, "b18-03-warning-tester", "§3 The same line for Ana | “This call ends at <time>: the $1,000 for calls with Nora Lane on this test is reached.”", "[data-call-cap]");
    // (The recording skips ahead: the call's clock moves on 9 minutes.)
    shiftCall(a3, 9, false);
    await Promise.all([D.waitForSelector("[data-call-line] >> text=/Call ended/", { timeout: 30000 }), T.waitForSelector("[data-call-line] >> text=/Call ended/", { timeout: 30000 })]);
    await pause(D, 2500);
    await shot(D, "b18-03-ended", "§3 Call ended at the $1,000 | At that moment both pages say “Call ended: the $1,000 for calls with Ana Silva on this test is reached. Minutes after this don't count.”; measuring stops and Join goes.", "main");
    finishVideo([{ file: await saveVideo(D, "b18-03-d.webm"), from: fromD }, { file: await saveVideo(T, "b18-03-t.webm"), from: fromT }], "b18-03-video", "§3 A call reaching the $1,000 | Nora (left) and Ana (right) read when the call ends; when the time comes both pages end the call (the clock is moved on for the recording).");
    console.log(`   capped call measured: ${sql(`select "measuredMinutes" from "Call" where id = '${a3}'`)} min`);
  }
  // (Ana's ended call moves out of the way of the next bookings.)
  own(`update "Call" set "startsAt" = "startsAt" - interval '3 hours' where id = '${a3}'`);
  // §10, §12, §13 The call page before a call: Join from 10 minutes before, the Jitsi lines, Check your call setup.
  const c1 = await bookCall(nora, cam, t, sC, 0.1, 30);
  const c2 = await bookCall(nora, cam, t, sC, 30, 30);
  await open(cam, `/app/calls/${c2}`, "[data-call-join-later]");
  await shot(cam, "b18-13-join-later", "§13 Before the call | Join opens only 10 minutes before (“You can join from <time>.”); “Check your call setup” is there from booking on, with its line about signing in to Jitsi ahead of time.", "main");
  await open(nora, `/app/calls/${c1}`, "[data-call-join]");
  await shot(nora, "b18-12-dev-call-page", "§10 and §12 The developer's call page | Join opens the Jitsi room in a new tab, “Keep this page open: it measures the call.”, and the host tip “Join a few minutes early: Jitsi asks the host to sign in with Google, GitHub or Facebook.”", "main");
  await open(cam, `/app/calls/${c1}`, "[data-call-join]");
  await shot(cam, "b18-12-tester-call-page", "§10 and §12 The tester's call page | The same Join line, and “If Jitsi says it's waiting for the host, Nora Lane is on the way: keep this page open.”", "main");
  const href = await cam.locator("[data-call-check] a").first().getAttribute("href");
  console.log(`   practice room link: ${/^https:\/\/meet\.jit\.si\/playtest-check-[a-f0-9]+$/.test(href || "") ? "ok" : "UNEXPECTED " + href}`);
  await open(cam, `/app/sessions/${sC}`, `#call-${c1} [data-call-check]`);
  await shot(cam, "b18-13-session-row", "§13 On the call's row | Each booked call in Cam's Live session has “Check your call setup” (a private practice room, never measured).", `#call-${c1}`);
  await open(cam, "/app", "[data-call-check]");
  await shot(cam, "b18-13-tester-dash", "§13 On the tester dashboard | Upcoming calls shows the link once per call.", cam.locator("[data-call-check]").first().locator("xpath=ancestor::section[1]"));
  await open(nora, "/app", "[data-call-check]");
  await shot(nora, "b18-13-dev-dash", "§13 On the developer dashboard | Nora's Calls box has it too.", nora.locator("[data-call-check]").first().locator("xpath=ancestor::section[1]"));
  // §12 The reminder 15 minutes before (the second call is moved to start in 14 minutes; booked a day ago).
  own(`update "Call" set "startsAt" = ${utcNow} + interval '14 minutes', "createdAt" = ${utcNow} - interval '1 day' where id = '${c2}'`);
  await open(nora, `/app/tests/${t}`, "#calls");
  await openBell(nora);
  const devLine = nora.locator("main li", { hasText: "Your call with Cam Lee" }).last();
  if (await devLine.count()) await shot(nora, "b18-12-dev-reminder", "§12 The developer's reminder | 15 minutes before: “Your call with Cam Lee on “Harbor Run: live” starts at <time>.” with “Open it a few minutes early: Jitsi asks the first person to sign in with Google, GitHub or Facebook.”", devLine);
  else console.log("   ! §12: no reminder line for Nora");
  await openBell(cam);
  const camLine = cam.locator("main li", { hasText: "Your call with Nora Lane" }).last();
  if (await camLine.count()) await shot(cam, "b18-12-tester-reminder", "§12 The tester's reminder | “Your call with Nora Lane on “Harbor Run: live” starts at <time>.”", camLine);
  else console.log("   ! §12: no reminder line for Cam");
  // §9 A call in progress when Nora ends Dee's work early: it goes on until they both leave, then “Call ended at …”.
  const d1 = await bookCall(nora, dee, t, sD, 200, 30);
  startCall(d1, nora.uid, dee.uid, 5);
  {
    const D = await rec(V, nora), T = await rec(V, dee);
    await Promise.all([D.goto(`/app/calls/${d1}`), T.goto(`/app/calls/${d1}`)]);
    await Promise.all([D.waitForSelector("[data-call-join]"), T.waitForSelector("[data-call-join]")]);
    const fromD = at(D), fromT = at(T);
    await pause(D, 3000);
    ok(await post(nora, `/api/tests/${t}/end-early`, { ...go, contractIds: [sD], reason: "We have enough answers for this round." }), "end early");
    await pause(D, 12000);
    if (await T.locator("[data-call-line]").count()) console.log("   ! §9: Dee's call page was cut");
    await shot(T, "b18-09-still-on", "§9 Not cut | Nora ended Dee's work early during the call: Dee's call page keeps the room and keeps measuring.", "main");
    await open(nora, `/app/tests/${t}`, "[data-in-progress-call]");
    await unfold(nora, "[data-in-progress-call]");
    await shot(nora, "b18-09-dev-in-progress", "§9 On the test page | Dee's row: “In progress: it ends when you both leave”.", nora.locator("[data-in-progress-call]").first());
    await open(dee, `/app/sessions/${sD}`, "[data-measuring]");
    await shot(dee, "b18-09-tester-in-progress", "§9 On Dee's page | Her work ended, and the call still reads “In progress”.", `#call-${d1}`);
    finishVideo([{ file: await saveVideo(D, "b18-09-d.webm"), from: fromD }, { file: await saveVideo(T, "b18-09-t.webm"), from: fromT }], "b18-09-video", "§9 A call in progress is never cut | Nora (left) and Dee (right) stay on the call page while Nora's End early goes through: neither page closes.");
  }
  // Both left 6 minutes ago (the clock moved on): the length is final.
  shiftCall(d1, 6);
  for (let i = 0; i < 8; i++) {
    await open(dee, `/app/calls/${d1}`, "[data-call-line]");
    if (/Call ended at/.test(await dee.locator("[data-call-line]").innerText())) break;
    await open(nora, `/app/tests/${t}`, "#calls");
    await pause(dee, 3000);
  }
  await shot(dee, "b18-09-ended", "§9 Then it ends | Once both have left (the 5-minute gap), the call page reads “Call ended at <time>.” and its measured minutes are payable as usual.", "[data-call-line]");
}, { section: B18, fake: true });

const B19 = "Batch 19 (Oct 28)";
group("b18len", async () => {
  // (Batch 18 §6, re-recorded after batch 19 §5) The Length cap, in the Length row's fixed layout: "Length", the box and "min" on one line, the red line under the row.
  const nora = await account(`dev+media${TS}dl@playtest.test`, "Nora Lane", "developer", "she");
  await subscribeDev(nora);
  const ben = await account(`tester+media${TS}dlb@playtest.test`, "Ben Okafor", "tester", "he");
  const t = await postTest(nora, { title: "Harbor Run: live", liveRateCents: "150.00", spots: "6" });
  const sB = await join(ben, t);
  // §6 Ben's two 180-minute calls at $150/h use $900 of his $1,000: a new call can be at most 40 minutes.
  await bookCall(nora, ben, t, sB, 48, 180);
  await bookCall(nora, ben, t, sB, 72, 180);
  const D = await rec(V, nora);
  await open(D, `/app/tests/${t}`, "#calls");
  await unfold(D, "#calls");
  await D.locator("#calls fieldset label", { hasText: "Ben Okafor" }).scrollIntoViewIfNeeded();
  const from = at(D);
  await pause(D, 1000);
  await D.locator("#calls fieldset label", { hasText: "Ben Okafor" }).locator("input").check();
  await D.locator("[aria-label='Requested time 1']").fill(dtLocal(localAt(5, 15, 0)));
  await D.waitForSelector("#calls [data-length-hint] >> text=/Ben/", { timeout: 10000 }).catch(() => {});
  await pause(D, 1500);
  const row = D.locator("#calls [data-length-row]");
  await shot(D, "b18-06-length-hint", "§6 The Length cap | With Ben ticked the hint next to Length reads “10–40 min (the $1,000 for calls with Ben Okafor)”: what's left of his $1,000 at the call's $150/h.", row);
  const len = D.locator("#calls [aria-label='Length in minutes']");
  await len.fill("");
  await typeSlow(D, "#calls [aria-label='Length in minutes']", "60", 150);
  await D.locator("[aria-label='Requested time 1']").click();
  await pause(D, 1500);
  const red = row.locator("xpath=following-sibling::*[1]");
  await shotSpan(D, "b18-06-length-red", "§6 Too long | 60 minutes turns the box red, with the line under the row: “At most 40 minutes: the $1,000 for calls with Ben Okafor on this test.” (the server refuses it too).", row, red);
  sec(B19);
  await shotSpan(D, "b19-05-length-row", "§5 The Length row keeps its shape | With the red line showing, “Length”, the box and “min” stay on one line (no letter-by-letter wrapping on a phone) and the red line sits under the whole row.", D.locator("[aria-label='Requested time 1']"), red);
  sec(B18);
  finishVideo([{ file: await saveVideo(D, "b18-06.webm"), from }], "b18-06-video", "§6 Booking within the $1,000 | Ticking Ben shows his cap in the Length hint; 60 minutes is red, with the line under the row.");
}, { section: B18, fake: true });

/** (Batch 19 §4) The uptime check with its key runs the 5-minute sweep (after answering): waits until `done()` holds, calling again now and then. */
async function sweepUntil(done, what, ms = 45000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await fetch(`${BASE}/api/health?key=${HEALTH_KEY}`).catch(() => null);
    if (!r || !r.ok) console.log("   ! health check answered", r && r.status);
    for (let i = 0; i < 6 && Date.now() < end; i++) {
      await new Promise((res) => setTimeout(res, 1500));
      if (done()) return true;
    }
  }
  console.log("   ! sweep: nothing yet for", what);
  return false;
}

group("b19a", async () => {
  // §6 the Terms' How payments work, §8 the Open until line, §7 the Charge tick on Post and Edit.
  const nora = await account(`dev+media${TS}ea@playtest.test`, "Nora Lane", "developer", "she");
  await subscribeDev(nora);
  // §6 The Terms of Use at section 4, How payments work (the tick's link opens it in a new tab).
  {
    const P = await same(nora);
    await P.goto("/terms#how-payments-work");
    await P.waitForSelector("[data-payment-rules]");
    await pause(P, 1200);
    await shot(P, "b19-06-payments-top", "§6 How payments work | The Terms of Use open at section 4, How payments work (its own link): “Payment is for the work the tester sent…”, then short headed paragraphs, each with a one-line example, starting with Prices and the split.");
    await P.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.85)));
    await pause(P, 800);
    await shot(P, "b19-06-payments-scroll", "§6 One scroll further | The next headed paragraphs of the same section, each in plain words with its example (the whole section runs from Prices and the split to Taxes and refunds).");
    await P.context().close();
  }
  // §8 and §7 Post: the Open until line, then Post refused until the tick is ticked.
  {
    const D = await rec(V, nora);
    await D.goto("/app/tests/new");
    await fillPost(D, "Reef Rescue: first reef");
    await D.locator("#openUntil").fill(day(14));
    await D.locator("#spots").click();
    const ou = field(D, "openUntil");
    await ou.scrollIntoViewIfNeeded();
    const from = at(D);
    await D.waitForSelector("[data-tester-days]");
    await pause(D, 1800);
    const line = await D.locator("[data-tester-days]").innerText();
    if (!/^Testers can join until this date\. Each gets 14 days from when they join, so someone joining on .+ has until .+ to send work\. You pay each piece within 7 days of it arriving or by that tester's deadline, whichever is later, or the tester can charge you\.$/.test(line)) console.log("   ! §8 Post line:", line);
    await shotSpan(D, "b19-08-post-line", "§8 The Open until line on Post | Under the date, live: “Testers can join until this date. Each gets 14 days from when they join, so someone joining on <Open until> has until <14 days later> to send work. You pay each piece within 7 days of it arriving or by that tester's deadline, whichever is later, or the tester can charge you.”", "label[for=openUntil]", "[data-tester-days]");
    await D.locator("#openUntil").fill(day(20));
    await D.locator("#spots").click();
    await pause(D, 1800);
    await shotSpan(D, "b19-08-post-line-20", "§8 It follows the date | Open until 20 days ahead: “Each gets 20 days from when they join …” and the last day to send work moves with it.", "label[for=openUntil]", "[data-tester-days]");
    const btn = D.locator("button", { hasText: "Post the test" });
    await btn.scrollIntoViewIfNeeded();
    await pause(D, 1200);
    await shotSpan(D, "b19-07-post-tick", "§7 The Charge tick | Just above Post the test: “I understand that a tester can charge my card, up to the listing price, for work I haven't paid once 7 days have passed since they sent it and their own deadline has passed.” with the link “How payments work”.", "[data-pay-rules-tick]", btn);
    await btn.click();
    await D.waitForSelector("text=Tick to confirm you understand how payments work.", { timeout: 15000 });
    await pause(D, 2000);
    await shotSpan(D, "b19-07-post-refused", "§7 Unticked, Post is refused | The server refuses it with the red line at the tick, “Tick to confirm you understand how payments work.”, and the list above the button counts it.", "[data-mistake-list]", btn);
    await D.locator("#payRulesOk").check();
    await pause(D, 1000);
    await btn.click();
    await D.waitForURL((u) => /\/app\/tests\/\w+$/.test(u.pathname) && !u.pathname.endsWith("/new"), { timeout: 20000 });
    await pause(D, 2500);
    finishVideo([{ file: await saveVideo(D, "b19-07-post.webm"), from }], "b19-07-post-video", "§7 and §8 Posting with the tick | The Open until line follows the date; Post unticked is refused in red at the tick; ticked, the next press posts the test.");
  }
  // §7 and §8 Edit: no tick on an unchanged form; a change shows it above Save, with the line's days after the change.
  {
    const t = await postTest(nora, { title: "Harbor Run: first 3 levels", openUntil: day(14) });
    const E = await rec(V, nora);
    await E.goto(`/app/tests/${t}/edit`);
    await E.waitForSelector("#openUntil");
    const save = saveBtn(E);
    await save.scrollIntoViewIfNeeded();
    const from = at(E);
    await pause(E, 1500);
    if (await E.locator("[data-pay-rules-tick]").count()) console.log("   ! §7 Edit: the tick shows on an unchanged form");
    await shotSpan(E, "b19-07-edit-unchanged", "§7 Edit, nothing changed | Save is faded and there's no tick above it.", E.locator("form div.panel").last(), save);
    const ou = field(E, "openUntil");
    await ou.scrollIntoViewIfNeeded();
    await pause(E, 800);
    await E.locator("#openUntil").fill(day(19));
    await E.locator("#spots").click();
    await pause(E, 1800);
    const line = await E.locator("[data-tester-days]").innerText();
    if (!/Each gets 19 days from when they join/.test(line)) console.log("   ! §8 Edit line:", line);
    await shotSpan(E, "b19-08-edit-line", "§8 The Open until line on Edit | Moved 5 days later, the line counts the days after the change: “Each gets 19 days from when they join, so someone joining on <Open until> has until <19 days later> to send work. …”", "label[for=openUntil]", "[data-tester-days]");
    await save.scrollIntoViewIfNeeded();
    await E.waitForSelector("[data-pay-rules-tick]", { timeout: 10000 });
    await pause(E, 1500);
    await shotSpan(E, "b19-07-edit-tick", "§7 Edit, with a change | Save is on, and the same tick appears just above it, required for this Save.", E.locator("form div.panel").last(), save);
    await E.locator("#payRulesOk").check();
    await pause(E, 900);
    await save.click();
    await E.waitForURL(`**/app/tests/${t}?saved=1**`, { timeout: 20000 }).catch(() => console.log("   ! §7 Edit: Save didn't land on the test page"));
    await pause(E, 2500);
    finishVideo([{ file: await saveVideo(E, "b19-07-edit.webm"), from }], "b19-07-edit-video", "§7 and §8 The tick on Edit | No tick while nothing changed; moving Open until 5 days later updates the line and brings the tick above Save; ticked, Save goes through.");
  }
}, { section: B19, fake: true });

group("b19b", async () => {
  // §2 "rate testers" on the paused banner, §5 "Your Let it go didn't go through.", §1 "Closing soon", §5 Pay again after a cancelled bank check.
  const nora = await account(`dev+media${TS}eb@playtest.test`, "Nora Lane", "developer", "she");
  await subscribeDev(nora);
  const ana = await account(`tester+media${TS}eba@playtest.test`, "Ana Silva", "tester", "she");
  const ben = await account(`tester+media${TS}ebb@playtest.test`, "Ben Okafor", "tester", "he");
  const dee = await account(`tester+media${TS}ebd@playtest.test`, "Dee Park", "tester", "she");
  const admin = await adminAccount();
  // §2 Ana rated and her answers are paid, so Nora's Rate is open; then the team pauses the test.
  {
    const t = await postTest(nora, { title: "Harbor Run: reef", spots: "4" });
    const sA = await join(ana, t);
    await sendWritten(ana, sA);
    await apiPay(nora, subOf(sA), "10.00");
    await rateDev(ana, sA, 5, "Clear steps and quick pay.");
    await adminDo(admin, "pause-test", t, { note: "Media pass check: we're looking at a report about the build link." });
    await open(nora, `/app/tests/${t}`, "[data-test-banner]");
    const text = await nora.locator("[data-test-banner]").innerText();
    if (!/cancel calls, or rate testers\.|or rate testers\./.test(text)) console.log("   ! §2 banner:", text.replace(/\s+/g, " ").slice(-200));
    await shot(nora, "b19-02-paused-rate", "§2 The paused banner lists rating | The team paused the test while Nora's Rate box for Ana is open, so the last line reads “For now you can stop this test, or rate testers.”, built from what's really there.", "[data-test-banner]");
    await adminDo(admin, "unpause-test", t);
  }
  // §5 Ben's Let it go from a page opened before Nora's Stop: the stop box names the press.
  {
    const t = await postTest(nora, { title: "Harbor Run: lighthouse", spots: "4" });
    const sB = await join(ben, t);
    await sendWritten(ben, sB);
    openCharge(sB, t);
    const B = await rec(V, ben);
    await B.goto(`/app/sessions/${sB}`);
    await B.waitForSelector("button:has-text('Let it go')");
    const letGo = B.locator("button", { hasText: /^Let it go$/ }).first();
    await letGo.scrollIntoViewIfNeeded();
    const from = at(B);
    await waitPulse(B);
    await pause(B, 800);
    await stopTest(nora, t);
    await pressConfirm(B, letGo, "Let it go");
    await B.waitForSelector("[data-stop-box]", { timeout: 15000 });
    await pause(B, 1800);
    const said = await B.locator("[data-stop-box] [data-didnt-go]").first().innerText().catch(() => "");
    if (said !== "Your Let it go didn't go through.") console.log("   ! §5 stop box:", said);
    await shot(B, "b19-05-let-it-go-box", "§5 The stop box names the press | Ben's Let it go stops once for Nora's Stop: “Your Let it go didn't go through.” (it used to say Charge), then the stop and “Press Let it go again to go ahead.”", B.locator("[data-stop-box]").first());
    await pressConfirm(B, B.locator("button", { hasText: /^Let it go$/ }).first(), "Let it go");
    await pause(B, 2500);
    finishVideo([{ file: await saveVideo(B, "b19-05-let-it-go.webm"), from }], "b19-05-let-it-go-video", "§5 Let it go stops once | Nora stops the test while Ben's page is open: his Let it go stops with “Your Let it go didn't go through.”, and the second press goes through.");
  }
  // §1 Two stopped tests whose unpaid answers close in 3 days: the close-out reminders stack under "Closing soon" (sent by the 5-minute sweep, §4).
  {
    const t1 = await postTest(nora, { productName: "Kelp Forest", title: "Kelp Forest: iPhone beta", spots: "4" });
    const t2 = await postTest(nora, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"], spots: "4" });
    const s1 = await join(dee, t1), s2 = await join(dee, t2);
    await sendWritten(dee, s1);
    await sendWritten(dee, s2);
    const sub1 = subOf(s1), sub2 = subOf(s2);
    await stopTest(nora, t1);
    await stopTest(nora, t2);
    stoppedDaysAgo(t1, 11.5, [sub1]);
    stoppedDaysAgo(t2, 11.5, [sub2]);
    const count = (uid) => Number(sql(`select count(*) from "Notification" where "userId" = '${uid}' and "reminderKey" like 'closeout:%'`));
    await sweepUntil(() => count(nora.uid) >= 2 && count(dee.uid) >= 2, "the close-out reminders");
    console.log(`   close-out lines: Nora ${count(nora.uid)}, Dee ${count(dee.uid)}`);
    for (const [p, who, name] of [[nora, "dev", "Nora's"], [dee, "tester", "Dee's"]]) {
      await p.goto("/app/notifications");
      const stack = p.locator("[data-bell-stack]", { hasText: "Closing soon" }).first();
      await stack.waitFor({ state: "visible", timeout: 15000 });
      await pause(p, 800);
      await shot(p, `b19-01-${who}-stack`, `§1 Closing soon (${who === "dev" ? "developer" : "tester"}) | ${name} bell stacks the close-out reminders under one heading, “Closing soon: 2 tests”, instead of an entry with no title.`, stack);
      await stack.locator("button").first().click();
      await pause(p, 900);
      await shot(p, `b19-01-${who}-stack-open`, who === "dev" ? "§1 Opened (developer) | Inside: “Pay Dee Park's work on “Kelp Forest: iPhone beta” by <date>” and the same for Sky Lab." : "§1 Opened (tester) | Inside: “Charge or let go of your work on “Kelp Forest: iPhone beta” by <date>” and the same for Sky Lab.", stack);
    }
  }
  // §5 Pay, cancel the bank's check, Pay again on the same answers: a new attempt that goes through (it used to fail on the server).
  {
    const t = await postTest(nora, { productName: "Night Market", title: "Night Market demo", categories: ["Game"], spots: "4" });
    const sA = await join(ana, t);
    await sendWritten(ana, sA);
    const subA = subOf(sA);
    setCard(nora.email, "pm_card_authenticationRequired");
    const D = await rec(V, nora);
    await D.goto(`/app/tests/${t}`);
    await D.waitForSelector(`#piece-${subA}`);
    const from = at(D);
    await pause(D, 800);
    const cancelled = bankPopup(D, false);
    await payPiece(D, subA);
    await cancelled;
    await D.waitForSelector(`#piece-${subA} [data-bank-not-confirmed]`, { timeout: 15000 });
    await pause(D, 2500);
    await shot(D, "b19-05-cancelled", "§5 The check cancelled | Nora cancelled her bank's check: “Your bank didn't confirm the payment, so nothing was charged.” Pay is still there.", D.locator(`#piece-${subA}`));
    const confirmed = bankPopup(D, true, () => shot(D, "b19-05-second-check", "§5 Pay again | Pressing Pay again on the same answers is a new attempt with its own bank check (before this fix it failed with “Something went wrong on our side”).", D.locator(`#piece-${subA}`)));
    await payPiece(D, subA);
    await confirmed;
    await D.waitForSelector("text=/Paid \\$10\\.00/", { timeout: 20000 }).catch(() => console.log("   ! §5: no “Paid $10.00” after the second Pay"));
    await pause(D, 2500);
    const paid = sql(`select count(*) from "Payment" where "submissionId" = '${subA}' and status = 'charged'`);
    console.log(`   §5 charged payments on Ana's answers: ${paid}`);
    await waitPoll(D, "text=/Paid in all/");
    await shotSpan(D, "b19-05-paid", "§5 Paid once | Confirmed this time: Ana's written answers read “paid $10.00 of $10.00” (Pay more takes Pay's place); she is paid once and the cancelled attempt charged nothing.", D.locator("text=/paid \\$10\\.00 of \\$10\\.00/").first(), D.locator("text=/Paid in all/").first());
    finishVideo([{ file: await saveVideo(D, "b19-05-pay-again.webm"), from }], "b19-05-pay-again-video", "§5 Pay after a cancelled bank check | Nora presses Pay, cancels her bank's check (nothing charged), presses Pay again on the same answers, confirms, and Ana is paid.");
  }
}, { section: B19, fake: true });

// ---------- Batch 20 (owner, Oct 28 night), items §1 to §14: the report's "Batch 20 (Oct 29)" section (§ numbers are the items in docs/BATCH-20.md) ----------
{
  const B20 = "Batch 20 (Oct 29)";
  /** (The shared media server is very busy tonight) longer waits for this page. */
  const slow = (p) => {
    const c = p.context();
    c.setDefaultTimeout(45000);
    c.setDefaultNavigationTimeout(120000);
    // A connection the busy server dropped is tried again (a few seconds later).
    const req = c.request;
    if (!req.__retry) {
      const orig = req.post.bind(req);
      req.post = async (...a) => {
        for (let i = 0; ; i++) {
          try { return await orig(...a); } catch (e) {
            if (i >= 4 || !/ECONNRESET|ECONNREFUSED|socket hang up/.test(String(e))) throw e;
            await new Promise((r) => setTimeout(r, 5000));
          }
        }
      };
      req.__retry = true;
    }
    return p;
  };
  const developer = async (email, name) => {
    let p;
    for (let i = 0; !p; i++) {
      try { p = await account(i ? email.replace("@", `r${i}@`) : email, name, "developer", "they"); } catch (e) { if (i === 2) throw e; console.log("   (sign-up failed on the busy server, trying again)"); }
    }
    return slow(p);
  };
  const NOT_REQ = "[not required] ";
  const Q20 = (n) => Array.from({ length: n }, (_, i) => (i === 3 ? longQuestion(i) : `Question ${i + 1}: ${["What did you like?", "Where did you get stuck?", "Was the map clear?", "How did the controls feel?", "Did the sound help?", "Would you play again?"][i % 6]}`));
  const wantsToKnow = (p) => p.locator(".card", { has: p.locator("h2", { hasText: "wants to know" }) }).first();

  group("b20a", async () => {
    // §1 question lists in a scroll box (join page, the answer form); §2 the 20-question notice on Post.
    const nora = await developer(`dev+media${TS}b20an@playtest.test`, "Nora Lane");
    await subscribeDev(nora);
    const ana = await tester(`tester+media${TS}b20aa@playtest.test`, "Ana Silva");
    const t2 = await postTest(nora, { title: "Harbor Run: two questions", questions: ["What did you like?", "Where did you get stuck?"] });
    const t20 = await postTest(nora, { productName: "Sky Lab", title: "Sky Lab: twenty questions", categories: ["Education"], questions: Q20(20) });
    // §1 The join page: 2 questions with no box; 20 in a box about 3 questions tall, a long one cut to 3 lines inside.
    await open(ana, `/app/find/${t2}`, "h2:has-text('wants to know')");
    await shot(ana, "b20-01-join-2", "§1 Two questions: no box | On the join page, “Nora Lane wants to know” lists 2 questions as a plain list.", wantsToKnow(ana));
    await open(ana, `/app/find/${t20}`, "[data-question-box]");
    await shot(ana, "b20-01-join-20", "§1 Twenty questions: a scroll box | The same card with 20 questions: every question is inside a box about 3 questions tall that scrolls (no “+17 more”).", wantsToKnow(ana));
    await ana.locator("[data-question-box]").evaluate((b) => { const q = b.querySelectorAll("[data-question]")[3]; b.scrollTop = q.offsetTop - b.offsetTop - 4; });
    await pause(ana, 600);
    await shot(ana, "b20-01-join-long", "§1 A long question inside the box | Scrolled to question 4, a long one: it keeps its own 3-line clamp with “Show more” inside the box.", wantsToKnow(ana));
    // §1 The answer form: 6 questions (the last required) in a box; the counter, files and Send stay below it; a red mistake scrolls the box to its question.
    const qs = Q20(6).map((q, i) => (i === 3 ? "Question 4: How did the controls feel?" : q)).map((q, i) => (i > 0 && i < 5 ? NOT_REQ + q : q));
    const t6 = await postTest(nora, { productName: "Kelp Forest", title: "Kelp Forest: six questions", questions: qs });
    const s6 = await join(ana, t6);
    {
      const T = slow(await rec(V, ana));
      await open(T, `/app/sessions/${s6}`, "form:has(button:has-text('Send my answers')) [data-question-box]");
      const box = T.locator("form:has(button:has-text('Send my answers')) [data-question-box]");
      await box.scrollIntoViewIfNeeded();
      const from = at(T);
      await pause(T, 1000);
      await shotSpan(T, "b20-01-form-box", "§1 The answer form in a box | With 6 questions, the questions and their answer boxes (each with its toolbar) sit in a box about 3 questions tall; “Anything else”, the “0 / 50,000” counter and Send my answers stay below it.", box, T.locator("form button", { hasText: "Send my answers" }));
      await T.locator("#a0").click();
      await T.keyboard.type("The boat handling feels great.", { delay: 30 });
      await pause(T, 600);
      await T.locator("form button", { hasText: "Send my answers" }).click();
      await T.waitForSelector("form .err-field", { timeout: 90000 }).catch(() => {});
      await pause(T, 2200);
      await shotSpan(T, "b20-01-form-red", "§1 A red mistake scrolls the box | Send with question 6 (required) empty: the box scrolls itself to question 6 and the red line sits right under its answer box: “Answer every required question before sending.”", box, T.locator("form button", { hasText: "Send my answers" }));
      finishVideo([{ file: await saveVideo(T, "b20-01-form.webm"), from }], "b20-01-form-video", "§1 Sending with a required answer missing | The tester answers question 1 and presses Send my answers; the box scrolls down to question 6, the empty required one, with “Answer every required question before sending.” under it.");
    }
    // §2 Post: 19 questions, then the 20th brings “At most 20 questions.”; deleting one takes it away.
    {
      const D = slow(await rec(V, nora));
      await D.goto("/app/tests/new");
      await fillPost(D, "Reef Rescue: long survey");
      await D.locator("#questions").fill(Q20(19).map((q, i) => (i === 3 ? "Question 4: How did the controls feel?" : q)).join("\n"));
      await D.locator("#questions").scrollIntoViewIfNeeded();
      await D.evaluate(() => { const t = document.querySelector("#questions"); t.style.height = ""; });
      const from = at(D);
      await pause(D, 1200);
      if (await D.locator("[data-question-limit]").count()) console.log("   ! §2: the line shows at 19");
      const qField = D.locator("#questions").locator("xpath=..");
      await D.locator("#questions").focus();
      await D.keyboard.press("Control+End");
      await D.keyboard.type("\nQuestion 20: Anything else we should fix first?", { delay: 35 });
      await D.waitForSelector("[data-question-limit]", { timeout: 20000 });
      await pause(D, 1500);
      await shotSpan(D, "b20-02-at-20", "§2 At 20, the notice | The 20th question brings a blue line under the last one: “At most 20 questions.” (a notice, not a red mistake: Post still works).", D.locator("[data-question-limit]").locator("xpath=preceding-sibling::ul[1]/li[last()]"), "[data-question-limit]", 12, 40);
      // (the last question selected from its line break to the end, then deleted with the keyboard)
      await D.locator("#questions").evaluate((t) => { t.focus(); t.setSelectionRange(t.value.lastIndexOf(String.fromCharCode(10)), t.value.length); });
      await D.keyboard.press("Backspace");
      await pause(D, 1500);
      if (await D.locator("[data-question-limit]").count()) console.log("   ! §2: the line stayed after deleting one");
      await shotSpan(D, "b20-02-back-19", "§2 Deleting one removes it | Back to 19 questions, the line is gone.", D.locator("#questions").locator("xpath=following-sibling::ul[1]/li[last()]"), D.locator("#questions").locator("xpath=following-sibling::ul[1]/li[last()]"), 12, 40);
      finishVideo([{ file: await saveVideo(D, "b20-02.webm"), from }], "b20-02-video", "§2 The 20-question notice | With 19 questions there's no line; typing the 20th shows “At most 20 questions.” under the list; deleting it takes the line away.");
    }
  }, { section: B20, fake: true });
  /** A tester profile as the profile page saves it (devices and languages). */
  const setProfile = async (p, devices, languages) => {
    for (let i = 0; ; i++) {
      const r = await post(p, "/api/profile", { name: p.name, pronoun: "they", isDeveloper: false, isTester: true, devices, languages, categories: [] });
      if (r.ok || i === 3) return ok(r, "profile");
      await pause(p, 2000); // (a busy server can time a transaction out: try again)
    }
  };
  /** A tester account whose profile really got saved (the shared media server is busy tonight; a timed-out profile save is tried again). */
  const tester = async (email, name, devices = ["Windows PC"], languages = ["English"]) => {
    let p;
    for (let i = 0; !p; i++) {
      try {
        p = await account(i ? email.replace("@", `r${i}@`) : email, name, "tester", "they", { devices, languages });
      } catch (e) {
        if (i === 2) throw e;
        console.log("   (sign-up failed on the busy server, trying again)");
      }
    }
    if (sql(`select count(*) from "TesterProfile" where "userId" = '${p.uid}'`) === "0") await setProfile(p, devices, languages);
    return slow(p);
  };
  /** Types a name into the invite panel's search and ticks that tester's row. */
  const tickByName = async (D, who) => {
    const box = D.locator("#invite input[aria-label='Find testers']");
    const row = D.locator(`#invite [data-invite-found] li[data-invite-row="${who.uid}"]`).first();
    for (let i = 0; ; i++) {
      await openInvite(D);
      await box.fill("");
      await box.fill(who.name);
      if (await row.waitFor({ timeout: 60000 }).then(() => true, () => false)) break;
      if (i === 2) { console.log("   invite panel:", (await D.locator("#invite").innerText().catch(() => "?")).replace(/\s+/g, " ").slice(0, 1500)); throw new Error("no invite row for " + who.name); }
    }
    await row.locator("input[type=checkbox]").check();
    await pause(D, 300);
  };
  const openInvite = async (D) => { if (!(await D.locator("#invite").evaluate((d) => d.open))) await D.click("#invite > summary"); await pause(D, 400); };
  /** After a press that sends: the page refreshes (the panel folds), so it is opened again at its Invited list. */
  const invited = async (D) => { await pause(D, 3000); await openInvite(D); await D.waitForSelector("#invite h3:has-text('Invited'), #invite [data-stop-box]", { timeout: 90000 }); await D.locator("#invite input[aria-label='Find testers']").scrollIntoViewIfNeeded(); };
  const inviteBtn = (D) => D.locator("#invite button", { hasText: /^Invite$/ });
  const NEEDS_DEV = ["Windows PC", "Switch", "VR headset", "Steam Deck", "iPhone", "Android phone", "iPad", "Android tablet"];

  group("b20b", async () => {
    // §3 Invite anyway names every missing need (both kinds, long lists cut to 3, a scroll box past 3 testers); §4 Invite stops only for required items.
    const nora = await developer(`dev+media${TS}b20bn@playtest.test`, "Nora Lane");
    await subscribeDev(nora);
    const P = [["Fen Bao", ["Windows PC"], ["English"]], ["Gus Hale", ["Mac"], ["Chinese"]], ["Hana Ito", ["Mac", "Linux"], ["English", "French"]], ["Ivo Lund", ["Mac"], ["German"]], ["Jae Moss", ["PlayStation"], ["Korean"]]];
    const people = [];
    for (const [i, [name, devices, languages]] of P.entries()) {
      retireName(name);
      people.push(await tester(`tester+media${TS}b20b${i}@playtest.test`, name, devices, languages));
    }
    const t = await postTest(nora, { title: "Harbor Run: every device", spots: "8", devices: NEEDS_DEV, languages: ["Chinese", "Portuguese"] });
    {
      const D = slow(await rec(V, nora));
      await open(D, `/app/tests/${t}`, "#invite");
      await openInvite(D);
      await D.locator("#invite input[aria-label='Find testers']").scrollIntoViewIfNeeded();
      const from = at(D);
      for (const p of people.slice(0, 3)) await tickByName(D, p);
      await D.locator("#invite input[aria-label='Find testers']").fill("");
      await inviteBtn(D).click();
      const anyway = D.locator("#invite [data-invite-anyway]");
      await anyway.waitFor({ timeout: 90000 });
      await anyway.scrollIntoViewIfNeeded();
      await pause(D, 1800);
      const lines = await anyway.locator("[data-gap-line]").allInnerTexts();
      console.log("   §3 lines:", JSON.stringify(lines));
      await shot(D, "b20-03-three", "§3 One line per tester, both kinds | “Fen Bao doesn't list a language this test needs (Chinese or Portuguese).”; Gus Hale: only the device part; Hana Ito, missing both: one line naming the languages and the devices, the long device list cut to its first 3 with “+5 more”.", anyway);
      const more = anyway.locator("[data-gap-line] button", { hasText: /^\+\d+ more$/ }).first();
      if (await more.count()) {
        await more.click();
        await pause(D, 1200);
        await shot(D, "b20-03-more-open", "§3 “+5 more” opens the rest in place | Pressed, Hana Ito's line lists every device the test needs (Windows PC, Switch, VR headset, Steam Deck, iPhone, Android phone, iPad or Android tablet), with “fewer” to fold it back.", anyway);
      } else console.log("   ! §3: no +N more button");
      await anyway.locator("button", { hasText: "Cancel" }).click();
      await D.locator("#invite input[aria-label='Find testers']").scrollIntoViewIfNeeded();
      for (const p of people.slice(3)) await tickByName(D, p);
      await D.locator("#invite input[aria-label='Find testers']").fill("");
      await inviteBtn(D).click();
      await anyway.waitFor({ timeout: 90000 });
      await D.waitForSelector("#invite [data-gap-scroll]", { timeout: 60000 }).catch(() => console.log("   ! §3: no scroll box with 5 testers"));
      await anyway.scrollIntoViewIfNeeded();
      await pause(D, 1800);
      await anyway.locator("[data-gap-scroll]").evaluate((b) => { b.scrollTop = 0; }).catch(() => {});
      await pause(D, 400);
      await shot(D, "b20-03-five", "§3 Five testers: a scroll box | With 5 testers ticked, the 5 lines sit in a small box that scrolls (about 4 lines show at once); Invite anyway and Cancel stay below it.", anyway);
      finishVideo([{ file: await saveVideo(D, "b20-03.webm"), from }], "b20-03-video", "§3 Invite anyway names every missing need | Three testers ticked: one line each naming the missing languages, devices or both, a long list opened with “+5 more”; then five testers: the lines scroll in a box above Invite anyway.");
    }
    // §4 Only changes to what this test requires stop Invite: one net line per tester.
    const t2 = await postTest(nora, { productName: "Sky Lab", title: "Sky Lab: Chinese voice-over", categories: ["Education"], spots: "8", languages: ["Chinese"] });
    const K = [];
    for (const [i, [name, langs]] of [["Kai Noor", ["Chinese"]], ["Lea Ford", ["English"]], ["Mo Reid", ["English"]]].entries()) {
      retireName(name);
      K.push(await tester(`tester+media${TS}b20bk${i}@playtest.test`, name, ["Windows PC"], langs));
    }
    {
      const D = slow(await rec(V, nora));
      await open(D, `/app/tests/${t2}`, "#invite");
      await openInvite(D);
      await D.locator("#invite input[aria-label='Find testers']").scrollIntoViewIfNeeded();
      const from = at(D);
      // (a) Kai (already lists Chinese) adds French in another tab: not required here, so Invite goes straight through.
      await tickByName(D, K[0]);
      await setProfile(K[0], ["Windows PC", "PlayStation"], ["Chinese", "French"]);
      await pause(D, 800);
      await inviteBtn(D).click();
      await invited(D);
      await pause(D, 1800);
      if (await D.locator("#invite [data-stop-box]").count()) console.log("   ! §4: an unrelated change stopped Invite");
      await shotSpan(D, "b20-04-unrelated", "§4 An unrelated change never stops Invite | Kai Noor added French and PlayStation to their profile after the page loaded; this test only needs Chinese, so Invite went straight through: Invited lists “Kai Noor · waiting for them to join”.", D.locator("#invite h3:has-text('Invited')"), D.locator("#invite h3:has-text('Invited') + *"));
      // (b) Lea adds Chinese (required): Invite stops once with one net line.
      await tickByName(D, K[1]);
      await setProfile(K[1], ["Windows PC"], ["English"]);
      await setProfile(K[1], ["Windows PC", "Xbox"], ["English", "Chinese", "French"]);
      await pause(D, 800);
      await inviteBtn(D).click();
      const stop = D.locator("#invite [data-stop-box]").first();
      await stop.waitFor({ timeout: 90000 });
      await pause(D, 2000);
      await shot(D, "b20-04-now-lists", "§4 A required item added: one line | Lea Ford changed their profile twice; only the net change to what this test needs is listed, once: “Lea Ford now lists Chinese, which this test needs.” with one time (French and Xbox aren't mentioned).", stop);
      await inviteBtn(D).click();
      await invited(D);
      await pause(D, 1500);
      // (c) Mo adds Chinese and removes it again: no line, no stop (the Invite anyway box for the missing language shows as usual).
      await tickByName(D, K[2]);
      await setProfile(K[2], ["Windows PC"], ["English", "Chinese"]);
      await setProfile(K[2], ["Windows PC"], ["English"]);
      await pause(D, 800);
      await inviteBtn(D).click();
      const anyway = D.locator("#invite [data-invite-anyway]");
      await anyway.waitFor({ timeout: 90000 });
      await pause(D, 1800);
      if (await D.locator("#invite [data-stop-box]").count()) console.log("   ! §4: added-then-removed stopped Invite");
      await shot(D, "b20-04-cancelled-out", "§4 Added then removed: no stop | Mo Reid added Chinese and took it out again: the edits cancel out, so there's no “now lists” line; the press opens the usual box for what they're missing: “Mo Reid doesn't list a language this test needs (Chinese).”", anyway);
      finishVideo([{ file: await saveVideo(D, "b20-04.webm"), from }], "b20-04-video", "§4 Invite stops only for required items | An unrelated profile change goes straight through; a tester adding the required Chinese stops Invite once with one line; added-then-removed gives no stop.");
    }
  }, { section: B20, fake: true });
  group("b20c", async () => {
    // §5 18+ at sign-up (email, and the Google step), §6 profile Open tests keep tests you're part of, §9 1-character name search.
    // §5 Email sign-up: everything filled but the age tick: Sign up is refused, red at the tick. (Nothing is created.)
    {
      const S = slow(await ctx(V));
      await S.goto("/signup");
      await S.waitForSelector("#over18");
      await S.locator("input[name=role][value=tester]").check();
      await S.fill("#name", "Rae Quinn");
      await S.fill("#email", `tester+media${TS}b20cs@playtest.test`);
      await S.fill("#password", PASSWORD);
      await S.locator("#acceptTerms").check();
      await shotSpan(S, "b20-05-signup-tick", "§5 The age tick at sign-up | Next to the Terms agreement, a second required tick: “I'm 18 or older.”", S.locator("#acceptTerms").locator("xpath=ancestor::label[1]"), S.locator("#over18").locator("xpath=ancestor::label[1]"), 12, 60);
      await S.locator("form button.btn").first().click();
      await S.waitForSelector("text=You must be 18 or older to use Playtest.", { timeout: 60000 });
      await pause(S, 1200);
      if (sql(`select count(*) from "User" where email = ${lit(`tester+media${TS}b20cs@playtest.test`)}`) !== "0") console.log("   ! §5: an account was made without the tick");
      await shot(S, "b20-05-signup-refused", "§5 Unticked, Sign up is refused | Red at the tick: “You must be 18 or older to use Playtest.”, listed under Sign up with “Fix the mistake above, then press Sign up again.”; no account is made (the red line sits between the box and its words, pushing “I'm 18 or older.” to the side).", S.locator("form").first());
      await S.context().close();
    }
    // §5 The Google step (what a new Google account sees after Google answers; staged here without Google: the step's row and cookie are made directly).
    {
      const token = require("crypto").randomBytes(24).toString("base64url");
      const key = "google-signup:" + require("crypto").createHash("sha256").update(token).digest("hex");
      sql(`insert into "AppState" (key, value) values (${lit(key)}, ${lit(JSON.stringify({ email: `tester+media${TS}b20cg@playtest.test`, exp: Date.now() + 25 * 60000 }))})`);
      const G = slow(await ctx(V));
      await G.context().addCookies([{ name: "pt_google_signup", value: token, url: BASE }]);
      await G.goto("/signup/google");
      await G.waitForSelector("form");
      await pause(G, 800);
      await shot(G, "b20-05-google-step", "§5 The Google sign-up step | After Google answers for a new account, one short step before the account exists: the Terms agreement and “I'm 18 or older.”, then Continue (staged here without Google).", G.locator("form").first());
      await G.locator("form button.btn").first().click();
      await pause(G, 2500);
      await shot(G, "b20-05-google-refused", "§5 Continue with neither tick | Nothing is created: “Agree to the Terms of Use to sign up” is red at the Terms tick and listed under Continue (“Fix the mistake above, then press Continue again.”); the age tick isn't marked yet.", G.locator("form").first());
      await G.locator("#acceptTerms").check();
      await G.locator("form button.btn").first().click();
      await G.waitForSelector("text=You must be 18 or older to use Playtest.", { timeout: 60000 }).catch(() => console.log("   ! §5 Google step: no age line"));
      await pause(G, 1500);
      await shot(G, "b20-05-google-age-red", "§5 Terms ticked, age not | The next Continue is refused at the age tick: “You must be 18 or older to use Playtest.”; still no account.", G.locator("form").first());
      if (sql(`select count(*) from "User" where email = ${lit(`tester+media${TS}b20cg@playtest.test`)}`) !== "0") console.log("   ! §5: a Google account was made without the age tick");
      await G.context().close();
      sql(`delete from "AppState" where key = ${lit(key)}`);
    }
    // §6 Nora's invite-only test with 1 spot: Ana and Ben invited, Ana joins (now full); an apply-to-join test where Cam applies.
    const nora = await developer(`dev+media${TS}b20cn@playtest.test`, "Nora Lane");
    await subscribeDev(nora);
    const ana = await tester(`tester+media${TS}b20ca@playtest.test`, "Ana Silva");
    const ben = await tester(`tester+media${TS}b20cb@playtest.test`, "Ben Okafor");
    const cam = await tester(`tester+media${TS}b20cc@playtest.test`, "Cam Lee");
    const jj = await postTest(nora, { title: "Harbor Run: invite only", spots: "1", joinMode: "invite" });
    ok(await post(nora, `/api/tests/${jj}/invite`, { ...go, testerIds: [ana.uid, ben.uid] }), "invite");
    await join(ana, jj);
    const ap = await postTest(nora, { productName: "Sky Lab", title: "Sky Lab: apply to join", categories: ["Education"], spots: "3", joinMode: "apply" });
    const a = await post(cam, `/api/tests/${ap}/apply`, { seenAt: nowIso(), confirmed: true, anyway: true, ndaAccepted: true, acceptNda: true, message: "I teach chemistry and would love to try it." });
    if (!a.ok) console.log("   ! §6 apply:", JSON.stringify(a.body).slice(0, 200));
    const openTests = (p) => p.locator("section.card", { has: p.locator("h2", { hasText: "Open tests" }) }).first();
    for (const [p, file, cap] of [
      [ana, "b20-06-in-test", "§6 A full test you're working in | “Harbor Run: invite only” is full (1 of 1, invite only), yet it stays on Nora Lane's profile for the tester working in it, with “You're in this test” (it opens their session page)."],
      [ben, "b20-06-invite-full", "§6 An open invite to a full test | For an invited tester the same full test stays listed with “Full right now: your invite stays open” (it opens the join page)."],
      [cam, "b20-06-applied", "§6 A pending application | “Sky Lab: apply to join” is listed with “Applied (waiting)” for the tester who applied; the full invite-only test isn't shown to them."],
    ]) {
      await open(p, `/app/developers/${nora.uid}`, "h2:has-text('Open tests')");
      await shot(p, file, cap, openTests(p));
    }
    // §9 Names from 1 character: "z" finds names starting with it (any word) or equal to it; from 3 characters any part matches.
    const Z = [];
    for (const [i, name] of ["Z", "Zan Okoro", "Ozanne Wilde"].entries()) { retireName(name); Z.push(await tester(`tester+media${TS}b20cz${i}@playtest.test`, name)); }
    const t9 = await postTest(nora, { productName: "Kelp Forest", title: "Kelp Forest: search", spots: "6" });
    {
      const D = slow(await rec(V, nora));
      await open(D, `/app/tests/${t9}`, "#invite");
      await openInvite(D);
      const box = D.locator("#invite input[aria-label='Find testers']");
      await box.scrollIntoViewIfNeeded();
      const from = at(D);
      await typeSlow(D, "#invite input[aria-label='Find testers']", "z", 200);
      await D.locator(`#invite [data-invite-found] li[data-invite-row="${Z[0].uid}"]`).waitFor({ timeout: 90000 });
      await pause(D, 1800);
      await shotSpan(D, "b20-09-one-letter", "§9 One letter finds a one-letter name | “z” finds the tester named “Z” (the exact match first) and “Zan Okoro” (a word starting with z), and other testers named Z… (greyed when they can't join this test), but not “Ozanne Wilde”.", box, "#invite [data-invite-find]");
      await D.keyboard.type("an", { delay: 250 });
      await D.locator(`#invite [data-invite-found] li[data-invite-row="${Z[2].uid}"]`).waitFor({ timeout: 90000 });
      await pause(D, 1800);
      await shotSpan(D, "b20-09-three-letters", "§9 From 3 letters, any part | “zan” also finds “Ozanne Wilde” (the letters inside a word) next to “Zan Okoro”.", box, "#invite [data-invite-find]");
      finishVideo([{ file: await saveVideo(D, "b20-09.webm"), from }], "b20-09-video", "§9 Searching from 1 character | Typing “z” finds “Z” and “Zan Okoro”; typing on to “zan” adds “Ozanne Wilde”.");
    }
  }, { section: B20, fake: true });
  /** Watches a page for a red line for `ms`, every 100 ms; returns how many times one was seen. */
  const liveCard = (p) => p.locator("h2", { hasText: "Live session" }).first().locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' card ')][1]");
  const watchRed = async (page, sel, ms) => {
    let seen = 0;
    for (const end = Date.now() + ms; Date.now() < end; ) {
      if (await page.locator(sel).first().isVisible().catch(() => false)) seen++;
      await page.waitForTimeout(100);
    }
    return seen;
  };

  group("b20d", async () => {
    // §7 Request a time: no false "overlaps" flash after pressing; §8 the "Don't stop me for" chip and the Alerts menu stay in sync.
    const nora = await developer(`dev+media${TS}b20dn@playtest.test`, "Nora Lane");
    await subscribeDev(nora);
    own(`update "User" set "ignoredAlerts" = ARRAY[]::text[] where email = ${lit(nora.email)}`);
    const ana = await tester(`tester+media${TS}b20da@playtest.test`, "Ana Silva");
    const t = await postTest(nora, { liveRateCents: "30.00", spots: "6" });
    const sA = await join(ana, t);
    // §7 The tester, with no other calls or requests, asks for a weekly call: no red line at any moment.
    {
      const T = slow(await rec(V, ana));
      await open(T, `/app/sessions/${sA}`, "[aria-label='Requested time 1']");
      const row = T.locator("[data-request-row]").first();
      await row.scrollIntoViewIfNeeded();
      const from = at(T);
      await pause(T, 800);
      await T.locator("[aria-label='Requested time 1']").fill(dtLocal(localAt(3, 15, 0)));
      await T.locator("[aria-label='Repeat 1']").selectOption("weekly");
      await T.locator("[aria-label='How many calls 1']").selectOption("4").catch(() => {});
      const len = T.locator("[aria-label='Length in minutes']").first();
      if (await len.count()) { await len.fill(""); await len.type("30", { delay: 100 }); }
      await pause(T, 1200);
      await shot(T, "b20-07-before", "§7 A weekly call, nothing else booked | The tester (no calls or requests yet) fills in a time, Weekly, 4 calls, 30 minutes: no red line.", liveCard(T));
      await T.locator("button", { hasText: /^Request a time$/ }).first().click();
      const red = await watchRed(T, "[data-clash=red]", 8000);
      await tick(T);
      const red2 = await watchRed(T, "[data-clash=red]", 6000);
      console.log(`   §7 red "overlaps" lines seen: ${red} right after the press, ${red2} after the next poll`);
      await pause(T, 1000);
      await shot(T, "b20-07-after", red + red2 ? "§7 (A red line flashed) | After the press a red line was seen: see the report." : "§7 After the press: no red flash | The request went through and the form cleared; at no moment after the press (checked every 0.1 s, then after the next poll) did a red “overlaps” line show. The request waits in Call requests: “weekly calls: Sun 3:00 PM · 4 calls from Sun, Nov 1, 3:00 PM · 30 min · Contract $30/h · asked by you”.", liveCard(T));
      finishVideo([{ file: await saveVideo(T, "b20-07.webm"), from }], "b20-07-video", red + red2 ? "§7 Request a time (a red line flashed)" : "§7 Request a time, no false overlap | A tester with no other calls asks for a weekly call: no red “overlaps” line appears at any moment; the request goes straight into Call requests.");
    }
    // §8 Next round stops once for Ana's new request; "Don't stop me for: Call changes" turns to "(off)" and the Alerts menu shows it ticked; un-ticking there turns the chip back.
    {
      const D = slow(await rec(V, nora));
      await open(D, `/app/tests/${t}`, "section[aria-label='Test']");
      const from = at(D);
      await D.click("button:has-text('Next round')");
      await pause(D, 800);
      ok(await post(ana, `/api/sessions/${sA}/request-time`, { ...go, minutes: 30, rows: [{ startsAt: localAt(5, 11, 0).toISOString(), repeat: "once" }] }), "tester request");
      await D.click("button:has-text('Start the next round')");
      const qi = D.locator("[data-stop-box] [data-quick-ignore]").first();
      await qi.waitFor({ timeout: 90000 });
      await pause(D, 1500);
      const chip = qi.locator("button", { hasText: /^Call changes/ }).first();
      await shot(D, "b20-08-chip", "§8 The chip in the stop box | Next round stops once for the tester's new call request; under it: “Don't stop me for: Call changes”.", D.locator("[data-stop-box]").first());
      await chip.click();
      await D.waitForSelector("[data-quick-ignore] button:has-text('Call changes (off)')", { timeout: 90000 });
      await pause(D, 1200);
      await shot(D, "b20-08-chip-off", "§8 Pressed: “Call changes (off)” | The chip saves the same setting the Alerts menu uses.", D.locator("[data-stop-box]").first());
      await D.locator("[data-alerts-menu] > summary").first().click();
      await pause(D, 1200);
      const menu = D.locator("[data-alerts-menu]").first();
      const ticked = await menu.locator("label", { hasText: "Call changes" }).locator("input").isChecked().catch(() => null);
      console.log("   §8 Alerts menu: Call changes ticked =", ticked);
      await shotSpan(D, "b20-08-menu", ticked ? "§8 The Alerts menu agrees at once | Opened right after, the menu shows “Call changes” ticked (and the button reads “Alerts (1 off)”)." : "§8 (The menu didn't follow)", menu.locator("summary"), menu.locator("label").last());
      // Another tab of the same developer shows the same tick.
      const O = slow(await same(nora));
      await open(O, `/app/tests/${t}`, "[data-alerts-menu]");
      await O.locator("[data-alerts-menu] > summary").first().click();
      await pause(O, 900);
      await shotSpan(O, "b20-08-other-tab", "§8 Another tab too | A second tab of the test page opened afterwards: its Alerts menu also has “Call changes” ticked.", O.locator("[data-alerts-menu] summary").first(), O.locator("[data-alerts-menu] label").last());
      await O.context().close();
      await menu.locator("label", { hasText: "Call changes" }).locator("input").uncheck();
      await pause(D, 1500);
      await D.locator("[data-alerts-menu] > summary").first().click().catch(() => {});
      await D.locator("[data-stop-box]").first().scrollIntoViewIfNeeded().catch(() => {});
      await pause(D, 1500);
      const back = await D.locator("[data-quick-ignore] button", { hasText: /^Call changes$/ }).count();
      console.log("   §8 chip back after un-ticking:", back);
      if (back) await shot(D, "b20-08-chip-back", "§8 Un-ticked in the menu, the chip comes back | After un-ticking “Call changes” in Alerts, the stop box's chip reads “Call changes” again (pressable).", D.locator("[data-stop-box]").first());
      finishVideo([{ file: await saveVideo(D, "b20-08.webm"), from }], "b20-08-video", "§8 The chip and the menu in sync | Next round stops for a call request; “Don't stop me for: Call changes” turns to “(off)”; the Alerts menu opened right after has it ticked; un-ticking it there turns the chip back.");
    }
  }, { section: B20, fake: true });
  group("b20e", async () => {
    // §10 Invite is disabled while the test is full and comes back live when a spot opens; §11 past calls in a scroll box past 3, a link to the 5th.
    const nora = await developer(`dev+media${TS}b20en@playtest.test`, "Nora Lane");
    await subscribeDev(nora);
    const ana = await tester(`tester+media${TS}b20ea@playtest.test`, "Ana Silva");
    retireName("Bo Tran");
    const bo = await tester(`tester+media${TS}b20eb@playtest.test`, "Bo Tran");
    const t = await postTest(nora, { title: "Harbor Run: one spot", spots: "1" });
    const sA = await join(ana, t);
    {
      const D = slow(await rec(V, nora));
      await open(D, `/app/tests/${t}`, "#invite");
      await tickByName(D, bo);
      const btn = inviteBtn(D);
      await btn.scrollIntoViewIfNeeded();
      const from = at(D);
      await pause(D, 1500);
      if (!(await btn.isDisabled())) console.log("   ! §10: Invite is enabled on a full test");
      await shotSpan(D, "b20-10-full", "§10 Full: Invite is disabled | Every spot is taken (1 of 1): Invite is greyed with the line under it, “This test is full. Add spots in Edit to invite more people.” (“in Edit” opens Edit's spots); the tick on Bo Tran stays.", D.locator("#invite [data-invite-find]"), "#invite [data-invite-blocked]");
      ok(await post(ana, `/api/sessions/${sA}/leave`, go), "leave");
      const end = Date.now() + 150000;
      while (Date.now() < end && (await btn.isDisabled().catch(() => true))) { await tick(D); await D.waitForTimeout(800); }
      await openInvite(D);
      await pause(D, 1800);
      const live = !(await btn.isDisabled().catch(() => true));
      if (!live) { console.log("   ! §10: Invite didn't come back live"); throw new Error("§10 not live yet: run again"); }
      await shotSpan(D, "b20-10-spot-opens", "§10 A spot opens: Invite is back, live | The tester in the only spot left the test; without a reload the line goes, Invite lights up with Bo Tran still ticked, and the tester who left can be ticked again under “People you've worked with”.", D.locator("#invite input[aria-label='Find testers']"), btn);
      finishVideo([{ file: await saveVideo(D, "b20-10.webm"), from }], "b20-10-video", "§10 Invite while full | On a full test Invite is greyed with “This test is full. Add spots in Edit to invite more people.”; the tester in the only spot leaves and Invite comes back on its own.");
    }
    // §11 Six calls that took place between Nora and Cam.
    const cam = await tester(`tester+media${TS}b20ec@playtest.test`, "Cam Lee");
    const t2 = await postTest(nora, { productName: "Sky Lab", title: "Sky Lab: weekly calls", categories: ["Education"], liveRateCents: "30.00", spots: "4" });
    const sC = await join(cam, t2);
    const calls = [];
    // (at most 3 booked times at once: each call is moved into the past as soon as it is booked)
    for (let i = 0; i < 6; i++) { calls.push(await bookCall(nora, cam, t2, sC, 30 + 20 * i, 30)); tookPlace(calls[i], nora.uid, cam.uid, 60 * 24 * (6 - i) + 120, 25); }
    await open(cam, `/app/sessions/${sC}`, "#call-history");
    await open(nora, `/app/tests/${t2}`, `[data-calls-fold]`);
    await open(cam, `/app/sessions/${sC}`, "#call-history");
    await cam.evaluate(() => { const d = document.querySelector("#call-history"); if (d && !d.open) d.open = true; });
    await pause(cam, 1000);
    await shot(cam, "b20-11-tester-history", "§11 The tester's Call history: 6 calls | More than 3 past calls sit in a plain scroll box about 3 calls tall, newest first, every call inside (no “Show 3 more”).", "#call-history");
    await nora.evaluate(() => { const d = document.querySelector("[data-calls-fold]"); if (d && !d.open) d.open = true; });
    await pause(nora, 1000);
    await shot(nora, "b20-11-dev-calls", "§11 The developer's “Calls (6)” | In the tester's row, the 6 calls sit in a scroll box (about 5 show at once), newest first, each with its own controls inside (here “Pay it in Needs you ↑”).", "[data-calls-fold]");
    // A link to the 5th call (as the bell's links are): the box scrolls to it and marks it.
    const T = slow(await rec(V, cam));
    const from = at(T);
    await T.goto(`/app/sessions/${sC}#call-${calls[1]}`);
    await T.waitForSelector("#call-history", { timeout: 90000 });
    await pause(T, 1200);
    await shot(T, "b20-11-link-5th", "§11 A link to the 5th call | Opened from a link to the 5th call (newest first), the Call history box opens already scrolled down so that call is in view.", "#call-history");
    await pause(T, 1500);
    finishVideo([{ file: await saveVideo(T, "b20-11-link.webm"), from }], "b20-11-link-video", "§11 A link to an older call | The session page opens from a link to the 5th call: the Call history box opens scrolled down to that call.");
  }, { section: B20, fake: true });
  /** Nora's Pay more on a paid piece (the developer's own press, through the same route the page uses). */
  const payMore = (dev, testId, contractId, subId, dollars) => post(dev, `/api/tests/${testId}/pay-extra`, { ...go, seenAt: nowIso(), contractId, submissionId: subId, amount: dollars, tickedCents: Math.round(Number(dollars) * 100), payKey: require("crypto").randomUUID() }).then((r) => ok(r, "pay more"));

  group("b20f", async () => {
    // §12 a Pay more stops the tester's presses once (and the developer's other tab's), §13 the pill while typing, §14 Rate stops for a call change between the two.
    const nora = await developer(`dev+media${TS}b20fn@playtest.test`, "Nora Lane");
    await subscribeDev(nora);
    own(`update "User" set "ignoredAlerts" = ARRAY[]::text[] where email = ${lit(nora.email)}`);
    const ana = await tester(`tester+media${TS}b20fa@playtest.test`, "Ana Silva");
    const ben = await tester(`tester+media${TS}b20fb@playtest.test`, "Ben Okafor");
    const cam = await tester(`tester+media${TS}b20fc@playtest.test`, "Cam Lee");
    const t = await postTest(nora, { liveRateCents: "30.00", writtenCents: "10.00", spots: "6" });
    const sA = await join(ana, t), sB = await join(ben, t), sC = await join(cam, t);
    await sendWritten(ana, sA);
    await sendWritten(cam, sC);
    const subA = subOf(sA), subC = subOf(sC);
    await payWith(nora, subA, "6.00", "Two of the answers were one word: thank you for the rest.");
    await bookCall(nora, ana, t, sA, 50);
    // §12 tester side: Ana's page is open; Nora pays $2.50 more for her answers; Ana's Cancel call stops once naming it, the second press cancels.
    {
      const T = slow(await rec(V, ana));
      await open(T, `/app/sessions/${sA}`, "[data-cancel-menu]");
      const menu = T.locator("[data-cancel-menu]").first();
      await menu.scrollIntoViewIfNeeded();
      const from = at(T);
      await pause(T, 1000);
      await payMore(nora, t, sA, subA, "2.50");
      await menu.locator("summary").click();
      await pause(T, 600);
      await menu.locator("button", { hasText: "Cancel this call" }).click();
      const stop = T.locator("[data-stop-box]").first();
      await stop.waitFor({ timeout: 90000 });
      await pause(T, 2000);
      await shot(T, "b20-12-tester-stop", "§12 A Pay more stops the tester's press once | Pay more was missing from the tester's stop list: now the Cancel call press stops once with “Nora Lane paid you $2.50 more for your written answers” (Alerts On).", stop);
      await menu.locator("button", { hasText: "Cancel this call" }).click().catch(async () => { await menu.locator("summary").click(); await menu.locator("button", { hasText: "Cancel this call" }).click(); });
      await pause(T, 3000);
      finishVideo([{ file: await saveVideo(T, "b20-12-tester.webm"), from }], "b20-12-tester-video", "§12 Pay more, then Cancel call | The developer pays $2.50 more while the tester's page is open; the tester's Cancel call stops once naming it, and the second press cancels the call.");
    }
    // §12 developer side: a Pay more made in another tab stops this tab's next press (Pay on Cam's answers) once.
    {
      const D = slow(await rec(V, nora));
      await open(D, `/app/tests/${t}`, `#piece-${subC}`);
      await D.locator(`#piece-${subC}`).scrollIntoViewIfNeeded();
      const from = at(D);
      await pause(D, 1000);
      await payMore(nora, t, sA, subA, "1.00");
      await payPiece(D, subC);
      await D.waitForSelector(`#piece-${subC} [data-stop-box]`, { timeout: 90000 });
      await pause(D, 2000);
      await shot(D, "b20-12-dev-stop", "§12 The developer's other tab | A Pay more made in another tab stops Pay here once: “You paid Ana Silva $1.00 more for their written answers in another tab”.", `#piece-${subC}`);
      finishVideo([{ file: await saveVideo(D, "b20-12-dev.webm"), from }], "b20-12-dev-video", "§12 Pay more from another tab | The developer pays Ana $1.00 more in another tab; Pay on Cam's answers here stops once and lists it.");
    }
  }, { section: B20, fake: true });

  group("b20g", async () => {
    // §13 the pill while typing, §14 Rate stops for a call change between the two (split from b20f so each runs shorter on the busy server).
    const nora = await developer(`dev+media${TS}b20gn@playtest.test`, "Nora Lane");
    await subscribeDev(nora);
    own(`update "User" set "ignoredAlerts" = ARRAY[]::text[] where email = ${lit(nora.email)}`);
    const ana = await tester(`tester+media${TS}b20ga@playtest.test`, "Ana Silva");
    const ben = await tester(`tester+media${TS}b20gb@playtest.test`, "Ben Okafor");
    const cam = await tester(`tester+media${TS}b20gc@playtest.test`, "Cam Lee");
    const t = await postTest(nora, { liveRateCents: "30.00", writtenCents: "10.00", spots: "6" });
    const sA = await join(ana, t), sB = await join(ben, t), sC = await join(cam, t);
    await sendWritten(ana, sA);
    await payWith(nora, subOf(sA), "6.00", "Two of the answers were one word: thank you for the rest.");
    // §13 Ben is typing his answers; Nora requests a call with him: no scroll, the pill counts it, and the line is in the live box.
    {
      const T = slow(await rec(V, ben));
      await open(T, `/app/sessions/${sB}`, "#a0");
      await T.locator("#a0").scrollIntoViewIfNeeded();
      const from = at(T);
      await T.locator("#a0").click();
      await T.keyboard.type("The boat handling feels great, but the second", { delay: 45 });
      const y0 = await T.evaluate(() => window.scrollY);
      const when = localAt(4, 16, 0);
      ok(await post(nora, `/api/tests/${t}/request-time`, { ...go, contractIds: [sB], minutes: 30, times: [when.toISOString()] }), "request a time");
      await T.keyboard.type(" bridge confused me: I kept sailing", { delay: 60 });
      const pill = T.locator("[data-live-pill]");
      const end = Date.now() + 45000;
      while (Date.now() < end && !(await pill.isVisible().catch(() => false))) { await tick(T); await T.keyboard.type(" ", { delay: 50 }); await T.waitForTimeout(600); }
      await pause(T, 1200);
      const y1 = await T.evaluate(() => window.scrollY);
      console.log(`   §13 pill: ${await pill.innerText().catch(() => "none")}; scroll ${y0} → ${y1}`);
      await shot(T, "b20-13-pill", "§13 While typing: the pill, no scroll | The developer requested a call while the tester was typing an answer: the page stays put and a small “1 new update ↑” pill shows at the bottom.");
      await pill.click().catch(() => {});
      await pause(T, 1800);
      await shot(T, "b20-13-live-line", "§13 The line in the live box | Pressing the pill goes up to the live box, which lists the request (“Nora Lane requested a call …”).", "[data-live-top]");
      const reqs = T.locator("text=/Call requests/").first();
      await reqs.scrollIntoViewIfNeeded().catch(() => {});
      await pause(T, 1500);
      finishVideo([{ file: await saveVideo(T, "b20-13.webm"), from }], "b20-13-video", "§13 A call request while typing | The tester keeps typing as the developer requests a call: no jump, the “1 new update ↑” pill appears; pressed, it goes up to the live box's line.");
    }
    // §14 Ana can rate (her answers are paid); Nora requests a call with her after her page loaded: Rate stops once naming it; another tester's request doesn't stop it.
    {
      const T = slow(await rec(V, ana));
      await open(T, `/app/sessions/${sA}`, "button:has-text('Rate')");
      const rateBtn = T.locator("button", { hasText: /^Rate$/ }).first();
      await rateBtn.scrollIntoViewIfNeeded();
      const from = at(T);
      await pause(T, 1000);
      ok(await post(nora, `/api/tests/${t}/request-time`, { ...go, contractIds: [sC], minutes: 30, times: [localAt(6, 10, 0).toISOString()] }), "request a time (Cam)");
      ok(await post(nora, `/api/tests/${t}/request-time`, { ...go, contractIds: [sA], minutes: 30, times: [localAt(5, 15, 0).toISOString()] }), "request a time (Ana)");
      await pause(T, 800);
      await rateBtn.click();
      const stop = T.locator("[data-stop-box]").first();
      await stop.waitFor({ timeout: 90000 });
      await pause(T, 2000);
      const text = (await stop.innerText()).replace(/\s+/g, " ");
      if (/Cam Lee/.test(text)) console.log("   ! §14: another tester's call is in Rate's stop box");
      await shot(T, "b20-14-rate-stop", "§14 Rate stops once for a call change between the two | The developer requested a call with this tester after the page loaded: Rate stops once with “Nora Lane requested a call for <day, time>”; the developer's request to another tester isn't listed.", stop);
      await rateBtn.click();
      await pause(T, 3000);
      finishVideo([{ file: await saveVideo(T, "b20-14.webm"), from }], "b20-14-video", "§14 Rate after a call request | The developer requests a call with this tester (and one with another tester); the tester's Rate stops once naming only their own request, then the second press rates.");
    }
  }, { section: B20, fake: true });
  // @@MORE@@
}


// ---------- Batch 20 (owner, Oct 28 night), items 15 to 28: the report's "Batch 20 (Oct 29)" section (§ numbers are the items in docs/BATCH-20.md) ----------
{
  const B20 = "Batch 20 (Oct 29)";
  // (Busy shared server tonight: a call that fails on the server's side, or a dropped connection, is tried again a few times.)
  const b20R = async (fn, ...a) => {
    for (let i = 1; ; i++) {
      try { return await fn(...a); } catch (e) {
        if (i >= 4 || !/on our side|ECONNRESET|ECONNREFUSED|socket hang up|timed out/i.test(String(e))) throw e;
        console.log("   (retrying after:", String(e.message || e).slice(0, 120) + ")");
        await new Promise((r) => setTimeout(r, 4000 * i));
      }
    }
  };
  const b20ok = (page, p, body, what) => b20R(async () => ok(await post(page, p, body), what));
  // (The media server is shared by several recorders tonight: pages wait longer than the harness default.)
  const b20slow = (p) => { p.setDefaultTimeout(60000); p.setDefaultNavigationTimeout(120000); return p; };
  // A sign-up that half went through (the server dropped the answer) is retried as a fresh account (a new address), never the same one again.
  const b20acct = async (email, ...rest) => {
    for (let i = 0; ; i++) {
      try { return b20slow(await account(i ? email.replace("@", `r${i}@`) : email, ...rest)); } catch (e) {
        if (i >= 3) throw e;
        console.log("   (sign-up retried after:", String(e.message || e).slice(0, 100) + ")");
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  const b20rec = async (...a) => { const p = b20slow(await rec(...a)); return p; };
  const b20same = async (...a) => b20slow(await same(...a));
  const b20payMore = async (dev, t, sId, subId, dollars, note = "A little extra for the clear notes.") =>
    await b20ok(dev, `/api/tests/${t}/pay-extra`, { contractId: sId, submissionId: subId, amount: dollars, note, payKey: require("crypto").randomUUID(), tickedCents: Math.round(Number(dollars) * 100), seenAt: nowIso(), confirmed: true }, "pay more");
  // A recording page's marker: set once; still there later = the page was never reloaded.
  const b20mark = (p) => p.evaluate(() => { window.__b20mark = "kept"; });
  const b20marked = (p) => p.evaluate(() => window.__b20mark === "kept").catch(() => false);

  group("b20m15", async () => {
    // §15 Dispute disabled at the max (live after a Pay more), §26 Send my updated answers waits for a change, §28 the unlisted written part sends.
    const nora = await b20acct(`dev+media${TS}b2015ma@playtest.test`, "Nora Lane", "developer", "she");
    await b20R(subscribeDev, nora);
    const ana = await b20acct(`tester+media${TS}b2015mb@playtest.test`, "Ana Silva", "tester", "she");
    // §15 Ana was paid $8.00 of the $10.00 listing; Nora's Pay more of $2.00 reaches the listing while Ana's page is open.
    {
      const t = await b20R(postTest, nora, { title: "Harbor Run: reef", spots: "4" });
      const sA = await b20R(join, ana, t);
      await b20R(sendWritten, ana, sA);
      const sub = subOf(sA);
      await b20R(payWith, nora, sub, "8.00", "Only the first answer was about this build.");
      const A = await b20rec(V, ana);
      await open(A, `/app/sessions/${sA}`, "#part-written");
      const part = A.locator("#part-written");
      await A.locator("#part-written summary", { hasText: "Dispute the pay" }).scrollIntoViewIfNeeded();
      const from = at(A);
      await pause(A, 1500);
      await shot(A, "b20-15-can-dispute", "§15 Paid below the listing | Ana's written answers were paid $8.00 of the $10.00 listing, so “Dispute the pay” is open to them.", A.locator("#part-written summary", { hasText: "Dispute the pay" }).locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]"));
      await b20R(b20payMore, nora, t, sA, sub, "2.00");
      // (The page's own 20-second refresh; on tonight's busy server it can take a while. Not there after 2.5 minutes: the page is reloaded and the caption says so.)
      const live15 = await waitPoll(A, "#part-written [data-dispute-none]", false, 150000);
      if (!live15) { await A.reload(); await A.waitForSelector("#part-written [data-dispute-none]"); }
      await A.locator("#part-written [data-dispute-none]").scrollIntoViewIfNeeded();
      await pause(A, 2500);
      const line = await A.locator("#part-written [data-dispute-none] p").innerText().catch(() => "");
      if (line !== "Already paid the most a dispute could award, so there's nothing to dispute.") console.log("   ! §15 line:", line);
      await shot(A, "b20-15-nothing-to-dispute", `§15 Nothing left to award | After Nora's Pay more of $2.00 (“Extra $2.00”), ${live15 ? "the page's own refresh" : "the page (reloaded: tonight's busy server was slow)"} greys “Dispute the pay” with the line “Already paid the most a dispute could award, so there's nothing to dispute.”`, A.locator("#part-written [data-dispute-none]").locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]"));
      void part;
      finishVideo([{ file: await saveVideo(A, "b20-15.webm"), from }], "b20-15-video", "§15 Dispute greys out live | Ana's page is open with “Dispute the pay”; Nora pays $2.00 more, reaching the $10.00 listing, and without a reload the button greys with “Already paid the most a dispute could award, so there's nothing to dispute.”");
    }
  }, { section: B20, fake: true });

  group("b20m26", async () => {
    // §15 Dispute disabled at the max (live after a Pay more), §26 Send my updated answers waits for a change, §28 the unlisted written part sends.
    const nora = await b20acct(`dev+media${TS}b2026ma@playtest.test`, "Nora Lane", "developer", "she");
    await b20R(subscribeDev, nora);
    const ana = await b20acct(`tester+media${TS}b2026mb@playtest.test`, "Ana Silva", "tester", "she");
    // §26 Sent and not paid yet: "Send my updated answers" waits until something differs from what was sent.
    {
      const t = await b20R(postTest, nora, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"], spots: "4" });
      const sA = await b20R(join, ana, t);
      await b20R(sendWritten, ana, sA);
      const A = await b20rec(V, ana);
      await open(A, `/app/sessions/${sA}`, "#a0");
      const btn = A.locator("button", { hasText: "Send my updated answers" });
      await btn.scrollIntoViewIfNeeded();
      const from = at(A);
      await pause(A, 1500);
      const span = () => shotSpan(A, "x", "x", "#a0", btn); void span;
      await shotSpan(A, "b20-26-unchanged", "§26 Nothing changed yet | Right after sending, “Send my updated answers” is greyed (its tooltip: “Nothing has changed since you sent it”).", A.locator("form div[data-question]").last(), btn);
      await A.locator("#a1").click();
      await A.keyboard.press("End");
      await A.keyboard.type(" The ramp after it too.", { delay: 40 });
      await pause(A, 1200);
      await shotSpan(A, "b20-26-changed", "§26 Changed | With “ The ramp after it too.” added to the second answer, the button lights up.", A.locator("form div[data-question]").last(), btn);
      for (let i = 0; i < " The ramp after it too.".length; i++) await A.keyboard.press("Backspace", { delay: 30 });
      await pause(A, 1500);
      const idle = await btn.getAttribute("data-send-idle");
      if (idle === null) console.log("   ! §26: Send stayed enabled after undoing the edit");
      await shotSpan(A, "b20-26-undone", "§26 Changed back | Deleting the added words makes the answers match what was sent again, and the button greys again.", A.locator("form div[data-question]").last(), btn);
      const r = await post(ana, `/api/sessions/${sA}/written`, { answers: ["The boat handling feels great.", "The second bridge: I couldn't tell where to go."], notes: "", seenAt: nowIso(), confirmed: true });
      console.log(`   §26 identical resend: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
      finishVideo([{ file: await saveVideo(A, "b20-26.webm"), from }], "b20-26-video", "§26 Send waits for a change | Greyed after sending; typing in an answer lights it up; deleting the typing greys it again (the server also refuses an identical resend with “Nothing has changed since you sent it.”).");
    }
  }, { section: B20, fake: true });

  group("b20m28", async () => {
    // §15 Dispute disabled at the max (live after a Pay more), §26 Send my updated answers waits for a change, §28 the unlisted written part sends.
    const nora = await b20acct(`dev+media${TS}b2028ma@playtest.test`, "Nora Lane", "developer", "she");
    await b20R(subscribeDev, nora);
    const ana = await b20acct(`tester+media${TS}b2028mb@playtest.test`, "Ana Silva", "tester", "she");
    // §28 The owner's case: written answers not listed, the default "Your feedback" answered, "Anything else" empty: Send goes through. Then a required question left empty.
    {
      const t = await b20R(postTest, nora, { productName: "Pocket Chef", title: "Pocket Chef: recipe search", categories: ["Productivity"], writtenCents: null, writtenRequired: false, recordingCents: "15.00", recordingRequired: true, questions: [], spots: "4" });
      const sA = await b20R(join, ana, t);
      const A = await b20rec(V, ana);
      await open(A, `/app/sessions/${sA}`, "#a0");
      await A.locator("#a0").scrollIntoViewIfNeeded();
      const from = at(A);
      await pause(A, 1200);
      await shot(A, "b20-28-star", "§28 The required star | Written answers aren't listed on this test, so the form asks the one default question “Your feedback”, with its required “*” on the same line as the label (at the right end of that line), not wrapped onto a line of its own.", A.locator("form div[data-question]").first());
      await A.locator("#a0").click();
      await A.keyboard.type("ee", { delay: 150 });
      await pause(A, 800);
      await A.locator("button", { hasText: /^Send my answers$/ }).click();
      await A.waitForSelector("text=Under review", { timeout: 30000 }).catch(() => console.log("   ! §28: not under review after Send"));
      await pause(A, 2000);
      const sent = sql(`select count(*) from "Submission" where "contractId" = '${sA}'`);
      console.log(`   §28 sent pieces: ${sent}`);
      await shotSpan(A, "b20-28-sent", "§28 Sent | “ee” as the answer to “Your feedback” and nothing in “Anything else”: Send my answers goes through, and Your parts reads “Written answers: Under review · Sent <time>” (before the fix it was refused with “Answer every required question before sending.”).", A.getByText("Your parts", { exact: true }), A.getByText("Screen recording:", { exact: true }));
      finishVideo([{ file: await saveVideo(A, "b20-28.webm"), from }], "b20-28-video", "§28 The owner's case | Written answers not listed: “ee” in “Your feedback”, “Anything else” empty, Send my answers goes through.");
      // A listed part with 3 questions, the second required one left empty: red at that question.
      const t2 = await b20R(postTest, nora, { productName: "Kelp Forest", title: "Kelp Forest: iPhone beta", questions: ["What did you like?", "Where did you get stuck?", "[not required] Anything you'd change?"], spots: "4" });
      const s2 = await b20R(join, ana, t2);
      await open(ana, `/app/sessions/${s2}`, "#a0");
      await ana.locator("#a0").fill("The kelp looks lovely.");
      await ana.locator("button", { hasText: /^Send my answers$/ }).click();
      await pause(ana, 2500);
      await shotSpan(ana, "b20-28-red-at-question", "§28 A required answer missing | “Where did you get stuck?” left empty: the red line “Answer every required question before sending.” sits right under that question's box (which gets the focus), not only under the button.", ana.locator("form div[data-question]").first(), ana.locator("button", { hasText: /^Send my answers$/ }));
    }
  }, { section: B20, fake: true });


  group("b20n16", async () => {
    // §16 an admin account is admin only; §17 a blocked profile shows a proper page.
    // §16 A new admin's first sign-in: the setup asks only Name and Pronoun, then the console; developer and tester pages move them to /admin.
    {
      const adm = await b20acct(`admin+media${TS}b2016na@playtest.test`, "Ivy Admin", "developer", "they");
      own(`update "User" set "isAdmin" = true, name = '' where email = ${lit(adm.email)}`);
      const P = await b20rec(V, adm);
      await open(P, "/app", "h1");
      const from = at(P);
      await pause(P, 1500);
      await shot(P, "b20-16-setup", "§16 An admin's setup | “Welcome to Playtest” asks only Name and Pronoun: no “I'm here to” (an admin account has no developer or tester side).", "main");
      await P.locator("main input").first().fill("Ivy Admin");
      await pause(P, 600);
      await P.locator("main button", { hasText: /Continue|Save/ }).first().click();
      await P.waitForURL(/\/admin/, { timeout: 60000 }).catch(() => console.log("   ! §16: setup didn't land on /admin"));
      await P.waitForLoadState("load").catch(() => {});
      await pause(P, 2000);
      await shot(P, "b20-16-console", "§16 Then the console | Continue goes to the admin console (/admin), which is an admin's home from then on.");
      await P.goto("/app/tests/new");
      await P.waitForURL(/\/admin/, { timeout: 60000 }).catch(() => console.log("   ! §16: Post a test didn't move the admin"));
      await pause(P, 1500);
      await P.goto("/app/find");
      await pause(P, 1500);
      console.log("   §16 /app/find as admin ->", P.url());
      await P.goto("/app");
      await P.waitForURL(/\/admin/, { timeout: 60000 }).catch(() => {});
      await pause(P, 1500);
      finishVideo([{ file: await saveVideo(P, "b20-16.webm"), from }], "b20-16-video", "§16 Admin only | The setup asks only Name and Pronoun; Continue opens the console; Post a test and the dashboard move the admin back to /admin (Find stays: the admin version).");
    }
  }, { section: B20, fake: true });

  group("b20n17", async () => {
    // §17 Ana (tester) blocks Nora (developer) on Nora's profile; Nora opens Ana's; an unknown id.
    {
      const nora = await b20acct(`dev+media${TS}b2017nb@playtest.test`, "Nora Lane", "developer", "she");
      await b20R(subscribeDev, nora);
      const ana = await b20acct(`tester+media${TS}b2017nc@playtest.test`, "Ana Silva", "tester", "she");
      await b20R(postTest, nora, { title: "Harbor Run: first 3 levels", spots: "4" });
      await b20R(postTest, nora, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"], spots: "4" });
      const A = await b20rec(V, ana);
      await open(A, `/app/developers/${nora.uid}`, "main");
      const from = at(A);
      await pause(A, 1500);
      await shot(A, "b20-17-before", "§17 Before the block | Nora's profile as Ana sees it: the stats, Open tests listing “Sky Lab: tutorial” and “Harbor Run: first 3 levels”, then “Report Nora Lane” and “Block Nora Lane”.", "main");
      const blockBtn = A.locator("main button", { hasText: /^Block Nora Lane$/ }).first();
      await blockBtn.scrollIntoViewIfNeeded();
      await pressConfirm(A, blockBtn, "Block Nora Lane");
      await A.waitForSelector("[data-unblock]", { timeout: 60000 });
      await pause(A, 2000);
      await shot(A, "b20-17-blocked", "§17 You blocked them | The profile still opens (name, stats, ratings); Open tests reads “You blocked Nora Lane, so their tests are hidden.”, and where Block was there's “Unblock Nora Lane” (Report Nora Lane stays).", "main");
      // Nora opens Ana's profile: never told about the block.
      await open(nora, `/app/testers/${ana.uid}`, "[data-profile-unavailable]");
      await shot(nora, "b20-17-they-blocked", "§17 They blocked you | Nora opens Ana's profile: the normal header, “← Back” and “This profile isn't available.” (the block is never named).", "main");
      await open(nora, `/app/testers/cxxxxxxxxxxxxxxxxxxxxxxxx`, "main");
      await pause(nora, 800);
      await shot(nora, "b20-17-missing", "§17 An unknown profile | A profile address that doesn't exist: the header, “← Back” and “This page doesn't exist.” instead of the bare 404 page.", "main");
      await A.locator("[data-unblock]").scrollIntoViewIfNeeded();
      await pause(A, 800);
      await A.locator("[data-unblock]").click();
      await A.waitForSelector("text=Unblocked.", { timeout: 45000 }).catch(() => {});
      await pause(A, 2500);
      await shot(A, "b20-17-unblocked", "§17 Unblock | One press, no confirm, and the profile comes back in full at once: Open tests lists both tests again, with “Block Nora Lane” back under Report.", "main");
      finishVideo([{ file: await saveVideo(A, "b20-17.webm"), from }], "b20-17-video", "§17 Block and Unblock on a profile | Ana blocks Nora from Nora's profile: it stays open with Unblock and the tests hidden; Unblock brings everything back at once.");
    }
  }, { section: B20, fake: true });


  group("b20o19", async () => {
    // §19 number boxes, §20 the Open until line, §22 a ticked part needs a price, Save disabled, "Not saved yet" / "Not posted yet", §18 no reload under typing.
    const nora = await b20acct(`dev+media${TS}b2019oa@playtest.test`, "Nora Lane", "developer", "she");
    await b20R(subscribeDev, nora);
    // §19 Typing into the spots box: minus, a lone 0, "1e3" and "2.5".
    {
      const D = await b20rec(V, nora);
      await open(D, "/app/tests/new", "#spots");
      await D.locator("#spots").scrollIntoViewIfNeeded();
      const from = at(D);
      await pause(D, 1200);
      const results = [];
      for (const text of ["-20", "0", "1e3", "2.5"]) {
        await D.locator("#spots").fill("");
        await D.locator("#spots").click();
        await D.keyboard.type(text, { delay: 220 });
        await pause(D, 900);
        results.push(`${text} → “${await D.locator("#spots").inputValue()}”`);
      }
      console.log("   §19 spots:", results.join(", "));
      await D.locator("#spots").fill("");
      await D.locator("#spots").click();
      await D.keyboard.type("-20", { delay: 220 });
      await D.keyboard.press("Tab");
      await pause(D, 1200);
      const red = await field(D, "spots").locator(".err-field, [role=alert]").first().innerText().catch(() => "");
      console.log("   §19 red after -20:", red);
      await shot(D, "b20-19-spots", `§19 Spots takes digits only | Typing “-20” leaves “20” (the minus is ignored)${red ? `, which is above the maximum and keeps the existing red line “${red}”` : ""}; typed one after the other: ${results.join(", ")}.`, field(D, "spots"));
      await D.locator("#spots").fill("1");
      await D.locator("#spots").press("ArrowDown");
      await D.locator("#spots").press("ArrowDown");
      await pause(D, 800);
      console.log("   §19 spots after ArrowDown from 1:", await D.locator("#spots").inputValue());
      await shot(D, "b20-19-spots-min", `§19 The arrow keys stop at the minimum | From 1, the down arrow keeps “${await D.locator("#spots").inputValue()}”: it never goes to 0 or below.`, field(D, "spots"));
      // Money boxes: no minus.
      await D.locator("#writtenPrice").fill("");
      await D.locator("#writtenPrice").click();
      await D.keyboard.type("-12.50", { delay: 180 });
      await pause(D, 900);
      const price = await D.locator("#writtenPrice").inputValue();
      console.log("   §19 price typed -12.50 ->", price);
      await shot(D, "b20-19-price", `§19 Money boxes take no minus | Typing “-12.50” into the written answers' price leaves “${price}”.`, D.locator("#writtenPrice").locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]"));
      finishVideo([{ file: await saveVideo(D, "b20-19.webm"), from }], "b20-19-video", "§19 Number boxes | Typing “-20”, “0”, “1e3” and “2.5” into Spots: only digits stay and a lone 0 is ignored; the down arrow stops at 1; a minus in a price is ignored.");
    }
  }, { section: B20, fake: true });

  group("b20o2022", async () => {
    // §19 number boxes, §20 the Open until line, §22 a ticked part needs a price, Save disabled, "Not saved yet" / "Not posted yet", §18 no reload under typing.
    const nora = await b20acct(`dev+media${TS}b202022oa@playtest.test`, "Nora Lane", "developer", "she");
    await b20R(subscribeDev, nora);
    // §20 and §22 on Post: the Open until line, a ticked part with no price.
    {
      const D = await b20rec(V, nora);
      await open(D, "/app/tests/new", "#productName");
      await fillPost(D, "Reef Rescue: first reef");
      await D.locator("#openUntil").fill(day(14));
      await D.locator("#spots").click();
      await D.waitForSelector("[data-tester-days]");
      await pause(D, 1000);
      await shotSpan(D, "b20-20-line", "§20 The Open until line | The last sentence now names the later date: “You pay each piece within 7 days of it arriving or by that tester's deadline, whichever is later, or the tester can charge you.”", "label[for=openUntil]", "[data-tester-days]");
      const rec0 = D.locator("input[aria-label='Include the recorded session']");
      await rec0.scrollIntoViewIfNeeded();
      const from = at(D);
      await pause(D, 1000);
      await rec0.check();
      await pause(D, 600);
      await D.locator("#recordingPrice").click();
      await D.locator("#spots").click();
      await pause(D, 1500);
      const card = D.locator("#recordingPrice").locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
      await shot(D, "b20-22-price-red", "§22 A ticked part needs a price | Recorded session ticked and its price left empty: red on leaving it, “Enter a price for the recording, or tick Free.”", card.locator("xpath=.."));
      const btn = D.locator("button", { hasText: "Post the test" });
      await D.locator("#payRulesOk").check().catch(() => {});
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      await pause(D, 2500);
      await shotSpan(D, "b20-22-post-refused", "§22 Post refused | Post the test is refused while the ticked part has no price; the list above the button names it and goes to the field.", "[data-mistake-list]", btn);
      await D.locator("input[aria-label='Recorded session: free']").scrollIntoViewIfNeeded();
      await D.locator("input[aria-label='Recorded session: free']").check();
      await pause(D, 1500);
      await shot(D, "b20-22-free", "§22 Free | $0 only through the Free tick: ticking Free clears the red line.", card.locator("xpath=.."));
      finishVideo([{ file: await saveVideo(D, "b20-22-post.webm"), from }], "b20-22-post-video", "§22 A ticked part with no price | Ticking Recorded session and leaving its price empty turns it red; Post is refused; the Free tick is the way to $0.");
    }
  }, { section: B20, fake: true });

  group("b20o22e", async () => {
    // §19 number boxes, §20 the Open until line, §22 a ticked part needs a price, Save disabled, "Not saved yet" / "Not posted yet", §18 no reload under typing.
    const nora = await b20acct(`dev+media${TS}b2022eoa@playtest.test`, "Nora Lane", "developer", "she");
    await b20R(subscribeDev, nora);
    // §22 Edit: Save visibly disabled until a change; the kept-changes badge reads "Not saved yet" (Post: "Not posted yet").
    {
      const t = await b20R(postTest, nora, { title: "Harbor Run: first 3 levels", spots: "4" });
      const E = await b20same(nora);
      await open(E, `/app/tests/${t}/edit`, "#openUntil");
      const save = saveBtn(E);
      await save.scrollIntoViewIfNeeded();
      await pause(E, 1500);
      const title = await save.getAttribute("title");
      await shotSpan(E, "b20-22-save-idle", `§22 Save looks disabled | Nothing changed yet: Save is greyed (its tooltip: “${title}”).`, E.locator("form div.panel").last(), save);
      await E.locator("#description").fill("Sail through the first three harbors and tell us where the map gets confusing.");
      await pause(E, 3000); // the typed changes are kept on the server
      await E.reload();
      await E.waitForSelector("[data-not-sent]", { timeout: 45000 }).catch(() => console.log("   ! §22: no kept badge on Edit"));
      await save.scrollIntoViewIfNeeded();
      await pause(E, 1200);
      await shot(E, "b20-22-not-saved", `§22 “Not saved yet” | Typed on Edit, then the page reloaded: the changes are back with the badge “${await E.locator("[data-not-sent]").first().innerText().catch(() => "")}” next to Save.`, save.locator("xpath=.."));
      await E.context().close();
      const P = await b20same(nora);
      await open(P, "/app/tests/new", "#productName");
      await P.fill("#productName", "Tide Tracker");
      await P.fill("#title", "Tide Tracker: widgets");
      await pause(P, 3000);
      await P.reload();
      await P.waitForSelector("[data-not-sent]", { timeout: 45000 }).catch(() => console.log("   ! §22: no kept badge on Post"));
      const pb = P.locator("button", { hasText: "Post the test" });
      await pb.scrollIntoViewIfNeeded();
      await pause(P, 1000);
      await shot(P, "b20-22-not-posted", `§22 “Not posted yet” | The same on Post: “${await P.locator("[data-not-sent]").first().innerText().catch(() => "")}”.`, pb.locator("xpath=.."));
      await P.context().close();
    }
  }, { section: B20, fake: true });

  group("b20o18", async () => {
    // §19 number boxes, §20 the Open until line, §22 a ticked part needs a price, Save disabled, "Not saved yet" / "Not posted yet", §18 no reload under typing.
    const nora = await b20acct(`dev+media${TS}b2018oa@playtest.test`, "Nora Lane", "developer", "she");
    await b20R(subscribeDev, nora);
    // §18 Typing in Live session's Request a time while a tester joins (a change the page refreshes for): no reload, the typed rows stay.
    {
      const ana = await b20acct(`tester+media${TS}b2018ob@playtest.test`, "Ana Silva", "tester", "she");
      const ben = await b20acct(`tester+media${TS}b2018oc@playtest.test`, "Ben Okafor", "tester", "he");
      const t = await b20R(postTest, nora, { title: "Harbor Run: live", liveRateCents: "30.00", spots: "6" });
      await b20R(join, ana, t);
      const D = await b20rec(V, nora);
      await open(D, `/app/tests/${t}`, "#calls");
      await unfold(D, "#calls");
      await D.locator("#calls fieldset label", { hasText: "Ana Silva" }).scrollIntoViewIfNeeded();
      const from = at(D);
      await pause(D, 1000);
      await b20mark(D);
      await D.locator("#calls fieldset label", { hasText: "Ana Silva" }).locator("input").check();
      await D.locator("[aria-label='Requested time 1']").fill(dtLocal(localAt(3, 15, 0)));
      const len = D.locator("#calls [aria-label='Length in minutes']");
      await len.fill("");
      await len.click();
      await D.keyboard.type("45", { delay: 200 });
      await b20R(join, ben, t);
      // Two of the page's 20-second polls, the cursor still in Length.
      await D.waitForSelector("text=Ben Okafor", { timeout: 50000 }).catch(() => console.log("   ! §18: Ben's join didn't show"));
      await pause(D, 6000);
      const kept = await b20marked(D);
      const lenNow = await len.inputValue();
      console.log(`   §18 no reload: ${kept}, Length kept: ${lenNow}`);
      await shotSpan(D, "b20-18-kept", `§18 Typing kept | Ben joined while Nora was typing in Request a time: the page showed it without reloading (${kept ? "a marker set before the change was still there" : "the page reloaded"}), and the ticked tester, the time and Length “${lenNow}” stayed.`, D.locator("#calls fieldset").first(), D.locator("#calls [data-length-row]"));
      finishVideo([{ file: await saveVideo(D, "b20-18.webm"), from }], "b20-18-video", "§18 Never reload under typing | Nora fills in Request a time; Ben joins meanwhile; the page brings him in without a reload and the typed time and Length stay.");
    }
  }, { section: B20, fake: true });


  group("b20p21", async () => {
    // §21 the updated-Terms tick above the button (Post and Join); §23 "Worked with you on N tests".
    const nora = await b20acct(`dev+media${TS}b2021pa@playtest.test`, "Nora Lane", "developer", "she");
    await b20R(subscribeDev, nora);
    const ana = await b20acct(`tester+media${TS}b2021pb@playtest.test`, "Ana Silva", "tester", "she");
    // §21 Accounts on the older Terms version.
    {
      own(`update "User" set "termsVersion" = 1 where email in (${lit(nora.email)}, ${lit(ana.email)})`);
      const D = await b20rec(V, nora);
      await open(D, "/app/tests/new", "#productName");
      await fillPost(D, "Reef Rescue: first reef");
      const btn = D.locator("button", { hasText: "Post the test" });
      await btn.scrollIntoViewIfNeeded();
      const from = at(D);
      await pause(D, 1500);
      await shotSpan(D, "b20-21-post-ticks", "§21 Two ticks above Post | On an older Terms version: “I agree to the updated Terms of Use. Read what changed” first, then the Charge tick, then Post the test.", "[data-terms-again]", btn);
      await D.locator("#payRulesOk").check();
      await btn.click();
      await pause(D, 2500);
      await shotSpan(D, "b20-21-post-red", "§21 Required | Unticked, Post is refused: the red line “Tick to agree to the updated Terms of Use.” right under the tick.", "[data-terms-again]", btn);
      await D.locator("#agree-terms").check();
      await pause(D, 700);
      await btn.click();
      await D.waitForURL((u) => /\/app\/tests\/\w+$/.test(u.pathname) && !u.pathname.endsWith("/new"), { timeout: 60000 }).catch(async () => console.log("   ! §21: Post didn't go through:", (await D.locator("[data-mistake-list], p.err, .err-field, [role=alert]").allInnerTexts().catch(() => [])).join(" / ").slice(0, 400), "| ticks:", await D.locator("#agree-terms").isChecked().catch(() => "?"), await D.locator("#payRulesOk").isChecked().catch(() => "?")));
      await pause(D, 2000);
      finishVideo([{ file: await saveVideo(D, "b20-21-post.webm"), from }], "b20-21-post-video", "§21 The updated-Terms tick on Post | Refused while unticked; ticked, Post goes through (and the account is on the current Terms from then on).");
      const t = await b20R(postTest, nora, { title: "Harbor Run: first 3 levels", spots: "4" });
      await open(ana, `/app/find/${t}`, "#join-card");
      await ana.locator("#join-card").scrollIntoViewIfNeeded();
      await pause(ana, 800);
      await shot(ana, "b20-21-join", "§21 On the join page | Ana, on the older version, gets the same tick above Join this test (no “I'm 18 or older”: age is asked only at sign-up).", "#join-card");
      own(`update "User" set "termsVersion" = 2 where email = ${lit(ana.email)}`);
      await open(ana, `/app/find/${t}`, "#join-card");
      await pause(ana, 600);
      await shot(ana, "b20-21-join-current", "§21 On the current version | No tick: just Join this test.", "#join-card");
    }
  }, { section: B20, fake: true });

  group("b20p23", async () => {
    // §21 the updated-Terms tick above the button (Post and Join); §23 "Worked with you on N tests".
    const nora = await b20acct(`dev+media${TS}b2023pa@playtest.test`, "Nora Lane", "developer", "she");
    await b20R(subscribeDev, nora);
    const ana = await b20acct(`tester+media${TS}b2023pb@playtest.test`, "Ana Silva", "tester", "she");
    // §23 Ana's parts on Nora's tests: in it now, left, finished (rated), ended (End early); then Nora invites for a new test.
    {
      const tNow = await b20R(postTest, nora, { productName: "Harbor Run", title: "Harbor Run: lighthouse", spots: "4" });
      const tLeft = await b20R(postTest, nora, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"], spots: "4" });
      const tDone = await b20R(postTest, nora, { productName: "Kelp Forest", title: "Kelp Forest: iPhone beta", spots: "4" });
      const tEnd = await b20R(postTest, nora, { productName: "Night Market", title: "Night Market demo", spots: "4" });
      await b20R(join, ana, tNow);
      const sL = await b20R(join, ana, tLeft);
      await b20ok(ana, `/api/sessions/${sL}/leave`, { ...go }, "leave");
      const sD = await b20R(join, ana, tDone);
      await b20R(sendWritten, ana, sD);
      await b20R(apiPay, nora, subOf(sD), "10.00");
      await b20R(rateDev, ana, sD, 5, "Clear steps and quick pay.");
      const sE = await b20R(join, ana, tEnd);
      await b20ok(nora, `/api/tests/${tEnd}/end-early`, { ...go, contractIds: [sE], reason: "We have what we need for this build: thank you!" }, "end early");
      const tNew = await b20R(postTest, nora, { productName: "Pocket Chef", title: "Pocket Chef: recipe search", categories: ["Productivity"], spots: "4", joinMode: "invite" });
      await nora.goto(`/app/tests/${tNew}`);
      await nora.waitForSelector(`[data-invite-row="${ana.uid}"]`, { state: "attached", timeout: 60000 });
      await unfold(nora, `[data-invite-row="${ana.uid}"]`);
      await pause(nora, 800);
      const row = nora.locator(`[data-invite-row="${ana.uid}"]`, { has: nora.locator("summary", { hasText: /Worked with you on/ }) }).first();
      await row.waitFor({ state: "visible", timeout: 45000 });
      await row.scrollIntoViewIfNeeded();
      const sum = row.locator("summary", { hasText: /Worked with you on/ });
      await sum.click();
      await pause(nora, 1000);
      const states = await row.locator("[data-together-state]").allInnerTexts();
      console.log("   §23 together:", states.join(" | "));
      await shot(nora, "b20-23-worked-with", `§23 Worked with you on 4 tests | In the invite panel's People you've worked with, Ana's fold now says how each one went: ${states.map((s) => `“${s}”`).join(", ")}.`, row);
    }
  }, { section: B20, fake: true });


  group("b20q24a", async () => {
    // §24 a tester's rating updates the developer's page live; §25 a tester's Switch never stops the developer; §27 5-character reasons.
    const nora = await b20acct(`dev+media${TS}b2024aqa@playtest.test`, "Nora Lane", "developer", "she");
    await b20R(subscribeDev, nora);
    const ana = await b20acct(`tester+media${TS}b2024aqb@playtest.test`, "Ana Silva", "tester", "she");
    const ben = await b20acct(`tester+media${TS}b2024aqc@playtest.test`, "Ben Okafor", "tester", "he");
    const cam = await b20acct(`tester+media${TS}b2024aqd@playtest.test`, "Cam Lee", "tester", "they");
    // §24 (a) An ended tester (Cam, ended early, paid) rates while Nora's page is open: the live line, Needs you's Rate row; Nora's next press goes straight through.
    {
      const t = await b20R(postTest, nora, { title: "Harbor Run: reef", spots: "4" });
      const sC = await b20R(join, cam, t), sB = await b20R(join, ben, t);
      await b20R(sendWritten, cam, sC);
      await b20R(apiPay, nora, subOf(sC), "10.00");
      await b20ok(nora, `/api/tests/${t}/end-early`, { ...go, contractIds: [sC], reason: "We have what we need for this build: thank you!" }, "end early");
      await b20R(sendWritten, ben, sB);
      const subB = subOf(sB);
      const D = await b20rec(V, nora);
      await open(D, `/app/tests/${t}`, `#piece-${subB}`);
      const from = at(D);
      await b20mark(D);
      await pause(D, 1500);
      await b20R(rateDev, cam, sC, 5, "Clear steps and quick pay.");
      await waitLive(D, "[data-live-top]:has-text('rated you')", 150000);
      const live24 = await waitPoll(D, "[data-rate-need]", false, 120000);
      if (!live24) console.log("   ! §24: Needs you's Rate row didn't come with the poll");
      await pause(D, 2000);
      const reloaded = !(await b20marked(D));
      console.log("   §24 reloaded?", reloaded);
      await shot(D, "b20-24-live-line", `§24 An ended tester's rating, live | Cam's work had ended early; Cam rated Nora while the page was open: the live box says “${(await D.locator("[data-live-top]").first().innerText().catch(() => "")).replace(/\s+/g, " ").replace(/ Dismiss$/, "")}” (info only, ${reloaded ? "after a reload" : "no reload"}).`, "[data-live-top]");
      if (live24) await shot(D, "b20-24-needs-rate", `§24 Needs you | The same poll adds “${await D.locator("[data-rate-need]").first().innerText().catch(() => "")}”, linking to Cam's Rate box.`, D.locator("[data-rate-need]").first());
      await payPiece(D, subB);
      const stopped = await D.waitForSelector("[data-stop-box]", { timeout: 6000 }).then(() => true, () => false);
      await D.waitForSelector("text=/Paid \\$10\\.00/", { timeout: 60000 }).catch(() => {});
      await pause(D, 2000);
      console.log("   §24 ended tester: Pay stopped?", stopped);
      finishVideo([{ file: await saveVideo(D, "b20-24-ended.webm"), from }], "b20-24-ended-video", `§24 An ended tester rates, live | Cam (whose work had ended) rates Nora while the test page is open: the live line and Needs you's “Rate Cam Lee” arrive without a reload, and Nora's next Pay (on Ben's answers) ${stopped ? "stopped once" : "goes straight through"}.`);
    }
  }, { section: B20, fake: true });

  group("b20q24b", async () => {
    // §24 a tester's rating updates the developer's page live; §25 a tester's Switch never stops the developer; §27 5-character reasons.
    const nora = await b20acct(`dev+media${TS}b2024bqa@playtest.test`, "Nora Lane", "developer", "she");
    await b20R(subscribeDev, nora);
    const ana = await b20acct(`tester+media${TS}b2024bqb@playtest.test`, "Ana Silva", "tester", "she");
    const ben = await b20acct(`tester+media${TS}b2024bqc@playtest.test`, "Ben Okafor", "tester", "he");
    const cam = await b20acct(`tester+media${TS}b2024bqd@playtest.test`, "Cam Lee", "tester", "they");
    // §24 (b) A WORKING tester (Ana, paid) rates just before Nora presses Pay on a page that hasn't refreshed: Pay stops once under "Testers leaving".
    {
      const t = await b20R(postTest, nora, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"], spots: "4" });
      const sA = await b20R(join, ana, t), sB = await b20R(join, ben, t);
      await b20R(sendWritten, ana, sA);
      await b20R(apiPay, nora, subOf(sA), "10.00");
      await b20R(sendWritten, ben, sB);
      const subB = subOf(sB);
      const D = await b20rec(V, nora);
      await open(D, `/app/tests/${t}`, `#piece-${subB}`);
      await waitPulse(D);
      const from = at(D);
      await pause(D, 1200);
      await b20R(rateDev, ana, sA, 5, "Clear steps and quick pay.");
      await payPiece(D, subB);
      const stopped = await D.waitForSelector("[data-stop-box]", { timeout: 45000 }).then(() => true, () => false);
      await pause(D, 2000);
      if (stopped) await shot(D, "b20-24-stop", `§24 A working tester's rating stops a press once | Ana was still working when they rated, which ends their part: Nora's Pay on Ben's answers, pressed on a page opened before it, stops once with “${(await D.locator("[data-stop-box]").first().innerText()).replace(/\s+/g, " ").replace(/ You can turn these stops off.*$/, "")}”`, D.locator("[data-stop-box]").first());
      else console.log("   ! §24: the working tester's rating didn't stop Pay");
      await payPiece(D, subB);
      await D.waitForSelector("text=/Paid \\$10\\.00/", { timeout: 60000 }).catch(() => {});
      await pause(D, 2000);
      finishVideo([{ file: await saveVideo(D, "b20-24-working.webm"), from }], "b20-24-working-video", `§24 A working tester rates | Ana rates Nora just before Nora presses Pay on Ben's answers: ${stopped ? "the press stops once for “Ana Silva finished their part (rated you)” (Testers leaving), and the second press pays" : "the press goes straight through"}.`);
    }
  }, { section: B20, fake: true });

  group("b20q25", async () => {
    // §24 a tester's rating updates the developer's page live; §25 a tester's Switch never stops the developer; §27 5-character reasons.
    const nora = await b20acct(`dev+media${TS}b2025qa@playtest.test`, "Nora Lane", "developer", "she");
    await b20R(subscribeDev, nora);
    const ana = await b20acct(`tester+media${TS}b2025qb@playtest.test`, "Ana Silva", "tester", "she");
    const ben = await b20acct(`tester+media${TS}b2025qc@playtest.test`, "Ben Okafor", "tester", "he");
    const cam = await b20acct(`tester+media${TS}b2025qd@playtest.test`, "Cam Lee", "tester", "they");
    // §25 Nora changes the price; Ben switches to the new terms while Nora's page is open: a quiet line, and Nora's press goes straight through.
    {
      const t = await b20R(postTest, nora, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"], spots: "4" });
      const sA = await b20R(join, ana, t), sB = await b20R(join, ben, t);
      await b20R(sendWritten, ana, sA);
      const subA = subOf(sA);
      await b20R(apiEdit, nora, t, { writtenCents: "12.00" });
      const offerOf = (s) => sql(`select id from "TermsOffer" where "contractId" = '${s}' and status = 'open' order by "createdAt" desc limit 1`);
      const D = await b20rec(V, nora);
      await open(D, `/app/tests/${t}`, `#piece-${subA}`);
      const from = at(D);
      await pause(D, 1500);
      // A second tab of Nora's, left alone, shows the live line.
      const L = await b20same(nora);
      await open(L, `/app/tests/${t}`, `#piece-${subA}`);
      await waitPulse(D);
      await pause(D, 800);
      await b20ok(ben, `/api/sessions/${sB}/terms`, { ...go, choice: "switch", offerId: offerOf(sB) }, "switch");
      // Pressed at once, from a page that hasn't refreshed since Ben's Switch.
      await payPiece(D, subA);
      const stopped = await D.waitForSelector("[data-stop-box]", { timeout: 6000 }).then(() => true, () => false);
      console.log("   §25 Pay stopped:", stopped);
      await waitPoll(D, "text=/Paid in all/", false, 30000);
      await pause(D, 1500);
      await shotSpan(D, "b20-25-paid", `§25 No stop | Ben switched a moment before Nora pressed Pay on Ana's answers from a page that hadn't refreshed: the Pay ${stopped ? "STOPPED (a bug)" : "went straight through (“paid $10.00 of $10.00”)"}, since a tester's Switch or Keep never stops a developer press.`, D.locator("text=/paid \\$10\\.00 of \\$10\\.00/").first(), D.locator("text=/Paid in all/").first());
      await waitLive(L, "[data-live-top]:has-text('switched')", 150000);
      await pause(L, 1500);
      await shot(L, "b20-25-quiet-line", "§25 Switch is a quiet line | In another tab of Nora's left open, the only sign of it: the live box's line “Ben Okafor switched to the new terms” with “See their contract”.", "[data-live-top]");
      await L.context().close();
      finishVideo([{ file: await saveVideo(D, "b20-25.webm"), from }], "b20-25-video", "§25 A tester's Switch never stops the developer | Ben switches to the new terms while Nora's page is open and Nora presses Pay at once: the Pay goes straight through (the only sign of the Switch is a quiet live line, shown in another tab).");
    }
  }, { section: B20, fake: true });

  group("b20q27", async () => {
    // §24 a tester's rating updates the developer's page live; §25 a tester's Switch never stops the developer; §27 5-character reasons.
    const nora = await b20acct(`dev+media${TS}b2027qa@playtest.test`, "Nora Lane", "developer", "she");
    await b20R(subscribeDev, nora);
    const ana = await b20acct(`tester+media${TS}b2027qb@playtest.test`, "Ana Silva", "tester", "she");
    const ben = await b20acct(`tester+media${TS}b2027qc@playtest.test`, "Ben Okafor", "tester", "he");
    const cam = await b20acct(`tester+media${TS}b2027qd@playtest.test`, "Cam Lee", "tester", "they");
    // §27 End early's and Stop's reason: at least 5 characters.
    {
      const t = await b20R(postTest, nora, { productName: "Kelp Forest", title: "Kelp Forest: iPhone beta", spots: "4" });
      await b20R(join, ana, t);
      const D = await b20rec(V, nora);
      await open(D, `/app/tests/${t}`, "button:has-text('End early')");
      const from = at(D);
      await pause(D, 1200);
      await D.click("button:has-text('End early')");
      await D.locator("[data-end-early] fieldset input").first().check();
      await D.locator("#reason").click();
      await D.keyboard.type("Done", { delay: 200 });
      await D.locator("[data-end-early] fieldset input").first().focus();
      await pause(D, 1500);
      const endBox = D.locator("[data-end-early]");
      await shot(D, "b20-27-end-4", "§27 Four characters | End early's “Why?” with “Done” (4 characters): red “Say a little more: at least 5 characters.” on leaving the box, and End their work now stays disabled.", endBox);
      await D.locator("#reason").click();
      await D.keyboard.type("!", { delay: 200 });
      await pause(D, 1200);
      await shot(D, "b20-27-end-5", "§27 Five characters | “Done!” (5 characters): the red line goes and the button is enabled.", endBox);
      await D.keyboard.press("Escape").catch(() => {});
      await D.click("button:has-text('Stop the test')");
      const dlg = D.locator("dialog[open]");
      await dlg.waitFor();
      await dlg.locator("#stop-reason").click();
      await D.keyboard.type("Done", { delay: 200 });
      await dlg.locator("h2, p").first().click().catch(() => {});
      await pause(D, 1500);
      await shot(D, "b20-27-stop-4", "§27 The same for Stop the test | Stop's “Are you sure…?” pop-up, its required “Why? (testers read it)” with “Done”: red “Say a little more: at least 5 characters.”", dlg);
      await dlg.locator("button", { hasText: "Cancel" }).click().catch(() => D.keyboard.press("Escape"));
      await pause(D, 1200);
      finishVideo([{ file: await saveVideo(D, "b20-27.webm"), from }], "b20-27-video", "§27 At least 5 characters | End early with “Done” is red and disabled; one more character enables it; Stop the test's reason follows the same rule.");
    }
  }, { section: B20, fake: true });

}


// ---------- Batch 21 (owner, Oct 28): the built-in call room, and batch 22 (Oct 29) (the report's "Batch 21 (Oct 29)" and "Batch 22 (Oct 29)" sections) ----------
{
  const B21 = "Batch 21 (Oct 29)", B22 = "Batch 22 (Oct 29)";
  /** A booked call (booked `hoursAhead` hours ahead through the usual request), moved to have started `agoMin` minutes ago: the room is open. */
  const callNow = async (dev, tester, t, s, hoursAhead, minutes, agoMin) => {
    const c = await bookCall(dev, tester, t, s, hoursAhead, minutes);
    own(`update "Call" set "startsAt" = ${utcNow} - interval '${agoMin} minutes' where id = '${c}'`);
    return c;
  };
  /** Both connected for `mins` more minutes (the recording skips ahead: each side's connected stretch starts earlier). */
  const connectedLonger = (call, mins) => sql(`update "CallPresence" set "startAt" = "startAt" - interval '${mins} minutes' where "callId" = '${call}'`);
  /** Waits until this call page says "Connected" (both browsers connected, WebRTC). */
  const connected = (P, ms = 45000) => P.waitForFunction(() => /^Connected/.test(document.querySelector("[data-call-status]")?.textContent || ""), null, { timeout: ms }).then(() => true, () => false);
  /**
   * The tester's call page runs in a second browser: Chrome's fake camera opens in one context per browser only (a second context gets "Requested device not found",
   * and the room then shows "No camera"). Closed at the end of each group.
   */
  const extra = {};
  // (Chrome hides each browser's own address behind a random ".local" name; two separate browsers on this machine can't resolve each other's, so they never connect
  // directly, which is exactly the strict-network case. The recordings turn that off, except in the strict-network case itself.)
  let mdns = false;
  const second = async (fn, k = "tester") => {
    extra[k] ??= await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", ...(mdns ? [] : ["--disable-features=WebRtcHideLocalIpsWithMdns"])] });
    const saved = browser;
    browser = extra[k];
    try { return await fn(); } finally { browser = saved; }
  };
  const closeSecond = async () => { for (const k of Object.keys(extra)) { await extra[k].close().catch(() => {}); delete extra[k]; } };
  /** A call-page picture: never from a fresh page (that page would join the room and restart the connection), so a tall one is taken in strips. */
  const cshot = (P, name, caption, target) => shot(P, name, caption, target, async () => {});
  const btn = (P, label) => P.locator("[data-call-room] button", { hasText: new RegExp("^\\s*" + label + "$") });
  /**
   * (The media server is shared with the other recordings tonight and sometimes drops a request under load: "read ECONNRESET" or a 500.) A group that fails that
   * way is run again from the start, with fresh accounts (R is part of every email), up to 3 times. The extra browsers always close, so the run can end.
   */
  let R = "";
  const flaky = (e) => /ECONNRESET|ECONNREFUSED|socket hang up|Something went wrong on our side|Timeout \d+ms exceeded|timed out after|net::ERR/.test(String(e && (e.stack || e)));
  /** (The media server answers slowly tonight: every page these groups open waits longer than the harness's usual 15 / 45 seconds.) */
  // (only while these groups run: the longer waits are taken off again after each one)
  const bePatient = async () => {
    const tmp = await browser.newContext();
    const proto = Object.getPrototypeOf(tmp);
    await tmp.close();
    const [t0, n0] = [proto.setDefaultTimeout, proto.setDefaultNavigationTimeout];
    proto.setDefaultTimeout = function (ms) { return t0.call(this, Math.max(ms, 60000)); };
    proto.setDefaultNavigationTimeout = function (ms) { return n0.call(this, Math.max(ms, 150000)); };
    return () => { proto.setDefaultTimeout = t0; proto.setDefaultNavigationTimeout = n0; };
  };
  const rgroup = (id, fn, opts) => group(id, async () => {
    const unPatient = await bePatient();
    try { for (let n = 0; ; n++) {
      R = n ? "r" + n : "";
      const g0 = GROUP;
      if (n) GROUP = id + R;
      try { await fn(); return; } catch (e) {
        if (n >= 2 || !flaky(e)) throw e;
        console.log(`   (try ${n + 1} failed: ${String(e.message || e).split("\n")[0].slice(0, 160)}; again with fresh accounts)`);
        for (const c of browser.contexts()) await c.close().catch(() => {});
        adminP = null;
        await new Promise((r) => setTimeout(r, 20000));
      } finally { await closeSecond(); GROUP = g0; }
    } } finally { unPatient(); }
  }, opts);
  const cgroup = rgroup;
  /** Both call pages in the room and connected; returns the recorded pages and where their useful part starts. */
  const room = async (dev, tester, call) => {
    // (both in one browser of their own: two separate browsers on this busy machine rarely connect)
    const D = await second(() => rec(V, dev), "call"), T = await second(() => rec(V, tester), "call");
    for (const P of [D, T]) await P.context().grantPermissions(["camera", "microphone"]).catch(() => {});
    // The developer comes into the room first and waits; then the tester comes (two arrivals at the same moment, on the slow server, keep restarting each other's connection).
    await D.goto(`/app/calls/${call}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await D.waitForFunction(() => /^Waiting for/.test(document.querySelector("[data-call-status]")?.textContent || ""), null, { timeout: 150000 }).catch(() => console.log("   ! the developer's room didn't reach Waiting"));
    await pause(D, 3000);
    await T.goto(`/app/calls/${call}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    for (const P of [D, T]) if (!(await P.waitForSelector("[data-call-room], [data-call-line]", { timeout: 120000 }).then(() => true, () => false))) { await P.reload({ waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => {}); await P.waitForSelector("[data-call-room], [data-call-line]", { timeout: 120000 }); }
    await bothConnected(D, T, 120000);
    // (the video starts here, a few seconds before both are connected for good: the minutes the busy machine took to start them are left out)
    const fromD = Math.max(0, at(D) - 4), fromT = Math.max(0, at(T) - 4);
    return { D, T, fromD, fromT };
  };
  /** Waits (up to `ms`) until both pages say "Connected" (the busy media server can take a while); logs the states. */
  const bothConnected = async (D, T, ms = 60000) => {
    const end = Date.now() + ms;
    let st = [];
    while (Date.now() < end) {
      st = [await D.locator("[data-call-status]").innerText().catch(() => "?"), await T.locator("[data-call-status]").innerText().catch(() => "?")];
      if (st.every((x) => /^Connected/.test(x))) return true;
      await pause(D, 2000);
    }
    console.log("   ! call room: not both connected:", st.join(" / "));
    return false;
  };
  /** What each tile shows: the note over a tile without a picture ("No camera", "Camera off", …) or "" when a picture shows. */
  const tiles = (P) => P.evaluate(() => {
    const t = [...document.querySelectorAll("[data-call-room] .relative.overflow-hidden")];
    const note = (el) => (el ? (el.querySelector(".absolute.inset-0 span:last-child")?.textContent || "") : "?");
    return { other: note(t[0]), mine: note(t[1]), status: (document.querySelector("[data-call-status]")?.textContent || "").split(" · ")[0] };
  });
  const tileText = (n) => (n ? `shows the initial with “${n}”` : "shows the camera picture (Chrome's test pattern)");
  const both = (D, T, sel, ms = 40000) => Promise.all([D.waitForSelector(sel, { timeout: ms }), T.waitForSelector(sel, { timeout: ms })]).then(() => true, () => false);
  const lineOf = (P) => P.locator("[data-call-line]").first().innerText().catch(() => "");

  cgroup("b21a", async () => {
    // §1 Connecting, mute, camera off, screen share; §2 the 2-minute warning and the end at 150%; the room refused afterwards and to anyone else; the camera check.
    const nora = await account(`dev+media${TS}${R}u1@playtest.test`, "Nora Lane", "developer", "they");
    await subscribeDev(nora);
    const ana = await account(`tester+media${TS}${R}u1a@playtest.test`, "Ana Silva", "tester", "they");
    const ben = await account(`tester+media${TS}${R}u1b@playtest.test`, "Ben Okafor", "tester", "they");
    const t = await postTest(nora, { title: "Harbor Run: live", liveRateCents: "30.00", spots: "4" });
    const sA = await join(ana, t);
    await join(ben, t);
    const call = await callNow(nora, ana, t, sA, 30, 10, 1);
    const { D, T, fromD, fromT } = await room(nora, ana, call);
    await pause(D, 2500);
    let d0 = await tiles(D), t0 = await tiles(T);
    console.log("   tiles:", JSON.stringify(d0), JSON.stringify(t0));
    const noCam = d0.mine === "No camera" || t0.mine === "No camera" ? " (the test browsers' fake camera gives a black picture here: Nora's own tile is black and Ana's tile shows “No camera”; sound and screen share still go through)" : "";
    await cshot(D, "b21-01-connected-dev", `§1 Connected | Nora's call page: “Call with Ana Silva”, Ana's large tile and Nora's own small one (“You”), “${d0.status} · measured so far: …”, with Mute, Camera off, Share screen and Leave${noCam}.`, "main");
    await cshot(T, "b21-01-connected-tester", `§1 The tester's side | Ana's page: “Call with Nora Lane”, Nora's tile large and their own small, and “${t0.status}”.`, "main");
    // Mute (Nora) and camera off (Ana): each side sees the other's state.
    await btn(D, "Mute").click();
    await btn(T, "Camera off").click();
    await pause(D, 3000);
    await bothConnected(D, T, 30000);
    d0 = await tiles(D); t0 = await tiles(T);
    await cshot(D, "b21-01-muted-camera-off-dev", `§1 Mute and camera off | Nora pressed Mute: the button reads Unmute and their own “You” tag carries the crossed microphone; Ana pressed Camera off, and Ana's tile on Nora's page ${tileText(d0.other)}.`, "main");
    await cshot(T, "b21-01-muted-camera-off-tester", `§1 What Ana sees | Nora's name tag carries the crossed microphone (muted); Ana's button now reads Camera on and their own tile ${tileText(t0.mine)}.`, "main");
    await btn(D, "Unmute").click();
    await btn(T, "Camera on").click();
    await pause(D, 2000);
    // Screen share (the browser's own picker is answered by the test browser's fake screen, if it has one).
    await btn(D, "Share screen").click();
    const shared = await D.waitForSelector("text=You're sharing your screen", { timeout: 8000 }).then(() => true, () => false);
    await pause(D, 3000);
    if (shared) {
      await bothConnected(D, T, 30000);
      await pause(T, 2000);
      await cshot(D, "b21-01-share-dev", "§1 Share screen | Nora shares their screen (the test browser's fake screen, a green test pattern): their own tile shows it with “You're sharing your screen”.", "main");
      await cshot(T, "b21-01-share-tester", "§1 Ana sees the shared screen | Nora's large tile is the shared screen, marked “Sharing their screen”.", "main");
    } else console.log("   ! §1 screen share: the headless browser gave no screen to share (nothing changed on the page)");
    // §2 The 2-minute warning: the call (10 minutes booked, paid up to 15) has been connected for 13½ minutes.
    connectedLonger(call, 13.5);
    const warned = await both(D, T, "[data-call-warn]", 20000);
    if (!warned) console.log("   ! §2 no warning");
    await pause(D, 2500);
    const wl = await D.locator("[data-call-warn]").innerText().catch(() => "This call ends at <time>.");
    await cshot(D, "b21-02-warning-dev", `§2 Two minutes before the end | The call was booked for 10 minutes (paid up to 15) and both have been connected about 13 (the recording skips ahead): the room says “${wl}” above the pictures.`, "main");
    await cshot(T, "b21-02-warning-tester", `§2 The same warning for Ana | “${await T.locator("[data-call-warn]").innerText().catch(() => wl)}”`, "[data-call-warn]");
    // The end at 150%: the recording skips the last 2 minutes.
    connectedLonger(call, 2);
    const endedOk = await both(D, T, "[data-call-line]", 30000);
    await pause(D, 2500);
    console.log(`   §2 150%: dev “${await lineOf(D)}” / tester “${await lineOf(T)}”, measured ${sql(`select "measuredMinutes" from "Call" where id = '${call}'`)} min`);
    if (endedOk) {
      await cshot(D, "b21-02-ended-length-dev", "§2 Ended at 150% | Both pages hang up at once and the room is replaced by “Call ended: it reached 150% of the booked time.”", "main");
      await cshot(T, "b21-02-ended-length-tester", "§2 The same on Ana's page | “Call ended: it reached 150% of the booked time.”", "main");
    }
    finishVideo([{ file: await saveVideo(D, "b21-01-d.webm"), from: fromD }, { file: await saveVideo(T, "b21-01-t.webm"), from: fromT }], "b21-01-video",
      "§1 and §2 A call in the app | Nora (left) and Ana (right) are connected; Nora mutes and Ana presses Camera off and on again, Nora shares their screen, then the warning “This call ends at <time>.” shows and both pages end the call at 150% of the booked time (the clock is moved on for the recording).");
    // Rejoin refused: the page opened again, and the room's own poll.
    await open(ana, `/app/calls/${call}`, "[data-call-line]");
    const poll = await ana.context().request.get(`${BASE}/api/calls/${call}/room?after=0&connected=0`, { timeout: 90000 });
    const pb = await poll.json().catch(() => ({}));
    console.log(`   rejoin poll: ${poll.status()} ${JSON.stringify(pb).slice(0, 200)}`);
    await shot(ana, "b21-02-rejoin-refused", `§2 No rejoining | Ana opens the call page again: only “Call ended: it reached 150% of the booked time.”, no room; the room itself answers ${poll.status()} “This call isn't available.” to their browser.`, "main");
    // Someone who isn't one of the call's two people.
    await open(ben, `/app/calls/${call}`, "[data-call-line]");
    await shot(ben, "b21-01-not-yours", "§1 Not your call | Ben (another tester on the same test) opens the call's address: “This call isn't available.”", "main");
    // The camera and microphone check, on a call that isn't open yet.
    const later = await bookCall(nora, ana, t, sA, 50, 30);
    await open(ana, `/app/calls/${later}`, "[data-call-join-later]");
    await ana.locator("[data-call-check] button").first().click();
    await ana.waitForSelector("[data-call-check-panel]");
    await pause(ana, 3000);
    await shot(ana, "b21-01-check-panel", "§1 Check your call setup | Before the room opens (“You can join from <time>.”), the in-app check “Check your call setup · Preview your camera and microphone before the call. Nothing is sent or recorded.” shows the camera preview (black with the test browser's fake camera) and the microphone level, with Done; no call is made and nothing is measured.", "main");
    const n = sql(`select count(*) from "CallPresence" where "callId" = '${later}'`);
    console.log(`   check panel: presences on the later call ${n}`);
    await closeSecond();
  }, { section: B21, fake: true });

  /** A tester's words that must never name the developer's account state. */
  const leaky = (text) => /hold|suspend|fail|chargeback/i.test(text);
  /**
   * One server-side end: a call in progress (both connected, both pages recording side by side), then `trigger` closes it; both pages must hang up with
   * "Call ended: …", and the room refuses a rejoin.
   */
  const endCase = async ({ key, title, dev, tester, t, s, hours, minutes = 30, trigger, warnFirst = 0 }) => {
    const call = await callNow(dev, tester, t, s, hours, minutes, 2);
    const { D, T, fromD, fromT } = await room(dev, tester, call);
    await pause(D, 3000);
    if (warnFirst) {
      // (the recording skips ahead to 2 minutes before the planned end, then to the end)
      connectedLonger(call, warnFirst);
      if (await both(D, T, "[data-call-warn]", 25000)) {
        await pause(D, 2000);
        await cshot(D, `b21-02-${key}-warning`, `§2 ${title}: the warning | Two minutes before the planned end the room says “${await D.locator("[data-call-warn]").innerText()}” (the recording skips ahead to it).`, "main");
      } else console.log(`   ! ${key}: no warning`);
      connectedLonger(call, 2.5);
    } else await trigger(call, D, T);
    const tLine = await T.waitForSelector("[data-call-line]", { timeout: 45000 }).then(() => true, () => false);
    const dLine = await D.waitForSelector("[data-call-line]", { timeout: 15000 }).then(() => true, () => false);
    await pause(D, 2500);
    const ld = dLine ? await lineOf(D) : `(no line; the page is at ${new URL(D.url()).pathname})`, lt = tLine ? await lineOf(T) : "(no line)";
    const measured = sql(`select coalesce("measuredMinutes"::text, '-') || ' min, ended ' || coalesce("endReason", '') from "Call" where id = '${call}'`);
    console.log(`   §2 ${key}: developer “${ld}” / tester “${lt}” · ${measured}`);
    if (leaky(lt)) console.log(`   ! BUG ${key}: the tester's line names the account state: “${lt}”`);
    if (dLine) await cshot(D, `b21-02-${key}-dev`, `§2 ${title} (developer) | The developer's call page hangs up at that moment: “${ld}”.`, "main");
    else await shot(D, `b21-02-${key}-dev`, `§2 ${title} (developer) | The developer's call page moved away at that moment, to ${new URL(D.url()).pathname}.`);
    if (tLine) await cshot(T, `b21-02-${key}-tester`, `§2 ${title} (tester) | At the same moment the tester's page reads “${lt}”.`, "main");
    finishVideo([{ file: await saveVideo(D, `b21-02-${key}-d.webm`), from: fromD }, { file: await saveVideo(T, `b21-02-${key}-t.webm`), from: fromT }], `b21-02-${key}-video`,
      `§2 ${title} | The developer (left) and the tester (right) are connected; ${warnFirst ? "the warning shows, then" : "then"} the server ends the call and both pages hang up at once (developer: “${ld}”; tester: “${lt}”).`);
    // No rejoin: the room's own answer to the tester's browser.
    const r = await tester.context().request.get(`${BASE}/api/calls/${call}/room?after=0&connected=0`, { timeout: 90000 });
    const b = await r.json().catch(() => ({}));
    console.log(`   ${key} rejoin: ${r.status()} ${JSON.stringify(b).slice(0, 160)}`);
    return { call, ld, lt, measured };
  };

  cgroup("b21b", async () => {
    // §2 Each end the server makes: the $1,000, a block, a pause, a suspension (developer and tester side), a leave, End early and Stop.
    const nora = await account(`dev+media${TS}${R}u2@playtest.test`, "Nora Lane", "developer", "they");
    await subscribeDev(nora);
    const omar = await account(`dev+media${TS}${R}u2o@playtest.test`, "Omar Reyes", "developer", "they");
    await subscribeDev(omar);
    const admin = await adminAccount();
    const tester = async (k, name) => account(`tester+media${TS}${R}u2${k}@playtest.test`, name, "tester", "they");
    const [ana, ben, cam, dee, eli, fay, gus, hana] = [await tester("a", "Ana Silva"), await tester("b", "Ben Okafor"), await tester("c", "Cam Lee"), await tester("d", "Dee Park"), await tester("e", "Eli Novak"), await tester("f", "Fay Mendes"), await tester("g", "Gus Hale"), await tester("h", "Hana Ito")];
    const t1 = await postTest(nora, { title: "Harbor Run: live", liveRateCents: "150.00", spots: "8" });
    const t2 = await postTest(nora, { productName: "Sky Lab", title: "Sky Lab: live", categories: ["Education"], liveRateCents: "30.00", spots: "4" });
    const t3 = await postTest(nora, { productName: "Kelp Forest", title: "Kelp Forest: live", liveRateCents: "30.00", spots: "4" });
    const t4 = await postTest(omar, { productName: "Tide Tracker", title: "Tide Tracker: live", categories: ["Productivity"], liveRateCents: "30.00", spots: "4" });
    const sA = await join(ana, t1), sB = await join(ben, t1), sC = await join(cam, t1), sD = await join(dee, t1), sH = await join(hana, t1);
    const sE = await join(eli, t2), sF = await join(fay, t3), sG = await join(gus, t4);
    // The $1,000: Ana's two long calls leave $100, so this call can be booked for at most 40 minutes (at $150/h); 150% would be 60, but it ends at 40.
    await bookCall(nora, ana, t1, sA, 100, 180);
    const a2 = await bookCall(nora, ana, t1, sA, 124, 150);
    own(`update "Call" set minutes = 180 where id = '${a2}'`);
    await endCase({ key: "cap", title: "Ended at the $1,000", dev: nora, tester: ana, t: t1, s: sA, hours: 148, minutes: 40, warnFirst: 37.5 });
    await endCase({ key: "block", title: "Ended by a block", dev: nora, tester: ben, t: t1, s: sB, hours: 30, trigger: async () => ok(await post(ben, "/api/blocks", { userId: nora.uid }), "block") });
    await endCase({ key: "leave", title: "Ended by the tester leaving", dev: nora, tester: cam, t: t1, s: sC, hours: 32, trigger: async () => ok(await post(cam, `/api/sessions/${sC}/leave`, { ...go, reason: "Something came up this week." }), "leave") });
    await endCase({ key: "end-early", title: "Ended by End early", dev: nora, tester: dee, t: t1, s: sD, hours: 34, trigger: async () => ok(await post(nora, `/api/tests/${t1}/end-early`, { ...go, contractIds: [sD], reason: "We have enough answers for this round." }), "end early") });
    await endCase({ key: "suspended-tester", title: "Ended by the tester's suspension", dev: nora, tester: hana, t: t1, s: sH, hours: 36, trigger: async () => adminDo(admin, "suspend", hana.uid, { note: "Media pass check: copied answers", side: "tester" }) });
    await endCase({ key: "pause", title: "Ended by the team's pause", dev: nora, tester: eli, t: t2, s: sE, hours: 38, trigger: async () => adminDo(admin, "pause-test", t2, { note: "Media pass check: we're looking at a report about the build link." }) });
    await endCase({ key: "stop", title: "Ended by Stop", dev: nora, tester: fay, t: t3, s: sF, hours: 40, trigger: async () => stopTest(nora, t3) });
    await endCase({ key: "suspended-dev", title: "Ended by the developer's suspension", dev: omar, tester: gus, t: t4, s: sG, hours: 42, trigger: async () => adminDo(admin, "suspend", omar.uid, { note: "Media pass check: several testers reported unpaid work", side: "developer" }) });
  }, { section: B21, fake: true });

  cgroup("b21c", async () => {
    // §4 Strict networks: two browsers that can't reach each other directly, and no TURN relay set. (Here: two separate browsers on one machine with Chrome's
    // ".local" address hiding on, which they can't resolve for each other.)
    const nora = await account(`dev+media${TS}${R}u3@playtest.test`, "Nora Lane", "developer", "they");
    await subscribeDev(nora);
    const ana = await account(`tester+media${TS}${R}u3a@playtest.test`, "Ana Silva", "tester", "they");
    const t = await postTest(nora, { title: "Harbor Run: live", liveRateCents: "30.00", spots: "4" });
    const sA = await join(ana, t);
    const call = await callNow(nora, ana, t, sA, 30, 30, 1);
    mdns = true;
    try {
      const D = await second(() => rec(V, nora), "developer"), T = await second(() => rec(V, ana));
      await Promise.all([D.goto(`/app/calls/${call}`, { waitUntil: "domcontentloaded", timeout: 90000 }), T.goto(`/app/calls/${call}`, { waitUntil: "domcontentloaded", timeout: 90000 })]);
      const fromD = at(D), fromT = at(T);
      const strict = (P) => P.waitForFunction(() => /^Couldn't connect directly/.test(document.querySelector("[data-call-status]")?.textContent || ""), null, { timeout: 150000 }).then(() => true, () => false);
      const [sd, st] = await Promise.all([strict(D), strict(T)]);
      await pause(D, 2000);
      const ld = await D.locator("[data-call-status]").innerText(), lt = await T.locator("[data-call-status]").innerText();
      console.log(`   §4 strict: developer “${ld}” / tester “${lt}”`);
      if (sd) await cshot(D, "b21-04-strict-dev", `§4 A strict network | The two browsers couldn't reach each other directly and no TURN relay is set: “${ld.split(" · ")[0]}” (nothing is measured: “measured so far: 0 min”).`, "main");
      if (st) await cshot(T, "b21-04-strict-tester", `§4 The same on the tester's side | “${lt.split(" · ")[0]}”`, "main");
      if (!sd && !st) await cshot(D, "b21-04-strict-dev", `§4 A strict network | The two browsers couldn't connect; the room reads “${ld}”.`, "main");
      finishVideo([{ file: await saveVideo(D, "b21-04-d.webm"), from: fromD }, { file: await saveVideo(T, "b21-04-t.webm"), from: fromT }], "b21-04-video",
        "§4 Couldn't connect directly | Nora (left) and Ana (right) open the room, the browsers try to connect, fail, and the room says so; nothing is measured.");
      console.log(`   §4 measured presences: ${sql(`select count(*) from "CallPresence" where "callId" = '${call}'`)}`);
    } finally { mdns = false; }
  }, { section: B21, fake: true, optIn: true }); // (Oct 29: opt-in. On one machine the two test browsers still reached each other, so the room connected and the strict-network line never showed; the files it made were dropped.)

  // ---------- Batch 22 ----------
  rgroup("b22a", async () => {
    // §1 A payment hold retries on its own; once it turns into a chargeback hold nothing retries (no "next try" line, the daily job charges nothing).
    const nora = await account(`dev+media${TS}${R}v1@playtest.test`, "Nora Lane", "developer", "they");
    await subscribeDev(nora);
    const ana = await account(`tester+media${TS}${R}v1a@playtest.test`, "Ana Silva", "tester", "they");
    const ben = await account(`tester+media${TS}${R}v1b@playtest.test`, "Ben Okafor", "tester", "they");
    setCard(nora.email, "pm_card_visa");
    const t = await postTest(nora, { title: "Harbor Run: first 3 levels", writtenCents: "12.00" });
    const sA = await join(ana, t), sB = await join(ben, t);
    await sendWritten(ana, sA);
    await sendWritten(ben, sB);
    await apiPay(nora, subOf(sA), "12.00");
    // Ben's answers: the card declines, a payment hold starts; the daily retry fails once.
    setCard(nora.email, "pm_card_declined");
    await post(nora, "/api/review", { action: "pay", kind: "submission", id: subOf(sB), amount: "12.00", tickedCents: 1200, payKey: require("crypto").randomUUID(), seenAt: nowIso(), confirmed: true });
    console.log("   payment hold retry:", JSON.stringify(await hook("retry", nora.email)));
    await nora.goto("/app/payments");
    await nora.waitForSelector("#owed");
    const txt1 = await nora.locator("#owed").innerText();
    console.log("   §1 payment hold owed box:", txt1.replace(/\s+/g, " ").slice(0, 300));
    await shot(nora, "b22-01-payment-hold", "§1 A payment hold retries | Nora's card was declined on Ben's answers: during the payment hold Payments shows “Last try: <time> · next try: <the next day>” above what's owed (the daily automatic try, up to 7), with Pay what you owe ($12.00).", "#owed");
    // A chargeback on Ana's payment: the payment hold becomes a chargeback hold. The card works again, yet nothing is retried.
    setCard(nora.email, "pm_card_visa");
    await webhook("charge.dispute.created", { payment_intent: piOf(subOf(sA)), status: "needs_response" });
    const before = sql(`select count(*) from "Payment" where "developerId" = '${nora.uid}' and status = 'charged'`);
    const r = await hook("retry", nora.email);
    const after = sql(`select count(*) from "Payment" where "developerId" = '${nora.uid}' and status = 'charged'`);
    console.log(`   §1 chargeback hold: daily retry → ${JSON.stringify(r)}; charged payments ${before} → ${after}; holdReason ${sql(`select "holdReason" from "User" where id = '${nora.uid}'`)}`);
    await nora.goto("/app/payments");
    await nora.waitForSelector("[data-chargeback-steps]");
    const txt2 = await nora.locator("main").innerText();
    if (/next try/i.test(txt2)) console.log("   ! §1 'next try' still shows during the chargeback hold");
    await shotSpan(nora, "b22-01-chargeback-hold", `§1 A chargeback hold never retries | A chargeback on Ana's earlier payment turns the hold into a chargeback hold: “Your bank reversed a payment, so your account is on a payment hold.”, the three steps (a card verified with 3D Secure, what you owe reserved on your card, the team's approval) and what's owed ($12 + $15 chargeback fee, and Ben's $12.00): there's no “next try” line any more, and the daily job charged nothing (charged payments ${before} before, ${after} after) although the card works again.`, "[data-chargeback-steps]", "#owed");
  }, { section: B22, fake: true });

  rgroup("b22b", async () => {
    // §2 A suspended tester is paid normally (no held share, no admin box); §3 waiting payouts go out on their own when payout setup is done.
    const nora = await account(`dev+media${TS}${R}v2@playtest.test`, "Nora Lane", "developer", "they");
    await subscribeDev(nora);
    setCard(nora.email, "pm_card_visa");
    const cam = await account(`tester+media${TS}${R}v2c@playtest.test`, "Cam Lee", "tester", "they");
    const dee = await account(`tester+media${TS}${R}v2d@playtest.test`, "Dee Park", "tester", "they");
    const admin = await adminAccount();
    own(`update "User" set "stripeAccountId" = 'acct_fake_' || id, "payoutsReady" = true where email = ${lit(cam.email)}`);
    const t = await postTest(nora, { title: "Harbor Run: first 3 levels", writtenCents: "10.00" });
    const sC = await join(cam, t), sD = await join(dee, t);
    await sendWritten(cam, sC);
    await sendWritten(dee, sD);
    // §2 Cam is suspended (tester side) after sending; Nora pays the answers: Cam's 80% goes out as for anyone.
    await adminDo(admin, "suspend", cam.uid, { note: "Media pass check: copied answers", side: "tester" });
    await apiPay(nora, subOf(sC), "10.00");
    const tr = sql(`select "transferStatus" || ' ' || "testerCents" from "Payment" where "submissionId" = '${subOf(sC)}' and status = 'charged'`);
    console.log(`   §2 suspended tester's share: ${tr}`);
    await admin.goto(`/app/testers/${cam.uid}`);
    await admin.waitForSelector("#admin-boxes");
    const box = admin.locator("#admin-boxes [data-box]", { hasText: "Payouts to them" }).first();
    const target = (await box.count()) ? box : admin.locator("#admin-boxes");
    await shot(admin, "b22-02-suspended-paid", `§2 A suspended tester is paid normally | Cam is suspended (“Suspended (tester side)”) and Nora paid their answers afterwards: the team's view of Cam reads “Total paid out $8.00” and Payouts to them “$8.00 from <Nora> (review) · payout sent”; nothing is held (transfer ${tr.split(" ")[0]}).`, target);
    await admin.goto("/admin");
    await admin.waitForSelector("#payouts");
    const heldBox = await admin.locator("text=/Held tester shares/i").count();
    console.log(`   §2 "Held tester shares" on the console: ${heldBox}`);
    // §3 Dee has no payout setup yet: Nora pays, the share waits.
    await apiPay(nora, subOf(sD), "10.00");
    await admin.goto(`/admin?at=${Date.now()}#payouts`);
    const row = admin.locator("[data-waiting-payout]", { hasText: "Dee Park" }).first();
    await row.waitFor({ timeout: 15000 });
    await shotSpan(admin, "b22-03-waiting", "§3 Waiting for payout setup | “Payouts waiting for a payout account” is read-only now: “Each goes out on its own when the tester finishes their payout setup.” and the row “Dee Park · $8.00 · waiting since <time>” (no Send now). There's no “Held tester shares” box any more.", "#payouts", row);
    // Dee finishes Stripe's payout setup: the account.updated webhook sends the waiting share (once, even when the webhook comes twice).
    own(`update "User" set "stripeAccountId" = 'acct_fake_' || id where email = ${lit(dee.email)}`);
    const acct = sql(`select "stripeAccountId" from "User" where id = '${dee.uid}'`);
    const D = await rec(V, dee);
    await D.goto("/app/notifications");
    const from = at(D);
    await pause(D, 1500);
    await webhook("account.updated", { id: acct, payouts_enabled: true, capabilities: { transfers: "active" }, details_submitted: true });
    await webhook("account.updated", { id: acct, payouts_enabled: true, capabilities: { transfers: "active" }, details_submitted: true });
    const sent = sql(`select count(*) || ' sent, ' || (select count(*) from "Notification" where "userId" = '${dee.uid}' and text like 'Your payout setup is done%') || ' bell line(s)' from "Payment" where "testerId" = '${dee.uid}' and "transferStatus" = 'sent'`);
    console.log(`   §3 after two webhooks: ${sent}`);
    await D.reload();
    const line = D.locator("main li", { hasText: "Your payout setup is done" }).first();
    await line.waitFor({ timeout: 15000 });
    await pause(D, 2000);
    await shot(D, "b22-03-bell", `§3 Sent on its own | Dee's bell: “Your payout setup is done: $8.00 on its way.” (two account.updated webhooks: ${sent}).`, line);
    finishVideo([{ file: await saveVideo(D, "b22-03.webm"), from }], "b22-03-video", "§3 Payout setup done | Dee's bell page while Stripe says the payout account is ready (twice): the waiting $8.00 goes out once and the bell says so.");
    await admin.goto(`/admin?at=${Date.now()}#payouts`);
    await admin.waitForSelector("#payouts");
    const still = await admin.locator("[data-waiting-payout]", { hasText: "Dee Park" }).count();
    console.log(`   §3 Dee still listed as waiting: ${still}`);
    await shot(admin, "b22-03-admin-after", `§3 The list afterwards | Dee's row has left “Payouts waiting for a payout account”.`, "#payouts");
  }, { section: B22, fake: true });

  rgroup("b22c", async () => {
    // §4 The admin's test timeline in the third person, one line per dispute and per decision.
    const nora = await account(`dev+media${TS}${R}v3@playtest.test`, "Nora Lane", "developer", "they");
    await subscribeDev(nora);
    setCard(nora.email, "pm_card_visa");
    const cam = await account(`tester+media${TS}${R}v3c@playtest.test`, "Cam Lee", "tester", "they");
    const ana = await account(`tester+media${TS}${R}v3a@playtest.test`, "Ana Silva", "tester", "they");
    const admin = await adminAccount();
    const t = await postTest(nora, { title: "Harbor Run: first 3 levels", writtenCents: "10.00" });
    const sC = await join(cam, t), sA = await join(ana, t);
    await sendWritten(cam, sC);
    await sendWritten(ana, sA);
    await apiPay(nora, subOf(sC), "10.00");
    const d = await disputed(nora, ana, t, sA);
    await adminDo(admin, "decide", d, { total: "8.00", note: "The answers were short but covered both questions." });
    await adminDo(admin, "pause-test", t, { note: "Media pass check: a report about the build link." });
    await adminDo(admin, "unpause-test", t);
    await adminDo(admin, "suspend", nora.uid, { note: "Media pass check: reports from testers", side: "developer" });
    await adminDo(admin, "unsuspend", nora.uid, { side: "developer" });
    await admin.goto(`/app/find/${t}`);
    await admin.waitForSelector("#admin-boxes");
    const tl = admin.locator("#admin-boxes [data-box]", { hasText: "Timeline" }).first();
    const target = (await tl.count()) ? tl : admin.locator("#admin-boxes");
    const text = await target.innerText();
    console.log("   §4 timeline:", text.replace(/\s+/g, " ").slice(0, 1200));
    if (/\bYou\b|\bYour\b/.test(text)) console.log("   ! §4 a second-person line in the admin timeline");
    await shot(admin, "b22-04-timeline", "§4 The team's timeline | On the test's page, “For the team (only admins see this)” speaks about people: “Nora Lane paid Cam Lee $10.00 for the written answers”, one line for Ana's dispute with the reason in italics (“Ana Silva disputed the pay for their written answers: …”), one for the decision naming the admin (“<admin> decided Ana Silva's dispute: raised the pay to $8.00 ($8.00 more)”), “<admin> paused this test” / “lifted the pause on this test”, “Nora Lane's developer account was paused (by <admin>)” and “Nora Lane's tests are running again”. Timeline (12) scrolls in its box; Contract changes and Payments end with “That's all (N)”.", target);
  }, { section: B22, fake: true });

  rgroup("b22d", async () => {
    // §5 Lift the pause: two admins at once, a stale row, a test that closed, and a test paused only by a hold (no Lift button).
    const nora = await account(`dev+media${TS}${R}v4@playtest.test`, "Nora Lane", "developer", "they");
    await subscribeDev(nora);
    const omar = await account(`dev+media${TS}${R}v4o@playtest.test`, "Omar Reyes", "developer", "they");
    await subscribeDev(omar);
    const a1 = await account(`admin+media${TS}${R}v4x@playtest.test`, "Ada Admin", "developer", "they");
    const a2 = await account(`admin+media${TS}${R}v4y@playtest.test`, "Bo Admin", "developer", "they");
    for (const a of [a1, a2]) own(`update "User" set "isAdmin" = true where email = ${lit(a.email)}`);
    const t = await postTest(nora, { title: "Harbor Run: first 3 levels" });
    const t2 = await postTest(nora, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"] });
    const t3 = await postTest(omar, { productName: "Tide Tracker", title: "Tide Tracker: widgets", categories: ["Productivity"] });
    await adminDo(a1, "pause-test", t, { note: "Media pass check: a report about the build link." });
    await adminDo(a1, "pause-test", t2, { note: "Media pass check: a report about the build link." });
    hold(omar.email);
    const testRow = (P, id) => P.locator(`[data-test-row="${id}"]`).first();
    const search = async (P, q) => {
      const box = P.locator("#tests input:not([type=checkbox])").first();
      await box.fill(q);
      await pause(P, 2500);
    };
    const L = await rec(V, a1), Bo = await rec(V, a2);
    for (const P of [L, Bo]) { await P.goto("/admin#tests"); await P.waitForSelector("#tests"); await search(P, nora.email); }
    const fromL = at(L), fromR = at(Bo);
    await testRow(L, t).waitFor({ timeout: 20000 });
    await testRow(Bo, t).waitFor({ timeout: 20000 });
    await testRow(Bo, t).scrollIntoViewIfNeeded();
    await testRow(L, t).scrollIntoViewIfNeeded();
    await pause(L, 1500);
    // 1. Ada lifts it; Bo's row (still showing Lift the pause) is pressed before it refreshes.
    await testRow(L, t).locator("button", { hasText: "Lift the pause" }).click();
    const mineL = L.locator(`[data-test-row="${t}"] .ok, [data-test-row="${t}"] .err, [data-test-row="${t}"] .info`).first();
    await mineL.waitFor({ timeout: 60000 }).catch(() => {});
    console.log(`   §5 Ada's Lift: “${await mineL.innerText().catch(() => "")}”; paused now: ${sql(`select "adminPausedAt" is not null from "Test" where id = '${t}'`)}`);
    await pause(L, 800);
    await testRow(Bo, t).locator("button", { hasText: "Lift the pause" }).click();
    const msg = Bo.locator(`[data-test-row="${t}"] .ok, [data-test-row="${t}"] .err, [data-test-row="${t}"] .info`).first();
    await msg.waitFor({ timeout: 15000 }).catch(() => {});
    await pause(Bo, 2000);
    const said = await msg.innerText().catch(() => "");
    console.log(`   §5 stale Lift: “${said}”`);
    await shot(Bo, "b22-05-two-admins", `§5 Two admins at once | Bo presses Lift the pause a moment after Ada: “${said}”, and the row's button turns back into Pause.`, testRow(Bo, t));
    // 2. A live row: Ada pauses and lifts again on her page; Bo's row follows on its own.
    await post(a1, "/api/admin/pause-test", { id: t, note: "Media pass check: again." });
    await Bo.reload();
    await search(Bo, nora.email);
    await testRow(Bo, t).scrollIntoViewIfNeeded();
    await pause(Bo, 1500);
    await shot(Bo, "b22-05-live-before", "§5 Live rows (before) | Bo's console shows Lift the pause on the paused test.", testRow(Bo, t));
    await adminDo(a1, "unpause-test", t);
    const live = await waitLive(Bo, `[data-test-row="${t}"] button:has-text("Pause"):not(:has-text("Lift"))`, 30000);
    await pause(Bo, 1500);
    await shot(Bo, "b22-05-live-after", live ? "§5 Live rows (after) | Ada lifted it elsewhere: Bo's row turns back into Pause on its own, without a reload." : "§5 Live rows (after) | Ada lifted it elsewhere; Bo's row (no reload) as it is 30 seconds later.", testRow(Bo, t));
    // 3. A test that closed while paused: Bo's old row.
    await testRow(Bo, t2).scrollIntoViewIfNeeded();
    await pause(Bo, 800);
    await adminDo(a1, "stop-test", t2, { note: "Media pass check: the build link is broken." });
    await testRow(Bo, t2).locator("button", { hasText: "Lift the pause" }).click().catch(() => console.log("   ! §5 no Lift on the closed test's old row"));
    const msg2 = Bo.locator(`[data-test-row="${t2}"] .ok, [data-test-row="${t2}"] .err, [data-test-row="${t2}"] .info`).first();
    await msg2.waitFor({ timeout: 15000 }).catch(() => {});
    await pause(Bo, 2000);
    const said2 = await msg2.innerText().catch(() => "");
    console.log(`   §5 closed: “${said2}”`);
    await shot(Bo, "b22-05-closed", `§5 Closed meanwhile | Bo lifts the pause of a test that was stopped after the page loaded: “${said2}”`, testRow(Bo, t2));
    finishVideo([{ file: await saveVideo(L, "b22-05-l.webm"), from: fromL }, { file: await saveVideo(Bo, "b22-05-r.webm"), from: fromR }], "b22-05-video",
      "§5 Lift the pause, two admins | Ada (left) lifts the pause; Bo (right) presses Lift on their older row and is told who lifted it and when; later rows follow Ada's changes on their own, and a test stopped meanwhile is refused with its own line.");
    // 4. A test paused only by the developer's payment hold: no Lift button.
    await a2.goto("/admin#tests");
    await a2.waitForSelector("#tests");
    await search(a2, omar.email);
    const r3 = testRow(a2, t3);
    await r3.waitFor({ timeout: 20000 });
    const lifts = await r3.locator("button", { hasText: "Lift the pause" }).count();
    console.log(`   §5 hold-paused test: Lift buttons ${lifts}; row “${(await r3.innerText()).replace(/\s+/g, " ").slice(0, 200)}”`);
    await shot(a2, "b22-05-hold-no-lift", `§5 Paused by a hold | Omar's test is paused by their payment hold: its row has ${lifts ? "a Lift the pause button (unexpected)" : "no Lift the pause button"}, since only the team's own pause can be lifted there.`, r3);
  }, { section: B22, fake: true });
}


// ---------- Batch 23 and 24 (owner, Oct 29): the report's "Batch 23 (Oct 29)" and "Batch 24 (Oct 29)" sections (§ numbers are the items in docs/BATCH-23.md / BATCH-24.md) ----------
{
  const B23 = "Batch 23 (Oct 29)", B24 = "Batch 24 (Oct 29)";
  const U = "(now() at time zone 'utc')";
  /** (The shared media server is busy: a press that failed on its side, or a dropped connection, is tried again.) */
  const retry = (fn) => async (...a) => { for (let i = 0; ; i++) { try { return await fn(...a); } catch (e) { if (i >= 3 || !/server|ECONNRESET|socket hang up|Timeout|timed out|: 500/i.test(String(e))) throw e; console.log("   (busy server, trying again)", String(e).slice(0, 80)); await new Promise((r) => setTimeout(r, 4000)); } } };
  /** Longer waits on every page of these groups (the shared server answers slowly while other recordings run). */
  const slowOk = (p) => { p.context().setDefaultTimeout(60000); p.context().setDefaultNavigationTimeout(120000); return p; };
  const recR = async (...a) => slowOk(await rec(...a)), sameR = async (...a) => slowOk(await same(...a));
  const webhookR = retry(webhook), apiPayR = retry(apiPay), apiEditR = retry(apiEdit), openBellR = retry(openBell), joinR = retry(join), sendWrittenR = retry(sendWritten), postTestR = retry(postTest), accountR = async (...a) => slowOk(await account(...a)); // (never twice: a sign-up that went through but lost its answer would be refused the second time)
  /** A goto that waits longer and tries again (the shared media server is busy with other recordings). */
  const go3 = async (p, u) => { for (let i = 0; ; i++) { try { return await p.goto(u, { timeout: 180000 }); } catch (e) { if (i >= 2) throw e; console.log("   (slow page, trying again)", u); await p.waitForTimeout(2000); } } };
  const chi = (d, opts) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago", timeZoneName: "short", ...opts });
  /** A tester's Charge through the API (the session page's own press), on a sent part or (callId) a call. */
  const chargeApi = async (tester, s, body) => { for (let i = 0; ; i++) { const r = await post(tester, `/api/sessions/${s}/choose`, { choice: "charge", seenAt: nowIso(), confirmed: true, ...body }); if (r.ok || i >= 3 || r.status !== 500) return ok(r, "charge"); console.log("   (busy server, charging again)"); await new Promise((res) => setTimeout(res, 4000)); } };
  /** A charge made while the developer is away that their bank wants confirmed: the tester's Charge with the developer's card set to always ask. */
  const awayCharge = async (dev, tester, s, t) => {
    setCard(dev.email, "pm_card_authenticationRequired");
    openCharge(s, t);
    const sub = subOf(s);
    await chargeApi(tester, s, { submissionId: sub, tickedCents: 1000 });
    return sql(`select id from "Payment" where "submissionId" = '${sub}' and "actionPi" is not null order by "createdAt" desc limit 1`);
  };
  /** Verify a card (the fake verifies at once and reloads the page), then wait until Pay what you owe can be pressed. */
  const verifyCard = async (P) => {
    for (let i = 0; i < 3; i++) {
      await pause(P, 2500); // (the button works once the page has hydrated)
      await P.locator("[data-chargeback-steps] button", { hasText: "Verify a card" }).click();
      // The fake draws its stand-in for the bank's 3D Secure check under the button (the busy server can take a minute): confirm it.
      const standIn = P.locator("[data-bank-check=stand-in]").first();
      if (await standIn.waitFor({ timeout: 90000 }).then(() => true, () => false)) {
        await pause(P, 1200);
        await standIn.locator("[data-bank-confirm]").evaluate((b) => b.click());
      }
      if (await P.waitForSelector("[data-chargeback-steps] [data-step-ok=yes]", { timeout: 90000 }).then(() => true, () => false)) break;
      console.log("   (the card check didn't tick yet: pressing Verify a card again)");
      await P.reload();
    }
    await P.locator("#owed button:not([disabled])", { hasText: /Pay what you owe/ }).waitFor({ timeout: 60000 });
    await pause(P, 800);
  };
  /** Pay what you owe (once it can be pressed), then wait for the reserved line. */
  const reserve = async (P) => {
    for (let i = 0; i < 3; i++) {
      const b = P.locator("#owed button:not([disabled])", { hasText: /Pay what you owe/ });
      await b.waitFor({ timeout: 60000 });
      await pause(P, 2500); // (after a reload the button works once the page has hydrated)
      const pop = bankPopup(P, true); // (if the bank's check opens inline, confirm it)
      pop.catch(() => {});
      await b.click();
      if (await P.waitForSelector("text=/Reserved \\$/", { timeout: 40000 }).then(() => true, () => false)) return;
      console.log("   (Pay what you owe: no reserved line yet, pressing again)");
      await P.reload();
    }
    throw new Error("no reservation after three presses");
  };
  /** "Confirm with your bank" until the bank's check opens (a stop box first: pressed again), then confirmed. */
  const confirmBank = async (P, box) => {
    const standIn = P.locator("[data-bank-check=stand-in]").first();
    for (let i = 0; i < 3; i++) {
      await box.locator("button", { hasText: "Confirm with your bank" }).click();
      // The bank's check (the fake's stand-in), or a stop box first (pressed again); the busy server can take a minute.
      const end = Date.now() + 90000;
      let what = "";
      while (!what && Date.now() < end) {
        if (await standIn.isVisible().catch(() => false)) what = "check";
        else if (await box.locator("text=/again to go ahead/").count()) what = "stop";
        else await P.waitForTimeout(700);
      }
      if (what === "check") { await pause(P, 1200); await standIn.locator("[data-bank-confirm]").evaluate((b) => b.click()); return; }
      console.log("   (Confirm stopped first:", (await box.innerText()).replace(/s+/g, " ").slice(0, 300), ")");
    }
  };
  /** The admin console's chargeback row for this developer (the list is shared by every account: scroll it until the row shows). */
  const cbRow = async (A, uid) => {
    await go3(A, `/admin?at=${Date.now()}#chargebacks`);
    const sel = `[data-chargeback-hold="${uid}"]`;
    await pageTo(A, "chargebacks", sel);
    const row = A.locator(sel).first();
    await row.scrollIntoViewIfNeeded();
    await pause(A, 900);
    return row;
  };

  // §1 and §2 Emails that wait, and the owner told. The media server has no Resend key (emails go to the dev outbox), so the failing emails are set up in the
  // database (EmailQueue rows and the incident's start) exactly as src/lib/server/email.ts stores them; the sweep leaves them alone without a key. Removed at the end.
  group("b23a", async () => {
    const admin = await slowOk(await adminAccount());
    own(`update "User" set "timeZone" = 'America/Chicago' where email = ${lit(admin.email)}`);
    const tag = `media${TS}b23e`;
    const to = (x) => `tester+${tag}${x}@playtest.test`;
    const since = new Date(Date.now() - 42 * 60000);
    const cleanup = () => { own(`delete from "EmailQueue" where "to" like '%${tag}%@playtest.test'`); sql(`delete from "AppState" where key in ('email-incident', 'email-cap-until')`); };
    // (A run that stalls must never leave the red box up for the other recordings: the rows go after 15 minutes whatever happens.)
    const dog = setTimeout(() => { try { cleanup(); console.log("   (watchdog: the email rows were removed)"); } catch {} }, 15 * 60000);
    try {
      cleanup();
      const rows = [["a", "Nora Lane paid you $10.00", 42], ["b", "Your Playtest summary", 31], ["c", "Your bank wants you to confirm a $10.00 payment", 12]];
      for (const [x, subject, ago] of rows) {
        own(`insert into "EmailQueue" (id, "to", subject, text, html, status, attempts, "lastError", "errorKind", "nextTryAt", "giveUpAt", "lastTriedAt", "createdAt") values ('eq${tag}${x}', '${to(x)}', ${lit(subject)}, 'Media run', '', 'pending', 3, '503: Service unavailable', '', ${U} + interval '20 minutes', ${U} + interval '47 hours', ${U} - interval '4 minutes', ${U} - interval '${ago} minutes')`);
      }
      sql(`insert into "AppState" (key, value) values ('email-incident', '${since.toISOString()}') on conflict (key) do update set value = excluded.value`);
      // The admins' bell line, once per incident, as startIncident writes it (here written for this run's admin only).
      const bellLine = `Emails aren't sending (since ${chi(since)})`;
      sql(`insert into "Notification" (id, "userId", text, link, own, "createdAt") values ('nt${tag}', '${admin.uid}', ${lit(bellLine)}, '/admin#emails', true, ${U} - interval '42 minutes')`);
      await go3(admin, `/admin?at=${Date.now()}`);
      await admin.waitForSelector("[data-emails-box]");
      await pause(admin, 800);
      const line = await admin.locator("[data-emails-waiting]").innerText();
      console.log("   red box:", line);
      await shot(admin, "b23-02-red-box", `§2 The red box | At the top of the admin console while emails wait: “${line}” and “Each is tried again after 5, 15 and 30 minutes, then every hour, for 48 hours. …” (three failing emails set up in the database for the recording; this server has no Resend key).`, "[data-emails-box]");
      await openBellR(admin);
      await shot(admin, "b23-02-bell", `§2 The admins' bell | One line per incident, in the app (so it doesn't depend on Resend): “${bellLine}”, linking to the red box (written for the recording as the first failure writes it).`, admin.locator("main li, main [data-bell-line], main a", { hasText: "Emails aren't sending" }).first());
      // §2 The keyed health check for the uptime service's keyword monitor: emails failing 15 minutes or more.
      {
        const P = await sameR(admin);
        await go3(P, `/api/health?key=${HEALTH_KEY}`);
        await pause(P, 600);
        const body = await P.locator("body").innerText();
        console.log("   health:", body);
        await shot(P, "b23-02-health-keyword", `§2 The keyword for the uptime monitor | /api/health with the key answers ${body.trim()} (HTTP 200: the site itself is up), so a keyword monitor alerts the owner through its own emails and texts.`, "pre");
        await go3(P, "/api/health");
        await pause(P, 600);
        const plain = (await P.locator("body").innerText()).trim();
        await shot(P, "b23-02-health-plain", `§2 Without the key | The plain /api/health answers only ${plain}: the email state is for the keyed monitor.`, "pre");
        await P.context().close();
      }
      // §2 The daily limit, in plain words.
      own(`update "EmailQueue" set "errorKind" = 'cap', "lastError" = ${lit("Resend's daily limit was reached (free plan: 100 a day). Emails will go out tomorrow, or upgrade the plan.")}, "lastTriedAt" = ${U} where "to" like '%${tag}%@playtest.test'`);
      await go3(admin, `/admin?at=${Date.now()}`);
      await admin.waitForSelector("[data-emails-waiting]");
      const capLine = await admin.locator("[data-emails-waiting]").innerText();
      await shot(admin, "b23-02-red-box-cap", `§2 Resend's daily limit | The same box when Resend answered with its daily limit: “${capLine}”`, "[data-emails-box]");
      // (Batch 24, a batch 23 leftover) The missing key, in plain words.
      own(`update "EmailQueue" set "errorKind" = '', "lastError" = ${lit("Emails aren't being sent: RESEND_API_KEY is missing.")} where "to" like '%${tag}%@playtest.test'`);
      await go3(admin, `/admin?at=${Date.now()}`);
      await admin.waitForSelector("[data-emails-waiting]");
      const keyLine = await admin.locator("[data-emails-waiting]").innerText();
      await shot(admin, "b23-02-red-box-no-key", `§2 The missing key | Emails waiting because the deploy has no key: “${keyLine}”`, "[data-emails-box]");
      // §1 and §2 Failed for good after 48 hours (kept), listed with Clear; one still waiting.
      own(`update "EmailQueue" set "lastError" = '503: Service unavailable' where "to" like '%${tag}%@playtest.test'`);
      own(`update "EmailQueue" set "lastError" = '503: Service unavailable', status = 'failed', "failedAt" = ${U} - interval '3 minutes', attempts = 52 where "to" like '%${tag}%@playtest.test' and id <> 'eq${tag}c'`);
      const R = await recR(V, admin);
      await go3(R, `/admin?at=${Date.now()}`);
      await R.waitForSelector("[data-emails-failed]");
      const from = at(R);
      await pause(R, 1500);
      await shot(R, "b23-02-failed-list", "§2 Failed for good | Emails tried for 48 hours are kept and listed under the waiting line: “2 emails failed for good (tried for 48 hours, kept):” each “To … · “subject” · written … · 503: Service unavailable”, with “Clear this list (the emails are kept)”.", "[data-emails-box]");
      await R.locator("[data-emails-failed] button", { hasText: "Clear this list" }).click();
      await R.waitForSelector("text=Done.", { timeout: 20000 }).catch(() => {});
      await pause(R, 2000);
      await go3(R, `/admin?at=${Date.now()}`);
      await R.waitForSelector("[data-emails-box]", { timeout: 30000 });
      await pause(R, 1500);
      const cleared = Number(own(`select count(*) from "EmailQueue" where "to" like '%${tag}%@playtest.test' and "clearedAt" is not null`));
      await shot(R, "b23-02-cleared", `§2 Cleared | After Clear the list is gone (the ${cleared} rows are kept with their cleared time); the one email still waiting keeps the red line until it's sent.`, "[data-emails-box]");
      finishVideo([{ file: await saveVideo(R, "b23-02-clear.webm"), from }], "b23-02-clear-video", "§2 Clear the failed list | The admin clears the failed-for-good list; the emails are kept, and the red line for the one still waiting stays.");
    } finally {
      clearTimeout(dog);
      cleanup();
      own(`delete from "Notification" where id = 'nt${tag}' and "userId" in (select id from "User" where email like '%@playtest.test')`);
    }
    await go3(admin, `/admin?at=${Date.now()}`);
    await pause(admin, 800);
    if (await admin.locator("[data-emails-box]").count()) console.log("   ! the red box is still there after the clean-up");
  }, { section: B23, fake: true });

  // §5 Edit keeps what you typed and shows what the other tab saved.
  group("b23b", async () => {
    const nora = await accountR(`dev+media${TS}b23b@playtest.test`, "Nora Lane", "developer", "they");
    await subscribeDev(nora);
    const ana = await accountR(`tester+media${TS}b23ba@playtest.test`, "Ana Silva", "tester", "they");
    const t = await postTestR(nora, { title: "Harbor Run: first 3 levels" });
    sql(`delete from "KeptForm" where "userId" = '${nora.uid}'`);
    {
      const A = await recR(V, nora);
      await go3(A, `/app/tests/${t}/edit`);
      await A.waitForSelector("#description");
      const from = at(A);
      await A.locator("#description").scrollIntoViewIfNeeded();
      await A.locator("#description").click();
      await A.locator("#description").evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
      await A.keyboard.type(" Also try the night harbor.", { delay: 30 });
      await pause(A, 1200);
      // Another tab (the same developer) saves new instructions and a new name.
      await apiEditR(nora, t, { description: "Sail through all five harbors and tell us where the map gets confusing.", title: "Harbor Run: all five harbors" });
      await waitLive(A, "[data-theirs-note]", 40000);
      await pause(A, 1500);
      const title = await A.locator("#title").inputValue();
      if (title !== "Harbor Run: all five harbors") console.log("   ! §5 untouched title:", title);
      await shot(A, "b23-05-untouched", `§5 A field you didn't touch | The name, untouched here, took the other tab's save silently: “${title}”, with no note (so this tab's Save never undoes it).`, field(A, "title"));
      await shot(A, "b23-05-typed-note", "§5 A field you typed in | The instructions keep what was typed here; the blue note under them shows what the other tab saved: “Saved in another tab or device at <time>:” with their text and “Use theirs”.", field(A, "description"));
      await saveBtn(A).scrollIntoViewIfNeeded();
      const tick = A.locator("#payRulesOk");
      if (await tick.count()) await tick.check();
      await saveBtn(A).click();
      await Promise.race([A.waitForSelector("text=/your version will replace the one saved in another tab/", { timeout: 30000 }), A.waitForURL(/saved=1/, { timeout: 30000 })]).catch(() => {});
      if (/saved=1/.test(A.url())) console.log("   ! §5 the first Save went straight through (no stop)");
      if (!(await A.locator("text=/your version will replace/").count())) console.log("   ! §5 no stop line; under Save:", (await A.locator("form").last().innerText().catch(() => "")).slice(-600).replace(/\s+/g, " "));
      await pause(A, 1800);
      const stopLine = await A.locator("text=/your version will replace the one saved in another tab/").first().innerText();
      await shotSpan(A, "b23-05-save-stop", `§5 Save stops once | The first Save stops in the blue box under it: “Your Save didn't go through. Since you opened this page: ${stopLine} Press Save again to save.”`, saveBtn(A), A.locator("text=/Press Save again/").locator("xpath=ancestor::*[contains(@class,'info')][1]"), 16, 12);
      await saveBtn(A).click();
      await A.waitForURL(/saved=1/, { timeout: 20000 }).catch(() => console.log("   ! §5 the second Save didn't land"));
      await pause(A, 2500);
      const saved = sql(`select description from "Test" where id = '${t}'`);
      console.log("   §5 saved instructions:", saved);
      finishVideo([{ file: await saveVideo(A, "b23-05-edit.webm"), from }], "b23-05-edit-video", "§5 Edit keeps what you typed | Instructions are typed here while another tab saves new instructions and a new name: the name updates silently, the instructions keep this tab's text with the “Saved in another tab or device at …” note, Save stops once naming the field, and the second press saves this version on top.");
    }
    // Use theirs.
    {
      const t2 = await postTestR(nora, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"] });
      const E = await recR(V, nora);
      await go3(E, `/app/tests/${t2}/edit`);
      await E.waitForSelector("#productName");
      const from = at(E);
      await E.locator("#productName").fill("");
      await typeSlow(E, "#productName", "Sky Lab Kids", 60);
      await pause(E, 1000);
      await apiEditR(nora, t2, { productName: "Sky Lab Junior" });
      await waitLive(E, "[data-theirs-note]", 40000);
      await pause(E, 1500);
      await shot(E, "b23-05-use-theirs-before", "§5 A short field | “Saved in another tab or device at <time>: Product: Sky Lab Junior” on one line with “Use theirs”; the box still says what was typed here, “Sky Lab Kids”.", field(E, "productName"));
      await E.locator("[data-use-theirs]").first().click();
      await pause(E, 1500);
      const v = await E.locator("#productName").inputValue();
      await shot(E, "b23-05-use-theirs-after", `§5 Use theirs | One press puts the other tab's value in the box (“${v}”) and the note goes.`, field(E, "productName"));
      finishVideo([{ file: await saveVideo(E, "b23-05-use-theirs.webm"), from }], "b23-05-use-theirs-video", "§5 Use theirs | “Sky Lab Kids” is typed while another tab saves “Sky Lab Junior”: the note shows theirs with Use theirs, and one press takes it.");
    }
    // Headings: your own save elsewhere and a tester given a key.
    {
      const t3 = await postTestR(nora, { productName: "Lumen Notes", title: "Lumen Notes private beta", categories: ["Productivity"], spots: "4", accessKeys: ["K-1", "K-2", "K-3", "K-4"].join("\n") });
      const K = await recR(V, nora);
      await go3(K, `/app/tests/${t3}/edit`);
      await K.waitForSelector("#keys");
      await K.locator("#keys").scrollIntoViewIfNeeded();
      const from = at(K);
      await pause(K, 1200);
      await apiEditR(nora, t3, {}, { add: ["N-1", "N-2"] });
      await joinR(ana, t3);
      await waitLive(K, "[data-group-note]", 40000);
      await pause(K, 2500);
      await K.locator("#keys").scrollIntoViewIfNeeded();
      await shot(K, "b23-05-headings", "§5 Who changed it | The keys' note has two headings: “Changed in another tab or device at <time>:” over this developer's own save elsewhere (the added keys) and “Updated at <time>:” over what someone else caused (Ana Silva joining and being given a key).", "#keys");
      finishVideo([{ file: await saveVideo(K, "b23-05-headings.webm"), from }], "b23-05-headings-video", "§5 Two headings | Keys added in another tab, then a tester joins and is given a key: one note, each change under its own heading.");
    }
  }, { section: B23, fake: true });

  // §6 A chargeback hold: Pay what you owe reserves; Approve takes it.
  group("b23c", async () => {
    const nora = await accountR(`dev+media${TS}b23c@playtest.test`, "Nora Lane", "developer", "they");
    const ana = await accountR(`tester+media${TS}b23ca@playtest.test`, "Ana Silva", "tester", "they");
    const admin = await slowOk(await adminAccount());
    await subscribeDev(nora);
    const t = await postTestR(nora, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"], writtenCents: "12.00" });
    const sA = await joinR(ana, t);
    await sendWrittenR(ana, sA);
    const sub = subOf(sA);
    await apiPayR(nora, sub, "12.00");
    // Ana's answers on a second test, not paid in time: Charge opens for them.
    const t2 = await postTestR(nora, { productName: "Harbor Run", title: "Harbor Run: first 3 levels", writtenCents: "10.00" });
    const sA2 = await joinR(ana, t2);
    await sendWrittenR(ana, sA2);
    openCharge(sA2, t2);
    await webhookR("charge.dispute.created", { payment_intent: piOf(sub), status: "needs_response" });
    const D = await recR(V, nora), A = await recR(V, admin);
    await go3(D, "/app/payments");
    await D.waitForSelector("[data-chargeback-steps]");
    const fromD = at(D), fromA = at(A);
    await pause(D, 1200);
    await verifyCard(D);
    await reserve(D);
    await pause(D, 2000);
    const reservedText = await D.locator("text=/Reserved \\$/").first().innerText();
    await shot(D, "b23-06-reserved", `§6 Reserved, not taken | Pay what you owe during a chargeback hold puts the money on hold on the card: “${reservedText}”`, D.locator("[data-chargeback-paid], #owed").first());
    let row = await cbRow(A, nora.uid);
    sec("Batch 23 (Oct 29)");
    await shot(A, "b23-06-admin-ready", `§6 The team's row | “Chargeback hold: card verified ✓, owed reserved ✓ (${/\$[\d.]+/.exec(reservedText)?.[0] ?? ""} reserved)” with Approve and “Don't approve: release the reservation”.`, row);
    // Ana charges meanwhile: added to what's owed; the admin's page (opened before) presses Approve.
    await chargeApi(ana, sA2, { submissionId: subOf(sA2), tickedCents: 1000 });
    await pause(A, 800);
    await row.locator("button", { hasText: /^Approve$/ }).click();
    const notYet = row.locator(".err, .ok").first();
    await notYet.waitFor({ timeout: 15000 });
    await pause(A, 2000);
    const notYetText = await notYet.innerText();
    await shot(A, "b23-06-not-yet", `§6 Approve refused while short | Ana charged meanwhile, so the reserved money no longer covers what's owed: “${notYetText}”`, row);
    await D.reload();
    await D.waitForSelector("#owed");
    await pause(D, 1500);
    await shot(D, "b23-06-added", "§6 What was added | Payments keeps the reserved line and lists Ana's charge, added since: “… What was added since needs its own Pay what you owe:” with the button again.", "#owed");
    await D.locator("#owed button:not([disabled])", { hasText: /Pay what you owe/ }).click();
    await pause(D, 4000);
    await D.reload();
    await pause(D, 1500);
    await shot(D, "b23-06-reserved-all", "§6 The difference reserved | A second Pay what you owe reserves the difference: the whole amount is now on hold on the card.", D.locator("[data-chargeback-paid], #owed, [data-reserved]").first());
    row = await cbRow(A, nora.uid);
    await row.locator("button", { hasText: /^Approve$/ }).click();
    await A.waitForSelector("text=Done.", { timeout: 15000 }).catch(() => {});
    await pause(A, 1500);
    const captured = sql(`select count(*) || ' captured, ' || coalesce(sum("amountCents"), 0) from "Reservation" where "developerId" = '${nora.uid}' and status = 'captured'`);
    console.log("   §6 reservations:", captured);
    await go3(D, "/app");
    await pause(D, 3000);
    finishVideo([{ file: await saveVideo(D, "b23-06-d.webm"), from: fromD }, { file: await saveVideo(A, "b23-06-a.webm"), from: fromA }], "b23-06-reserve-video",
      "§6 Reserve, then Approve | The developer (left) verifies a card and reserves what's owed; the tester charges meanwhile, so the team's Approve (right) is refused “Not yet: …”; the developer reserves the difference and the next Approve takes it and lifts the hold.");
    await openBellR(nora);
    await shot(nora, "b23-06-dev-notice", "§6 The developer's notice | One bell line from the Approve: “The team approved lifting your hold: the $X reserved on your card was taken, and your tests are running again.”", nora.locator("main li, main a, main p", { hasText: "The team approved lifting your hold" }).first());
    await openBellR(ana);
    const anaText = await bellList(ana).innerText();
    if (/hold|suspend|failed|chargeback/i.test(anaText)) console.log("   ! §6 the tester's bell names a hold, failure or chargeback:", anaText.replace(/\s+/g, " ").slice(0, 400));
    await shot(ana, "b23-06-tester-bell", "§6 The tester's side | Ana's bell: the test paused and ran again and their charge; nothing about the developer's hold or chargeback.", bellList(ana));

    // Don't approve, then a reservation that expires.
    const omar = await accountR(`dev+media${TS}b23co@playtest.test`, "Omar Reyes", "developer", "they");
    await subscribeDev(omar);
    const ben = await accountR(`tester+media${TS}b23cb@playtest.test`, "Ben Okafor", "tester", "they");
    const t3 = await postTestR(omar, { productName: "Tide Tracker", title: "Tide Tracker: widgets", categories: ["Productivity"], writtenCents: "8.00" });
    const sB = await joinR(ben, t3);
    await sendWrittenR(ben, sB);
    const subB = subOf(sB);
    await apiPayR(omar, subB, "8.00");
    await webhookR("charge.dispute.created", { payment_intent: piOf(subB), status: "needs_response" });
    await go3(omar, "/app/payments");
    await verifyCard(omar);
    await reserve(omar);
    row = await cbRow(admin, omar.uid);
    const span = row.locator("span", { has: admin.locator("button", { hasText: "Don't approve" }) }).last();
    const why = span.locator("textarea, input").first();
    if (await why.count()) await why.fill("Media pass check: the bank's case is still open.");
    await pause(admin, 1200);
    await span.locator("button", { hasText: "Don't approve" }).click();
    await admin.waitForSelector("text=Done.", { timeout: 15000 }).catch(() => {});
    await pause(admin, 1200);
    row = await cbRow(admin, omar.uid);
    await shot(admin, "b23-06-declined-admin", "§6 Don't approve | The team releases the reservation: nothing is taken, the hold stays, and the row is back to “owed reserved ✗”.", row);
    await go3(omar, "/app/payments");
    await omar.waitForSelector("#owed");
    await pause(omar, 1000);
    await shot(omar, "b23-06-declined-dev", "§6 Released | The developer's Payments asks for Pay what you owe again (nothing was taken).", "#owed");
    await reserve(omar);
    const rid = sql(`select id from "Reservation" where "developerId" = '${omar.uid}' and status = 'reserved' order by "createdAt" desc limit 1`);
    own(`update "Reservation" set "expiresAt" = ${U} - interval '1 minute' where id = '${rid}'`);
    await go3(omar, "/app/payments");
    await omar.waitForSelector("[data-reserve-expired]", { timeout: 15000 });
    await pause(omar, 1000);
    const exp = await omar.locator("[data-reserve-expired]").first().innerText();
    await shot(omar, "b23-06-expired-dev", `§6 The reservation expired | Seven days without Approve (the date moved for the recording): “${exp}” with Pay what you owe again.`, "#owed");
    row = await cbRow(admin, omar.uid);
    await shot(admin, "b23-06-expired-admin", "§6 The team's row | “Reservation expired” under the developer's chargeback hold; Approve waits for a new reservation.", row);
  }, { section: B23, fake: true });

  // §7 Suspend's Preview above the boxes.
  group("b23d", async () => {
    const nora = await accountR(`dev+media${TS}b23d@playtest.test`, "Nora Lane", "developer", "they");
    await subscribeDev(nora);
    const ana = await accountR(`tester+media${TS}b23da@playtest.test`, "Ana Silva", "tester", "they");
    const admin = await slowOk(await adminAccount());
    const t = await postTestR(nora, { liveRateCents: "30.00" });
    const sA = await joinR(ana, t);
    await sendWrittenR(ana, sA);
    await bookCall(nora, ana, t, sA, 30);
    await go3(admin, `/app/developers/${nora.uid}`);
    const blk = admin.locator("[data-admin-account] [data-suspend-block]").first();
    await blk.waitFor({ timeout: 20000 });
    await pause(admin, 1200);
    await blk.locator("button", { hasText: "Preview suspension" }).click();
    await admin.waitForSelector("[data-admin-account] [data-preview]", { timeout: 15000 });
    await pause(admin, 1000);
    const pv = (await blk.locator("[data-preview]").innerText()).replace(/\s+/g, " ").trim();
    await shot(admin, "b23-07-profile", `§7 Preview on the profile's admin view | Top to bottom, full width: Preview suspension, its effects (“${pv}”), then the Why box, then Suspend.`, blk);
    await go3(admin, `/admin?at=${Date.now()}`);
    const search = admin.locator("[data-scroll-box=users]").locator("xpath=preceding::input[@type='search'][1]");
    await search.fill(nora.email);
    const row = admin.locator(`[data-user-row="${nora.uid}"]`).first();
    await row.waitFor({ timeout: 20000 });
    await row.scrollIntoViewIfNeeded();
    await pause(admin, 1200);
    await row.locator("button", { hasText: "Preview suspension" }).click();
    await row.locator("[data-preview]").waitFor({ timeout: 15000 });
    await pause(admin, 1000);
    await shot(admin, "b23-07-accounts", "§7 The same in the Accounts list | The developer's row: Preview suspension and its lines first, full width, then the Why box and Suspend, then Delete account; nothing sits beside the Preview any more.", row);
  }, { section: B23, fake: true });

  // §9 Confirm with your bank stops once like Pay.
  group("b23e", async () => {
    const nora = await accountR(`dev+media${TS}b23e@playtest.test`, "Nora Lane", "developer", "they");
    await subscribeDev(nora);
    const T = [];
    for (const [x, n] of [["a", "Ana Silva"], ["b", "Ben Okafor"], ["c", "Cam Lee"], ["d", "Dee Park"], ["e", "Eve Moss"]]) T.push(await accountR(`tester+media${TS}b23e${x}@playtest.test`, n, "tester", "they"));
    const t = await postTestR(nora, { productName: "Kelp Forest", title: "Kelp Forest: iPhone beta", writtenCents: "10.00", spots: "6" });
    const S = [];
    for (const p of T) { const s = await joinR(p, t); await sendWrittenR(p, s); S.push(s); }
    // Ben's answers were paid $0 with a reason (he can dispute); Ana's Charge waits for the bank.
    setCard(nora.email, "pm_card_visa");
    await rejectPiece(nora, subOf(S[1]), "The answers were blank.");
    const payA = await awayCharge(nora, T[0], S[0], t);
    const D = await recR(V, nora);
    await go3(D, `/app/tests/${t}`);
    const box = D.locator(`[data-bank-waiting="${payA}"]`);
    await box.waitFor({ timeout: 20000 });
    await box.scrollIntoViewIfNeeded();
    const from = at(D);
    await pause(D, 1500);
    // Meanwhile: Ben disputes his $0, and another tab pays Cam.
    await disputeOf(T[1], S[1], subOf(S[1]));
    setCard(nora.email, "pm_card_visa");
    await apiPayR(nora, subOf(S[2]), "10.00");
    setCard(nora.email, "pm_card_authenticationRequired");
    await box.locator("button", { hasText: "Confirm with your bank" }).click();
    await D.waitForSelector(`[data-bank-waiting="${payA}"] >> text=/again/`, { timeout: 15000 }).catch(() => {});
    await pause(D, 2500);
    await shot(D, "b23-09-stop", `§9 Confirm stops once | Pressed after a change this page hadn't shown, “Confirm with your bank” stops in the blue box under it: “${(await box.locator("[data-changes-box], .info").last().innerText().catch(() => "")).replace(/\s+/g, " ").trim()}”`, box);
    const checked = bankPopup(D, true, () => shot(D, "b23-09-check", "§9 The second press | Pressed again, it opens the bank's check (the fake Stripe's stand-in) right under the button.", box));
    await box.locator("button", { hasText: "Confirm with your bank" }).click();
    await checked;
    await D.waitForSelector("[data-bank-confirmed]", { timeout: 15000 }).catch(() => {});
    await pause(D, 2500);
    finishVideo([{ file: await saveVideo(D, "b23-09-confirm.webm"), from }], "b23-09-confirm-video", "§9 Confirm with your bank stops once | While the test page is open, Ben Okafor disputes and another tab pays Cam Lee: the first Confirm stops once in the blue box, the second opens the bank's check, and the payment is confirmed.");
    // Plain refusals: confirmed in another tab, and expired.
    const payD = await awayCharge(nora, T[3], S[3], t);
    const payE = await awayCharge(nora, T[4], S[4], t);
    const P1 = await sameR(nora), P2 = await sameR(nora);
    for (const P of [P1, P2]) { await go3(P, `/app/tests/${t}`); await P.locator(`[data-bank-waiting="${payD}"]`).waitFor({ timeout: 20000 }); }
    const b1 = P1.locator(`[data-bank-waiting="${payD}"]`);
    await confirmBank(P1, b1);
    await P1.waitForSelector("[data-bank-confirmed]", { timeout: 15000 }).catch(() => {});
    const b2 = P2.locator(`[data-bank-waiting="${payD}"]`);
    await b2.scrollIntoViewIfNeeded();
    await b2.locator("button", { hasText: "Confirm with your bank" }).click();
    await pause(P2, 2500);
    const t2 = (await b2.innerText()).replace(/\s+/g, " ");
    if (!/You already confirmed this payment\./.test(t2)) console.log("   ! §9 already confirmed:", t2);
    await shot(P2, "b23-09-already", "§9 Already confirmed | From a page opened before another tab confirmed it: “You already confirmed this payment.” (plain, no stop box).", b2);
    const b3 = P2.locator(`[data-bank-waiting="${payE}"]`);
    own(`update "Payment" set "actionBy" = ${U} - interval '1 minute' where id = '${payE}'`);
    await b3.scrollIntoViewIfNeeded();
    await b3.locator("button", { hasText: "Confirm with your bank" }).click();
    await pause(P2, 2500);
    const t3 = (await b3.innerText().catch(() => "")).replace(/\s+/g, " ");
    if (!/This confirmation expired: nothing was charged\./.test(t3)) console.log("   ! §9 expired:", t3);
    await shot(P2, "b23-09-expired", "§9 Expired | Past its 3 days (moved for the recording): “This confirmation expired: nothing was charged.”", b3);
  }, { section: B23, fake: true });

  // Batch 24 §1 "Your bank wants you to confirm" on the developer dashboard.
  group("b24a", async () => {
    const nora = await accountR(`dev+media${TS}b24a@playtest.test`, "Nora Lane", "developer", "they");
    await subscribeDev(nora);
    const ana = await accountR(`tester+media${TS}b24aa@playtest.test`, "Ana Silva", "tester", "they");
    const ben = await accountR(`tester+media${TS}b24ab@playtest.test`, "Ben Okafor", "tester", "they");
    const t = await postTestR(nora, { productName: "Harbor Run", title: "Harbor Run: first 3 levels", writtenCents: "12.50", liveRateCents: "30.00" });
    const sA = await joinR(ana, t), sB = await joinR(ben, t);
    await sendWrittenR(ana, sA);
    // Ben's call took place 9 days ago and wasn't paid: Charge opens for it.
    const call = await bookCall(nora, ben, t, sB, 400);
    tookPlace(call, nora.uid, ben.uid, 60 * 24 * 9, 25);
    own(`update "Contract" set "dueAt" = ${U} - interval '1 day' where id = '${sB}'`);
    own(`update "Call" set "payBy" = ${U} - interval '1 hour', "choiceOfferedAt" = ${U} - interval '1 hour', "choiceBy" = ${U} + interval '6 days' where id = '${call}'`);
    setCard(nora.email, "pm_card_authenticationRequired");
    openCharge(sA, t);
    await chargeApi(ana, sA, { submissionId: subOf(sA), tickedCents: 1250 });
    const payA = sql(`select id from "Payment" where "submissionId" = '${subOf(sA)}' and "actionPi" is not null order by "createdAt" desc limit 1`);
    await go3(nora, `/app/tests/${t}`); // (the call's length is made final by a page load)
    await chargeApi(ben, sB, { callId: call });
    const payB = sql(`select id from "Payment" where "callId" = '${call}' and "actionPi" is not null order by "createdAt" desc limit 1`);
    // The plan's renewal, due now: the card asks the bank.
    own(`update "User" set "subscriptionRenewsAt" = ${U} - interval '1 minute' where email = ${lit(nora.email)}`);
    console.log("   renew:", JSON.stringify(await hook("renew", nora.email)).slice(0, 200));
    // Under 24 hours left: Ana's charge today, Ben's call tomorrow.
    if (payA) own(`update "Payment" set "actionBy" = ${U} + interval '4 hours' where id = '${payA}'`);
    if (payB) own(`update "Payment" set "actionBy" = ${U} + interval '23 hours' where id = '${payB}'`);
    await go3(nora, "/app");
    await nora.waitForSelector("[data-bank-top]", { timeout: 20000 });
    await pause(nora, 1200);
    const n = await nora.locator("[data-bank-top-row]").count();
    const lines = (await nora.locator("[data-bank-top-row] p").allInnerTexts()).map((s) => s.replace(/\s+/g, " "));
    console.log("   §1 rows:", lines.join(" | "));
    await shot(nora, "b24-01-box", `§1 At the top of the dashboard | “Your bank wants you to confirm (${n})”, soonest first: ${lines.map((l) => `“${l}”`).join(", ")}, each with “Confirm with your bank →”; under 24 hours the “confirm by” part is red (the deadlines were moved for the recording).`, "[data-bank-top]");
    // The link opens the piece on the test page, marked.
    await nora.locator(`[data-bank-top-row="${payA}"] [data-bank-top-link]`).evaluate((a) => a.click()); // (on a phone the sticky header can sit over it)
    await nora.waitForURL(/\/app\/tests\//, { timeout: 20000 });
    const w = nora.locator(`[data-bank-waiting="${payA}"]`);
    await w.waitFor({ timeout: 15000 });
    await pause(nora, 700);
    const wl = (await w.locator("p").first().innerText()).trim();
    await shot(nora, "b24-01-piece", `§1 Confirm with your bank → | The row opens the test page at Ana Silva's written answers, the piece marked for a few seconds: “${wl}” with its own Confirm with your bank.`, w);
    // The renewal opens Payments at its row.
    await go3(nora, "/app");
    await nora.waitForSelector("[data-bank-top]");
    const renewal = nora.locator("[data-bank-top-row]", { hasText: "for your plan" }).first();
    if (await renewal.count()) {
      await renewal.locator("[data-bank-top-link]").evaluate((a) => a.click());
      await nora.waitForURL(/\/app\/payments/, { timeout: 20000 });
      await pause(nora, 1500);
      const target = nora.locator(`[id^="bank-"]`).first();
      const tl = (await target.locator("p").first().innerText().catch(() => "")).trim();
      await shot(nora, "b24-01-renewal", `§1 A renewal | The plan's row has no test, so its link opens Payments at the renewal: “${tl}” with Confirm with your bank.`, (await target.count()) ? target : nora.locator("[data-confirm-list]").first());
    } else console.log("   ! §1 no renewal row");
    // Live: confirmed on the test page in another tab, the row leaves the dashboard.
    {
      const Dsh = await recR(V, nora), Tp = await recR(V, nora);
      await go3(Dsh, "/app");
      await Dsh.waitForSelector(`[data-bank-top-row="${payA}"]`);
      await go3(Tp, `/app/tests/${t}#bank-${payA}`);
      const wb = Tp.locator(`[data-bank-waiting="${payA}"]`);
      await wb.waitFor({ timeout: 20000 });
      await wb.scrollIntoViewIfNeeded();
      const fD = at(Dsh), fT = at(Tp);
      await pause(Dsh, 1500);
      await confirmBank(Tp, wb);
      await Tp.waitForSelector("[data-bank-confirmed]", { timeout: 15000 }).catch(() => {});
      await waitGone(Dsh, `[data-bank-top-row="${payA}"]`, 40000);
      await pause(Dsh, 2500);
      await shot(Dsh, "b24-01-after", "§1 Gone when confirmed elsewhere | Confirmed on the test page in another tab, Ana Silva's row leaves the dashboard's box on its next poll without a reload: “Your bank wants you to confirm (2)”.", "[data-bank-top]");
      finishVideo([{ file: await saveVideo(Dsh, "b24-01-d.webm"), from: fD }, { file: await saveVideo(Tp, "b24-01-t.webm"), from: fT }], "b24-01-live-video", "§1 Live | The dashboard (left) and the test page (right): the payment is confirmed on the right and its row leaves the box on the left.");
    }
    // During a hold: on the restricted dashboard, above the blue box.
    hold(nora.email);
    await go3(nora, "/app");
    await nora.waitForSelector("[data-bank-top]", { timeout: 20000 });
    await pause(nora, 1200);
    const blue = nora.locator("[data-restricted-box]").first();
    if (await blue.count()) await shotSpan(nora, "b24-01-hold", "§1 During a hold | The restricted dashboard shows “Your bank wants you to confirm (2)” first, above the blue box “Your account is on hold”.", "[data-bank-top]", blue);
    else await shot(nora, "b24-01-hold", "§1 During a hold | The restricted dashboard shows the box at the very top.", "[data-bank-top]");
  }, { section: B24, fake: true });

  // Batch 24 §2 A request closed by a rating.
  group("b24b", async () => {
    const nora = await accountR(`dev+media${TS}b24b@playtest.test`, "Nora Lane", "developer", "they");
    await subscribeDev(nora);
    const ana = await accountR(`tester+media${TS}b24ba@playtest.test`, "Ana Silva", "tester", "they");
    const t = await postTestR(nora, { liveRateCents: "30.00" });
    const sA = await joinR(ana, t);
    await sendWrittenR(ana, sA);
    await apiPayR(nora, subOf(sA), "10.00");
    const d = new Date(Date.now() + 50 * 3600000); d.setMinutes(0, 0, 0);
    ok(await post(nora, `/api/tests/${t}/request-time`, { ...go, contractIds: [sA], minutes: 30, times: [d.toISOString()] }), "request a time");
    // A second page of the developer's, opened before the rating, shows the waiting request (and later presses Withdraw on it).
    const P = await sameR(nora);
    await go3(P, `/app/tests/${t}`);
    const reqs = P.locator("section[aria-label='Call requests']").first();
    await reqs.waitFor({ timeout: 30000 }).catch(() => {});
    if (await reqs.count()) await shot(P, "b24-02-before", "§2 Before | The developer's call request to Ana Silva waits in Call requests.", reqs);
    const D = await recR(V, nora);
    await go3(D, `/app/tests/${t}`);
    await D.locator("#calls").scrollIntoViewIfNeeded().catch(() => {});
    const from = at(D);
    await pause(D, 1500);
    await rateDev(ana, sA, 5, "Clear steps and quick pay.");
    const reason = sql(`select status || ': ' || "closedReason" from "CallRequest" where "contractId" = '${sA}' order by "createdAt" desc limit 1`);
    console.log("   §2 request:", reason);
    await waitLive(D, "text=/finished their part/", 30000);
    await pause(D, 2500);
    const shown = D.locator("text=/finished their part/").first();
    const live = (await shown.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    await shot(D, "b24-02-live", `§2 The live line | On the developer's open page: “${live}”. The waiting call request is closed with the reason “the tester finished their part” (stored as “${reason}”).`, shown.locator("xpath=ancestor::*[contains(@class,'info') or self::li or self::section][1]"));
    finishVideo([{ file: await saveVideo(D, "b24-02.webm"), from }], "b24-02-video", `§2 A rating closes the request | The developer's page is open with a call request waiting; Ana rates and the live box says “${live}”.`);
    // The older page presses Withdraw on the closed request.
    const w = reqs.locator("button", { hasText: /Withdraw/ }).first();
    if (await w.count()) {
      await w.click();
      await pause(P, 3000);
      const msg = (await reqs.locator(".err, .info, .ok, [role=status]").last().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      console.log("   §2 stale Withdraw:", msg);
      await shot(P, "b24-02-withdraw", `§2 A press from an older page | Withdraw on the closed request, from a page opened before the rating: “${msg}”`, reqs);
    } else console.log("   ! §2 no Withdraw button on the older page");
    await P.context().close();
  }, { section: B24, fake: true });
}


// ---------- (Oct 29 media run) Blocks, and Charge timing (with Rate after the team's Stop) ----------
{
  const BLK = "Blocks", CT = "Charge timing";
  const RIO = "Rio Vance"; // (a name no other run uses, so the invite search finds this run's tester)
  const flagFile = "C:/Users/march/AppData/Local/Temp/claude/C--Users-march-OneDrive-Documents-underwater-game/0dbdc5c7-d413-400f-bc23-94c77a2090d0/scratchpad/media24/OUTAGE-IN-PROGRESS";
  /** Waits while the parent's outage recording has the server stopped. */
  const outageWaitOnly = async () => { while (fs.existsSync(flagFile)) await new Promise((r) => setTimeout(r, 5000)); };
  /** (The shared media server answers slowly tonight: every page of these groups waits up to 4 minutes for a load and 30 seconds for an element.) */
  const patient = () => {
    if (browser._patient) return;
    browser._patient = true;
    const orig = browser.newContext.bind(browser);
    browser.newContext = async (o) => {
      const c = await orig(o);
      const st = c.setDefaultTimeout.bind(c), sn = c.setDefaultNavigationTimeout.bind(c);
      c.setDefaultTimeout = (ms) => st(Math.max(ms, 30000));
      c.setDefaultNavigationTimeout = (ms) => sn(Math.max(ms, 240000));
      return c;
    };
  };
  const outageWait = async () => { patient(); await outageWaitOnly(); };
  /** (The media server is shared with other recordings tonight and can be slow: a set-up call or a page load is tried again once or twice.) */
  const again = async (fn, what) => {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) {
        if (i >= 2) throw e;
        console.log(`   (retrying ${what}: ${String(e.message || e).split("\n")[0].slice(0, 120)})`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  /** A new account, tried again with a fresh address if the server dropped the first try part-way. */
  const acct = async (email, ...rest) => {
    for (let i = 0; ; i++) {
      try { return await account(i ? email.replace("@", `r${i}@`) : email, ...rest); } catch (e) {
        if (i >= 2) throw e;
        console.log(`   (retrying the account: ${String(e.message || e).split(String.fromCharCode(10))[0].slice(0, 120)})`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  const postT = (dev, over) => again(() => postTest(dev, over), "post a test");
  const subD = (dev) => again(() => subscribeDev(dev), "subscribe").catch((e) => console.log("   ! subscribe:", String(e.message).slice(0, 120)));
  const sendW = (t, s, a) => again(() => sendWritten(t, s, a), "send");
  const joinR = (t, id) => again(() => join(t, id), "join");
  const openR = (p, url, sel) => again(async () => { await p.goto(url, { timeout: 240000 }); if (sel) await p.waitForSelector(sel, { timeout: 60000 }); await pause(p, 700); }, "open " + url);
  const say = async (page, sel) => (await page.locator(sel).first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  const utc = "(now() at time zone 'utc')";
  const ago = (d) => `${utc} - interval '${d} days'`;
  /** The test opened `created` days ago with Open until `until` days ago (negative: ahead). */
  const placeTest = (t, created, until) => own(`update "Test" set "createdAt" = ${ago(created)}, "openUntil" = ${ago(until)} where id = '${t}'`);
  /** The tester joined `joined` days ago; their own deadline `due` days ago (negative: ahead). */
  const placeTester = (s, joined, due) => own(`update "Contract" set "joinedAt" = ${ago(joined)}, "dueAt" = ${ago(due)} where id = '${s}'`);
  /** Their answers sent `sent` days ago; the review window ends 7 days after (payBy, as the app sets it). */
  const placeSent = (sub, sent) => own(`update "Submission" set "sentAt" = ${ago(sent)}, "updatedAt" = ${ago(sent)}, "payBy" = ${ago(sent - 7)} where id = '${sub}'`);
  const offered = (sub) => sql(`select coalesce(to_char("choiceOfferedAt", 'YYYY-MM-DD HH24:MI'), '') from "Submission" where id = '${sub}'`);
  /** One run of the 5-minute sweep (the keyed health check), then a few seconds for it to finish. */
  const sweepOnce = async () => {
    await outageWait();
    await fetch(`${BASE}/api/health?key=${HEALTH_KEY}`).catch(() => null);
    await new Promise((r) => setTimeout(r, 9000));
  };
  /** The 5-minute sweep (keyed health check) until `done()` holds: up to 5 minutes on tonight's busy server, pinging again every 20 seconds. */
  const sweepLong = async (done, what) => {
    const end = Date.now() + 300000;
    while (Date.now() < end) {
      await outageWaitOnly();
      fetch(`${BASE}/api/health?key=${HEALTH_KEY}`).catch(() => null);
      for (let i = 0; i < 10 && Date.now() < end; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        if (done()) return true;
      }
    }
    console.log("   ! sweep: nothing yet for", what);
    return false;
  };
  const blockDev =(tester, dev) => post(tester, "/api/blocks", { ...go, userId: dev.uid }).then((r) => ok(r, "block"));
  /** Ticks a tester in the developer's invite panel (search by name). */
  const tickInvite = async (D, who) => {
    await unfold(D, "#invite");
    await D.locator("#invite input[aria-label='Find testers']").scrollIntoViewIfNeeded();
    await D.fill("#invite input[aria-label='Find testers']", who.name);
    const row = D.locator(`#invite li[data-invite-row="${who.uid}"]`).first();
    await row.waitFor({ timeout: 20000 });
    await row.locator("input[type=checkbox]").check();
    return row;
  };
  /** Fills Request a time for this tester on the developer's test page (not pressed). */
  const fillRequest = async (D, who, when) => {
    await unfold(D, "#calls");
    await D.locator("#calls fieldset label", { hasText: who.name }).locator("input").check();
    await D.locator("#calls [aria-label='Requested time 1']").fill(dtLocal(when));
    await D.locator("#calls [aria-label='Length in minutes']").fill("30");
    await D.locator("#calls [aria-label='Requested time 1']").scrollIntoViewIfNeeded();
  };

  // ---------- Blocks ----------
  /** A set-up step that may time out on the busy server: tried again, and the scene goes on without it if it still fails (logged). */
  const soft = (fn, what) => again(fn, what).catch((e) => console.log(`   ! set-up step skipped (${what}):`, String(e.message).split(String.fromCharCode(10))[0].slice(0, 150)));
  /** A developer and a tester working together: a sent part, a call booked, a request waiting, a chat, an invite to an invite-only test and an application. */
  const together = async (tag) => {
    retireName(RIO);
    const nora = await acct(`dev+media${TS}${tag}@playtest.test`, "Nora Lane", "developer", "they");
    await subD(nora);
    const rio = await acct(`tester+media${TS}${tag}r@playtest.test`, RIO, "tester", "they");
    const t = await postT(nora, { title: "Harbor Run: first 3 levels", liveRateCents: "30.00", spots: "4" });
    const s = await joinR(rio, t);
    await sendW(rio, s);
    const call = await bookCall(nora, rio, t, s, 50);
    const when = localAt(3, 15, 0);
    await soft(() => post(nora, `/api/tests/${t}/request-time`, { ...go, contractIds: [s], minutes: 30, times: [when.toISOString()] }).then((r) => ok(r, "request a time")), "request a time");
    await soft(() => post(rio, `/api/sessions/${s}/message`, { body: "Hi! The second bridge is where I got lost; happy to show you on the call." }).then((r) => ok(r, "chat")), "chat");
    await soft(() => post(nora, `/api/sessions/${s}/message`, { body: "Thanks, see you on Thursday." }).then((r) => ok(r, "chat back")), "chat back");
    const tInv = await postT(nora, { title: "Harbor Run: friends and family", joinMode: "invite", spots: "3" });
    await soft(() => post(nora, `/api/tests/${tInv}/invite`, { ...go, testerIds: [rio.uid] }).then((r) => ok(r, "invite")), "invite");
    const tApp = await postT(nora, { title: "Harbor Run: night harbor", joinMode: "apply", spots: "3" });
    ok(await post(rio, `/api/tests/${tApp}/apply`, { ...go, note: "I play a lot of sailing games." }), "apply");
    return { nora, rio, t, s, call, tInv, tApp, sub: subOf(s) };
  };

  group("blk1", async () => {
    // A tester blocks the developer in the middle of a test, with both pages open: everything between them closes at once.
    await outageWait();
    const { nora, rio, t, s, tInv, tApp } = await together("blk1");
    await openR(rio, "/app", "#invitations");
    await shotSpan(rio, "blk-01-before-tester", "Before the block | Rio's dashboard while working on Nora's test: under “Upcoming calls”, “Nora Lane · Harbor Run: first 3 levels · Sat, Oct 31 · 30 min”, and the invitation “Nora Lane invited you to “Harbor Run: friends and family”. Accept opens the test page.” (Rio's application to “Harbor Run: night harbor” is waiting too).", "#invitations", rio.locator("#upcoming-calls").first());
    const D = await rec(V, nora), T = await rec(V, rio);
    await openR(D, `/app/tests/${t}`, `#tester-${s}`);
    await openR(T, `/app/developers/${nora.uid}`, "main");
    await D.locator(`#tester-${s}`).scrollIntoViewIfNeeded();
    const fromD = at(D), fromT = at(T);
    await pause(D, 1500);
    const blockBtn = T.locator("button", { hasText: `Block ${nora.name}` }).first();
    await blockBtn.scrollIntoViewIfNeeded();
    await pause(T, 1000);
    await pressConfirm(T, blockBtn, `Block ${nora.name}`);
    await T.waitForSelector("[data-unblock]", { timeout: 90000 });
    await pause(T, 2000);
    await Promise.all([waitPulse(D), waitPulse(D, 30000)]);
    await pause(D, 3000);
    await T.goto(`/app/sessions/${s}`);
    await pause(T, 3500);
    finishVideo([{ file: await saveVideo(D, "blk-01-d.webm"), from: fromD }, { file: await saveVideo(T, "blk-01-t.webm"), from: fromT }], "blk-01-video",
      "Blocked mid-session, both pages open | Nora's test page (left) and Rio on Nora's profile (right, listing “Applied (waiting)” and “You're in this test”): Rio presses Block Nora Lane and confirms; Rio's page then reads “You blocked Nora Lane, so their tests are hidden.” with Unblock Nora Lane, and Nora's page, on its next update, shows Rio's row as “Work ended” with “Calls: 1 cancelled”; Rio's session page reads “Your session on Harbor Run: first 3 levels ended.”");
    // What each side reads afterwards.
    await openR(nora, `/app/tests/${t}`, `#tester-${s}`);
    console.log("   dev row:", await say(nora, `#tester-${s}`));
    await shot(nora, "blk-01-dev-row", "The developer's row | Rio's row on Nora's test page: “Work ended”, the sent answers still “paid $0.00 of $10.00” (payable), and “Paid in all: $0.00 · Calls: 1 cancelled”.", `#tester-${s}`);
    await unfold(nora, "#calls");
    await nora.locator("#calls").scrollIntoViewIfNeeded().catch(() => {});
    await shot(nora, "blk-01-dev-calls", "Calls and requests closed | Nora's Live session: “Nobody is working on this test right now, so there is nobody to request a call with.” and “No call requests waiting.”: the booked call was cancelled and the waiting request closed.", liveSession(nora));
    await openR(nora, `/app/chat/${s}`, "[data-chat-closed]");
    await shot(nora, "blk-01-dev-chat", "Chat closed | Nora's chat with Rio ends with “This chat is closed.”", "[data-chat-closed]");
    await openBell(nora);
    await shot(nora, "blk-01-dev-bell", "The developer's bell | Nora reads only “Rio Vance's session on Harbor Run: first 3 levels ended.” (never that it was a block).", bellList(nora));
    await openR(rio, `/app/sessions/${s}`, "main");
    console.log("   tester session:", (await say(rio, "main")).slice(0, 400));
    await shotFull(rio, "blk-01-tester-session", "The tester's session page | Rio's page reads “Your session on Harbor Run: first 3 levels ended.”, the test is “Ended” and the sent answers stay “Under review”.");
    await openR(rio, "/app", "main");
    await shotFull(rio, "blk-01-tester-dash", "The tester's dashboard | No invitation and no upcoming call any more; the test is under History: “Ended (Oct 29, 2026): what you sent is still reviewed and paid.”");
    await openBell(rio);
    await shot(rio, "blk-01-tester-bell", "The tester's bell | “Harbor Run: night harbor”: your application was closed.” (the application to Nora's other test closed with the block).", bellList(rio));
    console.log("   invite:", sql(`select status from "Invite" where "testId" = '${tInv}'`), "application:", sql(`select status || ' ' || "closedReason" from "Application" where "testId" = '${tApp}'`));
  }, { section: BLK, fake: true });

  group("blk2", async () => {
    // The races: pages opened before the block, pressed after it.
    await outageWait();
    const { nora, rio, t, s, call, tInv, sub } = await together("blk2");
    const tB = await postT(nora, { title: "Harbor Run: lighthouse", spots: "4" });
    const sB = await joinR(rio, tB);
    const tC = await postT(nora, { title: "Harbor Run: reef", spots: "4" });
    // The booked call starts in 5 minutes (Join call shows from 10 minutes before).
    own(`update "Call" set "startsAt" = ${utc} + interval '5 minutes' where id = '${call}'`);
    // Every page opened before the block.
    const Dpay = await same(nora), Dreq = await same(nora), Dinv = await rec(V, nora);
    const Tsend = await rec(V, rio), Tjoin = await same(rio), Tinv = await same(rio);
    await openR(Dpay, `/app/tests/${t}`, `#piece-${sub}`);
    await Dpay.locator(`#piece-${sub} [data-pay-tick] input`).first().check();
    await openR(Dreq, `/app/tests/${t}`, "#calls");
    await fillRequest(Dreq, rio, localAt(4, 16, 0));
    await openR(Dinv, `/app/tests/${tC}`, "#invite");
    await tickInvite(Dinv, rio);
    await openR(Tsend, `/app/sessions/${sB}`, "#a0");
    await Tsend.locator("#a0").scrollIntoViewIfNeeded();
    await openR(Tjoin, `/app/sessions/${s}`, "[data-join-call] button");
    await openR(Tinv, `/app/find/${tInv}`, "main");
    const fromD = at(Dinv), fromT = at(Tsend);
    await typeSlow(Tsend, "#a0", "The lighthouse stairs are great.", 20);
    await Tsend.locator("#a1").fill("I got stuck at the locked door.");
    const joinBtn = Tinv.locator("button", { hasText: /^Join this test$/ }).first();
    const canJoin = await joinBtn.waitFor({ state: "visible", timeout: 60000 }).then(() => true, () => false);
    if (canJoin) for (const cb of await Tinv.locator("main input[type=checkbox]").all()) await cb.check().catch(() => {});
    else console.log("   ! stale join: no Join button on the invite page:", (await say(Tinv, "main")).slice(0, 300));
    await pause(Dinv, 1000);
    // The block (Rio, in another tab). The server is slow tonight and the pages update on their own once it's done, so each press goes the moment the
    // database shows the block's effect (both sessions ended and the invite cancelled), before any page's next update.
    const blocking = blockDev(rio, nora).catch((e) => console.log("   ! block:", String(e.message).slice(0, 150)));
    const t0b = Date.now();
    while (Date.now() - t0b < 180000 && sql(`select count(*) from "Contract" where id in ('${s}', '${sB}') and status = 'ended'`) !== "2") await new Promise((r) => setTimeout(r, 150));
    while (Date.now() - t0b < 180000 && sql(`select status from "Invite" where "testId" = '${tInv}'`) !== "cancelled") await new Promise((r) => setTimeout(r, 150));
    console.log(`   the block's effect was in the database after ${((Date.now() - t0b) / 1000).toFixed(1)} s`);
    const press = (what, p) => p.catch((e) => console.log(`   ! ${what} press:`, String(e.message).split("\n")[0]));
    await Promise.all([
      press("invite", Dinv.locator("#invite button", { hasText: /^Invite$/ }).click()),
      press("pay", (async () => { await Dpay.locator(`#piece-${sub} [data-pay-tick] input`).first().check(); await Dpay.locator(`#piece-${sub} button`, { hasText: /^Pay$/ }).first().click(); })()),
      press("request", Dreq.click("#calls button:has-text('Request a time')")),
      press("send", Tsend.locator("button", { hasText: /^Send my answers$/ }).first().click()),
      press("join call", Tjoin.locator("[data-join-call] button").first().click()),
      canJoin ? press("join", joinBtn.click()) : null,
    ]);
    await blocking;
    // Each page's answer (the server can be slow tonight).
    const answered = (page, sel) => page.waitForSelector(sel, { timeout: 120000 }).catch(() => console.log("   ! no answer for", sel, "on", page.url()));
    await Promise.all([
      answered(Dinv, "#invite [data-stop-box], #invite .err, #invite .info, #invite [role=alert]"),
      answered(Dpay, `#piece-${sub} [data-stop-box], #piece-${sub} .err, #piece-${sub} .info, #piece-${sub} [role=alert], text=/Paid \\$/`),
      answered(Dreq, "#calls [data-stop-box], #calls .err, #calls .info, #calls [role=alert]"),
      answered(Tsend, "#part-written ~ * .err, [data-stop-box], form .err, form [role=alert], .info"),
      answered(Tjoin, "[data-join-call] .err, [data-join-call] [role=alert], [data-join-call=gone]"),
    ]);
    await pause(Dinv, 1500);
    console.log("   invite race:", (await say(Dinv, "#invite")).slice(-400));
    await shot(Dinv, "blk-02-invite", "Invite vs the block | Nora's Invite for Rio, ticked on a page opened before the block and pressed right after it: nothing is sent; on tonight's overloaded media server the press failed with “Your Invite didn't go through: Something went wrong on our side. Try again in a moment.” (a database time-out; on a quieter earlier run it stopped once with “Rio Vance is no longer in your list”).", "#invite");
    console.log("   pay race:", (await say(Dpay, `#piece-${sub}`)).slice(-400));
    await shot(Dpay, "blk-02-pay", "Pay vs the block | Nora's Pay on Rio's sent answers, ticked on a page opened before the block and pressed right after it: the press goes ahead with no stop (sent work stays payable).", `#piece-${sub}`);
    console.log("   request race:", (await say(Dreq, "#calls")).slice(0, 600));
    await shot(Dreq, "blk-02-request", "Request a time vs the block | From a page opened before the block, with Rio ticked: “Your Request a time didn't go through: Rio Vance's session has ended.” (the rest of that page still shows the state from before the block).", liveSession(Dreq));
    console.log("   send race:", (await say(Tsend, "main")).slice(0, 300));
    await shot(Tsend, "blk-02-send", "Send vs the block | Rio's answers, typed on a session page opened before the block: Send is refused with “Your session on Harbor Run: lighthouse ended.”, and the typed answers stay in their boxes.", Tsend.locator("#a0").locator("xpath=ancestor::form[1]"));
    console.log("   join race:", await say(Tjoin, "[data-join-call]"));
    if (await Tjoin.locator("[data-join-call]").count()) await shot(Tjoin, "blk-02-join-call", "Join call vs the block | Rio's Join call from a page opened before the block: “Your Join call didn't go through: this call isn't available.”", Tjoin.locator("[data-join-call]").first().locator("xpath=ancestor::*[self::li or self::section][1]"));
    if (canJoin) {
      await pause(Tinv, 1500);
      console.log("   stale join:", (await say(Tinv, "main")).slice(-400));
      await shot(Tinv, "blk-02-stale-join", "A stale Join on a closed invite | Rio's join page for the invite-only test, opened before the block: Join is refused.", joinBtn.locator("xpath=ancestor::*[self::form or self::section or self::div][1]"));
    }
    // A moment later: the payment shows on the row.
    await Dpay.waitForSelector("text=/Paid \\$|paid \\$10\\.00 of/", { timeout: 40000 }).catch(() => {});
    console.log("   pay second press:", (await say(Dpay, `#piece-${sub}`)).slice(-300), "| payments:", sql(`select count(*) from "Payment" where "submissionId" = '${sub}' and status = 'charged'`));
    await shot(Dpay, "blk-02-pay-again", "Paid after the block | Moments later Rio's row reads “Work ended” and “paid $10.00 of $10.00”, with Pay more: one payment went through.", (await Dpay.locator(`#piece-${sub}`).count()) ? `#piece-${sub}` : undefined);
    finishVideo([{ file: await saveVideo(Dinv, "blk-02-d.webm"), from: fromD }, { file: await saveVideo(Tsend, "blk-02-t.webm"), from: fromT }], "blk-02-video",
      "Presses that race the block | Nora's invite panel (left, Rio ticked) and Rio typing answers (right): Rio blocks Nora in another tab and both press right after it: Nora's Invite doesn't go through and Rio's Send is refused; then both pages update: Rio is gone from Nora's invite list and Rio's page reads “Your session on Harbor Run: lighthouse ended.”");
  }, { section: BLK, fake: true });

  group("blk3", async () => {
    // Afterwards, and Unblock.
    await outageWait();
    const { nora, rio, t, s, tInv, tApp, sub } = await together("blk3");
    await blockDev(rio, nora);
    const tNew = await postT(nora, { title: "Harbor Run: open sea", spots: "4" });
    // Rio's side: Nora's profile with Unblock, the tests hidden.
    await openR(rio, `/app/developers/${nora.uid}`, "[data-unblock]");
    console.log("   rio sees:", (await say(rio, "main")).slice(0, 400));
    await shotFull(rio, "blk-03-unblock-button", "The blocker's view | Rio still opens Nora's profile: under Open tests “You blocked Nora Lane, so their tests are hidden.”, and Unblock Nora Lane stands where Block was (Report Nora Lane stays).");
    await openR(rio, `/app/find/${tNew}`, "main");
    await shot(rio, "blk-03-test-hidden", "Their tests hidden | A direct link to Nora's test posted after the block reads only “This test isn't available right now.”");
    // Nora's side: Rio's profile isn't available.
    await openR(nora, `/app/testers/${rio.uid}`, "main");
    console.log("   nora sees:", (await say(nora, "main")).slice(0, 200));
    await shot(nora, "blk-03-profile-unavailable", "The blocked side | Nora opens Rio's profile: “This profile isn't available.”, with ← Back (it never says why).");
    // Sent work is still payable, and Dispute works.
    await payWith(nora, sub, "5.00", "Only the first answer was about this build.");
    await openR(nora, `/app/tests/${t}`, "main");
    await nora.waitForSelector(`#tester-${s}`, { timeout: 60000 });
    await pause(nora, 800);
    console.log("   paid row:", (await say(nora, `#tester-${s}`)).slice(0, 300));
    await shot(nora, "blk-03-paid", "Sent work still payable | After the block Nora paid $5.00 of the $10.00 listing for Rio's sent answers: Rio's row (“Work ended”) reads “paid $5.00 of $10.00”, with Pay more still offered.", `#tester-${s}`);
    const T = await rec(V, rio);
    await openR(T, `/app/sessions/${s}`, "#part-written");
    await T.locator("#part-written").scrollIntoViewIfNeeded();
    const from = at(T);
    await pause(T, 1200);
    const dsum = T.locator("summary", { hasText: "Dispute the pay" }).first();
    await dsum.waitFor({ state: "visible", timeout: 60000 });
    await dsum.scrollIntoViewIfNeeded();
    await pause(T, 800);
    await dsum.click();
    await pause(T, 800);
    const box = T.locator("textarea[id^='d-']").first();
    await box.click();
    await T.keyboard.type("I answered both questions in full, as listed.", { delay: 25 });
    await pause(T, 600);
    await T.locator("button", { hasText: /^Send the dispute$/ }).first().click();
    const done = T.locator("p", { hasText: "You disputed this" }).first();
    await done.waitFor({ state: "visible", timeout: 120000 }).catch(() => console.log("   ! blk3: no “You disputed this” line"));
    await done.scrollIntoViewIfNeeded().catch(() => {});
    await pause(T, 2000);
    console.log("   after dispute:", await say(T, "p:has-text('You disputed this')"));
    await shot(T, "blk-03-dispute", "Dispute still works | After the block Rio's part reads “Paid $5.00: you get $4.00 (…) · “Only the first answer was about this build.”” and, once Rio sends a dispute, “You disputed this: waiting for the team.” (cut from the last frame of the video below).", (await done.isVisible().catch(() => false)) ? done.locator("xpath=..") : undefined);
    finishVideo([{ file: await saveVideo(T, "blk-03-dispute.webm"), from }], "blk-03-dispute-video", "Dispute after the block | Rio's sent answers were paid $5.00 of $10.00 after the block; Rio opens “Dispute the pay”, writes why and presses Send the dispute: “You disputed this: waiting for the team.”");
  }, { section: BLK, fake: true });

  group("blk4", async () => {
    // Unblock: the profile and tests come back; what closed stays closed.
    await outageWait();
    const { nora, rio, s, tInv, tApp } = await together("blk4");
    await blockDev(rio, nora);
    await postT(nora, { title: "Harbor Run: open sea", spots: "4" });
    const U = await rec(V, rio);
    await openR(U, `/app/developers/${nora.uid}`, "[data-unblock]");
    await U.locator("[data-unblock]").scrollIntoViewIfNeeded();
    const fromU = at(U);
    await pause(U, 1200);
    await U.locator("[data-unblock]").click();
    await U.waitForSelector("text=Unblocked.", { timeout: 60000 }).catch(() => console.log("   ! no Unblocked. line"));
    await shot(U, "blk-04-unblocked", "Unblock | One press, no confirm: “Unblocked.” shows next to the greyed Unblock Nora Lane button, then the page reloads.").catch((e) => console.log("   ! unblocked shot:", String(e.message).slice(0, 100)));
    await U.waitForSelector("text=Harbor Run: open sea", { timeout: 120000 }).catch(() => {});
    await pause(U, 2500);
    finishVideo([{ file: await saveVideo(U, "blk-04-unblock.webm"), from: fromU }], "blk-04-unblock-video", "Unblock | Rio presses Unblock Nora Lane on Nora's profile: “Unblocked.”, and the reloaded profile lists Nora's open tests again.");
    await openR(rio, `/app/developers/${nora.uid}`, "main");
    await shotFull(rio, "blk-04-profile-back", "After Unblock | Nora's profile lists their open tests again (“Harbor Run: open sea”, “Harbor Run: night harbor”, “Harbor Run: first 3 levels”), with Block Nora Lane back at the bottom.");
    await openR(nora, `/app/testers/${rio.uid}`, "main");
    await shot(nora, "blk-04-nora-sees", "Both ways | Nora can open Rio's profile again: “Your tests with Rio Vance” lists “Harbor Run: first 3 levels · Ended”, with Chat with Rio Vance and Block Rio Vance.");
    await openR(rio, `/app/sessions/${s}`, "main");
    await shotFull(rio, "blk-04-still-closed", "Closed things stay closed | After Unblock Rio's session page still reads “Your session on Harbor Run: first 3 levels ended.”: nothing reopens by itself (the invite stays cancelled, the application closed and the call cancelled).");
    await openR(rio, "/app", "main");
    console.log("   after unblock: invite", sql(`select status from "Invite" where "testId" = '${tInv}'`), "application", sql(`select status from "Application" where "testId" = '${tApp}'`), "call", sql(`select status from "Call" where "contractId" = '${s}'`));
    await shotFull(rio, "blk-04-dash", "The tester's dashboard after Unblock | No invitation comes back; the test stays under History: “Ended (Oct 29, 2026): what you sent is still reviewed and paid.”");
  }, { section: BLK, fake: true });

  // ---------- Charge timing ----------
  group("ct1", async () => {
    // (a) An early tester: sends on day 2 of a 30-day test. 7 days later Charge still waits for their own deadline.
    await outageWait();
    const nora = await acct(`dev+media${TS}ct1@playtest.test`, "Nora Lane", "developer", "they");
    await subD(nora);
    const ana = await acct(`tester+media${TS}ct1a@playtest.test`, "Ana Silva", "tester", "they");
    const t = await postT(nora, { title: "Harbor Run: first 3 levels", openUntil: day(30), spots: "4" });
    const s = await joinR(ana, t);
    await sendW(ana, s);
    const sub = subOf(s);
    // Day 9: opened 9 days ago, Ana joined on day 2 (8 days ago; their deadline is 30 days after joining), sent 7.5 days ago.
    placeTest(t, 9, -21);
    placeTester(s, 8, -22);
    placeSent(sub, 7.5);
    await sweepOnce();
    console.log("   (a) day 9, Charge opened:", offered(sub) || "no");
    await openR(nora, `/app/tests/${t}`, `#piece-${sub}`);
    console.log("   dev piece:", (await say(nora, `#piece-${sub}`)).slice(0, 400));
    await shot(nora, "ct-01-dev-waiting", "(a) 7 days after sending: the developer | Ana sent on day 2 of a 30-day test (“sent Wed, Oct 21”); 7.5 days later Nora's row still reads “If you don't pay by Nov 20, Ana Silva can charge you $10.00, their contract price, or let it go.”: Nov 20 is Ana's own deadline, later than 7 days after sending.", `#piece-${sub}`);
    await openR(ana, "/app", "main");
    await shot(ana, "ct-01-tester-waiting", "(a) 7 days after sending: the tester | Ana's dashboard keeps the test under “Waiting for the developer” (“Written answers sent: waiting for review”); no Charge yet (the tester's pages don't say when Charge opens).", ana.locator("section", { hasText: "Waiting for the developer" }).first());
    await openR(ana, `/app/sessions/${s}`, "#part-written");
    await shot(ana, "ct-01-tester-session", "(a) The session page | “Written answers: Under review”, sent Oct 21: no Charge or Let it go yet.", "#part-written");
    // Day 32: Ana's own deadline passed yesterday. The sweep opens Charge, with both pages open.
    placeTest(t, 32, 2);
    placeTester(s, 31, 1);
    placeSent(sub, 30.5);
    const D = await rec(V, nora), T = await rec(V, ana);
    await openR(D, `/app/tests/${t}`, `#piece-${sub}`);
    await openR(T, `/app/sessions/${s}`, "#part-written");
    await D.locator(`#piece-${sub}`).scrollIntoViewIfNeeded();
    await T.locator("#part-written").scrollIntoViewIfNeeded();
    const fromD = at(D), fromT = at(T);
    await pause(D, 1500);
    await outageWait();
    await sweepLong(() => !!offered(sub), "Ana's Charge");
    console.log("   (a) day 32, Charge opened:", offered(sub) || "no");
    await Promise.all([waitPoll(T, "button:has-text('Let it go')"), waitPulse(D, 30000)]);
    await pause(T, 2500);
    await shot(T, "ct-01-tester-open", "(a) After their own deadline: Charge opens | The day after Ana's deadline the sweep opens it: “Nora Lane didn't review your written answers in 7 days: charge $10.00 or let it go.”, with “Charge Nora Lane $10.00” and Let it go.", "#part-written");
    finishVideo([{ file: await saveVideo(D, "ct-01-d.webm"), from: fromD }, { file: await saveVideo(T, "ct-01-t.webm"), from: fromT }], "ct-01-video",
      "(a) Charge opens at the tester's own deadline | Nora's test page (left) and Ana's session page (right) are open the day after Ana's deadline: the 5-minute sweep opens Charge and Ana's page shows Charge and Let it go.");
    await openR(nora, `/app/tests/${t}`, `#piece-${sub}`);
    await shot(nora, "ct-01-dev-open", "(a) The developer's row once Charge is open | Pay is still there and the “If you don't pay by …” line is gone (the row itself doesn't say Ana can now charge; Nora's bell does).", `#piece-${sub}`);
    await openBell(ana);
    await shot(ana, "ct-01-tester-bell", "(a) The tester's bell | “Nora Lane didn't review your written answers in 7 days: charge $10.00 or let it go”.", bellList(ana));
    await openBell(nora);
    await shot(nora, "ct-01-dev-bell", "(a) The developer's bell | ““Harbor Run: first 3 levels”: Ana Silva's written answers waited over 7 days: pay it (Ana Silva can now charge or let it go).”", bellList(nora));
  }, { section: CT, fake: true });

  group("ct2", async () => {
    // (b) A late joiner: joined on day 20, sends early; the first tester's deadline passes, Charge still waits for the late joiner's own deadline.
    await outageWait();
    const nora = await acct(`dev+media${TS}ct2@playtest.test`, "Nora Lane", "developer", "they");
    await subD(nora);
    const ben = await acct(`tester+media${TS}ct2b@playtest.test`, "Ben Okafor", "tester", "they");
    const cam = await acct(`tester+media${TS}ct2c@playtest.test`, "Cam Lee", "tester", "they");
    const t = await postT(nora, { title: "Harbor Run: lighthouse", openUntil: day(30), spots: "4" });
    const sB = await joinR(ben, t), sC = await joinR(cam, t);
    await sendW(ben, sB);
    await sendW(cam, sC);
    const subB = subOf(sB), subC = subOf(sC);
    // Day 32: Ben joined on day 1 (deadline yesterday), sent on day 2; Cam joined on day 20 (deadline 18 days ahead), sent on day 21.
    placeTest(t, 32, 2);
    placeTester(sB, 31, 1);
    placeSent(subB, 30);
    placeTester(sC, 12, -18);
    placeSent(subC, 11);
    await sweepLong(() => !!offered(subB), "Ben's Charge");
    console.log("   (b) day 32: Ben", offered(subB) || "no", "/ Cam", offered(subC) || "no");
    await openR(nora, `/app/tests/${t}`, `#piece-${subC}`);
    console.log("   dev Cam piece:", (await say(nora, `#piece-${subC}`)).slice(0, 300));
    await shot(nora, "ct-02-dev-cam-waits", "(b) The late joiner still waits: the developer | The first testers' deadlines have passed, but Cam joined on day 20: Cam's row (sent Oct 18) reads “If you don't pay by Nov 16, Cam Lee can charge you $10.00, their contract price, or let it go.”, Nov 16 being Cam's own deadline.", `#piece-${subC}`);
    await shot(nora, "ct-02-dev-ben-open", "(b) The early tester: Charge is open | Ben joined on day 1 and sent on day 2 (“sent Tue, Sep 29”); their deadline passed yesterday, so Charge opened and the “If you don't pay by” line is gone.", `#piece-${subB}`);
    await openR(cam, "/app", "main");
    await shot(cam, "ct-02-cam-waiting", "(b) The late joiner's dashboard | Cam's answers stay under “Waiting for the developer” (“Written answers sent: waiting for review”): no Charge or cancel yet.", cam.locator("section", { hasText: "Waiting for the developer" }).first());
    await openR(ben, "/app", "#charge-or-cancel");
    await shot(ben, "ct-02-ben-charge", "(b) The early tester's dashboard | “Charge or cancel 1”: “Parts the developer hasn't reviewed once 7 days have passed since you sent them and your deadline has passed: charge for them, or let them go.” and “Harbor Run: lighthouse · 1 part” with “Charge or let it go →”.", "#charge-or-cancel");
    // Day 51: Cam's own deadline passed yesterday.
    placeTest(t, 51, 21);
    placeTester(sC, 31, 1);
    placeSent(subC, 30);
    await sweepLong(() => !!offered(subC), "Cam's Charge");
    console.log("   (b) day 51: Cam", offered(subC) || "no");
    await openR(cam, `/app/sessions/${sC}`, "#part-written");
    await shot(cam, "ct-02-cam-open", "(b) After the late joiner's own deadline | Charge opens for Cam only now: “Nora Lane didn't review your written answers in 7 days: charge $10.00 or let it go.”", "#part-written");
    await openBell(cam);
    await shot(cam, "ct-02-cam-bell", "(b) The late joiner's bell | “Nora Lane didn't review your written answers in 7 days: charge $10.00 or let it go” arrives only after Cam's own deadline.", bellList(cam));
  }, { section: CT, fake: true });

  group("ct3", async () => {
    // (c) Work sent on the last day: Charge opens 7 days after sending.
    await outageWait();
    const nora = await acct(`dev+media${TS}ct3@playtest.test`, "Nora Lane", "developer", "they");
    await subD(nora);
    const dee = await acct(`tester+media${TS}ct3d@playtest.test`, "Dee Park", "tester", "they");
    const t = await postT(nora, { title: "Harbor Run: reef", openUntil: day(14), spots: "4" });
    const s = await joinR(dee, t);
    await sendW(dee, s);
    const sub = subOf(s);
    // (Owner's addition) Eve, on the same days as Dee, is paid early, so the test has a Pay more box whose closing date can be shown.
    const eve = await acct(`tester+media${TS}ct3e@playtest.test`, "Eve Moss", "tester", "they");
    const sE = await joinR(eve, t);
    await sendW(eve, sE);
    const subE = subOf(sE);
    await apiPay(nora, subE, "10.00");
    // Day 15: Dee joined on day 0 (deadline yesterday) and sent on their last day.
    placeTest(t, 15, 1);
    placeTester(s, 15, 1);
    placeTester(sE, 15, 1);
    placeSent(sub, 1.05);
    await sweepOnce();
    console.log("   (c) day 15:", offered(sub) || "no");
    await openR(nora, `/app/tests/${t}`, `#piece-${sub}`);
    console.log("   dev piece:", (await say(nora, `#piece-${sub}`)).slice(0, 300));
    await shot(nora, "ct-03-dev-waiting", "(c) Sent on the last day: the developer | Dee's deadline passed yesterday, but they sent on their last day (“sent Wed, Oct 28”), so the row reads “If you don't pay by Nov 4, Dee Park can charge you $10.00, their contract price, or let it go.”: 7 days after sending.", `#piece-${sub}`);
    await openR(dee, `/app/sessions/${s}`, "#part-written");
    await shot(dee, "ct-03-tester-waiting", "(c) Sent on the last day: the tester | “Written answers: Under review”, sent Oct 28: no Charge yet, although Dee's deadline has passed.", "#part-written");
    // Day 21.5: 7 days after sending.
    placeTest(t, 21.5, 7.5);
    placeTester(s, 21.5, 7.5);
    placeTester(sE, 21.5, 7.5);
    placeSent(sub, 7.55);
    await sweepLong(() => !!offered(sub), "Dee's Charge");
    console.log("   (c) day 21.5:", offered(sub) || "no");
    await openR(dee, `/app/sessions/${s}`, "#part-written");
    await shot(dee, "ct-03-tester-open", "(c) 7 days after sending: Charge opens | “Nora Lane didn't review your written answers in 7 days: charge $10.00 or let it go.”, with Charge and Let it go.", "#part-written");
    await openBell(dee);
    const ct3bell = () => shot(dee, "ct-03-tester-bell", "(c) The tester's bell | “Nora Lane didn't review your written answers in 7 days: charge $10.00 or let it go”, 7 days after “Work sent: your written answers for “Harbor Run: reef””.", bellList(dee));
    await ct3bell();
    // (Owner's addition, Oct 29) Later: 15 days after sending (every date moved back 7.5 more days, as the days would have passed; nothing paid or charged meanwhile).
    // Sent on day D (Dee's own deadline, the last tester's), Charge opened D+7, the test's close-out is D+14, and this piece's own window runs to D+21 (14 days after
    // its Charge opened), later than the close-out: Charge, Pay and the test's Pay more all close then.
    const mv = "interval '7.5 days'";
    own(`update "Submission" set "sentAt" = "sentAt" - ${mv}, "updatedAt" = "updatedAt" - ${mv}, "payBy" = "payBy" - ${mv}, "choiceOfferedAt" = "choiceOfferedAt" - ${mv}, "choiceBy" = "choiceBy" - ${mv}, "remindedAt" = "remindedAt" - ${mv}, "devRemindedAt" = "devRemindedAt" - ${mv} where id = '${sub}'`);
    own(`update "Submission" set "sentAt" = "sentAt" - ${mv}, "updatedAt" = "updatedAt" - ${mv}, "payBy" = "payBy" - ${mv} where id = '${subE}'`);
    placeTest(t, 29, 15);
    placeTester(s, 29, 15);
    placeTester(sE, 29, 15);
    const sentAt = new Date(sql(`select to_char("sentAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from "Submission" where id = '${sub}'`));
    const dd = (n) => new Date(sentAt.getTime() + n * 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const rel = `sent on day D (${dd(0)}), Charge opened D+7 (${dd(7)}), the test's close-out was D+14 (${dd(14)}), this piece closes D+21 (${dd(21)})`;
    console.log("   (c) later:", rel);
    await openR(dee, `/app/sessions/${s}`, "#part-written");
    console.log("   tester part:", (await say(dee, "#part-written")).slice(0, 300));
    await shot(dee, "ct-03-tester-charge-closes", `(c) Charge closes on D+21 | 15 days after sending, the tester's Charge box says “Charge closes on ${dd(21)}, ${sentAt.getFullYear()}.”: ${rel}, so this piece stays open a week past the close-out.`, "#part-written");
    await openR(nora, `/app/tests/${t}`, `#piece-${sub}`);
    console.log("   dev piece:", (await say(nora, `#piece-${sub}`)).slice(0, 300));
    await shot(nora, "ct-03-dev-pay-closes", `(c) Pay closes on D+21 | The developer's Needs you row for the same piece: “Pay closes on ${dd(21)}, ${sentAt.getFullYear()}.” (${rel}).`, `#piece-${sub}`);
    const pm = nora.locator(`#piece-${subE}`).first();
    if (await pm.count()) {
      await unfold(nora, `#piece-${subE}`);
      console.log("   pay more:", (await say(nora, `#piece-${subE}`)).slice(0, 300));
      await shot(nora, "ct-03-dev-pay-more-closes", `(c) Pay more closes the same day | Eve's paid answers on the same test: Pay more closes with the last Pay or Charge on the test, “Pay more closes on ${dd(21)}, ${sentAt.getFullYear()}.” (D+21, not the D+14 close-out).`, pm);
    } else console.log("   ! (c) no piece box for Eve's paid answers");
  }, { section: CT, fake: true });

  group("ct4", async () => {
    // Rate after the team's Stop: a page open before the stop stops once with "This test was stopped at …", the second press rates; a page opened after rates at once.
    await outageWait();
    const nora = await acct(`dev+media${TS}ct4@playtest.test`, "Nora Lane", "developer", "they");
    await subD(nora);
    const ana = await acct(`tester+media${TS}ct4a@playtest.test`, "Ana Silva", "tester", "they");
    const ben = await acct(`tester+media${TS}ct4b@playtest.test`, "Ben Okafor", "tester", "they");
    const admin = await adminAccount();
    const t = await postT(nora, { title: "Harbor Run: first 3 levels", spots: "4" });
    const sA = await joinR(ana, t), sB = await joinR(ben, t);
    await sendW(ana, sA);
    await sendW(ben, sB);
    await apiPay(nora, subOf(sA), "10.00");
    await apiPay(nora, subOf(sB), "10.00");
    const T = await rec(V, ana);
    await openR(T, `/app/sessions/${sA}`, "#rate");
    await T.locator("#rate").scrollIntoViewIfNeeded();
    const from = at(T);
    await waitPulse(T);
    await pause(T, 1000);
    await T.locator("#rate select").selectOption("5").catch(() => {});
    const cm = T.locator("#rate textarea").first();
    if (await cm.isVisible().catch(() => false)) { await cm.click(); await T.keyboard.type("Clear steps and quick pay.", { delay: 25 }); }
    await adminDo(admin, "stop-test", t, { note: "Media pass check: against the content rules" });
    await pause(T, 800);
    await pressConfirm(T, T.locator("#rate button", { hasText: /^Rate( and finish)?$/ }).first(), "Rate and finish");
    await T.waitForSelector("#rate [data-stop-box]", { timeout: 15000 }).catch(() => console.log("   ! ct4: no stop box"));
    await pause(T, 1800);
    console.log("   stop box:", await say(T, "#rate [data-stop-box]"));
    await shot(T, "ct-04-rate-stops", "Rate after the team's Stop: the first press stops | Ana's Rate and finish, from a page opened before the team stopped the test: “Your Rate didn't go through. Since you opened this page: This test was stopped at <time>.” and “Press Rate again to go ahead.” (the stop time shows twice: “<time>. · <time>”).", "#rate");
    await pressConfirm(T, T.locator("#rate button", { hasText: /^Rate( and finish)?$/ }).first(), "Rate and finish");
    await waitPoll(T, "#rate select", true, 40000);
    await pause(T, 2000);
    console.log("   after second press:", (await say(T, "#rate")).slice(0, 200));
    await shot(T, "ct-04-rated", "The second press rates | The page then reads “You rated Nora Lane.”; its banner says “Nora Lane stopped the test on Oct 29, 2026. You can still ask to show an excerpt and chat. Work you sent is still reviewed.”, although the team stopped it.", (await T.locator("#rate").isVisible().catch(() => false)) ? "#rate" : undefined);
    finishVideo([{ file: await saveVideo(T, "ct-04-rate.webm"), from }], "ct-04-rate-video", "Rate stops once for the team's Stop | The team stops the test while Ana's page is open: the first Rate press stops with “This test was stopped at <time>.”, the second rates and the page reads “You rated Nora Lane.”");
    // A page opened after the stop: rates on the first press.
    const B = await rec(V, ben);
    await openR(B, `/app/sessions/${sB}`, "#rate");
    await B.locator("#rate").scrollIntoViewIfNeeded();
    const fromB = at(B);
    await pause(B, 1200);
    await B.locator("#rate select").selectOption("4").catch(() => {});
    await pressConfirm(B, B.locator("#rate button", { hasText: /^Rate( and finish)?$/ }).first(), "Rate and finish");
    await waitPoll(B, "#rate select", true, 40000);
    await pause(B, 2000);
    if (await B.locator("#rate [data-stop-box]").count()) console.log("   ! ct4: Ben's page opened after the stop stopped anyway");
    console.log("   Ben after first press:", (await say(B, "#rate")).slice(0, 200));
    await shot(B, "ct-04-after-stop", "A page opened after the stop | Ben opens their session page after the team's Stop and rates: the first press goes through (no stop box) and the page reads “You rated Nora Lane.”", (await B.locator("#rate").isVisible().catch(() => false)) ? "#rate" : undefined);
    finishVideo([{ file: await saveVideo(B, "ct-04-after.webm"), from: fromB }], "ct-04-after-video", "Opened after the stop | Ben's page was opened after the team stopped the test, so Rate goes through on the first press.");
  }, { section: CT, fake: true });
}


// ---------- Outages, for real (owner approved, Oct 29): the 3450 server really stopped for about 16 minutes ----------
{
  const OUT_SEC = "Outages";
  /** Recordings cut to the parts worth watching: each part keeps its [from, to] spans (seconds into its own recording), side by side when two. */
  const cutVideo = (parts, name, caption) => {
    const file = `${name}${SFX}.webm`;
    const out = path.join(OUT, file);
    const sel = (spans) => `select='${spans.map(([a, b]) => `between(t,${a.toFixed(2)},${b.toFixed(2)})`).join("+")}',setpts=N/(25*TB)`;
    for (let kbps = 1200; ; kbps = Math.floor(kbps * 0.6)) {
      const args = ["-y", "-loglevel", "error"];
      for (const p of parts) args.push("-i", p.file);
      if (parts.length === 2) args.push("-filter_complex", `[0:v]${sel(parts[0].keep)},scale=-2:720,setsar=1,pad=iw+8:ih:0:0:0x101826[a];[1:v]${sel(parts[1].keep)},scale=-2:720,setsar=1[b];[a][b]hstack=inputs=2:shortest=1[v]`, "-map", "[v]");
      else args.push("-vf", sel(parts[0].keep));
      args.push("-c:v", "libvpx", "-b:v", `${kbps}k`, "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`, "-crf", "12", "-an", out);
      execFileSync(FFMPEG, args);
      if (fs.statSync(out).size <= MAX_VIDEO_BYTES || kbps < 250) break;
    }
    record(file, caption, "video");
  };
  /** Runs fn with the phone's size settings (file suffix, size), then back to the desktop's. */
  const asPhone = async (fn) => {
    const keep = [V, SFX, SIZE];
    V = PHONE; SFX = "-phone"; SIZE = "phone";
    try { return await fn(); } finally { [V, SFX, SIZE] = keep; }
  };
  const health = (ms = 30000) => fetch(`${BASE}/api/health?key=${HEALTH_KEY}`, { signal: AbortSignal.timeout(ms) }).then((r) => r.status, (e) => "no answer (" + (e.cause?.code || e.name) + ")");
  const alertTo = (type) => fetch(`${BASE}/api/health/alert`, { method: "POST", headers: { "content-type": "application/json", "x-health-key": HEALTH_KEY }, body: JSON.stringify({ alertType: type, alertDateTime: Math.floor(Date.now() / 1000) }), signal: AbortSignal.timeout(15000) })
    .then(async (r) => `${r.status} ${await r.text()}`, (e) => "not delivered: " + (e.cause?.code || e.name));
  const hhmm = (d = new Date()) => d.toTimeString().slice(0, 8);

  group("outreal", async () => {
    // Needs MEDIA_SERVER_PIDFILE (the PID of the 3450 server this run started) and MEDIA_SERVER_START (a script that starts it again and writes the new PID there).
    const pidFile = process.env.MEDIA_SERVER_PIDFILE, startScript = process.env.MEDIA_SERVER_START;
    if (!pidFile || !startScript) throw new Error("outreal needs MEDIA_SERVER_PIDFILE and MEDIA_SERVER_START");
    const DOWN_MIN = Number(process.env.OUTAGE_MINUTES || 16);
    // A small stand-in for UptimeRobot: the keyed /api/health every minute; after two failed checks in a row it sends its "down" alert to the alert webhook
    // (APP_URL/api/health/alert, as UptimeRobot's webhook contact would), on the first success after that its "up" alert. Everything it sees goes to the log.
    const plog = [];
    let state = "up", fails = 0;
    const pingOnce = async () => {
      const s = await health();
      fails = s === 200 ? 0 : fails + 1;
      const line = `${hhmm()} keyed /api/health → ${s}`;
      plog.push(line);
      console.log("   [pinger]", line);
      if (fails >= 2 && state === "up") {
        state = "down";
        const r = await alertTo(1);
        plog.push(`${hhmm()} down alert → ${r}`);
        console.log("   [pinger] down alert →", r);
      } else if (s === 200 && state === "down") {
        state = "up";
        const r = await alertTo(2);
        plog.push(`${hhmm()} up alert → ${r}`);
        console.log("   [pinger] up alert →", r);
      }
    };
    await pingOnce();
    const timer = setInterval(() => pingOnce().catch(() => {}), 60000);
    try {
      const nora = await account(`dev+media${TS}or@playtest.test`, "Nora Lane", "developer", "she");
      const ana = await account(`tester+media${TS}ora@playtest.test`, "Ana Silva", "tester", "she");
      const admin = await adminAccount();
      await subscribeDev(nora);
      const t = await postTest(nora, { productName: "Harbor Run", title: "Harbor Run: first 3 levels", liveRateCents: "30.00" });
      const sA = await join(ana, t);
      await sendWritten(ana, sA);
      const call = await bookCall(nora, ana, t, sA, 3);
      // Ana's deadline 6 hours from now, so her page shows the time left (a date alone wouldn't show a 16-minute move).
      own(`update "Contract" set "dueAt" = (now() at time zone 'utc') + interval '6 hours' where id = '${sA}'`);
      const clocks = () => sql(`select 'Ana''s deadline ' || to_char(c."dueAt", 'HH24:MI:SS') || ' / Open until ' || to_char(t."openUntil", 'MM-DD HH24:MI:SS') || ' / pay by ' || to_char(s."payBy", 'MM-DD HH24:MI:SS') || ' / call ' || to_char(k."startsAt", 'HH24:MI') from "Contract" c join "Test" t on t.id = c."testId" join "Submission" s on s."contractId" = c.id join "Call" k on k."contractId" = c.id where c.id = '${sA}' and k.id = '${call}'`);
      const before = clocks();
      console.log("   clocks before (UTC):", before);
      const outagesBefore = sql(`select count(*) from "Outage"`);
      // The pages, open the whole time: desktop and phone, developer and tester.
      const D = await rec(V, nora), T = await rec(V, ana);
      const Dp = await rec(PHONE, nora), Tp = await rec(PHONE, ana);
      for (const P of [D, Dp]) await P.goto(`/app/tests/${t}`);
      for (const P of [T, Tp]) await P.goto(`/app/sessions/${sA}`);
      const from = new Map([[D, at(D)], [T, at(T)], [Dp, at(Dp)], [Tp, at(Tp)]]);
      await pause(D, 2500);
      const tStart = new Map([...from.keys()].map((P) => [P, at(P)]));
      await shot(D, "outage-real-before-dev", "Before: the developer's page | Nora's test page while the site is up: Ana's written answers waiting in Needs you (“Listing: $10.00 for written answers”), with a call booked for later today.");
      await shot(T, "outage-real-before-tester", "Before: the tester's page | Ana's session page while the site is up: “Your deadline on Harbor Run: first 3 levels is in 5 hours 59 minutes: send your work before then.” and “Due … · 5 h 59 min left”.");
      await asPhone(async () => {
        await shot(Dp, "outage-real-before-dev", "Before: the developer's page | Nora's test page on a phone while the site is up.");
        await shot(Tp, "outage-real-before-tester", "Before: the tester's page | Ana's session page on a phone while the site is up, with the time left before their deadline.");
      });
      await pause(D, 1500);
      // Stop the server: only the process this run started (its PID and its children), never any other node process.
      const pid = fs.readFileSync(pidFile, "utf8").trim();
      if (!/^\d+$/.test(pid)) throw new Error("no PID in " + pidFile);
      const stoppedAt = new Date();
      console.log(`   ${hhmm()} stopping the media server (PID ${pid} and its children)`);
      execFileSync("taskkill", ["/PID", pid, "/T", "/F"]);
      await new Promise((r) => setTimeout(r, 4000));
      console.log("   after the stop:", await health());
      const tStop = new Map([...from.keys()].map((P) => [P, at(P)]));
      // The open pages try again: the browser can't connect.
      for (const P of [D, T, Dp, Tp]) await P.reload({ timeout: 15000 }).catch(() => {});
      await pause(D, 3000);
      await shot(D, "outage-real-down-dev", `The site is down | ${DOWN_MIN} real minutes with the server stopped: reloading Nora's test page gives the browser's own “This site can't be reached” page (connection refused).`);
      await asPhone(() => shot(Tp, "outage-real-down-tester", "The site is down | Ana's page on a phone, reloaded while the server is stopped: the browser can't connect."));
      await pause(D, 3000);
      const tDownShown = new Map([...from.keys()].map((P) => [P, at(P)]));
      // The wait (trimmed from the video), with the pinger failing each minute.
      const until = stoppedAt.getTime() + DOWN_MIN * 60000;
      while (Date.now() < until) await new Promise((r) => setTimeout(r, Math.min(30000, until - Date.now())));
      console.log(`   ${hhmm()} starting the media server again`);
      execFileSync(process.execPath, [startScript], { stdio: "inherit" });
      const upBy = Date.now() + 180000;
      while (Date.now() < upBy && (await health(10000)) !== 200) await new Promise((r) => setTimeout(r, 3000));
      const restartedAt = new Date();
      console.log(`   ${hhmm()} the server answers again`);
      await pingOnce(); // (the stand-in's next check finds it up and sends the up alert)
      const tBack = new Map([...from.keys()].map((P) => [P, at(P)]));
      for (const P of [D, T, Dp, Tp]) await P.reload({ timeout: 120000 }).catch((e) => console.log("   ! reload:", String(e).slice(0, 120)));
      await pause(D, 6000);
      for (const P of [D, T, Dp, Tp]) await tick(P);
      await pause(D, 4000);
      const after = clocks();
      const outagesAfter = sql(`select count(*) from "Outage"`);
      const recorded = Number(outagesAfter) > Number(outagesBefore);
      console.log("   clocks after (UTC):", after, "· outages before/after:", outagesBefore, outagesAfter);
      console.log("   pinger log:\n     " + plog.join("\n     "));
      const span = `${hhmm(stoppedAt).slice(0, 5)}–${hhmm(restartedAt).slice(0, 5)}`;
      const what = recorded ? "the outage was recorded and the clocks moved" : "nothing was recorded and no clock moved";
      await shot(D, "outage-real-after-dev", `After the restart: the developer's page | The server answers again after ${DOWN_MIN} real minutes stopped (${span} local): ${recorded ? "the live box says the site was down" : "no “The site was down” line, and Ana's call and dates are as before"} (${what}).`);
      await shot(T, "outage-real-after-tester", `After the restart: the tester's page | Ana's page after the restart: ${recorded ? "the outage line and the deadline moved later" : "the same deadline and time left as before the stop (nothing moved)"}.`);
      await asPhone(async () => {
        await shot(Dp, "outage-real-after-dev", `After the restart: the developer's page | On a phone after the restart: ${recorded ? "the outage line" : "no outage line; nothing moved"}.`);
        await shot(Tp, "outage-real-after-tester", `After the restart: the tester's page | Ana's page on a phone after the restart: ${recorded ? "the deadline moved later" : "the same deadline as before"}.`);
      });
      const tEnd = new Map([...from.keys()].map((P) => [P, at(P)]));
      const files = new Map();
      for (const [P, n] of [[D, "or-d"], [T, "or-t"], [Dp, "or-dp"], [Tp, "or-tp"]]) files.set(P, await saveVideo(P, `${n}.webm`));
      const keep = (P) => [[tStart.get(P) - 1, tDownShown.get(P)], [tBack.get(P) - 1, tEnd.get(P)]];
      const vcap = `A real outage, ${DOWN_MIN} minutes | The server was really stopped at ${hhmm(stoppedAt).slice(0, 5)} and started again at ${hhmm(restartedAt).slice(0, 5)} (local); about ${DOWN_MIN} real minutes of waiting were trimmed from this video. Nora's test page (left) and Ana's session page (right): before, the browser can't connect, and after the restart ${what}.`;
      cutVideo([{ file: files.get(D), keep: keep(D) }, { file: files.get(T), keep: keep(T) }], "outage-real", vcap);
      await asPhone(async () => cutVideo([{ file: files.get(Dp), keep: keep(Dp) }, { file: files.get(Tp), keep: keep(Tp) }], "outage-real", vcap));
      // The admin console's Outages box, and the stand-in's log as a picture (a page in the browser, not the app).
      await admin.goto("/admin#outages");
      await admin.waitForSelector("#outages", { timeout: 120000 });
      await shot(admin, "outage-real-admin", `The admin's Outages after the real stop | ${recorded ? "The outage is listed with its length." : "No new outage is listed: the stand-in's “down” alert couldn't reach the stopped server, and the “up” alert alone records nothing."}`, "#outages");
      const L = await ctx(DESKTOP);
      await L.setContent(`<pre style="font:14px/1.5 ui-monospace,monospace;padding:16px;background:#0b1020;color:#cbd5e1;margin:0">The stand-in for UptimeRobot (a local script): keyed /api/health every minute,\nthe "down" alert after two failed checks in a row and the "up" alert on the first success after it,\nboth to the app's alert webhook (/api/health/alert, as UptimeRobot's webhook contact would).\n\n${plog.map((l) => l.replace(/[<>&]/g, "")).join("\n")}</pre>`);
      await L.setViewportSize({ width: 1100, height: Math.min(1400, 140 + plog.length * 21) });
      await L.screenshot({ path: path.join(OUT, "outage-real-pinger.png") });
      record("outage-real-pinger.png", `The stand-in's log | What the local stand-in for UptimeRobot saw each minute: ${plog.filter((l) => /→ no answer/.test(l)).length} failed checks while the server was stopped, its down alert ${plog.some((l) => /down alert → not delivered/.test(l)) ? "not delivered (connection refused: the alert webhook is on the stopped server)" : "delivered"}, and the up alert's answer.`, "image");
      await L.context().close();
      console.log(`   real outage: ${what}; clocks before ${before} / after ${after}`);
    } finally {
      clearInterval(timer);
    }
  }, { section: OUT_SEC, fake: true, optIn: true });

  group("outlong", async () => {
    // Over 24 hours (the clock moved, not waited): the down alert arrives, its stored time is moved 25 hours back, then the up alert: recorded, nothing moves until
    // an admin presses "Approve: move every timer". Moves every running timer in the database (as in the app), so it is opt-in.
    const nora = await account(`dev+media${TS}ol@playtest.test`, "Nora Lane", "developer", "she");
    const ana = await account(`tester+media${TS}ola@playtest.test`, "Ana Silva", "tester", "she");
    const admin = await adminAccount();
    await subscribeDev(nora);
    const t = await postTest(nora, { productName: "Harbor Run", title: "Harbor Run: first 3 levels" });
    const sA = await join(ana, t);
    const due = () => sql(`select to_char("dueAt", 'YYYY-MM-DD HH24:MI') || ' / Open until ' || (select to_char("openUntil", 'YYYY-MM-DD HH24:MI') from "Test" where id = '${t}') from "Contract" where id = '${sA}'`);
    const before = due();
    const alert = (type) => fetch(`${BASE}/api/health/alert`, { method: "POST", headers: { "content-type": "application/json", "x-health-key": HEALTH_KEY }, body: JSON.stringify({ alertType: type, alertDateTime: Math.floor(Date.now() / 1000) }) }).then((r) => r.json());
    const down = await alert(1);
    if (!down.ok) throw new Error("down alert refused: " + JSON.stringify(down));
    sql(`update "AppState" set value = to_char((now() at time zone 'utc') - interval '25 hours', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where key = 'outage-down'`);
    const up = await alert(2);
    if (!up.ok || !up.outage || !up.outage.needsApproval) throw new Error("up alert: " + JSON.stringify(up));
    const mid = due();
    console.log("   long outage: before", before, "· after the up alert", mid);
    await ana.goto(`/app/sessions/${sA}`);
    await shot(ana, "outage-long-tester-before", `Over 24 hours: the tester's page before Approve | The clock was moved so the down and up alerts are 25 hours apart: Ana's deadline hasn't moved yet (UTC ${before.split(" / ")[0]}, the same after the up alert).`);
    const A = await rec(V, admin);
    await A.goto("/admin#outages");
    await A.waitForSelector("#outages");
    const from = at(A);
    const box = A.locator("#outages");
    await box.scrollIntoViewIfNeeded();
    await pause(A, 1500);
    await shot(A, "outage-long-admin", "Over 24 hours: waiting for Approve | The admin's Outages: “Over 24 hours: the uptime service says the site was down from … to … (25 h). Nothing has moved yet.” with “Approve: move every timer”.", "#outages");
    await A.locator("#outages button", { hasText: "Approve: move every timer" }).first().click();
    await pause(A, 3000);
    await A.reload();
    await A.locator("#outages").scrollIntoViewIfNeeded();
    await pause(A, 2000);
    await shot(A, "outage-long-approved", "Approved | After Approve the outage is an ordinary one in the list, and every running timer moved 25 hours later.", "#outages");
    finishVideo([{ file: await saveVideo(A, "outlong-a.webm"), from }], "outage-long-video", "Approve: move every timer | An outage over 24 hours waits in the admin's Outages; nothing moves until the admin presses Approve, then every timer moves by its length.");
    const after = due();
    console.log("   long outage: after Approve", after);
    await ana.goto(`/app/sessions/${sA}`);
    await shot(ana, "outage-long-tester-after", `After Approve: the tester's page | Ana's deadline moved 25 hours later (UTC ${before.split(" / ")[0]} → ${after.split(" / ")[0]}).`);
    await openBell(ana);
    await shot(ana, "outage-long-bell", "The tester's bell | After Approve, the outage line: “The site was down from … to …. Deadlines and payment dates moved 25 h later.”", bellList(ana));
  }, { section: OUT_SEC, fake: true, optIn: true });
}


// ---------- Emails: every kind of email the app sends, as received (the "Emails" section) ----------
{
  const EM_SEC = "Emails";
  /** The newest outbox email to this address whose subject matches (SQL LIKE), or null. */
  const outboxRow = (to, like) => {
    const id = sql(`select id from "OutboxEmail" where ${to ? `"to" = ${lit(to)} and ` : ""}subject like ${lit(like)} order by "createdAt" desc limit 1`);
    if (!id) return null;
    // (each column as base64 of its UTF-8 bytes: psql's console encoding would mangle the quotes and line breaks)
    const get = (col) => Buffer.from(sql(`select encode(convert_to(${col}, 'UTF8'), 'base64') from "OutboxEmail" where id = '${id}'`).replace(/\s+/g, ""), "base64").toString("utf8");
    return { id, to: get(`"to"`), subject: get("subject"), text: get("text"), html: get("html"), at: get(`to_char("createdAt", 'YYYY-MM-DD HH24:MI')`) };
  };
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  /** Sign-in and reset links work once: their token is shown as <token>. Addresses that aren't this run's throwaway ones (the team's) are named, not shown. */
  const tidy = (s) => String(s).replace(/(\/(reset|verify|confirm)[/=])[A-Za-z0-9_-]{12,}/g, "$1&lt;token&gt;").replace(/token=[A-Za-z0-9_-]{12,}/g, "token=&lt;token&gt;");
  const toLabel = (to) => (/@playtest\.test$/.test(to) ? to : "the team's address (ADMIN_EMAILS)");
  /**
   * One email drawn as a mail app would: From / To / Subject, then its HTML part when it has one, otherwise its plain text (lines, links as links), as the dev
   * outbox (/dev/outbox) shows it. Saved as <name>.png at the current size.
   */
  const mailShot = async (page, row, name, caption) => {
    if (!row) { console.log("   ! no email for", name); return; }
    const body = row.html
      ? `<div class="html">${tidy(row.html)}</div>`
      : row.text.split("\n").map((l) => (/^https?:\/\//.test(l) ? `<p><a href="#">${tidy(esc(l))}</a></p>` : l.startsWith("• ") ? `<p class="li">${tidy(esc(l)).replace(/ (https?:\/\/\S+)$/, ' <a href="#">$1</a>')}</p>` : `<p>${tidy(esc(l)) || "&nbsp;"}</p>`)).join("");
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      body{margin:0;background:#e9edf3;font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827}
      .mail{max-width:760px;margin:16px auto;background:#fff;border:1px solid #d6dbe3;border-radius:10px;overflow:hidden}
      .head{padding:14px 18px;border-bottom:1px solid #e5e7eb;background:#f8fafc;font-size:13px;color:#4b5563}
      .head b{color:#111827}.subj{font-size:18px;font-weight:600;color:#111827;margin:6px 0 2px}
      .body{padding:16px 18px;word-break:break-word}.body p{margin:0 0 4px}.li{padding-left:2px}a{color:#2563eb}
      .kind{font-size:12px;color:#6b7280;padding:8px 18px;border-top:1px solid #eef0f4;background:#fafafa}
    </style></head><body><div class="mail" id="mail"><div class="head"><div>From <b>Playtest</b> · To <b>${esc(toLabel(row.to))}</b> · ${esc(row.at)} UTC</div><div class="subj">${esc(row.subject)}</div></div>
    <div class="body">${body}</div><div class="kind">${row.html ? "HTML part, as sent" : "Plain-text email (no HTML part), shown line by line as the dev outbox shows it"}</div></div></body></html>`);
    await page.waitForTimeout(300);
    await shot(page, name, caption, "#mail");
  };

  group("emailsall", async () => {
    // Fresh accounts: Nora and Ana on Daily email, Omar (developer) with email Off, Wes (developer) on Weekly.
    const nora = await account(`dev+media${TS}ea1@playtest.test`, "Nora Lane", "developer", "she");
    const omar = await account(`dev+media${TS}ea2@playtest.test`, "Omar Reyes", "developer", "he");
    const wes = await account(`dev+media${TS}ea3@playtest.test`, "Wes Hart", "developer", "he");
    const ana = await account(`tester+media${TS}ea4@playtest.test`, "Ana Silva", "tester", "she");
    const ben = await account(`tester+media${TS}ea5@playtest.test`, "Ben Okafor", "tester", "he");
    const admin = await adminAccount();
    for (const d of [nora, omar, wes]) await subscribeDev(d);
    await setEmail(omar, "off");
    await setEmail(wes, "weekly");
    // Account emails: confirm (sent at sign-up), reset, and the first-password one for an account with no password (a Google sign-up).
    await post(nora, "/api/auth/forgot", { email: nora.email });
    own(`update "User" set "passwordHash" = '' where email = ${lit(wes.email)}`);
    await post(wes, "/api/auth/forgot", { email: wes.email });
    // Contact us (to the team).
    await post(ana, "/api/help", { topic: "A payment", message: "My payment for the Harbor Run answers hasn't arrived yet. Could you check?" });
    // Nora's test: joins, sent work, a payment, a declined one (a payment hold) and the retry that pays; a call booked; a reminder.
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
    // Omar (email Off): a tester's Charge while he's away that his bank wants confirmed (a must-send line).
    setCard(omar.email, "pm_card_authenticationRequired");
    const t2 = await postTest(omar, { productName: "Tide Tracker", title: "Tide Tracker: widgets", categories: ["Productivity"], writtenCents: "7.00" });
    const sA2 = await join(ana, t2);
    await sendWritten(ana, sA2);
    openCharge(sA2, t2);
    ok(await post(ana, `/api/sessions/${sA2}/choose`, { submissionId: subOf(sA2), choice: "charge", tickedCents: 700, seenAt: nowIso(), confirmed: true }), "charge");
    // Wes (Weekly, his weekly email not due): a payment line goes out the same day in the payment email.
    own(`update "User" set "lastSummaryAt" = (now() at time zone 'utc') - interval '1 day' where email = ${lit(wes.email)}`);
    setCard(wes.email, "pm_card_visa");
    const t3 = await postTest(wes, { productName: "Sky Lab", title: "Sky Lab: tutorial", categories: ["Education"], writtenCents: "8.00" });
    const sB3 = await join(ben, t3);
    await sendWritten(ben, sB3);
    await apiPay(wes, subOf(sB3), "8.00");
    // A chargeback on Nora's payment to Ana: the admins' email.
    await webhook("charge.dispute.created", { payment_intent: piOf(subOf(sA)), status: "needs_response" });
    // The end-of-day emails for these accounts (the daily job's summaries, through the fake server's test hook).
    for (const p of [nora, omar, wes, ana, ben]) await hook("summaries", p.email);
    const P = await ctx(V);
    const shots = [
      [outboxRow(nora.email, "Confirm your email"), "email-confirm", "Confirm your email | Sent at sign-up (HTML part): “Welcome to Playtest! Confirm your email.” with the link, and “The link works for 48 hours.”"],
      [outboxRow(nora.email, "Reset your password"), "email-reset", "Reset your password | After “Forgot your password?”: “Someone (hopefully you) asked to reset the password for <email>.”, “Choose a new password (the link works once, for 60 minutes).” and “If it wasn't you, ignore this email: your password stays the same.”"],
      [outboxRow(wes.email, "Choose a password"), "email-choose-password", "Choose a password | The same request from an account with no password yet (a Google sign-up): “Your account has no password yet. Choose one here: Choose a password” and “The link works once, for 60 minutes. You can keep using Continue with Google too.”"],
      [outboxRow(nora.email, "Your Playtest summary%"), "email-summary-dev", "The developer's daily summary | “Your Playtest summary: 15 updates”: every update since the last email, each with its link: the subscription receipt, joins, sent answers, “Receipt: you paid $10.00 for Ana Silva's written answers”, the booked call and its cancelling, “… is paused and closes on Nov 5 unless you pay what you owe”, “We charged your card $10.00 for what you owed.”, “Your tests are running again” and “Your tests are paused after a chargeback”."],
      [outboxRow(ana.email, "Your Playtest summary%"), "email-summary-tester", "The tester's daily summary | “Your Playtest summary: 8 updates”: “Work sent: your written answers …”, “Nora Lane paid you $10.00 for your written answers …”, “Rate Nora Lane …”, “Your call on Sat, Oct 31 at 3:02 PM UTC was cancelled because the test is paused.”, “… is running again” and “Payment for your work on “Tide Tracker: widgets” may be delayed” (the tester never reads hold or chargeback)."],
      [outboxRow(omar.email, "Your Playtest account updates%"), "email-off-bank", "Email Off: the bank confirmation | With email Off only the must-send lines go, in one end-of-day email, “Your Playtest account updates: 1”: “Your bank wants you to confirm a $7.00 payment. Confirm this payment by <date>.” with its link to the piece."],
      [outboxRow(wes.email, "Your Playtest payment updates%") || outboxRow(wes.email, "Your Playtest summary%"), "email-payment-updates", "Weekly: the payment email | On Weekly email (their summary not due yet), payment lines go out the same day: “Your Playtest payment updates: 3” with the subscription receipt and “Receipt: you paid $8.00 for Ben Okafor's written answers”."],
      [outboxRow(null, "Contact us:%"), "email-contact", "Contact us (to the team) | “Contact us: A payment” to the team's addresses (named here, not shown): “From Ana Silva <email> · About: A payment” and the message."],
      [outboxRow(null, "Playtest: new chargeback%"), "email-admin-chargeback", "New chargeback (to every admin) | “Playtest: new chargeback of $10.00”: “A developer's bank reversed a $10.00 payment (pi_…). The developer's account is on a chargeback hold.” with the link to the console's chargebacks."],
      [outboxRow(null, "Playtest admin:%"), "email-admin-daily", "The admins' daily email | “Playtest admin: 32 items for the team” (from an earlier media run on Oct 28): one line per item waiting, “New dispute: <tester> vs <developer> on “…”: “<reason>”” and “Hold lift waiting for your Approve: …”, each with its link."],
    ];
    for (const [row, name, caption] of shots) await mailShot(P, row, name, caption);
    await P.context().close();
  }, { section: EM_SEC, fake: true });
}


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
  ["Outages", "An outage comes from the uptime service's down and up alerts (batch 15): every clock moves later by its length, calls inside it are cancelled with no fault, and open pages say so."],
  ["Notifications and emails", "Bell lines as each person reads them, stacked by kind, and the emails they become, including the few sent even with email Off."],
  ["Launch fixes", "Batch 15, item by item (§ numbers are the items in docs/BATCH-15.md): measured calls and the Pay boxes, one $1,000 for a tester's calls, one rule for every pause, stop boxes that name the press, keys, admins, and the security audit's fixes. Items with nothing on screen link to their text proof."],
  ["Batch 16 (Oct 28)", "Batch 16, item by item (§ numbers are the items in docs/BATCH-16.md): the tester Alerts line, Pays on average, the Mature box, blocks, invite and dashboard search, scroll boxes, Edit's notes from other tabs, other-tab and stopped-test rules, invitations and calls live, rounding, Charge and the chargeback steps; then the owner's extra cases on stop-once, Contract changes and the tester's live box."],
  ["Batch 17 (Oct 28)", "Batch 17, item by item (§ numbers are the items in docs/BATCH-17.md): when Rate can be pressed and who rates first, Ratings to give, what a stop does to a page already open, Stop's reason, the suspended tester's Dispute-only view, the close-out dates, the bank's check inline, admin search and scroll boxes, Find search, profile lists that stay current, Tests visited and No thanks on a re-sent invite."],
  ["Batch 18 (Oct 28)", "Batch 18, item by item (§ numbers are the items in docs/BATCH-18.md): agreeing to updated Terms, a call ending at the $1,000, the Length cap, the avatar row, excerpts without the product tick, the switch line about old answers, calls in progress never cut, and the Jitsi call page with its practice room."],
  ["Batch 19 (Oct 28)", "Batch 19, item by item (§ numbers are the items in docs/BATCH-19.md): the “Closing soon” bell heading, rating on the paused banner, Pay again after a cancelled bank check, the Length row, the Let it go stop box, the Terms' How payments work, and the Charge tick and Open until line on Post and Edit."],
  ["Batch 20 (Oct 29)", "Batch 20, item by item (§ numbers are the items in docs/BATCH-20.md): question lists in scroll boxes, the 20-question notice, Invite anyway naming every missing need, Invite stops only for required items, 18+ at sign-up, profile Open tests, no false overlap flash, the Alerts chip and menu in sync, 1-letter searches, Invite while full, call history boxes, Pay more stopping presses once, the pill while typing, Rate and call changes, Dispute at the max, admin-only accounts, blocked profiles, no reload under typing, number boxes, the Open until line, the updated-Terms tick, prices for ticked parts, “Worked with you on N tests”, ratings live, Switch never stopping the developer, Send after a change, 5-character reasons and Send with the required answer."],
  ["Batch 21 (Oct 29)", "Batch 21 (docs/BATCH-21.md): the built-in call room that replaced Jitsi, between two browsers with a fake camera and microphone: connecting, mute, camera and screen share, the 2-minute warning, every end the server makes (both pages show “Call ended: …” and the room can't be rejoined), and the camera and microphone check."],
  ["Batch 22 (Oct 29)", "Batch 22 (docs/BATCH-22.md): no automatic retries during a chargeback hold, a suspended tester paid normally, waiting payouts sent when payout setup is done, the admin timeline in the third person, and Lift the pause races."],
  ["Batch 23 (Oct 29)", "Batch 23 (docs/BATCH-23.md; §4 and §8 were dropped): emails that wait and retry and the owner told when they don't send (red box, failed-for-good list, bell, the health keyword), Edit keeping what you typed with “Use theirs”, the chargeback reservation and the team's Approve, Suspend's Preview above the boxes, and Confirm with your bank stopping once."],
  ["Batch 24 (Oct 29)", "Batch 24 (docs/BATCH-24.md): “Your bank wants you to confirm” at the top of the developer dashboard (red under 24 hours, links to the piece or to Payments, live, during a hold too), and a call request closed by rating reading “the tester finished their part”."],
  ["Blocks", "A tester blocks a developer in the middle of a test, with both pages open: what closes at once, the presses that race the block, what still works afterwards, and Unblock."],
  ["Charge timing", "When Charge opens: the later of the tester's own deadline and 7 days after sending, shown on both sides with the bell line; and Rate after the team's Stop."],
  ["Emails", "Every kind of email the app sends, as received (rendered from the dev outbox's HTML): developer and tester emails, money lines, the bank confirmation, reminders, and the admins' emails."],
  // (Oct 29 Stripe run: added at run time by scripts/media-stripe/part.js; kept here so every run keeps their cases)
  ["Stripe test mode (Oct 29)", "Real Stripe payments in TEST MODE (the owner's sandbox keys, `stripe listen` forwarding the webhooks to a separate 3460 server), each shown beside the app with a local viewer that reads the same objects from Stripe's API: card setup in Stripe Checkout, Pay with the 80% going to the tester, Stripe's real 3D Secure frame, a declined card and the payment hold, a chargeback with the reservation (Uncaptured) and the team's Approve (Succeeded), and the testers' payout accounts."],
  ["Real emails (Oct 29)", "Real emails through Resend (the owner approved sending only to their own marchanna111+… aliases, at most 15): the app's side and Resend's own status for each email id."],
  // (Oct 29 evening media run, after batch 29)
  ["Batch 25 (Oct 29)", "Batch 25 (docs/BATCH-25.md): confirm-by times in the developer's own time zone, one wording for a retried chargeback, the renewal's bell line opening its own row, and one bell line for an automatic retry."],
  ["Batch 26 (Oct 29)", "Batch 26 (docs/BATCH-26.md and its commit's §13-15): a block ends a call, the team's Stop never names the developer, when Charge opens, Invite live, call requests closing live and naming the press, the sign-up ticks, the device pop-up closing with “Sent…”, questions not required by default and labelled previous sets."],
  ["Batch 27 (Oct 29)", "Batch 27 (docs/BATCH-27.md): an open new-terms offer blocks Send and calls until Switch or Keep, “Go to the next round” stops once, the update pill with its arrow, admin Tests rows following the pause live, and calls 1 minute ahead locally."],
  ["Batch 28 (Oct 29)", "Batch 28 (docs/BATCH-28.md): heartbeat gaps waiting for an admin, one team-Stop wording, the charge-opens line on the session page, a Charge after the reservation charged after the lift, a refused press redrawing at once, the can't-be-paid-more lines, disputes up to the piece's cap with the chat fold, payment emails with email Off, and listed calls charged automatically."],
  ["Batch 29 (Oct 29)", "Batch 29 (docs/BATCH-29.md and its commits' §36-38): the same stop-once rules on stopped, closed and paused tests, your own changes in another tab, the bell's stacks and number, one-a-day money lines, only testers removing excerpts, the refusal line kept after a redraw, and a piece's cap as the part's max in all."],
  ["Batch 30 (Oct 29)", "Batch 30 (docs/BATCH-30.md and its commits' §16-20): sending a part again after it's paid, no Charge for late work, the team closing open reviews at $0, why a searched person isn't invitable, invites and the join page live, locked fields named with Put it back, one line per listing save, changes next to Join, 50-character answers, the current listing in the contract box, keys for working testers, 10-character names, payment lines scrolling, branded emails, and the screenshot-run fixes."],
  ["Batch 31 (Oct 29)", "Batch 31 (docs/BATCH-31.md): every test takes at most 10 testers, and files on written answers up to 500 MB each."],
  ["Batch 32 (Oct 29)", "Batch 32 (docs/BATCH-32.md): money waiting for payout setup, Apply twice refused, every payment counted in Everything you sent, the answer-one-question line above the questions, the team's Account page, new terms blocking Charge and Dispute, one line per moment in a stop box, one change one stop on Invite anyway, refusal lines inside the part, and the console without Needs the team today."],
  ["Other devices", "The same account signed in on two devices (two separate browser sessions, each with its own sign-in, side by side): the top-box line, the pill with its arrow and count, the bell's number, and a press on the second device stopping once with “You … in another tab or device”; for the developer, the tester, and another person's change."],
  ["Calls: paying", "Paying for calls: a listed call (the Pay box at the contract rate × measured minutes, a lower pay needing a reason, the automatic charge after 7 days, Pay more up to the call's cap) beside an unlisted call (any rate up to $200/h, $0 with a note, the weekly line, never charged automatically), on both sides."],
  ["Caps", "The most a piece can be paid: a written part paid in steps up to $1,000 in all, the refusal over the room, the lines on both sides at the cap, Dispute at the cap, and the $1,000 for a tester's calls."],
  ["Bell and emails", "The bell after batch 29: one entry per kind and day across tests (Ratings to give, Applications and invites, Joined, Deadlines, Pay now, Charge or let go, the bank line), the number counting entries with anything unread, and lines read only when opened."],
];
/** (Batch 15) Launch fixes proven in text (tests and settings), linked from the report. */
const LAUNCH_TEXT = [
  ["§2, §18 and §32 Review reminders, tester days, Open until in the developer's own date", "Fake-clock tests: the same reminders for listed and unlisted parts, each tester's own days, the evening date in Chicago", "proof/b15-02-18-32-days.txt"],
  ["§3, §17, §20 and §22 Long questions, steps, reasons and notes", "20,000-character questions and steps; reasons refused over their limit, never cut", "proof/b15-03-17-20-22-text.txt"],
  ["§4 and §5 Payout readiness and the Connect webhook secret", "A payout account is ready with payouts on and transfers active; either webhook secret is accepted", "proof/b15-04-05-stripe.txt"],
  ["§6 Upload sizes on R2", "The signed upload carries its exact length and type; an unfinished upload is refused", "proof/b15-06-storage.txt"],
  ["§7 Sign-in: one message, attempt limits", "Wrong email or password, the per-account and per-network limits, the no-password reset email", "proof/b15-07-signin.txt"],
  ["§9 Payments stuck in progress", "Found by their payKey and finished, left for the bank, or cleared; never charged twice", "proof/b15-09-recovery.txt"],
  ["§10 Outages from the uptime alerts", "A down/up pair records one outage; missing pings never do", "proof/b15-10-outages.txt"],
  ["§11 Each person's own time zone", "Bell lines and emails written in the reader's zone, with the zone named", "proof/b15-11-timezones.txt"],
  ["§12 Settings checked loudly", "The build stops on a missing or placeholder production setting; the owner's red box lists the rest", "proof/b15-12-config.txt"],
  ["§13 A press repeated after a lost answer", "Every press acts once (press ids or the existing refusals)", "proof/b15-13-repeats.txt"],
  ["§41 The security audit's fixes", "Each finding, its fix and its test", "proof/SECURITY.md"],
  ["At home: Stripe test mode, the Connect webhook, R2 and UptimeRobot", "The checks to do yourself before launch, in test mode", "proof/AT-HOME.md"],
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
  // (Batch 15) The Launch fixes section: the items with nothing on screen link to their text proofs; every case in item order (§ number).
  const lf = sections.find((s) => s.title === "Launch fixes");
  if (lf) {
    for (const [title, explanation, file] of LAUNCH_TEXT) lf.cases.push({ title, explanation, kind: "text", desktop: file, phone: null });
    const num = (c) => Number((/§(\d+)/.exec(c.title) || [0, 99])[1]);
    lf.cases.sort((a, b) => num(a) - num(b));
  }
  // (Batch 16) Its own section in item order (§ number), the owner's extra cases (no §) after them, each group's order kept within a number.
  const b16 = sections.find((x) => x.title === "Batch 16 (Oct 28)");
  if (b16) { const num = (c) => Number((/^§(\d+)/.exec(c.title) || [0, 99])[1]); b16.cases.sort((a, b) => num(a) - num(b)); }
  // (Batch 17 and 18) The same: item order (§ number), each group's order kept within a number.
  for (const t of ["Batch 17 (Oct 28)", "Batch 18 (Oct 28)", "Batch 19 (Oct 28)", "Batch 20 (Oct 29)", "Batch 21 (Oct 29)", "Batch 22 (Oct 29)", "Batch 23 (Oct 29)", "Batch 24 (Oct 29)", "Batch 25 (Oct 29)", "Batch 26 (Oct 29)", "Batch 27 (Oct 29)", "Batch 28 (Oct 29)", "Batch 29 (Oct 29)", "Batch 30 (Oct 29)", "Batch 31 (Oct 29)", "Batch 32 (Oct 29)"]) { const x = sections.find((y) => y.title === t); if (x) { const num = (c) => Number((/^§(\d+)/.exec(c.title) || [0, 99])[1]); x.cases.sort((a, b) => num(a) - num(b)); } }
  const unknown = [...new Set([...cases.values()].map((c) => c.section).filter((s) => !SECTIONS.some(([t]) => t === s)))];
  if (unknown.length) console.log("   ! manifest: unknown sections", unknown);
  fs.writeFileSync(path.join(OUT, "report-manifest.json"), JSON.stringify({ generated: new Date().toISOString(), sizes: { desktop: "1280x900", phone: "375x812" }, sections }, null, 2));
  console.log("manifest:", sections.map((s) => `${s.title} ${s.cases.length}`).join(" · "));
}

{
  (async () => {
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }); // (Batch 16) BROWSER_CHANNEL=chrome when Edge won't start
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
        SUB_DEVS = (!g.fake && MAIN === FAKE) || /^b15/.test(g.id); // (both on the media server: the launch is over there; Oct 29: the b15 groups were written before one open test needed a plan)
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
    // (Oct 29) Two runs at once never lose each other's captions: the read-and-write of the list holds a lock (a folder next to it).
    const lock = path.join(OUT, ".captions-lock");
    for (let i = 0; ; i++) { try { fs.mkdirSync(lock); break; } catch { if (i > 600) { fs.rmSync(lock, { recursive: true, force: true }); } await new Promise((r) => setTimeout(r, 100)); } }
    try {
    const prev = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, "utf8")) : {};
    for (const m of made) prev[m.file] = { caption: m.caption, kind: m.kind, title: m.title, section: m.section, group: m.group, order: m.order, size: m.size };
    // Files that no longer exist (renamed or dropped scenarios) leave the list.
    for (const f of Object.keys(prev)) if (!fs.existsSync(path.join(OUT, f))) delete prev[f];
    fs.writeFileSync(listFile, JSON.stringify(prev, null, 2));
    writeManifest(prev);
    } finally { fs.rmSync(lock, { recursive: true, force: true }); }
    console.log("results:\n  " + results.join("\n  "));
    console.log("done:", made.length, "files; temp", VTMP);
  })();
}
