import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { reviewReminders } from "@/lib/server/holds";
import { notify, sendSummaries } from "@/lib/server/notify";
import { joined, sact, setup } from "./fixtures";
import { makeUser } from "./helpers";
import { pauseTest, unpauseTest, suspendAccount, reinstateAccount } from "@/lib/server/restrictions";
import { liftHoldIfClear, startHold } from "@/lib/server/holds";
import { fmtIn } from "@/lib/tz";

const DAY = 86_400_000;

async function waiting() {
  const w = await setup();
  const j = await joined(w.testId, "Reminder Tester", "they");
  expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["First answer", "Second answer"] })).status).toBe(200);
  const now = new Date();
  const at = new Date(+now + 23 * 3_600_000);
  await db.contract.update({ where: { id: j.sessionId }, data: { dueAt: at } });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  await db.submission.update({ where: { id: sub.id }, data: { updatedAt: new Date(+now - 6 * DAY), payBy: at, stintDueAt: at, devMarks: [] } });
  await db.user.update({ where: { id: w.dev.user.id }, data: { emailPref: "off", timeZone: "America/Chicago" } });
  return { ...w, ...j, sub, now, at };
}

describe("reminder audit: selected local rehearsals", () => {
  it("creates only the selected review reminder, emails with Off, and does not repeat it", async () => {
    const a = await waiting();
    const b = await waiting();
    await reviewReminders(a.now, undefined, [a.sessionId]);
    const query = (id: string) => db.notification.findMany({ where: { userId: id, groupKey: "unreviewed" } });
    expect(await query(b.dev.user.id)).toHaveLength(0);
    const lines = await query(a.dev.user.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ mustEmail: true, summarizedAt: null });
    expect(lines[0].text).toContain(`review Reminder Tester's written answers by tomorrow (${fmtIn("America/Chicago", a.at, "date")})`);
    await reviewReminders(a.now, undefined, [a.sessionId]);
    expect(await query(a.dev.user.id)).toHaveLength(1);
    await sendSummaries(a.now, [a.dev.user.id]);
    const mails = await db.outboxEmail.findMany({ where: { to: a.dev.user.email } });
    expect(mails).toHaveLength(1);
    expect(mails[0].text).toContain(lines[0].text);
    await sendSummaries(a.now, [a.dev.user.id]);
    expect(await db.outboxEmail.count({ where: { to: a.dev.user.email } })).toBe(1);
  });

  it("an empty selection cannot generate reminders for other sessions", async () => {
    const w = await waiting();
    await reviewReminders(w.now, undefined, []);
    expect(await db.notification.count({ where: { userId: w.dev.user.id, groupKey: "unreviewed" } })).toBe(0);
  });

  it("must-send account changes wait for a summary and reach Off accounts once", async () => {
    const { user } = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { emailPref: "off" } });
    for (const text of ["The team paused your developer account", "Your tester account is active again"]) {
      await notify(user.email, text, [text], "/app", { always: true });
    }
    expect(await db.outboxEmail.count({ where: { to: user.email } })).toBe(0);
    await sendSummaries(new Date(), [user.id]);
    const mails = await db.outboxEmail.findMany({ where: { to: user.email } });
    expect(mails).toHaveLength(1);
    expect(mails[0].text).toContain("The team paused your developer account");
    expect(mails[0].text).toContain("Your tester account is active again");
  });

  it("real team pause/lift, payment hold/lift and tester suspension/reinstatement all reach Off accounts", async () => {
    const w = await setup();
    const j = await joined(w.testId, "Reminder Tester", "they");
    const a = await makeUser();
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    for (const id of [w.dev.user.id, j.tester.user.id]) await db.user.update({ where: { id }, data: { emailPref: "off" } });
    await pauseTest(a.user.id, w.testId, "Reminder rehearsal");
    await unpauseTest(w.testId, a.user.id);
    await startHold(w.dev.user.id, "unpaid");
    expect(await liftHoldIfClear(w.dev.user.id)).toBe(true);
    await suspendAccount(a.user.id, j.tester.user.id, "Reminder rehearsal", "tester");
    await reinstateAccount(j.tester.user.id, "tester", a.user.id);
    for (const user of [w.dev.user, j.tester.user]) {
      expect(await db.outboxEmail.count({ where: { to: user.email } })).toBe(0);
      const required = await db.notification.findMany({ where: { userId: user.id, mustEmail: true, summarizedAt: null } });
      expect(required.length).toBeGreaterThanOrEqual(4);
      await sendSummaries(new Date(), [user.id]);
      const mails = await db.outboxEmail.findMany({ where: { to: user.email } });
      expect(mails).toHaveLength(1);
      for (const n of required) expect(mails[0].text).toContain(n.text);
    }
  });
});
