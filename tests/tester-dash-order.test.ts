import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// (Owner, Nov 4) The tester dashboard: To do first, then Ratings to give, then Waiting for the developer; the rest below as before.
describe("the tester dashboard's order", () => {
  const src = readFileSync("src/app/app/page.tsx", "utf8");
  const at = (s: string) => {
    const i = src.indexOf(s);
    expect(i, s).toBeGreaterThan(-1);
    return i;
  };
  // (Codex cb4d9f15) Charge or cancel moved above To do; (Codex eb8ca7cd) the removed tests are in Previous Tests, last.
  it("Charge or cancel, To do, Ratings to give, Waiting for the developer, Upcoming calls, Invitations, then Previous Tests", () => {
    const order = [
      'id="charge-or-cancel"',
      'id="to-do"',
      '<RatingsToGive user={user} side="tester" />',
      '"Waiting for the developer"',
      'id="upcoming-calls"',
      'id="invitations"',
      'id="previous-tests"',
    ].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
