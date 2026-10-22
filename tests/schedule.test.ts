import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import { POST as invitePOST } from "@/app/api/invites/[id]/route";
import * as R from "@/lib/rules";
import { json, makeUser, req } from "./helpers";
import { act, joined, sact, seen, setup } from "./fixtures";

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

  it("the developer is told 1 week / 3 days / 1 day before day 14, then daily after it", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const n = (t: string) => db.notification.count({ where: { userId: dev.user.id, text: { contains: t } } });
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() + 2 * DAY) } });
    await cron();
    await cron();
    expect(await n("review Ana Silva's written answers within 3 days")).toBe(1);
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000) } });
    await cron(); // day 14: offer to the tester + first daily reminder to the developer
    await cron(); // same day: not again
    expect(await n("waited over 14 days")).toBe(1);
    await db.submission.update({ where: { id: sub.id }, data: { devRemindedAt: new Date(Date.now() - DAY) } });
    await cron();
    expect(await n("waited over 14 days")).toBe(2);
  });

  it("invites: a bell every 3 days until the tester joins or says No thanks", async () => {
    const { dev, testId } = await setup();
    const t = await makeUser({ tester: true, name: "Dee Moss" });
    await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [t.user.id] });
    const inv = await db.invite.findFirstOrThrow({ where: { testId, testerId: t.user.id } });
    await db.invite.update({ where: { id: inv.id }, data: { createdAt: new Date(Date.now() - 4 * DAY) } });
    await cron();
    await cron();
    const n = () => db.notification.count({ where: { userId: t.user.id, text: { startsWith: "Reminder: Nora Lane invited you" } } });
    expect(await n()).toBe(1);
    expect((await json(await invitePOST(req(`/api/invites/${inv.id}`, { cookie: t.cookie, body: {} }), { params: Promise.resolve({ id: inv.id }) }))).status).toBe(200);
    await db.invite.update({ where: { id: inv.id }, data: { remindedAt: new Date(Date.now() - 4 * DAY) } });
    await cron();
    expect(await n()).toBe(1); // declined: no more reminders
  });

  it("admin digest every 3 days; each no-show appears in a digest once", async () => {
    const { testId, dev } = await setup();
    const { tester, sessionId } = await joined(testId);
    await act(testId, "offer-times", dev.cookie, { seenAt: seen(), confirmed: true, times: [new Date(Date.now() + 2 * DAY).toISOString()] });
    const slot = await db.callSlot.findFirstOrThrow({ where: { testId } });
    await sact(sessionId, "book", tester.cookie, { seenAt: seen(), confirmed: true, slotId: slot.id });
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
});
