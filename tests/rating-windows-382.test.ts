import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { json, req } from "./helpers";
import { joined, sact, seen, setup } from "./fixtures";
import { devRateStates } from "@/lib/server/ratings";
import { testerRatingClosesAt } from "@/lib/server/closeOut";

// (Owner, Nov 11 and 12, §382) Rating windows: (a) the tester's own suspension extends their Rate like Charge; (b) outages extend the developer's Rate however it
// opens; (c) the developer's Rate closes at the later of the close-out and 14 days after it opened, moved exactly by their own holds and suspensions (after the work
// ended too), the tester's disputes and outages; the tester's rating stays hidden until then.

const DAY = 86_400_000;
const HOUR = 3_600_000;
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);

/** Ana sent her written answers and was paid; the test closed `closedDaysAgo` days ago (her deadline and Open until then). */
async function closed(closedDaysAgo: number) {
  const s = await setup();
  const j = await joined(s.testId);
  expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  const at = new Date(Date.now() - closedDaysAgo * DAY);
  await db.test.update({ where: { id: s.testId }, data: { openUntil: at } });
  await db.contract.update({ where: { id: j.sessionId }, data: { dueAt: at } });
  await db.review.updateMany({ where: { contractId: j.sessionId }, data: { createdAt: at } }); // paid back then: settled long before the close-out
  return { ...s, ...j, at };
}
const near = (a: Date | null | undefined, b: number) => expect(Math.abs((a?.getTime() ?? 0) - b)).toBeLessThan(60_000);

describe("§382 a: the tester's own suspension extends their Rate (only the part after test close)", () => {
  it("a suspension before test close moves nothing; one after it moves the close by its length", async () => {
    await db.outage.deleteMany({});
    const x = await closed(10);
    const before = (await testerRatingClosesAt(x.sessionId))!.getTime();
    await db.accountEvent.createMany({ data: [
      { userId: x.tester.user.id, kind: "suspended", side: "tester", createdAt: new Date(x.at.getTime() - 3 * DAY) },
      { userId: x.tester.user.id, kind: "reinstated", side: "tester", createdAt: new Date(x.at.getTime() - 2 * DAY) },
    ] });
    near(await testerRatingClosesAt(x.sessionId), before);
    await db.accountEvent.createMany({ data: [
      { userId: x.tester.user.id, kind: "suspended", side: "tester", createdAt: new Date(Date.now() - 3 * DAY) },
      { userId: x.tester.user.id, kind: "reinstated", side: "tester", createdAt: new Date(Date.now() - 2 * DAY) },
    ] });
    near(await testerRatingClosesAt(x.sessionId), before + DAY);
  });
});

describe("§382 b and c: the developer's Rate window", () => {
  it("opens at the close-out (the tester never rated): 14 days from it, moved by an outage, the developer's own hold after the work ended and the tester's dispute", async () => {
    await db.outage.deleteMany({});
    const x = await closed(15); // close-out a day ago
    const s0 = (await devRateStates([x.sessionId])).get(x.sessionId)!;
    expect(s0.kind).toBe("open");
    const end0 = s0.endsAt!.getTime();
    near(s0.endsAt, s0.opensAt!.getTime() + 14 * DAY);
    try {
      // (b) An outage after it opened.
      await db.outage.create({ data: { startAt: new Date(Date.now() - 12 * HOUR), endAt: new Date(Date.now() - 10 * HOUR), ms: 2 * HOUR } });
      near((await devRateStates([x.sessionId])).get(x.sessionId)!.endsAt, end0 + 2 * HOUR);
      // (c) The developer's own hold, begun after the work ended (§358 no longer filters it here).
      await db.accountEvent.createMany({ data: [
        { userId: x.dev.user.id, kind: "hold", side: "developer", createdAt: new Date(Date.now() - 8 * HOUR) },
        { userId: x.dev.user.id, kind: "hold-lifted", side: "developer", createdAt: new Date(Date.now() - 5 * HOUR) },
      ] });
      near((await devRateStates([x.sessionId])).get(x.sessionId)!.endsAt, end0 + 5 * HOUR);
      // (c) The tester's dispute, decided: its length.
      const sub = await db.submission.findFirstOrThrow({ where: { contractId: x.sessionId } });
      await db.dispute.create({ data: { contractId: x.sessionId, testerId: x.tester.user.id, submissionId: sub.id, reason: "I sent more than this pays for.", status: "decided", createdAt: new Date(Date.now() - 4 * HOUR), decidedAt: new Date(Date.now() - 3 * HOUR) } });
      near((await devRateStates([x.sessionId])).get(x.sessionId)!.endsAt, end0 + 6 * HOUR);
    } finally {
      await db.outage.deleteMany({});
    }
  });

  it("opens when the tester rated: an outage that already moved the rating isn't counted twice; the close-out is the floor; the rating shows when the window ends", async () => {
    await db.outage.deleteMany({});
    const x = await closed(1); // close-out in 13 days
    expect((await sact(x.sessionId, "rate", x.tester.cookie, { stars: 4 })).status).toBe(200);
    const rating = await db.rating.findFirstOrThrow({ where: { contractId: x.sessionId, side: "tester" } });
    const s0 = (await devRateStates([x.sessionId])).get(x.sessionId)!;
    // The later of the close-out (13 days away) and 14 days after it opened (now): 14 days from the rating.
    near(s0.endsAt, rating.createdAt.getTime() + 14 * DAY);
    near(s0.revealAt, s0.endsAt!.getTime());
    try {
      // An outage within the rating's first 14 days moved the rating itself (applyOutage): the window doesn't add it again.
      await db.rating.update({ where: { id: rating.id }, data: { createdAt: new Date(rating.createdAt.getTime() + 2 * HOUR) } });
      await db.outage.create({ data: { startAt: new Date(rating.createdAt.getTime() + DAY), endAt: new Date(rating.createdAt.getTime() + DAY + 2 * HOUR), ms: 2 * HOUR } });
      const s1 = (await devRateStates([x.sessionId])).get(x.sessionId)!;
      near(s1.endsAt, rating.createdAt.getTime() + 2 * HOUR + 14 * DAY);
    } finally {
      await db.outage.deleteMany({});
    }
  });
});
