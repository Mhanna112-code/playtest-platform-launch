// Dec 10 media round: shared helpers. Every scene runs against the 3450 media server (playtest_lite_media, fake Stripe, dev outbox),
// with fresh throwaway accounts (dev+d10…@playtest.test / tester+d10…@playtest.test); direct database writes touch only those accounts' rows.
// Two people are recorded at once (Nora = developer on the left, Ana = tester on the right) and put side by side with a caption band (ASS subtitles).
/* eslint-disable */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const PW = "C:/Users/march/Projects/playtest-platform/node_modules/playwright";
const FFMPEG = "C:/Users/march/Projects/playtest-platform/node_modules/ffmpeg-static/ffmpeg.exe";
(function useLocalFfmpeg() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return;
  const cache = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (fs.existsSync(cache) && fs.readdirSync(cache).some((d) => /^ffmpeg-/.test(d))) return;
  const rev = require(PW + "/node_modules/playwright-core/browsers.json").browsers.find((b) => b.name === "ffmpeg").revision;
  const dst = path.join(os.tmpdir(), "playtest-lite-evidence-pw", `ffmpeg-${rev}`, "ffmpeg-win64.exe");
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(FFMPEG, dst);
  }
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(os.tmpdir(), "playtest-lite-evidence-pw");
})();
const { chromium } = require(PW);

const BASE = "http://localhost:3450";
const DB = "playtest_lite_media";
const ROOT = path.join(__dirname, "..", "..");
const OUT = path.join(ROOT, "docs", "media", "round-dec10");
fs.mkdirSync(OUT, { recursive: true });
const VTMP = fs.mkdtempSync(path.join(os.tmpdir(), "pt-dec10-"));
const PASSWORD = /const PASSWORD = "([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, "scripts", "evidence.cjs"), "utf8"))[1];
const DESKTOP = { viewport: { width: 1280, height: 900 } };
const TS = String(Date.now()).slice(-9);
let browser;
const L = { browser: null };

// ---------- database (only this run's own rows) ----------
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-p", "5499", "-U", "postgres", "-d", DB, "-t", "-A", "-c", q]).toString().split(String.fromCharCode(13)).join("").trim();
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sqlId = (q) => sql(q).split(String.fromCharCode(10))[0].trim();
const utcNow = "(now() at time zone 'utc')";
const userId = (email) => sql(`select id from "User" where email = ${lit(email)}`);
function own(q) {
  if (!/@playtest\.test/.test(q) && !/where id = '/.test(q) && !/"testId" = '/.test(q) && !/"contractId" = '/.test(q)) throw new Error("own(): the query must name this run's own rows");
  return sql(q);
}

// ---------- pages ----------
const hideDevBadge = (c) => c.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "nextjs-portal{display:none!important}"; document.head.appendChild(s); }));
async function newCtx(opts = {}) {
  const c = await L.browser.newContext({ ...DESKTOP, baseURL: BASE, ...opts });
  c.setDefaultTimeout(15000);
  c.setDefaultNavigationTimeout(60000);
  await hideDevBadge(c);
  return c;
}
function safe(p) {
  const g = p.goto.bind(p);
  // (a slow dev server: a load that hasn't finished in 60 s is logged and the scene goes on; the next step waits for what it needs)
  const slow = (e, what) => { if (/Timeout/.test(String(e))) { console.log("   ! slow load:", what); return true; } return false; };
  p.goto = async (u, o) => { try { return await g(u, o); } catch (e) { if (slow(e, u)) return null; if (!/ERR_ABORTED|interrupted by another navigation/.test(String(e))) throw e; await p.waitForTimeout(1200); return g(u, o); } };
  const r = p.reload.bind(p);
  p.reload = async (o) => { try { return await r(o); } catch (e) { if (slow(e, "reload " + p.url())) return null; if (!/ERR_ABORTED|interrupted by another navigation|detached/.test(String(e))) throw e; await p.waitForTimeout(1500); return r(o); } };
  return p;
}
const post = async (page, p, data = {}) => {
  if (p === "/api/tests" || /\/(edit|post-draft)$/.test(p)) data = { payRulesOk: true, ...data };
  const r = await page.context().request.post(BASE + p, { data, headers: { "content-type": "application/json" }, timeout: 90000 });
  const body = await r.json().catch(() => ({}));
  if (!r.ok() && !post.quiet) console.log("   ! POST", p, r.status(), JSON.stringify(body).slice(0, 300));
  return { status: r.status(), ok: r.ok(), body };
};
const get = async (page, p) => { const r = await page.context().request.get(BASE + p); return r.json().catch(() => ({})); };
const ok = (r, what) => { if (!r.ok) throw new Error(`${what} failed: ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
const nowIso = () => new Date().toISOString();
const go = { confirmed: true };

/** A throwaway account through the sign-up API (sides, name, Terms, devices and languages for a tester), email confirmed. Returns a signed-in page (not recording). */
async function account(tag, name, role, pronoun = "she") {
  const email = `${role === "tester" ? "tester" : "dev"}+d10${TS}${tag}@playtest.test`;
  const c = await newCtx();
  const p = safe(await c.newPage());
  sql(`delete from "LoginAttempt" where kind = 'signup' and ip in ('::1', '127.0.0.1', '::ffff:127.0.0.1')`);
  const r = await post(p, "/api/auth/signup", { email, password: PASSWORD, role, name, pronoun, acceptTerms: true, over18: true, devices: ["Windows PC"], languages: ["English"] });
  if (!r.ok) throw new Error("sign-up failed for " + email + ": " + JSON.stringify(r.body).slice(0, 200));
  own(`update "User" set "emailVerifiedAt" = ${utcNow} where email = ${lit(email)}`);
  p.email = email; p.name = name; p.uid = userId(email);
  if (role !== "tester") {
    // The media server's launch is over: a developer subscribes (fake Stripe, test card).
    own(`update "User" set "stripeCustomerId" = coalesce("stripeCustomerId", 'cus_fake_' || id), "stripePaymentMethodId" = coalesce("stripePaymentMethodId", 'pm_card_visa') where email = ${lit(email)}`);
    await post(p, "/api/payments/subscription", { action: "subscribe", seenAt: nowIso() });
  }
  return p;
}
const day = (n) => { const d = new Date(Date.now() + n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const LISTING = {
  productName: "Harbor Run", title: "Harbor Run: 3 levels", description: "Sail through the first three harbors and tell us where the controls or the map get confusing.",
  buildUrl: "https://example.com/harbor-run", categories: ["Game"], devices: [], languages: [], mature: false, matureWhy: "", ndaText: "",
  spots: "5", writtenCents: "10.00", recordingCents: null, liveRateCents: null, liveMinutes: null,
  writtenRequired: true, recordingRequired: false, liveRequired: false, questions: ["What did you like?", "Where did you get stuck?"], joinMode: "anyone",
};
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
async function apiEdit(dev, id, fields, keys = {}) {
  const r = await dev.context().request.get(`${BASE}/api/tests/${id}/listing`);
  const { version } = await r.json();
  return ok(await post(dev, `/api/tests/${id}/edit`, { version, fields, confirmed: true, keysAdd: keys.add ?? [], keysRemove: keys.remove ?? [] }), "edit");
}
const ANS = ["The boat handling feels great and the harbor lights help a lot at night.", "The second bridge: I couldn't tell where to go, the map arrow points the wrong way."];
async function sendWritten(tester, sessionId, answers = ANS) {
  return ok(await post(tester, `/api/sessions/${sessionId}/written`, { answers, notes: "", seenAt: nowIso(), confirmed: true }), "written");
}
const subOf = (sessionId, kind = "written") => sql(`select id from "Submission" where "contractId" = '${sessionId}' and kind = '${kind}' order by "sentAt" desc limit 1`);
const ensureCard = (email) => own(`update "User" set "stripeCustomerId" = coalesce("stripeCustomerId", 'cus_fake_' || id), "stripePaymentMethodId" = 'pm_card_visa' where email = ${lit(email)} and "stripePaymentMethodId" is null`);
async function payWith(dev, subId, dollars, reason = "") {
  ensureCard(dev.email);
  const cents = Math.round(Number(dollars) * 100);
  return post(dev, "/api/review", { action: "pay", kind: "submission", id: subId, amount: dollars, tickedCents: cents, reason, note: reason, payKey: crypto.randomUUID(), seenAt: nowIso(), confirmed: true });
}
let adminP = null, adminN = 0;
async function adminAccount() {
  if (adminP) return adminP;
  adminP = (async () => {
    const a = await account(`admin${++adminN}`, "Media Admin", "developer", "they");
    own(`update "User" set "isAdmin" = true where email = ${lit(a.email)}`);
    return a;
  })();
  return adminP;
}
const adminDo = async (action, id, more = {}) => ok(await post(await adminAccount(), `/api/admin/${action}`, { id, note: "Media pass check", ...more }), "admin " + action);
const STOP_WHY = "We found what we needed in this build: thank you!";
const stopTest = (dev, id) => post(dev, `/api/tests/${id}/stop`, { ...go, reason: STOP_WHY }).then((r) => ok(r, "stop"));
const endEarly = (dev, id, sid) => post(dev, `/api/tests/${id}/end-early`, { ...go, contractIds: [sid], reason: "We have what we need from this round, thank you." }).then((r) => ok(r, "end early"));

// ---------- on the page ----------
const pause = (page, ms = 900) => page.waitForTimeout(ms);
const flat = (s) => String(s || "").replace(/\s+/g, " ").trim();
const textOf = async (page, sel) => flat(await page.locator(sel).first().innerText({ timeout: 3000 }).catch(() => ""));
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const center = (page, sel) => page.locator(sel).first().evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
const tick = (page) => page.evaluate(() => window.dispatchEvent(new Event("live-tick"))).catch(() => {});
async function waitLive(page, selector, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await page.locator(selector).first().isVisible().catch(() => false)) return true;
    await tick(page);
    await page.waitForTimeout(700);
  }
  console.log("   ! waitLive: nothing for", selector, "on", page.url());
  return false;
}
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
const waitPulse = (page, ms = 25000) => page.waitForResponse((r) => r.url().includes("/api/pulse"), { timeout: ms }).catch(() => null);
const unfold = (page, sel) => page.evaluate((s) => { let n = document.querySelector(s); while (n) { if (n.tagName === "DETAILS") n.open = true; n = n.parentElement; } }, sel);
/** A press that may open the "Are you sure?" pop-up first: confirms it when it does. */
async function pressConfirm(page, button, confirmLabel) {
  await button.click({ timeout: 8000 });
  const dlg = page.locator("dialog[open]");
  if (await dlg.waitFor({ state: "visible", timeout: 2500 }).then(() => true, () => false)) {
    await page.waitForTimeout(700);
    const why = dlg.locator("#stop-reason");
    if ((await why.count()) && !(await why.inputValue())) await why.fill(STOP_WHY);
    await dlg.locator("button", { hasText: confirmLabel }).last().click();
  }
}
const typeIn = async (page, sel, text, delay = 35) => { await page.locator(sel).first().click(); await page.keyboard.type(text, { delay }); };
/** Every visible text matching (for the log). */
const texts = async (page, loc) => { const out = []; for (const l of await loc.all()) if (await l.isVisible().catch(() => false)) out.push(flat(await l.innerText().catch(() => ""))); return out; };
/** What the page says under its buttons and at the top (for the log and INDEX.md). */
async function lines(page, label) {
  const under = await texts(page, page.locator("[data-stop-line], [data-didnt-go], p.err, .err-field, [data-red-msg-line], [data-mistake-list], [data-answer-one], [data-refusal], [data-answer-terms], [data-nda-refusal], [data-kept-refusal], [data-paused-send], [data-dispute-meanwhile]"));
  const top = await texts(page, page.locator("[data-live-top] li, [data-live-box] li"));
  console.log(`   [${label}] under buttons: ${JSON.stringify([...new Set(under)].map((x) => x.slice(0, 220)))}`);
  if (top.length) console.log(`   [${label}] top box: ${JSON.stringify(top.slice(0, 8).map((x) => x.slice(0, 200)))}`);
  return { under, top };
}

// ---------- recording two people side by side ----------
/**
 * duo(name, title, [left, right]): each person's page recorded in its own browser context (same sign-in as `from`), started together.
 * say(text) adds a caption from now until the next one. finish() puts the two side by side (Nora left, Ana right), with each window's label
 * and the caption band under them, as WebM (and MP4) in docs/media/round-dec10/.
 */
const CAPTIONS = []; // { file, title, caption, steps, secs, sameFor, found, notReachable }
async function recPage(from, label) {
  const c = await L.browser.newContext({ ...DESKTOP, baseURL: BASE, storageState: await from.context().storageState(), recordVideo: { dir: VTMP, size: DESKTOP.viewport } });
  c.setDefaultTimeout(15000);
  c.setDefaultNavigationTimeout(60000);
  await hideDevBadge(c);
  const p = safe(await c.newPage());
  p.t0 = Date.now();
  p.label = label;
  p.email = from.email; p.name = from.name; p.uid = from.uid;
  return p;
}
/** A second tab (same browser context = same person, same sign-in, the same browser) of a recorded page: recorded too. */
async function recTab(of, label) {
  const p = safe(await of.context().newPage());
  p.t0 = Date.now();
  p.label = label;
  p.email = of.email; p.name = of.name; p.uid = of.uid;
  return p;
}
function duo(name, title) {
  const D = { name, title, steps: [], pages: [], t0: 0 };
  /** Start the clock (call when both pages are on screen). */
  D.start = (pages) => { D.pages = pages; D.t0 = Date.now(); D.say(title, 3500); };
  D.say = (text, ms) => {
    const t = (Date.now() - D.t0) / 1000;
    D.steps.push({ t, text, ms });
    console.log(`   >> ${t.toFixed(1)} s  ${text}`);
  };
  D.finish = async ({ secsMax } = {}) => {
    const end = (Date.now() - D.t0) / 1000;
    const files = [];
    for (const p of D.pages) {
      const v = p.video();
      const tStart = (D.t0 - p.t0) / 1000;
      await p.context().close().catch(() => {});
      const dst = path.join(VTMP, `${name}-${files.length}-${Date.now()}.webm`);
      await v.saveAs(dst);
      files.push({ file: dst, from: Math.max(0, tStart), label: p.label });
    }
    fs.writeFileSync(path.join(VTMP, `${name}.plan.json`), JSON.stringify({ name, title: D.title, steps: D.steps, files, end }));
    compose(files, D, end);
    return D;
  };
  return D;
}
const assTime = (s) => { s = Math.max(0, s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = (s % 60).toFixed(2).padStart(5, "0"); return `${h}:${String(m).padStart(2, "0")}:${x}`; };
const assEsc = (t) => String(t).replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, "\\N");
/** Side by side (or one window), each scaled to 960x675, with a 150-px caption band below; captions burned in from an ASS file. */
function compose(files, D, end) {
  const W = 960, H = 676, GAP = 8, BAND = 150;
  const n = files.length;
  const TW = n * W + (n - 1) * GAP, TH = H + BAND;
  const ass = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${TW}`, `PlayResY: ${TH}`, "WrapStyle: 0", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Cap,Arial,30,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,40,40,22,1",
    "Style: Title,Arial,38,&H0000E5FF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,2,40,40,40,1",
    "Style: Who,Arial,24,&H00FFFFFF,&H00FFFFFF,&H00000000,&HB0302010,1,0,0,0,100,100,0,0,3,6,0,7,0,0,0,1",
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  files.forEach((f, i) => ass.push(`Dialogue: 1,${assTime(0)},${assTime(end + 5)},Who,,0,0,0,,{\\pos(${i * (W + GAP) + 12},${H + 6})}${assEsc(f.label)}`));
  const steps = D.steps;
  steps.forEach((s, i) => {
    const next = steps[i + 1] ? steps[i + 1].t : end;
    const stop = s.ms ? Math.min(next, s.t + s.ms / 1000) : next;
    const style = i === 0 ? "Title" : "Cap";
    ass.push(`Dialogue: 0,${assTime(s.t)},${assTime(Math.max(stop, s.t + 1))},${style},,0,0,0,,${assEsc(s.text)}`);
  });
  const assFile = path.join(VTMP, `${D.name}.ass`);
  fs.writeFileSync(assFile, ass.join("\n"));
  const assArg = assFile.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\:");
  const inputs = [];
  for (const f of files) inputs.push("-ss", f.from.toFixed(2), "-t", end.toFixed(2), "-i", f.file);
  const pre = files.map((f, i) => `[${i}:v]fps=25,scale=${W}:${H},setsar=1${i < n - 1 ? `,pad=${W + GAP}:${H}:0:0:0x101826` : ""}[v${i}]`).join(";");
  const stack = n === 2 ? "[v0][v1]hstack=inputs=2:shortest=1[s]" : "[v0]null[s]";
  const filter = `${pre};${stack};[s]pad=${TW}:${TH}:0:0:0x101826,subtitles='${assArg}'[out]`;
  const webm = path.join(OUT, `${D.name}.webm`), mp4 = path.join(OUT, `${D.name}.mp4`);
  // Under about 8 MB each: the rate follows the length.
  const kbps = Math.max(220, Math.min(1400, Math.floor((5.8 * 8 * 1024) / Math.max(end, 1))));
  // Constant quality (screen recordings are mostly still); encoded again at a lower quality until it is under about 7.5 MB.
  for (let crf = 38; ; crf += 4) {
    execFileSync(FFMPEG, ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filter, "-map", "[out]", "-c:v", "libvpx-vp9", "-crf", String(crf), "-b:v", "0", "-deadline", "good", "-cpu-used", "4", "-row-mt", "1", "-an", webm]);
    if (fs.statSync(webm).size <= 7.5 * 1048576 || crf >= 54) break;
  }
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-preset", "medium", "-crf", "30", "-maxrate", `${Math.floor(kbps * 1.4)}k`, "-bufsize", `${kbps * 3}k`, "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4]);
  const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(1);
  console.log(`   = ${D.name}.webm ${end.toFixed(0)} s, ${mb(webm)} MB (mp4 ${mb(mp4)} MB)`);
  D.secs = Math.round(end);
}
/** Writes this scene's entry for captions / INDEX (scenes.json in the output folder, merged across runs). */
function noteScene(D, extra) {
  const f = path.join(OUT, "scenes.json");
  const all = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
  all[D.name] = { file: `${D.name}.webm`, mp4: `${D.name}.mp4`, title: D.title, secs: D.secs, steps: D.steps.slice(1).map((s) => `${fmt(s.t)} ${s.text}`), ...extra };
  fs.writeFileSync(f, JSON.stringify(all, null, 2));
}
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

async function launch() {
  L.browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome" });
  return L.browser;
}

const resetAdmin = () => { adminP = null; };
module.exports = {
  resetAdmin,
  PASSWORD,
  compose,
  L, BASE, OUT, VTMP, sql, lit, sqlId, utcNow, own, userId, newCtx, safe, post, get, ok, nowIso, go, account, day, LISTING, postTest, join, apiEdit, ANS, sendWritten, subOf,
  ensureCard, payWith, adminAccount, adminDo, STOP_WHY, stopTest, endEarly, pause, flat, textOf, visible, center, tick, waitLive, waitGone, waitPulse, unfold, pressConfirm,
  typeIn, texts, lines, recPage, recTab, duo, noteScene, launch, crypto, FFMPEG, fs, path,
};
