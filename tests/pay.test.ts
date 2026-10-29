import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { act, joined, sact, seen, setup } from "./fixtures";

const later = () => new Promise((r) => setTimeout(r, 30));
const payReq = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), ...body } })).then(json);
const admin = (action: string, cookie: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);

async function sent(over: Record<string, unknown> = {}) {
  const s = await setup(over);
  const j = await joined(s.testId);
  const questions = ((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions as string[]).length || 1;
  await sact(j.sessionId, "written", j.tester.cookie, { answers: Array(questions).fill("answer") });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  await later();
  return { ...s, ...j, sub };
}

afterEach(() => setStripeForTests(null));

describe("the one Pay box", () => {
  it("pays the listing amount with the tick; without Stripe it's recorded as payments not set up", async () => {
    const { dev, sub, sessionId } = await sent();
    const r = await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ amountCents: 1000, status: "not_set_up", paidSoFarCents: 1000 });
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: sub.id } });
    expect(p).toMatchObject({ amountCents: 1000, feeCents: 200, testerCents: 800, status: "not_set_up", contractId: sessionId });
    expect(await db.notification.count({ where: { text: { contains: "paid you $10.00" }, payment: true } })).toBeGreaterThan(0);
  });

  it("refuses without the tick naming the amount (batch 9), or below the listing without a reason", async () => {
    const { dev, sub } = await sent();
    expect((await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00" })).body.error.message).toBe("Tick “I understand this payment of $10.00 can't be refunded and is charged now.” to pay.");
    expect((await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400 })).body.error.message).toContain("Say why");
    expect((await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Only half answered" })).status).toBe(200);
  });

  it("extra work: any amount, no reason; (batch 10) it can be disputed", async () => {
    const { dev, sub, sessionId, tester } = await sent({ writtenCents: null, questions: [] });
    expect(sub.agreedCents).toBeNull();
    expect((await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "3.00", tickedCents: 300 })).status).toBe(200);
    const d = await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I think it was worth more" });
    expect(d.status).toBe(200);
  });

  it("one charge per press: the same press again never pays twice", async () => {
    const { dev, sub } = await sent();
    const body = { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, payKey: randomUUID(), seenAt: seen() };
    const a = await reviewPOST(req("/api/review", { cookie: dev.cookie, body })).then(json);
    const b = await reviewPOST(req("/api/review", { cookie: dev.cookie, body })).then(json);
    expect(a.status).toBe(200);
    expect(b.body.repeated).toBe(true);
    expect(await db.payment.count({ where: { submissionId: sub.id } })).toBe(1);
  });

  it("one decision per piece: a second Pay (other tab) is refused for good; an old rejection stays final", async () => {
    const a = await sent();
    await payReq(a.dev.cookie, { kind: "submission", id: a.sub.id, amount: "8.00", tickedCents: 800, reason: "Short answers" });
    const r = await payReq(a.dev.cookie, { kind: "submission", id: a.sub.id, amount: "0", reason: "Not useful", confirmed: true });
    expect(r.body.error.message).toBe("You already paid $8.00 for this.");
    const b = await sent();
    // (Batch 15 section 30) Reject is gone; a rejection made before stays.
    await db.review.create({ data: { submissionId: b.sub.id, contractId: b.sessionId, amountCents: 0, agreedCents: 1000, reason: "Not useful at all", rejected: true, payKey: randomUUID() } });
    expect((await payReq(b.dev.cookie, { kind: "submission", id: b.sub.id, amount: "10.00", tickedCents: 1000, confirmed: true })).body.error.message).toBe("You already rejected this.");
    expect((await payReq(b.dev.cookie, { kind: "submission", id: b.sub.id, action: "reject", reason: "Again" })).body.error.code).toBe("no_reject");
  });

  it("$0: a reason is required, nothing is charged, and a contract part can be disputed once", async () => {
    const { dev, sub, sessionId, tester } = await sent();
    expect((await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "0" })).body.error.message).toContain("Say why");
    expect((await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "0", reason: "Didn't play the build" })).status).toBe(200);
    expect(await db.payment.count({ where: { submissionId: sub.id, status: { in: ["charged", "not_set_up"] }, amountCents: { gt: 0 } } })).toBe(0);
    expect((await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I played all three levels" })).status).toBe(200);
    expect((await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "Again please, I played it" })).body.error.message).toContain("once");
  });

  it("stops once for the shared developer reasons (here: another tester joined, a payment in another tab), then pays", async () => {
    const { dev, sub, testId } = await sent();
    const pageLoaded = seen();
    await later();
    await joined(testId, "Ben Carter", "he");
    const first = await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, seenAt: pageLoaded });
    expect(first.status).toBe(409);
    expect(first.body.error).toMatchObject({ code: "stop_once", paidSoFarCents: 0, message: "Press again to go ahead." });
    expect(first.body.error.changes.map((c: { text: string }) => c.text)).toEqual(["Ben Carter joined"]);
    const second = await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, seenAt: pageLoaded, confirmed: true });
    expect(second.status).toBe(200);
  });

  it("other developers can't pay for someone else's test", async () => {
    const { sub } = await sent();
    const other = await makeUser({ dev: true });
    expect((await payReq(other.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(404);
  });
});

describe("Stripe (test mode, faked)", () => {
  function fake(fail = false) {
    const calls: Record<string, unknown>[] = [];
    setStripeForTests({
      paymentIntents: {
        create: async (params: Record<string, unknown>, opts: Record<string, unknown>) => {
          calls.push({ ...params, idempotencyKey: opts.idempotencyKey });
          if (fail) throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError" });
          return { id: "pi_" + calls.length, status: "succeeded" };
        },
      },
    } as unknown as Stripe);
    return calls;
  }

  it("charges the developer's card once and sends the tester's share with the platform fee kept", async () => {
    const calls = fake();
    const { dev, sub, tester } = await sent();
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_1" } });
    await db.user.update({ where: { id: tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID(), payoutsReady: true } });
    const r = await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(r.body.status).toBe("charged");
    expect(calls).toHaveLength(1);
    // (Batch 11) The developer's own press is on-session (the bank may ask them to confirm in the page).
    expect(calls[0]).not.toHaveProperty("off_session");
    expect(calls[0]).toMatchObject({ amount: 1000, currency: "usd", allowed_payment_method_types: ["card", "link"], confirm: true, application_fee_amount: 200, transfer_data: { destination: expect.stringMatching(/^acct_/) } });
    expect(await db.payment.findFirstOrThrow({ where: { submissionId: sub.id } })).toMatchObject({ status: "charged", transferStatus: "sent", stripePaymentIntentId: "pi_1" });
  });

  it("needs a card first; a declined Pay is owed and starts the payment hold at once; no second Pay on it", async () => {
    fake(true);
    const { dev, sub } = await sent();
    expect((await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).body.error.message).toBe("Add a card in Payments first, then press Pay again.");
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_1" } });
    const r = await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(r.status).toBe(402);
    expect(r.body.error.message).toBe("Your card was declined, so Ana Silva wasn't paid $10.00 for the written answers yet. Your tests are paused until you pay what you owe: open Payments.");
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(1);
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: sub.id } });
    expect(p.status).toBe("failed");
    expect(p.owedUntil).not.toBeNull(); // the "owed" marker (no cut-off any more)
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).not.toBeNull(); // (Owner, Oct 27) a hold at once
    // No second Pay on it: every Pay is unavailable during the hold, and "Pay what you owe" covers it.
    expect((await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).body.error.code).toBe("held");
  });

  it("a second Pay while one is owed is refused (the hold started with the first decline); $0 is refused too", async () => {
    fake(true);
    const a = await sent();
    const b = await sent();
    for (const x of [a, b]) await db.user.update({ where: { id: x.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_1" } });
    // Same developer for both: move b's test to a's developer.
    const tb = await db.submission.findUniqueOrThrow({ where: { id: b.sub.id }, include: { contract: true } });
    await db.test.update({ where: { id: tb.contract.testId }, data: { developerId: a.dev.user.id } });
    expect((await payReq(a.dev.cookie, { kind: "submission", id: a.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(402);
    expect((await db.user.findUniqueOrThrow({ where: { id: a.dev.user.id } })).holdStartedAt).not.toBeNull();
    await new Promise((r) => setTimeout(r, 40)); // the declined payment is older than the next press's page time
    // (Owner, Oct 27) While a failed payment is owed, Pay waits: the second press is refused (nothing new fails), and only Pay what you owe works.
    const second = await payReq(a.dev.cookie, { kind: "submission", id: b.sub.id, amount: "10.00", tickedCents: 1000 });
    expect(second.status).toBe(403);
    expect(second.body.error.code).toBe("held");
    expect((await payReq(a.dev.cookie, { amount: "0", kind: "submission", id: b.sub.id, reason: "Not what I asked for" })).body.error.code).toBe("held");
  });
});

describe("admin decides disputes", () => {
  it("can only raise pay (batch 28 §15: up to the piece's cap); the extra is charged", async () => {
    const { dev, sub, sessionId, tester } = await sent();
    await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Half the answers were one word" });
    await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question fully" });
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
    const owner = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
    await db.user.update({ where: { id: owner.user.id }, data: { isAdmin: true } });
    expect((await admin("decide", tester.cookie, { id: d.id, total: "10.00" })).status).toBe(403);
    expect((await admin("decide", owner.cookie, { id: d.id, total: "3.00" })).body.error.message).toContain("can only raise pay");
    expect((await admin("decide", owner.cookie, { id: d.id, total: "1010.01" })).body.error.message).toContain("At most");
    const r = await admin("decide", owner.cookie, { id: d.id, total: "10.00", note: "Answers were complete" });
    expect(r.body).toEqual({ extraCents: 600 });
    expect(await db.payment.findFirstOrThrow({ where: { disputeId: d.id } })).toMatchObject({ kind: "dispute", amountCents: 600, testerCents: 480 });
    expect((await admin("decide", owner.cookie, { id: d.id, total: "10.00" })).body.error.message).toMatch(/^.+ already decided this dispute at .+.$/); // (batch 15 section 21) named by email
  });
  it("(Batch 28 §15) MIN = what the piece was paid; MAX = its cap (batch 29 §38: the part's max in all); blank keeps the pay", async () => {
    const { dev, sub, sessionId, tester } = await sent();
    // The listing is $10; the piece was paid $0.
    await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "0", tickedCents: 0, reason: "Nothing usable" });
    await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I did answer everything fully" });
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
    const owner = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
    await db.user.update({ where: { id: owner.user.id }, data: { isAdmin: true } });
    const { disputeBounds } = await import("@/lib/server/payments");
    expect(await disputeBounds(d)).toMatchObject({ min: 0, max: 100_000 });
    const over = await admin("decide", owner.cookie, { id: d.id, total: "1000.01" });
    expect(over.body.error.message).toBe("At most $1,000.00: the most this piece can be paid.");
    expect(over.status).toBe(400);
    // Blank keeps the pay as it is (nothing charged).
    const kept = await admin("decide", owner.cookie, { id: d.id, total: "" });
    expect(kept.body).toEqual({ extraCents: 0 });
    expect((await db.dispute.findUniqueOrThrow({ where: { id: d.id } })).decidedCents).toBe(0);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "dispute" } } })).toBeGreaterThan(0);
  });
});

describe("(NEXT-UI 27) Payments: Waiting for your review", () => {
  it("lists the developer's tests with unreviewed parts, and drops them once paid", async () => {
    const { waitingForReview } = await import("@/lib/server/payments");
    const { dev, sub, testId } = await sent();
    const before = await waitingForReview(dev.user.id);
    expect(before.map((t) => t.id)).toEqual([testId]);
    expect(before[0].contracts[0].submissions.map((x) => x.id)).toEqual([sub.id]);
    await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(await waitingForReview(dev.user.id)).toEqual([]);
  });
});

describe("(NEXT-UI 26) a suspended developer", () => {
  it("cannot Pay, $0 included (it waits until the suspension is lifted); everything else (invite, Edit, chat, next round, calls) is refused with the suspended line", async () => {
    const { dev, sub, sessionId, testId, tester } = await sent();
    await db.user.update({ where: { id: dev.user.id }, data: { devSuspendedAt: new Date(), testerSuspendedAt: new Date() } });
    const LINE = "Your account is suspended: your tests are paused. Contact us in Settings to appeal.";
    expect((await payReq(dev.cookie, { amount: "0", kind: "submission", id: sub.id, reason: "Nothing usable here" })).body.error.message).toBe(LINE);
    expect((await act(testId, "next-round", dev.cookie, { seenAt: seen(), confirmed: true })).body.error.message).toBe(LINE);
    expect((await act(testId, "message", dev.cookie, { contractId: sessionId, body: "hi" })).body.error.message).toBe(LINE);
    expect((await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [tester.user.id] })).body.error.message).toBe(LINE);
    // Pay is refused too, and nothing is recorded: the piece still waits for review.
    const p = await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(p.status).toBe(403);
    expect(p.body.error).toMatchObject({ code: "suspended", message: LINE, failed: "Your Pay on Harbor Run didn't go through" });
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0);
    expect(await db.payment.count({ where: { submissionId: sub.id } })).toBe(0);
    // A tester never reads "suspended".
    await db.user.update({ where: { id: tester.user.id }, data: { devSuspendedAt: new Date(), testerSuspendedAt: new Date() } });
    expect((await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), startsAt: new Date(Date.now() + 72 * 3_600_000).toISOString() })).body.error.message).not.toMatch(/suspend/i);
  });
});
