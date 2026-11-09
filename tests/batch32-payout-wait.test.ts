import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { payoutWaitLine } from "@/lib/payout";
import { payoutWaitReminders } from "@/lib/server/restrictions";
import { sendSummaries } from "@/lib/server/notify";
import { joined, setup } from "./fixtures";

// (Owner, Oct 29, batch 32 §1) Money waiting for a tester's payout setup: a bell line as soon as it waits, again every 3 days until the setup is done.
describe("batch 32 §1: money waiting for payout setup", () => {
  const waiting = async (testerCents: number) => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: testerCents + 200, feeCents: 200, testerCents, status: "charged", transferStatus: "waiting" } });
    return tester;
  };
  const lines = (userId: string) => db.notification.count({ where: { userId, reminderKey: "payoutwait" } });

  it("tells the tester at once, then every 3 days, and stops once the setup is done", async () => {
    const tester = await waiting(800);
    await db.user.update({ where: { id: tester.user.id }, data: { emailPref: "off" } });
    await payoutWaitReminders();
    expect(await db.notification.count({ where: { userId: tester.user.id, text: payoutWaitLine("$8.00"), payment: true } })).toBe(1);
    expect(await db.outboxEmail.count({ where: { to: tester.user.email } })).toBe(0);
    await sendSummaries(new Date(), [tester.user.id]);
    expect(await db.outboxEmail.count({ where: { to: tester.user.email, text: { contains: payoutWaitLine("$8.00") } } })).toBe(1);
    await payoutWaitReminders(new Date(Date.now() + 2 * 86_400_000));
    expect(await lines(tester.user.id)).toBe(1);
    await payoutWaitReminders(new Date(Date.now() + 3 * 86_400_000));
    expect(await lines(tester.user.id)).toBe(2);
    await db.user.update({ where: { id: tester.user.id }, data: { stripeAccountId: "acct_wait_" + tester.user.id.slice(-8), payoutsReady: true } });
    await payoutWaitReminders(new Date(Date.now() + 9 * 86_400_000));
    expect(await lines(tester.user.id)).toBe(2);
  });

  it("says nothing when nothing waits, or to a deleted account", async () => {
    const { testId } = await setup();
    const { tester } = await joined(testId);
    await payoutWaitReminders();
    expect(await lines(tester.user.id)).toBe(0);
    const gone = await waiting(500);
    await db.user.update({ where: { id: gone.user.id }, data: { deletedAt: new Date() } });
    await payoutWaitReminders();
    expect(await lines(gone.user.id)).toBe(0);
  });
});
