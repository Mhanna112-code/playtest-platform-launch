import { describe, expect, it } from "vitest";
import { callOverBadge } from "@/lib/callMeasure";

describe("(Owner, Nov 6) §300 a cancelled call's time names the day when it isn't today", () => {
  const x = { status: "cancelled", cancelledBy: "developer", cancelledAt: new Date("2026-11-06T14:48:00Z"), cancelNote: "", review: null };
  const who = { developer: "fbbb", tester: "bb" };
  it("uses the caller's fmtWhen (time today, date and time on another day)", () => {
    expect(callOverBadge(x, who, "tester", () => "8:48 AM", 0, 30, () => "Fri, Nov 6, 8:48 AM").label).toBe("Cancelled by fbbb · Fri, Nov 6, 8:48 AM");
    expect(callOverBadge(x, who, "tester", () => "8:48 AM", 0, 30).label).toBe("Cancelled by fbbb · 8:48 AM");
  });
});
