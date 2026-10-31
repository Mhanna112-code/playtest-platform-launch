import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { decideTickLabel, decideTickLine } from "@/lib/rules";
import { decideDispute } from "@/lib/server/payments";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { joined, sact, seen, settle, setup } from "./fixtures";

// Batch 35 §1 (owner, Oct 30): an admin's Decide that raises a dispute's pay needs a tick naming what it charges, for any amount.

const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
afterEach(() => setStripeForTests(null));

async function disputed() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful" })).status).toBe(200);
  expect((await sact(j.sessionId, "dispute", j.tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question fully", seenAt: seen(), confirmed: true })).status).toBe(200);
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
  const a = await makeUser({ name: "Admin" });
  const admin = await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  const row = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
  const dev = await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } });
  return { admin, row, devName: dev.name };
}

describe("batch 35 §1: the tick on a dispute decision that charges", () => {
  it("a raise without the tick, or with a tick for another amount, is refused and charges nothing; the matching tick goes through", async () => {
    const { admin, row, devName } = await disputed();
    const made: unknown[] = [];
    setStripeForTests({ paymentIntents: { create: async (p: unknown) => { made.push(p); return { id: "pi_" + randomUUID(), status: "succeeded" }; } } } as unknown as Stripe);
    await expect(decideDispute(admin, row.id, { total: "10.00" })).rejects.toThrow(decideTickLine(devName, 600, 1000));
    expect(decideTickLabel(devName, 600, 1000)).toBe(`Charge ${devName} $6.00 more ($10.00 in all for this piece)`);
    // Ticked for $5.00, then the box changed to $10.00: the old tick doesn't count.
    await expect(decideDispute(admin, row.id, { total: "10.00", tickCents: 100 })).rejects.toThrow("Tick “");
    expect(made).toHaveLength(0);
    expect((await db.dispute.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("open");
    expect(await decideDispute(admin, row.id, { total: "10.00", tickCents: 600 })).toEqual({ extraCents: 600 });
    expect(made).toHaveLength(1);
  });

  it("keeping the pay (blank or the same total) needs no tick", async () => {
    const { admin, row } = await disputed();
    expect(await decideDispute(admin, row.id, { total: "" })).toEqual({ extraCents: 0 });
  });

  it("the admin's Decide shows the tick for a raise, disables Decide until it's ticked, and sends the ticked amount", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/admin/DisputeDecision.tsx"), "utf8");
    expect(src).toContain("decideTickLabel(dev, extra, typed!)");
    expect(src).toContain("disabled={busy || (extra > 0 && !ticked)}");
    expect(src).toContain("tickedFor === typed");
    expect(src).toContain("tickCents: extra");
  });

  it("(batch 35 §70) Decide on a piece whose payment is waiting for the developer's bank is refused; nothing is charged; the dispute stays open", async () => {
    const { admin, row } = await disputed();
    const sub = await db.submission.findUniqueOrThrow({ where: { id: row.submissionId! } });
    const c = await db.contract.findUniqueOrThrow({ where: { id: sub.contractId }, include: { test: true } });
    await db.payment.create({ data: { kind: "extra", submissionId: sub.id, contractId: c.id, developerId: c.test.developerId, testerId: c.testerId, amountCents: 600, feeCents: 120, testerCents: 480, status: "needs_action" } });
    const made: unknown[] = [];
    setStripeForTests({ paymentIntents: { create: async (p: unknown) => { made.push(p); return { id: "pi_" + randomUUID(), status: "succeeded" }; } } } as unknown as Stripe);
    const { DECIDE_LOCKED } = await import("@/lib/server/payments");
    await expect(decideDispute(admin, row.id, { total: "10.00", tickCents: 600 })).rejects.toThrow(DECIDE_LOCKED);
    expect(made).toHaveLength(0);
    expect((await db.dispute.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("open");
  });
});
