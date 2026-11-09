import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { SERVER_ONLY_JOIN_FLAGS, clientJoinBody } from "@/lib/server/joining";
import { makeUser } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// (Security, §352; audit A7) POST /api/tests/<id>/join with {rejoinAccepted: true} let a tester who left or was ended early rejoin with no acceptance. The join
// flags only the server may set never come from a request now; the developer's Accept, an invite and an ordinary Join still work.
const lv = async (testId: string) => (await db.test.findUniqueOrThrow({ where: { id: testId } })).listingVersion;
const status = async (sessionId: string) => (await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).status;

describe("§352 server-only join flags never come from a request", () => {
  it("the list, and the body helper", () => {
    expect([...SERVER_ONLY_JOIN_FLAGS]).toEqual(["rejoinAccepted", "acceptedByDeveloper", "ndaAcceptedAt", "keepPrivate"]);
    expect(clientJoinBody({ rejoinAccepted: true, acceptedByDeveloper: true, ndaAcceptedAt: "2020-01-01", keepPrivate: true, anyway: true, ndaAccepted: true, seenAt: "x" })).toEqual({ anyway: true, ndaAccepted: true, seenAt: "x" });
  });

  it("the exploit: a tester who left sends {rejoinAccepted: true} to Join: refused, still left, nothing made", async () => {
    const { testId } = await setup();
    const a = await joined(testId, "Ana Silva", "she");
    expect((await sact(a.sessionId, "leave", a.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    const r = await act(testId, "join", a.tester.cookie, { listingVersion: await lv(testId), rejoinAccepted: true, acceptedByDeveloper: true, seenAt: seen(), confirmed: true });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toBe("You left this test, so you ask to rejoin and the developer accepts.");
    expect(await status(a.sessionId)).toBe("left");
    expect(await db.contract.count({ where: { testId, testerId: a.tester.user.id } })).toBe(1);
  });

  it("the exploit after End early: refused, still ended", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId, "Ana Silva", "she");
    expect((await act(testId, "end-early", dev.cookie, { contractIds: [a.sessionId], reason: "We have what we need, thank you", seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    const r = await act(testId, "join", a.tester.cookie, { listingVersion: await lv(testId), rejoinAccepted: true, seenAt: seen(), confirmed: true });
    expect(r.status).toBe(409);
    expect(await status(a.sessionId)).toBe("ended");
  });

  it("the legitimate rejoin: Ask to rejoin, then the developer accepts", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const a = await joined(testId, "Ana Silva", "she").catch(() => null);
    // An apply test: join her as the developer accepting her application.
    let sessionId = a?.sessionId;
    const ana = a?.tester ?? (await makeUser({ tester: true, name: "Ana Silva" }));
    if (!sessionId) {
      expect((await act(testId, "apply", ana.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
      const app0 = await db.application.findFirstOrThrow({ where: { testId, testerId: ana.user.id } });
      expect((await act(testId, "application", dev.cookie, { applicationId: app0.id, action: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
      sessionId = (await db.contract.findFirstOrThrow({ where: { testId, testerId: ana.user.id } })).id;
    }
    expect((await sact(sessionId, "leave", ana.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    expect((await act(testId, "rejoin-ask", ana.cookie, { seenAt: seen(), confirmed: true, rejoinAccepted: true })).status).toBe(200);
    expect(await status(sessionId)).toBe("left"); // the ask waits for the developer
    const ask = await db.application.findFirstOrThrow({ where: { testId, testerId: ana.user.id, status: "pending" } });
    expect((await act(testId, "application", dev.cookie, { applicationId: ask.id, action: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await status(sessionId)).toBe("working");
  });

  it("the legitimate rejoin by an invite, and an ordinary Join (acceptedByDeveloper sent by the tester changes nothing: the developer is told)", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId, "Ana Silva", "she");
    expect((await sact(a.sessionId, "leave", a.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    expect((await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [a.tester.user.id], confirmed: true })).status).toBe(200);
    expect((await act(testId, "join", a.tester.cookie, { listingVersion: await lv(testId), seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await status(a.sessionId)).toBe("working");

    const ben = await makeUser({ tester: true, name: "Ben Cole" });
    const since = new Date();
    const r = await act(testId, "join", ben.cookie, { listingVersion: await lv(testId), acceptedByDeveloper: true, seenAt: seen(), confirmed: true });
    expect(r.status).toBe(200);
    expect(await db.notification.count({ where: { userId: dev.user.id, createdAt: { gte: since }, text: { startsWith: "Ben Cole joined" } } })).toBe(1);
  });

  it("an NDA test: ndaAcceptedAt from a request is ignored (no back-dating, never instead of the tick)", async () => {
    const { testId } = await setup({ ndaText: "Keep the build to yourself." });
    const ben = await makeUser({ tester: true, name: "Ben Cole" });
    const noTick = await act(testId, "join", ben.cookie, { listingVersion: await lv(testId), ndaAcceptedAt: "2020-01-01T00:00:00.000Z", seenAt: seen(), confirmed: true });
    expect(noTick.status).toBe(400);
    expect(noTick.body.error.message).toBe("Accept the NDA to join.");
    const before = Date.now();
    expect((await act(testId, "join", ben.cookie, { listingVersion: await lv(testId), ndaAccepted: true, ndaAcceptedAt: "2020-01-01T00:00:00.000Z", seenAt: seen(), confirmed: true })).status).toBe(200);
    const c = await db.contract.findFirstOrThrow({ where: { testId, testerId: ben.user.id } });
    expect(c.ndaAcceptedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});
