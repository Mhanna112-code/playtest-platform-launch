import { describe, expect, it } from "vitest";
import * as R from "@/lib/rules";

// (Owner) No upper caps on money: only Stripe's own limit ($999,999.99 per charge); the minimums stay.
describe("no upper caps on money", () => {
  it("Pay and Ask take any amount up to Stripe's limit; above it is refused with that reason; the minimums stay", () => {
    expect(R.checkPay(1_000_000, null, "", 1_000_000).ok).toBe(true); // $10,000.00
    expect(R.checkPay(99_999_999, null, "", 99_999_999).ok).toBe(true);
    expect(R.checkPay(100_000_000, null, "", 100_000_000)).toEqual({ ok: false, message: "Stripe can't take more than $999,999.99 in one charge." });
    expect(R.checkPay(25, null, "", 25).ok).toBe(false); // the smallest card charge stays
    expect(R.checkAsk(2_000_000).ok).toBe(true);
    expect(R.checkAsk(100_000_000)).toEqual({ ok: false, message: "Stripe can't take more than $999,999.99 in one charge." });
  });
});
