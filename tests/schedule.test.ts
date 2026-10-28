import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import { POST as invitePOST } from "@/app/api/invites/[id]/route";
import * as R from "@/lib/rules";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, setup } from "./fixtures";

const DAY = 86_400_000;
const cron = () => cronGET(new Request("http://localhost:3400/api/cron/daily", { headers: { authorization: "Bearer cron-test" } }));

// Each test here runs the whole daily job several times over the shared test database (which only grows): give them room.
describe("notification schedule", { timeout: 120_000 }, () => {
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

  it("the developer is told 1 month / 1 week / 3 days / 1 day before Charge would open (skipping any already past), then daily after it opens", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const n = (t: string) => db.notification.count({ where: { userId: dev.user.id, text: { contains: t } } });
    // Charge opens at the later of 14 days after sending and Open until. Here Open until is 5 days off: the 1 month mark is already past, so only 1 week comes first.
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() + 5 * DAY) } });
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000), updatedAt: new Date(Date.now() - 14 * DAY) } });
    await cron();
    await cron();
    expect(await n("review Ana Silva's written answers within 1 week")).toBe(1);
    expect(await n("within 1 month")).toBe(0);
    // 2 days before: the 3 days mark; then 12 hours before: tomorrow.
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() + 2 * DAY) } });
    await cron();
    expect(await n("review Ana Silva's written answers within 3 days")).toBe(1);
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() + 12 * 3_600_000) } });
    await cron();
    await cron();
    expect(await n("review Ana Silva's written answers by tomorrow")).toBe(1);
    expect((await db.notification.findFirstOrThrow({ where: { userId: dev.user.id, text: { contains: "by tomorrow" } } })).groupKey).toBe("unreviewed");
    // 14 days have passed but Open until has not: Charge has not opened (no offer to the tester, no daily reminder).
    expect(await n("waited over 7 days")).toBe(0);
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).choiceOfferedAt).toBeNull();
    // Open until passes: it opens, and the developer is reminded daily.
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() - 1000) } });
    await cron(); // opens: offer to the tester + first daily reminder to the developer
    await cron(); // same day: not again
    expect(await n("waited over 7 days")).toBe(1);
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).choiceOfferedAt).not.toBeNull();
    await db.submission.update({ where: { id: sub.id }, data: { devRemindedAt: new Date(Date.now() - DAY) } });
    await cron();
    expect(await n("waited over 7 days")).toBe(2);
  });

  it("with no Open until (an old test), Charge opens when the test stops (or the tester's work ends), 7 days after sending", async () => {
    const { dev, testId } = await setup();
    await db.test.update({ where: { id: testId }, data: { openUntil: null } }); // (batch 12) only old tests have none
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
    await db.test.update({ where: { id: two.testId }, data: { openUntil: null } });
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

  const mkAdmin = async () => {
    const x = await makeUser({ email: `admin-${Math.random().toString(36).slice(2)}@playtest.test` });
    await db.user.update({ where: { id: x.user.id }, data: { isAdmin: true, emailPref: "off" } }); // the admin daily email can't be turned off
    return x;
  };
  const adminMails = (to: string) => db.outboxEmail.findMany({ where: { to, subject: { startsWith: "Playtest admin:" } }, orderBy: { createdAt: "asc" } });

  it("ONE daily email per admin that can't be turned off: a call report appears once", async () => {
    const adm = await mkAdmin();
    const { testId, dev } = await setup();
    const { tester, sessionId } = await joined(testId);
    await bookCall(testId, dev.cookie, sessionId, tester.cookie, 48);
    const call = await db.call.findFirstOrThrow({ where: { contractId: sessionId } });
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 60_000), noShowBy: "tester", noShowNote: "Nobody came", noShowAt: new Date() } });
    await cron();
    const first = await adminMails(adm.user.email);
    expect(first.length).toBeGreaterThanOrEqual(1);
    expect(first[0].text).toContain("Call report on “Harbor Run” by the tester: “Nobody came”");
    expect((await db.call.findUniqueOrThrow({ where: { id: call.id } })).noShowDigestedAt).not.toBeNull();
    await cron(); // the report was sent once (other open cases may be listed again, this one is not)
    expect((await adminMails(adm.user.email)).filter((m) => m.text.includes("Nobody came"))).toHaveLength(1);
  });

  it("it lists THIS admin's suspended accounts with their paused tests and the tests this admin paused, with closing dates; failed payments are not in it; they drop off once closed", async () => {
    const adm = await mkAdmin();
    const other = await mkAdmin();
    const a = await setup();
    const b = await setup();
    const { suspendAccount, pauseTest } = await import("@/lib/server/restrictions");
    const { closePausedTest } = await import("@/lib/server/pauseClosure");
    await suspendAccount(adm.user.id, a.dev.user.id, "Testing");
    await pauseTest(adm.user.id, b.testId, "Looking");
    const j = await joined(b.testId).catch(() => null);
    void j;
    await db.payment.create({ data: { kind: "review", developerId: b.dev.user.id, testerId: a.dev.user.id, amountCents: 4321, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(Date.now() + DAY) } });
    await cron();
    const mails = await adminMails(adm.user.email);
    expect(mails.length).toBeGreaterThanOrEqual(1);
    const text = mails[0].text;
    expect(text).toContain(`You suspended Nora Lane (${a.dev.user.email})`);
    expect(text).toMatch(/paused test “Harbor Run”: Closes on [A-Z][a-z]{2} \d{1,2} unless your account is cleared/);
    expect(text).toContain(`/app/find/${a.testId}`);
    expect(text).toMatch(/You paused “Harbor Run” on .+: Closes on .+ unless the team lifts the pause/);
    expect(text).toContain(`/app/find/${b.testId}`);
    expect(text).not.toContain("43.21"); // failed payments need no action from the team: not in the email
    // The other admin did neither: nothing about these.
    expect((await adminMails(other.user.email)).some((m) => m.text.includes(a.dev.user.email) || m.text.includes(`/app/find/${b.testId}`))).toBe(false);
    // Once the tests close, they drop off (and with nothing else, no email goes).
    await closePausedTest(a.testId, "admin", new Date(), adm.user.id);
    await closePausedTest(b.testId, "admin", new Date(), adm.user.id);
    await db.appState.deleteMany({ where: { key: `adminDaily:${adm.user.id}` } });
    await cron();
    expect((await adminMails(adm.user.email)).filter((m) => m.text.includes(a.dev.user.email) || m.text.includes(`/app/find/${b.testId}`))).toHaveLength(1); // only the first one
  });
});
