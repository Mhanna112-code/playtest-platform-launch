import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { renderTimes } from "@/lib/tz";
import { awayAction, bankWaitingReminders } from "@/lib/server/confirm";
import { joined, setup } from "./fixtures";

// (Owner, Nov 6, §320) A charge made while the developer was away that waits for their bank gets the one "Your bank wants you to confirm …" line again once a day
// until it's confirmed, cancelled or runs out (3 days); never twice the same day; never for the developer's own press-started bank check.

const DAY = 86_400_000;

async function world() {
  const s = await setup();
  const j = await joined(s.testId, "Ana Silva");
  const row = (status = "pending") => db.payment.create({ data: { kind: "review", contractId: j.sessionId, developerId: s.dev.user.id, testerId: j.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status } });
  const lines = () => db.notification.findMany({ where: { userId: s.dev.user.id, reminderKey: { startsWith: "bankwait:" } }, orderBy: { createdAt: "asc" } });
  return { s, j, row, lines };
}
const away = (id: string) => awayAction(id, { status: "requires_action", stripePaymentIntentId: "pi_" + randomUUID(), clientSecret: "" });

describe("§320 the daily reminder for charges waiting for the developer's bank", () => {
  it("day 0 the line; days 1 and 2 once each; the same words; stops once confirmed", async () => {
    const w = await world();
    const p = await away((await w.row()).id);
    expect(await w.lines()).toHaveLength(1);
    expect(renderTimes((await w.lines())[0].text, "UTC")).toMatch(/^Your bank wants you to confirm a \$10\.00 payment on “Harbor Run” by [A-Z][a-z]{2} \d{1,2}$/);
    await bankWaitingReminders(new Date()); // the same day: not again
    expect(await w.lines()).toHaveLength(1);
    for (const d of [1, 2]) {
      await bankWaitingReminders(new Date(Date.now() + d * DAY));
      await bankWaitingReminders(new Date(Date.now() + d * DAY + 3_600_000));
      expect(await w.lines(), `day ${d}`).toHaveLength(1 + d);
    }
    const l = (await w.lines())[1];
    expect(l).toMatchObject({ groupKey: "payhold", mustEmail: true, payment: true, link: "/app#bank-to-confirm" });
    // Confirmed: no more.
    await db.payment.update({ where: { id: p.id }, data: { status: "charged" } });
    await bankWaitingReminders(new Date(Date.now() + 2.5 * DAY + DAY));
    expect(await w.lines()).toHaveLength(3);
  });

  it("cancelled or ran out: none; the developer's own press-started check: none", async () => {
    const a = await world();
    const pa = await away((await a.row()).id);
    await db.payment.update({ where: { id: pa.id }, data: { status: "cancelled" } });
    await bankWaitingReminders(new Date(Date.now() + DAY));
    expect(await a.lines()).toHaveLength(1);
    const b = await world();
    await away((await b.row()).id);
    await bankWaitingReminders(new Date(Date.now() + 3.5 * DAY)); // its 3 days ran out
    expect(await b.lines()).toHaveLength(1);
    const c = await world();
    await db.payment.create({ data: { kind: "review", contractId: c.j.sessionId, developerId: c.s.dev.user.id, testerId: c.j.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_action", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + 15 * 60_000) } });
    await bankWaitingReminders(new Date());
    await bankWaitingReminders(new Date(Date.now() + 5 * 60_000));
    expect(await c.lines()).toHaveLength(0);
  });
});
