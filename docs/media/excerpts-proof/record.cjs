// Records the excerpt proof clips (batch 35 §126 and the NDA cases) into docs/media/excerpts-proof/.
// Runs against its OWN dev server and schema, never the owner's 3400 site or data:
//   DATABASE_URL=…/playtest_lite?schema=rec_excerpts NEXT_DIST_DIR=.next-3482 APP_URL=http://localhost:3482 STRIPE_SECRET_KEY="" npx next dev -p 3482
// Every account is a fresh throwaway (…@playtest.test) made through the sign-up API. Each clip is two or three browser contexts (developer | tester | …)
// recorded separately and put side by side with ffmpeg. A grey strip at the top of each pane names who it is (added by this recorder, not the app); the
// yellow box is this recorder's wait timer, started at the press, with "same page load" proving no reload happened.
// Usage: node docs/media/excerpts-proof/record.cjs            (all clips)    ONLY=1,2 node … (some)
/* eslint-disable */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
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

const BASE = process.env.BASE || "http://localhost:3482";
if (/:3400\b/.test(BASE)) throw new Error("Never the owner's 3400 site");
const SCHEMA = "rec_excerpts";
const PSQL = "C:/Program Files/PostgreSQL/16/bin/psql.exe";
const OUT = __dirname;
const VTMP = path.join(os.tmpdir(), "excerpts-proof-video");
const PASSWORD = "Proof-pass-2026!";
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const results = [];

const sql = (q) => execFileSync(PSQL, ["-h", "localhost", "-p", "5499", "-U", "postgres", "-d", "playtest_lite", "-t", "-A", "-c", q], { env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA}` } }).toString().replace(/\r/g, "").trim();
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const nowIso = () => new Date().toISOString();
const pause = (p, ms) => p.waitForTimeout(ms);
let browser;

async function post(page, p, data = {}) {
  if (p === "/api/tests" || /\/edit$/.test(p)) data = { payRulesOk: true, ...data };
  const r = await page.context().request.post(BASE + p, { data, headers: { "content-type": "application/json" }, timeout: 90000 });
  const body = await r.json().catch(() => ({}));
  return { status: r.status(), ok: r.ok(), body };
}
const must = (r, what) => { if (!r.ok) throw new Error(`${what} failed: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };

let n = 0;
async function account(name, role) {
  sql(`delete from "LoginAttempt"`);
  const c = await browser.newContext({ baseURL: BASE });
  const p = await c.newPage();
  const email = `${role}+rex${Date.now().toString(36)}${n++}@playtest.test`;
  must(await post(p, "/api/auth/signup", { email, password: PASSWORD, role, name, acceptTerms: true, over18: true }), "sign-up");
  sql(`update "User" set "emailVerifiedAt" = now(), pronoun = 'they' where email = ${lit(email)}`);
  await post(p, "/api/profile", { name, pronoun: "they", isDeveloper: role !== "tester", isTester: role !== "developer", devices: ["Windows PC"], languages: ["English"], categories: [] });
  if (role === "developer") sql(`update "User" set "stripeCustomerId" = 'cus_rec_' || id, "stripePaymentMethodId" = 'pm_rec_' || id, "cardExpMonth" = 12, "cardExpYear" = 2030 where email = ${lit(email)}`);
  const uid = sql(`select id from "User" where email = ${lit(email)}`);
  return { ctx: c, page: p, email, name, uid };
}
const day = (k) => { const d = new Date(Date.now() + k * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const Q1 = "What did you like?", Q2 = "Where did you get stuck?";
const A1 = "The harbour level felt great, but the second boss was far too hard for me and I gave up twice.";
const A2 = "Nowhere really, the menus were smooth and the music kept me going all the way through.";
async function postTest(dev, title) {
  return must(await post(dev.page, "/api/tests", {
    productName: title, title, description: "Sail through the first harbors and tell us what works.", buildUrl: "https://example.com/build", categories: ["Game"], devices: [], languages: [],
    mature: false, matureWhy: "", ndaText: "", spots: "5", writtenCents: "10.00", recordingCents: null, liveRateCents: null, liveMinutes: null,
    writtenRequired: true, recordingRequired: false, liveRequired: false, questions: [Q1, Q2], joinMode: "anyone", openUntil: day(14), accessKeys: "",
  }), "post").id;
}
async function joinAndSend(tester, testId, answers = [A1, A2]) {
  const sid = must(await post(tester.page, `/api/tests/${testId}/join`, { seenAt: nowIso(), confirmed: true, anyway: true, ndaAccepted: true, acceptNda: true }), "join").sessionId;
  must(await post(tester.page, `/api/sessions/${sid}/written`, { answers, notes: "", seenAt: nowIso(), confirmed: true }), "written");
  const subId = sql(`select id from "Submission" where "contractId" = ${lit(sid)} and kind = 'written'`);
  return { sid, subId };
}
async function payPart(dev, subId) {
  must(await post(dev.page, "/api/review", { payKey: require("crypto").randomUUID(), seenAt: nowIso(), confirmed: true, kind: "submission", id: subId, amount: "10.00", tickedCents: 1000 }), "pay");
}
/** A test, the tester in it, both answers sent and paid. */
async function paidPart(dev, tester, title = "Harbor Run", answers) {
  const testId = await postTest(dev, title);
  const { sid, subId } = await joinAndSend(tester, testId, answers);
  await payPart(dev, subId);
  return { testId, sid, subId, title };
}
const askApi = (tester, subId, text, index = 0) => post(tester.page, "/api/excerpts", { action: "request", submissionId: subId, index, text });
const decideApi = (dev, id, decision) => post(dev.page, "/api/excerpts", { action: "decide", excerptId: id, decision });
async function shown(dev, tester, subId, text, index = 0) {
  const id = must(await askApi(tester, subId, text, index), "request").id;
  must(await decideApi(dev, id, "allow"), "allow");
  return id;
}
async function setNda(dev, testId, ndaText) {
  const r = await dev.page.context().request.get(`${BASE}/api/tests/${testId}/listing`);
  const { version } = await r.json();
  return post(dev.page, `/api/tests/${testId}/edit`, { version, fields: { ndaText }, confirmed: true, keysAdd: [], keysRemove: [] });
}

// ---------- recording ----------
const W = 760, H = 900;
async function pane(who, label, color = "#334155") {
  const c = await browser.newContext({ baseURL: BASE, viewport: { width: W, height: H }, storageState: await who.ctx.storageState(), recordVideo: { dir: VTMP, size: { width: W, height: H } } });
  c.setDefaultTimeout(20000);
  c.setDefaultNavigationTimeout(60000);
  await c.addInitScript(([label, color]) => {
    window.__loadId = Math.random().toString(36).slice(2);
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = "nextjs-portal{display:none!important} body{padding-top:26px!important}";
      document.head.appendChild(s);
      const b = document.createElement("div");
      b.id = "__rec_label";
      b.textContent = label;
      b.style.cssText = `position:fixed;top:0;left:0;right:0;height:26px;z-index:2147483647;background:${color};color:#fff;font:600 13px system-ui;display:flex;align-items:center;padding:0 10px;pointer-events:none`;
      document.body.appendChild(b);
    });
  }, [label, color]);
  const p = await c.newPage();
  p.label = label;
  return p;
}
/** The recorder's wait box: seconds since the press, until `until()` is true; then "after N s, same page load". No reload, no navigation. */
async function waitLive(p, what, until, max = 30000) {
  const loadId = await p.evaluate(() => window.__loadId);
  await p.evaluate((what) => {
    const d = document.createElement("div");
    d.id = "__rec_wait";
    d.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:2147483647;background:#fde047;color:#111;font:600 14px system-ui;padding:8px 12px;border-radius:8px;box-shadow:0 2px 8px #0008;pointer-events:none";
    const t0 = Date.now();
    window.__recT0 = t0;
    const tick = () => { if (!d.dataset.done) d.textContent = `Waiting for ${what} (no reload): ${Math.floor((Date.now() - t0) / 1000)} s`; };
    tick();
    window.__recTimer = setInterval(tick, 250);
    document.body.appendChild(d);
  }, what);
  const t0 = Date.now();
  let ok = false;
  while (Date.now() - t0 < max) {
    if (await until().catch(() => false)) { ok = true; break; }
    await p.waitForTimeout(250);
  }
  const secs = Math.round((Date.now() - t0) / 100) / 10;
  const same = (await p.evaluate(() => window.__loadId).catch(() => null)) === loadId;
  await p.evaluate(([ok, secs, same, what]) => {
    let d = document.getElementById("__rec_wait");
    if (!d) { d = document.createElement("div"); d.id = "__rec_wait"; d.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:2147483647;font:600 14px system-ui;padding:8px 12px;border-radius:8px;pointer-events:none"; document.body.appendChild(d); }
    clearInterval(window.__recTimer);
    d.dataset.done = "1";
    d.style.background = ok ? "#86efac" : "#fca5a5";
    d.style.color = "#111";
    d.textContent = ok ? `${what}: after ${secs} s · same page load: ${same ? "yes" : "NO"}` : `${what}: NOT after ${secs} s`;
  }, [ok, secs, same, what]).catch(() => null);
  return { ok, secs, same };
}
const clearWait = (p) => p.evaluate(() => document.getElementById("__rec_wait")?.remove()).catch(() => null);
async function shot(p, name) {
  await p.screenshot({ path: path.join(OUT, `${name}.png`) });
  return `${name}.png`;
}
/** Close the panes and put their videos side by side as <name>.mp4. */
async function finish(name, pages) {
  const vids = [];
  for (const p of pages) { const v = p.video(); await p.context().close(); vids.push(await v.path()); }
  const out = path.join(OUT, `${name}.mp4`);
  const inputs = vids.flatMap((v) => ["-i", v]);
  const filter = `${vids.map((_, i) => `[${i}:v]`).join("")}hstack=inputs=${vids.length}[v]`;
  const pick = vids.length > 1 ? ["-filter_complex", filter, "-map", "[v]"] : [];
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", ...inputs, ...pick, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "30", "-preset", "veryfast", out]);
  vids.forEach((v) => fs.rmSync(v, { force: true }));
  return `${name}.mp4`;
}
function record(id, title, proves, pass, files, note = "") {
  results.push({ id, title, proves, pass, files, note });
  console.log(`${pass ? "PASS" : "FAIL"} clip ${id}: ${title}${note ? ` (${note})` : ""}`);
}

// ---------- page helpers ----------
const sessionUrl = (sid) => `/app/sessions/${sid}`;
async function openPicker(p, subId, question, text) {
  await p.getByRole("button", { name: "Show an excerpt on your profile" }).click();
  if (question) await p.locator("[data-excerpt-picker] label", { hasText: question }).locator("input").check();
  const box = p.locator(`#excerpt-text-${subId}`);
  await box.scrollIntoViewIfNeeded();
  if (text !== undefined) { await box.fill(""); await pause(p, 300); await box.pressSequentially(text, { delay: 12 }); }
  return box;
}
const askBtn = (p) => p.getByRole("button", { name: "Ask the developer" });
async function pickerError(p) {
  // (A refused press redraws the page, which can take the picker away: the refusal line stays on the page.)
  await pause(p, 1500);
  return (await p.locator("main").innerText().catch(() => "")) || "";
}
const reqRow = (p, text) => p.locator("[data-excerpt-request]", { hasText: text }).first();
const myList = (p) => p.locator("#excerpts");

// ---------- clips ----------
const clips = {};

clips["1-4"] = async () => {
  const dev = await account("Nora Lane", "developer");
  const tester = await account("Ana Silva", "tester");
  const t = await paidPart(dev, tester);
  const TA = "the second boss was far too hard for me";
  const TB = "The harbour level felt great";
  const TC = "felt great, but the second boss was far too hard";

  // 1. Live request.
  {
    const d = await pane(dev, "Developer · Nora · test page", "#7c3aed");
    const s = await pane(tester, "Tester · Ana · session page", "#0369a1");
    await d.goto(`/app/tests/${t.testId}`);
    await s.goto(sessionUrl(t.sid));
    await pause(s, 1500);
    await openPicker(s, t.subId, Q1, TA);
    await pause(s, 600);
    await askBtn(s).click();
    const live = await waitLive(d, "the request", () => reqRow(d, TA).isVisible());
    await reqRow(d, TA).scrollIntoViewIfNeeded().catch(() => null);
    await pause(d, 2500);
    const shots = [await shot(d, "01-live-request-developer"), await shot(s, "01-live-request-tester")];
    const files = [await finish("01-live-request", [d, s]), ...shots];
    record(1, "Live request", "A tester's request appears in the developer's Needs you without a reload, within one 20 s beat", live.ok && live.same && live.secs <= 21, files, `appeared after ${live.secs} s, same page load: ${live.same}`);
  }
  // 2. Live decision: Allow; the session page and the profile follow.
  {
    const d = await pane(dev, "Developer · Nora · test page", "#7c3aed");
    const s = await pane(tester, "Tester · Ana · session page", "#0369a1");
    const pr = await pane(tester, "Tester · Ana · own profile", "#0f766e");
    await d.goto(`/app/tests/${t.testId}`);
    await s.goto(sessionUrl(t.sid));
    await pr.goto(`/app/testers/${tester.uid}`);
    await s.locator("[data-excerpt-pending]").scrollIntoViewIfNeeded().catch(() => null);
    await reqRow(d, TA).scrollIntoViewIfNeeded();
    await pause(d, 1500);
    await reqRow(d, TA).getByRole("button", { name: "Allow" }).click();
    const [ls, lp] = await Promise.all([
      waitLive(s, "the decision", async () => !(await s.locator("[data-excerpt-pending]").count()) && (await s.getByRole("button", { name: "Show an excerpt on your profile" }).count()) > 0),
      waitLive(pr, "the excerpt", () => myList(pr).getByText(TA).isVisible()),
    ]);
    await myList(pr).scrollIntoViewIfNeeded().catch(() => null);
    await pause(pr, 2500);
    const shots = [await shot(s, "02-live-allow-session"), await shot(pr, "02-live-allow-profile")];
    const files = [await finish("02-live-allow", [d, s, pr]), ...shots];
    record(2, "Live decision (Allow)", "After Allow, the tester's session page (waiting note goes, Show an excerpt is back) and their profile (the excerpt, Shown) update without a reload",
      ls.ok && lp.ok && ls.same && lp.same, files, `session page after ${ls.secs} s, profile after ${lp.secs} s, same page loads: ${ls.same && lp.same}`);
  }
  // 3. Duplicates refused: shown; then pending (from a second tab loaded before the request).
  let bId;
  {
    const d = await pane(dev, "Developer · Nora · test page", "#7c3aed");
    const s = await pane(tester, "Tester · Ana · session page (tab 1)", "#0369a1");
    const s2 = await pane(tester, "Tester · Ana · same session (tab 2)", "#0e7490");
    await d.goto(`/app/tests/${t.testId}`);
    await s.goto(sessionUrl(t.sid));
    await s2.goto(sessionUrl(t.sid));
    await openPicker(s, t.subId, Q1, TA);
    await askBtn(s).click();
    const e1 = await pickerError(s);
    const okShown = e1.includes("This excerpt is already on your profile.");
    await pause(s, 1500);
    // Tab 2 opens its box now (before tab 1 asks the new text), then tab 1 asks TB; tab 2 asks the same TB at once.
    await openPicker(s2, t.subId, Q1, TB);
    const box1 = s.locator(`#excerpt-text-${t.subId}`);
    await box1.fill("");
    await box1.pressSequentially(TB, { delay: 12 });
    await askBtn(s).click();
    await pause(s, 1500);
    await askBtn(s2).click();
    const e2 = await pickerError(s2);
    const okPending = e2.includes("You already asked to show this excerpt.");
    await pause(s2, 1500);
    const shots = [await shot(s, "03-duplicate-shown"), await shot(s2, "03-duplicate-pending")];
    const files = [await finish("03-duplicates", [d, s, s2]), ...shots];
    bId = sql(`select id from "Excerpt" where "contractId" = ${lit(t.sid)} and status = 'pending'`);
    const rows = Number(sql(`select count(*) from "Excerpt" where "contractId" = ${lit(t.sid)}`));
    record(3, "Duplicates refused", "The same text as a shown excerpt → \"This excerpt is already on your profile.\"; the same text as a pending one (another tab) → \"You already asked to show this excerpt.\"; no extra rows",
      okShown && okPending && rows === 2, files, `shown refusal: ${okShown}, pending refusal: ${okPending}, rows for the session: ${rows} (1 shown + 1 pending)`);
  }
  // 4. Replacement: the row names the shown one; Deny keeps it; then Allow swaps.
  {
    const d = await pane(dev, "Developer · Nora · test page", "#7c3aed");
    const s = await pane(tester, "Tester · Ana · session page", "#0369a1");
    const pr = await pane(tester, "Tester · Ana · own profile", "#0f766e");
    await d.goto(`/app/tests/${t.testId}`);
    await s.goto(sessionUrl(t.sid));
    await pr.goto(`/app/testers/${tester.uid}`);
    const row = reqRow(d, TB);
    await row.scrollIntoViewIfNeeded();
    const replaces = await row.locator("[data-excerpt-replaces]").innerText().catch(() => "");
    const okLine = replaces.includes("Replaces the excerpt shown now:") && replaces.includes(TA);
    await pause(d, 2500);
    const shotsA = [await shot(d, "04-replaces-line")];
    await row.getByRole("button", { name: "Deny" }).click();
    await pause(d, 2500);
    const keep = await waitLive(pr, "Deny (A stays)", async () => (await myList(pr).getByText(TA).isVisible()), 3000);
    const okDeny = sql(`select status from "Excerpt" where text = ${lit(TA)} and "contractId" = ${lit(t.sid)}`) === "shown";
    // The session page offers Show an excerpt again (live); ask TC.
    await waitLive(s, "the Deny", async () => (await s.getByRole("button", { name: "Show an excerpt on your profile" }).count()) > 0);
    await clearWait(s);
    await openPicker(s, t.subId, Q1, TC);
    await askBtn(s).click();
    const rowC = reqRow(d, TC);
    await waitLive(d, "the new request", () => rowC.isVisible());
    await rowC.scrollIntoViewIfNeeded();
    await pause(d, 1500);
    await rowC.getByRole("button", { name: "Allow" }).click();
    const swap = await waitLive(pr, "the swap", async () => (await myList(pr).getByText(TC).isVisible()) && !(await myList(pr).getByText(TA, { exact: false }).count()));
    await myList(pr).scrollIntoViewIfNeeded().catch(() => null);
    await pause(pr, 2500);
    const shots = [...shotsA, await shot(pr, "04-after-swap-profile")];
    const files = [await finish("04-replacement", [d, s, pr]), ...shots];
    const left = sql(`select string_agg(status || ':' || text, ' | ') from "Excerpt" where "contractId" = ${lit(t.sid)}`);
    record(4, "Same question replaces", "A different text for a question already shown: the developer's row says \"Replaces the excerpt shown now:\" with the old text; Deny keeps the old one; Allow on the next one shows it and removes the old (profile updates live)",
      okLine && okDeny && swap.ok && sql(`select string_agg(text, '|') from "Excerpt" where "contractId" = ${lit(t.sid)} and status = 'shown'`) === TC, files, `line: ${okLine}, Deny kept old: ${okDeny}, profile swapped after ${swap.secs} s; rows now: ${left}`);
  }
};

clips["5"] = async () => {
  const dev = await account("Omar Reyes", "developer");
  const tester = await account("Bea Kim", "tester");
  const testId = await postTest(dev, "Reef Racer");
  const sid = must(await post(tester.page, `/api/tests/${testId}/join`, { seenAt: nowIso(), confirmed: true, anyway: true, ndaAccepted: true, acceptNda: true }), "join").sessionId;
  // A file placed in the answer with the paperclip's API (upload, then its marker in the text).
  // A visible picture (a 240x140 test card), so the file is plain to see in the developer's view of the answer.
  const pngFile = path.join(VTMP, "map.png");
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=240x140:rate=1", "-frames:v", "1", pngFile]);
  const png = fs.readFileSync(pngFile);
  const st = must(await post(tester.page, `/api/sessions/${sid}/recording-start`, { part: "written", filename: "map.png", contentType: "image/png", size: png.length }), "upload start");
  const put = await tester.page.context().request.put(BASE + st.uploadUrl, { data: png, headers: { "content-type": "image/png" } });
  if (!put.ok()) throw new Error("upload PUT " + put.status());
  must(await post(tester.page, `/api/sessions/${sid}/recording-done`, { recordingId: st.recordingId }), "upload done");
  const marker = `[📎 map.png #${st.tag}]`;
  const answer = `The harbour level felt great ${marker} but the second boss was far too hard for me.`;
  must(await post(tester.page, `/api/sessions/${sid}/written`, { answers: [answer, A2], notes: "", seenAt: nowIso(), confirmed: true }), "written");
  const subId = sql(`select id from "Submission" where "contractId" = ${lit(sid)} and kind = 'written'`);
  await payPart(dev, subId);
  const d = await pane(dev, "Developer · Omar · test page (the answer, with its file)", "#7c3aed");
  const s = await pane(tester, "Tester · Bea · session page", "#0369a1");
  const pr = await pane(tester, "Tester · Bea · own profile", "#0f766e");
  await d.goto(`/app/tests/${testId}`);
  const img = d.locator(`img[alt="map.png"]`).first();
  const fileInAnswer = await img.isVisible().catch(() => false) || (await img.count()) > 0;
  await img.scrollIntoViewIfNeeded().catch(() => null);
  await s.goto(sessionUrl(sid));
  await pr.goto(`/app/testers/${tester.uid}`);
  const box = await openPicker(s, subId, Q1);
  const start = await box.inputValue();
  const clean = !start.includes("📎") && !start.includes("[file]") && start.startsWith("The harbour level felt great but the second boss");
  await pause(s, 2500);
  const shotBox = await shot(s, "05-trim-box-no-file");
  await askBtn(s).click();
  const row = reqRow(d, "felt great but");
  await waitLive(d, "the request", () => row.isVisible());
  await row.scrollIntoViewIfNeeded();
  const rowText = await row.innerText();
  await pause(d, 1000);
  const shotRow = await shot(d, "05-developer-row");
  await row.getByRole("button", { name: "Allow" }).click();
  const lp = await waitLive(pr, "the excerpt", () => myList(pr).getByText("felt great but the second boss").isVisible());
  const listHtml = await myList(pr).innerHTML().catch(() => "");
  const profileClean = !listHtml.includes("📎") && !listHtml.includes("[file]") && !listHtml.includes("<img");
  await myList(pr).scrollIntoViewIfNeeded().catch(() => null);
  await pause(pr, 2500);
  const shots = [shotBox, await shot(pr, "05-profile-no-file"), shotRow];
  const files = [await finish("05-no-files", [d, s, pr]), ...shots];
  const stored = sql(`select text from "Excerpt" where "contractId" = ${lit(sid)}`);
  record(5, "Files left out", "An answer holding a file (shown on the developer's side): the trim box, the developer's request row, the stored text and the profile have no file and no \"[file]\"",
    fileInAnswer && clean && profileClean && !rowText.includes("[file]") && !rowText.includes("📎") && !stored.includes("[file]") && !stored.includes("📎") && lp.ok, files,
    `file in the answer: ${fileInAnswer}; trim box starts "${start.slice(0, 60)}…"; stored: "${stored}"`);
};

clips["6"] = async () => {
  const dev = await account("Ivy Moss", "developer");
  const tester = await account("Cal Ortiz", "tester");
  const parts = [];
  for (const title of ["Harbor Run", "Reef Racer", "Kelp Quest"]) parts.push(await paidPart(dev, tester, title));
  for (const p of parts) await shown(dev, tester, p.subId, "the second boss was far too hard for me");
  const p0 = parts[0];
  const d = await pane(dev, "Developer · Ivy · Harbor Run test page", "#7c3aed");
  const s = await pane(tester, "Tester · Cal · Harbor Run session", "#0369a1");
  const pr = await pane(tester, "Tester · Cal · own profile (3 shown)", "#0f766e");
  await d.goto(`/app/tests/${p0.testId}`);
  await s.goto(sessionUrl(p0.sid));
  await pr.goto(`/app/testers/${tester.uid}`);
  await myList(pr).scrollIntoViewIfNeeded();
  const before = await myList(pr).locator("[data-my-excerpt]").count();
  await pause(pr, 1500);
  // A replacement at the cap: same question, different text.
  await openPicker(s, p0.subId, Q1, "The harbour level felt great");
  await askBtn(s).click();
  const row = reqRow(d, "The harbour level felt great");
  const lr = await waitLive(d, "the replacement request", () => row.isVisible());
  const replAccepted = lr.ok;
  await row.scrollIntoViewIfNeeded().catch(() => null);
  await pause(d, 1200);
  await row.getByRole("button", { name: "Allow" }).click().catch(() => null);
  await waitLive(pr, "the swap", () => myList(pr).getByText("The harbour level felt great").isVisible());
  const after = await myList(pr).locator("[data-my-excerpt]").count();
  await pause(pr, 1500);
  // A new 4th (the other question): refused.
  await clearWait(s);
  await waitLive(s, "Show an excerpt again", async () => (await s.getByRole("button", { name: "Show an excerpt on your profile" }).count()) > 0);
  await clearWait(s);
  await openPicker(s, p0.subId, Q2, "the menus were smooth and the music kept me going");
  await askBtn(s).click();
  const err = await pickerError(s);
  const refused = err.includes("You can show at most 3 excerpts. Remove one first.");
  await pause(s, 2000);
  const shots = [await shot(s, "06-fourth-refused"), await shot(pr, "06-three-after-replacement")];
  const files = [await finish("06-cap", [d, s, pr]), ...shots];
  record(6, "Cap of 3", "At 3 shown, a replacement for a shown question still goes through (still 3 after Allow); a new 4th is refused with \"You can show at most 3 excerpts. Remove one first.\"",
    before === 3 && replAccepted && after === 3 && refused, files, `before: ${before}, replacement accepted: ${replAccepted}, after Allow: ${after}, 4th refused: ${refused}`);
};

clips["7"] = async () => {
  const dev = await account("Lee Park", "developer");
  const tester = await account("Dee Fox", "tester");
  const t = await paidPart(dev, tester, "Tide Tower");
  const id = must(await askApi(tester, t.subId, "the second boss was far too hard for me"), "request").id;
  const d = await pane(dev, "Developer · Lee · test page", "#7c3aed");
  const s = await pane(tester, "Tester · Dee · dashboard, then the bell", "#0369a1");
  await d.goto(`/app/tests/${t.testId}`);
  await s.goto(`/app`);
  const row = reqRow(d, "the second boss");
  await row.scrollIntoViewIfNeeded();
  await pause(d, 1200);
  await row.getByRole("button", { name: "Deny" }).click();
  await pause(d, 1500);
  const bell = s.locator("[data-bell-count]").first();
  await waitLive(s, "the bell", async () => Number(await bell.getAttribute("data-bell-count")) > 0);
  await pause(s, 1200);
  await clearWait(s);
  await bell.click();
  await s.waitForURL(/\/app\/notifications/);
  const line = s.getByRole("link", { name: /prefers that work from .*Tide Tower.* isn't shown on profiles/ }).first();
  await line.scrollIntoViewIfNeeded().catch(() => null);
  await pause(s, 1500);
  await line.click();
  await s.waitForURL(/\/app\/sessions\//);
  const url = s.url();
  const btn = s.getByRole("button", { name: "Show an excerpt on your profile" });
  await btn.scrollIntoViewIfNeeded().catch(() => null);
  const hasBtn = await btn.isVisible().catch(() => false);
  await pause(s, 2500);
  const shots = [await shot(s, "07-bell-session-page")];
  const files = [await finish("07-deny-bell", [d, s]), ...shots];
  record(7, "Deny's bell", "The tester's bell line after Deny opens their session page, which offers Show an excerpt on your profile",
    url.includes(`/app/sessions/${t.sid}`) && hasBtn, files, `opened ${url.replace(BASE, "")}; Show an excerpt: ${hasBtn}`);
  void id;
};

clips["8-11"] = async () => {
  const dev = await account("Mia Hart", "developer");
  const tester = await account("Eli Shaw", "tester");
  const viewer = await account("Ray Cole", "developer");
  const t = await paidPart(dev, tester, "Coral Code");
  const T1 = "the second boss was far too hard for me";
  const T2 = "the menus were smooth and the music kept me going";
  await shown(dev, tester, t.subId, T1, 0);
  const pendingId = must(await askApi(tester, t.subId, T2, 1), "request 2").id;
  const NDA = "Don't share anything about Coral Code until launch.";
  // 8 + 10: the developer adds an NDA (Edit's Save, through its API) while a viewer's copy of the profile, the tester's own list and the developer's test page are open.
  let after = {};
  {
    const v = await pane(viewer, "Another developer · Ray · Eli's profile", "#b45309");
    const pr = await pane(tester, "Tester · Eli · own profile", "#0f766e");
    const d = await pane(dev, "Developer · Mia · test page", "#7c3aed");
    await v.goto(`/app/testers/${tester.uid}`);
    await pr.goto(`/app/testers/${tester.uid}`);
    await d.goto(`/app/tests/${t.testId}`);
    const vBefore = await v.locator("[data-shown-excerpts]").getByText(T1).isVisible().catch(() => false);
    await v.locator("[data-shown-excerpts]").scrollIntoViewIfNeeded().catch(() => null);
    await myList(pr).scrollIntoViewIfNeeded().catch(() => null);
    await shot(v, "08-viewer-before-nda");
    await pause(v, 1500);
    const r = await setNda(dev, t.testId, NDA);
    after.ndaSaved = r.ok;
    after.ndaBody = r.ok ? "" : JSON.stringify(r.body).slice(0, 200);
    const [lv, lp, ld] = await Promise.all([
      waitLive(v, "the NDA", async () => !(await v.getByText(T1).count()), 25000),
      waitLive(pr, "the NDA", () => myList(pr).getByText("Allowed · hidden while Coral Code has an NDA").first().isVisible(), 25000),
      waitLive(d, "the NDA note", () => d.locator("[data-excerpt-nda]").first().isVisible(), 25000),
    ]);
    after.live = { lv, lp, ld };
    // Whatever the live result, a reload shows what the pages say now.
    if (!lv.ok) { await pause(v, 1500); await v.reload(); }
    const vGone = !(await v.getByText(T1).count());
    if (!lp.ok) { await pause(pr, 1500); await pr.reload(); }
    const hiddenLine = await myList(pr).getByText("Allowed · hidden while Coral Code has an NDA").first().isVisible().catch(() => false);
    if (!ld.ok) { await pause(d, 1500); await d.reload(); }
    const note = d.locator("[data-excerpt-nda]").first();
    await note.scrollIntoViewIfNeeded().catch(() => null);
    const noteText = await note.innerText().catch(() => "");
    // The hover card (the developer's tester name in Testers): it never lists excerpts (batch 16 §23), before or after.
    const hover = await d.locator("[data-person-hover], [data-hover-card]").first().innerText().catch(() => "");
    await pause(d, 2000);
    const shots8 = [await shot(v, "08-viewer-after-nda"), await shot(pr, "08-tester-list-hidden"), await shot(d, "10-developer-nda-note")];
    // 10: Allow under the NDA → hidden, and the tester's bell line.
    const row = reqRow(d, T2);
    await row.scrollIntoViewIfNeeded().catch(() => null);
    await pause(d, 1000);
    await row.getByRole("button", { name: "Allow" }).click();
    await pause(d, 2000);
    const files8 = [await finish("08-10-nda-added", [v, pr, d]), ...shots8];
    record(8, "NDA added: shown excerpt hidden", "After the developer adds an NDA, the shown excerpt leaves the profile others see and the tester's own list says \"Allowed · hidden while … has an NDA\"; hover cards never list excerpts",
      after.ndaSaved && vBefore && vGone && hiddenLine, files8, `NDA saved: ${after.ndaSaved}${after.ndaBody ? ` (${after.ndaBody})` : ""}; viewer's profile ${lv.ok ? `live after ${lv.secs} s` : "only after a reload"}; tester's list ${lp.ok ? `live after ${lp.secs} s` : "only after a reload"}; hover card text: "${hover.slice(0, 80)}"`);
    after.note = noteText;
  }
  {
    const st = sql(`select status from "Excerpt" where id = ${lit(pendingId)}`);
    const bellLine = sql(`select text from "Notification" where "userId" = ${lit(tester.uid)} and text like 'Your excerpt from Coral Code was allowed.%'`);
    const n = await pane(tester, "Tester · Eli · notifications", "#0369a1");
    await n.goto(`/app/notifications`);
    const seen = await n.getByText("Your excerpt from Coral Code was allowed. It stays hidden while Coral Code has an NDA.").first().isVisible().catch(() => false);
    await pause(n, 2000);
    const shotsN = [await shot(n, "10-tester-bell-line")];
    const filesN = [await finish("10-allowed-under-nda-bell", [n]), ...shotsN];
    const okNote = after.note.includes("Coral Code has an NDA now: if you allow this, it stays hidden while Coral Code has an NDA.");
    record(10, "Waiting request when the NDA is added", "The developer's row says \"<test> has an NDA now: if you allow this, it stays hidden while <test> has an NDA.\"; Allow puts it straight into hidden and the tester's bell says so",
      okNote && st === "shown" && seen, [...filesN, "08-10-nda-added.mp4", "10-developer-nda-note.png"], `note: "${after.note}"; status after Allow: ${st}; bell: "${bellLine}"`);
  }
  // 11: the NDA removed → both come back.
  {
    const v = await pane(viewer, "Another developer · Ray · Eli's profile", "#b45309");
    const pr = await pane(tester, "Tester · Eli · own profile", "#0f766e");
    await v.goto(`/app/testers/${tester.uid}`);
    await pr.goto(`/app/testers/${tester.uid}`);
    await pause(v, 1500);
    const r = await setNda(dev, t.testId, "");
    const [lv, lp] = await Promise.all([
      waitLive(v, "the NDA removed", async () => (await v.getByText(T1).isVisible()) && (await v.getByText(T2).isVisible()), 25000),
      waitLive(pr, "the NDA removed", async () => (await myList(pr).getByText("Shown on your profile").count()) === 2, 25000),
    ]);
    if (!lv.ok) { await pause(v, 1500); await v.reload(); }
    if (!lp.ok) { await pause(pr, 1500); await pr.reload(); }
    const both = (await v.getByText(T1).isVisible().catch(() => false)) && (await v.getByText(T2).isVisible().catch(() => false));
    const mineBoth = (await myList(pr).getByText("Shown on your profile").count()) === 2;
    await v.locator("[data-shown-excerpts]").scrollIntoViewIfNeeded().catch(() => null);
    await pause(v, 2000);
    const shots = [await shot(v, "11-viewer-both-back"), await shot(pr, "11-tester-both-shown")];
    const files = [await finish("11-nda-removed", [v, pr]), ...shots];
    record(11, "NDA removed: both come back", "Removing the NDA brings back both the excerpt hidden by it and the one allowed under it, on the profile others see and in the tester's own list",
      r.ok && both && mineBoth, files, `viewer ${lv.ok ? `live after ${lv.secs} s` : "only after a reload"}; tester's list ${lp.ok ? `live after ${lp.secs} s` : "only after a reload"}`);
  }
};

clips["9"] = async () => {
  const dev = await account("Ana Wu", "developer");
  const tester = await account("Finn Roe", "tester");
  const t = await paidPart(dev, tester, "Kelp Quest");
  const d = await pane(dev, "Developer · Ana · test page", "#7c3aed");
  const s = await pane(tester, "Tester · Finn · session page (loaded before the NDA)", "#0369a1");
  await d.goto(`/app/tests/${t.testId}`);
  await s.goto(sessionUrl(t.sid));
  await openPicker(s, t.subId, Q1, "the second boss was far too hard for me");
  await pause(s, 1000);
  const r = await setNda(dev, t.testId, "Keep Kelp Quest private until launch.");
  await askBtn(s).click();
  const err = await pickerError(s);
  const refused = err.includes("This test now has an NDA, so its work can't be shown as an excerpt.");
  await pause(s, 1500);
  const gone = await waitLive(s, "the picker to go", async () => !(await s.locator("[data-excerpt-picker]").count()), 25000);
  await pause(s, 1500);
  const rows = Number(sql(`select count(*) from "Excerpt" where "contractId" = ${lit(t.sid)}`));
  const shots = [await shot(s, "09-refused-under-nda")];
  const files = [await finish("09-request-under-nda", [d, s]), ...shots];
  record(9, "New request under an NDA", "A request pressed from a page loaded before the NDA is refused (\"This test now has an NDA, so its work can't be shown as an excerpt.\"), nothing is stored, and the picker then leaves the page",
    r.ok && refused && rows === 0 && gone.ok, files, `refused: ${refused}; rows: ${rows}; picker gone ${gone.ok ? `after ${gone.secs} s` : "not live"}`);
};

clips["12"] = async () => {
  const dev = await account("Kai Bell", "developer");
  const tester = await account("Gus Lane", "tester");
  const a = await paidPart(dev, tester, "Harbor Run");
  const b = await paidPart(dev, tester, "Reef Racer");
  const c = await paidPart(dev, tester, "Coral Code");
  const e = await paidPart(dev, tester, "Tide Tower");
  await shown(dev, tester, a.subId, "the second boss was far too hard for me");
  await shown(dev, tester, b.subId, "the second boss was far too hard for me");
  await shown(dev, tester, c.subId, "the second boss was far too hard for me");
  must(await setNda(dev, c.testId, "Coral Code stays private."), "nda");
  const s = await pane(tester, "Tester · Gus · Tide Tower session", "#0369a1");
  const pr = await pane(tester, "Tester · Gus · own profile (2 shown + 1 hidden)", "#0f766e");
  await pr.goto(`/app/testers/${tester.uid}`);
  await s.goto(sessionUrl(e.sid));
  await myList(pr).scrollIntoViewIfNeeded();
  const hiddenRow = myList(pr).locator("li", { hasText: "Allowed · hidden while Coral Code has an NDA" });
  const hasHidden = await hiddenRow.isVisible().catch(() => false);
  await openPicker(s, e.subId, Q1, "the second boss was far too hard for me");
  await askBtn(s).click();
  const err = await pickerError(s);
  const refused = err.includes("You can show at most 3 excerpts. Remove one first.");
  await pause(s, 1500);
  const shotA = await shot(s, "12-refused-at-cap");
  await hiddenRow.getByRole("button", { name: "Remove" }).click();
  await pr.getByRole("dialog").getByRole("button", { name: "Remove" }).click().catch(async () => { await pr.getByRole("button", { name: "Remove" }).last().click(); });
  await pause(pr, 2500);
  const removed = !(await myList(pr).getByText("Allowed · hidden while Coral Code has an NDA").count());
  await askBtn(s).click();
  const lr = await waitLive(s, "the request", async () => (await s.locator("[data-excerpt-pending]").count()) > 0);
  await pause(s, 2000);
  const shots = [shotA, await shot(s, "12-request-after-remove"), await shot(pr, "12-profile-after-remove")];
  const files = [await finish("12-cap-with-hidden", [s, pr]), ...shots];
  const pending = Number(sql(`select count(*) from "Excerpt" where "contractId" = ${lit(e.sid)} and status = 'pending'`));
  record(12, "Cap counts a hidden one", "2 shown + 1 hidden (NDA) is 3: a new request is refused; after the tester removes the hidden one, the same request goes through",
    hasHidden && refused && removed && pending === 1, files, `hidden row: ${hasHidden}; refused: ${refused}; removed: ${removed}; pending after: ${pending}; waiting note ${lr.ok ? "shown" : "not seen"}`);
};

(async () => {
  fs.mkdirSync(VTMP, { recursive: true });
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome" });
  try {
    for (const [k, fn] of Object.entries(clips)) {
      if (ONLY.length && !ONLY.some((o) => k.split("-").includes(o) || k === o)) continue;
      try { await fn(); } catch (e) { console.log(`ERROR in clips ${k}:`, e.stack || e); results.push({ id: k, title: `clips ${k}`, proves: "", pass: false, files: [], note: `script error: ${String(e.message || e).slice(0, 300)}` }); }
    }
  } finally {
    await browser.close();
    const prev = fs.existsSync(path.join(OUT, "results.json")) ? JSON.parse(fs.readFileSync(path.join(OUT, "results.json"), "utf8")) : [];
    const merged = [...prev.filter((p) => !results.some((r) => String(r.id) === String(p.id))), ...results].sort((x, y) => parseInt(x.id) - parseInt(y.id));
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(merged, null, 2) + "\n");
  }
})();
