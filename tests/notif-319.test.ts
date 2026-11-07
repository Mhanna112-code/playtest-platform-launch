import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { renderTimes } from "@/lib/tz";
import { autoChargeCalls, startHold, waitingChargeLine } from "@/lib/server/holds";
import { bookCall, joined, setup } from "./fixtures";

// (Owner, Nov 6, §319) A charge that waits for a developer suspension or the team's pause (no hold) tells the developer, in "Payments and holds", like the hold's
// "is added to what you owe" line: "<piece> ($15.50) is waiting: it's charged when your account is clear" / "… when the team lifts the pause on “<test>”".

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

describe("§319 a charge waiting for a suspension or the team's pause says so", () => {
  it("the words", () => {
    expect(waitingChargeLine("Nina Park's live call on “PAY TEST” (Sun, Nov 1, 6:05 PM)", 1550, null)).toBe("Nina Park's live call on “PAY TEST” (Sun, Nov 1, 6:05 PM) ($15.50) is waiting: it's charged when your account is clear");
    expect(waitingChargeLine("Nina Park's live call on “PAY TEST” (Sun, Nov 1, 6:05 PM)", 1550, "PAY TEST")).toBe("Nina Park's live call on “PAY TEST” (Sun, Nov 1, 6:05 PM) ($15.50) is waiting: it's charged when the team lifts the pause on “PAY TEST”");
  });

  it("a suspension: the automatic call charge waits, and the developer is told which and until when", async () => {
    const { s, call } = await dueCall();
    await db.user.update({ where: { id: s.dev.user.id }, data: { devSuspendedAt: new Date() } });
    await autoChargeCalls(new Date());
    expect(await db.payment.findFirstOrThrow({ where: { callId: call.id } })).toMatchObject({ status: "deferred" });
    const l = (await devLines(s.dev.user.id)).filter((x) => x.text.includes(" is waiting: "));
    expect(l).toHaveLength(1);
    expect(l[0].text).toMatch(/^Nina Park's live call on “Harbor Run” \(.+\) \(\$\d+\.\d{2}\) is waiting: it's charged when your account is clear$/);
    expect(l[0]).toMatchObject({ payment: true, groupKey: "payhold", side: "developer", link: `/app/tests/${s.testId}#call-${call.id}` });
  });

  it("the team's pause of its test: \"… when the team lifts the pause on “Harbor Run”\"; a hold keeps its own line (no second one)", async () => {
    const a = await dueCall();
    await db.test.update({ where: { id: a.s.testId }, data: { adminPausedAt: new Date() } });
    await autoChargeCalls(new Date());
    expect((await devLines(a.s.dev.user.id)).filter((x) => x.text.includes(" is waiting: ")).map((x) => x.text)).toEqual([
      expect.stringMatching(/ is waiting: it's charged when the team lifts the pause on “Harbor Run”$/),
    ]);
    const b = await dueCall();
    await startHold(b.s.dev.user.id, "unpaid");
    await autoChargeCalls(new Date());
    const hl = (await devLines(b.s.dev.user.id)).map((x) => x.text);
    expect(hl.some((t) => t.includes(" is added to what you owe"))).toBe(true);
    expect(hl.some((t) => t.includes(" is waiting: "))).toBe(false);
  });
});
