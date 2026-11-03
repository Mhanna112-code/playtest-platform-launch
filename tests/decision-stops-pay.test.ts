import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { decideDispute } from "@/lib/server/payments";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 3; narrowed by batch 35 §159 rule 1) The team's dispute decision about the SAME tester always stops a payment press once — Pay, Pay more, Confirm
// with your bank — on any of that tester's parts, even with "Disputes" and "Decisions by the team" ticked off in Alerts. A decision about ANOTHER tester follows the
// ticks like everything else. Other ticked-off types still don't stop.

afterEach(() => setStripeForTests(null));
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), ...body } })).then(json);
const paying = () => setStripeForTests({ paymentIntents: { create: async () => ({ id: "pi_" + randomUUID(), status: "succeeded" }) } } as unknown as Stripe);

/** Ana's answers paid $4.00 and disputed; Ben's answers sent and not paid yet; the developer ignores Disputes and Decisions by the team. */
async function world() {
  const s = await setup();
  const ana = await joined(s.testId);
  const ben = await joined(s.testId);
  for (const t of [ana, ben]) await sact(t.sessionId, "written", t.tester.cookie, { answers: ["a", "b"] });
  await settle();
  const anaSub = await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId } });
  const benSub = await db.submission.findFirstOrThrow({ where: { contractId: ben.sessionId } });
  expect((await pay(s.dev.cookie, { kind: "submission", id: anaSub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful", seenAt: seen() })).status).toBe(200);
  expect((await sact(ana.sessionId, "dispute", ana.tester.cookie, { kind: "submission", id: anaSub.id, reason: "I answered every question fully", seenAt: seen(), confirmed: true })).status).toBe(200);
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
  await db.test.update({ where: { id: s.testId }, data: { ignoredAlerts: ["disputes", "admin", "work"] } });
  const a = await makeUser({ name: "Admin" });
  const admin = await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  const row = await db.dispute.findFirstOrThrow({ where: { submissionId: anaSub.id } });
  await settle();
  return { ...s, ana, ben, anaSub, benSub, admin, row };
}

describe("(Owner, Nov 3) the team's decision about the same tester always stops a payment press", () => {
  it("Pay on the SAME tester's part, with Disputes and Decisions ticked off: stops once naming the decision; the second press pays", async () => {
    const w = await world();
    paying();
    const rec = await db.submission.create({ data: { contractId: w.ana.sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
    await settle();
    const loaded = seen();
    await settle();
    await decideDispute(w.admin, w.row.id, { total: "10.00", tickCents: 600 });
    await settle();
    const body = { kind: "submission", id: rec.id, amount: "10.00", tickedCents: 1000, seenAt: loaded };
    const first = await pay(w.dev.cookie, body);
    expect([first.status, first.body.error?.code]).toEqual([409, "stop_once"]);
    expect(first.body.error.changes.map((c: { text: string }) => c.text).join(" | ")).toMatch(/^.*The team decided .*dispute/);
    const second = await pay(w.dev.cookie, { ...body, confirmed: true });
    expect(second.status).toBe(200);
  });

  it("(§159) Pay on ANOTHER tester's part, with Decisions ticked off: goes straight through", async () => {
    const w = await world();
    paying();
    const loaded = seen();
    await settle();
    await decideDispute(w.admin, w.row.id, { total: "10.00", tickCents: 600 });
    await settle();
    const body = { kind: "submission", id: w.benSub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful", seenAt: loaded };
    const first = await pay(w.dev.cookie, body);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
  });

  it("an ignored type that isn't a decision still doesn't stop Pay (the Alerts filter is unchanged for everything else)", async () => {
    const w = await world();
    paying();
    const loaded = seen();
    await settle();
    // A new piece of work from Ana (ignored "work"), not a decision.
    await sact(w.ana.sessionId, "message", w.ana.tester.cookie, { text: "hello" }).catch(() => null);
    const r = await pay(w.dev.cookie, { kind: "submission", id: w.benSub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful", seenAt: loaded });
    expect(r.status).toBe(200);
  });
});
