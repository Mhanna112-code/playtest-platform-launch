import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { closeOutOf, disputeClosedFor, payMoreClosesAt, pieceCloseOut, testerRatingClosesAt } from "@/lib/server/closeOut";
import { devRateStates } from "@/lib/server/ratings";
import { pauseTest, unpauseTest } from "@/lib/server/restrictions";
import { joined, setup } from "./fixtures";
import { makeUser } from "./helpers";

const DAY = 86_400_000;
const date = (s: string) => new Date(`${s}Z`);
const shifted = (d: Date) => new Date(+d + 2 * DAY);

it("BlockTest rehearsal: lifting a two-day team pause shifts working and settlement windows once", async () => {
  const active = await setup();
  const elapsedDuring = await joined(active.testId, "Working Tester");
  const alreadyExpired = await joined(active.testId, "Expired Tester");
  const closed = await setup();
  const finished = await joined(closed.testId, "Finished Tester");
  const rated = await joined(closed.testId, "Rated Tester");
  const admin = (await makeUser()).user;
  const start = date("2026-11-08T12:00:00");
  const lift = shifted(start);
  const joinBy = date("2026-11-10T23:59:59");
  const dueDuring = date("2026-11-09T23:59:59");
  const dueBefore = date("2026-11-07T23:59:59");
  const reviewBy = date("2026-11-13T17:00:00");
  const choiceBy = date("2026-11-20T17:00:00");
  const sentAt = date("2026-11-06T17:00:00");
  await db.user.update({ where: { id: active.dev.user.id }, data: { timeZone: "UTC" } });
  await db.test.update({ where: { id: active.testId }, data: { openUntil: joinBy } });
  await db.contract.update({ where: { id: elapsedDuring.sessionId }, data: { dueAt: dueDuring } });
  await db.contract.update({ where: { id: alreadyExpired.sessionId }, data: { dueAt: dueBefore } });
  await db.test.update({ where: { id: closed.testId }, data: { openUntil: dueBefore, workEndedAt: dueBefore } });
  await db.contract.update({ where: { id: finished.sessionId }, data: { dueAt: dueBefore, status: "ended", endedAt: dueBefore, endKind: "closed" } });
  await db.contract.update({ where: { id: rated.sessionId }, data: { dueAt: dueBefore, status: "left", endedAt: dueBefore, endKind: "rated" } });
  const paid = await db.submission.create({ data: { contractId: rated.sessionId, kind: "written", agreedCents: 1000, sentAt, updatedAt: sentAt } });
  await db.review.create({ data: { contractId: rated.sessionId, submissionId: paid.id, amountCents: 1000, reason: "", payKey: randomUUID(), createdAt: sentAt } });
  await db.rating.create({ data: { contractId: rated.sessionId, testId: closed.testId, side: "tester", raterId: rated.tester.user.id, rateeId: closed.dev.user.id, stars: 5, createdAt: dueBefore } });
  const submission = await db.submission.create({ data: { contractId: finished.sessionId, kind: "written", agreedCents: 1000, sentAt, updatedAt: sentAt, payBy: reviewBy, choiceBy } });
  const slot = await db.callSlot.create({ data: { testId: closed.testId, startsAt: sentAt, minutes: 30, status: "booked" } });
  const call = await db.call.create({ data: { slotId: slot.id, contractId: finished.sessionId, status: "booked", startsAt: sentAt, minutes: 30, measuredMinutes: 30, measuredAt: sentAt, rateCents: 1000, payBy: reviewBy } });
  const piece = { submissionId: submission.id };
  const windows = (now: Date) => Promise.all([
    closeOutOf(closed.testId, now), testerRatingClosesAt(finished.sessionId, now),
    pieceCloseOut(piece, "developer", now), pieceCloseOut(piece, "tester", now),
    pieceCloseOut({ callId: call.id }, "tester", now), payMoreClosesAt(closed.testId, now),
    devRateStates([rated.sessionId], now).then((states) => states.get(rated.sessionId)?.endsAt ?? null),
  ]);
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(start);
    const before = await windows(start);
    for (const testId of [active.testId, closed.testId]) {
      await pauseTest(admin.id, testId, "Checking all deadline windows.");
      await db.testEvent.updateMany({ where: { testId, kind: "paused" }, data: { createdAt: start } });
    }
    vi.setSystemTime(lift);
    for (const testId of [active.testId, closed.testId]) {
      await unpauseTest(testId);
      await db.testEvent.updateMany({ where: { testId, kind: "resumed" }, data: { createdAt: lift } });
    }
    const [listing, working, expired, finishedTest, work, measured] = await Promise.all([
      db.test.findUniqueOrThrow({ where: { id: active.testId } }),
      db.contract.findUniqueOrThrow({ where: { id: elapsedDuring.sessionId } }),
      db.contract.findUniqueOrThrow({ where: { id: alreadyExpired.sessionId } }),
      db.test.findUniqueOrThrow({ where: { id: closed.testId } }),
      db.submission.findUniqueOrThrow({ where: { id: submission.id } }),
      db.call.findUniqueOrThrow({ where: { id: call.id } }),
    ]);
    expect(listing.openUntil).toEqual(shifted(joinBy));
    expect(working.dueAt).toEqual(shifted(dueDuring));
    expect(expired.dueAt).toEqual(dueBefore);
    expect(finishedTest.openUntil).toEqual(dueBefore);
    expect(finishedTest.workEndedAt).toEqual(dueBefore);
    expect(work).toMatchObject({ payBy: shifted(reviewBy), choiceBy: shifted(choiceBy) });
    expect(measured).toMatchObject({ payBy: shifted(reviewBy), measuredAt: sentAt });
    expect(before.every(Boolean)).toBe(true);
    const after = await windows(lift);
    expect(after).toEqual(before.map((d) => shifted(d!)));
    const oldClose = before[3]!;
    const newClose = after[3]!;
    expect(await disputeClosedFor(finished.sessionId, piece, new Date(+oldClose + 1))).toBeNull();
    expect(await disputeClosedFor(finished.sessionId, piece, newClose)).toMatch(/can't be disputed any more/);
    console.info("BlockTest window evidence (UTC)", JSON.stringify({
      pause: [start, lift], openUntil: [joinBy, listing.openUntil], workingDue: [dueDuring, working.dueAt],
      alreadyExpiredDue: [dueBefore, expired.dueAt], writtenReview: [reviewBy, work.payBy], chargeChoiceBy: [choiceBy, work.choiceBy], callReview: [reviewBy, measured.payBy],
      windowOrder: ["test close-out", "tester rating", "piece Pay", "piece Charge and dispute", "call close-out", "Pay more", "developer rating"], before, after,
    }));
  } finally {
    vi.useRealTimers();
  }
});
