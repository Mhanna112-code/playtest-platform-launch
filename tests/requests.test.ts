import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { startHold } from "@/lib/server/holds";
import { act, joined, sact, seen, setup } from "./fixtures";

const at = (h: number) => { const d = new Date(Date.now() + h * 3_600_000); d.setSeconds(0, 0); return d.toISOString(); };
const later = () => new Promise((r) => setTimeout(r, 5));

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
    const first = await act(testId, "request-time", dev.cookie, { contractId: sessionId, startsAt: t, seenAt: seen(), confirmed: true });
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
    await act(testId, "request-time", dev.cookie, { contractId: sessionId, startsAt: at(80), seenAt: seen(), confirmed: true });
    const w = await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], seenAt: pageLoaded });
    expect(w.body.error.changes[0].text).toMatch(/^Nora Lane requested a call for /);
    await startHold(dev.user.id, "unpaid");
    expect(await db.callRequest.count({ where: { contractId: sessionId, status: "pending" } })).toBe(0);
  });

  it("offering a time a tester requested books it", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const t = at(90);
    await sact(sessionId, "request-time", tester.cookie, { startsAt: t });
    await act(testId, "offer-times", dev.cookie, { seenAt: seen(), confirmed: true, times: [t] });
    expect(await db.call.count({ where: { contractId: sessionId, status: "booked" } })).toBe(1);
  });
});
