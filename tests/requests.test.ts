import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { startHold } from "@/lib/server/holds";
import { act, joined, sact, seen, setup } from "./fixtures";

const at = (h: number) => { const d = new Date(Date.now() + h * 3_600_000); d.setSeconds(0, 0); return d.toISOString(); };
const later = () => new Promise((r) => setTimeout(r, 30));

describe("call requests on both sides", () => {
  it("tester requests; developer accepts → booked", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const r = await sact(sessionId, "request-time", tester.cookie, { startsAt: at(50) });
    expect(r.body.requested).toBe(true);
    const a = await act(testId, "answer-request", dev.cookie, { contractId: sessionId, requestId: r.body.id, action: "accept", seenAt: seen(), confirmed: true });
    expect(a.body.booked).toBe(true);
    expect(await db.call.count({ where: { contractId: sessionId, status: "booked" } })).toBe(1);
  });

  it("the other side requesting the same time books it at once and closes the pending request", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const t = at(60);
    const first = await act(testId, "request-time", dev.cookie, { contractIds: [sessionId], startsAt: t, seenAt: seen(), confirmed: true });
    first.body.id = (await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId, fromSide: "developer" } })).id;
    const second = await sact(sessionId, "request-time", tester.cookie, { startsAt: t, seenAt: seen(), confirmed: true });
    expect(second.body.message).toMatch(/^Booked: you both picked /);
    expect((await db.callRequest.findUniqueOrThrow({ where: { id: first.body.id } })).status).toBe("booked");
  });

  it("accepting a request withdrawn meanwhile is refused for good, naming what happened", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const r = await sact(sessionId, "request-time", tester.cookie, { startsAt: at(70) });
    await sact(sessionId, "answer-request", tester.cookie, { requestId: r.body.id, action: "withdraw" });
    const a = await act(testId, "answer-request", dev.cookie, { contractId: sessionId, requestId: r.body.id, action: "accept", seenAt: seen(), confirmed: true });
    expect(a.body.error.message).toMatch(/^Ana Silva withdrew this request at /);
  });

  it("a developer's request is a stop-once reason for every tester button; a hold closes pending requests", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const pageLoaded = seen();
    await later();
    await act(testId, "request-time", dev.cookie, { contractIds: [sessionId], startsAt: at(80), seenAt: seen(), confirmed: true });
    const w = await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], seenAt: pageLoaded });
    expect(w.body.error.changes[0].text).toMatch(/^Nora Lane requested a call for /);
    await startHold(dev.user.id, "unpaid");
    expect(await db.callRequest.count({ where: { contractId: sessionId, status: "pending" } })).toBe(0);
  });

  it("a developer request to several testers is one call: the first Accept books it, a late Accept is refused", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Carter", "he");
    await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [a.sessionId, b.sessionId], startsAt: at(100) });
    const qa = await db.callRequest.findFirstOrThrow({ where: { contractId: a.sessionId } });
    const qb = await db.callRequest.findFirstOrThrow({ where: { contractId: b.sessionId } });
    expect(qa.batchId).toBe(qb.batchId);
    expect(await db.notification.count({ where: { userId: b.tester.user.id, text: { startsWith: "Nora Lane asked for a call: " } } })).toBe(0); // (Owner) a call request is not a bell line
    expect((await sact(a.sessionId, "answer-request", a.tester.cookie, { requestId: qa.id, action: "accept" })).body.booked).toBe(true);
    const late = await sact(b.sessionId, "answer-request", b.tester.cookie, { requestId: qb.id, action: "accept" });
    expect(late.body.error.message).toMatch(/^Another tester took this time at .+\.$/);
  });

  it("no Ask $: a tester requesting the developer's exact time books it at the contract rate, whatever ask the request carries", async () => {
    const { dev, testId } = await setup(); // live call $30/h in the contract
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Carter", "he");
    const t = at(110);
    await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [a.sessionId, b.sessionId], startsAt: t });
    const r = await sact(a.sessionId, "request-time", a.tester.cookie, { startsAt: t, ask: "50" });
    expect(r.body.booked).toBe(true); // auto-match: both picked the same time
    expect((await db.call.findFirstOrThrow({ where: { contractId: a.sessionId } })).rateCents).toBe(3000);
    expect((await db.callRequest.findFirstOrThrow({ where: { contractId: b.sessionId } })).status).toBe("taken"); // the time is taken for the others
    expect(await db.callRequest.count({ where: { contractId: a.sessionId, askRateCents: { not: null } } })).toBe(0);
    void dev;
  });

});
