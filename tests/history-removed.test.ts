import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Found while recording the report (scripts/media.cjs, group "holds"): a tester removed from a test by a suspension read "You left this test" in History.
describe("the tester's History after a suspension", () => {
  it("says they were removed, not that they left", () => {
    // (Codex eb8ca7cd, docs/NOV7-DASHBOARD-CHANGES.md) History went; Previous Tests puts a suspension's removal under "Removed From", never "Left".
    const src = fs.readFileSync(path.resolve(__dirname, "../src/lib/dashboardPanels.ts"), "utf8");
    expect(src).toContain('c.endKind === "suspended"');
    expect(src).toContain('return "Removed From";');
  });
});
