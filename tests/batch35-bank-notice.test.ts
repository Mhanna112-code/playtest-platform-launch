import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type Stripe from "stripe";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
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
// This file leaves open checks, holds and debts on its own developers: they are closed at the end, so the global jobs other files run (the daily job,
// the 5-minute sweep) never act on them.
const devs: string[] = [];
afterAll(async () => {
  await db.payment.updateMany({ where: { developerId: { in: devs }, status: { notIn: ["charged", "bundled", "not_set_up"] } }, data: { status: "cancelled", actionPi: null, actionBy: null, coveredById: null } });
  await db.reservation.updateMany({ where: { developerId: { in: devs } }, data: { status: "cancelled" } });
  await db.user.updateMany({ where: { id: { in: devs } }, data: { holdStartedAt: null, holdReason: "" } });
});
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
  devs.push(s.dev.user.id);
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
      expect(r.body).toEqual({ status: "waiting", changes: ["Ana Silva disputed the pay for her recording"], still: "Complete still pays $10.00 as pressed; or press Cancel." });
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

  it("Confirm all: a charge made while away that came in after the press is a line (not added to it)", async () => {
    const o = await payOpen();
    const one = await db.payment.create({ data: { kind: "owed", note: ALL_NOTE, developerId: o.dev.user.id, testerId: o.dev.user.id, amountCents: 2000, feeCents: 2000, testerCents: 0, status: "needs_action", actionPi: "pi_all_" + randomUUID(), actionBy: new Date(Date.now() + 900_000) } });
    o.st.status.set(one.actionPi!, { status: "requires_action" });
    const since = new Date(Date.now() + 5).toISOString();
    await settle();
    expect((await peek(o.dev.cookie, { paymentId: one.id, since })).body).toEqual({ status: "waiting" });
    await db.payment.create({ data: { kind: "review", developerId: o.dev.user.id, testerId: o.tester.user.id, contractId: o.sessionId, submissionId: o.sub.id, amountCents: 500, feeCents: 0, testerCents: 500, status: "needs_confirmation", actionPi: "pi_new_" + randomUUID(), actionBy: new Date(Date.now() + 86_400_000) } });
    const r = await peek(o.dev.cookie, { paymentId: one.id, since });
    expect(r.body.status).toBe("waiting");
    expect(r.body.changes).toHaveLength(1);
    expect(r.body.changes[0]).toBe("Ana Silva charged $5.00 meanwhile: it isn't in this payment; confirm it on its own, or with Confirm all after this one");
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
    expect(r.body.changes[0]).toMatch(/\$3\.00.* \(card declined\): it isn't in this payment; pay it with Pay what you owe after this one$/);
    expect(r.body.still).toBe(stillPaysLine("$7.00"));
  });

  it("a chargeback hold's reservation open: a NEW chargeback is named with its amount and fee, and what happens to it (charged after the team approves the lift)", async () => {
    const o = await payOpen();
    const dev = o.dev.user.id;
    await db.payment.update({ where: { id: o.paymentId }, data: { status: "charged", actionPi: null, settledAt: new Date() } }); // Ana's $10.00, paid
    const older = await db.payment.create({ data: { kind: "review", developerId: dev, testerId: o.tester.user.id, contractId: o.sessionId, amountCents: 2000, feeCents: 0, testerCents: 2000, status: "charged", settledAt: new Date(Date.now() - 86_400_000), chargeback: "open", chargebackAt: new Date(Date.now() - 60_000), createdAt: new Date(Date.now() - 86_400_000) } });
    await db.user.update({ where: { id: dev }, data: { holdStartedAt: new Date(Date.now() - 60_000), holdReason: "chargeback", chargebackCardVerifiedAt: new Date() } });
    const pi = "pi_res_" + randomUUID();
    o.st.status.set(pi, { status: "requires_action" });
    const res = await db.reservation.create({ data: { developerId: dev, amountCents: 3500, covers: [older.id], status: "needs_action", stripePaymentIntentId: pi, actionBy: new Date(Date.now() + 900_000) } });
    await settle();
    const since = new Date().toISOString();
    await settle();
    expect((await peek(o.dev.cookie, { paymentId: res.id, since })).body).toEqual({ status: "waiting" });
    // The bank reverses Ana's $10.00 too, while the reservation's bank page is open.
    await db.payment.update({ where: { id: o.paymentId }, data: { chargeback: "open", chargebackAt: new Date() } });
    const r = await peek(o.dev.cookie, { paymentId: res.id, since });
    expect(r.body.changes).toHaveLength(1);
    expect(r.body.changes[0]).toMatch(/\$10.*\$15.*: it isn't in this reservation; it's charged right after the team approves lifting your hold$/);
    expect(r.body.still).toBe(stillPaysLine("$35.00", true));
    expect(o.st.changed).toEqual([]);
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
    expect(n.still).toBe("Complete still pays $10.00 as pressed; or press Cancel.");
    n = addNews(n, { status: "waiting", cancelled: cancelledLine(CANCELLED_WHY.hold) });
    expect(n.cancelled).toBe("This bank check was cancelled: your tests were paused (a payment hold started). Pressing Complete won't charge anything.");
  });

  it("renders INSIDE the bank box, directly above the frame: the heading, the lines and what Complete still does; a cancelled check says so instead", () => {
    const plain = renderToStaticMarkup(createElement(BankCheckView, { action, finish: async () => ({}), onEnd: () => {}, notice: { lines: ["Ana Silva disputed the pay for her recording."], still: stillPaysLine("$10.00"), cancelled: "" } }));
    expect(plain).toMatch(/data-bank-check="bank".*data-bank-notice="".*<iframe /s);
    expect(plain).toContain('class="info"');
    expect(plain).toContain(NOTICE_HEAD.replace("'", "&#x27;"));
    expect(plain).toContain("<li data-bank-notice-line=\"\">Ana Silva disputed the pay for her recording.</li>");
    expect(plain).toContain("Complete still pays $10.00 as pressed; or press Cancel.");
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

const finish = (cookie: string, body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie, headers: { "x-tab": TAB }, body })).then(json);

describe("§160 Cancel under the bank's window (and leaving the page): Stripe is asked first", () => {
  it("unfinished: the developer's own Pay is cancelled at Stripe, nothing charged, and the part can be paid again at once", async () => {
    const o = await payOpen();
    const pi = (await db.payment.findUniqueOrThrow({ where: { id: o.paymentId } })).actionPi!;
    const r = await finish(o.dev.cookie, { paymentId: o.paymentId });
    expect(r.status).toBe(402);
    expect(r.body.error.message).toBe("Your bank didn't confirm the payment, so nothing was charged.");
    expect(o.st.changed).toEqual([`cancel ${pi}`]);
    expect(await db.payment.findUniqueOrThrow({ where: { id: o.paymentId } })).toMatchObject({ status: "cancelled", actionPi: null });
    expect(await db.review.count({ where: { submissionId: o.sub.id } })).toBe(0);
    const again = await pay(o.dev.cookie, { kind: "submission", id: o.sub.id, amount: "10.00", tickedCents: 1000 });
    expect(again.body).toMatchObject({ requiresAction: true }); // payable again at once
  });

  it("finished at the bank (the return blocked): recorded as paid once; a second Cancel or the beacon charges nothing more", async () => {
    const o = await payOpen();
    const pi = (await db.payment.findUniqueOrThrow({ where: { id: o.paymentId } })).actionPi!;
    o.st.status.set(pi, { status: "succeeded" });
    const r = await finish(o.dev.cookie, { paymentId: o.paymentId });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ done: true, amountCents: 1000, status: "charged" });
    expect(o.st.changed).toEqual([]); // never cancelled
    const twice = await finish(o.dev.cookie, { paymentId: o.paymentId, leave: true });
    expect(twice.status).toBe(409); // already confirmed: nothing again
    expect(await db.review.count({ where: { submissionId: o.sub.id } })).toBe(1);
    expect(await db.payment.count({ where: { submissionId: o.sub.id, status: "charged" } })).toBe(1);
  });

  it("the cancel at Stripe finds it just went through: recorded paid once, and said so (never 'nothing was charged')", async () => {
    const o = await payOpen();
    const stripe = (await import("@/lib/server/stripe")).getStripe() as unknown as { paymentIntents: { cancel: (id: string) => Promise<unknown> } };
    stripe.paymentIntents.cancel = async (id: string) => { o.st.status.set(id, { status: "succeeded" }); return { id, status: "succeeded" }; };
    const r = await finish(o.dev.cookie, { paymentId: o.paymentId, leave: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ done: true, amountCents: 1000, paidAtCancel: true });
    expect(await db.payment.findUniqueOrThrow({ where: { id: o.paymentId } })).toMatchObject({ status: "charged" });
    expect(await db.review.count({ where: { submissionId: o.sub.id } })).toBe(1);
  });

  it("a single charge made while away (Confirm with your bank): Cancel never cancels it; it keeps waiting with its own date, no hold", async () => {
    const o = await payOpen();
    await db.payment.update({ where: { id: o.paymentId }, data: { status: "cancelled", actionPi: null } }); // the Pay out of the way
    const by = new Date(Date.now() + 2 * 86_400_000);
    const away = await db.payment.create({ data: { kind: "review", developerId: o.dev.user.id, testerId: o.tester.user.id, contractId: o.sessionId, submissionId: o.sub.id, amountCents: 1000, feeCents: 0, testerCents: 1000, status: "needs_confirmation", actionPi: "pi_away_" + randomUUID(), actionBy: by } });
    o.st.status.set(away.actionPi!, { status: "requires_action" });
    const r = await finish(o.dev.cookie, { paymentId: away.id, leave: true });
    expect(r.status).toBe(402);
    expect(r.body.error.message).toMatch(/^Nothing was charged: this payment still waits for your bank\. Confirm with your bank by /);
    expect(o.st.changed).toEqual([]);
    expect(await db.payment.findUniqueOrThrow({ where: { id: away.id } })).toMatchObject({ status: "needs_confirmation", actionPi: away.actionPi, actionBy: by });
    expect((await db.user.findUniqueOrThrow({ where: { id: o.dev.user.id } })).holdStartedAt).toBeNull();
  });

  it("Pay what you owe: a tester's Charge arriving while its check is open waits (not added) and the notice says so", async () => {
    const o = await payOpen();
    const dev = o.dev.user.id;
    await db.payment.update({ where: { id: o.paymentId }, data: { status: "cancelled", actionPi: null } });
    await db.user.update({ where: { id: dev }, data: { holdStartedAt: new Date(Date.now() - 60_000), holdReason: "unpaid" } });
    const a = await db.payment.create({ data: { kind: "review", developerId: dev, testerId: o.tester.user.id, contractId: o.sessionId, amountCents: 700, feeCents: 0, testerCents: 700, status: "failed", owedUntil: new Date(Date.now() - 30_000), createdAt: new Date(Date.now() - 30_000) } });
    const one = await db.payment.create({ data: { kind: "owed", note: "press", developerId: dev, testerId: dev, amountCents: 700, feeCents: 700, testerCents: 0, status: "needs_action", actionPi: "pi_owed_" + randomUUID(), actionBy: new Date(Date.now() + 900_000) } });
    await db.payment.update({ where: { id: a.id }, data: { coveredById: one.id } });
    o.st.status.set(one.actionPi!, { status: "requires_action" });
    await settle();
    const since = new Date().toISOString();
    await settle();
    await db.payment.create({ data: { kind: "review", developerId: dev, testerId: o.tester.user.id, contractId: o.sessionId, submissionId: o.sub.id, amountCents: 1000, feeCents: 0, testerCents: 1000, status: "deferred" } });
    const r = await peek(o.dev.cookie, { paymentId: one.id, since });
    expect(r.body.changes).toEqual(["Ana Silva charged $10.00 meanwhile: it's charged right after this payment goes through"]);
    expect((await db.payment.findUniqueOrThrow({ where: { id: one.id } })).amountCents).toBe(700); // not added
  });

  it("the page: Cancel under the frame with the hint for its kind; leaving the page sends the same finish as a beacon", () => {
    const action = { requiresAction: true as const, paymentId: "p1", clientSecret: "", publishableKey: "", simulated: false, checkUrl: CHECK_URL };
    const own = renderToStaticMarkup(createElement(BankCheckView, { action, finish: async () => ({}), onEnd: () => {} }));
    expect(own).toContain(">Cancel</button>");
    expect(own).toContain("Already finished with your bank? It&#x27;s recorded as paid; otherwise nothing is charged.");
    const waits = renderToStaticMarkup(createElement(BankCheckView, { action: { ...action, cancel: "waits" as const }, finish: async () => ({}), onEnd: () => {} }));
    expect(waits).toContain("otherwise nothing is charged and it keeps waiting for your bank.");
    const read = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
    expect(read("components/BankCheck.tsx")).toContain('window.addEventListener("pagehide", gone);');
    expect(read("components/BankCheck.tsx")).toContain('leaveBeacon("/api/payments/confirm", { paymentId: a.paymentId })');
    expect(read("components/BankWaiting.tsx")).toContain('cancel: own ? "press" : "waits"');
    expect(read("components/ConfirmAll.tsx")).toContain('cancel: "all"');
    expect(read("components/ChargebackSteps.tsx")).toContain('leaveBeacon("/api/payments/verify-card", { finish: true, setupIntent, cancel: true })');
  });
});

describe("§160 an open bank check stays open only while its page is open (heartbeat, 3 minutes)", () => {
  const later = (ms: number) => new Date(Date.now() + ms);
  it("each peek is a heartbeat; with none for 3 minutes the developer's own check is ended like Cancel (Stripe first); a fresh one and an away charge stay", async () => {
    const o = await payOpen();
    const { endStaleChecks, HEARTBEAT_STALE_MS } = await import("@/lib/server/bankHeartbeat");
    expect(HEARTBEAT_STALE_MS).toBe(180_000);
    await peek(o.dev.cookie, { paymentId: o.paymentId, since: o.since });
    const beat = await db.keptForm.findUniqueOrThrow({ where: { userId_key: { userId: o.dev.user.id, key: `bankcheck:${o.paymentId}` } } });
    expect(beat.updatedAt.getTime()).toBeGreaterThan(Date.now() - 10_000);
    const by = new Date(Date.now() + 2 * 86_400_000);
    const away = await db.payment.create({ data: { kind: "dispute", developerId: o.dev.user.id, testerId: o.tester.user.id, contractId: o.sessionId, submissionId: o.sub.id, amountCents: 500, feeCents: 0, testerCents: 500, status: "needs_confirmation", actionPi: "pi_away_" + randomUUID(), actionBy: by, createdAt: new Date(Date.now() - 600_000) } });
    // 2 minutes after the last heartbeat: still open.
    expect(await endStaleChecks(o.dev.user.id, later(120_000), true)).toBe(0);
    expect(o.st.changed).toEqual([]);
    // 3+ minutes: ended, cancelled at Stripe, payable again; the away charge keeps waiting.
    const pi = (await db.payment.findUniqueOrThrow({ where: { id: o.paymentId } })).actionPi!;
    expect(await endStaleChecks(o.dev.user.id, later(200_000), true)).toBe(1);
    expect(o.st.changed).toEqual([`cancel ${pi}`]);
    expect(await db.payment.findUniqueOrThrow({ where: { id: o.paymentId } })).toMatchObject({ status: "cancelled", actionPi: null });
    expect(await db.payment.findUniqueOrThrow({ where: { id: away.id } })).toMatchObject({ status: "needs_confirmation", actionPi: away.actionPi, actionBy: by });
  });

  it("a stale check that had gone through at the bank is recorded as paid once (never cancelled)", async () => {
    const o = await payOpen();
    const { endStaleChecks } = await import("@/lib/server/bankHeartbeat");
    const stripe = (await import("@/lib/server/stripe")).getStripe() as unknown as { paymentIntents: { cancel: (id: string) => Promise<unknown> } };
    stripe.paymentIntents.cancel = async (id: string) => ({ id, status: "succeeded" });
    expect(await endStaleChecks(o.dev.user.id, later(200_000), true)).toBe(1);
    expect(await db.payment.findUniqueOrThrow({ where: { id: o.paymentId } })).toMatchObject({ status: "charged" });
    expect(await db.review.count({ where: { submissionId: o.sub.id } })).toBe(1);
  });

  it("a chargeback hold's reservation: its rows carry its Cancel this check in any tab; pressed there, it's cancelled at Stripe (Stripe first) and the open box says so", async () => {
    const o = await payOpen();
    const dev = o.dev.user.id;
    await db.payment.update({ where: { id: o.paymentId }, data: { status: "charged", actionPi: null, settledAt: new Date(), chargeback: "open", chargebackAt: new Date(Date.now() - 60_000) } });
    await db.user.update({ where: { id: dev }, data: { holdStartedAt: new Date(Date.now() - 60_000), holdReason: "chargeback", chargebackCardVerifiedAt: new Date() } });
    const pi = "pi_res_" + randomUUID();
    o.st.status.set(pi, { status: "requires_action" });
    const res = await db.reservation.create({ data: { developerId: dev, amountCents: 2500, covers: [o.paymentId], status: "needs_action", stripePaymentIntentId: pi, actionBy: new Date(Date.now() + 900_000) } });
    const { owedLines } = await import("@/lib/server/holds");
    const row = (await owedLines(dev)).find((l) => l.id === o.paymentId)!;
    expect(row).toMatchObject({ waiting: true, checkId: res.id });
    const { POST: owedPOST } = await import("@/app/api/payments/owed/route");
    const r = await owedPOST(req("/api/payments/owed", { cookie: o.dev.cookie, body: { cancelCheck: res.id } })).then(json);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ cancelled: true });
    expect(o.st.changed).toEqual([`cancel ${pi}`]);
    expect(await db.reservation.findUniqueOrThrow({ where: { id: res.id } })).toMatchObject({ status: "cancelled" });
    const box = await peek(o.dev.cookie, { paymentId: res.id, since: new Date(Date.now() - 5_000).toISOString() });
    expect(box.body.cancelled).toMatch(/^This bank check was cancelled: /);
  });

  it("the page: the Pay box with its window open elsewhere offers Cancel this check", () => {
    const read = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
    expect(read("app/app/tests/[id]/PayBox.tsx")).toContain("<BankWaiting own paymentId={p.confirming}");
    expect(read("components/BankWaiting.tsx")).toContain("{own && !doneLine && <button");
  });

  it("Pay what you owe while its reservation is at the bank in another tab: an older page's press is refused with the plain line (never a stop-once, never 'already reserved')", async () => {
    const o = await payOpen();
    const dev = o.dev.user.id;
    await db.payment.update({ where: { id: o.paymentId }, data: { status: "charged", actionPi: null, settledAt: new Date(), chargeback: "open", chargebackAt: new Date(Date.now() - 60_000) } });
    await db.user.update({ where: { id: dev }, data: { holdStartedAt: new Date(Date.now() - 60_000), holdReason: "chargeback", chargebackCardVerifiedAt: new Date() } });
    const { owedLines } = await import("@/lib/server/holds");
    const shown = (await owedLines(dev)).filter((l) => l.retry);
    const pi = "pi_res_" + randomUUID();
    o.st.status.set(pi, { status: "requires_action" });
    const res = await db.reservation.create({ data: { developerId: dev, amountCents: 2500, covers: shown.map((l) => l.id), status: "needs_action", stripePaymentIntentId: pi, actionBy: new Date(Date.now() + 900_000) } });
    const { POST: owedPOST } = await import("@/app/api/payments/owed/route");
    const r = await owedPOST(req("/api/payments/owed", { cookie: o.dev.cookie, body: { seenTotalCents: shown.reduce((s, l) => s + l.amountCents, 0), seenIds: shown.map((l) => l.id), confirmed: false } })).then(json);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "owed_in_flight", message: "Pay what you owe ($25.00) is waiting for your bank in another tab or window: finish that check, or cancel it." });
    expect(await db.reservation.count({ where: { developerId: dev } })).toBe(1);
    // Once reserved, a press says it's reserved (and only then).
    await db.reservation.update({ where: { id: res.id }, data: { status: "reserved" } });
    const again = await owedPOST(req("/api/payments/owed", { cookie: o.dev.cookie, body: { seenTotalCents: 0, seenIds: [], confirmed: true } })).then(json);
    expect(again.body.error.code).not.toBe("owed_in_flight");
    expect(fs.readFileSync(path.resolve(__dirname, "../src/components/OwedBox.tsx"), "utf8")).toContain("owedElsewhereLine(money(elsewhereCents))");
  });

  it("Pay what you owe: a redraw counts as seen (the box sends what it drew last); a change not drawn yet still stops once", async () => {
    const o = await payOpen();
    const dev = o.dev.user.id;
    await db.payment.update({ where: { id: o.paymentId }, data: { status: "cancelled", actionPi: null } });
    await db.user.update({ where: { id: dev }, data: { holdStartedAt: new Date(Date.now() - 60_000), holdReason: "unpaid" } });
    const a = await db.payment.create({ data: { kind: "review", developerId: dev, testerId: o.tester.user.id, contractId: o.sessionId, amountCents: 700, feeCents: 0, testerCents: 700, status: "failed", owedUntil: new Date(Date.now() - 30_000) } });
    const { POST: owedPOST } = await import("@/app/api/payments/owed/route");
    const press = (seen: number, ids: string[]) => owedPOST(req("/api/payments/owed", { cookie: o.dev.cookie, body: { seenTotalCents: seen, seenIds: ids, confirmed: false } })).then(json);
    // A new debt arrives; the page that drew only the first one: stops once naming it.
    const b = await db.payment.create({ data: { kind: "review", developerId: dev, testerId: o.tester.user.id, contractId: o.sessionId, amountCents: 300, feeCents: 0, testerCents: 300, status: "failed", owedUntil: new Date() } });
    const stale = await press(700, [a.id]);
    expect(stale.body.error).toMatchObject({ code: "stop_once" });
    // The page redrew with both rows: its press is checked against what it drew, and goes ahead (the bank's check opens for $10.00).
    const drawn = await press(1000, [a.id, b.id]);
    expect(drawn.status).toBe(200);
    expect(drawn.body.confirm?.[0]).toMatchObject({ requiresAction: true });
    expect(await db.payment.findFirstOrThrow({ where: { developerId: dev, kind: "owed" } })).toMatchObject({ amountCents: 1000 });
    const box = fs.readFileSync(path.resolve(__dirname, "../src/components/OwedBox.tsx"), "utf8");
    expect(box).toContain("if (drawnKey !== lastDrawn) {");
    expect(box).toMatch(/if \(!changes\) \{\s+setTotal\(seenTotal\);\s+setShownIds\(retry\.map\(\(o\) => o\.id\)\);/);
  });
});
