import { describe, expect, it } from "vitest";
import * as R from "@/lib/rules";

// (Owner, Nov 11, §383) One rule for every repeating line: due when there was none, or when the last one was `everyDays` or more UTC calendar days earlier AND
// at least 12 hours ago.
const at = (s: string) => new Date(s);

describe("§383 repeatDue", () => {
  it("the first time is always due", () => {
    expect(R.repeatDue(null, at("2026-11-11T09:00:00Z"))).toBe(true);
    expect(R.repeatDue(undefined, at("2026-11-11T09:00:00Z"), 3)).toBe(true);
  });

  it("never twice on the same UTC day, however long ago", () => {
    expect(R.repeatDue(at("2026-11-11T00:05:00Z"), at("2026-11-11T09:00:00Z"))).toBe(false);
    expect(R.repeatDue(at("2026-11-11T00:00:00Z"), at("2026-11-11T23:59:59Z"))).toBe(false);
  });

  it("the next UTC day: due at 12 hours or more, not under", () => {
    expect(R.repeatDue(at("2026-11-10T22:00:00Z"), at("2026-11-11T09:00:00Z"))).toBe(false); // 11 h: the 22:00 first line isn't followed at 09:00
    expect(R.repeatDue(at("2026-11-10T21:00:00Z"), at("2026-11-11T09:00:00Z"))).toBe(true); // exactly 12 h
    expect(R.repeatDue(at("2026-11-10T09:00:00Z"), at("2026-11-11T09:00:00Z"))).toBe(true);
    // The daily job a little EARLIER than yesterday's (no drift: still due the next calendar day).
    expect(R.repeatDue(at("2026-11-10T09:04:00Z"), at("2026-11-11T09:00:30Z"))).toBe(true);
    // Two days later is due whatever the hour.
    expect(R.repeatDue(at("2026-11-09T23:00:00Z"), at("2026-11-11T00:30:00Z"))).toBe(true);
  });

  it("every 3 days: 3 or more calendar days earlier, and at least 12 hours", () => {
    expect(R.repeatDue(at("2026-11-08T09:00:00Z"), at("2026-11-10T09:00:00Z"), 3)).toBe(false); // 2 days
    expect(R.repeatDue(at("2026-11-08T09:00:00Z"), at("2026-11-11T08:00:00Z"), 3)).toBe(true); // 3 calendar days, under 3 × 24 h
    expect(R.repeatDue(at("2026-11-08T23:30:00Z"), at("2026-11-11T00:10:00Z"), 3)).toBe(true); // 3 calendar days, 48 h 40 min
    expect(R.repeatDue(at("2026-11-08T00:10:00Z"), at("2026-11-10T23:50:00Z"), 3)).toBe(false); // 71 h 40 min, but only 2 calendar days
  });

  it("month and year boundaries count calendar days", () => {
    expect(R.repeatDue(at("2026-10-31T09:00:00Z"), at("2026-11-01T09:00:00Z"))).toBe(true);
    expect(R.repeatDue(at("2026-10-31T23:00:00Z"), at("2026-11-01T09:00:00Z"))).toBe(false); // 10 h
    expect(R.repeatDue(at("2026-02-27T09:00:00Z"), at("2026-03-02T09:00:00Z"), 3)).toBe(true); // Feb 27 → Mar 2: 3 days (2026 isn't a leap year)
    expect(R.repeatDue(at("2026-02-28T09:00:00Z"), at("2026-03-02T09:00:00Z"), 3)).toBe(false); // 2 days
    expect(R.repeatDue(at("2026-12-31T09:00:00Z"), at("2027-01-01T09:00:00Z"))).toBe(true);
  });

  it("the summaries follow it: daily 1, weekly 7, monthly 30 calendar days", () => {
    const now = at("2026-11-11T09:00:00Z");
    expect(R.summaryDue("daily", at("2026-11-10T09:05:00Z"), now)).toBe(true); // yesterday's run a few minutes later: still due today
    expect(R.summaryDue("daily", at("2026-11-11T00:05:00Z"), now)).toBe(false);
    expect(R.summaryDue("weekly", at("2026-11-04T09:30:00Z"), now)).toBe(true);
    expect(R.summaryDue("weekly", at("2026-11-05T09:00:00Z"), now)).toBe(false);
    expect(R.summaryDue("monthly", at("2026-10-12T09:00:00Z"), now)).toBe(true);
    expect(R.summaryDue("monthly", at("2026-10-13T09:00:00Z"), now)).toBe(false);
    expect(R.summaryDue("off", null, now)).toBe(false);
  });
});
