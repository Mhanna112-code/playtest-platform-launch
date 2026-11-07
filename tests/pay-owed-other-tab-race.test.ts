import { afterEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { payOwed } from "@/lib/server/holds";
import * as once from "@/lib/server/owedOnce";
import { joined, setup } from "./fixtures";

afterEach(() => vi.restoreAllMocks());

it.each(["paying", "needs_action", "charged"])("a competing tab that becomes %s during the owed claim gets a final refusal, never a press-again stop", async (status) => {
  const { dev, testId } = await setup();
  const j = await joined(testId, "Owed Race Tester", "they");
  const debt = await db.payment.create({ data: { kind: "review", contractId: j.sessionId, developerId: dev.user.id, testerId: j.tester.user.id, amountCents: 1000, feeCents: 200, testerCents: 800, status: "failed", owedUntil: new Date() } });
  const original = once.chargeOwedTotal;
  vi.spyOn(once, "chargeOwedTotal").mockImplementationOnce(async (...args) => {
    const one = await db.payment.create({ data: { kind: "owed", developerId: dev.user.id, testerId: dev.user.id, amountCents: 1000, feeCents: 1000, testerCents: 0, status, note: "press", ...(status === "charged" ? { settledAt: new Date() } : {}), ...(status === "needs_action" ? { actionPi: "pi_owed_race", actionBy: new Date(Date.now() + 900_000) } : {}) } });
    await db.payment.update({ where: { id: debt.id }, data: { coveredById: one.id, ...(status === "charged" ? { status: "charged", settledAt: new Date() } : {}) } });
    return original(...args);
  });
  await expect(payOwed(dev.user, { seenTotalCents: 1000, seenIds: [debt.id] })).rejects.toMatchObject({ code: status === "charged" ? "nothing_owed" : "owed_in_flight", message: status === "charged" ? expect.stringMatching(/^You already paid what you owe \(\$10\.00\) in another tab at /) : expect.stringContaining("$10.00") });
  expect(await db.payment.count({ where: { developerId: dev.user.id, kind: "owed" } })).toBe(1);
});
