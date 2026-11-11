import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { renderTimes } from "@/lib/tz";
import { autoChargeCalls, startHold } from "@/lib/server/holds";
import { bookCall, joined, setup } from "./fixtures";

// (Owner, Nov 6, §319) A charge that waited for a developer suspension or the team's pause (no hold) told the developer "<piece> ($15.50) is waiting: it's charged
// when your account is clear". (Owner, Nov 9, §368) Nothing waits for a suspension or the team's pause any more: the automatic call charge is made at once (no
// "is waiting" line); a hold keeps its own "is added to what you owe" line.

const DAY = 86_400_000;

/** A listed call that took place 8 days ago, unpaid, its pay date passed. */
async function dueCall() {
  const s = await setup();
  const j = await joined(s.testId, "Nina Park");
  const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie);
  const start = new Date(Date.now() - 8 * DAY);
  await db.call.update({ where: { id: call.id }, data: { startsAt: start, measuredMinutes: 30, measuredAt: new Date(start.getTime() + 30 * 60_000), payBy: new Date(Date.now() - 60_000) } });
  return { s, j, call };
}
const devLines = async (userId: string) => (await db.notification.findMany({ where: { userId, groupKey: "payhold" }, orderBy: { createdAt: "asc" } })).map((n) => ({ ...n, text: renderTimes(n.text, "UTC") }));

// (Owner, Nov 11, §386 A; replaces §368) No money moves while frozen: the automatic call charge waits during a suspension, the team's pause and a hold, with no
// line at all (nothing is added to what's owed), and is made after the lift.
describe("§319 / §386 A the automatic call charge during a suspension, the team's pause and a hold", () => {
  it("each cause: nothing is made and no line is said; made after the lift", async () => {
    for (const freeze of ["suspension", "team", "hold"] as const) {
      const { s, call } = await dueCall();
      if (freeze === "suspension") await db.user.update({ where: { id: s.dev.user.id }, data: { devSuspendedAt: new Date() } });
      else if (freeze === "team") await db.test.update({ where: { id: s.testId }, data: { adminPausedAt: new Date() } });
      else await startHold(s.dev.user.id, "unpaid");
      await autoChargeCalls(new Date());
      expect(await db.payment.count({ where: { callId: call.id } }), freeze).toBe(0);
      const lines = (await devLines(s.dev.user.id)).map((x) => x.text);
      expect(lines.some((t) => t.includes(" is waiting: ") || t.includes(" is added to what you owe"))).toBe(false);
      if (freeze === "hold") continue;
      await db.user.update({ where: { id: s.dev.user.id }, data: { devSuspendedAt: null } });
      await db.test.update({ where: { id: s.testId }, data: { adminPausedAt: null } });
      await autoChargeCalls(new Date());
      expect(["charged", "not_set_up"]).toContain((await db.payment.findFirstOrThrow({ where: { callId: call.id } })).status);
    }
  });
});
