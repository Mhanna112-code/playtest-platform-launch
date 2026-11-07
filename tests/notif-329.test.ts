import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { ratingReminders } from "@/lib/server/ratings";
import { json, req } from "./helpers";
import { joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 7, §329) The developer's LAST rating reminder before their 14-day Rate window ends ignores email Off (`always`); the others follow the setting.

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);

/** A tester who sent work, was paid and rated `ratedDaysAgo` days ago: the developer's Rate opened then. */
async function devRateOpen(ratedDaysAgo: number) {
  const s = await setup();
  const j = await joined(s.testId, "Ana Silva");
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  expect((await sact(j.sessionId, "rate", j.tester.cookie, { stars: 4 })).status).toBe(200);
  await db.rating.updateMany({ where: { contractId: j.sessionId, side: "tester" }, data: { createdAt: ago(ratedDaysAgo) } });
  await db.review.updateMany({ where: { contractId: j.sessionId }, data: { createdAt: ago(ratedDaysAgo + 1) } });
  return s;
}
const reminders = (userId: string) => db.notification.findMany({ where: { userId, text: { startsWith: "Reminder: rate Ana Silva for “Harbor Run” (until " } } });

describe("§329 the developer's last rating reminder is always emailed", () => {
  it("a reminder with more than 3 days left follows the setting; the last one (under 3 days left) is always", async () => {
    const early = await devRateOpen(4);
    await ratingReminders();
    const [e] = await reminders(early.dev.user.id);
    expect(e).toBeTruthy();
    expect(e.mustEmail).toBe(false);
    const late = await devRateOpen(12);
    await ratingReminders();
    const [l] = await reminders(late.dev.user.id);
    expect(l).toBeTruthy();
    expect(l.mustEmail).toBe(true);
  });
});
