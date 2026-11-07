import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// (Owner, Nov 4) A charge paid by Confirm all's one payment reads "confirmed with Confirm all" in Payments and the part's payments, never "paid through Pay what you owe"; one confirmed on its own reads "confirmed with your bank".
describe("Confirm all's paid label", () => {
  const src = readFileSync("src/lib/server/paymentRows.ts", "utf8");
  it("finds the rows a Confirm all paid (its one payment's note press:all) and labels them", () => {
    expect(src).toContain('note: "press:all"');
    expect(src).toContain("confirmed with Confirm all");
    expect(src).toContain('bank: "confirmed with your bank"');
    expect(src).toContain('by ? (alls.has(by) ? "all" : "owed") : p.owedUntil ? "owed" : "bank"');
  });
  it("the tester's row never names the developer's Confirm all", () => {
    const tester = src.slice(src.indexOf("// The tester's rows"), src.indexOf("export type RefundLine"));
    expect(tester).not.toContain("paid through Pay what you owe");
    expect(tester).not.toContain("confirmed with Confirm all");
  });
});
