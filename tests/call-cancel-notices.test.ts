import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { pauseTest, suspendAccount } from "@/lib/server/restrictions";
import { startHold } from "@/lib/server/holds";
import { fmtIn } from "@/lib/tz";
import { makeUser } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Dec 2026) Every notice that a booked call of yours was cancelled by anything but your own press: `always` (the morning email whatever your email
// setting; not sent at once, no expiry), in that test's own stack (its testId, no group). Your own suspension or hold that cancels it gives you the same line,
// and your pause notice stays as it was. Your own press (Cancel, Leave) still gives you none.

const when = (d: Date) => fmtIn("UTC", d); // the readers here have no zone: UTC
const day = (d: Date) => fmtIn("UTC", d, "dayTime");
async function admin() {
  const a = await makeUser({ email: `admin-cancel-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}
/** A working tester (Ana Silva) with a call booked `hours` ahead with the developer (Nora Lane) on “Harbor Run”. */
async function booked(hours = 48) {
  const s = await setup({ liveRateCents: "30.00" });
  const j = await joined(s.testId);
  const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, hours);
  await settle();
  return { ...s, ...j, call };
}
const lineOf = (userId: string, text: string) => db.notification.findFirst({ where: { userId, text }, orderBy: { createdAt: "desc" } });
/** The cancellation notice: always (mustEmail), waiting for the morning email (not sent at once), in its test's own stack. */
async function expectCancelNotice(userId: string, text: string, testId: string) {
  const n = await lineOf(userId, text);
  expect(n, text).toBeTruthy();
  expect(n).toMatchObject({ mustEmail: true, summarizedAt: null, testId, groupKey: null, own: false });
}
const cancelLines = (userId: string) => db.notification.count({ where: { userId, text: { contains: "cancel" } } });

describe("(Owner, Dec 2026) call cancellation notices: always, in the test's stack, not at once", () => {
  it("the other side's Cancel: the tester's notice; the developer, who pressed it, gets none", async () => {
    const w = await booked();
    const devBefore = await cancelLines(w.dev.user.id);
    expect((await act(w.testId, "cancel-call", w.dev.cookie, { callId: w.call.id, reason: "", seenAt: seen(), confirmed: true })).status).toBe(200);
    await expectCancelNotice(w.tester.user.id, `Nora Lane cancelled the call on “Harbor Run” on ${day(w.call.startsAt)}.`, w.testId);
    expect(await cancelLines(w.dev.user.id)).toBe(devBefore);
  });

  it("the tester's Cancel: the developer's notice", async () => {
    const w = await booked();
    expect((await sact(w.sessionId, "cancel-call", w.tester.cookie, { callId: w.call.id, reason: "", seenAt: seen(), confirmed: true })).status).toBe(200);
    await expectCancelNotice(w.dev.user.id, `Ana Silva cancelled the call on “Harbor Run” on ${day(w.call.startsAt)}.`, w.testId);
  });

  it("Leave: the developer's left line naming the call is always; the tester who left gets no line", async () => {
    const w = await booked();
    const before = await db.notification.count({ where: { userId: w.tester.user.id } });
    expect((await sact(w.sessionId, "leave", w.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    await expectCancelNotice(w.dev.user.id, `Ana Silva left “Harbor Run”; your call on ${when(w.call.startsAt)} was cancelled`, w.testId);
    expect(await db.notification.count({ where: { userId: w.tester.user.id } })).toBe(before);
  });

  it("the tester's suspension: her own cancellation line (always, in the test's stack); her pause notice unchanged; the developer's left line always", async () => {
    const w = await booked();
    const a = await admin();
    await suspendAccount(a.user.id, w.tester.user.id, "Checking reports.", "tester");
    const mine = await db.notification.findFirstOrThrow({ where: { userId: w.tester.user.id, text: { startsWith: `Your call on “Harbor Run” on ${day(w.call.startsAt)} was cancelled because ` } } });
    await expectCancelNotice(w.tester.user.id, mine.text, w.testId);
    expect(await lineOf(w.tester.user.id, "Your tester account is paused")).toBeTruthy(); // as before, naming no call
    await expectCancelNotice(w.dev.user.id, `Ana Silva left “Harbor Run”; your call on ${when(w.call.startsAt)} was cancelled`, w.testId);
  });

  it("the team's pause (a call within 3 days): both notices", async () => {
    const w = await booked(30);
    const a = await admin();
    await pauseTest(a.user.id, w.testId, "Checking a report about this test.");
    await expectCancelNotice(w.tester.user.id, `Your call on “Harbor Run” on ${day(w.call.startsAt)} was cancelled because the test is paused.`, w.testId);
    await expectCancelNotice(w.dev.user.id, `Your call with Ana Silva on “Harbor Run” on ${day(w.call.startsAt)} was cancelled because the test is paused.`, w.testId);
  });

  it("the developer's suspension: both notices, the developer's too; their pause notice unchanged (names no call)", async () => {
    const w = await booked(30);
    const a = await admin();
    await suspendAccount(a.user.id, w.dev.user.id, "Checking reports.", "developer");
    await expectCancelNotice(w.tester.user.id, `Your call on “Harbor Run” on ${day(w.call.startsAt)} was cancelled because the test is paused.`, w.testId);
    await expectCancelNotice(w.dev.user.id, `Your call with Ana Silva on “Harbor Run” on ${day(w.call.startsAt)} was cancelled because the test is paused.`, w.testId);
    const paused = await db.notification.findFirstOrThrow({ where: { userId: w.dev.user.id, text: { startsWith: "Your developer account is paused" } } });
    expect(paused.text).not.toContain("call");
  });

  it("a hold starting: both notices; the hold notice unchanged (names no call)", async () => {
    const w = await booked(30);
    await startHold(w.dev.user.id, "unpaid");
    await expectCancelNotice(w.tester.user.id, `Your call on “Harbor Run” on ${day(w.call.startsAt)} was cancelled because the test is paused.`, w.testId);
    await expectCancelNotice(w.dev.user.id, `Your call with Ana Silva on “Harbor Run” on ${day(w.call.startsAt)} was cancelled because the test is paused.`, w.testId);
    const paused = await db.notification.findFirstOrThrow({ where: { userId: w.dev.user.id, text: { startsWith: "Your tests are paused" } } });
    expect(paused.text).not.toContain("call");
  });
});
