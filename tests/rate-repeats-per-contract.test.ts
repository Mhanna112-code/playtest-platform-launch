import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { ratingReminders } from "@/lib/server/ratings";
import { json, req } from "./helpers";
import { joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Dec 2026) The developer's "Reminder: rate <tester> …" repeats every 3 days PER TESTER (counted from that contract's own last `rate-dev:<contract>`
// line, not the test's last rating line): two testers on one test each get their own reminder. The lines still stack in the day's "Ratings to give" entry.

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
/** Runs a reminder job at a fake time and dates the lines it made at that time (they're stamped with the real clock). */
async function at<R>(when: Date, job: (now: Date) => Promise<R>) {
  const real = new Date();
  await job(when);
  await db.notification.updateMany({ where: { createdAt: { gte: new Date(real.getTime() - 1000), lte: new Date(Date.now() + 60_000) } }, data: { createdAt: when } });
}

describe("(Owner, Dec 2026) the developer's Rate reminders, per tester", () => {
  it("two testers on one test: each gets a reminder, then each again 3 days later", async () => {
    const s = await setup();
    const ids: string[] = [];
    for (const name of ["Ana Silva", "Cara Diaz"]) {
      const j = await joined(s.testId, name);
      await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
      await settle();
      const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
      expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
      expect((await sact(j.sessionId, "rate", j.tester.cookie, { stars: 4 })).status).toBe(200);
      await db.rating.updateMany({ where: { contractId: j.sessionId, side: "tester" }, data: { createdAt: ago(5) } });
      await db.review.updateMany({ where: { contractId: j.sessionId }, data: { createdAt: ago(6) } });
      await db.notification.updateMany({ where: { userId: s.dev.user.id, reminderKey: `rate-open:${j.sessionId}` }, data: { createdAt: ago(5) } });
      ids.push(j.sessionId);
    }
    const lines = async () => (await db.notification.findMany({ where: { userId: s.dev.user.id, text: { startsWith: "Reminder: rate " } }, orderBy: { createdAt: "asc" } }));
    const now = new Date();
    await at(now, ratingReminders);
    const first = await lines();
    expect(first.map((l) => l.reminderKey).sort()).toEqual(ids.map((id) => `rate-dev:${id}`).sort());
    expect(first.map((l) => l.text).sort()).toEqual([expect.stringContaining("Reminder: rate Ana Silva for “Harbor Run”"), expect.stringContaining("Reminder: rate Cara Diaz for “Harbor Run”")]);
    expect(new Set(first.map((l) => l.groupKey))).toEqual(new Set(["ratings"])); // stacked in the day's "Ratings to give" entry
    await at(new Date(now.getTime() + 3_600_000), ratingReminders);
    await at(new Date(now.getTime() + 2 * DAY), ratingReminders);
    expect(await lines()).toHaveLength(2);
    await at(new Date(now.getTime() + 3 * DAY), ratingReminders);
    const again = (await lines()).slice(2);
    expect(again.map((l) => l.reminderKey).sort()).toEqual(ids.map((id) => `rate-dev:${id}`).sort());
  }, 240_000);
});
