import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { setStripeForTests } from "@/lib/server/stripe";
import { INTERRUPTED, PAYMENT_CHECKING, checkStuck, recoverPayment } from "@/lib/server/recovery";
import { runDaily } from "@/lib/server/holds";
import { pay, sentWork, withCard } from "./b15";

// Batch 15 section 9: a press whose answer from Stripe was lost stays "in progress", then is found by its payKey and finished, or cleared so Pay works again.
afterEach(() => setStripeForTests(null));
const MIN = 60_000;

/** A Stripe stand-in that loses its answer: `charged` = the PaymentIntent was made (and succeeded) before the connection dropped. */
function droppingStripe() {
  const byKey = new Map<string, { id: string; status: string }>();
  const keys: string[] = [];
  const state = { drop: true, charged: true };
  setStripeForTests({
    paymentIntents: {
      create: async (p: { metadata?: { payKey?: string } }, o: { idempotencyKey: string }) => {
        keys.push(o.idempotencyKey);
        const pi = { id: "pi_" + randomUUID(), status: "succeeded" };
        if (!state.drop || state.charged) byKey.set(p.metadata?.payKey ?? "", pi);
        if (state.drop) throw Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" });
        return pi;
      },
      search: async (q: { query: string }) => {
        const key = /:'([^']+)'/.exec(q.query)?.[1] ?? "";
        return { data: byKey.has(key) ? [byKey.get(key)] : [] };
      },
    },
  } as unknown as Stripe);
  return { keys, state };
}
const later = (ms: number) => new Date(Date.now() + ms);

describe("payments stuck in progress (section 9)", () => {
  it("charged before the answer was lost: found by its payKey after 15 minutes and finished as normal", async () => {
    const { dev, tester, sub } = await sentWork();
    await withCard(dev.user.id);
    const s = droppingStripe();
    const r = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(r).toMatchObject({ status: 502, body: { error: { code: "payment_unknown", message: PAYMENT_CHECKING } } });
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: sub.id } });
    expect(p.status).toBe("pending");
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(1); // still reserved: it can't be paid twice
    // Under 15 minutes: not checked yet.
    expect(await recoverPayment(p.id, later(10 * MIN))).toBeNull();
    expect(await recoverPayment(p.id, later(16 * MIN))).toBe("finished");
    const done = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(done.status).toBe("charged");
    expect(done.stripePaymentIntentId).toMatch(/^pi_/);
    expect(s.keys).toEqual([`pay-${p.payKey}`]);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "paid you $10.00" } } })).toBe(1);
  });

  it("not charged: cleared (review deleted, failed \"interrupted\", no bell), back in Needs you; a new press reuses the same key", async () => {
    const { dev, tester, sub } = await sentWork();
    await withCard(dev.user.id);
    const s = droppingStripe();
    s.state.charged = false;
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(502);
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: sub.id } });
    const before = await db.notification.count({ where: { userId: { in: [dev.user.id, tester.user.id] } } });
    // The daily job checks it.
    await db.payment.update({ where: { id: p.id }, data: { createdAt: new Date(Date.now() - 20 * MIN) } });
    await runDaily(new Date());
    const cleared = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(cleared).toMatchObject({ status: "failed", failure: INTERRUPTED });
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0);
    expect(await db.notification.count({ where: { userId: { in: [dev.user.id, tester.user.id] } } })).toBe(before); // nobody gets a bell
    // Pay again: it goes through, with the interrupted press's key (never a second charge).
    s.state.drop = false;
    const again = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(again.status).toBe(200);
    expect(s.keys).toEqual([`pay-${p.payKey}`, `pay-${p.payKey}`]);
    expect(await db.payment.count({ where: { submissionId: sub.id, status: "charged" } })).toBe(1);
  });

  it("left alone while the bank is confirming; a page-load check runs at most once a minute", async () => {
    const { dev, sub, testId } = await sentWork();
    await withCard(dev.user.id);
    setStripeForTests({
      paymentIntents: {
        create: async () => { throw Object.assign(new Error("timeout"), { type: "StripeAPIError" }); },
        search: async () => ({ data: [{ id: "pi_x", status: "processing" }] }),
      },
    } as unknown as Stripe);
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(502);
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: sub.id } });
    await db.payment.update({ where: { id: p.id }, data: { createdAt: new Date(Date.now() - 20 * MIN) } });
    expect(await checkStuck({ testId })).toEqual(["waiting"]);
    expect(await checkStuck({ testId })).toEqual([null]); // checked under a minute ago
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("pending");
  });
});
