// Records evidence that the lean Playtest works: screenshots (phone 390x844 and desktop) of the main flows and
// docs/evidence/summary.json with every check. Needs the app running on BASE (default http://localhost:3400) with the
// dev outbox on (ALLOW_DEV_OUTBOX=1 under `next start`) and ADMIN_EMAILS containing ADMIN (default owner@example.com).
// Usage: node scripts/evidence.cjs
/* eslint-disable */
const fs = require("fs");
const path = require("path");
const { chromium } = require("C:/Users/march/Projects/playtest-platform/node_modules/playwright");

const BASE = process.env.BASE || "http://localhost:3400";
const OUT = path.join(__dirname, "..", "docs", "evidence");
const TS = Date.now();
const DEV = `dev+${TS}@playtest.test`, TESTER = `tester+${TS}@playtest.test`, ADMIN = process.env.ADMIN || "owner@example.com";
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 900 } };

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.png$/.test(f) || f === "summary.json") fs.rmSync(path.join(OUT, f));
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
    check("session page shows the contract", await has(tester, "text=Your contract (what you get)"));
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
    await tester.click("form >> text=Send");
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

  await browser.close();
  summary.pass = summary.flows.every((f) => f.status === "pass");
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(summary.pass ? "ALL PASS" : "SOME FAILED", "→", OUT);
  process.exit(summary.pass ? 0 : 1);
})();
