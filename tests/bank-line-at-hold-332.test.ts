import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { bankToConfirm, tellBankWaiting, BANK_WAIT_KEY } from "@/lib/server/confirm";
import { startHold } from "@/lib/server/holds";
import { BANK_TO_CONFIRM_HREF, PAY_OWED_HREF } from "@/lib/rules";
import { makeUser } from "./helpers";

// (Owner, Nov 9, §332) A hold that turns the charges made while away into ones waiting for the lift rewrites today's "Your bank wants you to confirm …" line to what
// still needs the bank, or removes it; while the hold is on, the line and the dashboard's box open Pay what you owe.
const D = 86_400_000;
async function world() {
  const dev = await makeUser({ dev: true, name: "Pat Lane" });
  const tester = await makeUser({ tester: true, name: "Gus Hale" });
  return { dev, tester };
}
const waiting = (devId: string, testerId: string, kind: string, cents: number) =>
  db.payment.create({ data: { kind, developerId: devId, testerId, amountCents: cents, feeCents: 0, testerCents: 0, status: "needs_confirmation", actionPi: `pi_${Math.random().toString(36).slice(2)}`, actionBy: new Date(Date.now() + 3 * D) } });
const bankLine = (userId: string) => db.notification.findFirst({ where: { userId, reminderKey: BANK_WAIT_KEY }, orderBy: { createdAt: "desc" } });

describe("§332 the bank line when a hold starts", () => {
  it("only charges made while away were waiting: the line goes", async () => {
    const w = await world();
    await waiting(w.dev.user.id, w.tester.user.id, "review", 1000);
    await tellBankWaiting(w.dev.user.id);
    expect((await bankLine(w.dev.user.id))?.link).toBe(BANK_TO_CONFIRM_HREF);
    await startHold(w.dev.user.id, "unpaid");
    expect(await bankLine(w.dev.user.id)).toBeNull();
  });

  it("a renewal still needs the bank: the line names only it and opens Pay what you owe; the dashboard box rows do too", async () => {
    const w = await world();
    await waiting(w.dev.user.id, w.tester.user.id, "review", 1000);
    await waiting(w.dev.user.id, w.dev.user.id, "subscription", 700);
    await tellBankWaiting(w.dev.user.id);
    const before = (await bankLine(w.dev.user.id))!;
    expect(before.text).toMatch(/^Your bank wants you to confirm 2 payments/);
    await startHold(w.dev.user.id, "unpaid");
    const after = (await bankLine(w.dev.user.id))!;
    expect(after.id).toBe(before.id);
    expect(after.text).toMatch(/^Your bank wants you to confirm a \$7\.00 payment by /);
    expect(after.link).toBe(PAY_OWED_HREF);
    const rows = await bankToConfirm(w.dev.user.id);
    expect(rows.length).toBe(1);
    expect(rows.every((r) => r.href === PAY_OWED_HREF)).toBe(true);
    // A later line while the hold lasts opens Pay what you owe too.
    await tellBankWaiting(w.dev.user.id);
    expect((await bankLine(w.dev.user.id))!.link).toBe(PAY_OWED_HREF);
  });
});
