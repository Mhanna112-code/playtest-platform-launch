import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { fmtDate } from "@/lib/format";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import { closeOutOf, payMoreClosesAt, pieceCloseOut } from "@/lib/server/closeOut";
import { closeOutMark } from "@/lib/server/holds";
import { decideDispute } from "@/lib/server/payments";
import { makeUser } from "./helpers";
import { bookCall, joined, sact, seen, settle, setup } from "./fixtures";
import { DAY, pay, payMore, sentWork } from "./b15";

// Batch 17 §19 (final), the money half: Pay more ends on the test's close-out date (14 days after the last tester's deadline, moved by pauses and outages); each piece's
// Pay, Charge and Let it go end on its own date (the close-out, or 14 days after its Charge opened if later; the tester's side adds the time their tester side was
// suspended). Disputes are unchanged. Reminders 3 days and 1 day before a piece closes, once each.
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const cron = () => cronGET(new Request("http://localhost:3400/api/cron/daily", { headers: { authorization: "Bearer cron-test" } })).then((r) => r.json());
const ago = (days: number) => new Date(Date.now() - days * DAY);
// (Outages are site-wide: an earlier test file's outage would move these dates.)
beforeEach(async () => {
  await db.outage.deleteMany({});
});

/** Every deadline (and Open until) of a test `daysAgo` days ago, so its close-out is 14 days after that. Returns that base. */
async function deadlinesAt(testId: string, daysAgo: number) {
  const base = ago(daysAgo);
  await db.test.update({ where: { id: testId }, data: { openUntil: base } });
  await db.contract.updateMany({ where: { testId }, data: { dueAt: base } });
  return base;
}
/** A sent part whose review window passed (Charge can open once the deadline passed too). */
const overdue = (subId: string) => db.submission.update({ where: { id: subId }, data: { payBy: ago(20) } });
/** Charge already open on the piece (as the daily job does it). */
const chargeOpen = (subId: string) => db.submission.update({ where: { id: subId }, data: { payBy: ago(20), choiceOfferedAt: ago(8), choiceBy: ago(1), remindedAt: ago(1) } });

describe("the close-out date (section 19)", () => {
  it("14 days after the LAST tester's deadline (a late joiner's counts); unknown while a working tester's deadline is ahead; a stop counts from the stop", async () => {
    const { testId } = await setup({ spots: 5 });
    const a = await joined(testId);
    const b = await joined(testId, "Ben Carter", "he"); // the late joiner: a later deadline
    const now = new Date();
    await db.test.update({ where: { id: testId }, data: { openUntil: ago(20) } });
    await db.contract.update({ where: { id: a.sessionId }, data: { dueAt: ago(20) } });
    const dueB = new Date(now.getTime() + 2 * DAY);
    await db.contract.update({ where: { id: b.sessionId }, data: { dueAt: dueB } });
    expect(await closeOutOf(testId, now)).toBeNull(); // Ben can still work
    const dueB2 = ago(10);
    await db.contract.update({ where: { id: b.sessionId }, data: { dueAt: dueB2 } });
    expect((await closeOutOf(testId, now))!.getTime()).toBe(dueB2.getTime() + 14 * DAY);
    // Stopped later than every deadline: 14 days after the stop.
    const stoppedAt = ago(5);
    await db.test.update({ where: { id: testId }, data: { status: "stopped", stoppedAt } });
    expect((await closeOutOf(testId, now))!.getTime()).toBe(stoppedAt.getTime() + 14 * DAY);
  });

  it("moves later with the team's pause, a developer hold (ended or on now) and an outage", async () => {
    const { testId, dev } = await setup();
    await joined(testId);
    const now = new Date();
    const base = await deadlinesAt(testId, 10);
    const at = (d: number) => new Date(base.getTime() + d * DAY);
    expect((await closeOutOf(testId, now))!.getTime()).toBe(at(14).getTime());
    // The team paused it for 2 days.
    await db.testEvent.create({ data: { testId, kind: "paused", text: "The team paused this test", createdAt: at(1) } });
    await db.testEvent.create({ data: { testId, kind: "resumed", text: "The team lifted the pause on this test", createdAt: at(3) } });
    expect((await closeOutOf(testId, now))!.getTime()).toBe(at(16).getTime());
    // A payment hold of 3 days.
    await db.accountEvent.create({ data: { userId: dev.user.id, kind: "hold", createdAt: at(4) } });
    await db.accountEvent.create({ data: { userId: dev.user.id, kind: "hold-lifted", createdAt: at(7) } });
    expect((await closeOutOf(testId, now))!.getTime()).toBe(at(19).getTime());
    // An outage of 6 hours.
    await db.outage.create({ data: { startAt: at(8), endAt: new Date(at(8).getTime() + 6 * 3_600_000), ms: 6 * 3_600_000 } });
    expect((await closeOutOf(testId, now))!.getTime()).toBe(at(19).getTime() + 6 * 3_600_000);
    // A hold on now (since day 9): the close-out keeps moving with it (the days left at its start, counted from now).
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: at(9) } });
    await db.accountEvent.create({ data: { userId: dev.user.id, kind: "hold", createdAt: at(9) } });
    const left = at(19).getTime() + 6 * 3_600_000 - at(9).getTime();
    expect((await closeOutOf(testId, now))!.getTime()).toBe(now.getTime() + left);
  });

  it("a tester whose tester side was suspended gets that time added to their pieces' Charge (not to the developer's Pay, nor the test's close-out)", async () => {
    const w = await sentWork("10.00", { spots: 5 });
    const b = await joined(w.testId, "Ben Carter", "he");
    await sact(b.sessionId, "written", b.tester.cookie, { answers: ["a", "b"] });
    await settle();
    const subB = await db.submission.findFirstOrThrow({ where: { contractId: b.sessionId } });
    const now = new Date();
    const base = await deadlinesAt(w.testId, 10);
    for (const id of [w.sub.id, subB.id]) await overdue(id); // Charge opened at the deadline: the piece closes with the test
    await db.accountEvent.create({ data: { userId: w.tester.user.id, kind: "suspended", side: "tester", createdAt: new Date(base.getTime() + DAY) } });
    await db.accountEvent.create({ data: { userId: w.tester.user.id, kind: "reinstated", side: "tester", createdAt: new Date(base.getTime() + 4 * DAY) } });
    expect((await closeOutOf(w.testId, now))!.getTime()).toBe(base.getTime() + 14 * DAY);
    expect((await pieceCloseOut({ submissionId: w.sub.id }, "tester", now))!.getTime()).toBe(base.getTime() + 17 * DAY);
    expect((await pieceCloseOut({ submissionId: w.sub.id }, "developer", now))!.getTime()).toBe(base.getTime() + 14 * DAY);
    expect((await pieceCloseOut({ submissionId: subB.id }, "tester", now))!.getTime()).toBe(base.getTime() + 14 * DAY);
    // Their developer side's suspension doesn't count for their Charge.
    await db.accountEvent.create({ data: { userId: b.tester.user.id, kind: "suspended", side: "developer", createdAt: new Date(base.getTime() + DAY) } });
    expect((await pieceCloseOut({ submissionId: subB.id }, "tester", now))!.getTime()).toBe(base.getTime() + 14 * DAY);
  });

  it("a late piece whose Charge opened less than 14 days before close-out keeps Charge and Pay until 14 days after its Charge opened; Pay more runs as long", async () => {
    const w = await sentWork();
    const c = await joined(w.testId, "Cara Diaz", "she");
    await sact(c.sessionId, "written", c.tester.cookie, { answers: ["a", "b"] });
    await settle();
    const subC = await db.submission.findFirstOrThrow({ where: { contractId: c.sessionId } });
    const base = await deadlinesAt(w.testId, 15); // the test's close-out was yesterday
    // Both sent late: Ana's Charge opened 5 days ago, Cara's 2 days ago (7 days after each was sent).
    const openedA = ago(5), openedC = ago(2);
    await db.submission.update({ where: { id: w.sub.id }, data: { payBy: openedA, choiceOfferedAt: openedA, choiceBy: new Date(openedA.getTime() + 7 * DAY), remindedAt: openedA } });
    await db.submission.update({ where: { id: subC.id }, data: { payBy: openedC, choiceOfferedAt: openedC, choiceBy: new Date(openedC.getTime() + 7 * DAY), remindedAt: openedC } });
    const now = new Date();
    expect((await closeOutOf(w.testId, now))!.getTime()).toBe(base.getTime() + 14 * DAY);
    expect((await pieceCloseOut({ submissionId: w.sub.id }, "developer", now))!.getTime()).toBe(openedA.getTime() + 14 * DAY);
    expect((await pieceCloseOut({ submissionId: w.sub.id }, "tester", now))!.getTime()).toBe(openedA.getTime() + 14 * DAY);
    // Pay more closes with the last of them (Cara's).
    expect((await payMoreClosesAt(w.testId, now))!.getTime()).toBe(openedC.getTime() + 14 * DAY);
    // Ana's Charge and the developer's Pay (and Pay more) of Cara's piece still go through.
    const charge = await sact(w.sessionId, "choose", w.tester.cookie, { submissionId: w.sub.id, choice: "charge", seenAt: seen() });
    expect(charge.status).toBe(200);
    expect(charge.body).toMatchObject({ choice: "charge", amountCents: 1000 });
    expect((await pay(w.dev.cookie, { kind: "submission", id: subC.id, amount: "5.00", tickedCents: 500, reason: "Partly useful" })).status).toBe(200);
    expect((await payMore(w.testId, w.dev.cookie, { contractId: c.sessionId, submissionId: subC.id, amount: "1.00", tickedCents: 100 })).status).toBe(200);
  });
});

describe("Pay more closes together with the last Pay / Charge on the test", () => {
  it("unknown while testers can still work; then the close-out, or a later piece's own window (calls that took place too); the grey line; open before, refused after", async () => {
    const w = await sentWork("10.00", { spots: 5 });
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "5.00", tickedCents: 500, reason: "Partly useful" })).status).toBe(200);
    const b = await joined(w.testId, "Ben Carter", "he");
    const booked = await bookCall(w.testId, w.dev.cookie, b.sessionId, b.tester.cookie);
    expect(await payMoreClosesAt(w.testId, new Date())).toBeNull(); // the deadlines are ahead
    const base = await deadlinesAt(w.testId, 20);
    await db.submission.update({ where: { id: w.sub.id }, data: { payBy: ago(25) } });
    const now = new Date();
    expect((await payMoreClosesAt(w.testId, now))!.getTime()).toBe(base.getTime() + 14 * DAY); // the close-out (6 days ago)
    // Ben's call took place late: its Charge opened 10 days ago, so its window (and Pay more) runs 4 more days, with the grey line.
    const callBy = ago(10);
    await db.call.update({ where: { id: booked.id }, data: { startsAt: ago(17), actualMinutes: 30, measuredMinutes: 30, measuredAt: ago(17), payBy: callBy } });
    const at = await payMoreClosesAt(w.testId, now);
    expect(at!.getTime()).toBe(callBy.getTime() + 14 * DAY);
    expect(R.closeOutSoon(at, now)).toBe(true);
    expect(R.payClosesLine(fmtDate(at!), true)).toBe(`Pay more closes on ${fmtDate(at!)}.`);
    expect((await payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "1.00", tickedCents: 100 })).status).toBe(200);
    // A call that didn't take place (not measured) doesn't count: Pay more closed with the close-out.
    await db.call.update({ where: { id: booked.id }, data: { actualMinutes: null, measuredAt: null } });
    expect((await payMoreClosesAt(w.testId, new Date()))!.getTime()).toBe(base.getTime() + 14 * DAY);
    expect((await payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "1.00", tickedCents: 100 })).body.error.message).toBe(`Pay more closed on ${fmtDate(new Date(base.getTime() + 14 * DAY))}.`);
  });
});

describe("after close-out: Pay, Pay more, Charge and Let it go are refused; unpaid stays unpaid", () => {
  it("refused on the server with the date; a suspended tester's extended Charge still works after the test's close-out", async () => {
    const w = await sentWork();
    // Ben's part is paid before close-out (for Pay more); Ana's isn't.
    const b = await joined(w.testId, "Ben Carter", "he");
    await sact(b.sessionId, "written", b.tester.cookie, { answers: ["a", "b"] });
    await settle();
    const subB = await db.submission.findFirstOrThrow({ where: { contractId: b.sessionId } });
    expect((await pay(w.dev.cookie, { kind: "submission", id: subB.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const base = await deadlinesAt(w.testId, 15); // close-out was yesterday
    await db.submission.update({ where: { id: subB.id }, data: { payBy: ago(20) } }); // its Charge would have opened at the deadline: no later window
    await chargeOpen(w.sub.id);
    const date = fmtDate(new Date(base.getTime() + 14 * DAY));
    const p = await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 });
    expect(p.status).toBe(409);
    expect(p.body.error.message).toBe(`Pay closed on ${date}.`);
    const more = await payMore(w.testId, w.dev.cookie, { contractId: b.sessionId, submissionId: subB.id, amount: "1.00", tickedCents: 100 });
    expect(more.body.error.message).toBe(`Pay more closed on ${date}.`);
    const charge = await sact(w.sessionId, "choose", w.tester.cookie, { submissionId: w.sub.id, choice: "charge", seenAt: seen() });
    expect(charge.body.error.message).toBe(`Charge and Let it go closed on ${date}.`);
    const letgo = await sact(w.sessionId, "choose", w.tester.cookie, { submissionId: w.sub.id, choice: "letgo", seenAt: seen() });
    expect(letgo.body.error.message).toBe(`Charge and Let it go closed on ${date}.`);
    expect(await db.review.count({ where: { submissionId: w.sub.id } })).toBe(0); // unpaid stays unpaid
    expect(await db.payment.count({ where: { submissionId: w.sub.id } })).toBe(0);
    // Ana's tester side was suspended 3 days in the window: her own close-out is 2 days ahead, so her Charge still works (the developer's Pay stays closed).
    await db.accountEvent.create({ data: { userId: w.tester.user.id, kind: "suspended", side: "tester", createdAt: new Date(base.getTime() + DAY) } });
    await db.accountEvent.create({ data: { userId: w.tester.user.id, kind: "reinstated", side: "tester", createdAt: new Date(base.getTime() + 4 * DAY) } });
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 })).body.error.message).toBe(`Pay closed on ${date}.`);
    const late = await sact(w.sessionId, "choose", w.tester.cookie, { submissionId: w.sub.id, choice: "charge", seenAt: seen() });
    expect(late.status).toBe(200);
    expect(late.body).toMatchObject({ choice: "charge", amountCents: 1000 });
  });

  it("an unlisted part (no Charge) is refused too, and a call's Charge after close-out", async () => {
    const w = await sentWork(null);
    const booked = await bookCall(w.testId, w.dev.cookie, w.sessionId, w.tester.cookie);
    const call = await db.call.update({ where: { id: booked.id }, data: { startsAt: ago(25), rateCents: 3000, actualMinutes: 30, measuredMinutes: 30, measuredAt: ago(25), payBy: ago(18), choiceOfferedAt: ago(10), choiceBy: ago(3) } });
    await deadlinesAt(w.testId, 20);
    await overdue(w.sub.id);
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "0", reason: "Not needed" })).body.error.message).toMatch(/^Pay closed on /);
    expect((await pay(w.dev.cookie, { kind: "call", id: call.id, amount: "15.00", tickedCents: 1500 })).body.error.message).toMatch(/^Pay closed on /);
    // (Batch 28 §21) A listed call has no Charge or Let it go: it is charged automatically.
    expect((await sact(w.sessionId, "choose", w.tester.cookie, { callId: call.id, choice: "letgo", seenAt: seen() })).body.error.message).toBe(R.AUTO_CHARGE_NO_CHOICE);
  });
});

describe("until close-out the developer can still Pay a piece after its Charge opened", () => {
  it("Charge opens (daily job), the developer pays: it goes through and settles the piece", async () => {
    const w = await sentWork();
    await deadlinesAt(w.testId, 3); // close-out in 11 days
    await overdue(w.sub.id);
    await cron();
    expect((await db.submission.findUniqueOrThrow({ where: { id: w.sub.id } })).choiceOfferedAt).not.toBeNull();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    expect((await sact(w.sessionId, "choose", w.tester.cookie, { submissionId: w.sub.id, choice: "charge", seenAt: seen() })).body.error.message).toBe("Nora Lane paid $10.00 for this meanwhile.");
  });
});

describe("disputes are unchanged after close-out", () => {
  it("a dispute filed before close-out is decided after it, and a raise still charges the developer", async () => {
    const w = await sentWork();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "5.00", tickedCents: 500, reason: "Partly useful" })).status).toBe(200);
    expect((await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.sub.id, reason: "I answered every question fully", seenAt: seen(), confirmed: true })).status).toBe(200);
    await deadlinesAt(w.testId, 20); // close-out passed 6 days ago
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: w.sub.id } });
    const a = await makeUser({ name: "Admin" });
    const admin = await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    expect(await decideDispute(admin, d.id, { total: "10.00" })).toEqual({ extraCents: 500 });
    expect(await db.payment.findFirstOrThrow({ where: { disputeId: d.id, kind: "dispute" } })).toMatchObject({ amountCents: 500 });
  });
});

describe("the daily job after close-out", () => {
  it("never offers Charge / Let it go, and doesn't remind either side about the piece", async () => {
    const w = await sentWork();
    await deadlinesAt(w.testId, 15);
    await overdue(w.sub.id);
    await cron();
    expect((await db.submission.findUniqueOrThrow({ where: { id: w.sub.id } })).choiceOfferedAt).toBeNull();
    expect(await db.notification.count({ where: { userId: w.tester.user.id, text: { contains: "charge" } } })).toBe(0);
    expect(await db.notification.count({ where: { userId: w.dev.user.id, text: { contains: "reviewed by" } } })).toBe(0);
    // A piece whose Charge was already open: no reminder after close-out.
    await chargeOpen(w.sub.id);
    await db.submission.update({ where: { id: w.sub.id }, data: { remindedAt: ago(4), devRemindedAt: ago(2) } });
    await cron();
    expect(await db.notification.count({ where: { userId: w.tester.user.id, text: { startsWith: "Reminder:" } } })).toBe(0);
    expect(await db.notification.count({ where: { userId: w.dev.user.id, text: { contains: "reviewed by" } } })).toBe(0);
    expect(await db.notification.count({ where: { userId: { in: [w.dev.user.id, w.tester.user.id] }, reminderKey: { startsWith: "closeout:" } } })).toBe(0);
  });
});

describe("the reminders 3 days and 1 day before close-out (DEFAULT protections)", () => {
  it("the marks", () => {
    const now = new Date("2026-12-01T12:00:00Z");
    const at = (d: number) => new Date(now.getTime() + d * DAY);
    expect(closeOutMark(null, now)).toBeNull();
    expect(closeOutMark(at(4), now)).toBeNull();
    expect(closeOutMark(at(2.5), now)).toBe(3);
    expect(closeOutMark(at(0.5), now)).toBe(1);
    expect(closeOutMark(at(-0.1), now)).toBeNull();
  });

  it("to the tester with work to Charge and the developer with work unpaid, once each, ignoring the email setting", async () => {
    const w = await sentWork();
    await db.user.update({ where: { id: w.tester.user.id }, data: { emailPref: "off" } });
    await deadlinesAt(w.testId, 11.5); // close-out in 2.5 days
    await overdue(w.sub.id);
    await cron();
    await cron();
    const tester = { userId: w.tester.user.id, text: { startsWith: "Charge or let go of your work on “Harbor Run” by " } };
    const dev = { userId: w.dev.user.id, text: { startsWith: "Pay Ana Silva's work on “Harbor Run” by " } };
    expect(await db.notification.count({ where: tester })).toBe(1);
    expect(await db.notification.count({ where: dev })).toBe(1);
    expect(await db.notification.findFirstOrThrow({ where: tester })).toMatchObject({ mustEmail: true, payment: true, reminderKey: expect.stringMatching(new RegExp(`^closeout:3d:tester:${w.sessionId}:\\d{4}-\\d{2}-\\d{2}$`)), link: `/app/sessions/${w.sessionId}#part-written` });
    expect(await db.notification.findFirstOrThrow({ where: dev })).toMatchObject({ mustEmail: true, reminderKey: expect.stringMatching(new RegExp(`^closeout:3d:dev:${w.sessionId}:`)), link: `/app/tests/${w.testId}#piece-${w.sub.id}` });
    // Email Off: the money line still went out in the end-of-day email.
    expect((await db.outboxEmail.findFirstOrThrow({ where: { to: w.tester.user.email } })).text).toContain("Charge or let go of your work on “Harbor Run” by ");
    // A day before: the second reminder, once.
    await deadlinesAt(w.testId, 13.5);
    await cron();
    await cron();
    expect(await db.notification.count({ where: tester })).toBe(2);
    expect(await db.notification.count({ where: dev })).toBe(2);
    expect(await db.notification.count({ where: { ...tester, reminderKey: { startsWith: `closeout:1d:tester:${w.sessionId}:` } } })).toBe(1);
  });

  it("nothing open, nothing sent: a paid piece, or a test paused (its close-out moves on)", async () => {
    const w = await sentWork();
    await deadlinesAt(w.testId, 11.5);
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    await cron();
    const sent = (ids: string[]) => db.notification.count({ where: { userId: { in: ids }, reminderKey: { startsWith: "closeout:" } } });
    expect(await sent([w.dev.user.id, w.tester.user.id])).toBe(0);
    const v = await sentWork();
    await deadlinesAt(v.testId, 11.5);
    await overdue(v.sub.id);
    await db.test.update({ where: { id: v.testId }, data: { adminPausedAt: new Date() } });
    await cron();
    expect(await sent([v.dev.user.id, v.tester.user.id])).toBe(0);
  });
});

describe("the pages (section 19)", () => {
  it("the developer's test page: the piece leaves Needs you, its place reads the closed line; Pay closes on <date> in the last 7 days", () => {
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page).toContain(".filter((x) => !payShut(x.id)) // (Batch 17 §19) its Pay closed");
    expect(page).toContain("{paySoon(x.id) && <p className=\"note\" data-pay-closes=\"\">{payClosesLine(paySoon(x.id))}</p>}");
    expect(page).toContain("closedNotPaidLine(shutOn(r.sub.id))");
    expect(page).toContain("closedNotPaidLine(shutOn(x.id))");
    expect(page).toContain("testerPayable(c.tester) && !payShut(x.id);");
    expect(page).toContain('await pieceCloseOut(k, "developer", now)');
    expect(R.closedNotPaidLine("Dec 6, 2026")).toBe("Closed on Dec 6, 2026: not paid.");
    expect(R.payClosesLine("Dec 6, 2026")).toBe("Pay closes on Dec 6, 2026.");
  });

  it("the tester's session page: Not paid (closed on <date>), no Charge box after, Charge closes on <date> before", () => {
    const page = src("app/app/sessions/[id]/page.tsx");
    expect(page).toContain('await pieceCloseOut(k, "tester", now)');
    expect(page).toContain("notPaidClosedLine(shutOn(sub.id))");
    expect(page).toContain("notPaidClosedLine(shutOn(x.id))");
    expect(page.match(/!chargeShut\((sub|x)\.id\)/g)!.length).toBeGreaterThanOrEqual(3); // (batch 28 §21) no Charge for listed calls
    expect(page.match(/data-charge-closes=""/g)).toHaveLength(1);
    expect(R.notPaidClosedLine("Dec 6, 2026")).toBe("Not paid (closed on Dec 6, 2026)");
    expect(R.chargeClosesLine("Dec 6, 2026")).toBe("Charge closes on Dec 6, 2026.");
  });

  it("the dashboards drop such pieces: the developer's Needs review rows and counts, the tester's Charge or cancel and Waiting for review", () => {
    const page = src("app/app/page.tsx");
    expect(page).toContain("c.submissions.filter((x) => !x.review && !payShut(x.id))");
    expect(page).toContain("!y.review && !payShut(y.id)");
    expect(page).toContain("s.choiceOfferedAt && !chargeShut(s.id)");
    expect(page).toContain("!s.review && !chargeShut(s.id)");
    expect(page).toContain("data-pay-closes");
  });
});
