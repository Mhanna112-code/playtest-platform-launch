import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { setStripeForTests } from "@/lib/server/stripe";
import { chargebackOpened, disputeAmountChanged, owedLines, payOwed } from "@/lib/server/holds";
import { bankChangedLine, pressAgainLine } from "@/lib/rules";
import { linesAfterStop } from "@/components/OwedBox";
import { joined, sact, setup } from "./fixtures";

// (Owner, Nov 3) Pay what you owe while the bank changes the disputed amount: the stop names the change ("Your bank changed the amount it took back from your $40.00
// payment for …: $12.00 → $20.00 (now $20.00 + $15.00 fee = $35.00)"), and the box's lines redraw with the stop, so they never disagree with the button.

afterEach(() => setStripeForTests(null));
const outcome = <T>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e: e as Error & { code?: string; data?: Record<string, unknown> } }));

/** A $40 payment, $12 of it disputed (+ $15 fee = $27 owed), card verified. */
async function chargebackHold() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  const pi = "pi_" + randomUUID();
  const p = await db.payment.create({ data: { kind: "review", contractId: j.sessionId, submissionId: sub.id, developerId: s.dev.user.id, testerId: j.tester.user.id, amountCents: 4000, feeCents: 400, testerCents: 3600, status: "charged", stripePaymentIntentId: pi } });
  await chargebackOpened(pi, 1200);
  await db.user.update({ where: { id: s.dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
  const u = await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } });
  return { ...s, u, p, pi };
}
const changeLine = /^Your bank changed the amount it took back from your \$40\.00 payment for .+'s written answers on “.+”: \$12\.00 → \$20\.00 \(now \$20\.00 \+ \$15\.00 fee = \$35\.00\)\. /;

describe("(Nov 3) the stop names the bank's change and carries the lines", () => {
  it("bankChangedLine words it", () => {
    expect(bankChangedLine(4000, "Ana Silva's written answers on “Harbor Run”", 1200, 2000)).toBe("Your bank changed the amount it took back from your $40.00 payment for Ana Silva's written answers on “Harbor Run”: $12.00 → $20.00 (now $20.00 + $15.00 fee = $35.00)");
    expect(bankChangedLine(4000, null, 2000, 1200)).toBe("Your bank changed the amount it took back from your $40.00 payment: $20.00 → $12.00 (now $12.00 + $15.00 fee = $27.00)");
  });

  it("a page that showed $27.00 (its line's amount sent): stops once naming the change, with the new lines; the second press reserves $35.00", async () => {
    const w = await chargebackHold();
    expect((await owedLines(w.u.id)).map((l) => l.amountCents)).toEqual([2700]);
    expect(await disputeAmountChanged(w.pi, 2000)).toBe("followed");
    const r = await outcome(payOwed(w.u, { seenTotalCents: 2700, seenIds: [w.p.id], seenAmounts: { [w.p.id]: 2700 } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.e.code).toBe("stop_once");
    const text = (r.e.data!.changes as { text: string }[])[0].text;
    expect(text).toMatch(changeLine);
    expect(text.endsWith(pressAgainLine(3500, { cardVerified: true }))).toBe(true);
    expect(r.e.data!.totalCents).toBe(3500);
    // The lines come with the stop: the bullet now reads $20 + $15, the same as the button's $35.00.
    const lines = r.e.data!.lines as { id: string; amountCents: number; text: string }[];
    expect(lines.map((l) => [l.id, l.amountCents])).toEqual([[w.p.id, 3500]]);
    expect(lines[0].text).toMatch(/\$20 of the \$40 .*: \$20 \+ \$15 chargeback fee$/);
    expect(await payOwed(w.u, { seenTotalCents: 3500, seenIds: [w.p.id], seenAmounts: { [w.p.id]: 3500 } })).toMatchObject({ reservedCents: 3500 });
  });

  it("an older page that sent no line amounts: the same line (the one chargeback line explains the whole difference)", async () => {
    const w = await chargebackHold();
    await disputeAmountChanged(w.pi, 2000);
    const r = await outcome(payOwed(w.u, { seenTotalCents: 2700, seenIds: [w.p.id] }));
    expect(!r.ok && (r.e.data!.changes as { text: string }[])[0].text).toMatch(changeLine);
  });

  it("the box draws the stop's lines (and keeps its own when a stop carries none)", () => {
    const old = [{ id: "a", retry: true, amountCents: 2700, until: null, text: "Your bank reversed $12 of the $40 …: $12 + $15 chargeback fee" }];
    const fresh = [{ id: "a", retry: true, amountCents: 3500, until: null, text: "Your bank reversed $20 of the $40 …: $20 + $15 chargeback fee" }];
    expect(linesAfterStop(old, { lines: fresh })).toEqual(fresh);
    expect(linesAfterStop(old, {})).toBe(old);
    expect(linesAfterStop(old, { lines: "nope" })).toBe(old);
  });
});
