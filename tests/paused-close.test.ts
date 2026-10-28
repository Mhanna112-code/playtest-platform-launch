import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { startHold, chargebackOpened } from "@/lib/server/holds";
import { suspendAccount } from "@/lib/server/restrictions";
import { PAUSE_CLOSE_DAYS, pauseClosesAt, pauseCountdownLine } from "@/lib/pause";
import { json, makeUser, req } from "./helpers";
import { bookCall, joined, sact, setup } from "./fixtures";

const DAY = 86_400_000;
const cron = () => cronGET(new Request("http://localhost:3400/api/cron/daily", { headers: { authorization: "Bearer cron-test" } })).then((r) => r.json());
const admin = async () => {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
};
const aact = (cookie: string, action: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);
const ago = (days: number) => new Date(Date.now() - days * DAY);
const testOf = (id: string) => db.test.findUniqueOrThrow({ where: { id } });

describe("paused tests close after 7 days (pure helpers)", () => {
  const dev = (over: Record<string, unknown> = {}) => ({ holdStartedAt: null, holdReason: "", devSuspendedAt: null, ...over });
  const test = (over: Record<string, unknown> = {}) => ({ status: "open", adminPausedAt: null, pauseCloseAt: null, pauseCloseSetAt: null, ...over });

  it("closes 7 days after the earliest cause began; the admin's date counts only for the pause it was set in", () => {
    expect(pauseClosesAt(dev(), test())).toBeNull();
    expect(pauseClosesAt(dev({ holdStartedAt: new Date() }), test({ status: "stopped" }))).toBeNull();
    expect(pauseClosesAt(dev({ holdStartedAt: new Date() }), test({ status: "draft" }))).toBeNull();
    const hold = ago(3), susp = ago(1);
    const c = pauseClosesAt(dev({ holdStartedAt: hold, devSuspendedAt: susp }), test())!;
    expect(c.at.getTime()).toBe(hold.getTime() + PAUSE_CLOSE_DAYS * DAY);
    expect(c.causes).toEqual(["hold", "suspension"]);
    const later = new Date(hold.getTime() + 12 * DAY);
    expect(pauseClosesAt(dev({ holdStartedAt: hold }), test({ pauseCloseAt: later, pauseCloseSetAt: ago(1) }))).toMatchObject({ at: later, extended: true });
    // Set during an EARLIER pause: ignored.
    expect(pauseClosesAt(dev({ holdStartedAt: hold }), test({ pauseCloseAt: later, pauseCloseSetAt: ago(10) }))).toMatchObject({ extended: false });
    expect(pauseClosesAt(dev({ holdStartedAt: hold, holdReason: "chargeback" }), test())!.causes).toEqual(["chargeback"]);
  });

  it("reads 'Closes on Nov 2 unless your account is cleared'", () => {
    const at = new Date(2026, 10, 2, 12);
    expect(pauseCountdownLine(at, ["hold"])).toBe("Closes on Nov 2 unless your account is cleared");
    expect(pauseCountdownLine(at, ["suspension", "team"])).toBe("Closes on Nov 2 unless your account is cleared");
    expect(pauseCountdownLine(at, ["team"])).toBe("Closes on Nov 2 unless the team lifts the pause");
  });
});

describe("the daily job closes paused tests", () => {
  it("a payment hold: not at 6 days, closed at 8; testers read only that it ended, the developer is told why; calls ahead are cancelled", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    await bookCall(testId, dev.cookie, sessionId, tester.cookie, 24 * 12);
    await startHold(dev.user.id, "unpaid");
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: ago(6) } });
    await cron();
    expect((await testOf(testId)).status).toBe("open");
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: ago(8), lastSummaryAt: ago(2) } }); // (yesterday's summary has gone: today's is due)
    expect((await cron()).closed).toBeGreaterThanOrEqual(1);
    const t = await testOf(testId);
    expect(t).toMatchObject({ status: "stopped" });
    expect(t.pauseClosedAt).not.toBeNull();
    expect(t.pauseClosedReason).toBe("This test was closed because it stayed paused for 7 days: your payments were on hold.");
    expect(await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).toMatchObject({ status: "ended", endKind: "closed" });
    expect(await db.call.findFirstOrThrow({ where: { contractId: sessionId } })).toMatchObject({ status: "cancelled" });
    // The tester: neutral (no hold / pause / suspend / chargeback words). The developer: the reason.
    expect(await db.notification.count({ where: { userId: tester.user.id, text: "“Harbor Run” ended", groupKey: "tstopped" } })).toBe(1);
    for (const m of await db.outboxEmail.findMany({ where: { to: tester.user.email, createdAt: { gt: ago(1) } } })) expect(m.text + m.subject).not.toMatch(/hold|chargeback|suspend|paused for/i);
    // The developer is told why, in the end-of-day email (the team closing a test is one of the few emails that ignore Off).
    const devMail = await db.outboxEmail.findFirstOrThrow({ where: { to: dev.user.email, text: { contains: "was closed. This test was closed because it stayed paused for 7 days: your payments were on hold" } } });
    expect(devMail.subject).toMatch(/^Your Playtest summary/);
    // Running it again changes nothing (the developer is told once).
    await cron();
    expect(await db.outboxEmail.count({ where: { to: dev.user.email, text: { contains: "was closed. This test was closed" } } })).toBe(1);
  });

  it("a suspension closes the developer's tests the same way", async () => {
    const { dev, testId } = await setup();
    const { sessionId } = await joined(testId);
    const a = await admin();
    await suspendAccount(a.user.id, dev.user.id, "Testing");
    await db.user.update({ where: { id: dev.user.id }, data: { devSuspendedAt: ago(8), testerSuspendedAt: ago(8) } });
    await cron();
    expect((await testOf(testId)).pauseClosedReason).toBe("This test was closed because it stayed paused for 7 days: your account was suspended.");
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).endKind).toBe("closed");
  });

  it("a chargeback hold closes them too, and the reason says so", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const pi = "pi_" + randomUUID();
    await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 800, feeCents: 160, testerCents: 640, status: "charged", stripePaymentIntentId: pi } });
    await chargebackOpened(pi);
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: ago(9) } });
    await cron();
    expect((await testOf(testId)).pauseClosedReason).toContain("your account was on a chargeback hold");
  });

  it("the admin can extend a test's date, and close it sooner (like Stop)", async () => {
    const { dev, testId } = await setup();
    const { sessionId } = await joined(testId);
    const a = await admin();
    expect((await aact(a.cookie, "extend-pause", { id: testId, days: 5 })).body.error.code).toBe("not_paused"); // only paused tests
    await startHold(dev.user.id, "unpaid");
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: ago(6) } });
    expect((await aact(a.cookie, "extend-pause", { id: testId, days: 0 })).status).toBe(400);
    const r = await aact(a.cookie, "extend-pause", { id: testId, days: 5 });
    expect(r.status).toBe(200);
    // It was due in a day; now it is due in 6 days (a date, 12 days after the hold began): the daily job leaves it open until then.
    const moved = await testOf(testId);
    expect(Math.round((moved.pauseCloseAt!.getTime() - Date.now()) / DAY)).toBe(6);
    await cron();
    expect((await testOf(testId)).status).toBe("open");
    // Time passes: the hold is now 13 days old and the moved date is behind us.
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: ago(13) } });
    await db.test.update({ where: { id: testId }, data: { pauseCloseAt: ago(1) } });
    await cron();
    expect((await testOf(testId)).status).toBe("stopped");
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).endKind).toBe("closed");

    // Close now: a paused test closes at once; a test that isn't paused is refused.
    const two = await setup();
    const none = await aact(a.cookie, "close-paused", { id: two.testId });
    expect(none.body.error.code).toBe("not_paused");
    await startHold(two.dev.user.id, "unpaid");
    const now = await aact(a.cookie, "close-paused", { id: two.testId });
    expect(now.status).toBe(200);
    const closed = await testOf(two.testId);
    expect(closed.status).toBe("stopped");
    expect(closed.pauseClosedReason).toBe("The team closed this test while it was paused because your payments were on hold.");
    expect((await aact(a.cookie, "close-paused", { id: two.testId })).status).toBe(409);
    // Not for ordinary users.
    const other = await makeUser({ dev: true });
    expect((await aact(other.cookie, "close-paused", { id: two.testId })).status).toBe(403);
  });

  it("a test that is not paused is left alone, and lifting the pause before the date keeps it open", async () => {
    const { dev, testId } = await setup();
    await cron();
    expect((await testOf(testId)).status).toBe("open");
    await startHold(dev.user.id, "unpaid");
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: null, holdReason: "" } });
    await cron();
    expect((await testOf(testId)).status).toBe("open");
  });
});
