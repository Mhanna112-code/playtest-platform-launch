import { describe, expect, it } from "vitest";
import * as R from "@/lib/rules";

// (Owner) No upper caps on money: only Stripe's own limit ($999,999.99 per charge); the minimums stay.
describe("no upper caps on money", () => {
  it("Pay takes any amount up to Stripe's limit; above it is refused with that reason; the minimums stay", () => {
    expect(R.checkPay(1_000_000, null, "", 1_000_000, true).ok).toBe(true); // $10,000.00 (batch 9: over $200 needs its second tick)
    expect(R.checkPay(99_999_999, null, "", 99_999_999, true).ok).toBe(true);
    expect(R.checkPay(100_000_000, null, "", 100_000_000)).toEqual({ ok: false, message: "Stripe can't take more than $999,999.99 in one charge." });
    expect(R.checkPay(25, null, "", 25).ok).toBe(false); // the smallest card charge stays
  });
});

describe("(Item 28) the dispute decision's range", () => {
  it("listing $8, $5 already paid on other pieces, this piece rejected: from $0.00 to $3.00", () => {
    expect(R.checkDisputeDecision(300, 0, 800, 500)).toEqual({ ok: true, extraCents: 300 });
    expect(R.checkDisputeDecision(400, 0, 800, 500)).toEqual({ ok: false, message: "At most $3.00: the listing's $8.00 minus the $5.00 already paid for this part." });
    expect(R.checkDisputeDecision(0, 0, 800, 500)).toEqual({ ok: true, extraCents: 0 });
    expect(R.checkDisputeDecision(100, 200, 800, 500).ok).toBe(false); // below what this piece was paid
  });
});
