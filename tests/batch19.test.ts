import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { GROUP_COUNT_TITLES, GROUP_TITLES, groupTitle } from "@/lib/bell";
import { allowedLine } from "@/app/app/tests/[id]/TestBanner";
import { PAYMENT_RULES, TERMS_VERSION, WHAT_CHANGED } from "@/lib/termsOfUse";
import { GET as healthGET } from "@/app/api/health/route";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { POST as verifyPOST } from "@/app/api/payments/verify-card/route";
import { POST as subPOST } from "@/app/api/payments/subscription/route";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { POST as testsPOST } from "@/app/api/tests/route";
import { chargebackOpened, startHold } from "@/lib/server/holds";
import { setStripeForTests } from "@/lib/server/stripe";
import { TIMERS_LOCK_KEY, withTimersLock } from "@/lib/server/timers";
import { openTestsV, profileOpenTests } from "@/lib/server/profileOpenTests";
import { ChangesBox } from "@/components/ChangesBox";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, listingBody, sact, seen, settle, setup } from "./fixtures";

// Batch 19 (owner, Oct 28 evening): small fixes found after batches 17-18, timed jobs every 5 minutes from the uptime check, the Terms' payments section, a
// required tick about Charge on Post and Edit, and the Open until line.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const DAY = 86_400_000;
const MIN = 60_000;
(globalThis as unknown as { React: typeof React }).React = React;
const KEY = "test-health-key-19";
const ping = (key?: string) => healthGET(new Request(`http://localhost:3400/api/health${key ? `?key=${key}` : ""}`));
/** The sweep finished (the lock is free again). */
async function idle() {
  for (let i = 0; i < 300 && (await db.appState.findUnique({ where: { key: TIMERS_LOCK_KEY } })); i++) await new Promise((r) => setTimeout(r, 100));
}

describe("batch 19 section 1: close-out reminders stack under a heading", () => {
  it("the closeout group is titled “Closing soon” and counts its tests", () => {
    expect(GROUP_TITLES.closeout).toBe("Closing soon");
    expect(groupTitle("closeout", 3)).toBe("Closing soon: 3 tests");
    expect(groupTitle("closeout", 1)).toBe("Closing soon: 1 test");
    expect(GROUP_COUNT_TITLES.closeout).toBeTypeOf("function");
  });

  it("every bell group used anywhere in the code has a title", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f.name)) files.push(p);
      }
    };
    walk(path.resolve(__dirname, "../src"));
    const used = new Set<string>();
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      // Only files that write bell lines (notify / bell from server/notify).
      if (!/from "\.\/notify"|from "@\/lib\/server\/notify"/.test(text)) continue;
      for (const m of text.matchAll(/\bgroup:\s*([^,}]+)/g)) for (const s of m[1].matchAll(/"([a-z]+)"/g)) used.add(s[1]);
    }
    expect(used.size).toBeGreaterThan(15);
    expect(used).toContain("closeout");
    const missing = [...used].filter((g) => !GROUP_TITLES[g]);
    expect(missing).toEqual([]);
  });
});

describe("batch 19 section 2: the paused-test banner mentions Rate", () => {
  it("“rate testers” joins the line when Rate is available, built from what's shown", () => {
    expect(allowedLine(true, { stop: true, endEarly: true, cancelCalls: true, rate: true })).toBe("For now you can stop this test, end testers' work early, cancel calls, or rate testers.");
    expect(allowedLine(true, { stop: true, rate: true })).toBe("For now you can stop this test, or rate testers.");
    expect(allowedLine(true, { stop: true, rate: false })).toBe("For now you can stop this test.");
    // The test page passes Rate only when an open Rate box shows (the team's pause, nobody held or suspended).
    expect(src("app/app/tests/[id]/page.tsx")).toContain('rate: !accountPaused && t.contracts.some((c) => rateStates.get(c.id)?.kind === "open")');
  });
});

describe("batch 19 sections 3 and 6: the Terms of Use", () => {
  const page = src("app/terms/page.tsx");
  it("no “lower the length”: the call's length is measured; paying less needs a reason; the tester can dispute it once", () => {
    expect(page).not.toContain("can only lower it");
    const calls = PAYMENT_RULES.find((r) => r.heading === "Calls")!;
    expect(calls.text).toContain("A call's length is measured by the app while both people have the call page open, up to 150% of the booked length and never past the $1,000 for that tester's calls. The developer pays by the hour at the call's rate; paying less needs a reason the tester reads, and the tester can dispute it once.");
    expect(WHAT_CHANGED[0].points.some((p) => p.startsWith("A call's length is measured by the app while both people have the call page open"))).toBe(true);
  });

  it("one “How payments work” section: the listed headings in order, each with a one-line example; DRAFT and version 2 kept; What changed says so", () => {
    expect(PAYMENT_RULES.map((r) => r.heading)).toEqual([
      "Prices and the split", "Days per tester", "Paying for work", "Pay more", "Unreviewed work: Charge or Let it go", "Close-out", "Calls", "Unlisted work",
      "Bank checks, declines, holds", "Payouts", "Subscriptions", "Taxes and refunds",
    ]);
    for (const r of PAYMENT_RULES) {
      expect(r.text.length, r.heading).toBeGreaterThan(40);
      expect(r.example.length, r.heading).toBeGreaterThan(10);
      expect(r.example, r.heading).not.toContain("\n");
    }
    expect(PAYMENT_RULES[0].text).toContain("The tester receives 80% of every payment; the platform keeps 20%.");
    expect(PAYMENT_RULES[1].example).toBe("Opened Nov 6 with Open until Nov 20: 14 days per tester, so a tester who joins Nov 19 is due Dec 3.");
    expect(PAYMENT_RULES[4].text).toContain("A Charge over $200 needs a tick. Each piece gets at least 14 days of Charge.");
    expect(PAYMENT_RULES[8].text).toContain("adds a $15 fee");
    expect(page).toContain('title: "4. How payments work"');
    expect(page).toContain("Example: {r.example}");
    expect(page).not.toContain("4. Reviews and payment");
    expect(page).not.toContain("5. Disputes");
    expect(page).toContain("Version {TERMS_VERSION} · DRAFT");
    expect(TERMS_VERSION).toBe(2);
    expect(WHAT_CHANGED).toHaveLength(1);
    expect(WHAT_CHANGED[0].points).toContain("Payments section rewritten: every money rule is now in one place, section 4, How payments work, in short headed paragraphs with an example each.");
    expect(WHAT_CHANGED[0].points[0]).toContain("The content rule (section 5)");
  });
});

describe("batch 19 section 4: timed jobs every 5 minutes, from the uptime check", () => {
  beforeEach(() => {
    process.env.HEALTH_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.HEALTH_KEY;
  });
  async function soonCall() {
    const s = await setup();
    const j = await joined(s.testId);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() + 14 * MIN), createdAt: new Date(Date.now() - 2 * DAY) } });
    const count = async () => db.notification.count({ where: { userId: { in: [s.dev.user.id, j.tester.user.id] }, reminderKey: `call15:${call.id}` } });
    return { ...s, ...j, call, count };
  }

  it("a health call with the key runs due reminders, once; the answer is healthy", async () => {
    const x = await soonCall();
    const r = await ping(KEY);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    await idle();
    expect(await x.count()).toBe(2); // the tester's and the developer's
    await ping(KEY);
    await idle();
    expect(await x.count()).toBe(2);
  });

  it("Charge opening runs from it too (not only the daily job)", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000) } });
    await db.contract.updateMany({ where: { testId: s.testId }, data: { dueAt: new Date(Date.now() - 1000) } });
    await ping(KEY);
    await idle();
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).choiceOfferedAt).not.toBeNull();
    expect(await db.notification.count({ where: { userId: j.tester.user.id, text: "Nora Lane didn't review your written answers in 7 days: charge $10.00 or let it go" } })).toBe(1);
  });

  it("two at once don't double-send (one lock: the second skips)", async () => {
    const x = await soonCall();
    const rs = await Promise.all([ping(KEY), ping(KEY), ping(KEY)]);
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    await idle();
    expect(await x.count()).toBe(2);
    // The lock itself: a second run while one holds it doesn't run.
    let inner: string | null = "not run";
    await withTimersLock(async () => {
      inner = await withTimersLock(async () => "ran");
    });
    expect(inner).toBeNull();
    expect(await db.appState.findUnique({ where: { key: TIMERS_LOCK_KEY } })).toBeNull();
  });

  it("without the key (or with a wrong one) nothing runs", async () => {
    const x = await soonCall();
    expect((await ping()).status).toBe(200);
    expect((await ping("wrong-key")).status).toBe(200);
    await idle();
    expect(await x.count()).toBe(0);
    delete process.env.HEALTH_KEY; // no key configured: a keyed call runs nothing either
    expect((await ping(KEY)).status).toBe(200);
    await idle();
    expect(await x.count()).toBe(0);
  });

  it("the daily job keeps the daily jobs and shares the lock; HANDOVER says the monitor must stay on", () => {
    const holds = src("lib/server/holds.ts");
    expect(holds).toContain("withTimersLock(() => runDailyLocked(now), { waitMs: 60_000 })");
    expect(holds).toMatch(/export async function runSweep\(now = new Date\(\), co = closeOutMemo\(now\)\) \{\r?\n\s+await \(await import\("\.\/calls"\)\)\.sweepNobodyJoined\(now\);/);
    expect(fs.readFileSync(path.resolve(__dirname, "../vercel.json"), "utf8")).toContain('"schedule": "0 9 * * *"');
    expect(fs.readFileSync(path.resolve(__dirname, "../docs/HANDOVER.md"), "utf8")).toContain("UptimeRobot's 5-minute check now also drives reminders and timers, so the monitor must stay on");
  });
});

/** A Stripe stand-in: "action" makes a press wait for the bank; `keys` records each create's idempotency key; `bank` plays the bank's answer. */
function fakeStripe(mode: "ok" | "action" = "ok") {
  const keys: string[] = [];
  const status = new Map<string, string>();
  setStripeForTests({
    paymentIntents: {
      create: async (p: Record<string, unknown>, o?: { idempotencyKey?: string }) => {
        keys.push(o?.idempotencyKey ?? "");
        const id = "pi_" + randomUUID();
        if (mode === "action" && !p.off_session) {
          status.set(id, "requires_action");
          return { id, status: "requires_action", client_secret: `${id}_secret` };
        }
        status.set(id, "succeeded");
        return { id, status: "succeeded" };
      },
      retrieve: async (id: string) => ({ id, status: status.get(id) ?? "succeeded", client_secret: `${id}_secret` }),
      cancel: async (id: string) => { status.set(id, "canceled"); return { id, status: "canceled" }; },
    },
    refunds: { create: async () => ({ id: "re_" + randomUUID() }) },
  } as unknown as Stripe);
  return { keys, bank: (id: string, ok: boolean) => status.set(id, ok ? "succeeded" : "canceled") };
}
const withCard = (userId: string) => db.user.update({ where: { id: userId }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
const payWith = (cookie: string, payKey: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey, seenAt: seen(), confirmed: true, ...body } })).then(json);
const confirm = (cookie: string, body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie, body })).then(json);
async function sentWork() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  return { ...s, ...j, sub };
}

describe("batch 19 section 5: Pay after a cancelled bank check", () => {
  afterEach(() => setStripeForTests(null));

  it("cancel, then Pay again on the same piece from the same page (the same press key): a new attempt with a new key, no 500; then paid once", async () => {
    const { dev, sub } = await sentWork();
    await withCard(dev.user.id);
    const st = fakeStripe("action");
    const key = randomUUID();
    const first = await payWith(dev.cookie, key, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(first.body.requiresAction).toBe(true);
    expect((await confirm(dev.cookie, { paymentId: first.body.paymentId, simulate: "failed" })).status).toBe(402);
    expect(await db.payment.findUniqueOrThrow({ where: { id: first.body.paymentId } })).toMatchObject({ status: "cancelled" });
    const again = await payWith(dev.cookie, key, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(again.status).toBe(200);
    expect(again.body.requiresAction).toBe(true);
    const row = await db.payment.findUniqueOrThrow({ where: { id: again.body.paymentId } });
    expect(row.payKey).toBe(`press:${dev.user.id}:${key}:2`);
    expect(new Set(st.keys).size).toBe(2); // a fresh one-time key for the bank's new check
    // A third try after another cancel: ":3".
    expect((await confirm(dev.cookie, { paymentId: again.body.paymentId, simulate: "failed" })).status).toBe(402);
    const third = await payWith(dev.cookie, key, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect((await db.payment.findUniqueOrThrow({ where: { id: third.body.paymentId } })).payKey).toBe(`press:${dev.user.id}:${key}:3`);
    st.bank((await db.payment.findUniqueOrThrow({ where: { id: third.body.paymentId } })).actionPi!, true);
    expect((await confirm(dev.cookie, { paymentId: third.body.paymentId })).status).toBe(200);
    expect(await db.payment.count({ where: { submissionId: sub.id, status: "charged" } })).toBe(1);
    // The page makes a new key for the next attempt after a check that didn't go through, or any press that didn't.
    const box = src("app/app/tests/[id]/PayBox.tsx");
    expect(box).toContain("const [payKey, setPayKey] = useState(newPressId);");
    expect(box).toContain("setBankErr((e as Error).message); setPayKey(newPressId()); return;");
  });

  it("a double click still charges once", async () => {
    const { dev, sub } = await sentWork();
    await withCard(dev.user.id);
    fakeStripe("ok");
    const key = randomUUID();
    const body = { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 };
    const rs = await Promise.all([payWith(dev.cookie, key, body), payWith(dev.cookie, key, body)]);
    expect(rs.some((r) => r.status === 200)).toBe(true);
    expect(rs.every((r) => r.status < 500)).toBe(true);
    expect(await db.payment.count({ where: { submissionId: sub.id, status: "charged" } })).toBe(1);
    // Pressed again after it went through: the same press, never twice.
    expect((await payWith(dev.cookie, key, body)).body.repeated).toBe(true);
    expect(await db.payment.count({ where: { submissionId: sub.id, status: "charged" } })).toBe(1);
  });

  it("Pay more: cancel, then press again from the same box: a new attempt; then paid once", async () => {
    const { dev, testId, sessionId, sub } = await sentWork();
    expect((await payWith(dev.cookie, randomUUID(), { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200); // paid without Stripe
    await withCard(dev.user.id);
    const st = fakeStripe("action");
    const key = randomUUID();
    const more = () => act(testId, "pay-extra", dev.cookie, { seenAt: seen(), confirmed: true, payKey: key, contractId: sessionId, submissionId: sub.id, amount: "5.00", tickedCents: 500, note: "Thanks" });
    const a = await more();
    expect(a.body.requiresAction).toBe(true);
    expect((await confirm(dev.cookie, { paymentId: a.body.paymentId, simulate: "failed" })).status).toBe(402);
    const b = await more();
    expect(b.status).toBe(200);
    expect(b.body.requiresAction).toBe(true);
    expect(b.body.paymentId).not.toBe(a.body.paymentId);
    expect(new Set(st.keys).size).toBe(2);
    st.bank((await db.payment.findUniqueOrThrow({ where: { id: b.body.paymentId } })).actionPi!, true);
    expect((await confirm(dev.cookie, { paymentId: b.body.paymentId })).status).toBe(200);
    expect(await db.payment.count({ where: { submissionId: sub.id, kind: "extra", status: "charged" } })).toBe(1);
  });

  it("Pay what you owe: cancel, then press again: a new attempt goes through", async () => {
    const s = await sentWork();
    await withCard(s.dev.user.id);
    const row = await db.payment.create({ data: { kind: "review", submissionId: s.sub.id, contractId: s.sessionId, developerId: s.dev.user.id, testerId: s.tester.user.id, amountCents: 800, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
    await startHold(s.dev.user.id, "unpaid");
    const st = fakeStripe("action");
    const owed = () => owedPOST(req("/api/payments/owed", { cookie: s.dev.cookie, body: {} })).then(json);
    const a = await owed();
    expect(a.body.confirm).toHaveLength(1);
    expect((await confirm(s.dev.cookie, { paymentId: row.id, simulate: "failed" })).status).toBe(402);
    const b = await owed();
    expect(b.status).toBe(200);
    expect(b.body.confirm).toHaveLength(1);
    expect(new Set(st.keys).size).toBe(2);
    st.bank((await db.payment.findUniqueOrThrow({ where: { id: row.id } })).actionPi!, true);
    expect((await confirm(s.dev.cookie, { paymentId: row.id })).status).toBe(200);
    expect(await db.payment.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "charged" });
  });

  it("Subscribe: cancel, then Subscribe again the same day: a new attempt with a new key, then subscribed", async () => {
    process.env.FREE_UNTIL = new Date(Date.now() - DAY).toISOString(); // free during launch is over
    try {
      const dev = await makeUser({ dev: true, name: "Nora Lane" });
      await withCard(dev.user.id);
      const st = fakeStripe("action");
      const subscribe = () => subPOST(req("/api/payments/subscription", { cookie: dev.cookie, body: { action: "subscribe" } })).then(json);
      const a = await subscribe();
      expect(a.body.requiresAction).toBe(true);
      expect((await confirm(dev.cookie, { paymentId: a.body.paymentId, simulate: "failed" })).status).toBe(402);
      const b = await subscribe();
      expect(b.status).toBe(200);
      expect(b.body.requiresAction).toBe(true);
      expect(st.keys).toHaveLength(2);
      expect(st.keys[1]).not.toBe(st.keys[0]);
      expect(st.keys[1]).toBe(`pay-${st.keys[0].replace(/^pay-/, "")}:2`);
      st.bank((await db.payment.findUniqueOrThrow({ where: { id: b.body.paymentId } })).actionPi!, true);
      expect((await confirm(dev.cookie, { paymentId: b.body.paymentId })).status).toBe(200);
      expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).subscriptionStatus).toBe("active");
      await db.user.update({ where: { id: dev.user.id }, data: { subscriptionStatus: "ended", subscriptionEndReason: "cancelled" } });
    } finally {
      delete process.env.FREE_UNTIL;
    }
  });

  it("Verify a card: cancel, then Verify again starts a new check that can verify; the page drops a card form whose check failed", async () => {
    const { dev, sessionId, tester, sub } = await sentWork();
    const pi = "pi_" + randomUUID();
    await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 800, feeCents: 160, testerCents: 640, status: "charged", stripePaymentIntentId: pi } });
    expect(await chargebackOpened(pi)).toBe(true);
    const verify = (body: Record<string, unknown>) => verifyPOST(req("/api/payments/verify-card", { cookie: dev.cookie, body })).then(json);
    expect((await verify({ check: true })).body.standIn).toBe(true);
    expect((await verify({ finish: true, simulate: "failed" })).body.error.code).toBe("not_verified");
    expect((await verify({ check: true })).body.standIn).toBe(true);
    expect((await verify({ finish: true, simulate: "succeeded" })).body).toEqual({ verified: true });
    expect(src("components/ChargebackSteps.tsx")).toContain("try { await check(r.setupIntentId, r.checkUrl, false); } catch (e) { setForm(null); throw e; }");
  });
});

describe("batch 19 section 5: the smaller bugs", () => {
  it("developer profile: the list re-renders from the poll until it shows it, and refreshes when shown again from the back/forward cache", async () => {
    const auto = src("components/AutoRefresh.tsx");
    expect(auto).toContain('window.addEventListener("pageshow", onShow);');
    expect(auto).toContain("if (!e.persisted) return;");
    expect(auto).toContain("const was = shown.current ?? last.current;");
    expect(auto).toContain("shown.current = v ?? null;");
    // The page's own fingerprint is the poll's: the comparison can settle.
    const s = await setup();
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    const devRow = await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } });
    const polled = (await json(await pulseGET(req(`/api/pulse?profile=${s.dev.user.id}`, { cookie: ana.cookie, method: "GET" })))).body.v;
    expect(polled).toBe(openTestsV(await profileOpenTests(devRow, ana.user, false)));
    await db.test.update({ where: { id: s.testId }, data: { adminPausedAt: new Date() } });
    const after = (await json(await pulseGET(req(`/api/pulse?profile=${s.dev.user.id}`, { cookie: ana.cookie, method: "GET" })))).body.v;
    expect(after).not.toBe(polled);
    expect(after).toBe("");
  });

  it("the Length box: the label and “min” stay on one line, and its red line goes under the row", () => {
    for (const f of ["components/CallRequests.tsx", "app/app/tests/[id]/DevCallPanel.tsx"]) {
      const t = src(f);
      expect(t, f).toContain('<div className="flex flex-wrap items-end gap-2" data-note-after="" data-length-row="">');
      expect(t, f).toMatch(/<label className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap[^"]*">Length <input/);
      expect(t, f).toContain("/> min</label>");
    }
    // A box's red line goes after the wrapper marked data-note-after (under the whole row).
    expect(src("components/FieldChecks.tsx")).toContain('(el.closest("[data-note-after]") ?? el).insertAdjacentElement("afterend", note);');
  });

  it("the stop box names the press that was made: “Your Let it go didn't go through.”", () => {
    const box = renderToStaticMarkup(createElement(ChangesBox, { side: "tester", changes: [{ text: "Nora Lane paid $5.00", at: new Date().toISOString() }], didntGo: true, press: "Let it go" }));
    expect(box).toContain("Your Let it go didn&#x27;t go through.");
    expect(box).toContain("Press Let it go again to go ahead.");
    const choice = src("app/app/sessions/[id]/ChoiceBox.tsx");
    expect(choice).toContain('setPressed(choice === "letgo" ? "Let it go" : "Charge");');
    expect(choice).toContain("didntGo press={pressed} />");
  });
});

describe("batch 19 section 7: a required tick about Charge on Post and Edit", () => {
  const TICK = "I understand that a tester can charge my card, up to the listing price, for work I haven't paid once 7 days have passed since they sent it and their own deadline has passed.";
  const refusedTick = (r: { status: number; body: { error?: { code: string; errors?: string[] } } }) => {
    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe("bad_listing");
    expect(r.body.error?.errors).toContain("Tick to confirm you understand how payments work.");
  };

  it("the words, the link to the Terms' payments section, and no line under the Charge box", () => {
    expect(R.PAY_RULES_TICK).toBe(TICK);
    expect(R.PAY_RULES_LINK).toBe("How payments work");
    expect(R.PAY_RULES_TICK_MISSING).toBe("Tick to confirm you understand how payments work.");
    expect(R.PAYMENTS_TERMS_HREF).toBe("/terms#how-payments-work");
    expect(src("app/terms/page.tsx")).toContain("{...(s.payments ? { id: PAYMENTS_TERMS_ID } : {})}");
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain('<a href={PAYMENTS_TERMS_HREF} target="_blank" rel="noreferrer">{PAY_RULES_LINK}</a>');
    expect(form).toContain('data-match="^Tick to confirm you understand how payments work"');
    expect(src("app/app/sessions/[id]/ChoiceBox.tsx")).not.toContain("data-charge-why");
  });

  it("Post: refused unticked (red at the tick, listed with the other mistakes); ticked, it posts", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane" });
    const post = (over: Record<string, unknown>) => testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody(over) })).then(json);
    refusedTick(await post({ payRulesOk: false }));
    const both = await post({ payRulesOk: undefined, title: "" });
    expect(both.body.error.errors[both.body.error.errors.length - 1]).toBe("Tick to confirm you understand how payments work.");
    expect(both.body.error.errors.length).toBeGreaterThan(1);
    expect(await db.test.count({ where: { developerId: dev.user.id } })).toBe(0);
    expect((await post({ payRulesOk: true })).status).toBe(200);
  });

  it("posting a draft: refused unticked, posts ticked", async () => {
    const { dev, testId } = await setup();
    const draft = await act(testId, "next-round", dev.cookie, { seenAt: seen(), confirmed: true });
    expect(draft.status).toBe(200);
    refusedTick(await act(draft.body.id, "post-draft", dev.cookie, listingBody({ title: "Round 2", payRulesOk: false })));
    expect((await db.test.findUniqueOrThrow({ where: { id: draft.body.id } })).status).toBe("draft");
    expect((await act(draft.body.id, "post-draft", dev.cookie, listingBody({ title: "Round 2" }))).status).toBe(200);
  });

  it("Edit: Save is refused unticked; the tick shows only while Save is enabled and unticks when the form is back to unchanged", async () => {
    const { dev, testId } = await setup();
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    refusedTick(await act(testId, "edit", dev.cookie, { version: v, fields: { description: "Sail further." }, seenAt: seen(), confirmed: true, payRulesOk: false }));
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).description).toBe("Sail");
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { description: "Sail further." }, seenAt: seen(), confirmed: true, payRulesOk: true })).status).toBe(200);
    const form = src("app/app/tests/TestForm.tsx");
    // Above the button, only while Save is enabled (Post: always, nothingChanged is never true there).
    expect(form).toMatch(/\{!nothingChanged && \(\s*<div data-note-after="" data-pay-rules-tick="">/);
    expect(form.indexOf("data-pay-rules-tick")).toBeLessThan(form.indexOf('{busy ? "Saving…" : edit ? "Save" : "Post the test"}'));
    expect(form).toContain("if (nothingChanged) setPayTick(false);");
    expect(form).toContain("payRulesOk: payTick, seenAt: edit.seenAt,");
    expect(form).toContain("confirmHigh: confirmHigh(), payRulesOk: payTick, timeZone: browserZone(), agreeTerms });");
  });
});

describe("batch 19 section 8: Post and Edit say that work can arrive after Open until", () => {
  it("the live line's numbers: Post (today to Open until) and Edit (the days now + the extension)", () => {
    expect(R.openUntilLine("2026-11-20", 14)).toBe("Testers can join until this date. Each gets 14 days from when they join, so someone joining on Nov 20 has until Dec 4 to send work. You pay each piece within 7 days of it arriving, or the tester can charge you.");
    expect(R.openUntilLine("2026-11-25", 14 + 5)).toBe("Testers can join until this date. Each gets 19 days from when they join, so someone joining on Nov 25 has until Dec 14 to send work. You pay each piece within 7 days of it arriving, or the tester can charge you.");
    expect(R.openUntilLine("2026-12-30", 1)).toContain("Each gets 1 day from when they join, so someone joining on Dec 30 has until Dec 31 to send work.");
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain("openUntilLine(f.openUntil, daysBetween(localToday(), f.openUntil))");
    expect(form).toContain("openUntilLine(f.openUntil, edit.testerDays + Math.max(0, daysBetween(base.openUntil.slice(0, 10), f.openUntil)))");
    // The line sits above the tick (the Open until field comes before the button).
    expect(form.indexOf("data-tester-days")).toBeLessThan(form.indexOf("data-pay-rules-tick"));
  });
});
