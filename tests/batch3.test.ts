import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import * as R from "@/lib/rules";
import { startHold } from "@/lib/server/holds";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, setup } from "./fixtures";

const DAY = 86_400_000;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const cron = () => cronGET(new Request("http://localhost:3400/api/cron/daily", { headers: { authorization: "Bearer cron-test" } }));
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), ...body } })).then(json);
afterEach(() => setStripeForTests(null));

/** A test with a booked call for Ana; heldAgo moves the call into the past (held). */
async function withCall(over: Record<string, unknown> = {}, heldAgo = false) {
  const s = await setup(over);
  const j = await joined(s.testId);
  await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 48);
  const slots = [{ id: "" }, { id: "" }];
  const call = await db.call.findFirstOrThrow({ where: { contractId: j.sessionId } });
  if (heldAgo) await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 3_600_000) } });
  return { ...s, ...j, call, slots };
}

describe("latest batch rules", () => {
  it("cancelled-call lines, call reference, call length, declined line, email settings", () => {
    const d = new Date(2026, 10, 5, 15, 0);
    expect(R.callCancelledLine(d, "paused")).toBe("Your call on Thu, Nov 5 was cancelled because the test is paused.");
    expect(R.callCancelledLine(d, "stopped")).toBe("Your call on Thu, Nov 5 was cancelled because the test was stopped.");
    expect(R.callReference(4000, 25)).toEqual({ cents: 1667, text: "Listing: $40/h × 25 min = $16.67" });
    expect(R.callReference(null, 25)).toEqual({ cents: null, text: "Not in the listing" });
    expect(R.checkActualMinutes(25, 30).ok).toBe(true);
    expect(R.checkActualMinutes(91, 30).ok).toBe(false);
    expect(R.declinedLine("Ana Silva", 1667, "live call")).toBe("Your card was declined, so Ana Silva wasn't paid $16.67 for the call. Update your card in Payments, then press Pay again.");
    expect(R.emailDecision("each", false)).toBe("send");
    expect(R.emailDecision("daily", false)).toBe("summary");
    expect(R.emailDecision("none", false)).toBe("skip");
    expect(R.emailDecision("none", true)).toBe("send"); // receipts always
  });

  it("no 'mark' wording anywhere in the app", () => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const hits = walk(path.resolve(__dirname, "../src")).filter((f) => /no mark|counts against|extra work|Extra \(not|flag it/i.test(fs.readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});

describe("email settings and the bell", () => {
  it("'Don't email me' still fills the bell; receipts always send; 'One daily summary' gets one email from the daily job", async () => {
    const { dev, testId } = await setup();
    await db.user.update({ where: { id: dev.user.id }, data: { emailPref: "none" } });
    const { tester, sessionId } = await joined(testId);
    expect(await db.outboxEmail.count({ where: { to: dev.user.email, subject: { contains: "joined" } } })).toBe(0);
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { contains: "joined" } } })).toBe(1);
    await db.user.update({ where: { id: tester.user.id }, data: { emailPref: "daily" } });
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await db.user.update({ where: { id: tester.user.id }, data: { emailPref: "none" } });
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(await db.outboxEmail.count({ where: { to: tester.user.email, subject: { contains: "You were paid" } } })).toBe(1); // receipt
    await db.user.update({ where: { id: dev.user.id }, data: { emailPref: "daily" } });
    await cron();
    const summary = await db.outboxEmail.findFirstOrThrow({ where: { to: dev.user.email, subject: { startsWith: "Your Playtest summary" } } });
    expect(summary.text).toContain("Ana Silva joined");
  });

  it("Open until heads-ups are bell notifications only", async () => {
    const { testId } = await setup();
    const { tester } = await joined(testId);
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() + 2 * DAY) } });
    await cron();
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "closes on" } } })).toBe(1);
    expect(await db.outboxEmail.count({ where: { to: tester.user.email, subject: { contains: "closes on" } } })).toBe(0);
  });

  it("the admin gets one daily digest listing the cases; no per-event admin emails", async () => {
    const before = await db.outboxEmail.count({ where: { to: "owner@playtest.test" } });
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await pay(dev.cookie, { kind: "submission", id: sub.id, action: "reject", reason: "Not what we asked" });
    await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question" });
    expect(await db.outboxEmail.count({ where: { to: "owner@playtest.test" } })).toBe(before);
    await db.appState.deleteMany({ where: { key: "adminDigestAt" } });
    await cron();
    const daily = await db.outboxEmail.findFirstOrThrow({ where: { to: "owner@playtest.test", subject: { startsWith: "Playtest: " }, text: { contains: "I answered every question" } }, orderBy: { createdAt: "desc" } });
    expect(daily.text).toContain("New dispute: “I answered every question”");
    const n = await db.outboxEmail.count({ where: { to: "owner@playtest.test", text: { contains: "I answered every question" } } });
    await cron(); // not new any more: no second email about it
    expect(await db.outboxEmail.count({ where: { to: "owner@playtest.test", text: { contains: "I answered every question" } } })).toBe(n);
  });
});

describe("live calls blocked during holds and on stopped/closed tests", () => {
  it("a hold cancels only calls whose time comes during it (with the tester's line) and blocks offering and booking; length entry still works", async () => {
    const { dev, testId, tester, sessionId, call, slots } = await withCall();
    await startHold(dev.user.id, "unpaid");
    expect((await db.call.findUniqueOrThrow({ where: { id: call.id } })).status).toBe("booked");
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: new Date(Date.now() - 2 * 3_600_000) } });
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 60_000) } });
    const { sweepHeldCalls } = await import("@/lib/server/holds");
    await sweepHeldCalls(dev.user.id);
    expect((await db.call.findUniqueOrThrow({ where: { id: call.id } })).status).toBe("cancelled");
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "was cancelled because the test is paused." } } })).toBe(1);
    expect((await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], startsAt: inHours(150) })).body.error.message).toBe("Pay what you owe first.");
    expect((await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), confirmed: true, startsAt: inHours(150) })).body.error.message).toBe("This test is paused. Payment for your work may be delayed.");
    expect(slots).toHaveLength(2);
  });

  it("Stop the test and End early cancel that tester's booked calls with the exact line", async () => {
    const a = await withCall();
    await act(a.testId, "stop", a.dev.cookie, { seenAt: seen(), confirmed: true });
    expect(await db.notification.count({ where: { userId: a.tester.user.id, text: { contains: "was cancelled because the test was stopped." } } })).toBe(1);
    const b = await withCall();
    await act(b.testId, "end-early", b.dev.cookie, { seenAt: seen(), confirmed: true, contractId: b.sessionId, reason: "We have enough" });
    expect((await db.call.findUniqueOrThrow({ where: { id: b.call.id } })).status).toBe("cancelled");
  });

  it("a closed test (next round) blocks offering and booking and cancels booked calls", async () => {
    const { dev, testId, tester, sessionId, call, slots } = await withCall();
    await act(testId, "next-round", dev.cookie, { seenAt: seen(), confirmed: true, closeThis: true });
    expect((await db.call.findUniqueOrThrow({ where: { id: call.id } })).status).toBe("cancelled");
    expect((await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], startsAt: inHours(150) })).body.error.message).toBe("This test isn't open.");
    expect((await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), confirmed: true, startsAt: inHours(150) })).status).toBe(409);
  });
});

describe("call length and payment problems on a call", () => {
  it("'How long was the call?' sets the Pay box reference (rate × entered minutes)", async () => {
    const { dev, testId, call } = await withCall({}, true);
    expect((await act(testId, "call-length", dev.cookie, { callId: call.id, minutes: 25 })).status).toBe(200);
    expect((await pay(dev.cookie, { kind: "call", id: call.id, amount: "10.00", tickedCents: 1000 })).body.error.message).toContain("listing's $12.50");
    expect((await pay(dev.cookie, { kind: "call", id: call.id, amount: "12.50", tickedCents: 1250 })).status).toBe(200);
    expect((await act(testId, "call-length", dev.cookie, { callId: call.id, minutes: 30 })).body.error.message).toBe("This call was already paid, so its length can't change.");
  });

  it("a declined Pay shows the exact line; a chargeback on the call payment reads 'live call'", async () => {
    const { dev, testId, call, tester } = await withCall({}, true);
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    await db.user.update({ where: { id: tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID(), payoutsReady: true } });
    let decline = true;
    setStripeForTests({
      paymentIntents: { create: async () => { if (decline) throw new Error("declined"); return { id: "pi_" + randomUUID(), status: "succeeded" }; } },
      webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
    } as unknown as Stripe);
    const r = await pay(dev.cookie, { kind: "call", id: call.id, amount: "15.00", tickedCents: 1500 });
    expect(r.body.error.message).toMatch(/^Your card was declined, so Ana Silva wasn't paid \$15\.00 for the call yet\. It's now owed: /);
    decline = false;
    const { payOwed: payNow } = await import("@/lib/server/holds");
    expect((await payNow(dev.user)).paid).toBe(1);
    const p = await db.payment.findFirstOrThrow({ where: { callId: call.id, status: "charged" } });
    const { chargebackOpened } = await import("@/lib/server/holds");
    await chargebackOpened(p.stripePaymentIntentId!);
    expect(await db.testEvent.count({ where: { testId, kind: "chargeback", text: "Your bank reversed your $15.00 payment for Ana Silva's live call" } })).toBe(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).not.toBeNull();
    const { payOwed, resolveChargeback } = await import("@/lib/server/holds");
    expect(await payOwed(dev.user)).toEqual({ paid: 0, stillFailing: [], lifted: false }); // chargebacks can't be retried
    await resolveChargeback(p.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).toBeNull();
  });
});

describe("leaving", () => {
  it("testers can leave any time, even during a hold; sent work stays payable", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    await startHold(dev.user.id, "unpaid");
    expect((await sact(sessionId, "leave", tester.cookie)).status).toBe(200);
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: null } });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, confirmed: true })).status).toBe(200);
    expect(makeUser).toBeDefined();
  });
});

describe("newest owner rules", () => {
  it("rules: ask, pay start, auto-pay, cancel reason and line, heads-up line, summaries, failed lines", () => {
    expect(R.payStart(1000, 1200)).toBe(1200);
    expect(R.payStart(1000, null)).toBe(1000);
    expect(R.payStart(null, null)).toBeNull();
    expect(R.autoPayFor(1000, 600)).toBe(600);
    expect(R.autoPayFor(1000, 1500)).toBe(1000);
    expect(R.autoPayFor(null, 500)).toBeNull();
    expect(R.checkAsk(-5).ok).toBe(false);
    const now = new Date(2026, 10, 4, 15, 0);
    const call = new Date(2026, 10, 5, 15, 0);
    expect(R.checkCancel(new Date(now.getTime() + 20 * 3_600_000), now, "").ok).toBe(false);
    expect(R.checkCancel(new Date(now.getTime() + 30 * 3_600_000), now, "").ok).toBe(true);
    expect(R.cancelLine("Ben Carter", call, "car trouble")).toBe("Ben Carter cancelled the call on Thu, Nov 5 at 3:00 PM: car trouble");
    expect(R.closesInLine("Harbor Run", new Date(now.getTime() + (2 * 24 + 4) * 3_600_000), now)).toBe("⏱ Harbor Run closes in 2 days 4 hours: send your work before then.");
    expect(R.closesInLine("Harbor Run", new Date(now.getTime() + 5 * 3_600_000), now)).toBe("⏱ Harbor Run closes in 5 hours: send your work before then.");
    expect(R.emailDecision("weekly", false)).toBe("summary");
    expect(R.emailDecision("off", false)).toBe("skip");
    expect(R.summaryDue("weekly", new Date(now.getTime() - 3 * DAY), now)).toBe(false);
    expect(R.summaryDue("weekly", new Date(now.getTime() - 7 * DAY), now)).toBe(true);
    expect(R.summaryDue("monthly", null, now)).toBe(true);
    expect(R.failedLine("Ana Silva's written answers", 800, new Date(2026, 9, 20))).toBe("Ana Silva's written answers $8.00 · card declined Oct 20");
  });

  it("asked amounts are stored on written answers and call requests (rate asks)", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], ask: "12.00" });
    expect((await db.submission.findFirstOrThrow({ where: { contractId: sessionId } })).askedCents).toBe(1200);
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], ask: "abc" })).status).toBe(400);
    await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), confirmed: true, startsAt: inHours(48), ask: "20" });
    expect((await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId } })).askRateCents).toBe(2000);
    expect(dev).toBeTruthy();
  });

  it("several failed payments: one press retries them all; the hold lifts only when all are paid; the rest are named", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    const mk = (amountCents: number) => db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(Date.now() - 1000) } });
    await mk(800);
    await mk(2000);
    await startHold(dev.user.id, "unpaid");
    setStripeForTests({ paymentIntents: { create: async (p: { amount: number }) => { if (p.amount === 2000) throw new Error("declined"); return { id: "pi_" + randomUUID(), status: "succeeded" }; } } } as unknown as Stripe);
    const { payOwed, owedLines } = await import("@/lib/server/holds");
    expect((await owedLines(dev.user.id)).map((l) => l.text)).toEqual(expect.arrayContaining([expect.stringMatching(/^Ana Silva's written answers \$8\.00 · card declined /), expect.stringMatching(/\$20\.00 · card declined /)]));
    const r = await payOwed(dev.user);
    expect(r).toMatchObject({ paid: 1, lifted: false });
    expect(r.stillFailing).toHaveLength(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).not.toBeNull();
    setStripeForTests({ paymentIntents: { create: async () => ({ id: "pi_" + randomUUID(), status: "succeeded" }) } } as unknown as Stripe);
    expect(await payOwed(dev.user)).toMatchObject({ paid: 1, lifted: true });
  });
});

describe("Pay what you owe stops once when the total changed", () => {
  it("first press stops with the new total; the second pays at once; failures are named with the card's reason", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    const mk = (amountCents: number) => db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(Date.now() - 1000) } });
    const seenOne = await mk(800);
    await startHold(dev.user.id, "unpaid");
    await mk(500); // another failure after the page loaded
    const { POST: owedPOST } = await import("@/app/api/payments/owed/route");
    const press = (body: Record<string, unknown>) => owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body })).then(json);
    const first = await press({ seenTotalCents: 800, seenIds: [seenOne.id] });
    expect(first.status).toBe(409);
    expect(first.body.error.changes[0].text).toBe("Another payment failed meanwhile: Ana Silva's written answers $5.00. New total $13.00. Press again to pay $13.00.");
    setStripeForTests({ paymentIntents: { create: async (p: { amount: number }) => { if (p.amount === 500) throw new Error("Your card has insufficient funds."); return { id: "pi_" + randomUUID(), status: "succeeded" }; } } } as unknown as Stripe);
    const second = await press({ seenTotalCents: 800, confirmed: true });
    expect(second.body.paid).toBe(1);
    expect(second.body.stillFailing[0]).toMatch(/\$5\.00 · card declined .+ \(Your card has insufficient funds\)$/);
    expect(second.body.lifted).toBe(false);
  });
});
