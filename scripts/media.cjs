// Records the screenshots and videos for the design doc's [IN I] / [IN V] markers into docs/media/.
// Needs the app running on BASE (default http://localhost:3400) with the dev outbox. Uses fresh throwaway accounts
// (dev+media<ts>@playtest.test …) and touches only those accounts' rows when it sets up a state directly in the database.
// Usage: node scripts/media.cjs            (everything)
//        ONLY=dash,edit node scripts/media.cjs   (just those groups; the accounts and tests are made again each run)
// Groups: every (Every page), dash (Developer dashboard), post (Post a test), edit (Edit test), testpage + tpvideo + tpstop
// (Developer test page), check (tonight's tester dashboard boxes; pictures in docs/media/checks/, not doc markers).
// docs/media/captions.json maps each file to the caption used under it in the design doc.
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

const BASE = process.env.BASE || "http://localhost:3400";
const OUT = path.join(__dirname, "..", "docs", "media");
const VTMP = fs.mkdtempSync(path.join(os.tmpdir(), "pt-media-video-"));
const TS = Date.now();
const N = TS % 10000;
// The local test password is the one scripts/evidence.cjs uses (read from there, never printed).
const PASSWORD = /const PASSWORD = "([^"]+)"/.exec(fs.readFileSync(path.join(__dirname, "evidence.cjs"), "utf8"))[1];
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 900 } };
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
fs.mkdirSync(path.join(OUT, "checks"), { recursive: true }); // checks/: visual-check pictures, not doc markers
const made = []; // every file written this run, with its caption
let browser;

// ---------- database (only this run's own accounts) ----------
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-p", "5499", "-U", "postgres", "-d", "playtest_lite", "-t", "-A", "-c", q]).toString().split(String.fromCharCode(13)).join("").trim();
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const userId = (email) => sql(`select id from "User" where email = ${lit(email)}`);
/** Runs SQL only after checking that every user it names is one of this run's throwaway accounts. */
function own(q) {
  if (!/@playtest\.test/.test(q) && !/where id = '/.test(q) && !/"testId" = '/.test(q) && !/where "id" in/.test(q)) throw new Error("own(): the query must name this run's own rows");
  return sql(q);
}

// ---------- pages ----------
async function ctx(opts = DESKTOP, video = false) {
  const c = await browser.newContext({ ...opts, baseURL: BASE, ...(video ? { recordVideo: { dir: VTMP, size: opts.viewport } } : {}) });
  c.setDefaultTimeout(15000);
  await hideDevBadge(c);
  const p = await c.newPage();
  return p;
}
/** A second page signed in as the same person (cookies copied), optionally recording video. */
async function same(page, opts = DESKTOP, video = false) {
  const c = await browser.newContext({ ...opts, baseURL: BASE, storageState: await page.context().storageState(), ...(video ? { recordVideo: { dir: VTMP, size: opts.viewport } } : {}) });
  c.setDefaultTimeout(15000);
  await hideDevBadge(c);
  return c.newPage();
}
/** The Next.js dev-tools badge is not part of the app: hide it in pictures. */
const hideDevBadge = (c) => c.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "nextjs-portal{display:none!important}"; document.head.appendChild(s); }));
const post = async (page, p, data = {}) => {
  const r = await page.context().request.post(BASE + p, { data, headers: { "content-type": "application/json" } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok() && !post.quiet) console.log("   ! POST", p, r.status(), JSON.stringify(body).slice(0, 300));
  return { status: r.status(), ok: r.ok(), body };
};
const nowIso = () => new Date().toISOString();

/** A new account through the sign-up API (name, role, Terms), email confirmed, a tester profile when testing. */
async function account(email, name, role, pronoun = "they", tester = {}) {
  const p = await ctx(tester.phone ? PHONE : DESKTOP);
  const r = await post(p, "/api/auth/signup", { email, password: PASSWORD, role, name, acceptTerms: true });
  if (!r.ok) throw new Error("sign-up failed for " + email);
  own(`update "User" set "emailVerifiedAt" = (now() at time zone 'utc') where email = ${lit(email)}`);
  await post(p, "/api/profile", { name, pronoun, isDeveloper: role !== "tester", isTester: role !== "developer", devices: tester.devices ?? ["Windows PC"], languages: tester.languages ?? ["English"], categories: [] });
  p.email = email;
  p.name = name;
  p.uid = userId(email);
  return p;
}

const LISTING = {
  productName: "Harbor Run", title: "Harbor Run: first 3 levels", description: "Sail through the first three harbors and tell us where the controls or the map get confusing.",
  buildUrl: "https://example.com/harbor-run", categories: ["Game"], devices: [], languages: [], mature: false, matureWhy: "", ndaText: "",
  spots: "5", deadlineDays: "10", writtenCents: "10.00", recordingCents: null, liveRateCents: null, liveMinutes: null,
  writtenRequired: true, recordingRequired: false, liveRequired: false, questions: ["What did you like?", "Where did you get stuck?"], openUntil: "", joinMode: "anyone",
};
/** Posts a test through the API (the same checks as the form); returns its id. */
async function postTest(dev, over = {}) {
  const r = await post(dev, "/api/tests", { ...LISTING, ...over, accessKeys: over.accessKeys ?? "" });
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
function record(file, caption, kind) {
  made.push({ file, caption, kind });
  console.log(`   + ${file}  (${caption})`);
}
/** A screenshot of the whole page, or of one element (with a little room around it). */
async function shot(page, name, caption, target, after) {
  await page.bringToFront();
  await page.waitForTimeout(400);
  const file = `${name}.png`;
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
    const pad = 12, x = Math.max(0, b.x - pad), y = Math.max(0, b.y + sy - pad);
    await page.screenshot({ path: path.join(OUT, file), fullPage: true, clip: { x, y, width: Math.min(page.viewportSize().width - x, b.width + 2 * pad), height: b.height + 2 * pad } });
  } else await page.screenshot({ path: path.join(OUT, file), fullPage: false });
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
function finishVideo(parts, name, caption, { secs } = {}) {
  const out = path.join(OUT, `${name}.webm`);
  const args = ["-y", "-loglevel", "error"];
  for (const p of parts) args.push("-ss", String(Math.max(0, p.from || 0).toFixed(2)), ...(secs ? ["-t", String(secs)] : []), "-i", p.file);
  if (parts.length === 2) args.push("-filter_complex", "[0:v]scale=-2:720,setsar=1,pad=iw+8:ih:0:0:0x101826[a];[1:v]scale=-2:720,setsar=1[b];[a][b]hstack=inputs=2:shortest=1[v]", "-map", "[v]");
  args.push("-c:v", "libvpx", "-b:v", "1800k", "-crf", "10", "-an", out);
  execFileSync(FFMPEG, args);
  record(`${name}.webm`, caption, "video");
}
/** A recorded page: { page, t0 } (t0 = when its recording began). */
async function rec(opts = DESKTOP, from) {
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
const group = (id, fn) => groups.push({ id, fn });

// ---------- more helpers ----------
const ok = (r, what) => {
  if (!r.ok) throw new Error(`${what} failed: ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
};
const go = { confirmed: true }; // a press that goes ahead (no stop-once box to show)
let adminP = null; // one admin per run
function adminAccount() {
  return (adminP ??= account(`admin+media${TS}@playtest.test`, "Media Admin", "developer", "they").then((a) => {
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
  const budget = await postTest(nora, { productName: "Budget Buddy", title: "Budget Buddy: sign-up flow", description: "Create an account and set up your first budget. Tell us where you hesitate.", buildUrl: "https://example.com/budget-buddy", categories: ["Finance", "Productivity"], writtenCents: "0", writtenRequired: false, questions: ["Which step took longest?"], spots: "10", deadlineDays: "5" });
  await join(ben, budget);
  const lumen = await postTest(nora, { productName: "Lumen Notes", title: "Lumen Notes private beta", description: "Install the beta with your key and write three notes.", buildUrl: "https://example.com/lumen", categories: ["Productivity", "AI"], writtenCents: "12.00", joinMode: "invite", spots: "4", ndaText: "Don't share screenshots of the beta.", accessKeys: "LUMEN-01\nLUMEN-02\nLUMEN-03\nLUMEN-04\nLUMEN-05", openUntil: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) });
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
  await shot(nora, "dash-card-game", "A game test with written answers, a recording and live calls", card(nora, "Harbor Run: first 3 levels"));
  await shot(nora, "dash-card-free", "A free web-app test (Finance, Productivity): its written answers pay nothing", card(nora, "Budget Buddy: sign-up flow"));
  await shot(nora, "dash-card-invite", "An invite-only test with access keys and an NDA", card(nora, "Lumen Notes private beta"));
  await shot(nora, "dash-card-work-waiting", "An open test with work waiting for review", card(nora, "Sky Lab: tutorial"));
  await shot(nora, "dash-card-full", "A full test: 2 of 2 spots taken", card(nora, "Pocket Chef: recipe search"));
  await shot(nora, "dash-card-stopped", "A stopped test", card(nora, "Night Market demo"));
  await shot(nora, "dash-card-draft", "Draft: the next round, not open yet", card(nora, "Harbor Run: first 3 levels (round 2)"));
  await shot(nora, "dash-card-closed", "Closed after 7 days paused", card(nora, "Coral Quest: boss fight"));
  await shot(nora, "checks/dash-needs-review-and-calls", "Visual check: Needs review and Calls boxes", nora.locator("#needs-review"));
  await nora.screenshot({ path: path.join(VTMP, "check-dash-full.png"), fullPage: true });
  await omar.goto("/app");
  await omar.waitForSelector("[data-restricted-box]");
  await omar.locator("[data-restricted-box] button", { hasText: /Show \d+ more/ }).first().click().catch(() => {});
  await shot(omar, "dash-blue-box", "Payment hold: the blue box at the top of the developer dashboard", omar.locator("[data-restricted-box]"));
  await shot(omar, "dash-card-paused", "A paused test (payment hold)", card(omar, "Tide Tracker: widgets"));
  await omar.screenshot({ path: path.join(VTMP, "check-dash-hold-full.png"), fullPage: true });
  await ana.goto("/app");
  await ana.screenshot({ path: path.join(VTMP, "check-tester-dash.png"), fullPage: true });
});

// ---------- Every page ----------
group("every", async () => {
  // A deleted account: the other open tab goes to the login page with the red notice.
  const kai = await account(`tester+media${TS}k@playtest.test`, "Kai Moreno", "tester", "they");
  const other = await same(kai);
  await other.goto("/app/find");
  await kai.goto("/app/account");
  ok(await post(kai, "/api/account/delete", { confirmed: true }), "delete account");
  await other.waitForURL(/\/login\?gone=1/, { timeout: 30000 });
  await shot(other, "every-deleted-account", "Kai deleted their account in another tab: this tab is signed out with the red notice");

  // A hold that starts while pages are open: the test page and Edit move to the top of the dashboard.
  const dev = await account(`dev+media${TS}r@playtest.test`, "Rosa Diaz", "developer", "she");
  const ana = await account(`tester+media${TS}ra@playtest.test`, "Ana Silva", "tester", "she");
  const t = await postTest(dev, { productName: "Glow Garden", title: "Glow Garden: night levels", categories: ["Game"], writtenCents: "9.00" });
  await join(ana, t);
  const a = await rec(DESKTOP, dev), b = await rec(DESKTOP, dev);
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
    "A payment hold starts while the test page (left) and Edit (right) are open: both move to the dashboard top, where the blue box explains");
});

// ---------- Post a test ----------
group("post", async () => {
  const dev = await account(`dev+media${TS}m@playtest.test`, "Mina Park", "developer", "she");
  const ana = await account(`tester+media${TS}ma@playtest.test`, "Ana Silva", "tester", "she");
  const dee = await account(`tester+media${TS}md@playtest.test`, "Dee Moss", "tester", "they");
  await dev.goto("/app/tests/new");
  await dev.waitForSelector("#productName");
  await shotSpan(dev, "post-required-mark", "The top of Post a test: “* marks the fields you have to fill in”", "main h1", field(dev, "productName"));
  await dev.fill("#productName", "Harbor Run");
  await dev.fill("#title", "Harbor Run: first 3 levels");
  await dev.fill("#description", "Sail through the first three harbors and tell us where the controls or the map get confusing.");
  await shotSpan(dev, "post-counters", "Counters on Product (up to 60), Name of this test (up to 60) and What should testers do (up to 1,000)", field(dev, "productName"), field(dev, "description"));

  // Video: filling in and posting a test, landing on its page.
  const v = await rec(DESKTOP, dev);
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
  await v.locator("#deadlineDays").fill("10");
  await v.locator("#joinMode").scrollIntoViewIfNeeded();
  await pause(v, 800);
  await v.click("button:has-text('Post the test')");
  await v.waitForURL((u) => /\/app\/tests\/\w+$/.test(u.pathname) && !u.pathname.endsWith("/new"));
  await pause(v, 3000);
  const pebble = v.url().split("/").pop();
  finishVideo([{ file: await saveVideo(v, "post-flow.webm"), from }], "post-the-test", "Posting a test: fill in the four panels, press Post the test, land on the new test's page");

  // Where it's listed: Anyone in Find tests; Invite only only for the invited.
  await ana.goto("/app/find");
  await ana.waitForSelector("text=Pebble Path: daily puzzle");
  await shot(ana, "post-listed-find", "Anyone can join: the new test shows in testers' Find tests", `a.card[href="/app/find/${pebble}"]`);
  const secret = await postTest(dev, { productName: "Lumen Notes", title: "Lumen Notes private beta", joinMode: "invite", categories: ["Productivity"], writtenCents: "12.00" });
  ok(await post(dev, `/api/tests/${secret}/invite`, { ...go, testerIds: [dee.uid] }), "invite");
  await dee.goto("/app");
  await dee.waitForSelector("text=Lumen Notes private beta");
  await shot(dee, "post-listed-invite", "Invite only: not in Find tests; the invited tester sees it on their dashboard", dee.locator("section", { has: dee.locator("text=invited you to") }).first());

  // Red at the field.
  const r = await rec(DESKTOP, dev);
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
  await r.locator("#deadlineDays").click();
  await pause(r, 800);
  await shotSpan(r, "post-red-required-price", "Red at the field when you leave it: required fields empty, a price under $1, spots over the limit", field(r, "productName"), r.locator("#spots"), 12, 60);
  await r.locator("#productName").fill("Harbor Run");
  await r.locator("#title").fill("Harbor Run: first 3 levels");
  await r.locator("#description").fill("Sail through the harbors.");
  await r.locator("#writtenPrice").fill("10.00");
  await r.locator("#spots").fill("3");
  await r.locator("#buildUrl").fill("http://example.com/harbor");
  await r.locator("#questions").fill("What did you like?");
  await r.locator("#deadlineDays").fill("10");
  const soon = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
  await r.locator("#openUntil").fill(soon);
  await r.locator("#accessKeys").fill("KEY-1\nKEY-1\nKEY-2");
  await r.locator("#openUntil").click();
  await r.locator("#accessKeys").click();
  await r.locator("#productName").click();
  await pause(r, 800);
  await shotSpan(r, "post-red-dates-keys", "Red when you leave the field: the deadline doesn't leave 3 days before Open until, and fewer keys than spots", r.locator("h2:has-text('Who and how long')"), r.locator("#accessKeys").locator("xpath=ancestor::div[1]"));
  // Fix those two; Post then finds what only the server checks: the link and a key typed twice.
  await r.locator("#openUntil").fill(new Date(Date.now() + 25 * 86400000).toISOString().slice(0, 10));
  await r.locator("#accessKeys").fill("KEY-1\nKEY-1\nKEY-2\nKEY-3");
  await r.locator("#productName").click();
  await pause(r, 800);
  await r.click("button:has-text('Post the test')");
  await r.waitForSelector("text=/Fix the .* above/");
  await pause(r, 2500);
  finishVideo([{ file: await saveVideo(r, "post-red.webm"), from: fromR }], "post-red-checks", "Red at the field: each box is checked when you leave it, and Post checks everything again on the server");
});

// ---------- Edit test ----------
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
/** Another tab's Save, through the same API the form uses (the version it loaded, the fields it changed). */
async function apiEdit(dev, id, fields, keys = {}) {
  const r = await dev.context().request.get(`${BASE}/api/tests/${id}/listing`);
  const { version } = await r.json();
  return ok(await post(dev, `/api/tests/${id}/edit`, { version, fields, confirmed: true, keysAdd: keys.add ?? [], keysRemove: keys.remove ?? [] }), "edit");
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
  await shotSpan(dev, "edit-live-box", "Edit's live box sits under Save: Ana sent her written answers while Edit was open", saveBtn(dev), "[data-live-top]", 16, 12);

  // Dates.
  await dev.goto(`/app/tests/${t}/edit`);
  await dev.locator("#openUntil").fill(day(15));
  await dev.locator("#spots").click();
  await pause(dev, 500);
  await shot(dev, "edit-open-until", "Open until can only move later: an earlier date is red", panel(dev, "Who and how long"));
  await dev.goto(`/app/tests/${t}/edit`);
  await dev.locator("#deadlineDays").fill("30");
  await dev.locator("#spots").click();
  await pause(dev, 500);
  await shot(dev, "edit-deadline", "A 30-day deadline needs Open until 3 days later: red under both fields", panel(dev, "Who and how long"));

  // Access keys that can't be added again.
  await dev.goto(`/app/tests/${t}/edit`);
  await dev.locator("#keysAdd").fill("HR-1111");
  await saveBtn(dev).click();
  await dev.waitForSelector("text=/already in use by a tester/");
  await shotSpan(dev, "edit-key-in-use", "A key in use can't be added again (red)", "#keys", "text=/already in use by a tester/", 12, 20);
  await dev.goto(`/app/tests/${t}/edit`);
  await dev.locator("#keysAdd").fill("HR-2222\nHR-3333");
  await saveBtn(dev).click();
  await dev.waitForSelector("text=/reported as not working|given to a tester who left/");
  await shotSpan(dev, "edit-key-reported-left", "Keys reported as not working or given to a tester who left can't be added again", "#keys", dev.locator("ul.err-field").first(), 12, 16);

  // Changed in another tab or device: A has Edit open; B saves the instructions and new keys.
  const A = await rec(DESKTOP, dev), B = await rec(DESKTOP, dev);
  await A.goto(`/app/tests/${t}/edit`);
  await B.goto(`/app/tests/${t}/edit`);
  // (Edit keeps unsent typing per form: clear what the key checks above left in the Add keys box.)
  for (const P of [A, B]) {
    await P.locator("#keysAdd").fill("");
    await P.locator("#keysAdd").blur();
  }
  await A.evaluate(() => window.scrollTo(0, 0));
  const fromA = at(A), fromB = at(B);
  await A.locator("#title").click();
  await A.keyboard.press("End");
  await typeSlow(A, "#title", " (beta)");
  await pause(A, 600);
  await B.locator("#description").fill("");
  await typeSlow(B, "#description", "Sail through all five harbors now, and tell us where the map or the controls get confusing.", 12);
  await B.locator("#keysAdd").fill("HR-7777\nHR-8888\nHR-9999");
  await B.locator("#keysAdd").scrollIntoViewIfNeeded();
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
  await A.locator("#keysAdd").scrollIntoViewIfNeeded();
  await pause(A, 2500);
  await shot(A, "edit-elsewhere-field", "Another tab saved new instructions: the field updates with a blue note under it", field(A, "description"));
  await shot(A, "edit-elsewhere-keys", "Keys added in another tab: the blue note under the key boxes", "#keys");
  await shotSpan(A, "edit-elsewhere-save", "Save stops once: “This test changed since you opened Edit. Press Save again…”", saveBtn(A), A.locator("text=/Press Save again/").locator("xpath=ancestor::*[contains(@class,'info')][1]"), 16, 12);
  finishVideo([{ file: await saveVideo(A, "edit-else-a.webm"), from: fromA }, { file: await saveVideo(B, "edit-else-b.webm"), from: fromB }], "edit-changed-elsewhere",
    "Two tabs on Edit: the right tab saves new instructions and keys; the left tab's fields update with blue notes, and its Save stops once");

  // Red and blue at once (5 keys, 4 spots, 1 tester in: 4 free keys for 3 open spots).
  const t2 = await postTest(dev, { title: "Harbor Run: night sailing", spots: "4", openUntil: day(30), deadlineDays: "10", accessKeys: "NS-1\nNS-2\nNS-3\nNS-4\nNS-5" });
  await join(ana, t2);
  await dev.goto(`/app/tests/${t2}/edit`);
  await dev.click("[aria-label='Remove NS-4']");
  await apiEdit(dev, t2, { spots: 5 });
  await tick(dev);
  await dev.waitForSelector("text=Changed in another tab or device");
  await dev.locator("#keysAdd").click();
  await dev.locator("#spots").click();
  await pause(dev, 600);
  await shotSpan(dev, "edit-red-blue-spots-keys", "You ticked a key to remove; another tab added a spot (blue): now fewer free keys than open spots (red)", field(dev, "spots"), "#keys");
  await apiEdit(dev, t2, { spots: 4 });
  await dev.goto(`/app/tests/${t2}/edit`);
  await dev.locator("#deadlineDays").fill("40");
  await apiEdit(dev, t2, { openUntil: day(35) });
  await tick(dev);
  await dev.waitForSelector("text=Changed in another tab or device");
  await dev.locator("#deadlineDays").click();
  await dev.locator("#spots").click();
  await pause(dev, 600);
  await shot(dev, "edit-red-blue-deadline", "You typed a 40-day deadline; another tab moved Open until later (blue), still too early for it (red)", panel(dev, "Who and how long"));
  await dev.goto(`/app/tests/${t2}/edit`);
  await dev.click("[aria-label='Remove NS-4']");
  await apiEdit(dev, t2, {}, { remove: ["NS-5"] });
  await tick(dev);
  await dev.waitForSelector("text=Changed in another tab or device");
  await dev.locator("#keysAdd").click();
  await dev.locator("#spots").click();
  await pause(dev, 600);
  await shot(dev, "edit-red-blue-keys", "You ticked one key to remove; another tab removed another (blue): the free keys no longer cover the open spots (red)", "#keys");

  // 3 changes after the first join.
  const t3 = await postTest(dev, { title: "Harbor Run: storms", spots: "3" });
  await join(ana, t3);
  for (const d of ["Sail into the first storm.", "Sail into the first two storms.", "Sail into all three storms."]) await apiEdit(dev, t3, { description: d });
  await dev.goto(`/app/tests/${t3}/edit`);
  await dev.waitForSelector("[data-critical-locked]");
  await shotSpan(dev, "edit-three-changes", "After 3 saves that changed the steps, those fields are locked; “Changes left: 0 of 3” near Save", saveBtn(dev), "[data-critical-locked]");

  // The team stops the test while Edit is open: Save is refused and the developer goes back to the test page.
  const t4 = await postTest(dev, { title: "Harbor Run: lighthouse", spots: "3" });
  await join(ana, t4);
  const S = await rec(DESKTOP, dev);
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
  finishVideo([{ file: await saveVideo(S, "edit-admin-stop.webm"), from: fromS }], "edit-team-stopped", "The team stops the test while Edit is open: Save is refused and the test page's banner names the press that didn't go through");
});

// ---------- Developer test page ----------
const rejectPiece = (dev, subId, reason) => post(dev, "/api/review", { action: "reject", kind: "submission", id: subId, reason, payKey: `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, seenAt: nowIso(), confirmed: true }).then((r) => ok(r, "reject"));
const subOf = (sessionId) => sql(`select id from "Submission" where "contractId" = '${sessionId}' order by "sentAt" desc limit 1`);
const testPanel = (page) => page.locator("section[aria-label='Test']").first();
const liveSession = (page) => page.locator("#calls").locator("xpath=ancestor::details[1]");

/** A test with people in every state: work to pay, calls booked and waiting, a call that happened, a dispute. */
async function busyTest(tag) {
  const dev = await account(`dev+media${TS}${tag}@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}${tag}a@playtest.test`, "Ana Silva", "tester", "she", { phone: true });
  const ben = await account(`tester+media${TS}${tag}b@playtest.test`, "Ben Okafor", "tester", "he", { phone: true });
  const cam = await account(`tester+media${TS}${tag}c@playtest.test`, "Cam Lee", "tester", "they");
  const t = await postTest(dev, { recordingCents: "15.00", liveRateCents: "30.00", spots: "6", questions: ["What did you like?", "Where did you get stuck?", "Would you play level 4?"], openUntil: day(40) });
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
  await dev.locator("div[role=alert] button[aria-label=Close]").first().click().catch(() => {});
  await shot(dev, "tp-overview", "Overview: title, status, badges, terms and spots, Open until, and the Edit, Alerts, Next round, End early and Stop buttons", testPanel(dev));
  await shot(dev, "tp-needs-you", "Needs you, grouped per person: Pay or Reject for sent work, a call waiting for its length, a dispute waiting for your side", "#needs-you");
  await shotSpan(dev, "tp-needs-dispute-call", "A dispute waiting for the developer's side, and a call that happened waiting for its length", "#needs-you [id^='item-dispute-']", dev.locator("#needs-you [data-needs-person]").filter({ hasText: "Ben Okafor" }).first());
  await shot(dev, "tp-testers", "Testers: the avatar row with Ana's hover card, and one row per tester with parts sent, pay and their contract", "#testers-joined", async () => {
    await dev.locator("#testers-joined a[aria-label='Ana Silva: profile']").first().hover();
    await pause(dev, 700);
  });
  await shot(dev, "tp-live-session", "Live session: tick testers, request times, waiting requests, booked calls (Join shows near the start) and past calls", liveSession(dev));
  await dev.click("[data-alerts-menu] > summary");
  await pause(dev, 500);
  await shotSpan(dev, "tp-alerts", "Alerts: tick what should not stop your buttons", testPanel(dev), dev.locator("[data-alerts-menu] > div, [data-alerts-menu] > *:not(summary)").last(), 12, 16);
  await dev.click("[data-alerts-menu] > summary");

  await dev.goto(`/app/tests/${kelp}`);
  await dev.waitForSelector("#needs-you");
  await shot(dev, "tp-needs-applications", "On an Approved-only test: applications to Accept or Decline, and a rejoin ask with the time they'd get back", "#needs-you");
  await dev.click("#invite > summary");
  await pause(dev, 800);
  await shot(dev, "tp-invite", "Invite testers: People you've worked with, Suggested and Find testers, then Invited", "#invite");
  await dev.fill("#invite input[aria-label='Find testers']", "Dee Marsh");
  await pause(dev, 1200);
  await dev.check(`#invite li[data-invite-row="${dee.uid}"] input`);
  await shot(dev, "tp-invite-find", "Find testers by name: missing needs show as orange labels", "#invite");
  await dev.click("#invite button:has-text('Invite')");
  await dev.waitForSelector("[data-invite-anyway]");
  await pause(dev, 600);
  await shot(dev, "tp-invite-anyway", "Invite anyway: the inline box lists the needs Dee doesn't meet", "#invite");

  // Next round: a draft copy.
  await dev.goto(`/app/tests/${t}`);
  await dev.click("button:has-text('Next round')");
  await dev.click("text=Start the next round");
  await dev.waitForURL((u) => !u.pathname.includes(t), { timeout: 10000 });
  const draft = dev.url().split("/tests/")[1].split("/")[0];
  await dev.goto(`/app/tests/${draft}`);
  await dev.waitForSelector("text=Hidden from new testers.");
  await shot(dev, "tp-next-round", "Next round: a draft copy “(round 2)”, hidden from new testers until Accept testers again", testPanel(dev));

  // End early: the confirm pop-up.
  await dev.goto(`/app/tests/${t}`);
  await dev.click("button:has-text('End early')");
  await dev.check("[data-end-early] label:has-text('Ben Okafor') input").catch(async () => dev.locator("[data-end-early] fieldset input").nth(1).check());
  await dev.fill("#reason", "We have what we need from you for this build: thank you!");
  await dev.click("[data-end-early] button:has-text('End their work now')");
  await dev.waitForSelector("dialog[open]");
  await pause(dev, 500);
  await shot(dev, "tp-end-early", "End early: tick testers, give one reason they read, then the confirm pop-up “End their work now”");
  await dev.keyboard.press("Escape");

  // Stop: the confirm pop-up, then the stopped page and the tester's page.
  await dev.goto(`/app/tests/${t}`);
  await dev.click("button:has-text('Stop the test')");
  await dev.waitForSelector("dialog[open]");
  await pause(dev, 500);
  await shot(dev, "tp-stop-confirm", "Stop: the confirm pop-up “Are you sure you want to stop …?”");
  await dev.click("dialog[open] button:has-text('Stop the test')");
  await dev.waitForSelector("text=This test is stopped.");
  await pause(dev, 1500);
  await dev.goto(`/app/tests/${t}`);
  await shotSpan(dev, "tp-stopped", "Stopped: the Stopped label and the stopped line; the overview buttons are gone and Live session says no calls can be booked", testPanel(dev), liveSession(dev));
  await ana.goto(`/app/sessions/${sA}`);
  await pause(ana, 1000);
  await shot(ana, "tp-stopped-tester", "The tester's page after Stop: the stopped line says what they can still do (phone)");
  await ana.screenshot({ path: path.join(VTMP, "check-tester-stopped-full.png"), fullPage: true });
});

group("tpvideo", async () => {
  const { dev, ana, ben, cam, t, sA, sB, sC } = await busyTest("v");
  const admin = await adminAccount();

  // Live box: Ana sends her answers, then switches to new terms; "See their contract" scrolls to her row.
  {
    const D = await rec(DESKTOP, dev), T = await rec(PHONE, ana);
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
      "The live box: Ana (right, phone) sends her answers and switches to the new terms; the developer's box updates and See their contract scrolls to her row");
  }

  // Stop-once on Pay: Ben sends his answers while the developer is about to pay Ana.
  {
    const D = await rec(DESKTOP, dev), T = await rec(PHONE, ben);
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
    await shot(D, "tp-stop-once-pay", "Stop-once on Pay: Ben sent his answers since the page loaded, listed under the button", D.locator(`#piece-${sub}`));
    await D.locator(`#piece-${sub} button:has-text('Pay')`).first().click();
    await pause(D, 3000);
    finishVideo([{ file: await saveVideo(D, "tp-once-d.webm"), from: fromD }, { file: await saveVideo(T, "tp-once-t.webm"), from: fromT }], "tp-stop-once",
      "Stop-once: Ben (right, phone) sends his answers while the developer presses Pay for Ana; Pay stops once and lists the change, the second press goes ahead");
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
  await shot(dev, "tp-stop-once-stop", "Stop-once after a pop-up: Cam left while the Stop pop-up was open; the press didn't go through and the change shows under Stop", testPanel(dev));

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
  await shot(dev, "tp-stop-once-invite", "Invite stops once: Fay removed iPhone and iPad from her profile after the page loaded", "#invite");

  // The team pauses the test while the developer is on it: only Stop works.
  {
    const t2 = await postTest(dev, { title: "Harbor Run: reef", spots: "3" });
    await join(ana, t2);
    const D = await rec(DESKTOP, dev);
    await D.goto(`/app/tests/${t2}`);
    const from = at(D);
    await pause(D, 1500);
    await adminDo(admin, "pause-test", t2, { note: "Media pass check: we're looking at a report" });
    await D.click("button:has-text('End early')");
    await D.locator("[data-end-early] fieldset input").first().check();
    await D.fill("#reason", "Wrapping up this round early, thanks!");
    await D.click("[data-end-early] button:has-text('End their work now')");
    await D.click("dialog[open] button:has-text('End their work now')");
    await D.waitForSelector("[data-admin-banner]", { timeout: 15000 });
    await pause(D, 3500);
    await D.screenshot({ path: path.join(VTMP, "tp-paused-after.png"), fullPage: true });
    finishVideo([{ file: await saveVideo(D, "tp-paused.webm"), from }], "tp-team-paused", "The team pauses the test: End early is refused (“you can only stop it”) and the banner explains");
  }

  // The team stops the test while the developer is lower on the page: it moves to the top with the banner.
});

group("tpstop", async () => {
  // The team stops the test while the developer is requesting a call lower on the page.
  const dev = await account(`dev+media${TS}s@playtest.test`, "Nora Lane", "developer", "she");
  const ana = await account(`tester+media${TS}sa@playtest.test`, "Ana Silva", "tester", "she");
  const admin = await adminAccount();
  const t3 = await postTest(dev, { title: "Harbor Run: shipwreck", spots: "3", liveRateCents: "30.00" });
  await join(ana, t3);
  const D = await rec(DESKTOP, dev);
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
  await D.click("section[aria-label='Call requests'] >> text=Request a time");
  await D.waitForSelector("[data-admin-banner]", { timeout: 15000 });
  await pause(D, 4000);
  await D.screenshot({ path: path.join(VTMP, "tp-stopped-team-after.png"), fullPage: true });
  finishVideo([{ file: await saveVideo(D, "tp-stopped-team.webm"), from }], "tp-team-stopped", "The team stops the test while a call is being requested: the request is refused, the page moves to the top and the banner names the press that didn't go through");
});

// ---------- Visual check of tonight's tester dashboard boxes (not doc pictures; kept in the temp folder) ----------
group("check", async () => {
  const tia = await account(`tester+media${TS}ck@playtest.test`, "Tia Brooks", "tester", "she", { phone: true });
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
  await tia.screenshot({ path: path.join(OUT, "checks", "tester-dashboard-boxes-phone.png"), fullPage: true });
  const dk = await same(tia, DESKTOP);
  await dk.goto("/app");
  await pause(dk, 1200);
  await dk.screenshot({ path: path.join(OUT, "checks", "tester-dashboard-boxes.png"), fullPage: true });
  const words = /\b(hold|suspend\w*|fail\w*|chargeback\w*)\b/i;
  for (const [url, name] of [["/app", "dashboard"], [`/app/sessions/${sd}`, "paused-session"], [`/app/sessions/${sb}`, "charge-session"], ["/app/notifications", "bell"], ["/app/payments", "payments"]]) {
    await dk.goto(url);
    await pause(dk, 1000);
    const text = await dk.locator("main").innerText();
    const hit = text.split("\n").filter((l) => words.test(l));
    console.log(`   tester ${name}: ${hit.length ? "FOUND " + JSON.stringify(hit.slice(0, 5)) : "clean"}`);
    await dk.screenshot({ path: path.join(VTMP, `check-tester-${name}.png`), fullPage: true });
  }
});

{
  (async () => {
    browser = await chromium.launch({ channel: "msedge" });
    for (const g of groups) {
      if (ONLY.length && !ONLY.includes(g.id)) continue;
      console.log("==", g.id);
      try {
        await g.fn();
      } catch (e) {
        console.log("   FAILED", g.id, String(e.stack || e).split("\n").slice(0, 4).join(" | "));
        let n = 0;
        for (const c of browser.contexts()) for (const pg of c.pages()) await pg.screenshot({ path: path.join(VTMP, `${g.id}-FAILED-${++n}.png`), fullPage: true }).catch(() => {});
        console.log("   failure shots in", VTMP);
      }
    }
    await browser.close();
    const listFile = path.join(OUT, "captions.json");
    const prev = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, "utf8")) : {};
    for (const m of made) prev[m.file] = { caption: m.caption, kind: m.kind };
    fs.writeFileSync(listFile, JSON.stringify(prev, null, 2));
    console.log("done:", made.length, "files; temp", VTMP);
  })();
}
