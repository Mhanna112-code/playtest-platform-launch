import { describe, expect, it } from "vitest";
import fs from "node:fs";

// (Owner, Nov 2) While a chargeback hold's reservation is being made or waits for the bank, what it covers reads "Waiting for your bank" and a charge that came in
// after it reads "Charged right after the payment above goes through" (never added to the total).
describe("owed box during an open reservation", () => {
  it("treats the reservation like Pay what you owe's open check", () => {
    const src = fs.readFileSync("src/lib/server/holds.ts", "utf8");
    expect(src).toContain('status: { in: ["pending", "needs_action"] } }, select: { id: true, status: true, covers: true } })');
    // (Owner, Nov 3, §160) Its rows carry the reservation's id, so other tabs show its Cancel this check.
    expect(src).toContain("if (reserving.has(p.id)) locks.set(p.id, reserving.get(p.id)!);");
  });
});
