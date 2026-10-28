import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { VERIFY_FIRST, startHold } from "@/lib/server/holds";
import { approveChargebackHold, chargebackSteps, startCardVerification } from "@/lib/server/chargeback";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, req } from "./helpers";
import { joined, setup } from "./fixtures";

// Batch 16 section 41: a chargeback hold's steps in strict order: verify a card (3D Secure), then pay, then the team's Approve lifts it.
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
afterEach(() => setStripeForTests(null));

async function held(reason: "chargeback" | "unpaid") {
  const { dev, testId } = await setup();
  const { tester, sessionId } = await joined(testId);
  await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
  const row = await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 800, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
  await startHold(dev.user.id, reason);
  const press = (body: Record<string, unknown> = {}) => owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body: { seenTotalCents: 800, seenIds: [row.id], ...body } })).then(json);
  return { dev, press };
}
const fakeCharges = () => setStripeForTests({ paymentIntents: { create: async () => ({ id: "pi_" + randomUUID(), status: "succeeded" }) } } as unknown as Stripe);
const holdOf = async (id: string) => (await db.user.findUniqueOrThrow({ where: { id } })).holdStartedAt;

describe("chargeback hold: verify, then pay, then the team's Approve (section 41)", () => {
  it("pay before verifying: disabled on the page and refused on the server", async () => {
    const { dev, press } = await held("chargeback");
    fakeCharges();
    const r = await press();
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "verify_first", message: VERIFY_FIRST });
    expect(VERIFY_FIRST).toBe("Verify your card first.");
    expect(await db.payment.count({ where: { developerId: dev.user.id, status: "charged" } })).toBe(0);
    const box = src("components/OwedBox.tsx");
    expect(box).toContain("disabled={busy || verifyFirst}");
    expect(box).toContain("Verify your card first (step 1): then you can pay what you owe.");
    expect(src("app/app/payments/page.tsx")).toContain("verifyFirst={!!cbSteps && !cbSteps.cardVerified}");
  });

  it("verify then pay: the hold stays (step 2 ✓, 'Paid. Your tests stay paused until the team approves.'); the admin's Approve lifts it with 'Your tests are running again'", async () => {
    const { dev, press } = await held("chargeback");
    await startCardVerification(await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })); // simulated without Stripe
    fakeCharges();
    const r = await press();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ lifted: false });
    expect(await holdOf(dev.user.id)).not.toBeNull();
    expect(await chargebackSteps(dev.user.id)).toMatchObject({ cardVerified: true, owedPaid: true, approved: false });
    expect(src("app/app/payments/page.tsx")).toContain("Paid. Your tests stay paused until the team approves.");
    expect(await db.notification.count({ where: { userId: dev.user.id, text: "Your tests are running again" } })).toBe(0);
    expect((await approveChargebackHold(dev.user.id)).lifted).toBe(true);
    expect(await holdOf(dev.user.id)).toBeNull();
    expect(await db.notification.count({ where: { userId: dev.user.id, text: "Your tests are running again" } })).toBe(1);
  });

  it("a payment hold (not a chargeback) still lifts on paying, with no card check", async () => {
    const { dev, press } = await held("unpaid");
    fakeCharges();
    const r = await press();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ lifted: true });
    expect(await holdOf(dev.user.id)).toBeNull();
  });
});
