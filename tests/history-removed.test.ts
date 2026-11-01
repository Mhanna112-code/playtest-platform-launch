import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Found while recording the report (scripts/media.cjs, group "holds"): a tester removed from a test by a suspension read "You left this test" in History.
describe("the tester's History after a suspension", () => {
  it("says they were removed, not that they left", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../src/app/app/page.tsx"), "utf8");
    expect(src).toContain('c.endKind === "suspended" ? "Removed"'); // (batch 35 §98) the History tag; never "You left"
  });
});
