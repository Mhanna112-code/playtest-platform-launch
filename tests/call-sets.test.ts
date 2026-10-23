import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { topUpForeverSets } from "@/lib/server/requests";
import { act, atHours, joined, sact, seen, setup } from "./fixtures";

// (NEXT-UI 7) Each time row has its own Once / Daily / Weekly and a count (2-8, or Forever). The other side picks ONE row; a
// repeating pick books the whole set (Forever: the next 4 ahead, the daily job adds the next). Cancel on the set is the only
// way to stop it.
const devReq = (testId: string, cookie: string, contractIds: string[], extra: Record<string, unknown>) =>
  act(testId, "request-time", cookie, { seenAt: seen(), confirmed: true, contractIds, ...extra });
const pending = (contractId: string, fromSide: string) => db.callRequest.findFirstOrThrow({ where: { contractId, fromSide, status: "pending" }, orderBy: { createdAt: "desc" } });
const DAY = 24;

describe("call request rows", () => {
  it("mixed rows: the other side picks ONE; a counted repeating pick books the whole set as 1 booked time", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const rows = [
      { startsAt: atHours(50), repeat: "once" },
      { startsAt: atHours(74), repeat: "weekly", count: 3 },
      { startsAt: atHours(98), repeat: "daily", count: 2 },
    ];
    expect((await devReq(testId, dev.cookie, [sessionId], { rows })).status).toBe(200);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: "Nora Lane asked for a call: pick one of 3 times" } })).toBe(1);
    const r = await pending(sessionId, "developer");
    expect((await sact(sessionId, "answer-request", tester.cookie, { requestId: r.id, action: "accept" })).body.error.message).toBe("Pick one of the times.");
    const done = await sact(sessionId, "answer-request", tester.cookie, { requestId: r.id, action: "accept", time: rows[1].startsAt });
    expect(done.body.calls).toBe(3);
    const calls = await db.call.findMany({ where: { contractId: sessionId }, orderBy: { startsAt: "asc" } });
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => c.setId)).size).toBe(1);
    expect(calls[1].startsAt.getTime() - calls[0].startsAt.getTime()).toBe(7 * DAY * 3_600_000);
    const set = await db.callSet.findUniqueOrThrow({ where: { id: calls[0].setId! } });
    expect(set).toMatchObject({ repeat: "weekly", count: 3, status: "active" });
  });

  it("rows are checked: 1-3 rows, repeat counts 2-8 or Forever, times in the future", async () => {
    const { dev, testId } = await setup();
    const { sessionId } = await joined(testId);
    const one = { startsAt: atHours(50), repeat: "weekly" };
    expect((await devReq(testId, dev.cookie, [sessionId], { rows: [{ ...one, count: 9 }] })).body.error.message).toBe("Weekly calls repeat 2 to 8 times, or Forever.");
    expect((await devReq(testId, dev.cookie, [sessionId], { rows: [{ ...one, count: 1 }] })).status).toBe(400);
    expect((await devReq(testId, dev.cookie, [sessionId], { rows: [] })).status).toBe(400);
    expect((await devReq(testId, dev.cookie, [sessionId], { rows: Array.from({ length: 4 }, (_, i) => ({ startsAt: atHours(50 + i * 30), repeat: "once" })) })).body.error.message).toBe("Offer up to 3 times to choose from.");
    expect((await devReq(testId, dev.cookie, [sessionId], { rows: [{ startsAt: new Date(Date.now() - 3_600_000).toISOString(), repeat: "once" }] })).status).toBe(400);
  });

  it("Forever: the next 4 are booked; the daily job adds the next as each passes; Cancel on the set stops it and nothing more is added", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await devReq(testId, dev.cookie, [sessionId], { rows: [{ startsAt: atHours(48), repeat: "weekly", count: "forever" }] });
    const r = await pending(sessionId, "developer");
    const acc = await sact(sessionId, "answer-request", tester.cookie, { requestId: r.id, action: "accept" });
    expect(acc.body.calls).toBe(4);
    const set = await db.callSet.findFirstOrThrow({ where: { contractId: sessionId } });
    expect(set.count).toBe(0);
    // The job with nothing passed adds nothing; when the first one has passed, the next one is booked.
    expect((await topUpForeverSets()).booked).toBe(0);
    const first = await db.call.findFirstOrThrow({ where: { setId: set.id }, orderBy: { startsAt: "asc" } });
    await db.call.update({ where: { id: first.id }, data: { startsAt: new Date(Date.now() - 3_600_000) } });
    expect((await topUpForeverSets()).booked).toBe(1);
    expect(await db.call.count({ where: { setId: set.id, status: "booked", startsAt: { gt: new Date() } } })).toBe(4);
    // A clash with another call of the developer is skipped (both told) and the next one is tried.
    await db.call.update({ where: { id: (await db.call.findFirstOrThrow({ where: { setId: set.id, startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } })).id }, data: { startsAt: new Date(Date.now() - 1_800_000) } });
    const after = await db.callSet.findUniqueOrThrow({ where: { id: set.id } });
    const other = await joined(testId, "Ben Ito");
    await db.callSlot.create({ data: { testId, startsAt: after.nextAt, minutes: 30, allowedTesterIds: [other.tester.user.id], status: "booked" } }).then((slot) =>
      db.call.create({ data: { slotId: slot.id, contractId: other.sessionId, startsAt: after.nextAt, minutes: 30 } }));
    const res = await topUpForeverSets();
    expect(res.skipped).toBe(1);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "was skipped" } } })).toBe(1);
    // Cancel: needs a reason when the next one is within 24 h; otherwise cancels them all.
    const next = await db.call.findFirstOrThrow({ where: { setId: set.id, status: "booked", startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } });
    await db.call.update({ where: { id: next.id }, data: { startsAt: new Date(Date.now() + 5 * 3_600_000) } });
    const noReason = await sact(sessionId, "cancel-set", tester.cookie, { seenAt: seen(), confirmed: true, setId: set.id });
    expect(noReason.status).toBe(400);
    const cancelled = await act(testId, "cancel-set", dev.cookie, { seenAt: seen(), confirmed: true, contractId: sessionId, setId: set.id, reason: "Not needed any more" });
    expect(cancelled.status).toBe(200);
    expect(await db.call.count({ where: { setId: set.id, status: "booked", startsAt: { gt: new Date() } } })).toBe(0);
    expect((await db.callSet.findUniqueOrThrow({ where: { id: set.id } })).status).toBe("cancelled");
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "cancelled the remaining weekly calls" } } })).toBe(1);
    expect((await topUpForeverSets()).booked).toBe(0);
  });

  it("a Forever set ends when the tester's part ends (they leave)", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await devReq(testId, dev.cookie, [sessionId], { rows: [{ startsAt: atHours(48), repeat: "daily", count: 0 }] });
    await sact(sessionId, "answer-request", tester.cookie, { requestId: (await pending(sessionId, "developer")).id, action: "accept" });
    await sact(sessionId, "leave", tester.cookie, { seenAt: seen(), confirmed: true });
    await topUpForeverSets();
    expect((await db.callSet.findFirstOrThrow({ where: { contractId: sessionId } })).status).toBe("ended");
    expect(await db.call.count({ where: { contractId: sessionId, status: "booked", startsAt: { gt: new Date() } } })).toBe(0);
  });
});
