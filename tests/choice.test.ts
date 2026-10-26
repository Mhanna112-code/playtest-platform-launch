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
const later = () => new Promise((r) => setTimeout(r, 5));
afterEach(() => setStripeForTests(null));

async function waiting14(ask?: string) {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"], ...(ask ? { ask } : {}) });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000) } });
  return { ...s, ...j, sub };
}

describe("Charge / Let it go at day 14", () => {
  it("offers the tester the choice (bell + email), then they charge the lower of listing and asked", async () => {
    const { tester, sessionId, sub, dev } = await waiting14("8.00"); // asked lower than the $10.00 listing
    await cron();
    const line = "Nora Lane didn't review your written answers in 14 days: charge $8.00 or let it go";
    expect(await db.notification.count({ where: { userId: tester.user.id, text: line } })).toBe(1);
    expect(await db.outboxEmail.count({ where: { to: tester.user.email, subject: line } })).toBe(1);
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge" })).body.error.message).toBe("Tick “charge Nora Lane $8.00 now” to charge.");
    const r = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", tickedCents: 800 });
    expect(r.body).toMatchObject({ choice: "charge", amountCents: 800 });
    expect(await db.outboxEmail.count({ where: { to: dev.user.email, subject: { startsWith: "Receipt: you paid $8.00" } } })).toBe(1);
    // The developer's Pay is now final, naming the tester's choice.
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, confirmed: true })).body.error.message).toBe("Ana Silva already charged $8.00 for this.");
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

  it("reminders every 3 days and never an automatic charge; during a hold the choice waits", async () => {
    const { tester, sessionId, sub, dev } = await waiting14();
    await cron();
    await db.submission.update({ where: { id: sub.id }, data: { remindedAt: new Date(Date.now() - 3 * 86_400_000) } });
    await cron();
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { startsWith: "Reminder: Nora Lane didn't review" } } })).toBe(1);
    await startHold(dev.user.id, "unpaid");
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge" })).body.error.message).toBe("This test is paused right now. You can charge once it resumes.");
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: null } });
    await db.submission.update({ where: { id: sub.id }, data: { choiceBy: new Date(Date.now() - 30 * 86_400_000) } });
    await cron();
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0); // never charged automatically
  });
});

describe("daily retry of owed payments", () => {
  it("retries once a day; success sends a receipt, tells both sides and lifts the hold; chargebacks are never retried", async () => {
    const { dev, sessionId, tester } = await waiting14();
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    const p = await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 900, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(Date.now() - 1000) } });
    await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 700, feeCents: 140, testerCents: 560, status: "charged", chargeback: "open", stripePaymentIntentId: "pi_" + randomUUID() } });
    await startHold(dev.user.id, "unpaid");
    let calls = 0;
    setStripeForTests({ paymentIntents: { create: async () => { calls++; return { id: "pi_" + randomUUID(), status: "succeeded" }; } } } as unknown as Stripe);
    await cron();
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "charged" });
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(await db.outboxEmail.count({ where: { to: dev.user.email, subject: { startsWith: "Receipt: you paid $9.00" } } })).toBe(1);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { endsWith: "paid $9.00 for your written answers" } } })).toBe(1);
    // The open chargeback is never retried and keeps the hold until the admin resolves it.
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).not.toBeNull();
  });

  it("a declined retry waits a day before trying again", async () => {
    const { dev, sessionId, tester } = await waiting14();
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    const p = await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 900, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(Date.now() + 86_400_000) } });
    let calls = 0;
    setStripeForTests({ paymentIntents: { create: async (x: { metadata?: { payKey?: string } }) => { if (String(x.metadata?.payKey ?? "").startsWith("retry-")) calls++; throw new Error("declined"); } } } as unknown as Stripe);
    await cron();
    await cron();
    expect(calls).toBe(1);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).retriedAt).not.toBeNull();
  });
});

describe("charge amount and a second failure", () => {
  it("charge = lower of listing and asked minus what's already been paid for that part", async () => {
    const R = await import("@/lib/rules");
    expect(R.chargeAmount(1000, 800, 0)).toBe(800);
    expect(R.chargeAmount(1000, 1500, 400)).toBe(600);
    expect(R.chargeAmount(1000, null, 1000)).toBe(0); // paid in full: no Charge / Let it go at all
    expect(R.chargeAmount(700, 200, 500)).toBe(200); // listing $7, paid $5, asked $2 → $2
    expect(R.chargeAmount(700, 500, 500)).toBe(200); // the ask is capped by what's left of the listing
  });

  it("a second failed payment while one is still owed starts the hold at once", async () => {
    const { tester, sessionId, sub, dev } = await waiting14();
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 500, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(Date.now() + 2 * 86_400_000), retriedAt: new Date() } });
    await cron();
    setStripeForTests({ paymentIntents: { create: async () => { throw new Error("declined"); } } } as unknown as Stripe);
    await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", tickedCents: 1000 });
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).not.toBeNull();
  });

  it("paid in full: no day-14 choice, notice or reminders; the developer can still Pay or Reject", async () => {
    const { tester, sessionId, sub, dev } = await waiting14();
    await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 1000, feeCents: 200, testerCents: 800, status: "charged" } });
    await cron();
    await db.submission.update({ where: { id: sub.id }, data: { remindedAt: new Date(Date.now() - 4 * 86_400_000) } });
    await cron();
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).choiceOfferedAt).toBeNull();
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "didn't review" } } })).toBe(0);
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "letgo" })).status).toBe(409);
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, action: "reject", reason: "Not needed any more", confirmed: true })).status).toBe(200);
  });

  it("Charge any amount up to the cap; above the cap refused; the tick names the typed amount", async () => {
    const { tester, sessionId, sub } = await waiting14();
    await cron();
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", amount: "12.00", tickedCents: 1200 })).body.error.message).toBe("At most $10.00.");
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", amount: "6.00", tickedCents: 1000 })).body.error.message).toBe("Tick “charge Nora Lane $6.00 now” to charge.");
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", amount: "6.00", tickedCents: 600 })).body).toMatchObject({ amountCents: 600 });
  });
});
