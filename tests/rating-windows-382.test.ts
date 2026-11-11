import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { json, req } from "./helpers";
import { joined, sact, seen, setup } from "./fixtures";
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

