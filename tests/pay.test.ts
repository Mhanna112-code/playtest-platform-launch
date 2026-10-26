import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { act, joined, sact, seen, setup } from "./fixtures";

const later = () => new Promise((r) => setTimeout(r, 5));
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
    expect(await db.outboxEmail.count({ where: { subject: { contains: "You were paid" }, text: { contains: "you get $8.00" } } })).toBeGreaterThan(0);
  });

  it("refuses without the charged-now tick, or below the listing without a reason", async () => {
    const { dev, sub } = await sent();
    expect((await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00" })).body.error.message).toBe("Tick “charged now: $10.00” to pay.");
    expect((await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400 })).body.error.message).toContain("Say why");
    expect((await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Only half answered" })).status).toBe(200);
  });

  it("extra work: any amount, no reason; disputes are refused (final)", async () => {
    const { dev, sub, sessionId, tester } = await sent({ writtenCents: null, questions: [] });
    expect(sub.agreedCents).toBeNull();
    expect((await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "3.00", tickedCents: 300 })).status).toBe(200);
    const d = await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I think it was worth more" });
    expect(d.body.error.message).toContain("final");
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

  it("Pay and Reject are mutually exclusive: the second (other tab) is refused for good", async () => {
    const a = await sent();
    await payReq(a.dev.cookie, { kind: "submission", id: a.sub.id, amount: "8.00", tickedCents: 800, reason: "Short answers" });
    const r = await payReq(a.dev.cookie, { kind: "submission", id: a.sub.id, action: "reject", reason: "Not useful", confirmed: true });
    expect(r.body.error.message).toBe("You already paid $8.00 for this.");
    const b = await sent();
    await payReq(b.dev.cookie, { kind: "submission", id: b.sub.id, action: "reject", reason: "Not useful at all" });
    expect((await payReq(b.dev.cookie, { kind: "submission", id: b.sub.id, amount: "10.00", tickedCents: 1000, confirmed: true })).body.error.message).toBe("You already rejected this.");
  });

  it("reject: a reason is required, nothing is charged, and a contract part can be disputed once", async () => {
    const { dev, sub, sessionId, tester } = await sent();
    expect((await payReq(dev.cookie, { kind: "submission", id: sub.id, action: "reject" })).body.error.message).toContain("Say why");
    expect((await payReq(dev.cookie, { kind: "submission", id: sub.id, action: "reject", reason: "Didn't play the build" })).status).toBe(200);
    expect(await db.payment.count({ where: { submissionId: sub.id } })).toBe(0);
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
          if (fail) throw new Error("Your card was declined.");
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
    expect(calls[0]).toMatchObject({ amount: 1000, currency: "usd", off_session: true, confirm: true, application_fee_amount: 200, transfer_data: { destination: expect.stringMatching(/^acct_/) } });
    expect(await db.payment.findFirstOrThrow({ where: { submissionId: sub.id } })).toMatchObject({ status: "charged", transferStatus: "sent", stripePaymentIntentId: "pi_1" });
  });

  it("needs a card first; a declined Pay becomes owed (retry, 3-day cut-off); no second Pay on it", async () => {
    fake(true);
    const { dev, sub } = await sent();
    expect((await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).body.error.message).toBe("Add a card in Payments first, then press Pay again.");
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_1" } });
    const r = await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(r.status).toBe(402);
    expect(r.body.error.message).toMatch(/^Your card was declined, so Ana Silva wasn't paid \$10\.00 for the written answers yet\. It's now owed: we'll retry tomorrow, or pay it in Payments by .+ to avoid a pause\.$/);
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(1);
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: sub.id } });
    expect(p.status).toBe("failed");
    const days = (p.owedUntil!.getTime() - p.createdAt.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(3);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).toBeNull();
    // No second Pay on it: "Pay what you owe" covers it.
    expect((await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).body.error.message).toBe("This $10.00 is owed: pay it with “Pay what you owe” in Payments.");
  });

  it("a second failure while one is owed starts the hold at once", async () => {
    fake(true);
    const a = await sent();
    const b = await sent();
    for (const x of [a, b]) await db.user.update({ where: { id: x.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_1" } });
    // Same developer for both: move b's test to a's developer.
    const tb = await db.submission.findUniqueOrThrow({ where: { id: b.sub.id }, include: { contract: true } });
    await db.test.update({ where: { id: tb.contract.testId }, data: { developerId: a.dev.user.id } });
    expect((await payReq(a.dev.cookie, { kind: "submission", id: a.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(402);
    expect((await db.user.findUniqueOrThrow({ where: { id: a.dev.user.id } })).holdStartedAt).toBeNull();
    expect((await payReq(a.dev.cookie, { kind: "submission", id: b.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(402);
    expect((await db.user.findUniqueOrThrow({ where: { id: a.dev.user.id } })).holdStartedAt).not.toBeNull();
  });
});

describe("admin decides disputes", () => {
  it("can only raise pay (up to the listing); the extra is charged", async () => {
    const { dev, sub, sessionId, tester } = await sent();
    await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Half the answers were one word" });
    await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question fully" });
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
    const owner = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
    await db.user.update({ where: { id: owner.user.id }, data: { isAdmin: true } });
    expect((await admin("decide", tester.cookie, { id: d.id, total: "10.00" })).status).toBe(403);
    expect((await admin("decide", owner.cookie, { id: d.id, total: "3.00" })).body.error.message).toContain("can only raise pay");
    expect((await admin("decide", owner.cookie, { id: d.id, total: "11.00" })).body.error.message).toContain("At most");
    const r = await admin("decide", owner.cookie, { id: d.id, total: "10.00", note: "Answers were complete" });
    expect(r.body).toEqual({ extraCents: 600 });
    expect(await db.payment.findFirstOrThrow({ where: { disputeId: d.id } })).toMatchObject({ kind: "dispute", amountCents: 600, testerCents: 480 });
    expect((await admin("decide", owner.cookie, { id: d.id, total: "10.00" })).body.error.message).toMatch(/^This dispute was already decided by .+ at .+.$/);
  });
  it("(Item 28) MAX = the listing minus what was already paid for that part on other pieces; MIN = this piece's pay; blank keeps the pay", async () => {
    const { dev, sub, sessionId, tester } = await sent();
    // The listing is $10; $5 was already paid for this part on another piece; this piece was rejected.
    await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 500, feeCents: 100, testerCents: 400, status: "charged" } });
    await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "0", tickedCents: 0, reason: "Nothing usable" });
    await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I did answer everything fully" });
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
    const owner = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
    await db.user.update({ where: { id: owner.user.id }, data: { isAdmin: true } });
    const { disputeBounds } = await import("@/lib/server/payments");
    expect(await disputeBounds(d)).toMatchObject({ min: 0, max: 500, other: 500, listing: 1000 });
    const over = await admin("decide", owner.cookie, { id: d.id, total: "6.00" });
    expect(over.body.error.message).toBe("At most $5.00: the listing's $10.00 minus the $5.00 already paid for this part.");
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
  it("can still Pay; everything else (Reject, invite, Edit, chat, next round, calls) is refused with the paused line", async () => {
    const { dev, sub, sessionId, testId, tester } = await sent();
    await db.user.update({ where: { id: dev.user.id }, data: { suspendedAt: new Date() } });
    const LINE = "Your account is paused: you can still pay for work testers sent and cancel booked calls.";
    expect((await payReq(dev.cookie, { action: "reject", kind: "submission", id: sub.id, amount: "0", reason: "Nothing usable here" })).body.error.message).toBe(LINE);
    expect((await act(testId, "next-round", dev.cookie, { seenAt: seen(), confirmed: true })).body.error.message).toBe(LINE);
    expect((await act(testId, "message", dev.cookie, { contractId: sessionId, body: "hi" })).body.error.message).toBe(LINE);
    expect((await act(testId, "end-early", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], reason: "We have enough" })).body.error.message).toBe(LINE);
    expect((await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [tester.user.id] })).body.error.message).toBe(LINE);
    // Pay goes through.
    expect((await payReq(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    // A tester never reads "suspended".
    await db.user.update({ where: { id: tester.user.id }, data: { suspendedAt: new Date() } });
    expect((await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), startsAt: new Date(Date.now() + 72 * 3_600_000).toISOString() })).body.error.message).not.toMatch(/suspend/i);
  });
});
