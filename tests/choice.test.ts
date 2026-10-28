import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import { startHold } from "@/lib/server/holds";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, req } from "./helpers";
import { joined, sact, seen, setup } from "./fixtures";

const cron = () => cronGET(new Request("http://localhost:3400/api/cron/daily", { headers: { authorization: "Bearer cron-test" } })).then((r) => r.json());
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), ...body } })).then(json);
const later = () => new Promise((r) => setTimeout(r, 30));
afterEach(() => setStripeForTests(null));

async function waiting14() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000) } });
  // (Owner, Oct 26) Charge opens only when 14 days have passed AND the test's Open until has passed.
  await db.test.update({ where: { id: s.testId }, data: { openUntil: new Date(Date.now() - 1000) } }); await db.contract.updateMany({ where: { testId: s.testId }, data: { dueAt: new Date(Date.now() - 1000) } }); // (batch 15 section 18: the tester's own deadline)
  return { ...s, ...j, sub };
}

describe("Charge / Let it go at day 14", () => {
  it("offers the tester the choice (bell + email), then they charge the listing amount", async () => {
    const { tester, sessionId, sub, dev } = await waiting14();
    await cron();
    const line = "Nora Lane didn't review your written answers in 7 days: charge $10.00 or let it go";
    expect(await db.notification.count({ where: { userId: tester.user.id, text: line } })).toBe(1);
    // (Owner, Oct 26) One email lists everything new: the daily job's summary carries the line.
    expect((await db.outboxEmail.findFirstOrThrow({ where: { to: tester.user.email, subject: { startsWith: "Your Playtest summary" } } })).text).toContain(line);
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge" })).body.error.message).toBe("Tick “charge Nora Lane $10.00 now” to charge.");
    const r = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", tickedCents: 1000 });
    expect(r.body).toMatchObject({ choice: "charge", amountCents: 1000 });
    // (Owner, Oct 27) A receipt follows the setting like any payment line: the daily job's email carries it (at most once).
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { startsWith: "Receipt: you paid $10.00" }, payment: true } })).toBe(1);
    // The developer's Pay is now final, naming the tester's choice.
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, confirmed: true })).body.error.message).toBe("Ana Silva already charged $10.00 for this.");
  });

  it("refused for good once the developer paid meanwhile", async () => {
    const { tester, sessionId, sub, dev } = await waiting14();
    await cron();
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "8.00", tickedCents: 800, reason: "Fair for two short answers", confirmed: true });
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge" })).body.error.message).toBe("Nora Lane paid $8.00 for this meanwhile.");
  });

  it("let it go closes it with nothing charged", async () => {
    const { tester, sessionId, sub, dev } = await waiting14();
    await cron();
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "letgo" })).status).toBe(200);
    expect(await db.payment.count({ where: { submissionId: sub.id } })).toBe(0);
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, confirmed: true })).body.error.message).toBe("Ana Silva let this go: nothing was charged.");
  });

  it("the developer can still Pay until the tester chooses; the offer is a stop-once reason", async () => {
    const { dev, sub, testId } = await waiting14();
    const pageLoaded = seen();
    await later();
    await cron();
    const first = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, seenAt: pageLoaded });
    expect(first.body.error.changes.map((c: { text: string }) => c.text)).toContain("Ana Silva can now charge or let go of their written answers");
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, seenAt: pageLoaded, confirmed: true })).status).toBe(200);
    expect(testId).toBeTruthy();
  });

  it("reminders every 3 days and never an automatic charge; (batch 6) during a hold a Charge is added to what is owed", async () => {
    const { tester, sessionId, sub, dev } = await waiting14();
    await cron();
    await db.submission.update({ where: { id: sub.id }, data: { remindedAt: new Date(Date.now() - 3 * 86_400_000) } });
    await cron();
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { startsWith: "Reminder: Nora Lane didn't review" } } })).toBe(1);
    await startHold(dev.user.id, "unpaid");
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge" })).body.error.message).toBe("Tick “charge Nora Lane $10.00 now” to charge.");
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: null } });
    await db.submission.update({ where: { id: sub.id }, data: { choiceBy: new Date(Date.now() - 30 * 86_400_000) } });
    await cron();
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0); // never charged automatically
  });
});

describe("(batch 11 section 4) the daily retries of what is owed during a hold", () => {
  it("the daily job retries what is owed on the saved card (the failed payment, and an open chargeback with its fee) and tells both sides", async () => {
    const { dev, sessionId, tester } = await waiting14();
    const cus = "cus_" + randomUUID();
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: cus, stripePaymentMethodId: "pm_x" } });
    const p = await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 900, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(Date.now() + 2 * 86_400_000) } });
    await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 700, feeCents: 140, testerCents: 560, status: "charged", chargeback: "open", stripePaymentIntentId: "pi_" + randomUUID() } });
    await startHold(dev.user.id, "unpaid");
    let calls = 0;
    setStripeForTests({ paymentIntents: { create: async (x: { customer?: string }) => { if (x.customer === cus) calls++; return { id: "pi_" + randomUUID(), status: "succeeded" }; } } } as unknown as Stripe);
    await cron();
    expect(calls).toBe(2);
    expect(await db.notification.count({ where: { userId: dev.user.id, text: "We charged your card $31.00 for what you owed." } })).toBe(1);
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "charged" });
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { startsWith: "Receipt: you paid $9.00" }, payment: true } })).toBe(1);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { endsWith: "paid $9.00 for your written answers" }, groupKey: "tarrived" } })).toBe(1);
    // The chargeback is repaid too (to the platform: the tester keeps their share), but the hold stays on until the admin resolves it.
    expect(await db.payment.findFirstOrThrow({ where: { developerId: dev.user.id, kind: "chargeback" } })).toMatchObject({ amountCents: 2200, testerCents: 0, status: "charged" });
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).not.toBeNull();
  });
});

describe("charge amount and a second failure", () => {
  it("charge cap = listing minus what's already been paid for that part (no Ask $)", async () => {
    const R = await import("@/lib/rules");
    expect(R.chargeAmount(1000, 0)).toBe(1000);
    expect(R.chargeAmount(1000, 400)).toBe(600);
    expect(R.chargeAmount(1000, 1000)).toBe(0); // paid in full: no Charge / Let it go at all
    expect(R.chargeAmount(700, 1200)).toBe(0); // paid more than the listing: nothing left to charge
    expect(R.chargeAmount(null, 0)).toBe(0); // not in the contract
  });

  it("(batch 6) while a failed payment is owed, the tester's Charge still goes through (a decline: 'delayed', never 'failed'), and the developer's Pay waits", async () => {
    const { tester, sessionId, sub, dev } = await waiting14();
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 500, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(Date.now() + 2 * 86_400_000) } });
    setStripeForTests({ paymentIntents: { create: async () => { throw Object.assign(new Error("declined"), { type: "StripeCardError" }); } } } as unknown as Stripe); // the daily retry is declined too
    await cron();
    const c = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", tickedCents: 1000 });
    expect(c.status).toBe(200);
    expect(c.body.status).toBe("failed"); // declined: owed, and the hold starts
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "may be delayed" } } })).toBeGreaterThan(0);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "failed" } } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).not.toBeNull();
  });

  it("paid in full: no Charge choice, notice or reminders; the developer can still Pay ($0 with a reason)", async () => {
    const { tester, sessionId, sub, dev } = await waiting14();
    await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 1000, feeCents: 200, testerCents: 800, status: "charged" } });
    await cron();
    await db.submission.update({ where: { id: sub.id }, data: { remindedAt: new Date(Date.now() - 4 * 86_400_000) } });
    await cron();
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).choiceOfferedAt).toBeNull();
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "didn't review" } } })).toBe(0);
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "letgo" })).status).toBe(409);
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "0", reason: "Not needed any more", confirmed: true })).status).toBe(200);
  });

  it("Charge any amount up to the cap; above the cap refused; the tick names the typed amount", async () => {
    const { tester, sessionId, sub } = await waiting14();
    await cron();
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", amount: "12.00", tickedCents: 1200 })).body.error.message).toBe("At most $10.00.");
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", amount: "6.00", tickedCents: 1000 })).body.error.message).toBe("Tick “charge Nora Lane $6.00 now” to charge.");
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", amount: "6.00", tickedCents: 600 })).body).toMatchObject({ amountCents: 600 });
  });
});
