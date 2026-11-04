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
  it("To do, Ratings to give, Waiting for the developer, then removed tests, Charge or cancel and Upcoming calls", () => {
    const order = [
      'id="to-do"',
      '<RatingsToGive user={user} side="tester" />',
      '"Waiting for the developer"',
      'id="suspended-tests"',
      'id="charge-or-cancel"',
      'id="upcoming-calls"',
      'id="invitations"',
    ].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
