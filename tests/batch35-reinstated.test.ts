import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Batch 35 §72 (owner, Oct 31).
const src = (f: string) => fs.readFileSync(path.join(process.cwd(), "src", f), "utf8");
describe("batch 35 §72", () => {
  it("Stop / End early go to the dashboard only while the account is still restricted", () => {
    const t = src("app/app/tests/[id]/TopPanel.tsx");
    expect(t).toContain('(action === "stop" || action === "end-early") && (await stillRestricted())');
    expect(t).toContain('fetch("/api/account/status"');
  });
  it("(owner, Oct 31) the reinstated line stays for 3 days, as before", () => {
    expect(src("app/app/page.tsx")).toContain("now.getTime() - back.getTime() < 3 * DAY");
    expect(src("app/app/page.tsx")).not.toContain("OnceNote");
  });
});
