import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { remindCallsSoon } from "@/lib/server/calls";
import { bookCall, joined, setup } from "./fixtures";

it("reminds at exactly 24 hours, never before, after cancellation or after a legacy reminder", async () => {
  const s = await setup();
  const j = await joined(s.testId);
  const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie);
  const now = new Date();
  await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(+now + 86_400_001) } });
  const count = () => db.notification.count({ where: { reminderKey: `call24:${call.id}` } });
  await remindCallsSoon(now);
  expect(await count()).toBe(0);
  await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(+now + 86_400_000) } });
  await remindCallsSoon(now);
  expect(await count()).toBe(2);
  await db.notification.updateMany({ where: { reminderKey: `call24:${call.id}` }, data: { reminderKey: `call15:${call.id}` } });
  await remindCallsSoon(now);
  expect(await count()).toBe(0);
  await db.notification.deleteMany({ where: { reminderKey: `call15:${call.id}` } });
  await db.call.update({ where: { id: call.id }, data: { status: "cancelled" } });
  await remindCallsSoon(now);
  expect(await count()).toBe(0);
});
