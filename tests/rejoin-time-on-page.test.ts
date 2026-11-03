import fs from "node:fs";
import { describe, expect, it } from "vitest";

// (Owner, Nov 2) A tester who left reads, on the test's page itself, the time a rejoin gives back (not only under Ask to rejoin).
describe("rejoin time on the test's page", () => {
  it("says how long they had left and that it comes back", () => {
    const src = fs.readFileSync("src/app/app/find/[id]/page.tsx", "utf8");
    expect(src).toContain("` You had ${leftText(mine.dueAt.getTime() - mine.endedAt.getTime())} left, and that's what you get back.`");
  });
});
