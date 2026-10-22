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

  await flow("06", "Live call: developer offers a time, tester books it", async () => {
    await dev.goto(testUrl);
    const when = new Date(Date.now() + 3 * 86400000);
    const local = new Date(when.getTime() - when.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await dev.fill('input[type="datetime-local"]', local);
    await dev.click("text=Offer these times");
    await dev.waitForSelector("button:has-text('Remove')");
    await shot(dev, "time-offered");
    await tester.reload();
    await tester.click("button:has-text('Book')");
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
    await vd.goto(testUrl);
    const when = new Date(Date.now() + 4 * 86400000);
    await vd.fill('input[type="datetime-local"]', new Date(when.getTime() - when.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    await vd.click("text=Offer these times");
    await vd.waitForSelector("button:has-text('Remove')");
    await vt.goto(sessionUrl || "/app");
    await vt.click("button:has-text('Book')");
    await vt.waitForTimeout(800);
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
    await apiPost(dev, `/api/tests/${T11}/offer-times`, { seenAt: new Date().toISOString(), confirmed: true, times: [2, 3, 4].map((n) => new Date(Date.now() + n * 86400000).toISOString()) });
    const slots = sql(`select id from "CallSlot" where "testId" = '${T11}' order by "startsAt"`).split("\n");
    await apiPost(tester, `/api/sessions/${SA}/book`, { seenAt: new Date().toISOString(), confirmed: true, slotId: slots[0] });
    sql(`update "Call" set "startsAt" = now() - interval '30 minutes' where "slotId" = '${slots[0]}'`);
    await apiPost(tester, `/api/sessions/${SA}/book`, { seenAt: new Date().toISOString(), confirmed: true, slotId: slots[1] });
    sql(`update "Call" set "startsAt" = now() - interval '2 minutes' where "slotId" = '${slots[1]}'`);
    await apiPost(tester, `/api/sessions/${SA}/book`, { seenAt: new Date().toISOString(), confirmed: true, slotId: slots[2] });
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
    const tBefore = await vt.locator("button:has-text('Book')").count();
    await shot(vd, "live-before-developer");
    await shot(vt, "live-before-tester");
    // The developer offers a time (from another tab): the tester's open page shows it by itself.
    await apiPost(dev, `/api/tests/${T11}/offer-times`, { seenAt: new Date().toISOString(), confirmed: true, times: [new Date(Date.now() + 6 * 86400000).toISOString()] });
    const t0 = Date.now();
    const appeared = await vt.waitForFunction((n) => document.querySelectorAll("button").length > 0 && [...document.querySelectorAll("button")].filter((b) => b.textContent === "Book").length > n, tBefore, { timeout: 35000 }).then(() => true, () => false);
    check("tester page showed the new time without reload", appeared, `${Math.round((Date.now() - t0) / 1000)} s`);
    await shot(vt, "live-after-tester");
    // The tester books (from another tab): the developer's open page shows the line by itself.
    const slot = sql(`select id from "CallSlot" where "testId" = '${T11}' and status = 'open' order by "createdAt" desc limit 1`);
    await vd.waitForTimeout(22000); // let the developer's page settle on the offered time first
    const liBefore = await vd.locator("#calls li").count();
    const bookedBefore = await vd.locator("#calls li", { hasText: "Ana Silva" }).count();
    await apiPost(tester, `/api/sessions/${SA}/book`, { seenAt: new Date().toISOString(), confirmed: true, slotId: slot });
    const t1 = Date.now();
    const devSaw = await vd.waitForFunction((n) => [...document.querySelectorAll("#calls li")].filter((li) => li.textContent.includes("Ana Silva")).length > n, bookedBefore, { timeout: 35000 }).then(() => true, () => false);
    check("open time turned into a booking", liBefore >= 1);
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

  await browser.close();
  summary.pass = summary.flows.every((f) => f.status === "pass");
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(summary.pass ? "ALL PASS" : "SOME FAILED", "→", OUT);
  process.exit(summary.pass ? 0 : 1);
})();
