import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { dayIn, daysPerTester, dueFromJoin, endOfDayIn, joinerDays, testerDaysOf, yourDeadlineLine } from "@/lib/rules";
import { fmtIn } from "@/lib/tz";
import { POST as postTest } from "@/app/api/tests/route";
import { json, makeUser, req } from "./helpers";
import { act, listingBody, sact, seen } from "./fixtures";

const CENTRAL = "America/Chicago";
const DAY = 86_400_000;
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

async function fixture(zone = CENTRAL, joinMode = "anyone") {
  // Late on Nov 1 in the developer's zone; Chicago is already Nov 2 in UTC.
  vi.setSystemTime(new Date(endOfDayIn("2026-11-01", zone).getTime() - 30 * 60_000));
  const dev = await makeUser({ dev: true });
  await db.user.update({ where: { id: dev.user.id }, data: { timeZone: zone } });
  const posted = await json(await postTest(req("/api/tests", { cookie: dev.cookie, body: listingBody({ openUntil: "2026-11-27", timeZone: zone, spots: 10, joinMode }) })));
  expect(posted.status, JSON.stringify(posted.body)).toBe(200);
  const test = await db.test.findUniqueOrThrow({ where: { id: posted.body.id } });
  expect(test.testerDays).toBe(26);
  const tester = await makeUser({ tester: true });
  const join = async () => {
    const r = await act(test.id, "join", tester.cookie, { listingVersion: test.listingVersion });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return db.contract.findUniqueOrThrow({ where: { id: r.body.sessionId } });
  };
  return { dev, test, tester, join };
}

describe("§111: tester deadlines and Open until share the developer's day", () => {
  it.each([CENTRAL, "UTC"])("a Nov 1 join ends Nov 27 in %s, matching the listing's 26 days", async (zone) => {
    const f = await fixture(zone);
    const c = await f.join();
    expect(c.dueAt).toEqual(f.test.openUntil);
    expect(c.dueAt).toEqual(endOfDayIn("2026-11-27", zone));
    expect(fmtIn(zone, c.dueAt, "date")).toBe("Nov 27");
    const days = joinerDays(f.test, zone);
    expect(days).toBe(26);
    expect(yourDeadlineLine(c.dueAt, days, (d) => fmtIn(zone, d, "date"))).toBe("Your deadline: Nov 27 (26 days from joining)");
  });

  it("accepting an application uses the same zoned deadline", async () => {
    const f = await fixture(CENTRAL, "apply");
    expect((await act(f.test.id, "apply", f.tester.cookie, { note: "I would like to test this." })).status).toBe(200);
    const a = await db.application.findFirstOrThrow({ where: { testId: f.test.id, testerId: f.tester.user.id } });
    const accepted = await act(f.test.id, "application", f.dev.cookie, { applicationId: a.id, action: "accept", seenAt: seen(), confirmed: true });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect((await db.contract.findUniqueOrThrow({ where: { id: accepted.body.sessionId } })).dueAt).toEqual(endOfDayIn("2026-11-27", CENTRAL));
  });

  it("joining from an invite uses the same zoned deadline", async () => {
    const f = await fixture(CENTRAL, "invite");
    const invited = await act(f.test.id, "invite", f.dev.cookie, { testerIds: [f.tester.user.id], seenAt: seen(), confirmed: true });
    expect(invited.status, JSON.stringify(invited.body)).toBe(200);
    expect((await f.join()).dueAt).toEqual(endOfDayIn("2026-11-27", CENTRAL));
  });

  it("rejoining restores the remaining time from the correctly zoned original deadline", async () => {
    const f = await fixture();
    const original = await f.join();
    vi.setSystemTime(new Date("2026-11-02T18:00:00Z"));
    expect((await sact(original.id, "leave", f.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    const left = await db.contract.findUniqueOrThrow({ where: { id: original.id } });
    vi.setSystemTime(new Date("2026-11-04T18:00:00Z"));
    expect((await act(f.test.id, "rejoin-ask", f.tester.cookie, { listingVersion: f.test.listingVersion })).status).toBe(200);
    const a = await db.application.findFirstOrThrow({ where: { testId: f.test.id, testerId: f.tester.user.id, kind: "rejoin" } });
    const accepted = await act(f.test.id, "application", f.dev.cookie, { applicationId: a.id, action: "accept", seenAt: seen(), confirmed: true });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const back = await db.contract.findUniqueOrThrow({ where: { id: original.id } });
    expect(back.dueAt.getTime() - Date.now()).toBe(original.dueAt.getTime() - left.endedAt!.getTime());
    expect(back.dueAt).toEqual(endOfDayIn("2026-11-29", CENTRAL));
  });

  it.each([CENTRAL, "UTC"])("Edit +2 days moves the deadline and allowance +2 days in %s", async (zone) => {
    const f = await fixture(zone);
    const c = await f.join();
    const saved = await act(f.test.id, "edit", f.dev.cookie, { version: f.test.version, fields: { openUntil: "2026-11-29" }, timeZone: zone, confirmed: true, seenAt: seen() });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const t = await db.test.findUniqueOrThrow({ where: { id: f.test.id } });
    const moved = await db.contract.findUniqueOrThrow({ where: { id: c.id } });
    expect(moved.dueAt.getTime() - c.dueAt.getTime()).toBe(2 * DAY);
    expect(moved.dueAt).toEqual(endOfDayIn("2026-11-29", zone));
    expect(t.testerDays).toBe(28);
  });

  it("Switch keeps the deadline already assigned using Open until's zone", async () => {
    const f = await fixture();
    const c = await f.join();
    expect((await act(f.test.id, "edit", f.dev.cookie, { version: f.test.version, fields: { writtenCents: "12.00" }, confirmed: true, seenAt: seen() })).status).toBe(200);
    const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: c.id, status: "open" } });
    const switched = await sact(c.id, "terms", f.tester.cookie, { choice: "switch", offerId: offer.id, confirmed: true, seenAt: seen() });
    expect(switched.status, JSON.stringify(switched.body)).toBe(200);
    expect((await db.contract.findUniqueOrThrow({ where: { id: c.id } })).dueAt).toEqual(c.dueAt);
  });

  it.each([
    ["2026-10-31T17:00:00Z", "2026-11-01", "2026-11-02T05:59:59.000Z"],
    ["2027-03-13T18:00:00Z", "2027-03-14", "2027-03-15T04:59:59.000Z"],
  ])("a calendar day across a clock change ends at local midnight (%s)", (joined, day, instant) => {
    const due = dueFromJoin(new Date(joined), 1, CENTRAL);
    expect(due.toISOString()).toBe(instant);
    expect(dayIn(due, CENTRAL)).toBe(day);
  });

  it("older listings without stored tester days count the same calendar dates", () => {
    const createdAt = new Date("2026-11-01T12:00:00Z");
    const openUntil = endOfDayIn("2026-11-27", CENTRAL);
    const listing = { testerDays: null, createdAt, openUntil, deadlineDays: 7, developer: { timeZone: CENTRAL } };
    expect(testerDaysOf(createdAt, openUntil, CENTRAL)).toBe(26);
    expect(joinerDays(listing, CENTRAL)).toBe(26);
    expect(daysPerTester(listing)).toBe(26);
  });
});
