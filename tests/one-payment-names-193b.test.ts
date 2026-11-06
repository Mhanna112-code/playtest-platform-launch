import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { fmtDateTime } from "@/lib/server/dateFormat";
import { disputeAmountChanged, onePaymentName, reversedNaming } from "@/lib/server/holds";
import { joined, sact, settle, setup } from "./fixtures";

// (Owner, Nov 4, §193b) Every line about a dispute, a team decision or the bank changing or reversing a charge names exactly which charge and which part. A one
// payment (Pay what you owe's, Confirm all's) that paid several items is named by its kind, when it was made and every item it paid, never "your $35.00 payment".

const devs: string[] = [];
afterAll(async () => {
  await db.payment.updateMany({ where: { developerId: { in: devs }, chargeback: "open" }, data: { chargeback: "resolved" } });
});

const ONE = "Pay what you owe payment on Wed, Nov 4, 12:30 PM (Ana Silva's written answers on “Harbor Run”, Ben Okafor's live call on “Harbor Run” (Tue, Oct 27, 3:25 PM))";
const PIECE = "Ana Silva's written answers on “Harbor Run”";

describe("§193b the line helpers name a one payment and its items", () => {
  it("paymentWords: a part, a one payment, or the amount alone", () => {
    expect(R.paymentWords(2000, PIECE)).toBe(`your $20.00 payment for ${PIECE}`);
    expect(R.paymentWords(3500, null, ONE)).toBe(`your $35.00 ${ONE}`);
    expect(R.paymentWords(3500, null, ONE, "the")).toBe(`the $35.00 ${ONE}`);
    expect(R.paymentWords(3500, null)).toBe("your $35.00 payment");
  });

  it("the bank's change, lowered, raised, the rise's name, the owed line, the repayment, the reversal and the win each name it", () => {
    expect(R.bankChangedLine(3500, null, 1200, 2000, ONE)).toBe(`Your bank changed the amount it took back from your $35.00 ${ONE}: $12.00 → $20.00 (now $20.00 + $15.00 fee = $35.00)`);
    expect(R.bankLoweredLine(3500, null, 800, ONE)).toBe(`Your bank lowered what it took back from your $35.00 ${ONE}: $8.00 refunded to your card.`);
    expect(R.bankRaisedLine(3500, null, 800, ONE)).toBe(`Your bank raised what it took back from your $35.00 ${ONE}: $8.00 more is charged.`);
    expect(R.raiseName(3500, null, 1200, 2000, ONE)).toBe(`the rise in what your bank took back from your $35.00 ${ONE} ($12.00 → $20.00)`);
    expect(R.chargebackOwedLine(2000, undefined, false, 3500, ONE)).toBe(`Your bank reversed $20 of your $35 ${ONE}: $20 + $15 chargeback fee`);
    expect(R.chargebackOwedLine(3500, undefined, false, 3500, ONE)).toBe(`Your bank reversed your $35 ${ONE}: $35 + $15 chargeback fee`);
    expect(R.repaidReversedLine({ amountCents: 3500, reversedCents: 2000 }, " payment", null, ONE)).toBe(`Repaid $20 reversed from your $35 ${ONE} ($20 + $15 chargeback fee)`);
    expect(R.repaidReversedLine({ amountCents: 3500 }, " payment", null, ONE)).toBe(`Repaid the reversed $35.00 ${ONE} ($35.00 + $15.00 chargeback fee)`);
    expect(R.reversedWords({ amountCents: 3500, reversedCents: 2000 }, "a", ONE)).toBe(`$20.00 of a $35.00 ${ONE}`);
    expect(R.reversedWords({ amountCents: 3500 }, "your", ONE)).toBe(`your $35.00 ${ONE}`);
    const on = ` on ${R.paymentWords(3500, null, ONE)}`;
    expect(R.chargebackWonLine(3500, on)).toBe(`Your bank's chargeback of $35.00 on your $35.00 ${ONE} was reversed in your favour.`);
    expect(R.chargebackWonRefundLine(3500, on, 5000)).toBe(`Your bank's chargeback of $35.00 on your $35.00 ${ONE} was reversed in your favour: $50.00 refunded to your card.`); // (§310a)
    // No one payment: the same words as before.
    expect(R.bankChangedLine(4000, PIECE, 1200, 2000)).toBe(`Your bank changed the amount it took back from your $40.00 payment for ${PIECE}: $12.00 → $20.00 (now $20.00 + $15.00 fee = $35.00)`);
  });
});

describe("§193b a reversed Pay what you owe payment is named by its items", () => {
  async function oneWorld() {
    const s = await setup();
    devs.push(s.dev.user.id);
    const ana = await joined(s.testId, "Ana Silva");
    const ben = await joined(s.testId, "Ben Okafor", "he");
    for (const t of [ana, ben]) await sact(t.sessionId, "written", t.tester.cookie, { answers: ["a", "b"] });
    await settle();
    const subs = await db.submission.findMany({ where: { contractId: { in: [ana.sessionId, ben.sessionId] } }, orderBy: { sentAt: "asc" } });
    const pi = "pi_" + randomUUID();
    const one = await db.payment.create({ data: { kind: "owed", developerId: s.dev.user.id, testerId: s.dev.user.id, amountCents: 2200, feeCents: 2200, testerCents: 0, transferStatus: "none", status: "bundled", stripePaymentIntentId: pi, chargeback: "open", chargebackAt: new Date(), reversedCents: 2200 } });
    for (const [i, t] of [ana, ben].entries()) {
      await db.payment.create({ data: { kind: "review", contractId: t.sessionId, submissionId: subs.find((x) => x.contractId === t.sessionId)!.id, developerId: s.dev.user.id, testerId: t.tester.user.id, amountCents: 1000 + i * 200, feeCents: 0, testerCents: 0, status: "charged", coveredById: one.id, createdAt: new Date(Date.now() - (2 - i) * 1000) } });
    }
    return { ...s, one, pi };
  }

  it("onePaymentName / reversedNaming: its kind, when it was made and both items (full names); a Confirm all one says so", async () => {
    const w = await oneWorld();
    const at = fmtDateTime(w.one.createdAt);
    const items = "(Ana Silva's written answers on “Harbor Run”, Ben Okafor's written answers on “Harbor Run”)";
    expect(await onePaymentName(w.one, true, (d) => fmtDateTime(d))).toBe(`Pay what you owe payment on ${at} ${items}`);
    expect(await reversedNaming(w.one, true, (d) => fmtDateTime(d))).toEqual({ piece: null, one: `Pay what you owe payment on ${at} ${items}` });
    expect(await onePaymentName({ ...w.one, note: "press:all" }, true, (d) => fmtDateTime(d))).toBe(`Confirm all payment on ${at} ${items}`);
    // Any other payment: named by its part.
    const item = await db.payment.findFirstOrThrow({ where: { coveredById: w.one.id }, orderBy: { createdAt: "asc" } });
    expect(await onePaymentName(item)).toBeNull();
    expect(await reversedNaming(item, true)).toEqual({ piece: PIECE, one: null });
  });

  it("the team's Chargebacks line when Stripe changes the disputed amount names the one payment's items, and keeps the PaymentIntent", async () => {
    const w = await oneWorld();
    expect(await disputeAmountChanged(w.pi, 1500, "under_review")).toBe("followed");
    const note = (await db.accountEvent.findFirstOrThrow({ where: { userId: w.dev.user.id, kind: "chargeback-amount" }, orderBy: { createdAt: "desc" } })).note;
    expect(note).toBe(`Stripe changed the disputed amount of the $22.00 Pay what you owe payment on ${fmtDateTime(w.one.createdAt)} (Ana Silva's written answers on “Harbor Run”, Ben Okafor's written answers on “Harbor Run”) (${w.pi}) from $22.00 to $15.00: followed (the developer now owes $15.00 + $15.00 chargeback fee).`);
  });
});
