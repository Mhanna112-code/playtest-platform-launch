import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { paidLinesTotal, paidOutTotal } from "@/lib/server/paymentRows";
import { repaidReversedLine } from "@/lib/rules";

// (Owner, Nov 2) What you've paid: a repayment names the reversed payment and the fee; a reversed payment counts once (as its repayment); every row has its date under it.
// (Owner, Nov 3, §133) The repayment line and the total moved to shared helpers (rules.ts repaidReversedLine, paymentRows.ts paidOutTotal); a bank reversing only part
// of a payment is covered in tests/partial-dispute.test.ts.
describe("What you've paid", () => {
  it("labels repayments, counts a reversed payment once, and puts the date under every row", () => {
    expect(repaidReversedLine({ amountCents: 3900 }, " Pay more", "Ana Silva's written answers on “Harbor Run”")).toBe("Repaid the reversed $39.00 Pay more for Ana Silva's written answers on “Harbor Run” ($39.00 + $15.00 chargeback fee)");
    expect(fs.readFileSync("src/lib/server/paymentRows.ts", "utf8")).toContain("repaidReversedLine(o, ");
    const reversed = { amountCents: 3900, chargebackAt: new Date(), chargeback: "resolved", status: "charged" };
    const repay = { amountCents: 5400, chargebackAt: null, chargeback: "", status: "charged" };
    expect(paidOutTotal([reversed, repay])).toBe(5400);
    expect(paidOutTotal([{ ...reversed, chargeback: "won" }, { ...repay, status: "refunded" }])).toBe(3900);
    // (§190) Read by the shared developerPaid and drawn by the shared DevPaidList (Payments and the admin box).
    // (Owner, Nov 4, §192) Each refund is its own negative line: the total is the signed sum of the lines (paidLinesTotal), the same figure for the same history.
    expect(fs.readFileSync("src/lib/server/paymentLists.ts", "utf8")).toContain("totalCents: paidLinesTotal(list, reversedOnes, [...refunds.values()].flat())");
    expect(paidLinesTotal([{ ...reversed, chargeback: "won" }, { ...repay, status: "refunded" }], [], [{ amountCents: 5400 }])).toBe(paidOutTotal([{ ...reversed, chargeback: "won" }, { ...repay, status: "refunded" }]));
    const page = fs.readFileSync("src/components/PaymentLists.tsx", "utf8");
    expect(page).toContain("Total {money(paid.totalCents)}");
    expect(page).toContain('<li key={p.id} className="space-y-0.5 py-2">');
    expect(page).toContain('<span className="block text-slate-400">{fmtDateTime(p.createdAt)}');
  });
});
