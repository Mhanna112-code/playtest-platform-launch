import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { ratingReminders } from "@/lib/server/ratings";
import { json, req } from "./helpers";
import { joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 7, §331) The tester's rating reminders run every 3 days from when their Rate opened until they rate or the close-out (no 2-week limit); skipped while
// their Rate is disabled; the last one before the close-out names the date and ignores email Off (batch4 covers that one).

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);

async function paidTester() {
  const s = await setup();
  const j = await joined(s.testId, "Ana Silva");
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  return { s, j };
}
const reminders = (userId: string) => db.notification.findMany({ where: { userId, text: { startsWith: "Reminder: rate " } } });

describe("§331 the tester's rating reminders until the close-out", () => {
  it("20 days after their Rate opened (past the old 2 weeks) a reminder still comes; on a running test it isn't the last (no date, follows the setting)", async () => {
    const { j } = await paidTester();
    await db.contract.update({ where: { id: j.sessionId }, data: { ratePromptedAt: ago(20) } });
    await ratingReminders();
    const [r] = await reminders(j.tester.user.id);
    expect(r).toBeTruthy();
    expect(r.text).toBe("Reminder: rate Nora Lane on “Harbor Run”");
    expect(r.mustEmail).toBe(false);
    // The next one only 3 days after the last.
    await ratingReminders();
    expect(await reminders(j.tester.user.id)).toHaveLength(1);
  });

  it("skipped while their Rate is disabled (an open dispute)", async () => {
    const { j } = await paidTester();
    await db.contract.update({ where: { id: j.sessionId }, data: { ratePromptedAt: ago(20) } });
    expect((await sact(j.sessionId, "dispute", j.tester.cookie, { kind: "submission", id: (await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } })).id, reason: "I answered every question fully", seenAt: seen(), confirmed: true })).status, "dispute").toBe(200);
    await ratingReminders();
    expect(await reminders(j.tester.user.id)).toHaveLength(0);
  });
});
