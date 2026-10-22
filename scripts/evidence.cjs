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
const sql = (q) => require("child_process").execFileSync("psql", ["-h", "localhost", "-p", "5499", "-U", "postgres", "-d", "playtest_lite", "-t", "-A", "-c", q]).toString().trim();
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
    await admin.goto("/admin");
    check("admin page", await has(admin, "text=Disputes"), admin.url());
    await shot(admin, "admin");
  });

  await flow("08", "Invite: the developer invites a tester from the test page; the tester sees the invite", async () => {
    const t2 = await ctx(PHONE);
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
    const adm = await ctx(DESKTOP);
    await signIn(adm, ADMIN);
    await adm.goto("/admin");
    await adm.locator("p", { hasText: "Chargeback open: $12.50" }).first().locator("button:has-text('Mark resolved')").click();
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

  await browser.close();
  summary.pass = summary.flows.every((f) => f.status === "pass");
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(summary.pass ? "ALL PASS" : "SOME FAILED", "→", OUT);
  process.exit(summary.pass ? 0 : 1);
})();
