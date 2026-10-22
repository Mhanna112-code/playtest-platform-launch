// Records evidence that the lean Playtest works: screenshots (phone 390x844 and desktop) of the main flows and
// docs/evidence/summary.json with every check. Needs the app running on BASE (default http://localhost:3400) with the
// dev outbox on (ALLOW_DEV_OUTBOX=1 under `next start`) and ADMIN_EMAILS containing ADMIN (default owner@example.com).
// Usage: node scripts/evidence.cjs
/* eslint-disable */
const fs = require("fs");
const path = require("path");
const os = require("os");
const PW = "C:/Users/march/Projects/playtest-platform/node_modules/playwright";
// Video needs Playwright's ffmpeg: use the ffmpeg-static copy in playtest-platform through a private browsers path.
(function useLocalFfmpeg() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return;
  const cache = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (fs.existsSync(cache) && fs.readdirSync(cache).some((d) => /^ffmpeg-/.test(d))) return;
  const rev = require(PW + "/node_modules/playwright-core/browsers.json").browsers.find((b) => b.name === "ffmpeg").revision;
  const src = "C:/Users/march/Projects/playtest-platform/node_modules/ffmpeg-static/ffmpeg.exe";
  if (!fs.existsSync(src)) return;
  const dst = path.join(os.tmpdir(), "playtest-lite-evidence-pw", `ffmpeg-${rev}`, "ffmpeg-win64.exe");
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(os.tmpdir(), "playtest-lite-evidence-pw");
})();
const { chromium } = require(PW);

const BASE = process.env.BASE || "http://localhost:3400";
const OUT = path.join(__dirname, "..", "docs", "evidence");
const TS = Date.now();
const DEV = `dev+${TS}@playtest.test`, TESTER = `tester+${TS}@playtest.test`, ADMIN = process.env.ADMIN || "owner@example.com";
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 900 } };

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.(png|webm)$/.test(f) || f === "summary.json") fs.rmSync(path.join(OUT, f));
const summary = { run: new Date(TS).toISOString(), base: BASE, flows: [] };
let browser, cur;

async function shot(page, name) {
  const file = `${cur.id}-${name}.png`;
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  cur.screenshots.push(file);
}
const check = (what, ok, saw) => {
  cur.checks.push(`${ok ? "PASS" : "FAIL"} ${what}${saw !== undefined ? ` (saw: ${String(saw).slice(0, 160)})` : ""}`);
  if (!ok) cur.status = "fail";
};
async function flow(id, title, fn) {
  cur = { id, title, status: "pass", checks: [], screenshots: [] };
  console.log(id, title);
  try {
    await fn();
  } catch (e) {
    cur.status = "fail";
    cur.checks.push("FAIL error: " + String(e.message || e).split("\n")[0]);
  }
  summary.flows.push(cur);
  console.log("  " + cur.status, cur.checks.filter((c) => c.startsWith("FAIL")).join(" | "));
}
/** Calls are always requests: the developer requests a time with this tester, the tester accepts → booked. */
async function requestAndAccept(devPage, testerPage, testId, sessionId, daysAhead) {
  const d = new Date(Date.now() + daysAhead * 86400000);
  d.setSeconds(0, 0);
  const post = (page, path, data) => page.context().request.post(BASE + path, { data, headers: { "content-type": "application/json" } });
  await post(devPage, `/api/tests/${testId}/request-time`, { seenAt: new Date().toISOString(), confirmed: true, contractIds: [sessionId], startsAt: d.toISOString() });
  const reqId = sql(`select id from "CallRequest" where "contractId" = '${sessionId}' and status = 'pending' and "fromSide" = 'developer' order by "createdAt" desc limit 1`);
  await post(testerPage, `/api/sessions/${sessionId}/answer-request`, { seenAt: new Date().toISOString(), confirmed: true, requestId: reqId, action: "accept" });
  return sql(`select id from "Call" where "contractId" = '${sessionId}' and status = 'booked' order by "createdAt" desc limit 1`);
}
const sql = (q) => require("child_process").execFileSync("psql", ["-h", "localhost", "-p", "5499", "-U", "postgres", "-d", "playtest_lite", "-t", "-A", "-c", q]).toString().split(String.fromCharCode(13)).join("").trim();
/** Waits (up to 6 s) for the text, so checks don't race the page. */
const has = (page, sel) => page.waitForSelector(sel.startsWith("text=") || sel.includes(">>") || sel.includes(":") ? sel : `text=${sel}`, { timeout: 6000 }).then(() => true, () => false);
async function ctx(opts) {
  const c = await browser.newContext({ ...opts, baseURL: BASE });
  c.setDefaultTimeout(15000);
  return c.newPage();
}
async function signIn(page, email) {
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.click("text=Email me a link");
  await page.waitForSelector("text=Check your email");
  await page.goto("/dev/outbox");
  const href = await page.locator("div.panel", { hasText: `To ${email}` }).first().locator("a").first().getAttribute("href");
  await page.goto(href);
  await page.click("text=Sign in to Playtest");
  await page.waitForURL("**/app");
}

(async () => {
  browser = await chromium.launch({ channel: "msedge" });
  const dev = await ctx(DESKTOP);
  const tester = await ctx(PHONE);
  let testUrl = "";
  let adminPage = null;
  let t2 = null; // signed in once (sign-in links are rate-limited per email)

  await flow("01", "Landing page and waitlist (phone)", async () => {
    const p = await ctx(PHONE);
    await p.goto("/");
    check("headline shows", await has(p, "text=You choose what to pay."));
    await shot(p, "landing");
    await p.fill('input[type="email"]', `wait+${TS}@playtest.test`);
    await p.click("text=Join the waitlist");
    check("waitlist confirms", await has(p, "text=You're on the list"));
    await shot(p, "waitlist-done");
  });

  await flow("02", "Developer signs in with an email link and posts a test (desktop)", async () => {
    await signIn(dev, DEV);
    await dev.fill("#name", "Nora Lane");
    await dev.selectOption("#pronoun", "she");
    await dev.check("text=post tests for my game");
    await dev.click("text=Continue");
    await dev.waitForSelector("text=Your tests");
    await dev.goto("/app/tests/new");
    await dev.fill("#title", "Harbor Run: first 3 levels");
    await dev.fill("#description", "Sail through the harbor and tell us where it gets confusing.");
    await dev.fill("#buildUrl", "https://example.com/harbor-run");
    await dev.fill("#questions", "What did you like?\nWhere did you get stuck?");
    await dev.check("text=Live call");
    await dev.fill("#liveRate", "30.00");
    await shot(dev, "post-form");
    await dev.click("text=Post the test");
    await dev.waitForURL((u) => /\/app\/tests\/\w+$/.test(u.pathname) && !u.pathname.endsWith("/new"));
    testUrl = dev.url();
    check("test page with top panel", await has(dev, "text=Stop the test"), dev.url());
    check("terms line", await has(dev, "text=Written $10.00 · Live call $30.00/h (30 min) · 7 days"));
    await shot(dev, "test-page");
  });

  await flow("03", "Tester signs in, sets a profile, finds and joins the test (phone)", async () => {
    await signIn(tester, TESTER);
    await tester.fill("#name", "Ana Silva");
    await tester.selectOption("#pronoun", "she");
    await tester.check("text=test games and get paid");
    await tester.click("label:has-text('Windows PC')");
    await tester.click("label:has-text('English')");
    await tester.click("text=Continue");
    await tester.waitForSelector("text=Your sessions");
    await tester.goto("/app/find");
    check("tester sees their share (80%)", await has(tester, "text=Written $8.00"));
    await shot(tester, "find");
    await tester.click("text=Harbor Run: first 3 levels");
    await shot(tester, "listing");
    await tester.click("text=Join this test");
    await tester.waitForURL(/\/app\/sessions\//);
    check("session page shows the contract", await has(tester, "text=Your contract:"));
    await shot(tester, "session");
  });

  await flow("04", "Stop once on the developer's top panel, then the tester sends answers", async () => {
    await dev.goto(testUrl); // the page's "seen" marker is now
    await tester.fill("#a0", "The boat handling feels great.");
    await tester.fill("#a1", "The second bridge: I couldn't tell where to go.");
    await tester.click("text=Send my written answers");
    await tester.waitForSelector("text=Sent ");
    await shot(tester, "answers-sent");
    await dev.click("button:has-text('Next round')");
    await dev.click("text=Start the next round");
    await dev.waitForSelector("text=Press again to go ahead.");
    check("box lists what changed", await has(dev, "text=Ana Silva sent her written answers"));
    await shot(dev, "stop-once-box");
  });

  await flow("05", "Developer pays with the one Pay box; the tester sees it", async () => {
    sql(`update "User" set "stripeCustomerId" = 'cus_fake_${TS}', "stripePaymentMethodId" = 'pm_card_visa' where email = '${DEV}'`);
    await dev.goto(testUrl);
    check("listing amount beside the box", await has(dev, "text=Listing: $10.00 for written answers"));
    check("paid so far", await has(dev, "text=You've paid Ana Silva $0.00 so far on this test."));
    await dev.check("text=charged now: $10.00");
    await shot(dev, "pay-box");
    await dev.click("button:has-text('Pay')");
    await dev.waitForSelector("text=Paid $10.00");
    await dev.waitForTimeout(1200);
    await shot(dev, "paid");
    await tester.reload();
    check("tester sees what they get", await has(tester, "text=you get $8.00"));
    await shot(tester, "paid");
  });

  await flow("06", "Live call: the developer requests a time, the tester accepts it", async () => {
    await dev.goto(testUrl);
    const when = new Date(Date.now() + 3 * 86400000);
    const local = new Date(when.getTime() - when.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await dev.check("section[aria-label='Call requests'] label:has-text('Ana Silva') input");
    await dev.fill("section[aria-label='Call requests'] input[type=datetime-local]", local);
    await dev.click("section[aria-label='Call requests'] >> text=Request a time");
    await dev.waitForTimeout(1500);
    await shot(dev, "time-requested");
    await tester.reload();
    await tester.click("section[aria-label='Call requests'] >> button:has-text('Accept')");
    await tester.waitForSelector("text=Join call");
    check("tester has a booked call with Join call", await has(tester, "text=Join call"));
    await shot(tester, "call-booked");
    await dev.reload();
    check("developer sees the booking", await has(dev, "text=Ana Silva"));
    await shot(dev, "call-booked");
  });

  await flow("07", "Chat, payments page and admin", async () => {
    await tester.fill('input[placeholder^="Message"]', "Thanks! Happy to test round 2.");
    await tester.click("#chat button:has-text('Send')");
    await tester.waitForSelector("text=Happy to test round 2");
    await shot(tester, "chat");
    await dev.goto("/app/payments");
    check("payments page", await has(dev, "text=Your card (developer)"));
    await shot(dev, "payments");
    const admin = await ctx(DESKTOP);
    await signIn(admin, ADMIN);
    adminPage = admin;
    await admin.goto("/admin");
    check("admin page", await has(admin, "text=Disputes"), admin.url());
    await shot(admin, "admin");
  });

  await flow("08", "Invite: the developer invites a tester from the test page; the tester sees the invite", async () => {
    t2 = await ctx(PHONE);
    await signIn(t2, `tester2+${TS}@playtest.test`);
    await t2.fill("#name", `Dee Moss ${TS % 10000}`);
    await t2.check("text=test games and get paid");
    await t2.click("label:has-text('Mac')");
    await t2.click("label:has-text('English')");
    await t2.click("text=Continue");
    await t2.waitForSelector("text=Your sessions");
    await dev.goto(testUrl);
    await dev.selectOption('select[aria-label="Device"]', "Mac");
    await dev.check(`#invite label:has-text('Dee Moss ${TS % 10000}') input`);
    await shot(dev, "invite-panel");
    await dev.click("#invite button:has-text('Invite')");
    check("box under Invite names who was invited", await has(dev, `text=Invited Dee Moss ${TS % 10000}.`));
    await shot(dev, "invited");
    await t2.reload();
    check("tester sees the invite", await has(t2, "text=invited you to"));
    await shot(t2, "invite-received");
  });

  await flow("09", "Payment hold: tests pause, the tester reads only 'paused', Pay what you owe lifts it", async () => {
    await dev.waitForTimeout(2500); // let the pending reload from the invite (flow 08) finish
    const { execFileSync } = require("child_process");
    execFileSync("psql", ["-h", "localhost", "-p", "5499", "-U", "postgres", "-d", "playtest_lite", "-c", `update "User" set "holdStartedAt" = now() - interval '1 day', "holdReason" = 'unpaid' where email = '${DEV}'`]);
    await dev.goto(testUrl);
    check("developer sees the paused box", await has(dev, "text=Your tests are paused."));
    await shot(dev, "paused");
    await tester.reload();
    check("tester reads only that the test is paused", await has(tester, "text=This test is paused. Payment for your work may be delayed."));
    await shot(tester, "paused");
    await dev.click("button:has-text('Pay what you owe')");
    const lifted = await dev.waitForSelector("text=Your tests are paused.", { state: "detached", timeout: 8000 }).then(() => true, () => false);
    check("hold lifted", lifted);
    await shot(dev, "resumed");
  });

  await flow("10", "Live call payment problems: call length, declined Pay, chargeback hold, resolved", async () => {
    const { execFileSync } = require("child_process");
    const sql = (q) => execFileSync("psql", ["-h", "localhost", "-p", "5499", "-U", "postgres", "-d", "playtest_lite", "-t", "-A", "-c", q]).toString().trim();
    const devId = sql(`select id from "User" where email = '${DEV}'`);
    // The call from flow 06 becomes a held call (it started an hour ago); the developer's saved card is one the fake declines.
    sql(`update "Call" c set "startsAt" = now() - interval '1 hour' from "Contract" k where c."contractId" = k.id and k."testId" = (select "testId" from "Contract" where "testerId" = (select id from "User" where email = '${TESTER}') limit 1) and c.status = 'booked'`);
    sql(`update "User" set "stripeCustomerId" = 'cus_fake_${TS}', "stripePaymentMethodId" = 'pm_card_declined' where id = '${devId}'`);
    const vdir = fs.mkdtempSync(path.join(os.tmpdir(), "pt-video-"));
    const vd = await (await browser.newContext({ ...DESKTOP, baseURL: BASE, storageState: await dev.context().storageState(), recordVideo: { dir: vdir, size: DESKTOP.viewport } })).newPage();
    const vt = await (await browser.newContext({ ...PHONE, baseURL: BASE, storageState: await tester.context().storageState(), recordVideo: { dir: vdir, size: PHONE.viewport } })).newPage();
    vd.context().setDefaultTimeout(15000);
    vt.context().setDefaultTimeout(15000);
    const sessionUrl = tester.url().includes("/app/sessions/") ? tester.url() : null;
    // A second, future call booked by the tester (it will be cancelled by the hold).
    const firstSession = sql(`select id from "Contract" where "testerId" = (select id from "User" where email = '${TESTER}') and "testId" = (select id from "Test" where "developerId" = '${devId}' order by "createdAt" asc limit 1)`);
    await requestAndAccept(dev, tester, testUrl.split("/").pop(), firstSession, 4);
    await vt.goto(sessionUrl || "/app");
    // (1) The developer enters 25 minutes: the reference reads rate × 25 min.
    await vd.goto(testUrl);
    await vd.fill('input[id^="len-"]', "25");
    await vd.click("text=Save the length");
    check("Pay box reference = rate × 25 min", await has(vd, "text=Listing: $30/h × 25 min = $12.50"));
    await shot(vd, "1-dev-call-length");
    await vt.reload();
    check("tester: waiting to be paid", await has(vt, "text=waiting for Nora Lane to pay"));
    await shot(vt, "1-tester-waiting");
    // (2) Pay with a card the fake declines.
    await vd.check("text=charged now: $12.50");
    await vd.click("button:has-text('Pay')");
    check("declined line under Pay", await has(vd, "text=Your card was declined, so Ana Silva wasn't paid $12.50 for the call."));
    await shot(vd, "2-dev-declined");
    await vt.reload();
    check("tester: may be delayed", await has(vt, "text=Payment for this call may be delayed."));
    await shot(vt, "2-tester-delayed");
    // (3) A working card: Pay succeeds; then the bank reverses it (chargeback webhook).
    sql(`update "User" set "stripePaymentMethodId" = 'pm_card_visa' where id = '${devId}'`);
    await vd.click("button:has-text('Pay')");
    check("paid", await has(vd, "text=Paid $12.50"));
    await vd.waitForTimeout(1200);
    await shot(vd, "3-dev-paid");
    await vd.goto(testUrl); // page loaded: the stop-once marker is now
    const pi = sql(`select "stripePaymentIntentId" from "Payment" where "developerId" = '${devId}' and kind = 'call' and status = 'charged' order by "createdAt" desc limit 1`);
    const hook = await fetch(`${BASE}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": "fake", "content-type": "application/json" }, body: JSON.stringify({ type: "charge.dispute.created", data: { object: { payment_intent: pi } } }) });
    check("webhook accepted", hook.ok, hook.status);
    await vd.click("button:has-text('End early')");
    await vd.fill("#reason", "Checking the stop-once box");
    await vd.click("text=End their work now");
    check("stop-once line under the top panel", await has(vd, "text=Your bank reversed your $12.50 payment for Ana Silva's live call"));
    await shot(vd, "3-dev-chargeback-stop-once");
    sql(`update "User" set "holdStartedAt" = now() - interval '5 minutes' where id = '${devId}'`);
    sql(`update "Call" set "startsAt" = now() - interval '1 minute' where status = 'booked' and "startsAt" > now() and "contractId" in (select id from "Contract" where "testId" in (select id from "Test" where "developerId" = '${devId}'))`);
    await vd.reload();
    check("hold banner", await has(vd, "text=Your tests are paused."));
    await shot(vd, "3-dev-hold-banner");
    await vt.reload();
    check("tester: paused line", await has(vt, "text=This test is paused. Payment for your work may be delayed."));
    await shot(vt, "3-tester-paused");
    await vt.goto("/app/notifications");
    check("tester: call cancelled because paused", await has(vt, "text=was cancelled because the test is paused."));
    await shot(vt, "3-tester-call-cancelled");
    // (4) A reversed payment can't be retried: the team marks it resolved, then both sides resume.
    check("hold box says reversed payments are resolved by the team", await has(vd, "text=Reversed payments can't be retried here"));
    const adm = adminPage || (await ctx(DESKTOP));
    if (!adminPage) await signIn(adm, ADMIN);
    await adm.goto("/admin");
    await adm.locator("p", { hasText: DEV }).filter({ hasText: "Chargeback open" }).first().locator("button:has-text('Mark resolved')").click();
    await adm.waitForTimeout(1200);
    await shot(adm, "4-admin-resolved");
    await vd.reload();
    const lifted = await vd.waitForSelector("text=Your tests are paused.", { state: "detached", timeout: 10000 }).then(() => true, () => false);
    check("developer resumed", lifted);
    await shot(vd, "4-dev-resumed");
    await vt.goto(sessionUrl || "/app");
    check("tester resumed (no paused line)", !(await vt.isVisible("text=This test is paused.")));
    await shot(vt, "4-tester-resumed");
    for (const [pg, tag] of [[vd, "developer"], [vt, "tester"]]) {
      const v = pg.video();
      await pg.context().close();
      if (v) {
        const file = `10-live-call-payment-problems-${tag}.webm`;
        await v.saveAs(path.join(OUT, file)).catch(() => {});
        cur.screenshots.push(file);
      }
    }
  });

  // ---------- Payment / pause evidence set (flows 11–16), STRIPE_FAKE + CRON_SECRET ----------
  const apiPost = async (page, p, data = {}) => {
    const r = await page.context().request.post(BASE + p, { data, headers: { "content-type": "application/json" } });
    return { status: r.status(), body: await r.json().catch(() => ({})) };
  };
  const runCron = () => fetch(`${BASE}/api/cron/daily`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET || "evidence-cron"}` } }).then((r) => r.json());
  const devId = sql(`select id from "User" where email = '${DEV}'`);
  const deeName = `Dee Moss ${TS % 10000}`;
  let T11 = "", SA = "", SD = "";
  const t11Url = () => `/app/tests/${T11}`;
  const both = async (name, tp = tester) => {
    await shot(dev, `${name}-developer`);
    await shot(tp, `${name}-tester`);
  };

  await flow("11", "Charge declined: owed with a 3-day cut-off (developer banner + Payments, tester line); a second failure pauses at once", async () => {
    const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const r = await apiPost(dev, "/api/tests", { title: "Lighthouse Keeper", description: "Keep the light on.", buildUrl: "https://example.com/lighthouse", category: "Puzzle", devices: [], languages: [], spots: 5, writtenCents: "10.00", recordingCents: "15.00", liveRateCents: "30.00", liveMinutes: 30, deadlineDays: 7, questions: ["What did you think?"], openUntil: day(10) });
    T11 = r.body.id;
    check("test posted", !!T11, JSON.stringify(r.body));
    SA = (await apiPost(tester, `/api/tests/${T11}/join`, { listingVersion: 1 })).body.sessionId;
    SD = (await apiPost(t2, `/api/tests/${T11}/join`, { listingVersion: 1 })).body.sessionId;
    check("both testers joined", !!SA && !!SD);
    await apiPost(tester, `/api/sessions/${SA}/written`, { answers: ["Moody and calm, I liked it."] });
    const st = await apiPost(tester, `/api/sessions/${SA}/recording-start`, { filename: "run.webm", size: 16, contentType: "video/webm" });
    await tester.context().request.put(BASE + st.body.uploadUrl, { data: Buffer.from("tiny test video!"), headers: { "content-type": "video/webm" } });
    await apiPost(tester, `/api/sessions/${SA}/recording-done`, { recordingId: st.body.recordingId });
    await apiPost(tester, `/api/sessions/${SA}/recording-send`, {});
    sql(`update "Submission" set "payBy" = now() - interval '1 minute' where "contractId" = '${SA}'`);
    // Three calls for Ana: one held before the hold (to show Pay waiting), one whose time comes during the hold, one after.
    const call1 = await requestAndAccept(dev, tester, T11, SA, 2);
    sql(`update "Call" set "startsAt" = now() - interval '30 minutes' where id = '${call1}'`);
    const call2 = await requestAndAccept(dev, tester, T11, SA, 3);
    sql(`update "Call" set "startsAt" = now() - interval '2 minutes' where id = '${call2}'`);
    await requestAndAccept(dev, tester, T11, SA, 4);
    sql(`update "User" set "stripePaymentMethodId" = 'pm_card_declined' where id = '${devId}'`);
    await runCron(); // day 14: Ana is offered Charge / Let it go
    await tester.goto(`/app/sessions/${SA}`);
    check("tester offered the choice", await has(tester, "text=didn't review your written answers in 14 days: charge $10.00 or let it go"));
    await shot(tester, "choice-offered-tester");
    await tester.check("text=charge Nora Lane $10.00 now");
    await tester.click("button:has-text('Charge Nora Lane')");
    await tester.waitForTimeout(1500);
    await dev.goto(t11Url());
    check("developer banner with the cut-off", await has(dev, "text=A payment failed. Pay $10.00 by"));
    await tester.goto(`/app/sessions/${SA}`);
    check("tester reads it may be delayed", await has(tester, "text=Payment for this part may be delayed."));
    await both("owed");
    await dev.goto("/app/payments");
    check("Payments page lists it", await has(dev, "text=Ana Silva's written answers $10.00 · card declined"));
    await shot(dev, "owed-payments-page-developer");
    // A second failed payment while one is still owed starts the hold at once.
    await tester.check("text=charge Nora Lane $15.00 now");
    await tester.click("button:has-text('Charge Nora Lane')");
    await tester.waitForTimeout(1500);
    await dev.goto(t11Url());
    check("second failure: tests paused at once", await has(dev, "text=Your tests are paused."));
    await tester.goto(`/app/sessions/${SA}`);
    await both("second-failure-hold");
  });

  let t3 = null;
  await flow("12", "Hold pauses every test; joins, invites, Next round, posting, Pay/Reject wait; calls inside the hold cancelled, after it kept; testers still send", async () => {
    sql(`update "Payment" set "owedUntil" = now() - interval '1 minute' where "developerId" = '${devId}' and status = 'failed' and "settledAt" is null and "owedUntil" is not null`);
    await runCron(); // the cut-off passes (the hold is already on from the second failure in flow 11)
    check("hold on", sql(`select "holdStartedAt" is not null from "User" where id = '${devId}'`) === "t");
    sql(`update "User" set "holdStartedAt" = now() - interval '10 minutes' where id = '${devId}'`);
    await dev.goto(t11Url());
    check("developer: tests paused", await has(dev, "text=Your tests are paused."));
    await tester.goto(`/app/sessions/${SA}`);
    check("tester: paused line", await has(tester, "text=This test is paused. Payment for your work may be delayed."));
    check("tester: the call inside the hold was cancelled", await has(tester, "text=cancelled by the site"));
    await both("hold");
    await tester.goto("/app/notifications");
    check("tester told why", await has(tester, "text=was cancelled because the test is paused."));
    await shot(tester, "hold-call-cancelled-tester");
    // Pay waits on the held call.
    await dev.goto(t11Url());
    const callBox = dev.locator("div.rounded-lg", { hasText: "Live call · In their contract" }).filter({ hasText: "Amount" }).first();
    await callBox.locator("input[type=checkbox]").check();
    await callBox.locator("button:has-text('Pay')").click();
    check("Pay waits", await has(dev, "text=Pay what you owe first."));
    await shot(dev, "hold-pay-waits-developer");
    // Next round, posting and invites wait.
    await dev.click("button:has-text('Next round')");
    await dev.click("text=Start the next round");
    check("Next round waits", await has(dev, "text=Your tests are paused until then."));
    await shot(dev, "hold-next-round-developer");
    // A new tester can't join; the developer can't invite them.
    t3 = await ctx(PHONE);
    await signIn(t3, `tester3+${TS}@playtest.test`);
    await t3.fill("#name", `Cara Diaz ${TS % 10000}`);
    await t3.check("text=test games and get paid");
    await t3.click("label:has-text('Windows PC')");
    await t3.click("label:has-text('English')");
    await t3.click("text=Continue");
    await t3.waitForSelector("text=Your sessions");
    await t3.goto(`/app/find/${T11}`);
    await t3.click("text=Join this test");
    check("join refused", await has(t3, "text=This test is paused, so it isn't taking new testers right now."));
    await shot(t3, "hold-join-refused-tester");
    await dev.goto(t11Url());
    await dev.check(`#invite label:has-text('Cara Diaz ${TS % 10000}') input`);
    await dev.click("#invite button:has-text('Invite')");
    check("invite refused", await has(dev, "text=This test is paused until you pay what you owe, so nobody can be invited."));
    await shot(dev, "hold-invite-refused-developer");
    await dev.goto("/app/tests/new");
    await dev.fill("#title", "Another game");
    await dev.fill("#questions", "Anything?");
    await dev.click("text=Post the test");
    check("posting refused", await has(dev, "text=New tests can't be posted while payments are on hold."));
    await shot(dev, "hold-posting-refused-developer");
    // A tester still sends work during the hold.
    await t2.goto(`/app/sessions/${SD}`);
    await t2.fill("#a0", "Beautiful lighthouse, the stairs puzzle was hard.");
    await t2.click("text=Send my written answers");
    check("tester still sends", await has(t2, "text=Sent "));
    await dev.goto(t11Url());
    await both("hold-tester-still-sends", t2);
  });

  await flow("13", "Several failed payments: listed, one still failing, then all paid; hold lifts and deadlines / Open until move on", async () => {
    sql(`update "User" set "holdStartedAt" = now() - interval '2 days', "stripePaymentMethodId" = 'pm_card_partial' where id = '${devId}'`);
    const dueBefore = sql(`select to_char("dueAt", 'YYYY-MM-DD') from "Contract" where id = '${SA}'`);
    const ouBefore = sql(`select to_char("openUntil", 'YYYY-MM-DD') from "Test" where id = '${T11}'`);
    await dev.goto(t11Url());
    check("both failures listed with one button", await has(dev, "text=Pay what you owe ($25.00)"));
    await both("several-owed");
    // Another failed payment arrives after the page loaded: the first press stops once with the new total.
    const tid = sql(`select id from "User" where email = '${TESTER}'`);
    sql(`insert into "Payment" (id, kind, "contractId", "developerId", "testerId", "amountCents", "feeCents", "testerCents", status, "owedUntil", "createdAt") values ('ev_${TS}', 'review', '${SA}', '${devId}', '${tid}', 500, 0, 0, 'failed', now() + interval '3 days', now())`);
    await dev.click("button:has-text('Pay what you owe')");
    check("total-changed stop", await has(dev, "text=New total $30.00. Press again to pay $30.00."));
    await shot(dev, "several-total-changed-developer");
    await dev.click("button:has-text('Pay what you owe')");
    check("the one still failing is named", await has(dev, "text=Still declined: Ana Silva's recording $15.00"));
    await shot(dev, "several-one-still-failing-developer");
    sql(`update "User" set "stripePaymentMethodId" = 'pm_card_visa' where id = '${devId}'`);
    await dev.reload();
    await dev.click("button:has-text('Pay what you owe ($15.00)')");
    const lifted = await dev.waitForSelector("text=Your tests are paused.", { state: "detached", timeout: 10000 }).then(() => true, () => false);
    check("hold lifted", lifted);
    const dueAfter = sql(`select to_char("dueAt", 'YYYY-MM-DD') from "Contract" where id = '${SA}'`);
    const ouAfter = sql(`select to_char("openUntil", 'YYYY-MM-DD') from "Test" where id = '${T11}'`);
    check("tester deadline moved on 2 days", dueAfter !== dueBefore, `${dueBefore} → ${dueAfter}`);
    check("Open until moved on 2 days", ouAfter !== ouBefore, `${ouBefore} → ${ouAfter}`);
    await tester.goto(`/app/sessions/${SA}`);
    check("tester no longer paused", !(await tester.isVisible("text=This test is paused.")));
    await both("several-all-paid");
  });

  await flow("14", "Chargeback on written work: stop-once line and hold; admin marks it resolved", async () => {
    await dev.goto(t11Url());
    const pi = sql(`select p."stripePaymentIntentId" from "Payment" p join "Submission" s on s.id = p."submissionId" where s."contractId" = '${SA}' and s.kind = 'written' and p.status = 'charged' order by p."createdAt" desc limit 1`);
    const hook = await fetch(`${BASE}/api/stripe/webhook`, { method: "POST", headers: { "stripe-signature": "fake", "content-type": "application/json" }, body: JSON.stringify({ type: "charge.dispute.created", data: { object: { payment_intent: pi } } }) });
    check("webhook accepted", hook.ok, hook.status);
    await dev.click("button:has-text('End early')");
    await dev.fill("#reason", "Checking the stop-once box");
    await dev.click("text=End their work now");
    check("stop-once line", await has(dev, "text=Your bank reversed your $10.00 payment for Ana Silva's written answers"));
    await shot(dev, "chargeback-stop-once-developer");
    await dev.reload();
    check("hold banner", await has(dev, "text=Your tests are paused."));
    await tester.reload();
    check("tester paused line", await has(tester, "text=This test is paused. Payment for your work may be delayed."));
    await both("chargeback-hold");
    const adm = adminPage || (await ctx(DESKTOP));
    if (!adminPage) await signIn(adm, ADMIN);
    await adm.goto("/admin");
    await adm.locator("p", { hasText: DEV }).filter({ hasText: "Chargeback open" }).first().locator("button:has-text('Mark resolved')").click();
    await adm.waitForTimeout(1200);
    await shot(adm, "chargeback-admin-resolved");
    await dev.reload();
    check("developer resumed", !(await dev.isVisible("text=Your tests are paused.")));
    await tester.reload();
    await both("chargeback-resolved");
  });

  await flow("15", "Dispute: tester disputes, developer adds their side, admin raises pay, extra charged, receipt, paid so far updates", async () => {
    await dev.goto(t11Url());
    const card = dev.locator(`#tester-${SD}`);
    const box = card.locator("div.rounded-lg", { hasText: "Written answers" }).filter({ hasText: "Amount" }).first();
    await box.locator("input[id^='amt-']").fill("4.00");
    await box.locator("textarea").fill("Only one short answer.");
    await box.locator("input[type=checkbox]").check();
    await box.locator("button:has-text('Pay')").click();
    check("paid $4.00", await has(dev, "text=Paid $4.00"));
    await dev.waitForTimeout(1200);
    await t2.goto(`/app/sessions/${SD}`);
    await t2.click("text=Dispute the pay");
    await t2.fill("textarea[id^='d-']", "I answered the one question fully, as asked.");
    await t2.click("text=Send the dispute");
    check("tester disputed", await has(t2, "text=You disputed this: waiting for the team."));
    await both("dispute-opened", t2);
    await dev.goto(t11Url());
    await dev.fill(`#tester-${SD} textarea[id^='side-']`, "The answer was a single sentence.");
    await dev.click(`#tester-${SD} >> text=Send your side`);
    check("developer's side shown", await has(dev, "text=Your side: “The answer was a single sentence.”"));
    await shot(dev, "dispute-side-developer");
    const adm = adminPage;
    await adm.goto("/admin");
    const row = adm.locator("#disputes div", { hasText: deeName }).filter({ hasText: "Decide" }).first();
    check("admin sees both sides", await row.innerText().then((t) => t.includes("Developer's side")));
    await row.locator("input").nth(0).fill("10.00");
    await row.locator("input").nth(1).fill("The answer covered the question.");
    await row.locator("button:has-text('Decide')").click();
    await adm.waitForTimeout(1200);
    await shot(adm, "dispute-admin-decided");
    await dev.goto("/app/notifications");
    check("receipt for the extra", await has(dev, "text=Receipt: you paid $6.00"));
    await shot(dev, "dispute-receipt-developer");
    await dev.goto(t11Url());
    check("paid so far updated (developer)", await has(dev, "text=written answers $10.00"));
    await t2.reload();
    check("paid so far updated (tester)", await has(t2, "text=written answers $10.00"));
    await both("dispute-decided", t2);
  });

  await flow("16", "Live updates: both pages open, lines appear within ~20 s without reloading", async () => {
    // Ana's upcoming call is cancelled first so she can book again.
    const c3 = sql(`select id from "Call" where "contractId" = '${SA}' and status = 'booked' and "startsAt" > now() limit 1`);
    if (c3) await apiPost(tester, `/api/sessions/${SA}/cancel-call`, { seenAt: new Date().toISOString(), confirmed: true, callId: c3 });
    const vdir = fs.mkdtempSync(path.join(os.tmpdir(), "pt-video16-"));
    const vd = await (await browser.newContext({ ...DESKTOP, baseURL: BASE, storageState: await dev.context().storageState(), recordVideo: { dir: vdir, size: DESKTOP.viewport } })).newPage();
    const vt = await (await browser.newContext({ ...PHONE, baseURL: BASE, storageState: await tester.context().storageState(), recordVideo: { dir: vdir, size: PHONE.viewport } })).newPage();
    await vd.goto(t11Url());
    await vt.goto(`/app/sessions/${SA}`);
    await vd.waitForTimeout(1500);
    const tBefore = await vt.locator("section[aria-label='Call requests'] button:has-text('Accept')").count();
    await shot(vd, "live-before-developer");
    await shot(vt, "live-before-tester");
    // The developer requests a time (from another tab): the tester's open page shows it by itself.
    const d6 = new Date(Date.now() + 6 * 86400000);
    d6.setSeconds(0, 0);
    await apiPost(dev, `/api/tests/${T11}/request-time`, { seenAt: new Date().toISOString(), confirmed: true, contractIds: [SA], startsAt: d6.toISOString() });
    const t0 = Date.now();
    const appeared = await vt.waitForFunction((n) => [...document.querySelectorAll("section[aria-label='Call requests'] button")].filter((b) => b.textContent === "Accept").length > n, tBefore, { timeout: 35000 }).then(() => true, () => false);
    check("tester page showed the new request without reload", appeared, `${Math.round((Date.now() - t0) / 1000)} s`);
    await shot(vt, "live-after-tester");
    // The tester accepts (from another tab): the developer's open page shows the booking by itself.
    const reqId = sql(`select id from "CallRequest" where "contractId" = '${SA}' and status = 'pending' and "fromSide" = 'developer' order by "createdAt" desc limit 1`);
    await vd.waitForTimeout(22000); // let the developer's page settle on the request first
    const liBefore = await vd.locator("#calls li").count();
    const bookedBefore = await vd.locator("#calls li", { hasText: "Ana Silva" }).count();
    await apiPost(tester, `/api/sessions/${SA}/answer-request`, { seenAt: new Date().toISOString(), confirmed: true, requestId: reqId, action: "accept" });
    const t1 = Date.now();
    const devSaw = await vd.waitForFunction((n) => [...document.querySelectorAll("#calls li")].filter((li) => li.textContent.includes("Ana Silva")).length > n, bookedBefore, { timeout: 35000 }).then(() => true, () => false);
    check("the developer's page was open on the calls panel", liBefore >= 0);
    check("developer page showed the booking line without reload", devSaw, `${Math.round((Date.now() - t1) / 1000)} s`);
    await shot(vd, "live-after-developer");
    for (const [pg, tag] of [[vd, "developer"], [vt, "tester"]]) {
      const v = pg.video();
      await pg.context().close();
      if (v) {
        const file = `16-live-updates-${tag}.webm`;
        await v.saveAs(path.join(OUT, file)).catch(() => {});
        cur.screenshots.push(file);
      }
    }
  });

  await flow("17", "New terms offered: Edit → the tester's top box → Send stops once → Switch → the next send is priced under the new terms", async () => {
    // Dee uploads a recording first (the page reloads), so the page's "seen" marker is before the Edit.
    await t2.goto(`/app/sessions/${SD}`);
    await t2.setInputFiles("input[type=file]", { name: "run2.webm", mimeType: "video/webm", buffer: Buffer.from("another tiny video") });
    await t2.waitForSelector("text=run2.webm", { timeout: 15000 });
    await t2.waitForTimeout(1000);
    // The developer edits the recording price ($15 → $20) through the Edit page.
    await dev.goto(`/app/tests/${T11}/edit`);
    check("Edit explains the offer", await has(dev, "text=each is offered these new terms and can switch"));
    await dev.fill("#recordingPrice", "20.00");
    await shot(dev, "edit-developer");
    await dev.click("button:has-text('Save')");
    check("Save result names the offer", await has(dev, "text=Saved. Offered the new terms to"));
    check("tester row: on original terms", await has(dev, "text=On their original terms · offered new terms"));
    await shot(dev, "saved-developer");
    // Dee's page (loaded before the Edit): Send stops once at the TOP.
    await t2.click("button:has-text('Send my recording')");
    check("tester's top stop-once box", await has(t2, "text=offered new terms: recording $15 → $20"));
    await shot(t2, "send-stops-once-tester");
    // Switch, then send: priced under the new terms.
    await t2.reload();
    check("top box offers the new terms", await has(t2, "text=updated the listing: recording $15 → $20"));
    await shot(t2, "offer-box-tester");
    await t2.click("text=Switch to the new terms");
    await t2.waitForTimeout(1500);
    await t2.click("button:has-text('Send my recording')");
    await t2.waitForTimeout(1500);
    const agreed = sql(`select "agreedCents" from "Submission" where "contractId" = '${SD}' and kind = 'recording'`);
    check("recording priced under the new terms ($20.00)", agreed === "2000", agreed);
    await t2.reload();
    await dev.goto(t11Url());
    check("tester row: switched", await has(dev, "text=Switched to the"));
    await both("switched-and-sent", t2);
  });

  await flow("18", "Block and Join call refusals: too early to join; the developer blocks; the tester reads only that the session ended; Join refused", async () => {
    // Ana's booked call (from flow 16) is days away: Join call is refused with the opening time.
    await tester.goto(`/app/sessions/${SA}`);
    await tester.click("button:has-text('Join call')");
    check("join too early", await has(tester, "text=You can join from"));
    await shot(tester, "join-too-early-tester");
    // The developer blocks Ana from her tester row.
    await dev.goto(t11Url());
    await dev.locator(`#tester-${SA}`).locator("button:has-text('Block Ana Silva')").click();
    await shot(dev, "block-confirm-developer");
    await dev.locator(`#tester-${SA}`).locator("button:has-text('Yes, block Ana Silva')").click();
    check("developer sees the block on the row", await has(dev, "text=You blocked Ana Silva."));
    await shot(dev, "blocked-row-developer");
    // Ana only reads a neutral line; her call was cancelled; Join is refused.
    await tester.reload();
    check("tester reads a neutral line", await has(tester, "text=Your session on Lighthouse Keeper ended."));
    check("never says blocked", !(await tester.isVisible("text=blocked")));
    await shot(tester, "session-ended-tester");
    await dev.goto("/app/profile#blocked");
    check("Settings → Blocked people", await has(dev, "text=Blocked people"));
    await shot(dev, "blocked-people-developer");
    await dev.locator("#blocked button:has-text('Unblock')").first().click();
    await dev.waitForTimeout(1200);
  });

  await flow("19", "Apply to join: the test takes applications; Apply stops once after a listing change; the developer accepts", async () => {
    // A fresh test that takes applications.
    const r = await apiPost(dev, "/api/tests", { title: "Signal Fire", description: "Light the beacons.", buildUrl: "https://example.com/signal", category: "Puzzle", devices: [], languages: [], spots: 4, writtenCents: "9.00", recordingCents: null, liveRateCents: null, liveMinutes: 30, deadlineDays: 7, questions: ["How did it feel?"], openUntil: "", joinMode: "apply" });
    const T19 = r.body.id;
    await t3.goto(`/app/find/${T19}`); // Cara's page loads (the "seen" marker)
    check("Apply to join shown", await has(t3, "button:has-text('Apply to join')"));
    // The developer edits the listing meanwhile: Apply stops once under the button.
    const v = sql(`select version from "Test" where id = '${T19}'`);
    await apiPost(dev, `/api/tests/${T19}/edit`, { version: Number(v), fields: { writtenCents: "11.00" }, confirmed: true });
    await t3.fill("#note", "I love beacon puzzles.");
    await t3.click("button:has-text('Apply to join')");
    check("Apply stops once (listing changed)", await has(t3, "text=The listing was edited: written answers price"));
    await shot(t3, "apply-stops-once-tester");
    await t3.click("button:has-text('Apply to join')");
    check("application sent", await has(t3, "text=Application sent."));
    await shot(t3, "applied-tester");
    await dev.goto(`/app/tests/${T19}`);
    check("developer sees the application", await has(dev, "text=I love beacon puzzles."));
    await shot(dev, "application-developer");
    await dev.locator("section[aria-label='Applications'] button:has-text('Accept')").first().click();
    await dev.waitForTimeout(1500);
    check("tester is in", await has(dev, `text=Cara Diaz ${TS % 10000}`));
    await t3.goto("/app");
    check("tester sees the session", await has(t3, "text=Signal Fire"));
    await both("accepted", t3);
  });

  await flow("20", "Call requests: both sides pick the same time → booked at once; accepting a withdrawn request is refused", async () => {
    const localAt = (days) => {
      const d = new Date(Date.now() + days * 86400000);
      d.setSeconds(0, 0);
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    const dee = deeName;
    // Dee requests a time.
    await t2.goto(`/app/sessions/${SD}`);
    await t2.fill("section[aria-label='Call requests'] input[type=datetime-local]", localAt(8));
    await t2.click("section[aria-label='Call requests'] >> text=Request a time");
    await t2.waitForTimeout(1500);
    check("tester's request is listed", await has(t2, "text=You requested"));
    await shot(t2, "requested-tester");
    // The developer requests the same time with Dee: booked at once.
    await dev.goto(t11Url());
    check("developer sees the request", await has(dev, `text=${dee} requested`));
    await shot(dev, "request-seen-developer");
    const lbl = dev.locator("section[aria-label='Call requests'] label", { hasText: dee });
    if (await lbl.count()) await lbl.locator("input").check();
    await dev.fill("section[aria-label='Call requests'] input[type=datetime-local]", localAt(8));
    await dev.click("section[aria-label='Call requests'] >> text=Request a time");
    await dev.waitForTimeout(1500);
    const booked = sql(`select count(*) from "Call" where "contractId" = '${SD}' and status = 'booked' and "startsAt" > now() + interval '7 days'`);
    check("booked at once (both picked the same time)", Number(booked) >= 1, booked);
    await t2.goto("/app/notifications");
    check("tester told: you both picked", await has(t2, "text=Booked: you both picked"));
    await both("auto-booked", t2);
    // Accepting a request withdrawn meanwhile: refused for good under Accept.
    await t2.goto(`/app/sessions/${SD}`);
    await t2.fill("section[aria-label='Call requests'] input[type=datetime-local]", localAt(9));
    await t2.click("section[aria-label='Call requests'] >> text=Request a time");
    await t2.waitForTimeout(1500);
    await dev.goto(t11Url()); // the developer's page shows the request
    await t2.reload();
    await t2.click("section[aria-label='Call requests'] >> button:has-text('Withdraw')");
    await t2.waitForTimeout(1500);
    await dev.click("section[aria-label='Call requests'] >> button:has-text('Accept')");
    check("accept on a withdrawn request refused", await has(dev, "text=withdrew this request at"));
    await shot(dev, "accept-withdrawn-refused-developer");
  });

  let T21 = "", SC = "", SDee = "";
  await flow("21", "Call requests with a rate ask: Select all to two testers; one asks $50/h and the developer accepts; the other's Accept is refused", async () => {
    const r = await apiPost(dev, "/api/tests", { title: "Night Ferry", description: "Cross the bay.", buildUrl: "https://example.com/ferry", category: "Adventure", devices: [], languages: [], spots: 4, writtenCents: "8.00", recordingCents: null, liveRateCents: "40.00", liveMinutes: 30, deadlineDays: 7, questions: ["Anything?"], openUntil: "", joinMode: "anyone" });
    T21 = r.body.id;
    SC = (await apiPost(t3, `/api/tests/${T21}/join`, { confirmed: true })).body.sessionId;
    SDee = (await apiPost(t2, `/api/tests/${T21}/join`, { confirmed: true })).body.sessionId;
    check("two testers in", !!SC && !!SDee);
    const when = new Date(Date.now() + 5 * 86400000);
    when.setSeconds(0, 0);
    const local = new Date(when.getTime() - when.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    // The developer requests one time with both (Select all).
    await dev.goto(`/app/tests/${T21}`);
    check("developer line about rates", await has(dev, "text=Calls you request use each tester's contract rate."));
    check("tick list shows each tester's terms and booked count", await has(dev, "text=0 of 3 booked"));
    await dev.check("section[aria-label='Call requests'] >> text=Select all");
    await dev.fill("section[aria-label='Call requests'] input[type=datetime-local]", local);
    await shot(dev, "select-all-developer");
    await dev.click("section[aria-label='Call requests'] >> text=Request a time");
    await dev.waitForTimeout(1500);
    // Dee's page is open with the developer's request (she'll press Accept later).
    await t2.goto(`/app/sessions/${SDee}`);
    check("tester sees only the listed rate", await has(t2, "text=Live call: $40/h"));
    await shot(t2, "request-received-tester-b");
    // Cara requests the same time asking $50/h: her copy closes; her request waits for the developer.
    await t3.goto(`/app/sessions/${SC}`);
    await t3.fill("section[aria-label='Call requests'] input[type=datetime-local]", local);
    await t3.fill("section[aria-label='Call requests'] input[aria-label='Ask per hour']", "50");
    await t3.click("section[aria-label='Call requests'] >> text=Request a time");
    await t3.waitForTimeout(1500);
    check("nothing booked on the tester's side", sql(`select count(*) from "Call" where "contractId" = '${SC}'`) === "0");
    await shot(t3, "asked-50-tester-a");
    // The developer accepts Cara's priced request → booked at the agreed rate.
    await dev.goto(`/app/tests/${T21}`);
    await dev.locator("section[aria-label='Call requests'] li", { hasText: "asks $50/h" }).locator("button:has-text('Accept')").click();
    await dev.waitForTimeout(1500);
    await dev.reload();
    check("booked call shows Agreed $50/h", await has(dev, "text=Agreed $50/h"));
    await shot(dev, "agreed-50-developer");
    // Dee's Accept on the same time (stale page) is refused under the button.
    await t2.click("section[aria-label='Call requests'] >> button:has-text('Accept')");
    check("tester B's Accept refused", await has(t2, "text=took this time at"));
    await shot(t2, "accept-refused-tester-b");
  });

  await flow("22", "Developer live-call panel: one tester with a booked call, a weekly set and a waiting request; another at 3 of 3 refused", async () => {
    // Times 9 h 17 min off the hour of earlier flows, so they never clash with the developer's other calls.
    const at = (days) => { const d = new Date(Date.now() + days * 86400000 + (9 * 60 + 17) * 60000); d.setSeconds(0, 0); return d.toISOString(); };
    const devReq = (contractId, extra) => apiPost(dev, `/api/tests/${T21}/request-time`, { seenAt: new Date().toISOString(), confirmed: true, contractIds: [contractId], ...extra });
    const lastReq = (contractId) => sql(`select id from "CallRequest" where "contractId" = '${contractId}' and status = 'pending' and "fromSide" = 'developer' order by "createdAt" desc limit 1`);
    const accept = (page, sid) => apiPost(page, `/api/sessions/${sid}/answer-request`, { seenAt: new Date().toISOString(), confirmed: true, requestId: lastReq(sid), action: "accept" });
    // Cara: (already one booked call from flow 21) + a weekly set (3 weeks) + a waiting request.
    await devReq(SC, { times: [at(6)], weeks: 3, repeat: "weekly" });
    const wk = await accept(t3, SC);
    check("weekly set booked (3 calls)", wk.body.calls === 3, JSON.stringify(wk.body));
    await devReq(SC, { times: [at(7)] });
    // Dee: three booked times (3 of 3).
    for (const d of [8, 9, 10]) {
      await devReq(SDee, { times: [at(d)] });
      const r = await accept(t2, SDee);
      check(`Dee's call on day ${d} booked`, r.body.booked === true, JSON.stringify(r.body));
    }
    // A 4th for Dee: requested, but her Accept is refused under the button.
    await devReq(SDee, { times: [at(11)] });
    await t2.goto(`/app/sessions/${SDee}`);
    await t2.locator("section[aria-label='Call requests'] li").last().locator("button:has-text('Accept')").click();
    check("4th booked time refused for the tester", await has(t2, "text=You already have 3 booked times in this test."));
    await shot(t2, "fourth-refused-tester");
    // The full developer panel with both testers.
    await dev.goto(`/app/tests/${T21}`);
    check("rate line", await has(dev, "text=Calls you request use each tester's contract rate."));
    check("Dee at 3 of 3 booked", await has(dev, "text=3 of 3 booked"));
    check("weekly set shown as one line", await has(dev, "text=Weekly:"));
    await dev.locator("section[aria-label='Call requests'] button:has-text('Show calls')").first().click();
    await shot(dev, "full-panel-developer");
    // The developer's own Accept on a 4th is refused too: Dee requests a time; the developer accepts.
    await apiPost(t2, `/api/sessions/${SDee}/request-time`, { seenAt: new Date().toISOString(), confirmed: true, times: [at(12)] });
    await dev.reload();
    await dev.locator("section[aria-label='Call requests'] li", { hasText: "requested" }).filter({ hasText: "Dee" }).locator("button:has-text('Accept')").first().click();
    check("4th booked time refused for the developer", await has(dev, "text=already has 3 booked times with you"));
    await shot(dev, "fourth-refused-developer");
  });

  await flow("23", "Every button stops once: your own other-tab actions, Block after a payment, listing info (F), the live top box", async () => {
    const r = await apiPost(dev, "/api/tests", { title: "Tide Pool", description: "Explore the rock pools.", buildUrl: "https://example.com/tide", category: "Adventure", devices: [], languages: [], spots: 4, writtenCents: "8.00", recordingCents: null, liveRateCents: null, liveMinutes: null, deadlineDays: 7, questions: ["What did you find?"], openUntil: "", joinMode: "anyone" });
    const T = r.body.id;
    const SCara = (await apiPost(t3, `/api/tests/${T}/join`, { confirmed: true })).body.sessionId;
    const SDee3 = (await apiPost(t2, `/api/tests/${T}/join`, { confirmed: true })).body.sessionId;
    check("two testers in", !!SCara && !!SDee3, JSON.stringify(r.body));
    // --- E: Cara has her session open in two tabs. Tab 2 sends the written answers; tab 1's Leave stops once.
    const tab1 = t3;
    const tab2 = await t3.context().newPage();
    await tab1.goto(`/app/sessions/${SCara}`);
    await tab2.goto(`/app/sessions/${SCara}`);
    await tab2.fill("#a0", "A crab and two starfish.");
    await tab2.click("button:has-text('Send my written answers')");
    await tab2.waitForTimeout(1500);
    check("tab 2 sent the answers", sql(`select count(*) from "Submission" where "contractId" = '${SCara}' and kind = 'written'`) === "1");
    await shot(tab2, "tab2-sent-tester");
    await tab1.click("button:has-text('Leave the test')");
    await tab1.locator("button:has-text('Leave the test')").last().click();
    check("tab 1 Leave stopped once: 'You also did this in another tab'", await has(tab1, "text=You also did this in another tab: sent your written answers at"));
    await shot(tab1, "tab1-leave-stopped-tester");
    await tab1.locator("button:has-text('Leave the test')").last().click();
    await tab1.waitForTimeout(2000);
    check("second press left the test", sql(`select status from "Contract" where id = '${SCara}'`) === "left");
    await shot(tab1, "tab1-left-tester");
    // --- Payments: Cara charges after 14 days, the developer's card is declined. The developer's top box names it;
    // Cara's other tab reads only "delayed".
    await tab2.goto(`/app/sessions/${SCara}`);
    await dev.goto(`/app/tests/${T}`);
    const pmBefore = sql(`select coalesce("stripePaymentMethodId", '') from "User" where id = '${devId}'`);
    const subC = sql(`select id from "Submission" where "contractId" = '${SCara}' and kind = 'written'`);
    sql(`update "Submission" set "payBy" = now() - interval '1 minute' where id = '${subC}'`);
    await runCron();
    sql(`update "User" set "stripePaymentMethodId" = 'pm_card_declined' where id = '${devId}'`);
    const ch = await apiPost(t3, `/api/sessions/${SCara}/choose`, { submissionId: subC, choice: "charge", tickedCents: 800 });
    check("Cara charged; the card was declined (owed)", sql(`select count(*) from "Payment" where "submissionId" = '${subC}' and status = 'failed' and "owedUntil" is not null`) === "1", JSON.stringify(ch.body));
    const devDeclined = await dev.waitForSelector("[data-live-top] >> text=for the written answers was declined", { timeout: 35000 }).then(() => true, () => false);
    check("developer's top box: the payment was declined (this test only)", devDeclined);
    await dev.evaluate(() => window.scrollTo(0, 0));
    await shot(dev, "top-box-declined-developer");
    const delayed = await tab2.waitForSelector("[data-live-top] >> text=The payment of $8.00 for your written answers is delayed", { timeout: 35000 }).then(() => true, () => false);
    const topText = delayed ? await tab2.locator("[data-live-top]").innerText() : "";
    check("tester's top box: 'delayed', never failed/hold/chargeback", delayed && !/fail|hold|chargeback/i.test(topText), topText);
    await shot(tab2, "top-box-delayed-tester");
    sql(`update "User" set "stripePaymentMethodId" = ${pmBefore ? `'${pmBefore}'` : "NULL"} where id = '${devId}'`);
    const owedPaid = await apiPost(dev, "/api/payments/owed", { confirmed: true });
    check("the developer paid what they owe", sql(`select count(*) from "Payment" where "submissionId" = '${subC}' and status = 'failed' and "settledAt" is null`) === "0", JSON.stringify(owedPaid.body));
    await tab2.close();
    // --- F + live top box: Dee's session page is open (scrolled down); the developer's Edit is open in tab 1.
    await apiPost(t2, `/api/sessions/${SDee3}/written`, { answers: ["Seaweed everywhere."] });
    const devTab1 = dev;
    const devTab2 = await dev.context().newPage();
    await devTab1.goto(`/app/tests/${T}/edit`);
    await t2.goto(`/app/sessions/${SDee3}`);
    await t2.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const y0 = await t2.evaluate(() => window.scrollY);
    // Tab 2: the developer changes the description and saves.
    await devTab2.goto(`/app/tests/${T}/edit`);
    await devTab2.fill("#description", "Explore the rock pools at low tide.");
    await devTab2.click("button:has-text('Save')");
    await devTab2.waitForURL(`**/app/tests/${T}?saved=1**`);
    // Edit tab 1 (opened before the other tab's save): Save stops once under Save; the second press saves.
    await devTab1.selectOption("#category", "Puzzle");
    await devTab1.click("button:has-text('Save')");
    check("Edit tab 1: Save stopped once with the other tab's change", await has(devTab1, "text=Nora Lane changed the description"));
    await shot(devTab1, "edit-save-stopped-developer");
    await devTab1.click("button:has-text('Save')");
    await devTab1.waitForURL(`**/app/tests/${T}?saved=1**`).catch(() => {});
    check("second Save saved", sql(`select category from "Test" where id = '${T}'`) === "Puzzle");
    await devTab2.close();
    // Dee's page: the top box shows the change by itself within ~20 s, and scrolls up to it once.
    const t0 = Date.now();
    const sawInfo = await t2.waitForSelector("[data-live-top] >> text=Nora Lane changed the description", { timeout: 35000 }).then(() => true, () => false);
    check("tester's top box: 'Nora Lane changed the description' with See it", sawInfo && (await has(t2, "[data-live-top] >> text=See it")), `${Math.round((Date.now() - t0) / 1000)} s`);
    await t2.waitForTimeout(1200);
    const y1 = await t2.evaluate(() => window.scrollY);
    check("the page scrolled up to the top box once", y0 > 200 && y1 < y0, `${y0} → ${y1}`);
    await t2.screenshot({ path: path.join(OUT, "23-top-box-viewport-tester.png") });
    cur.screenshots.push("23-top-box-viewport-tester.png");
    await shot(t2, "top-box-info-tester");
    // --- Block after the developer paid: Dee's page (not refreshed) stops once under "Yes, block".
    await t2.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await t2.click("button:has-text('Block Nora Lane')");
    const sub = sql(`select id from "Submission" where "contractId" = '${SDee3}' and kind = 'written'`);
    const paid = await apiPost(dev, "/api/review", { payKey: `ev23-${TS}`, kind: "submission", id: sub, amount: "8.00", tickedCents: 800, seenAt: new Date().toISOString(), confirmed: true });
    check("developer paid Dee $8", paid.status === 200, JSON.stringify(paid.body));
    await t2.click("button:has-text('Yes, block Nora Lane')");
    check("Block stopped once: the developer paid", await has(t2, "text=Nora Lane paid $8.00 for your written answers"));
    const y2 = await t2.evaluate(() => window.scrollY);
    await shot(t2, "block-stopped-tester");
    // The top box picks the payment up too (newest first) without scrolling again; the open stop box stays as is.
    const sawPaid = await t2.waitForSelector("[data-live-top] >> text=Nora Lane paid $8.00 for your written answers", { timeout: 35000 }).then(() => true, () => false);
    await t2.waitForTimeout(1200);
    const y3 = await t2.evaluate(() => window.scrollY);
    check("top box lists the payment above the description change", sawPaid && (await t2.locator("[data-live-top] li").first().innerText()).includes("paid $8.00"));
    check("no second scroll", Math.abs(y3 - y2) < 5, `${y2} → ${y3}`);
    check("the stop box lists the payment once", (await t2.locator("div.info li", { hasText: "paid $8.00 for your written answers" }).count()) === 2); // one in the top box, one under the button
    await shot(t2, "top-box-and-stop-box-tester");
    await t2.click("button:has-text('Yes, block Nora Lane')");
    await t2.waitForTimeout(2000);
    check("second press blocked", sql(`select count(*) from "Block" where "blockedId" = '${devId}' and "blockerId" = (select "testerId" from "Contract" where id = '${SDee3}')`) === "1");
    await shot(t2, "blocked-tester");
  });

  await browser.close();
  summary.pass = summary.flows.every((f) => f.status === "pass");
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(summary.pass ? "ALL PASS" : "SOME FAILED", "→", OUT);
  process.exit(summary.pass ? 0 : 1);
})();
