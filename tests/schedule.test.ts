import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import { POST as invitePOST } from "@/app/api/invites/[id]/route";
import * as R from "@/lib/rules";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, setup } from "./fixtures";

const DAY = 86_400_000;
const cron = () => cronGET(new Request("http://localhost:3400/api/cron/daily", { headers: { authorization: "Bearer cron-test" } }));

describe("notification schedule", () => {
  it("countdown: 1 month (only if it started over a month away), 1 week, 3 days, 1 day; never twice, never late", () => {
    const now = new Date("2026-11-01T12:00:00Z");
    const at = (d: number) => new Date(now.getTime() + d * DAY);
    const longAgo = new Date(now.getTime() - 60 * DAY);
    expect(R.countdownDue(at(20), now, [], longAgo)?.mark).toBe("1m");
    expect(R.countdownDue(at(20), now, [], now)).toBeNull(); // started less than a month away
    expect(R.countdownDue(at(6), now, [], now)?.mark).toBe("1w");
    expect(R.countdownDue(at(2), now, ["1w"], now)?.mark).toBe("3d");
    expect(R.countdownDue(at(2), now, ["1w", "3d"], now)).toBeNull();
    expect(R.countdownDue(at(0.5), now, [], now)?.mark).toBe("1d");
    expect(R.countdownDue(at(-1), now, [], now)).toBeNull();
  });

  it("the tester gets a 'Work sent' confirmation", async () => {
    const { testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    expect(await db.notification.count({ where: { userId: tester.user.id, text: "Work sent: your written answers for “Harbor Run”" } })).toBe(1);
  });

  it("the developer is told ONCE, 1 day before Charge would open, then daily after it opens (14 days AND Open until)", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const n = (t: string) => db.notification.count({ where: { userId: dev.user.id, text: { contains: t } } });
    // The old 1-week and 3-day reminders are gone: 5 days before, nothing.
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() + 5 * DAY) } });
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() + 5 * DAY) } });
    await cron();
    expect(await n("review Ana Silva's written answers")).toBe(0);
    // 12 hours before it would open: ONE reminder (never twice).
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() + 12 * 3_600_000) } });
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000) } });
    await cron();
    await cron();
    expect(await n("review Ana Silva's written answers by tomorrow")).toBe(1);
    expect((await db.notification.findFirstOrThrow({ where: { userId: dev.user.id, text: { contains: "by tomorrow" } } })).groupKey).toBe("unreviewed");
    // 14 days have passed but Open until has not: Charge has not opened (no offer to the tester, no daily reminder).
    expect(await n("waited over 14 days")).toBe(0);
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).choiceOfferedAt).toBeNull();
    // Open until passes: it opens, and the developer is reminded daily.
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() - 1000) } });
    await cron(); // opens: offer to the tester + first daily reminder to the developer
    await cron(); // same day: not again
    expect(await n("waited over 14 days")).toBe(1);
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).choiceOfferedAt).not.toBeNull();
    await db.submission.update({ where: { id: sub.id }, data: { devRemindedAt: new Date(Date.now() - DAY) } });
    await cron();
    expect(await n("waited over 14 days")).toBe(2);
  });

  it("with no Open until, Charge opens when the test stops (or the tester's work ends), 14 days after sending", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000) } });
    await cron();
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).choiceOfferedAt).toBeNull(); // the test is still running
    await act(testId, "stop", dev.cookie, { seenAt: seen(), confirmed: true });
    await cron();
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).choiceOfferedAt).not.toBeNull();
    // The tester's own work ending (they left) opens it too.
    const two = await setup();
    const j = await joined(two.testId, "Ben Carter", "he");
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    const s2 = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    await db.submission.update({ where: { id: s2.id }, data: { payBy: new Date(Date.now() - 1000) } });
    await cron();
    expect((await db.submission.findUniqueOrThrow({ where: { id: s2.id } })).choiceOfferedAt).toBeNull();
    expect((await sact(j.sessionId, "leave", j.tester.cookie)).status).toBe(200);
    await cron();
    expect((await db.submission.findUniqueOrThrow({ where: { id: s2.id } })).choiceOfferedAt).not.toBeNull();
  });

  it("invites: a bell DAILY until the tester joins or says No thanks (one stacked line across tests)", async () => {
    const { dev, testId } = await setup();
    const t = await makeUser({ tester: true, name: "Dee Moss" });
    await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [t.user.id] });
    const inv = await db.invite.findFirstOrThrow({ where: { testId, testerId: t.user.id } });
    await db.invite.update({ where: { id: inv.id }, data: { createdAt: new Date(Date.now() - 2 * DAY) } });
    await cron();
    await cron();
    const n = () => db.notification.count({ where: { userId: t.user.id, text: { startsWith: "Reminder: Nora Lane invited you" } } });
    expect(await n()).toBe(1);
    expect((await db.notification.findFirstOrThrow({ where: { userId: t.user.id, text: { startsWith: "Reminder: Nora Lane invited you" } } })).groupKey).toBe("invites");
    await db.invite.update({ where: { id: inv.id }, data: { remindedAt: new Date(Date.now() - DAY) } });
    await cron();
    expect(await n()).toBe(2); // the next day: again
    expect((await json(await invitePOST(req(`/api/invites/${inv.id}`, { cookie: t.cookie, body: {} }), { params: Promise.resolve({ id: inv.id }) }))).status).toBe(200);
    await db.invite.update({ where: { id: inv.id }, data: { remindedAt: new Date(Date.now() - 4 * DAY) } });
    await cron();
    expect(await n()).toBe(2); // declined: no more reminders
  });

  it("admin digest every 3 days; each no-show appears in a digest once", async () => {
    const { testId, dev } = await setup();
    const { tester, sessionId } = await joined(testId);
    await bookCall(testId, dev.cookie, sessionId, tester.cookie, 48);
    const call = await db.call.findFirstOrThrow({ where: { contractId: sessionId } });
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 60_000), noShowBy: "tester", noShowNote: "Nobody came", noShowAt: new Date() } });
    await db.appState.deleteMany({ where: { key: "adminDigestAt" } });
    const digests = () => db.outboxEmail.count({ where: { to: "owner@playtest.test", subject: { startsWith: "Playtest admin digest" } } });
    const before = await digests();
    await cron();
    expect(await digests()).toBe(before + 1);
    expect((await db.call.findUniqueOrThrow({ where: { id: call.id } })).noShowDigestedAt).not.toBeNull();
    await cron(); // within 3 days: no digest
    expect(await digests()).toBe(before + 1);
  });

  it("failed payments and holds go in the 3-day digest, not in the daily new-cases email", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 4321, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(Date.now() + 2 * DAY), retriedAt: new Date() } });
    await db.appState.deleteMany({ where: { key: "adminDigestAt" } });
    await cron();
    const digest = await db.outboxEmail.findFirstOrThrow({ where: { to: "owner@playtest.test", subject: { startsWith: "Playtest admin digest" } }, orderBy: { createdAt: "desc" } });
    expect(digest.text).toContain("Failed charge still owed: $43.21");
    expect(digest.text).not.toContain("Dispute:");
  });
});
