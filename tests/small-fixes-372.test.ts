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
    // (Owner, Nov 11, §376) The notice is always today's one line, naming the press once: "This test is paused right now, so your Send Answers didn't go through."
    expect(s).toContain('data-paused-send="">{RF.pressRefused(RF.PAUSED_CAUSE, label)}</p>');
    expect(s).not.toContain("Your {label} didn&apos;t go through:");
  });
  it("Send Answers, Add and a recording's Send / Add name their press when the work closes (\"This test ended, so your Send Answers didn't go through.\")", () => {
    // (Owner, Nov 11, §375) Checked in each press's one pass (partOver, with the press's name), no longer at the gate.
    const tests = src("src/lib/server/tests.ts");
    expect(tests).toMatch(/assertWorkOpen\(tx, c\.testId, new Date\(\), press\)/);
    expect(tests).toContain('const press = "Send Answers";');
    expect(tests).toContain('const press = "Add";');
    expect(tests.match(/await partOver\(tx, contractId, press, run\)/g)?.length).toBe(2);
    expect(src("src/lib/server/recordings.ts")).toContain("await partOver(tx, contractId, press, run)");
  });
});
