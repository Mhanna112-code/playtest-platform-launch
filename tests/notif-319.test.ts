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

describe("§319 / §368 the automatic call charge during a suspension, the team's pause and a hold", () => {
  it("a suspension: the automatic call charge is made at once (§368), with no waiting line", async () => {
    const { s, call } = await dueCall();
    await db.user.update({ where: { id: s.dev.user.id }, data: { devSuspendedAt: new Date() } });
    await autoChargeCalls(new Date());
    expect(["charged", "not_set_up"]).toContain((await db.payment.findFirstOrThrow({ where: { callId: call.id } })).status);
    expect(await db.payment.count({ where: { callId: call.id } })).toBe(1);
    expect((await devLines(s.dev.user.id)).filter((x) => x.text.includes(" is waiting: "))).toHaveLength(0);
  });

  it("the team's pause of its test: made at once too; a hold keeps its own line (added to what you owe)", async () => {
    const a = await dueCall();
    await db.test.update({ where: { id: a.s.testId }, data: { adminPausedAt: new Date() } });
    await autoChargeCalls(new Date());
    expect(["charged", "not_set_up"]).toContain((await db.payment.findFirstOrThrow({ where: { callId: a.call.id } })).status);
    expect((await devLines(a.s.dev.user.id)).filter((x) => x.text.includes(" is waiting: "))).toHaveLength(0);
    const b = await dueCall();
    await startHold(b.s.dev.user.id, "unpaid");
    await autoChargeCalls(new Date());
    const hl = (await devLines(b.s.dev.user.id)).map((x) => x.text);
    expect(hl.some((t) => t.includes(" is added to what you owe"))).toBe(true);
    expect(hl.some((t) => t.includes(" is waiting: "))).toBe(false);
    expect((await db.payment.findFirstOrThrow({ where: { callId: b.call.id } })).status).toBe("deferred");
  });
});
