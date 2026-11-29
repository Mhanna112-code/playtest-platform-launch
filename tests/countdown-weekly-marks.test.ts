import { describe, expect, it } from "vitest";
import * as R from "@/lib/rules";

// (Owner, Nov 29 2026) Open until's heads-ups and the tester's own deadline count down on the review reminders' marks:
// 1 month, 3 weeks, 2 weeks, 1 week, 3 days, 1 day.
const DAY = 86_400_000;

/** Runs openUntilMarkDue once a day (09:00 UTC) from the test's making until Open until; returns each mark sent, in order. */
function openUntilRun(createdAt: Date, openUntil: Date) {
  const recorded: string[] = [];
  const sent: string[] = [];
  for (let now = new Date(createdAt.getTime() + DAY); now < openUntil; now = new Date(now.getTime() + DAY)) {
    const due = R.openUntilMarkDue({ openUntil, createdAt }, recorded, now, "UTC");
    recorded.push(...due.record);
    if (due.send) sent.push(due.send.mark);
  }
  return sent;
}

describe("Open until's heads-ups use the weekly marks", () => {
  const createdAt = new Date("2026-11-01T09:00:00Z");
  for (const [days, marks] of [[45, ["1m", "3w", "2w", "1w", "3d", "1d"]], [25, ["3w", "2w", "1w", "3d", "1d"]], [16, ["2w", "1w", "3d", "1d"]], [10, ["1w", "3d", "1d"]]] as const) {
    it(`Open until ${days} days after the test was made: ${marks.join(", ")}`, () => {
      expect(openUntilRun(createdAt, new Date(createdAt.getTime() + days * DAY + 12 * 3_600_000))).toEqual(marks);
    });
  }
  it("a mark that was already behind when the test was made never sends a line on the first run", () => {
    // Made 10 days out: 3 weeks and 2 weeks were behind at making, so the first run (9 days left) sends nothing.
    const openUntil = new Date(createdAt.getTime() + 10 * DAY + 12 * 3_600_000);
    expect(R.openUntilMarkDue({ openUntil, createdAt }, [], new Date(createdAt.getTime() + DAY), "UTC").send).toBeNull();
  });
});
