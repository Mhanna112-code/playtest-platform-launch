import fs from "node:fs";
import { describe, expect, it } from "vitest";

// (Owner, Nov 2) A developer's repayment of a reversed payment ("chargeback" rows, $0 for the tester) never shows in the tester's payments or live lines.
describe("tester views leave out a developer's chargeback repayments", () => {
  it("Payments' earnings and owed lists, and the tester's live lines, exclude chargeback and owed rows", () => {
    const page = fs.readFileSync("src/app/app/payments/page.tsx", "utf8");
    expect(page).toContain('kind: { notIn: ["subscription", "chargeback", "owed"] }, status: { in: ["charged", "not_set_up"] }');
    expect(page).toContain('testerId: u.id, kind: { notIn: ["chargeback", "owed"] }, OR: [');
    expect(fs.readFileSync("src/lib/server/live.ts", "utf8")).toContain('kind: { notIn: ["chargeback", "owed"] }, contractId: onlyHere');
  });
});
