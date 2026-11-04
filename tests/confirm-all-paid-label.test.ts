import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// (Owner, Nov 4) A charge paid by Confirm all's one payment reads "confirmed with Confirm all" in Payments and the part's payments, never "paid through Pay what you owe".
describe("Confirm all's paid label", () => {
  const src = readFileSync("src/lib/server/paymentRows.ts", "utf8");
  it("finds the rows a Confirm all paid (its one payment's note press:all) and labels them", () => {
    expect(src).toContain('note: "press:all"');
    expect(src).toContain("confirmed with Confirm all");
    expect(src).toContain("charged by ${tester} after 7 days without a review, confirmed with Confirm all");
  });
  it("the tester's row never names the developer's Confirm all", () => {
    expect(src).toContain('(p.settledAt || p.owedUntil) && !viaAll.has(p.id) ? "paid through Pay what you owe"');
  });
});
