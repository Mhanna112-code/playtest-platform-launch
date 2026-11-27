import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { closeSoonKey, closeSoonMarkDue, runDaily } from "@/lib/server/holds";
import { T, renderTimes } from "@/lib/tz";
import { setup } from "./fixtures";

// (Owner, Nov 27 2026) Every countdown (the developer's review reminders, the tester's own deadline, Closing soon, Open until's heads-ups) gets ONE fresh line
// exactly when the date it shows moves to a LATER calendar day (in the reader's zone) than the date its last line named. Moved within the same day: nothing (marks
// re-key silently). Wording: the latest mark passed for the new date; none passed, the plain line naming only the date (Open until, own deadline, Closing soon);
// the review lines have no plain wording, so nothing then (the next mark comes on schedule). Never twice for one date.

const DAY = 86_400_000, HOUR = 3_600_000;
const SENT = new Date("2026-11-01T12:00:00Z"); // work sent / joined / test made / Charge opened
const D = new Date("2026-11-20T12:00:00Z");
const at = (iso: string) => new Date(iso);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

type Due = { send: string | null; record: string[] };
type Series = { name: string; due: (date: Date, now: Date, rec: string[], tz?: string | null) => Due; key: (d: Date) => string; three: string; last: string; all: string[] };
/** The four countdowns, each as one function of (date, now, recorded); "date" = the plain line naming only the date (no mark). */
const SERIES: Series[] = [
  { name: "review", due: (d, now, rec, tz) => { const r = R.reviewMarkDue(SENT, d, now, rec, tz); return { send: r.send?.mark ?? null, record: r.record }; }, key: R.reviewMarkKey, three: "3d", last: "1d", all: ["2w", "1w", "3d", "1d"] },
  { name: "own deadline", due: (d, now, rec, tz) => { const r = R.ownDeadlineMarkDue({ id: "c1", joinedAt: SENT, dueAt: d }, rec, now, tz); return { send: r.send?.mark ?? null, record: r.record }; }, key: (d) => R.deadlineMarkKey("c1", d), three: "3d", last: "1d", all: ["1w", "3d", "1d"] },
  { name: "Open until", due: (d, now, rec, tz) => { const r = R.openUntilMarkDue({ openUntil: d, createdAt: SENT }, rec, now, tz); return { send: r.send?.mark ?? null, record: r.record }; }, key: R.openUntilMarkKey, three: "3d", last: "1d", all: ["1w", "3d", "1d"] },
  {
    name: "Closing soon",
    due: (d, now, rec, tz) => {
      const r = closeSoonMarkDue(d, SENT, now, rec, tz);
      // A fresh line with no mark passed sends the days left, recorded as "d<days>".
      return { send: r.send == null ? null : r.record.some((x) => /:d\d+$/.test(x)) ? "date" : String(r.send), record: r.record };
    },
    key: closeSoonKey,
    three: "3",
    last: "1",
    all: ["7", "3", "1"],
  },
];

/** One countdown's runs in memory (the job's pushes kept in `rec`). */
function track(s: Series, tz?: string | null) {
  const rec: string[] = [];
  const run = (date: Date, now: Date) => {
    const r = s.due(date, now, rec, tz);
    rec.push(...r.record);
    return r.send;
  };
  /** Daily runs at 13:00 UTC from Nov 2 to `last` (YYYY-MM-DD) inclusive; the marks sent. */
  const daily = (date: Date, last: string) => {
    const sent: string[] = [];
    for (let t = at("2026-11-02T13:00:00Z").getTime(); t <= at(`${last}T13:00:00Z`).getTime(); t += DAY) {
      const m = run(date, new Date(t));
      if (m) sent.push(m);
    }
    return sent;
  };
  return { rec, run, daily };
}

describe("(Owner, Nov 27 2026) a countdown's fresh line when the date shown moves to a later day", () => {
  for (const s of SERIES) {
    describe(s.name, () => {
      it("e. no move: the marks as before", () => {
        const t = track(s);
        expect(t.daily(D, "2026-11-21")).toEqual(s.all);
      });

      it("a. a few hours' pause after the last mark, the date still the same day: no fresh line (marks re-keyed silently)", () => {
        const t = track(s);
        expect(t.daily(D, "2026-11-19")).toEqual(s.all);
        const moved = plus(D, 4 * HOUR); // Nov 20, 4 PM UTC: still Nov 20
        for (const now of ["2026-11-19T18:00:00Z", "2026-11-20T09:00:00Z", "2026-11-20T15:00:00Z"]) expect(t.run(moved, at(now)), now).toBeNull();
        expect(t.rec).toContain(`${s.key(moved)}${s.last}`); // recorded as sent for the new date: nothing repeats
      });

      it("b. a 2-day pause after the 3-day mark: one fresh line at the lift naming the new date, then the 1-day mark on schedule; nothing repeats", () => {
        const t = track(s);
        expect(t.daily(D, "2026-11-17")).toEqual(s.all.slice(0, -1));
        const D2 = plus(D, 2 * DAY); // paused Nov 17, 2 PM to Nov 19, 2 PM
        expect(t.run(D2, at("2026-11-19T14:00:00Z"))).toBe(s.three); // the lift: "within 3 days (Nov 22)"
        expect(t.rec.filter((x) => x.startsWith(s.key(D2)) && !x.endsWith("seen"))).toContain(`${s.key(D2)}${s.three}`);
        expect(t.run(D2, at("2026-11-19T15:00:00Z"))).toBeNull();
        expect(t.run(D2, at("2026-11-20T13:00:00Z"))).toBeNull();
        expect(t.run(D2, at("2026-11-21T13:00:00Z"))).toBe(s.last); // the new date's 1-day mark
        expect(t.run(D2, at("2026-11-21T18:00:00Z"))).toBeNull();
        expect(t.run(D2, at("2026-11-22T06:00:00Z"))).toBeNull();
      });

      it("c. a 2-day pause after the 1-day mark: one fresh line naming the new date", () => {
        const t = track(s);
        expect(t.daily(D, "2026-11-19")).toEqual(s.all);
        const D2 = plus(D, 2 * DAY); // paused Nov 19, 2 PM to Nov 21, 2 PM
        expect(t.run(D2, at("2026-11-21T14:00:00Z"))).toBe(s.last);
        expect(t.rec).toContain(`${s.key(D2)}${s.last}`);
        expect(t.run(D2, at("2026-11-21T18:00:00Z"))).toBeNull();
        expect(t.run(D2, at("2026-11-22T06:00:00Z"))).toBeNull();
      });

      it("the day is the reader's: a move that stays on the same day in UTC but crosses midnight in Chicago (and the reverse)", () => {
        // Nov 21, 3 AM UTC is Nov 20, 9 PM in Chicago; 4 hours later: Nov 21 in both.
        const late = at("2026-11-21T03:00:00Z");
        for (const [tz, want] of [["UTC", null], ["America/Chicago", s.last]] as const) {
          const t = track(s, tz);
          const first = t.run(late, plus(late, -DAY + HOUR));
          expect(first).toBe(s.last);
          expect(t.run(plus(late, 4 * HOUR), plus(late, -DAY + 5 * HOUR)), tz).toBe(want); // after the moved date's 1-day mark
        }
        // Nov 20, 10 PM UTC is Nov 20, 4 PM in Chicago; 4 hours later: Nov 21 in UTC, still Nov 20 in Chicago.
        const evening = at("2026-11-20T22:00:00Z");
        for (const [tz, want] of [["UTC", s.last], ["America/Chicago", null]] as const) {
          const t = track(s, tz);
          expect(t.run(evening, plus(evening, -DAY + HOUR))).toBe(s.last);
          expect(t.run(plus(evening, 4 * HOUR), plus(evening, -DAY + 5 * HOUR)), tz).toBe(want);
        }
      });
    });
  }

  describe("d. the date moved far (beyond the series' first mark)", () => {
    it("review: no mark passed for the new date: no line (no accurate wording); its next mark comes on schedule naming it", () => {
      const s = SERIES[0];
      const t = track(s);
      const D7 = at("2026-11-08T12:00:00Z"); // 7 days after sending: 3 days and 1 day
      expect(t.daily(D7, "2026-11-05")).toEqual(["3d"]);
      const far = at("2026-11-20T12:00:00Z"); // the tester's deadline extended: 15 days left, its first mark (2 weeks) still ahead
      expect(t.run(far, at("2026-11-05T14:00:00Z"))).toBeNull();
      expect(t.run(far, at("2026-11-05T18:00:00Z"))).toBeNull();
      expect(t.run(far, at("2026-11-06T13:00:00Z"))).toBe("2w"); // "within 2 weeks (Nov 20)"
      expect(t.daily(far, "2026-11-21")).toEqual(["1w", "3d", "1d"]);
    });

    it("review: a mark already passed for the new date: the fresh line in its wording", () => {
      const t = track(SERIES[0]);
      expect(t.daily(D, "2026-11-17")).toEqual(["2w", "1w", "3d"]);
      const far = at("2026-12-10T12:00:00Z"); // 23 days left: its 1-month mark (Nov 10) has passed
      expect(t.run(far, at("2026-11-17T14:00:00Z"))).toBe("1m"); // "within 1 month (Dec 10)"
      expect(t.run(far, at("2026-11-17T18:00:00Z"))).toBeNull();
      expect(t.run(far, at("2026-11-19T13:00:00Z"))).toBe("3w");
    });

    for (const s of SERIES.slice(1)) {
      it(`${s.name}: no mark passed for the new date: the plain line naming it at once, then its marks on schedule`, () => {
        const t = track(s);
        expect(t.daily(D, "2026-11-13")).toEqual(s.all.slice(0, 1));
        const far = at("2026-12-31T12:00:00Z");
        expect(t.run(far, at("2026-11-13T14:00:00Z"))).toBe("date");
        expect(t.run(far, at("2026-11-13T18:00:00Z"))).toBeNull(); // never twice
        const month = s.name === "Closing soon" ? "30" : "1m";
        const sent: string[] = [];
        for (let d = at("2026-11-14T13:00:00Z").getTime(); d < far.getTime(); d += DAY) {
          const m = t.run(far, new Date(d));
          if (m) sent.push(m);
        }
        expect(sent).toEqual([month, ...s.all]);
      });
    }

    it("Closing soon's plain fresh line: `send` is the days left", () => {
      const rec: string[] = [];
      for (const now of ["2026-11-02T13:00:00Z", "2026-11-13T13:00:00Z"]) rec.push(...closeSoonMarkDue(D, SENT, at(now), rec).record);
      const far = at("2026-12-31T12:00:00Z");
      const r = closeSoonMarkDue(far, SENT, at("2026-11-13T14:00:00Z"), rec);
      expect(r.send).toBe(48);
      expect(r.record).toContain(`${closeSoonKey(far)}d48`);
    });
  });
});

describe("(fake clock) Open until moved 2 days after its 1-day heads-up: one fresh heads-up naming the new date", () => {
  it("the daily job", async () => {
    const { dev, testId } = await setup({ openUntil: new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10) });
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    const ou = t.openUntil!;
    const lines = async () => (await db.notification.findMany({ where: { userId: dev.user.id, reminderKey: `headsup:${testId}` }, orderBy: { createdAt: "asc" } })).map((n) => n.text);
    const name = (d: Date) => renderTimes(T(d, "date"), "UTC");
    await runDaily(new Date(ou.getTime() - DAY + 60_000));
    expect(await lines()).toEqual([expect.stringContaining(`closes to new testers on ${name(ou)}.`)]);
    const later = plus(ou, 2 * DAY);
    await db.test.update({ where: { id: testId }, data: { openUntil: later } });
    await runDaily(new Date(ou.getTime() - DAY + HOUR));
    await runDaily(new Date(ou.getTime() - DAY + 2 * HOUR));
    expect((await lines()).slice(1)).toEqual([expect.stringContaining(`closes to new testers on ${name(later)}.`)]);
    await runDaily(new Date(later.getTime() - DAY + 60_000)); // the new date's 1-day heads-up
    expect((await lines()).slice(2)).toEqual([expect.stringContaining(name(later))]);
  }, 180_000);
});
