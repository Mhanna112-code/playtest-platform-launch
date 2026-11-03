import { randomUUID } from "node:crypto";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { setStripeForTests } from "@/lib/server/stripe";
import { logEvent } from "@/lib/server/live";
import { startHold } from "@/lib/server/holds";
import { newCardChecks, ALL_NOTE } from "@/lib/server/owedOnce";
import { watchBank, type PeekResult } from "@/lib/bankConfirm";
import { CANCELLED_WHY, NOTICE_HEAD, cancelledLine, stillPaysLine } from "@/lib/bankNotice";
import { BankCheckView, NO_NOTICE, addNews } from "@/components/BankCheck";
import { json, req } from "./helpers";
import { joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 3, batch 35 §160) Once the bank's page is open, Stripe's Complete can't be stopped by us: while it is open, the peek also says what changed since the
// press that would have stopped it, or that the check was cancelled underneath it, and the box shows a blue notice above the bank's frame before Complete.

(globalThis as unknown as { React: typeof React }).React = React;
const CHECK_URL = "https://hooks.stripe.com/3d_secure_2/hosted?fake=1";
const RETURN_URL = "http://localhost:3400/api/payments/bank-return";
const TAB = "tab-bank-notice";
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, headers: { "x-tab": TAB }, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const peek = (cookie: string, body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie, headers: { "x-tab": TAB }, body: { ...body, peek: true } })).then(json);
afterEach(() => {
  setStripeForTests(null);
  vi.useRealTimers();
});

/** A Stripe stand-in whose presses wait for the bank's page (made on `pm`); it records every call that would change anything. */
function fakeStripe(pm = "pm_old") {
  const status = new Map<string, { status: string; payment_method?: string }>();
  const changed: string[] = [];
  setStripeForTests({
    paymentIntents: {
      create: async () => {
        const id = "pi_" + randomUUID();
        status.set(id, { status: "requires_action", payment_method: pm });
        return { id, status: "requires_action", client_secret: `${id}_secret`, next_action: { type: "redirect_to_url", redirect_to_url: { url: CHECK_URL, return_url: RETURN_URL } } };
      },
      retrieve: async (id: string) => ({ id, client_secret: `${id}_secret`, ...(status.get(id) ?? { status: "succeeded" }) }),
      confirm: async (id: string) => { changed.push(`confirm ${id}`); return { id, status: "requires_action" }; },
      cancel: async (id: string) => { changed.push(`cancel ${id}`); status.set(id, { ...status.get(id), status: "canceled" }); return { id, status: "canceled" }; },
      capture: async (id: string) => { changed.push(`capture ${id}`); return { id, status: "succeeded" }; },
    },
    subscriptions: { cancel: async () => ({}) },
    refunds: { create: async () => { changed.push("refund"); return { id: "re_" + randomUUID() }; } },
    transfers: { create: async () => { changed.push("transfer"); return { id: "tr_" + randomUUID() }; } },
    webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
  } as unknown as Stripe);
  return { status, changed };
}

/** Written answers sent on a test (listed at $10), and the developer's Pay of them open at the bank. */
async function payOpen() {
  const s = await setup({ writtenCents: "10.00" });
  const j = await joined(s.testId);
  const n = ((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions as string[]).length || 1;
  await sact(j.sessionId, "written", j.tester.cookie, { answers: Array(n).fill("answer") });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_old" } });
  const st = fakeStripe();
  const r = await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
  expect(r.body).toMatchObject({ requiresAction: true, checkUrl: CHECK_URL });
  await settle();
  const since = new Date().toISOString(); // the moment the bank box opened
  await settle();
  return { ...s, ...j, sub, st, paymentId: r.body.paymentId as string, since };
}

/** Everything a peek could have touched. */
const snapshot = async (devId: string) => ({
  payments: await db.payment.findMany({ where: { developerId: devId }, orderBy: { id: "asc" } }),
  logs: await db.actionLog.count({ where: { userId: devId } }),
  reviews: await db.review.count(),
  user: await db.user.findUniqueOrThrow({ where: { id: devId } }),
});

describe("§160 the peek's changes: what would have stopped the press since it", () => {
  it("a change made after the press is a line (and what Complete still does); one made before the press is not; the peek changes nothing", async () => {
    const o = await payOpen();
    // Made before the box opened (the press already went ahead with it): never a line.
    const early = await db.testEvent.create({ data: { testId: o.testId, kind: "dispute", text: "Ana Silva disputed the pay for her live call", contractId: o.sessionId, createdAt: new Date(Date.parse(o.since) - 1000) } });
    void early;
    expect((await peek(o.dev.cookie, { paymentId: o.paymentId, since: o.since })).body).toEqual({ status: "waiting" });
    await logEvent(o.testId, "dispute", "Ana Silva disputed the pay for her recording", o.sessionId);
    const before = await snapshot(o.dev.user.id);
    for (let i = 0; i < 2; i++) {
      const r = await peek(o.dev.cookie, { paymentId: o.paymentId, since: o.since });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ status: "waiting", changes: ["Ana Silva disputed the pay for her recording"], still: "Complete still pays $10.00 as pressed; or press Close." });
    }
    // Read-only: no claim, no answered-log, nothing at Stripe.
    expect(await snapshot(o.dev.user.id)).toEqual(before);
    expect(o.st.changed).toEqual([]);
    // Without `since` (a page from before §160) the answer is as before.
    expect((await peek(o.dev.cookie, { paymentId: o.paymentId })).body).toEqual({ status: "waiting" });
    // The bank finished: done, and the lines still come with it (the box closes with its finish).
    o.st.status.set((await db.payment.findUniqueOrThrow({ where: { id: o.paymentId } })).actionPi!, { status: "succeeded" });
    expect((await peek(o.dev.cookie, { paymentId: o.paymentId, since: o.since })).body).toMatchObject({ status: "done", changes: ["Ana Silva disputed the pay for her recording"] });
  });

  it("Alerts-ignored types aren't lines, but the team's dispute decision is (as for Pay); another tab's own action is, this tab's isn't", async () => {
    const o = await payOpen();
    await db.test.update({ where: { id: o.testId }, data: { ignoredAlerts: ["disputes", "admin"] } });
    await logEvent(o.testId, "dispute", "Ana Silva disputed the pay for her recording", o.sessionId);
    expect((await peek(o.dev.cookie, { paymentId: o.paymentId, since: o.since })).body).toEqual({ status: "waiting" });
    await settle();
    await logEvent(o.testId, "admin", "The team decided Ana Silva's dispute: $5.00 more for her recording", o.sessionId);
    await settle();
    await db.actionLog.create({ data: { userId: o.dev.user.id, testId: o.testId, text: "invited Omar Reed", tab: TAB } });
    expect((await peek(o.dev.cookie, { paymentId: o.paymentId, since: o.since })).body).toEqual({ status: "waiting", changes: ["The team decided Ana Silva's dispute: $5.00 more for her recording"], still: stillPaysLine("$10.00") });
    await settle();
    await db.actionLog.create({ data: { userId: o.dev.user.id, testId: o.testId, text: "invited Lee Park", tab: "another-tab" } });
    const r = await peek(o.dev.cookie, { paymentId: o.paymentId, since: o.since });
    expect(r.body.changes).toEqual(["The team decided Ana Silva's dispute: $5.00 more for her recording", "You invited Lee Park in another tab"]);
  });

  it("Confirm all: a charge made while away that came in after the press is a line", async () => {
    const o = await payOpen();
    const one = await db.payment.create({ data: { kind: "owed", note: ALL_NOTE, developerId: o.dev.user.id, testerId: o.dev.user.id, amountCents: 2000, feeCents: 2000, testerCents: 0, status: "needs_action", actionPi: "pi_all_" + randomUUID(), actionBy: new Date(Date.now() + 900_000) } });
    o.st.status.set(one.actionPi!, { status: "requires_action" });
    const since = new Date(Date.now() + 5).toISOString();
    await settle();
    expect((await peek(o.dev.cookie, { paymentId: one.id, since })).body).toEqual({ status: "waiting" });
    await db.payment.create({ data: { kind: "dispute", developerId: o.dev.user.id, testerId: o.tester.user.id, contractId: o.sessionId, submissionId: o.sub.id, amountCents: 500, feeCents: 0, testerCents: 500, status: "needs_confirmation", actionPi: "pi_new_" + randomUUID(), actionBy: new Date(Date.now() + 86_400_000) } });
    const r = await peek(o.dev.cookie, { paymentId: one.id, since });
    expect(r.body.status).toBe("waiting");
    expect(r.body.changes).toHaveLength(1);
    expect(r.body.changes[0]).toMatch(/^Also waiting for your bank now: .*Ana Silva.* \$5\.00$/);
    expect(r.body.still).toBe(stillPaysLine("$20.00"));
  });
});

describe("§160 Pay what you owe's changes", () => {
  it("a debt added after the press is a line; what the one payment covers, or what was owed before, is not", async () => {
    const o = await payOpen();
    const dev = o.dev.user.id;
    await db.user.update({ where: { id: dev }, data: { holdStartedAt: new Date(Date.now() - 60_000), holdReason: "unpaid" } });
    const debt = (cents: number, at: Date) => db.payment.create({ data: { kind: "review", developerId: dev, testerId: o.tester.user.id, contractId: o.sessionId, amountCents: cents, feeCents: 0, testerCents: cents, status: "failed", owedUntil: at, createdAt: at } });
    const a = await debt(700, new Date(Date.now() - 30_000));
    const one = await db.payment.create({ data: { kind: "owed", note: "press", developerId: dev, testerId: dev, amountCents: 700, feeCents: 700, testerCents: 0, status: "needs_action", actionPi: "pi_owed_" + randomUUID(), actionBy: new Date(Date.now() + 900_000) } });
    await db.payment.update({ where: { id: a.id }, data: { coveredById: one.id } });
    o.st.status.set(one.actionPi!, { status: "requires_action" });
    await settle();
    const since = new Date().toISOString();
    await settle();
    expect((await peek(o.dev.cookie, { paymentId: one.id, since })).body).toEqual({ status: "waiting" });
    await debt(300, new Date());
    const r = await peek(o.dev.cookie, { paymentId: one.id, since });
    expect(r.body.changes).toHaveLength(1);
    expect(r.body.changes[0]).toMatch(/^Another payment failed meanwhile: .*\$3\.00/);
    expect(r.body.still).toBe(stillPaysLine("$7.00"));
  });
});

describe("§160 a check cancelled underneath the open bank page", () => {
  it("a hold started: cancelled with its reason, the box stays open (Complete charges nothing); the peek changes nothing", async () => {
    const o = await payOpen();
    await startHold(o.dev.user.id, "unpaid");
    const pi = (await db.payment.findUniqueOrThrow({ where: { id: o.paymentId } })).stripePaymentIntentId!;
    expect(o.st.changed).toEqual([`cancel ${pi}`]); // cancelled at Stripe by the hold, not by the peek
    const before = await snapshot(o.dev.user.id);
    const r = await peek(o.dev.cookie, { paymentId: o.paymentId, since: o.since });
    expect(r.body).toEqual({ status: "waiting", cancelled: "This bank check was cancelled: your tests were paused (a payment hold started). Pressing Complete won't charge anything." });
    expect(await snapshot(o.dev.user.id)).toEqual(before);
    expect(o.st.changed).toEqual([`cancel ${pi}`]);
    // A page from before §160 (no `since`): done, as before (its finish says nothing was charged).
    expect((await peek(o.dev.cookie, { paymentId: o.paymentId })).body).toEqual({ status: "done" });
  });

  it("a new card was saved: cancelled, naming the new card", async () => {
    const o = await payOpen();
    await db.user.update({ where: { id: o.dev.user.id }, data: { stripePaymentMethodId: "pm_new" } });
    await newCardChecks(o.dev.user.id);
    expect((await db.payment.findUniqueOrThrow({ where: { id: o.paymentId } })).status).toBe("cancelled");
    expect((await peek(o.dev.cookie, { paymentId: o.paymentId, since: o.since })).body).toEqual({ status: "waiting", cancelled: cancelledLine(CANCELLED_WHY.card) });
  });

  it("a check that is still open, or that went through, is never cancelled", async () => {
    const o = await payOpen();
    expect((await peek(o.dev.cookie, { paymentId: o.paymentId, since: o.since })).body.cancelled).toBeUndefined();
    await db.payment.update({ where: { id: o.paymentId }, data: { status: "charged", actionPi: null } });
    expect((await peek(o.dev.cookie, { paymentId: o.paymentId, since: o.since })).body).toEqual({ status: "done" });
  });
});

describe("§160 the notice in the box", () => {
  const action = { requiresAction: true as const, paymentId: "p1", clientSecret: "", publishableKey: "", simulated: false, checkUrl: CHECK_URL };

  it("lines are added as they arrive, never twice; the latest 'still' and the cancelled line are kept", () => {
    let n = addNews(NO_NOTICE, { status: "waiting", changes: ["Ana Silva disputed the pay for her recording"], still: stillPaysLine("$10.00") });
    expect(n.lines).toEqual(["Ana Silva disputed the pay for her recording."]);
    const same = addNews(n, { status: "waiting", changes: ["Ana Silva disputed the pay for her recording"], still: stillPaysLine("$10.00") });
    expect(same).toBe(n); // nothing new: unchanged
    n = addNews(n, { status: "waiting", changes: ["Ana Silva disputed the pay for her recording", "Ana Silva left the test", "Ana Silva left the test"] });
    expect(n.lines).toEqual(["Ana Silva disputed the pay for her recording.", "Ana Silva left the test."]);
    n = addNews(n, { status: "waiting" });
    expect(n.still).toBe("Complete still pays $10.00 as pressed; or press Close.");
    n = addNews(n, { status: "waiting", cancelled: cancelledLine(CANCELLED_WHY.hold) });
    expect(n.cancelled).toBe("This bank check was cancelled: your tests were paused (a payment hold started). Pressing Complete won't charge anything.");
  });

  it("renders INSIDE the bank box, directly above the frame: the heading, the lines and what Complete still does; a cancelled check says so instead", () => {
    const plain = renderToStaticMarkup(createElement(BankCheckView, { action, finish: async () => ({}), onEnd: () => {}, notice: { lines: ["Ana Silva disputed the pay for her recording."], still: stillPaysLine("$10.00"), cancelled: "" } }));
    expect(plain).toMatch(/data-bank-check="bank".*data-bank-notice="".*<iframe /s);
    expect(plain).toContain('class="info"');
    expect(plain).toContain(NOTICE_HEAD.replace("'", "&#x27;"));
    expect(plain).toContain("<li data-bank-notice-line=\"\">Ana Silva disputed the pay for her recording.</li>");
    expect(plain).toContain("Complete still pays $10.00 as pressed; or press Close.");
    expect(plain.match(/data-bank-notice-line/g)).toHaveLength(1);
    const cancelled = renderToStaticMarkup(createElement(BankCheckView, { action, finish: async () => ({}), onEnd: () => {}, notice: { lines: [], still: "", cancelled: cancelledLine(CANCELLED_WHY.hold) } }));
    expect(cancelled).toMatch(/data-bank-notice-cancelled="">This bank check was cancelled: your tests were paused \(a payment hold started\)\. Pressing Complete won&#x27;t charge anything\.<\/p>.*<iframe /s);
    expect(cancelled).not.toContain("Complete still pays");
    // No news: no notice.
    expect(renderToStaticMarkup(createElement(BankCheckView, { action, finish: async () => ({}), onEnd: () => {} }))).not.toContain("data-bank-notice");
  });

  it("the watch hands each answer with news to the notice and keeps polling: plain changes never end the check; done still does", async () => {
    vi.useFakeTimers();
    const answers: PeekResult[] = [
      { status: "waiting", changes: ["Ana Silva disputed the pay for her recording"], still: stillPaysLine("$10.00") },
      { status: "waiting", changes: ["Ana Silva disputed the pay for her recording"], still: stillPaysLine("$10.00") },
      { status: "waiting" },
      { status: "done" },
    ];
    let n = NO_NOTICE;
    const news = vi.fn((r: PeekResult) => { n = addNews(n, r); });
    const onDone = vi.fn();
    const stop = watchBank(async () => answers.shift() ?? { status: "done" }, onDone, 3000, news);
    await vi.advanceTimersByTimeAsync(9000);
    expect(news).toHaveBeenCalledTimes(2);
    expect(n.lines).toEqual(["Ana Silva disputed the pay for her recording."]);
    expect(onDone).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(onDone).toHaveBeenCalledTimes(1);
    stop();
  });
});
