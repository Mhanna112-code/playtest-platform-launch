import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { heartbeat, outageLine } from "@/lib/server/outages";
import { GET as healthGET } from "@/app/api/health/route";
import { POST as alertPOST } from "@/app/api/health/alert/route";
import { bookCall, joined, sact, setup } from "./fixtures";

// (Owner, Oct 22, NEWEST+6) Outages: detected from heartbeats, every running timer moves, calls inside are missed.

const MIN = 60_000, H = 60 * MIN;

const ping = (key?: string) => healthGET(new Request(`http://localhost:3400/api/health${key ? `?key=${key}` : ""}`));
/** (Batch 15 section 10) UptimeRobot's alert webhook: alertType 1 = down, 2 = up; alertDateTime in Unix seconds. */
const alert = (type: 1 | 2, at: Date, key = "test-health-key") =>
  alertPOST(new Request(`http://localhost:3400/api/health/alert?key=${key}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alertType: type, alertDateTime: Math.round(at.getTime() / 1000), monitorFriendlyName: "Playtest" }) }));

describe("outages", () => {
  beforeEach(() => {
    process.env.OUTAGE_CHECKS = "1";
    process.env.HEALTH_KEY = "test-health-key";
  });
  afterEach(() => {
    delete process.env.OUTAGE_CHECKS;
    delete process.env.HEALTH_KEY;
  });

  it("a down/up alert pair 15 minutes or more apart is recorded once; every running timer moves by its length; calls inside are missed", async () => {
    await db.heartbeat.deleteMany({});
    await db.outage.deleteMany({});
    const { dev, testId } = await setup({ deadlineDays: 2, openUntil: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10) });
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
    // (Batch 15 section 10) The uptime service's alerts: down now, up 2 h 30 min later (the outage).
    const start = new Date(Math.floor(Date.now() / 1000) * 1000);
    await db.appState.deleteMany({ where: { key: "outage-down" } });
    expect((await alert(1, start)).status).toBe(200);
    const end = new Date(start.getTime() + 2.5 * H);
    const r = await (await alert(2, end)).json();
    expect(r.outage).not.toBeNull();
    expect(r.outage.ms).toBe(2.5 * H);
    expect((await (await alert(2, new Date(end.getTime() + MIN))).json()).outage).toBeNull(); // an up with no down records nothing new
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

  it("gated: with the setting off nothing is written; polls never write heartbeats; only the keyed ping does, and a gap never creates an outage", async () => {
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
    // (Batch 15 section 10) A gap between keyed pings creates nothing any more (a paused monitor changes nothing).
    await db.heartbeat.updateMany({ data: { at: new Date(Date.now() - 40 * MIN) } });
    await ping("test-health-key");
    expect(await db.outage.count()).toBe(0);
  }, 90_000);

  it("(batch 15 section 10) a 20-minute gap with no pings records nothing; a down/up pair 40 minutes apart records one outage and moves a deadline", async () => {
    await db.heartbeat.deleteMany({});
    await db.outage.deleteMany({});
    await db.appState.deleteMany({ where: { key: "outage-down" } });
    const { testId } = await setup();
    const { sessionId } = await joined(testId);
    const due0 = (await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).dueAt.getTime();
    // A 20-minute gap between keyed pings (a paused monitor): nothing.
    await ping("test-health-key");
    await db.heartbeat.updateMany({ data: { at: new Date(Date.now() - 20 * MIN) } });
    await ping("test-health-key");
    expect(await db.outage.count()).toBe(0);
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).dueAt.getTime()).toBe(due0);
    // A short down/up pair (10 minutes) records nothing either.
    const t0 = new Date(Math.floor(Date.now() / 1000) * 1000);
    await alert(1, t0);
    expect((await (await alert(2, new Date(t0.getTime() + 10 * MIN))).json()).outage).toBeNull();
    expect(await db.outage.count()).toBe(0);
    // A wrong key is refused.
    expect((await alert(1, t0, "wrong")).status).toBe(403);
    // Down, then up 40 minutes later: one outage, and the tester's deadline moved 40 minutes.
    await alert(1, t0);
    await alert(1, new Date(t0.getTime() + 5 * MIN)); // a repeated down keeps the first start
    const r = await (await alert(2, new Date(t0.getTime() + 40 * MIN))).json();
    expect(r.outage.ms).toBe(40 * MIN);
    expect(await db.outage.count()).toBe(1);
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).dueAt.getTime() - due0).toBe(40 * MIN);
  }, 90_000);
});
