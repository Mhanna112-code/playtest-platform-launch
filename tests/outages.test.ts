import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { heartbeat, outageLine } from "@/lib/server/outages";
import { GET as healthGET } from "@/app/api/health/route";
import { bookCall, joined, sact, setup } from "./fixtures";

// (Owner, Oct 22, NEWEST+6) Outages: detected from heartbeats, every running timer moves, calls inside are missed.

const MIN = 60_000, H = 60 * MIN;

const ping = (key?: string) => healthGET(new Request(`http://localhost:3400/api/health${key ? `?key=${key}` : ""}`));

describe("outages", () => {
  beforeEach(() => {
    process.env.OUTAGE_CHECKS = "1";
    process.env.HEALTH_KEY = "test-health-key";
  });
  afterEach(() => {
    delete process.env.OUTAGE_CHECKS;
    delete process.env.HEALTH_KEY;
  });

  it("a gap over 15 minutes is recorded once; every running timer moves by its length; calls inside are missed", async () => {
    await db.heartbeat.deleteMany({});
    await db.outage.deleteMany({});
    const { dev, testId } = await setup({ openUntil: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10) });
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    // A call booked for 1 hour from now (it will fall inside the outage), another 3 days ahead (it won't).
    const inside = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 30);
    await db.call.update({ where: { id: inside.id }, data: { startsAt: new Date(Date.now() + 1 * H) } });
    const later = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 72);
    const owed = await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 500, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(Date.now() + 2 * 86_400_000), retriedAt: new Date() } });
    const before = {
      sub: await db.submission.findFirstOrThrow({ where: { contractId: sessionId } }),
      c: await db.contract.findUniqueOrThrow({ where: { id: sessionId } }),
      t: await db.test.findUniqueOrThrow({ where: { id: testId } }),
    };
    // Heartbeats: one now; the next 2 h 30 min later (the outage).
    const start = new Date();
    await db.heartbeat.create({ data: { at: start } });
    const end = new Date(start.getTime() + 2.5 * H);
    const o = await heartbeat(end);
    expect(o).not.toBeNull();
    expect(o!.ms).toBe(2.5 * H);
    expect(await heartbeat(new Date(end.getTime() + MIN))).toBeNull(); // no new gap
    expect(await db.outage.count()).toBe(1);
    const L = 2.5 * H;
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect(sub.payBy!.getTime() - before.sub.payBy!.getTime()).toBe(L);
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).dueAt.getTime() - before.c.dueAt.getTime()).toBe(L);
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).openUntil!.getTime() - before.t.openUntil!.getTime()).toBe(L);
    const p = await db.payment.findUniqueOrThrow({ where: { id: owed.id } });
    expect(p.owedUntil!.getTime() - owed.owedUntil!.getTime()).toBe(L);
    expect(p.retriedAt!.getTime() - owed.retriedAt!.getTime()).toBe(L);
    // The call inside: missed because the site was down (no no-show, nothing charged); the later call stays.
    const missed = await db.call.findUniqueOrThrow({ where: { id: inside.id } });
    expect(missed).toMatchObject({ status: "cancelled", cancelledBy: "system", cancelNote: "missed because the site was down", noShowBy: null });
    expect(await db.payment.count({ where: { callId: inside.id } })).toBe(0);
    expect((await db.call.findUniqueOrThrow({ where: { id: later.id } })).status).toBe("booked");
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "was missed because the site was down" } } })).toBe(1);
    // One bell each, with the times and the length; no hold wording.
    const line = outageLine(start, end, L);
    expect(line).toMatch(/^The site was down from .+ to .+\. Deadlines and payment dates moved 2 h 30 min later\.$/);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: line } })).toBe(1);
    expect(await db.notification.count({ where: { userId: dev.user.id, text: line } })).toBe(1);
    expect(line).not.toMatch(/hold|pause/i);
    // The top box on affected pages.
    const { outageLines } = await import("@/lib/server/outages");
    expect((await outageLines(new Date(start.getTime() - MIN))).map((x) => x.text)).toEqual([line]);
  }, 90_000);

  it("gated: with the setting off a gap creates nothing; polls never write heartbeats; only the keyed ping does", async () => {
    await db.heartbeat.deleteMany({});
    await db.outage.deleteMany({});
    // Off: the keyed ping writes nothing; a gap creates nothing.
    delete process.env.OUTAGE_CHECKS;
    await db.heartbeat.create({ data: { at: new Date(Date.now() - 3 * H) } });
    expect((await ping("test-health-key")).status).toBe(200);
    expect(await heartbeat(new Date())).toBeNull();
    expect(await db.heartbeat.count()).toBe(1);
    expect(await db.outage.count()).toBe(0);
    // On: a page poll writes nothing; health without the key writes nothing; the keyed ping writes one.
    process.env.OUTAGE_CHECKS = "1";
    await db.heartbeat.deleteMany({});
    const { dev, testId } = await setup();
    const { GET: pulseGET } = await import("@/app/api/pulse/route");
    const { req } = await import("./helpers");
    expect((await pulseGET(req(`/api/pulse?test=${testId}`, { cookie: dev.cookie }))).status).toBe(200);
    expect((await ping()).status).toBe(200);
    expect(await db.heartbeat.count()).toBe(0);
    expect((await ping("wrong")).status).toBe(200);
    expect(await db.heartbeat.count()).toBe(0);
    await ping("test-health-key");
    expect(await db.heartbeat.count()).toBe(1);
    // A gap between keyed pings creates an outage.
    await db.heartbeat.updateMany({ data: { at: new Date(Date.now() - 40 * MIN) } });
    await ping("test-health-key");
    expect(await db.outage.count()).toBe(1);
    expect(Math.round((await db.outage.findFirstOrThrow()).ms / MIN)).toBe(40);
  }, 90_000);
});
