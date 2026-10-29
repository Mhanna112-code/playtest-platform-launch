import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { runDaily } from "@/lib/server/holds";
import { findTests } from "@/lib/server/tests";
import { makeUser } from "./helpers";
import { act, joined, listingBody, sact, seen, settle, setup } from "./fixtures";

// Batch 15 sections 2, 18 and 32: review reminders on one schedule; every tester gets the same number of days; Open until counted in the developer's own date.
const DAY = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);

describe("review reminders (section 2)", () => {
  const sent = new Date("2026-11-01T12:00:00Z");
  const marks = (reviewDate: Date) => R.reviewMarksFor(sent, reviewDate).map((m) => `${m.mark} ${day(m.at)}`);
  it("a part sent 20 days before its deadline: 2 weeks, 1 week, 3 days, 1 day (3 weeks is already past, the month never applies)", () => {
    const review = R.reviewDateOf(R.payByFrom(sent), new Date(sent.getTime() + 20 * DAY));
    expect(marks(review)).toEqual(["2w 2026-11-07", "1w 2026-11-14", "3d 2026-11-18", "1d 2026-11-20"]);
  });
  it("a part sent 2 days before its deadline: the review date is sent + 7; no duplicate on the sending day: 3 days, 1 day", () => {
    const review = R.reviewDateOf(R.payByFrom(sent), new Date(sent.getTime() + 2 * DAY));
    expect(review.toISOString()).toBe("2026-11-08T12:00:00.000Z");
    expect(marks(review)).toEqual(["3d 2026-11-05", "1d 2026-11-07"]);
  });
  it("25 days away: 3 weeks, 2 weeks, 1 week, 3 days, 1 day; 40 days away adds the month", () => {
    expect(marks(new Date(sent.getTime() + 25 * DAY)).map((x) => x.split(" ")[0])).toEqual(["3w", "2w", "1w", "3d", "1d"]);
    expect(marks(new Date(sent.getTime() + 40 * DAY)).map((x) => x.split(" ")[0])).toEqual(["1m", "3w", "2w", "1w", "3d", "1d"]);
  });

  for (const listed of [true, false]) {
    it(`(fake clock, ${listed ? "listed" : "unlisted"}) the daily job sends each mark once on its day, then ${listed ? "opens Charge" : "stops, with no Charge"}`, async () => {
      const { dev, testId } = await setup(listed ? {} : { writtenCents: null, questions: [] });
      const { tester, sessionId } = await joined(testId);
      const n = ((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).questions as string[]).length || 1;
      await sact(sessionId, "written", tester.cookie, { answers: Array(n).fill("answer") });
      await settle();
      const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
      // The tester's deadline 20 days after sending.
      const t0 = sub.updatedAt;
      await db.contract.update({ where: { id: sessionId }, data: { dueAt: new Date(t0.getTime() + 20 * DAY) } });
      const got: string[] = [];
      for (let d = 1; d <= 22; d++) {
        const at = new Date(t0.getTime() + d * DAY + 60_000);
        await runDaily(at);
        const s = await db.submission.findUniqueOrThrow({ where: { id: sub.id } });
        if (s.devMarks.length > got.length) got.push(`${s.devMarks[s.devMarks.length - 1]}@day${d}`);
      }
      expect(got).toEqual(["2w@day6", "1w@day13", "3d@day17", "1d@day19"]);
      expect(await db.notification.count({ where: { userId: dev.user.id, reminderKey: `unreviewed:${sub.id}` } })).toBeGreaterThanOrEqual(4);
      const s = await db.submission.findUniqueOrThrow({ where: { id: sub.id } });
      if (listed) expect(s.choiceOfferedAt).not.toBeNull();
      else expect(s.choiceOfferedAt).toBeNull();
    }, 120_000);
  }
});

describe("tester days (section 18)", () => {
  it("every tester gets the same days from when THEY join; joining closes at Open until; Edit +5 days moves everyone", async () => {
    const { dev, testId } = await setup({ openUntil: new Date(Date.now() + 14 * DAY).toISOString().slice(0, 10) });
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect(t.testerDays).toBe(14);
    const a = await joined(testId, "Ana Silva");
    expect(day((await db.contract.findUniqueOrThrow({ where: { id: a.sessionId } })).dueAt)).toBe(day(t.openUntil!)); // day 1: due on Open until
    // A tester joining on day 13: due 14 days after.
    const late = R.dueFromJoin(new Date(Date.now() + 12 * DAY), 14);
    expect(day(late)).toBe(day(new Date(Date.now() + 26 * DAY)));
    expect(day(R.dueFromJoin(new Date(Date.now() + 14 * DAY), 14))).toBe(day(new Date(Date.now() + 28 * DAY))); // the last day
    // Edit: Open until 5 days later → 19 days, and the working tester's deadline +5.
    const before = (await db.contract.findUniqueOrThrow({ where: { id: a.sessionId } })).dueAt;
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { openUntil: new Date(Date.now() + 19 * DAY).toISOString().slice(0, 10) }, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).testerDays).toBe(19);
    expect((await db.contract.findUniqueOrThrow({ where: { id: a.sessionId } })).dueAt.getTime() - before.getTime()).toBe(5 * DAY);
    // After Open until: refused, out of Find; the working tester carries on.
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() - 60_000) } });
    const b = await makeUser({ tester: true, name: "Ben Okafor" });
    const r = await act(testId, "join", b.cookie, { listingVersion: (await db.test.findUniqueOrThrow({ where: { id: testId } })).listingVersion });
    expect(r.body.error.message).toMatch(/^This test closed to new testers on [A-Z][a-z]{2} \d{1,2}\.$/);
    expect((await findTests(b.user as never)).some((x) => x.id === testId)).toBe(false);
    expect((await db.contract.findUniqueOrThrow({ where: { id: a.sessionId } })).status).toBe("working");
  });

  it("Charge opens from each tester's own deadline (or sent + 7, whichever is later); pending applications close at Open until", async () => {
    const payBy = new Date("2026-11-08T00:00:00Z");
    expect(R.chargeOpensAt({ payBy }, { openUntil: new Date("2026-11-30T23:59:59Z"), status: "open" }, { status: "working", dueAt: new Date("2026-11-20T23:59:59Z") })!.toISOString()).toBe("2026-11-20T23:59:59.000Z");
    expect(R.chargeOpensAt({ payBy }, { openUntil: new Date("2026-11-30T23:59:59Z"), status: "open" }, { status: "working", dueAt: new Date("2026-11-03T23:59:59Z") })!.toISOString()).toBe("2026-11-08T00:00:00.000Z");
    const { testId } = await setup({ joinMode: "apply" });
    const t = await makeUser({ tester: true });
    await db.application.create({ data: { testId, testerId: t.user.id, listing: {} } });
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() - 60_000) } });
    await runDaily();
    expect((await db.application.findFirstOrThrow({ where: { testId } })).status).toBe("closed");
  });

  it("wording: Post's hint, Find and the listing, the join page, terms lines", () => {
    expect(R.openUntilLine("2026-11-20", 14)).toBe("Testers can join until this date. Each gets 14 days from when they join, so someone joining on Nov 20 has until Dec 4 to send work. You pay each piece within 7 days of it arriving or by that tester's deadline, whichever is later, or the tester can charge you."); // (batch 19 section 8)
    const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    expect(R.perTesterLine(14, new Date("2026-11-20T23:59:59Z"), fmt)).toBe("14 days per tester · join by Nov 20");
    expect(R.yourDeadlineLine(new Date("2026-12-03T23:59:59Z"), 14, fmt)).toBe("Your deadline: Dec 3 (14 days from joining)");
    expect(R.joiningClosedLine(new Date("2026-12-03T23:59:59Z"), fmt)).toBe("Joining closed · testers working until Dec 3");
    expect(R.closedToNewLine(new Date("2026-11-20T23:59:59Z"), fmt)).toBe("This test closed to new testers on Nov 20.");
  });
});

describe("Open until in the developer's own date (section 32)", () => {
  it("8 PM in Chicago (already the next day in UTC): the picker's earliest date is accepted", () => {
    const now = new Date("2026-11-06T02:00:00Z"); // Nov 5, 8 PM in Chicago
    const l = { ...listingBody(), writtenCents: 1000, recordingCents: null, liveRateCents: 3000, liveMinutes: 30, mature: false, matureWhy: "", ndaText: "", joinMode: "anyone" } as unknown as R.Listing;
    const errs = (date: string, tz?: string) => R.checkListing({ ...l, openUntil: `${date}T23:59:59.000Z` }, 0, now, { tz });
    expect(errs("2026-11-08", "America/Chicago")).not.toContain(R.OPEN_UNTIL_RANGE); // today (Nov 5) + 3
    expect(errs("2026-11-08", "UTC")).toContain(R.OPEN_UNTIL_RANGE); // in UTC it's already Nov 6
    expect(errs("2026-11-07", "America/Chicago")).toContain(R.OPEN_UNTIL_RANGE);
  });
});
