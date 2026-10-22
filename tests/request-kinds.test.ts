import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { act, atHours, bookCall, joined, sact, seen, setup } from "./fixtures";

const DAY = 24;
const devReq = (testId: string, cookie: string, contractIds: string[], extra: Record<string, unknown>) =>
  act(testId, "request-time", cookie, { seenAt: seen(), confirmed: true, contractIds, ...extra });
const pending = (contractId: string, fromSide: string) => db.callRequest.findFirstOrThrow({ where: { contractId, fromSide, status: "pending" }, orderBy: { createdAt: "desc" } });

describe("request kinds", () => {
  it("'Choose one': up to 3 times; the tester picks one → one call", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const t = [atHours(50), atHours(74), atHours(98)];
    await devReq(testId, dev.cookie, [sessionId], { times: t });
    expect(await db.notification.count({ where: { userId: tester.user.id, text: "Nora Lane asked for a call: pick one of 3 times" } })).toBe(1);
    const r = await pending(sessionId, "developer");
    expect((await sact(sessionId, "answer-request", tester.cookie, { requestId: r.id, action: "accept" })).body.error.message).toBe("Pick one of the times.");
    await sact(sessionId, "answer-request", tester.cookie, { requestId: r.id, action: "accept", time: t[1] });
    const calls = await db.call.findMany({ where: { contractId: sessionId } });
    expect(calls).toHaveLength(1);
    expect(calls[0].startsAt.toISOString()).toBe(t[1]);
    expect((await devReq(testId, dev.cookie, [sessionId], { times: [atHours(10), atHours(11), atHours(12), atHours(13)] })).body.error.message).toBe("Offer up to 3 times to choose from.");
  });

  it("'Weekly': accepting books every week; cancelling one week leaves the rest booked", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await devReq(testId, dev.cookie, [sessionId], { times: [atHours(50)], weeks: 4 });
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { startsWith: "Nora Lane asked for weekly calls: " }, AND: { text: { endsWith: ", 4 weeks" } } } })).toBe(1);
    const r = await pending(sessionId, "developer");
    expect((await sact(sessionId, "answer-request", tester.cookie, { requestId: r.id, action: "accept" })).body.calls).toBe(4);
    const calls = await db.call.findMany({ where: { contractId: sessionId }, orderBy: { startsAt: "asc" } });
    expect(calls).toHaveLength(4);
    expect(calls[1].startsAt.getTime() - calls[0].startsAt.getTime()).toBe(7 * DAY * 3_600_000);
    expect((await sact(sessionId, "cancel-call", tester.cookie, { seenAt: seen(), confirmed: true, callId: calls[2].id })).status).toBe(200);
    expect(await db.call.count({ where: { contractId: sessionId, status: "booked" } })).toBe(3);
    expect((await devReq(testId, dev.cookie, [sessionId], { times: [atHours(400)], weeks: 9 })).body.error.message).toBe("Weekly calls repeat 2 to 8 times.");
  });

  it("limits: 3 pending requests per tester (both sides); 3 booked times (a set counts 1); a 4th is refused", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "request-time", tester.cookie, { times: [atHours(50)] });
    await devReq(testId, dev.cookie, [sessionId], { times: [atHours(60), atHours(61)] });
    await sact(sessionId, "request-time", tester.cookie, { times: [atHours(70)], weeks: 3 });
    expect((await sact(sessionId, "request-time", tester.cookie, { times: [atHours(80)] })).body.error.message).toBe("You already have 3 requests waiting with Nora Lane. Withdraw one or wait for an answer.");
    expect((await devReq(testId, dev.cookie, [sessionId], { times: [atHours(90)] })).body.error.message).toBe("You already have 3 requests waiting with Ana Silva. Withdraw one or wait for an answer.");
    // Booked: a single call, a daily set and another call = 3 booked times; accepting a 4th is refused.
    const s2 = await setup();
    const j = await joined(s2.testId);
    await bookCall(s2.testId, s2.dev.cookie, j.sessionId, j.tester.cookie, 40);
    await devReq(s2.testId, s2.dev.cookie, [j.sessionId], { times: [atHours(100)], weeks: 3, repeat: "daily" });
    await sact(j.sessionId, "answer-request", j.tester.cookie, { requestId: (await pending(j.sessionId, "developer")).id, action: "accept" });
    await bookCall(s2.testId, s2.dev.cookie, j.sessionId, j.tester.cookie, 300);
    await devReq(s2.testId, s2.dev.cookie, [j.sessionId], { times: [atHours(400)] });
    const r4 = await sact(j.sessionId, "answer-request", j.tester.cookie, { requestId: (await pending(j.sessionId, "developer")).id, action: "accept" });
    expect(r4.body.error.message).toBe("You already have 3 booked times in this test.");
    await sact(j.sessionId, "request-time", j.tester.cookie, { times: [atHours(500)] });
    const r5 = await act(s2.testId, "answer-request", s2.dev.cookie, { contractId: j.sessionId, requestId: (await pending(j.sessionId, "tester")).id, action: "accept", seenAt: seen(), confirmed: true });
    expect(r5.body.error.message).toBe("Ana Silva already has 3 booked times with you. Wait until one is over or cancel one.");
  });

  it("daily: one time repeated 2-8 days; accepting books every day", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await devReq(testId, dev.cookie, [sessionId], { times: [atHours(30)], weeks: 2, repeat: "daily" });
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { startsWith: "Nora Lane asked for daily calls: " } } })).toBe(1);
    const r = await pending(sessionId, "developer");
    await sact(sessionId, "answer-request", tester.cookie, { requestId: r.id, action: "accept" });
    const calls = await db.call.findMany({ where: { contractId: sessionId }, orderBy: { startsAt: "asc" } });
    expect(calls[1].startsAt.getTime() - calls[0].startsAt.getTime()).toBe(86_400_000);
  });

  it("Select all: the first tester to accept takes the whole weekly request; the other's Accept is refused", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Carter", "he");
    await devReq(testId, dev.cookie, [a.sessionId, b.sessionId], { times: [atHours(50)], weeks: 2 });
    const ra = await pending(a.sessionId, "developer");
    const rb = await pending(b.sessionId, "developer");
    await sact(b.sessionId, "answer-request", b.tester.cookie, { requestId: rb.id, action: "accept" });
    expect(await db.call.count({ where: { contractId: b.sessionId } })).toBe(2);
    expect((await sact(a.sessionId, "answer-request", a.tester.cookie, { requestId: ra.id, action: "accept" })).body.error.message).toMatch(/^Another tester took this time at /);
  });
});

describe("clash checks", () => {
  it("sending: a booked call or a pending request between the same two at an overlapping time is refused", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 50);
    const r1 = await sact(sessionId, "request-time", tester.cookie, { times: [new Date(call.startsAt.getTime() + 10 * 60_000).toISOString()] });
    expect(r1.body.error.message).toMatch(/^You already have a call with Nora Lane at /);
    await sact(sessionId, "request-time", tester.cookie, { times: [atHours(80)] });
    const r2 = await devReq(testId, dev.cookie, [sessionId], { times: [atHours(80)], weeks: 2, confirmed: true });
    expect(r2.body.error.message).toMatch(/^You already have a request with Ana Silva waiting for that time/);
  });

  it("accepting: a clash with the developer's call with another tester → the tester sees only 'This time is no longer free.'", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Carter", "he");
    const t = atHours(60);
    await devReq(testId, dev.cookie, [a.sessionId], { times: [t] });
    await devReq(testId, dev.cookie, [b.sessionId], { times: [t] });
    const ra = await pending(a.sessionId, "developer");
    const rb = await pending(b.sessionId, "developer");
    await sact(a.sessionId, "answer-request", a.tester.cookie, { requestId: ra.id, action: "accept" });
    expect((await sact(b.sessionId, "answer-request", b.tester.cookie, { requestId: rb.id, action: "accept" })).body.error.message).toBe("This time is no longer free.");
  });

  it("weekly: any clashing week refuses the whole request and names the week", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Carter", "he");
    const base = atHours(50);
    await bookCall(testId, dev.cookie, a.sessionId, a.tester.cookie, 50 + 2 * 7 * DAY); // week 3
    await devReq(testId, dev.cookie, [b.sessionId], { times: [base], weeks: 4 });
    const rb = await pending(b.sessionId, "developer");
    const r = await act(testId, "answer-request", dev.cookie, { contractId: b.sessionId, requestId: rb.id, action: "accept", seenAt: seen(), confirmed: true });
    expect(r.status).toBe(409); // the developer can't accept their own request
    const res = await sact(b.sessionId, "answer-request", b.tester.cookie, { requestId: rb.id, action: "accept" });
    expect(res.body.error.message).toMatch(/^These weeks clash: week 3 \(.+\): This time is no longer free\.$/);
    expect(await db.call.count({ where: { contractId: b.sessionId } })).toBe(0);
  });

  it("auto-match at the exact same time and rate still books (not a clash)", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const t = atHours(90);
    await sact(sessionId, "request-time", tester.cookie, { times: [t] });
    expect((await devReq(testId, dev.cookie, [sessionId], { times: [t] })).body.booked).toBe(true);
  });
});
