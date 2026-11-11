import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { awayAction, confirmFinish, confirmStart, expireActions } from "@/lib/server/confirm";
import { confirmAllPress, confirmAllState } from "@/lib/server/confirmAll";
import { pauseTest, reinstateAccount, unpauseTest } from "@/lib/server/restrictions";
import { makeUser } from "./helpers";
import { joined, seen, settle, setup } from "./fixtures";
import { pay } from "./b15";

const DAY = 86_400_000;
async function world(kind: string) {
  const s = await setup({ recordingCents: "10.00" });
  const j = await joined(s.testId);
  const items = [];
  for (const part of ["written", "recording"]) {
    const sub = await db.submission.create({ data: { contractId: j.sessionId, kind: part, agreedCents: 1000 } });
    await db.review.create({ data: { contractId: j.sessionId, submissionId: sub.id, amountCents: 1000, agreedCents: 1000, payKey: randomUUID(), reason: "charged by the tester" } });
    const p = await db.payment.create({ data: { kind: "review", contractId: j.sessionId, submissionId: sub.id, developerId: s.dev.user.id, testerId: j.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "pending" } });
    await awayAction(p.id, { status: "requires_action", stripePaymentIntentId: `pi_${randomUUID()}`, clientSecret: "test_only" });
    items.push(await db.payment.findUniqueOrThrow({ where: { id: p.id } }));
  }
  const loaded = seen(); await settle();
  if (kind === "pause") {
    const a = await makeUser();
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    await pauseTest(a.user.id, s.testId, "Checking the confirmation window.");
  } else await db.user.update({ where: { id: s.dev.user.id }, data: { devSuspendedAt: new Date() } });
  return { ...s, ...j, items, loaded };
}

// (Owner, Nov 11, §386 A; replaces "existing bank confirmations remain available" and §368) No money moves while the test or the developer is paused: Confirm with
// your bank and Confirm all are refused; a check that runs out meanwhile waits for the lift (never a decline); after the lift they go through once.
const lift = async (kind: string, w: Awaited<ReturnType<typeof world>>) => {
  if (kind === "pause") await unpauseTest(w.testId);
  else await reinstateAccount(w.dev.user.id, "developer");
};
const CAUSE: Record<string, string> = { pause: "The team paused this test", suspension: "Your account is suspended" };

describe("bank confirmations during pauses and suspensions (§386 A)", () => {
  it.each(["pause", "suspension"])("%s: Confirm with your bank is refused, then finishes once after the lift", async (kind) => {
    const w = await world(kind), p = w.items[0];
    await expect(confirmStart(w.dev.user, p.id, { seenAt: w.loaded })).rejects.toMatchObject({ message: `${CAUSE[kind]}, so your Confirm with your bank didn't go through.` });
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("needs_confirmation");
    // (§386 A) A new Pay is refused too (tests/money-frozen-386.test.ts covers every press).
    const fresh = await db.submission.create({ data: { contractId: w.sessionId, kind: "extra-sample", agreedCents: 1000 } });
    expect((await pay(w.dev.cookie, { kind: "submission", id: fresh.id, amount: "10.00", tickedCents: 1000, confirmed: true })).body.error.message).toBe(`${CAUSE[kind]}, so your Pay didn't go through.`);
    await lift(kind, w);
    await settle();
    await expect(confirmStart(w.dev.user, p.id, { seenAt: seen() })).resolves.toMatchObject({ paymentId: p.id });
    await confirmFinish(w.dev.user, p.id, { simulate: "succeeded" });
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("charged");
    expect((await db.payment.findUniqueOrThrow({ where: { id: w.items[1].id } })).status).toBe("needs_confirmation");
  });

  it.each(["pause", "suspension"])("%s: Confirm all is refused, then completes once after the lift", async (kind) => {
    const w = await world(kind);
    const state = await confirmAllState(w.dev.user.id);
    expect(state.ids.sort()).toEqual(w.items.map((p) => p.id).sort());
    const body = { seenAt: w.loaded, seenIds: state.ids, seenTotalCents: state.totalCents };
    await expect(confirmAllPress(w.dev.user, body)).rejects.toMatchObject({ message: `${CAUSE[kind]}, so your Confirm all didn't go through.` });
    await lift(kind, w);
    await settle();
    await confirmAllPress(w.dev.user, { ...body, seenAt: seen() });
    for (const p of w.items) expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("not_set_up");
    expect((await confirmAllState(w.dev.user.id)).ids).toEqual([]);
  });

  it("a check that runs out during the team's pause waits for the lift (never a decline, no hold), then is made", async () => {
    const w = await world("pause"), p = w.items[0];
    expect(+p.actionBy! - +p.createdAt).toBeLessThanOrEqual(3 * DAY + 1000);
    await expireActions(new Date(+p.actionBy! + 1000), { submissionId: p.submissionId! });
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("deferred");
    expect((await db.user.findUniqueOrThrow({ where: { id: w.dev.user.id } })).holdStartedAt).toBeNull();
    await unpauseTest(w.testId);
    expect(["charged", "not_set_up"]).toContain((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status);
  });
});
