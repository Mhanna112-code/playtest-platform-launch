import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { POST as verifyPOST } from "@/app/api/payments/verify-card/route";
import { GET as verifyDone } from "@/app/api/payments/verify-card/done/route";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { approveChargebackHold, chargebackHolds, chargebackSteps, finishCardVerification, startCardVerification } from "@/lib/server/chargeback";
import { chargebackOpened, startHold } from "@/lib/server/holds";
import { setStripeForTests } from "@/lib/server/stripe";
import { stepsLine } from "@/lib/pause";
import { json, makeUser, req } from "./helpers";
import { joined, sact, setup } from "./fixtures";

afterEach(() => setStripeForTests(null));

const admin = async () => {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
};
const approve = (cookie: string, id: string) => adminPOST(req("/api/admin/approve-chargeback", { cookie, body: { id } }), { params: Promise.resolve({ action: "approve-chargeback" }) }).then(json);
const holdOf = (id: string) => db.user.findUniqueOrThrow({ where: { id } });

/** A developer with a paid piece and an open chargeback on it (so on a chargeback hold), and a working tester. */
async function chargedBack() {
  const { dev, testId } = await setup();
  const { tester, sessionId } = await joined(testId);
  await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
  const pi = "pi_" + randomUUID();
  const paid = await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 800, feeCents: 160, testerCents: 640, status: "charged", stripePaymentIntentId: pi } });
  expect(await chargebackOpened(pi)).toBe(true);
  return { dev, tester, testId, sessionId, sub, paid };
}

describe("a chargeback is a hold with extra steps", () => {
  it("starts a hold whose banner lists the steps; paying alone never lifts it", async () => {
    const { dev, sessionId, tester } = await chargedBack();
    expect(await holdOf(dev.user.id)).toMatchObject({ holdReason: "chargeback" });
    let steps = (await chargebackSteps(dev.user.id))!;
    // (Owner, Oct 27) The chargeback adds its amount to what is owed.
    // (Batch 11) With the $15 chargeback fee.
    expect(steps).toMatchObject({ cardVerified: false, owedPaid: false, owedCents: 2300, approved: false });
    expect(stepsLine(steps.remaining)).toBe("Still to do: verify a card with 3D Secure, then pay what you owe ($23.00), then wait for the team's approval.");
    // Something owed on top: a failed payment. Paying it does not lift the hold.
    await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 900, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(Date.now() + 86_400_000) } });
    steps = (await chargebackSteps(dev.user.id))!;
    expect(stepsLine(steps.remaining)).toBe("Still to do: verify a card with 3D Secure, then pay what you owe ($32.00), then wait for the team's approval.");
    // (Batch 16 section 41) Before the card is verified, Pay what you owe is refused.
    expect((await json(await owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body: {} })))).body.error.message).toBe("Verify your card first.");
    await db.user.update({ where: { id: dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } }); // (batch 16 section 41) step 1 first: Pay what you owe waits for the verified card
    const paid = await json(await owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body: {} })));
    expect(paid.status).toBe(200);
    expect(paid.body.lifted).toBe(false);
    expect(await holdOf(dev.user.id)).toMatchObject({ holdReason: "chargeback" });
    expect((await holdOf(dev.user.id)).holdStartedAt).not.toBeNull();
    steps = (await chargebackSteps(dev.user.id))!;
    expect(steps.owedPaid).toBe(true);
    expect(stepsLine(steps.remaining)).toBe("Still to do: wait for the team's approval.");
  });

  it("the admin sees 'card verified / owed paid' and Approve; approving needs both, then lifts the hold and tests resume", async () => {
    const { dev, tester, sessionId, testId, paid } = await chargedBack();
    const a = await admin();
    const owedRow = await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 500, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(Date.now() + 86_400_000) } });
    // Neither step done.
    let list = await chargebackHolds();
    let row = list.find((x) => x.dev.id === dev.user.id)!;
    expect(row.steps).toMatchObject({ cardVerified: false, owedPaid: false, owedCents: 2800 }); // the failed $5.00 plus the reversed $8.00 and its $15 fee (batch 11)
    expect(row.chargebacks.map((p) => p.id)).toEqual([paid.id]);
    expect((await approve(a.cookie, dev.user.id)).body.error).toMatchObject({ code: "steps_missing", message: "Not yet: the card isn't verified, and $28.00 is owed but $0.00 is reserved." });
    // The card is verified (simulated without Stripe): still owed.
    expect((await json(await verifyPOST(req("/api/payments/verify-card", { cookie: dev.cookie, body: {} })))).body).toEqual({ simulated: true, verified: true });
    expect((await approve(a.cookie, dev.user.id)).body.error.message).toBe("Not yet: $28.00 is owed but $0.00 is reserved.");
    // (Batch 23 section 6) Pay what is owed reserves it (the failed payment and the reversed one): still on hold, nothing taken until the team approves.
    expect((await json(await owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body: {} })))).body).toMatchObject({ paid: 0, stillFailing: [], reservedCents: 2800 });
    expect((await db.payment.findUniqueOrThrow({ where: { id: owedRow.id } })).settledAt).toBeNull();
    list = await chargebackHolds();
    row = list.find((x) => x.dev.id === dev.user.id)!;
    expect(row.steps).toMatchObject({ cardVerified: true, owedPaid: true, approved: false });
    expect((await holdOf(dev.user.id)).holdStartedAt).not.toBeNull();
    // Only an admin can approve.
    expect((await approve(dev.cookie, dev.user.id)).status).toBe(403);
    const r = await approve(a.cookie, dev.user.id);
    expect(r.status).toBe(200);
    expect(r.body.lifted).toBe(true);
    expect((await db.payment.findUniqueOrThrow({ where: { id: owedRow.id } })).settledAt).not.toBeNull(); // taken on Approve
    expect(await holdOf(dev.user.id)).toMatchObject({ holdStartedAt: null, holdReason: "", chargebackCardVerifiedAt: null, chargebackApprovedAt: null });
    expect((await db.payment.findUniqueOrThrow({ where: { id: paid.id } })).chargeback).toBe("resolved");
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("working");
    expect(await db.testEvent.count({ where: { testId, kind: "resumed" } })).toBeGreaterThan(0);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "is running again" } } })).toBe(1);
    // Nothing left to approve.
    expect((await approve(a.cookie, dev.user.id)).body.error.code).toBe("no_chargeback_hold");
  });

  it("a verification from before a newer chargeback no longer counts", async () => {
    const { dev, sessionId, tester } = await chargedBack();
    await startCardVerification(dev.user);
    expect((await chargebackSteps(dev.user.id))!.cardVerified).toBe(true);
    const sub2 = await db.submission.create({ data: { contractId: sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
    const pi = "pi_" + randomUUID();
    await db.payment.create({ data: { kind: "review", submissionId: sub2.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 900, feeCents: 180, testerCents: 720, status: "charged", stripePaymentIntentId: pi } });
    await chargebackOpened(pi);
    expect((await chargebackSteps(dev.user.id))!.cardVerified).toBe(false);
  });

  it("a hold that was already on becomes a chargeback hold when one opens; an ordinary hold is lifted by paying alone", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await startHold(dev.user.id, "unpaid");
    expect(await chargebackSteps(dev.user.id)).toBeNull();
    const pi = "pi_" + randomUUID();
    await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 800, feeCents: 160, testerCents: 640, status: "charged", stripePaymentIntentId: pi } });
    await chargebackOpened(pi);
    expect((await holdOf(dev.user.id)).holdReason).toBe("chargeback");
    expect(await chargebackSteps(dev.user.id)).not.toBeNull();
    // Not on a chargeback hold: nothing to verify.
    const other = await makeUser({ dev: true });
    await expect(startCardVerification(other.user)).rejects.toMatchObject({ code: "no_chargeback_hold" });
    expect(await approveChargebackHold(dev.user.id).catch((e) => e.code)).toBe("steps_missing");
  });
});

describe("the card check (Stripe SetupIntent with 3D Secure)", () => {
  function fakeStripe(over: { status?: string; tds?: string; metadataUser?: string; createdAt?: number } = {}, cus = "cus_" + randomUUID()) {
    const created: Record<string, unknown>[] = [];
    const updated: Record<string, unknown>[] = [];
    let id = "";
    const stripe = {
      customers: { create: async () => ({ id: cus }), update: async (c: string, p: Record<string, unknown>) => { updated.push({ c, ...p }); return {}; } },
      setupIntents: {
        create: async (p: Record<string, unknown>) => {
          created.push(p);
          id = "seti_" + randomUUID();
          return { id, client_secret: "secret_" + id };
        },
        retrieve: async () => ({
          id, status: over.status ?? "succeeded", customer: cus, payment_method: "pm_verified", created: over.createdAt ?? Math.floor(Date.now() / 1000),
          metadata: { userId: over.metadataUser ?? (created[0]?.metadata as { userId: string }).userId, purpose: "chargeback-verify" },
          latest_attempt: over.tds ? { payment_method_details: { card: { three_d_secure: { result: over.tds } } } } : null,
        }),
      },
    } as unknown as Stripe;
    return { stripe, created, updated, getId: () => id };
  }

  it("asks Stripe for 3D Secure on any card, and a succeeded, authenticated check verifies it and becomes the card on file", async () => {
    const { dev } = await chargedBack();
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_x";
    const f = fakeStripe({ tds: "authenticated" });
    setStripeForTests(f.stripe);
    const started = await json(await verifyPOST(req("/api/payments/verify-card", { cookie: dev.cookie, body: {} })));
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ simulated: false, publishableKey: "pk_test_x" });
    expect(started.body.clientSecret).toMatch(/^secret_seti_/);
    expect(f.created[0]).toMatchObject({ payment_method_options: { card: { request_three_d_secure: "any" } }, usage: "off_session" });
    expect((await chargebackSteps(dev.user.id))!.cardVerified).toBe(false); // not yet: Stripe has to confirm it
    // Stripe's card form returns here.
    const done = await verifyDone(req(`/api/payments/verify-card/done?setup_intent=${f.getId()}`, { cookie: dev.cookie }));
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toContain("/app/payments?saved=verified");
    expect((await chargebackSteps(dev.user.id))!.cardVerified).toBe(true);
    expect((await holdOf(dev.user.id)).stripePaymentMethodId).toBe("pm_verified");
    delete process.env.STRIPE_PUBLISHABLE_KEY;
  });

  it("refuses a check that did not succeed, was not authenticated, belongs to someone else or is older than the hold", async () => {
    const { dev } = await chargedBack();
    const cus = "cus_" + randomUUID();
    const run = async (over: Parameters<typeof fakeStripe>[0]) => {
      const f = fakeStripe(over, cus);
      setStripeForTests(f.stripe);
      await startCardVerification(await holdOf(dev.user.id));
      return finishCardVerification(dev.user.id, f.getId());
    };
    await expect(run({ status: "requires_action" })).rejects.toMatchObject({ code: "not_verified" });
    await expect(run({ tds: "failed" })).rejects.toMatchObject({ code: "not_verified" });
    await expect(run({ metadataUser: "someone-else" })).rejects.toMatchObject({ code: "bad_setup" });
    await expect(run({ createdAt: Math.floor(Date.now() / 1000) - 3 * 86_400 })).rejects.toMatchObject({ code: "old_setup" });
    expect((await chargebackSteps(dev.user.id))!.cardVerified).toBe(false);
    await expect(run({ tds: "authenticated" })).resolves.toEqual({ verified: true });
  });
});
