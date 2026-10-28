import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { toCents } from "@/lib/format";
import { joined, sact, seen, setup } from "./fixtures";

// Batch 16 section 39: Charge needs no tick, except above $200; section 36: the amount box rounds to the cent.
const DAY = 86_400_000;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");

/** Ana's written answers ($X listed) unreviewed with Charge open. */
async function chargeOpen(price: string) {
  const { dev, testId } = await setup({ writtenCents: price, confirmHigh: ["written"] });
  const { tester, sessionId } = await joined(testId);
  await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
  await db.submission.update({ where: { id: sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY), payBy: new Date(Date.now() - DAY) } });
  return { dev, testId, tester, sessionId, sub };
}

describe("Charge: no tick, except above $200 (section 39)", () => {
  it("an ordinary amount goes through on Charge alone", async () => {
    const a = await chargeOpen("9.00");
    const r = await sact(a.sessionId, "choose", a.tester.cookie, { submissionId: a.sub.id, choice: "charge", amount: "9.00", seenAt: seen(), confirmed: true });
    expect(r.body).toMatchObject({ choice: "charge", amountCents: 900 });
  });

  it("$200.00 exactly needs no tick; above $200 the tick is required and must name the typed amount", async () => {
    const a = await chargeOpen("300.00");
    const go = (amount: string, tickedCents?: number) => sact(a.sessionId, "choose", a.tester.cookie, { submissionId: a.sub.id, choice: "charge", amount, ...(tickedCents != null ? { tickedCents } : {}), seenAt: seen(), confirmed: true });
    expect((await go("250.00")).body.error.message).toBe("Tick “Charge Nora Lane $250.00 now (over $200)” to charge.");
    expect((await go("250.00", 30000)).body.error.message).toBe("Tick “Charge Nora Lane $250.00 now (over $200)” to charge."); // the tick names another amount
    expect((await go("250.00", 25000)).body).toMatchObject({ amountCents: 25000 });
    const b = await chargeOpen("300.00");
    expect((await sact(b.sessionId, "choose", b.tester.cookie, { submissionId: b.sub.id, choice: "charge", amount: "200.00", seenAt: seen(), confirmed: true })).body).toMatchObject({ amountCents: 20000 });
    expect(R.CHARGE_TICK_CENTS).toBe(R.PAY_TICK_CENTS);
  });

  it("Let it go is unchanged", async () => {
    const a = await chargeOpen("9.00");
    expect((await sact(a.sessionId, "choose", a.tester.cookie, { submissionId: a.sub.id, choice: "letgo", seenAt: seen(), confirmed: true })).status).toBe(200);
  });

  it("the box: the tick only above $200 (the button disabled until it's ticked); the amount rounds to the cent", () => {
    const box = src("app/app/sessions/[id]/ChoiceBox.tsx");
    expect(box).toContain("const over = typed != null && typed > CHARGE_TICK_CENTS;");
    expect(box).toContain("{over && (");
    expect(box).toContain("{chargeTickLabel(devName, typed!)}");
    expect(box).toContain("disabled={busy || typed == null || (over && !ticked)}");
    expect(box).toContain('inputMode="decimal" data-money=""');
    expect(R.chargeTickLabel("Nora Lane", 25000)).toBe("Charge Nora Lane $250.00 now (over $200)");
    // (Section 36) What's charged is the rounded amount: 0.494 is $0.49, under the $0.50 minimum; 0.495 is $0.50.
    expect(toCents("0.494")).toBe(49);
    expect(toCents("0.495")).toBe(50);
  });
});
