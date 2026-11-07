import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { renderTimes } from "@/lib/tz";
import { startHold } from "@/lib/server/holds";
import { HOLD_REMINDER_KEY, holdReminders } from "@/lib/server/pauseClosure";
import { setup } from "./fixtures";

// (Owner, Nov 6, §316) A developer on a HOLD gets ONE reminder a day, from the next daily job after the hold began, until it lifts or every paused test has closed:
// "Reminder: your tests are paused until you pay what you owe: “Harbor Run” closes on <date>" / the chargeback hold's "… after a chargeback: … unless you finish
// the steps". Never for a suspension or the team's pause alone.

const DAY = 86_400_000;
const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const reminders = (userId: string) => db.notification.findMany({ where: { userId, reminderKey: HOLD_REMINDER_KEY }, orderBy: { createdAt: "asc" } });
/** The next day: the reminders already sent move a day back (the daily job runs once a day). */
const nextDay = (userId: string) => db.notification.updateMany({ where: { userId, reminderKey: HOLD_REMINDER_KEY }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });

describe("§316 the daily hold reminder", () => {
  it("day 0 none; then one a day, in Payments and holds, emailed whatever the setting; lifted: none", async () => {
    const s = await setup();
    await startHold(s.dev.user.id, "unpaid");
    expect(await holdReminders()).toBeGreaterThanOrEqual(0);
    expect(await reminders(s.dev.user.id)).toHaveLength(0); // the day the hold started: its own line said it
    const started = new Date(Date.now() - DAY);
    await db.user.update({ where: { id: s.dev.user.id }, data: { holdStartedAt: started } });
    await db.test.update({ where: { id: s.testId }, data: { pausedSince: started } });
    for (let d = 1; d <= 6; d++) {
      await holdReminders();
      await holdReminders(); // the same day: not again
      expect(await reminders(s.dev.user.id), `day ${d}`).toHaveLength(d);
      await nextDay(s.dev.user.id);
    }
    const r = (await reminders(s.dev.user.id))[0];
    expect(renderTimes(r.text, "UTC")).toBe(`Reminder: your tests are paused until you pay what you owe: “Harbor Run” closes on ${fmt(new Date(started.getTime() + 7 * DAY))}`);
    expect(r).toMatchObject({ groupKey: "payhold", mustEmail: true, payment: true, link: "/app/payments#owed", side: "developer" });
    // Lifted: no more.
    await db.user.update({ where: { id: s.dev.user.id }, data: { holdStartedAt: null, holdReason: "" } });
    await holdReminders();
    expect(await reminders(s.dev.user.id)).toHaveLength(6);
  });

  it("a chargeback hold: its own words and link; every paused test closed: none", async () => {
    const s = await setup();
    await startHold(s.dev.user.id, "chargeback");
    const started = new Date(Date.now() - DAY);
    await db.user.update({ where: { id: s.dev.user.id }, data: { holdStartedAt: started } });
    await db.test.update({ where: { id: s.testId }, data: { pausedSince: started } });
    await holdReminders();
    const [r] = await reminders(s.dev.user.id);
    expect(renderTimes(r.text, "UTC")).toBe(`Reminder: your tests are paused after a chargeback: “Harbor Run” closes on ${fmt(new Date(started.getTime() + 7 * DAY))} unless you finish the steps`);
    expect(r.link).toBe("/app/payments#chargeback-steps");
    await nextDay(s.dev.user.id);
    await db.test.update({ where: { id: s.testId }, data: { status: "stopped" } });
    await holdReminders();
    expect(await reminders(s.dev.user.id)).toHaveLength(1);
  });

  it("a suspension or the team's pause alone: none", async () => {
    const a = await setup();
    await db.user.update({ where: { id: a.dev.user.id }, data: { devSuspendedAt: new Date(Date.now() - 2 * DAY) } });
    const b = await setup();
    await db.test.update({ where: { id: b.testId }, data: { adminPausedAt: new Date(Date.now() - 2 * DAY) } });
    await holdReminders();
    expect(await reminders(a.dev.user.id)).toHaveLength(0);
    expect(await reminders(b.dev.user.id)).toHaveLength(0);
  });
});
