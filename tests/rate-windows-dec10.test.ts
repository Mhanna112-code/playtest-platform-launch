import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RATE_CHARGE_FIRST, RATE_INACTIVE, RATE_TEST_PAUSED, ratePendingLine } from "@/lib/rules";
import { testerRateLiftedAt, testerRatingClosesAt } from "@/lib/server/closeOut";
import { devRateStates, testerRateState } from "@/lib/server/ratings";
import { joined, setup } from "./fixtures";

// (Owner, Dec 10 2026) The Rate windows, with the owner's examples: the test closes Dec 10, so the close-out is Dec 24.
// Ana's Rate closes at HER close-out: 14 days after the test close, moved only by Nora's side (moneySpans: her holds and suspensions whenever they ran, the
// team's pause cut at the Stop, outages) and Ana's own disputes on that contract; Ana's own suspension no longer moves it. Nora's Rate opens once everything Ana
// sent is settled AND Ana rated (at the later of her rating and the last settlement) or Ana's Rate closed (at the later of that date and the last settlement).
// During a money freeze Ana's Rate is greyed for a Charge or her dispute first, hidden while work waits for review, and OPEN otherwise. The one "Rate is back"
// line after a freeze comes only when the freeze hid her Rate.

const at = (day: number, hour = 12) => new Date(Date.UTC(2030, 11, day, hour));
const CLOSE = at(10);

beforeEach(async () => {
  await db.outage.deleteMany({}); // site-wide rows: an earlier file's outage would move these dates
});

/** The test closed Dec 10 (Ana's deadline, Open until and the work's end); Ana's written answers were sent Dec 1 and paid Dec 9 (settled). */
async function closed() {
  const s = await setup();
  const j = await joined(s.testId, "Ana Silva", "she");
  await db.user.update({ where: { id: s.dev.user.id }, data: { timeZone: "UTC" } });
  await db.test.update({ where: { id: s.testId }, data: { status: "closed", openUntil: CLOSE, workEndedAt: CLOSE } });
  await db.contract.update({ where: { id: j.sessionId }, data: { status: "ended", endKind: "closed", endedAt: CLOSE, dueAt: CLOSE } });
  const sub = await db.submission.create({ data: { contractId: j.sessionId, kind: "written", agreedCents: 1000, answers: ["a"], sentAt: at(1), updatedAt: at(1), payBy: at(8) } });
  await db.review.create({ data: { contractId: j.sessionId, submissionId: sub.id, amountCents: 1000, agreedCents: 1000, payKey: randomUUID(), createdAt: at(9) } });
  return { ...s, ...j, sub };
}
type W = Awaited<ReturnType<typeof closed>>;
const devOpensAt = async (w: W, now: Date) => (await devRateStates([w.sessionId], now)).get(w.sessionId)!;
const hold = async (w: W, from: Date, to: Date | null) => {
  await db.accountEvent.create({ data: { userId: w.dev.user.id, kind: "hold", side: "", createdAt: from } });
  if (to) await db.accountEvent.create({ data: { userId: w.dev.user.id, kind: "hold-lifted", side: "", createdAt: to } });
  else await db.user.update({ where: { id: w.dev.user.id }, data: { holdStartedAt: from, holdReason: "unpaid" } });
};
const testerSuspended = async (w: W, from: Date, to: Date) => {
  await db.accountEvent.create({ data: { userId: w.tester.user.id, kind: "suspended", side: "tester", createdAt: from } });
  await db.accountEvent.create({ data: { userId: w.tester.user.id, kind: "reinstated", side: "tester", createdAt: to } });
};
/** One more part Ana sent, unreviewed: its review date `payBy` (Charge opens then, her deadline Dec 10 having passed). */
const waiting = (w: W, sentAt: Date, payBy: Date) => db.submission.create({ data: { contractId: w.sessionId, kind: "recording", agreedCents: 1000, sentAt, updatedAt: sentAt, payBy } });

describe("Ana's Rate closes at her close-out; Nora's opens then if Ana never rated", () => {
  it("nothing after the close: Ana's Rate closes Dec 24; Nora (Ana never rated, all settled) opens Dec 24", async () => {
    const w = await closed();
    expect(await testerRatingClosesAt(w.sessionId, at(30))).toEqual(at(24));
    expect((await testerRateState(w.sessionId, at(23))).kind).toBe("open");
    expect((await testerRateState(w.sessionId, at(24))).kind).toBe("closed");
    const s = await devOpensAt(w, at(30));
    expect(s.opensAt).toEqual(at(24));
    expect(s.kind).toBe("open");
    expect(s.endsAt).toEqual(new Date(at(24).getTime() + 14 * 86_400_000));
  });

  it("Ana suspended Dec 12–19: her Rate still closes Dec 24 (hidden while suspended); Nora opens Dec 24", async () => {
    const w = await closed();
    await testerSuspended(w, at(12), at(19));
    expect(await testerRatingClosesAt(w.sessionId, at(30))).toEqual(at(24));
    expect((await devOpensAt(w, at(30))).opensAt).toEqual(at(24));
    // While the suspension is on: hidden as before, and the date doesn't move day by day.
    await db.user.update({ where: { id: w.tester.user.id }, data: { testerSuspendedAt: at(19) } });
    expect(await testerRateState(w.sessionId, at(20))).toMatchObject({ kind: "hidden", line: RATE_INACTIVE });
    expect(await testerRatingClosesAt(w.sessionId, at(22))).toEqual(at(24));
  });

  it("Nora on hold Dec 12–15: Ana's Rate closes Dec 27; Nora opens Dec 27 if Ana didn't rate; Ana rating on Dec 20 opens Nora on Dec 20", async () => {
    const w = await closed();
    await hold(w, at(12), at(15));
    expect(await testerRatingClosesAt(w.sessionId, at(30))).toEqual(at(27));
    expect((await devOpensAt(w, at(26))).opensAt).toBeNull();
    expect((await devOpensAt(w, at(30))).opensAt).toEqual(at(27));
    await db.rating.create({ data: { testId: w.testId, contractId: w.sessionId, side: "tester", raterId: w.tester.user.id, rateeId: w.dev.user.id, stars: 4, createdAt: at(20) } });
    const s = await devOpensAt(w, at(21));
    expect(s.opensAt).toEqual(at(20));
    expect(s.kind).toBe("open");
  });

  it("Ana rated Dec 20 but a piece settles Dec 22: Nora opens Dec 22 (everything she sent is settled, as before)", async () => {
    const w = await closed();
    await db.rating.create({ data: { testId: w.testId, contractId: w.sessionId, side: "tester", raterId: w.tester.user.id, rateeId: w.dev.user.id, stars: 4, createdAt: at(20) } });
    const more = await waiting(w, at(5), at(12));
    expect((await devOpensAt(w, at(21))).opensAt).toBeNull();
    await db.review.create({ data: { contractId: w.sessionId, submissionId: more.id, amountCents: 1000, agreedCents: 1000, payKey: randomUUID(), createdAt: at(22) } });
    expect((await devOpensAt(w, at(23))).opensAt).toEqual(at(22));
  });

  it("Ana's dispute open Dec 20–22: Ana's Rate closes Dec 26", async () => {
    const w = await closed();
    await db.dispute.create({ data: { contractId: w.sessionId, submissionId: w.sub.id, testerId: w.tester.user.id, reason: "I sent more than this pays for.", status: "decided", createdAt: at(20), decidedAt: at(22) } });
    expect(await testerRatingClosesAt(w.sessionId, at(30))).toEqual(at(26));
    expect((await devOpensAt(w, at(30))).opensAt).toEqual(at(26));
  });
});

describe("Ana's Rate during Nora's hold (Dec 12, still on)", () => {
  it("all her work reviewed: OPEN", async () => {
    const w = await closed();
    await hold(w, at(12), null);
    expect((await testerRateState(w.sessionId, at(15))).kind).toBe("open");
  });

  it("with a Charge open: greyed, Charge first", async () => {
    const w = await closed();
    await db.submission.create({ data: { contractId: w.sessionId, kind: "recording", agreedCents: 1000, sentAt: at(1), updatedAt: at(1), payBy: at(9), choiceOfferedAt: at(10, 13), choiceBy: at(17) } });
    await hold(w, at(12), null);
    expect(await testerRateState(w.sessionId, at(15))).toMatchObject({ kind: "disabled", line: RATE_CHARGE_FIRST });
  });

  it("with work waiting for review: hidden, \"You can rate once this test resumes.\" (also once its stored review date passes during the hold)", async () => {
    const w = await closed();
    await waiting(w, at(9), at(16));
    expect(RATE_TEST_PAUSED).toBe("You can rate once this test resumes.");
    expect((await testerRateState(w.sessionId, at(11))).kind).toBe("disabled"); // before the hold: greyed with its review date
    await hold(w, at(12), null);
    expect(await testerRateState(w.sessionId, at(15))).toMatchObject({ kind: "hidden", line: RATE_TEST_PAUSED });
    // Its review date was still ahead when the hold began, so it moves with the hold: still waiting on Dec 18.
    expect(await testerRateState(w.sessionId, at(18))).toMatchObject({ kind: "hidden", line: RATE_TEST_PAUSED });
  });
});

describe("Nora's waiting line names both ways her Rate opens", () => {
  it("before Ana's Rate ends: its date in Nora's zone; once it ended: only the settling; before the test closed: as before", async () => {
    const w = await closed();
    expect(ratePendingLine("Ana Silva", "she", { date: "Dec 24, 2030", passed: false })).toBe("You can rate Ana Silva once she's rated you (or her time to rate ends on Dec 24, 2030) and everything she sent is settled.");
    expect(ratePendingLine("Sam", null, { date: "Dec 24, 2030", passed: false })).toBe("You can rate Sam once they've rated you (or their time to rate ends on Dec 24, 2030) and everything they sent is settled.");
    expect(ratePendingLine("Sam", null, { date: "Dec 24, 2030", passed: true })).toBe("You can rate Sam once everything they sent is settled.");
    expect(ratePendingLine("Ana Silva", "she")).toBe("You can rate Ana Silva once she's rated you and everything she sent is settled.");
    expect(await devOpensAt(w, at(20))).toMatchObject({ kind: "hidden", line: "You can rate Ana Silva once she's rated you (or her time to rate ends on Dec 24, 2030) and everything she sent is settled." });
    // In Nora's zone: Dec 24 12:00 UTC is already Dec 25 in Kiritimati (UTC+14).
    await db.user.update({ where: { id: w.dev.user.id }, data: { timeZone: "Pacific/Kiritimati" } });
    expect((await devOpensAt(w, at(20))).line).toContain("ends on Dec 25, 2030");
    await db.user.update({ where: { id: w.dev.user.id }, data: { timeZone: "UTC" } });
    // Ended with a piece still unsettled: only the settling is left.
    await waiting(w, at(9), at(16));
    expect((await devOpensAt(w, at(26))).line).toBe("You can rate Ana Silva once everything she sent is settled.");
    // The test not closed yet (Open until ahead): no date to name.
    await db.test.update({ where: { id: w.testId }, data: { status: "running", openUntil: at(31), workEndedAt: null } });
    await db.contract.update({ where: { id: w.sessionId }, data: { status: "working", endKind: "", endedAt: null, dueAt: at(31) } });
    expect((await devOpensAt(w, at(20))).line).toBe("You can rate Ana Silva once she's rated you and everything she sent is settled.");
  });
});

describe("the one \"Rate is back\" line after a freeze (testerRateLiftedAt)", () => {
  it("Nora's hold Dec 12–15 while all Ana's work was reviewed: her Rate stayed open, no lift", async () => {
    const w = await closed();
    await hold(w, at(12), at(15));
    expect(await testerRateLiftedAt(w.sessionId, at(16))).toBeNull();
  });

  it("Nora's hold Dec 12–15 while a part waited for review (reviewed Dec 16): lifted Dec 15", async () => {
    const w = await closed();
    const more = await waiting(w, at(11), at(18));
    await hold(w, at(12), at(15));
    await db.review.create({ data: { contractId: w.sessionId, submissionId: more.id, amountCents: 1000, agreedCents: 1000, payKey: randomUUID(), createdAt: at(16) } });
    expect(await testerRateLiftedAt(w.sessionId, at(17))).toEqual(at(15));
  });

  it("a part whose review date passed before the hold began (its Charge open) doesn't count: no lift", async () => {
    const w = await closed();
    await waiting(w, at(5), at(11));
    await hold(w, at(12), at(15));
    expect(await testerRateLiftedAt(w.sessionId, at(16))).toBeNull();
  });

  it("Ana's own suspension Dec 12–14 hid her Rate: lifted Dec 14", async () => {
    const w = await closed();
    await testerSuspended(w, at(12), at(14));
    expect(await testerRateLiftedAt(w.sessionId, at(16))).toEqual(at(14));
  });
});
