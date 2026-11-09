import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { renderTimes } from "@/lib/tz";
import { sendSummaries } from "@/lib/server/notify";
import { BANK_WAIT_KEY, awayAction, bankWaitingReminders } from "@/lib/server/confirm";
import { joined, setup } from "./fixtures";

// (Owner, Nov 6, §320) A charge made while the developer was away that waits for their bank gets the one "Your bank wants you to confirm …" line again once a day
// until it's confirmed, cancelled or runs out (3 days); never twice the same day; never for the developer's own press-started bank check. One reminder key
// ("bankwait"): a Weekly or Monthly email shows only the newest copy.

const DAY = 86_400_000;

async function world() {
  const s = await setup();
  const j = await joined(s.testId, "Ana Silva");
  const row = (status = "pending") => db.payment.create({ data: { kind: "review", contractId: j.sessionId, developerId: s.dev.user.id, testerId: j.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status } });
  const lines = () => db.notification.findMany({ where: { userId: s.dev.user.id, reminderKey: BANK_WAIT_KEY }, orderBy: { createdAt: "asc" } });
  /** The next day: the lines already sent move a day back (the daily job runs once a day). */
  const nextDay = () => db.notification.updateMany({ where: { userId: s.dev.user.id, reminderKey: { startsWith: BANK_WAIT_KEY } }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
  return { s, j, row, lines, nextDay };
}
const away = (id: string) => awayAction(id, { status: "requires_action", stripePaymentIntentId: "pi_" + randomUUID(), clientSecret: "" });

describe("§320 the daily reminder for charges waiting for the developer's bank", () => {
  it("day 0 the line; days 1 and 2 once each; one key; stops once confirmed", async () => {
    const w = await world();
    await db.user.update({ where: { id: w.s.dev.user.id }, data: { emailPref: "off" } });
    const p = await away((await w.row()).id);
    expect(await w.lines()).toHaveLength(1);
    expect(renderTimes((await w.lines())[0].text, "UTC")).toMatch(/^Your bank wants you to confirm a \$10\.00 payment on “Harbor Run” by [A-Z][a-z]{2} \d{1,2}$/);
    expect(await db.outboxEmail.count({ where: { to: w.s.dev.user.email } })).toBe(0);
    await sendSummaries(new Date(), [w.s.dev.user.id]);
    expect(await db.outboxEmail.count({ where: { to: w.s.dev.user.email, text: { contains: (await w.lines())[0].text } } })).toBe(1);
    await bankWaitingReminders(); // the same day: not again
    expect(await w.lines()).toHaveLength(1);
    for (const d of [1, 2]) {
      await w.nextDay();
      await bankWaitingReminders();
      await bankWaitingReminders();
      expect(await w.lines(), `day ${d}`).toHaveLength(1 + d);
    }
    expect((await w.lines())[1]).toMatchObject({ groupKey: "payhold", mustEmail: true, payment: true, link: "/app#bank-to-confirm" });
    // Confirmed: no more.
    await db.payment.update({ where: { id: p.id }, data: { status: "charged" } });
    await w.nextDay();
    await bankWaitingReminders();
    expect(await w.lines()).toHaveLength(3);
  });

  it("an old per-day row (bankwait:<date>) from today still counts as today's line", async () => {
    const w = await world();
    await away((await w.row()).id);
    await db.notification.updateMany({ where: { userId: w.s.dev.user.id, reminderKey: BANK_WAIT_KEY }, data: { reminderKey: `bankwait:${new Date().toISOString().slice(0, 10)}` } });
    await bankWaitingReminders();
    expect(await db.notification.count({ where: { userId: w.s.dev.user.id, reminderKey: { startsWith: BANK_WAIT_KEY } } })).toBe(1);
  });

  it("a Weekly email shows only the newest copy", async () => {
    const w = await world();
    await db.user.update({ where: { id: w.s.dev.user.id }, data: { emailPref: "weekly", lastSummaryAt: new Date(Date.now() - 8 * DAY) } });
    await away((await w.row()).id);
    await w.nextDay();
    await away((await w.row()).id); // a second charge the next day: a new copy with the new totals
    expect(await w.lines()).toHaveLength(2);
    await db.outboxEmail.deleteMany({ where: { to: w.s.dev.user.email } });
    await sendSummaries(new Date(), [w.s.dev.user.id]);
    const text = (await db.outboxEmail.findMany({ where: { to: w.s.dev.user.email } })).map((m) => m.text).join("\n");
    expect(text.match(/Your bank wants you to confirm/g)).toHaveLength(1);
    expect(text).toContain("Your bank wants you to confirm 2 payments ($20.00 in all)");
  });

  it("cancelled or ran out: none; the developer's own press-started check: none", async () => {
    const a = await world();
    const pa = await away((await a.row()).id);
    await db.payment.update({ where: { id: pa.id }, data: { status: "cancelled" } });
    await a.nextDay();
    await bankWaitingReminders();
    expect(await a.lines()).toHaveLength(1);
    const b = await world();
    const pb = await away((await b.row()).id);
    await db.payment.update({ where: { id: pb.id }, data: { actionBy: new Date(Date.now() - 60_000) } }); // its 3 days ran out
    await b.nextDay();
    await bankWaitingReminders();
    expect(await b.lines()).toHaveLength(1);
    const c = await world();
    await db.payment.create({ data: { kind: "review", contractId: c.j.sessionId, developerId: c.s.dev.user.id, testerId: c.j.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_action", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + 15 * 60_000) } });
    await bankWaitingReminders();
    expect(await c.lines()).toHaveLength(0);
  });
});
