import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Batch 35 §71 (owner, Oct 31): the Alerts menu has no "Saved." line, and an "All" tick for every type that can happen here.
describe("batch 35 §71: Alerts menu", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/components/AlertsMenu.tsx"), "utf8");
  it("no \"Saved.\" after a change; a failure still says so", () => {
    expect(src).not.toContain('setSaved("Saved.")');
    expect(src).toContain('setSaved("Couldn\'t save. Try again.")');
  });
  it("an All tick covering the types that can happen here (greyed ones keep their ticks)", () => {
    expect(src).toContain('data-alerts-all=""');
    expect(src).toContain("const open = ALERT_TYPES.filter((a) => !keys || keys.includes(a.key));");
    expect(src).toContain("for (const a of open) if (ignored.includes(a.key) !== on) await toggle(a.key, on);");
  });
});
