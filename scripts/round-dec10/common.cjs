// Dec 10 media round: the scenes' shared steps (pairs of accounts, both windows recording, Nora's Edit, Ana's call request).
/* eslint-disable */
const X = require("./lib.cjs");
const { pause, center } = X;
let n = 0;
const RUN = (process.argv[2] || "x").replace(/[^a-z0-9]/gi, "").slice(0, 6);
/** Nora and Ana on a new test (written answers at $10, two questions; `over` changes the listing); Ana joined unless joinIt is false. Not recording. */
async function pair(over = {}, joinIt = true) {
  const tag = `${RUN}${++n}`;
  const nora = await X.account(`${tag}n`, "Nora Lane", "developer", "she");
  const ana = await X.account(`${tag}a`, "Ana Silva", "tester", "she");
  const t = await X.postTest(nora, over);
  const s = joinIt ? await X.join(ana, t) : null;
  return { nora, ana, t, s, tag };
}
/** Both windows recording: Nora on `noraUrl`, Ana on `anaUrl`. */
async function both(p, noraUrl, anaUrl) {
  const N = await X.recPage(p.nora, "Nora (developer)");
  const A = await X.recPage(p.ana, "Ana (tester)");
  await Promise.all([N.goto(noraUrl), A.goto(anaUrl)]);
  await Promise.all([N.waitForSelector("main h1"), A.waitForSelector("main h1")]);
  await pause(A, 1500);
  watch(A, "Ana");
  watch(N, "Nora");
  return { N, A };
}
/** Every POST answer a page gets (for the log, and INDEX.md's step lists). */
function watch(P, tag) {
  P.on("response", async (r) => {
    if (r.request().method() !== "POST" || !/\/api\//.test(r.url()) || /pulse|page-claim|page-handover|\/live|seen|kept|timezone|visits/.test(r.url())) return;
    console.log(`   (${tag}) ${r.url().replace(X.BASE, "")} -> ${r.status()} ${(await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 260)}`);
  });
}
const SEND = "#written button:has-text('Send Answers')";
const ALERTS = "[data-tester-alerts] button";
const REQ = "button.btn-ghost:has-text('Request a time')";
/** Nora edits the listing in her own window: Edit, `fill` (default: a new sentence in "What should testers do?"), Save; then back on her test page. */
async function noraEdits(N, t, fill = " Try the night harbor too.", back = true) {
  await noraPrepares(N, t, fill);
  await pause(N, 500);
  const r = await saveEdit(N);
  if (back && !/\/app\/tests\/[^/]+$/.test(new URL(N.url()).pathname)) await N.goto(`/app/tests/${t}`).catch(() => {});
  return r;
}
/** Nora opens Edit and types her change (not saved yet). */
async function noraPrepares(N, t, fill = " Try the night harbor too.") {
  await N.goto(`/app/tests/${t}/edit`);
  await N.waitForSelector("#description");
  if (typeof fill === "function") await fill(N);
  else {
    await center(N, "#description");
    await pause(N, 600);
    await N.locator("#description").click();
    await N.keyboard.press("End");
    await N.keyboard.type(fill, { delay: 30 });
  }
}
/** Nora presses Save on the Edit page she prepared (the page goes on to her test page by itself). */
async function noraSaves(N) {
  return saveEdit(N, 600);
}
/** Edit's Save (with the payments tick), waiting for its answer and the page after it. */
async function saveEdit(N, after = 2000) {
  const tickBox = N.locator("#payRulesOk");
  if ((await tickBox.count()) && !(await tickBox.isChecked())) { await tickBox.scrollIntoViewIfNeeded(); await tickBox.check(); await pause(N, 400); }
  const save = N.locator("form button.btn", { hasText: /^Save$/ }).first();
  await save.scrollIntoViewIfNeeded();
  const answer = N.waitForResponse((r) => /\/edit$/.test(r.url()) && r.request().method() === "POST", { timeout: 40000 }).catch(() => null);
  await save.click();
  const r = await answer;
  console.log("   (Nora's Save)", r ? r.status() : "no answer");
  await pause(N, after);
  return r;
}
/** Ana looks at the updates box at the top. */
async function toTop(P, ms = 3500) { await P.evaluate(() => scrollTo({ top: 0, behavior: "smooth" })); await pause(P, ms); }
/** The session page's call-request form: a time 3 days ahead at 10:00, 30 minutes. */
async function fillRequest(A, days = 3) {
  const d = new Date(Date.now() + days * 86400000);
  const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T10:00`;
  const box = A.locator("#call-requests input[type=datetime-local], #requests input[type=datetime-local], input[type=datetime-local]").first();
  await box.scrollIntoViewIfNeeded();
  await box.fill(v);
  await A.locator("input[aria-label='Length in minutes']").first().fill("30");
  await pause(A, 600);
}
/** Nora ends Ana's work early in her window. */
async function noraEndsEarly(N, name = "Ana Silva") {
  await N.evaluate(() => scrollTo(0, 0));
  await N.locator("button", { hasText: /^End early$/ }).first().click();
  await pause(N, 800);
  await N.locator("[data-end-early] label", { hasText: name }).locator("input").first().check();
  await N.locator("#reason").fill("We have what we need from this round, thank you.");
  await pause(N, 800);
  await X.pressConfirm(N, N.locator("[data-end-early] button", { hasText: "End their work now" }).first(), "End their work now");
  await pause(N, 2500);
}
/** Nora stops the test in her window (Stop the test, a reason, Stop the test). */
async function noraStops(N) {
  await N.evaluate(() => scrollTo(0, 0));
  await N.locator("button", { hasText: "Stop the test" }).first().click();
  const dlg = N.locator("dialog[open]");
  await dlg.waitFor({ state: "visible", timeout: 5000 });
  await dlg.locator("#stop-reason").fill(X.STOP_WHY);
  await pause(N, 800);
  await dlg.locator("button", { hasText: "Stop the test" }).last().click();
  await pause(N, 2500);
}
const ago = (iso) => sqlDate(iso);
function sqlDate(q) { return X.sql(q); }
module.exports = { pair, both, watch, SEND, ALERTS, REQ, noraEdits, noraPrepares, noraSaves, saveEdit, toTop, fillRequest, noraEndsEarly, noraStops, sqlDate };
/** Nora prepares her Edit, waits for Ana's page to have just had its live update (so Ana's next press comes before the following one), then saves. */
async function editRace(D, N, A, t, fill, caption) {
  if (N.backing) await N.backing; // (the previous edit's way back to the test page)
  await noraPrepares(N, t, fill);
  await require("./lib.cjs").waitPulse(A, 25000);
  D.say(caption);
  const r = await noraSaves(N);
  // Back on her test page a moment later (Ana presses meanwhile), so Nora's window follows the live updates.
  N.backing = new Promise((done) => setTimeout(() => N.goto(`/app/tests/${t}`).catch(() => {}).then(done), 2500));
  return r;
}
module.exports.editRace = editRace;
/** Waits (nudging the live updates) until an element is on the page, even inside a closed fold, then opens its folds and brings it to the middle. */
async function reveal(P, sel, ms = 40000) {
  const X = require("./lib.cjs");
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await P.locator(sel).count().catch(() => 0)) break;
    await X.tick(P);
    await P.waitForTimeout(700);
  }
  if (!(await P.locator(sel).count().catch(() => 0))) { console.log("   ! reveal: nothing for", sel); return false; }
  await X.unfold(P, sel);
  await X.center(P, sel);
  await P.waitForTimeout(1500); // (a page just loaded locks its buttons until its claim on the page answers)
  return true;
}
module.exports.reveal = reveal;
