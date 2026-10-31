import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as webhookPOST } from "@/app/api/stripe/webhook/route";
import { setStripeForTests } from "@/lib/server/stripe";
import { makeUser } from "./helpers";

beforeEach(() => { process.env.DISPUTE_WAIT_MS = "0"; });
beforeEach(() => setStripeForTests({ webhooks: { constructEvent: (raw: string) => JSON.parse(raw) } } as unknown as Stripe));
afterEach(() => { setStripeForTests(null); delete process.env.DISPUTE_WAIT_MS; });

// Batch 35 §9 (Oct 30): a dispute that arrives before this server has recorded its payment is left for Stripe's retry, never marked as handled.
const send = (id: string, type: string, object: Record<string, unknown>) =>
  webhookPOST(new Request("http://localhost:3400/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": "t" }, body: JSON.stringify({ id, type, data: { object } }) }));

describe("batch 35 §9: an early dispute waits for Stripe's retry", () => {
  it("a dispute on a payment not recorded yet answers 503 and forgets the event, so the retry is handled again", async () => {
    const id = "evt_" + randomUUID();
    const pi = "pi_" + randomUUID();
    const first = await send(id, "charge.dispute.created", { payment_intent: pi });
    expect(first.status).toBe(503);
    expect(await db.stripeEvent.count({ where: { id } })).toBe(0);
    // Stripe's retry of the same event: not a duplicate, still waiting.
    expect((await send(id, "charge.dispute.created", { payment_intent: pi })).status).toBe(503);
    const won = await send("evt_" + randomUUID(), "charge.dispute.closed", { payment_intent: pi, status: "won" });
    expect(won.status).toBe(503);
  });

  it("an event handled normally is kept, and its re-delivery is a duplicate", async () => {
    const id = "evt_" + randomUUID();
    expect((await send(id, "payout.paid", { id: "po_x" })).status).toBe(200);
    expect(await db.stripeEvent.count({ where: { id } })).toBe(1);
    expect(await (await send(id, "payout.paid", { id: "po_x" })).json()).toMatchObject({ duplicate: true });
  });

  it("a payment recorded a moment after the dispute arrives is found while it waits: the chargeback hold starts at once", async () => {
    process.env.DISPUTE_WAIT_MS = "4000";
    const dev = await makeUser({ dev: true, name: "Dana Reyes" });
    const tester = await makeUser({ tester: true, name: "Ana Silva" });
    const pi = "pi_" + randomUUID();
    setTimeout(() => db.payment.create({ data: { kind: "submission", developerId: dev.user.id, testerId: tester.user.id, amountCents: 1000, feeCents: 200, testerCents: 800, status: "charged", stripePaymentIntentId: pi } }).catch((e) => console.error("CREATEFAIL", e.message)), 700);
    const r = await send("evt_" + randomUUID(), "charge.dispute.created", { payment_intent: pi });
    expect(r.status).toBe(200);
    expect(await db.payment.findFirstOrThrow({ where: { stripePaymentIntentId: pi } })).toMatchObject({ chargeback: "open" });
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdReason).toBe("chargeback");
  }, 15_000);
});
