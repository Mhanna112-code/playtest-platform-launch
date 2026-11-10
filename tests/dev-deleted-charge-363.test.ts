import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { devDeletedStopLine } from "@/lib/rules";
import { runDaily } from "@/lib/server/holds";
import { deleteAccount } from "@/lib/server/restrictions";
import { setStripeForTests } from "@/lib/server/stripe";
import { joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 9, §363 clarification) When the developer deletes their account, unreviewed work is NOT paid automatically (nobody can review it) and its Charge
// never opens (openCharges skips a deleted developer: PAUSE_FREE). Work whose Charge was already open can still be charged, on the deleted developer's saved
// card (batch 12 §1, batch 29 §37). The tester's banner says exactly that.

const DAY = 86_400_000;
afterEach(() => setStripeForTests(null));

async function sentWork() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
  return { ...s, ...j, sub };
}

describe("§363 after the developer deletes their account", () => {
  it("the banner: unreviewed work isn't paid automatically; Charge already open can still be used", () => {
    expect(devDeletedStopLine(new Date("2026-11-09T12:00:00Z"), () => "Nov 9, 2026")).toBe("The developer deleted their account, so this test was stopped on Nov 9, 2026. You can still charge for work whose Charge is already open; chat and excerpt requests are closed.");
  });

  it("(a) work whose Charge was open before the deletion can be charged after it, on the deleted developer's saved card", async () => {
    const w = await sentWork();
    await db.submission.update({ where: { id: w.sub.id }, data: { payBy: new Date(Date.now() - DAY), choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY) } });
    await deleteAccount(w.dev.user.id, "self");
    setStripeForTests({
      paymentIntents: { create: async () => ({ id: "pi_" + randomUUID(), status: "succeeded" }), retrieve: async (id: string) => ({ id, status: "succeeded", latest_charge: "ch_x" }) },
      transfers: { create: async () => ({ id: "tr_" + randomUUID() }) },
    } as unknown as Stripe);
    const c = await sact(w.sessionId, "choose", w.tester.cookie, { submissionId: w.sub.id, choice: "charge", tickedCents: 1000, seenAt: seen(), confirmed: true });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: w.sub.id, kind: "review" } });
    expect(p).toMatchObject({ developerId: w.dev.user.id, amountCents: 1000 });
    expect(["charged", "not_set_up"]).toContain(p.status);
  });

  it("(b) unreviewed work whose Charge wasn't open never gets Charge, is never paid automatically, and gets no \"can charge\" line", async () => {
    const w = await sentWork();
    await deleteAccount(w.dev.user.id, "self");
    // Its review date passes, and the daily job runs (twice, a day apart).
    await db.submission.update({ where: { id: w.sub.id }, data: { payBy: new Date(Date.now() - 8 * DAY), choiceBy: null } });
    await db.contract.update({ where: { id: w.sessionId }, data: { dueAt: new Date(Date.now() - 8 * DAY) } });
    await runDaily();
    await runDaily(new Date(Date.now() + DAY));
    const sub = await db.submission.findUniqueOrThrow({ where: { id: w.sub.id }, include: { review: true } });
    expect(sub.choiceOfferedAt).toBeNull();
    expect(sub.review).toBeNull();
    expect(await db.payment.count({ where: { submissionId: w.sub.id } })).toBe(0);
    expect(await db.notification.count({ where: { userId: w.tester.user.id, OR: [{ text: { contains: "harge" } }, { text: { contains: "let go" } }] } })).toBe(0);
    // A Charge pressed from an old page is refused.
    const c = await sact(w.sessionId, "choose", w.tester.cookie, { submissionId: w.sub.id, choice: "charge", tickedCents: 1000, seenAt: seen(), confirmed: true });
    expect(c.status).toBe(409);
    expect(await db.payment.count({ where: { submissionId: w.sub.id } })).toBe(0);
  });
});
