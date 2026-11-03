import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { chargebackOpened, owedLines } from "@/lib/server/holds";
import { joined, sact, setup } from "./fixtures";

// (Owner, Nov 2) A captured reservation paid several items with one PaymentIntent: a chargeback on it is the whole amount once, plus one fee.
describe("chargeback on a captured reservation", () => {
  it("groups the rows sharing the PaymentIntent: one line for the whole amount + one $15 fee", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    const pi = "pi_reserve_" + Date.now();
    const base = { developerId: s.dev.user.id, testerId: j.tester.user.id, status: "charged", stripePaymentIntentId: pi, feeCents: 0, testerCents: 0 };
    await db.payment.create({ data: { ...base, kind: "review", contractId: j.sessionId, submissionId: sub.id, amountCents: 1000 } });
    await db.payment.create({ data: { ...base, kind: "chargeback", amountCents: 2500 } });
    await db.payment.create({ data: { ...base, kind: "chargeback", amountCents: 2500 } });
    expect(await chargebackOpened(pi)).toBe(true);
    expect(await chargebackOpened(pi)).toBe(false); // a second delivery changes nothing
    const lines = (await owedLines(s.dev.user.id)).filter((l) => l.source === "chargeback");
    expect(lines).toHaveLength(1);
    expect(lines[0].amountCents).toBe(6000 + 1500);
    expect(await db.payment.count({ where: { stripePaymentIntentId: pi, kind: "owed", status: "bundled" } })).toBe(1);
  });
});
