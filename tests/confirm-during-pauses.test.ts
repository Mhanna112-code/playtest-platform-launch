import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { awayAction, confirmFinish, confirmStart, expireActions } from "@/lib/server/confirm";
import { confirmAllPress, confirmAllState } from "@/lib/server/confirmAll";
import { pauseTest, unpauseTest } from "@/lib/server/restrictions";
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

describe("existing bank confirmations during pauses and suspensions", () => {
  it.each(["pause", "suspension"])("%s: single Confirm finishes without reopening the test", async (kind) => {
    const w = await world(kind), p = w.items[0];
    const body = { seenAt: w.loaded };
    if (kind === "pause") {
      await expect(confirmStart(w.dev.user, p.id, body)).resolves.toMatchObject({ paymentId: p.id });
    } else {
      await expect(confirmStart(w.dev.user, p.id, body)).rejects.toMatchObject({ code: "stop_once" });
      await expect(confirmStart(w.dev.user, p.id, { ...body, confirmed: true, boxAt: seen() })).resolves.toMatchObject({ paymentId: p.id });
    }
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).actionBy).toEqual(p.actionBy);
    await confirmFinish(w.dev.user, p.id, { simulate: "succeeded" });
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("charged");
    expect((await db.payment.findUniqueOrThrow({ where: { id: w.items[1].id } })).status).toBe("needs_confirmation");
    const t = await db.test.findUniqueOrThrow({ where: { id: w.testId } });
    const dev = await db.user.findUniqueOrThrow({ where: { id: w.dev.user.id } });
    expect(kind === "pause" ? !!t.adminPausedAt : !!dev.devSuspendedAt).toBe(true);
    // (Owner, Nov 9, §368) A new Pay goes through during the pause or suspension too (tests/pay-during-pauses-368.test.ts covers Pay more and a call's Pay).
    const fresh = await db.submission.create({ data: { contractId: w.sessionId, kind: "extra-sample", agreedCents: 1000 } });
    expect((await pay(w.dev.cookie, { kind: "submission", id: fresh.id, amount: "10.00", tickedCents: 1000, confirmed: true })).status).toBe(200);
  });

  it.each(["pause", "suspension"])("%s: Confirm all includes the waiting items and completes once", async (kind) => {
    const w = await world(kind);
    const state = await confirmAllState(w.dev.user.id);
    expect(state.ids.sort()).toEqual(w.items.map((p) => p.id).sort());
    const body = { seenAt: w.loaded, seenIds: state.ids, seenTotalCents: state.totalCents };
    await expect(confirmAllPress(w.dev.user, body)).rejects.toMatchObject({ code: "stop_once" });
    await confirmAllPress(w.dev.user, { ...body, confirmed: true, boxAt: seen() });
    for (const p of w.items) expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("not_set_up");
    expect((await confirmAllState(w.dev.user.id)).ids).toEqual([]);
  });

  it("the three-day deadline is not extended by an admin pause", async () => {
    const w = await world("pause"), p = w.items[0];
    expect(+p.actionBy! - +p.createdAt).toBeLessThanOrEqual(3 * DAY + 1000);
    await unpauseTest(w.testId);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).actionBy).toEqual(p.actionBy);
    await db.test.update({ where: { id: w.testId }, data: { adminPausedAt: new Date() } });
    await expireActions(new Date(+p.actionBy! + 1000), { submissionId: p.submissionId! });
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("failed");
    await expect(confirmStart(w.dev.user, p.id)).rejects.toBeDefined();
  });
});
