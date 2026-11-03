import fs from "node:fs";
import { describe, expect, it } from "vitest";

// (Owner, Nov 2) What you've paid: a repayment names the reversed payment and the fee; a reversed payment counts once (as its repayment); every row has its date under it.
describe("What you've paid", () => {
  it("labels repayments, counts a reversed payment once, and puts the date under every row", () => {
    expect(fs.readFileSync("src/lib/server/paymentRows.ts", "utf8")).toContain("`Repaid the reversed ${money(o.amountCents)}");
    const page = fs.readFileSync("src/app/app/payments/page.tsx", "utf8");
    expect(page).toContain('p.status !== "refunded" && !(p.chargebackAt && p.chargeback !== "won")');
    expect(page).toContain('<li key={p.id} className="space-y-0.5 py-2">');
    expect(page).toContain('<span className="block text-slate-400">{fmtDateTime(p.createdAt)}');
  });
});
