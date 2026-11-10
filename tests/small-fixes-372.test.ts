import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { configProblems } from "@/lib/server/config";

// (Nov 10, §372) Found while writing the code guide: small fixes within rules already decided.
const src = (p: string) => readFileSync(p, "utf8");
const NOW = new Date("2026-11-10T12:00:00Z");

describe("§372", () => {
  it("RACE_HOLDS left on the live site is flagged in the admin's settings box (it is ignored there either way)", () => {
    const msgs = configProblems({ NODE_ENV: "production", RACE_HOLDS: "1" }, NOW).map((p) => p.message);
    expect(msgs).toContain("RACE_HOLDS is a testing setting: remove it from the live site.");
    expect(src("docs/TEST-ONLY-SETTINGS.md")).toContain("`RACE_HOLDS=1`");
  });

  it("a paused Send's line that already names the press shows alone (never 'Your Send Answers didn't go through: … so your Send Answers didn't go through.')", () => {
    const s = src("src/app/app/sessions/[id]/SessionActions.tsx");
    expect(s).toMatch(/\/didn\['’\]t go through\/\.test\(now \|\| message\) \? null :/);
  });

  it("Send Answers, Add and a recording's Send / Add name their press when the work closes at the gate (\"This test ended, so your Send Answers didn't go through.\")", () => {
    expect(src("src/lib/server/terms.ts")).toMatch(/assertWorkOpen\(db, c\.testId, new Date\(\), press\)/);
    const tests = src("src/lib/server/tests.ts");
    expect(tests.match(/testerSendGate\([^)]*"Send Answers"\)/g)?.length).toBe(3);
    expect(tests.match(/testerSendGate\([^)]*"Add"\)/g)?.length).toBe(3);
    const rec = src("src/lib/server/recordings.ts");
    expect(rec.match(/testerSendGate\(contractId, body, sent\?\.id\)/g)).toBeNull();
  });
});
