import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { testV } from "@/lib/server/pulseV";
import { joined, setup } from "./fixtures";

it("refreshes both pages for an individual deadline change with no event and no change to the overall work deadline", async () => {
  const { dev, testId } = await setup();
  const j = await joined(testId, "Deadline Tester", "they");
  const c = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } });
  const before = { dev: await testV(dev.user.id, testId), tester: await testV(j.tester.user.id, testId, c.id) };
  const events = await db.testEvent.count({ where: { testId } });
  // Both dates remain below the listing's later Open until, so workEnd stays unchanged.
  await db.contract.update({ where: { id: c.id }, data: { dueAt: new Date(Date.now() + 3 * 86_400_000) } });
  const changed = { dev: await testV(dev.user.id, testId), tester: await testV(j.tester.user.id, testId, c.id) };
  expect(changed.dev).not.toBe(before.dev);
  expect(changed.tester).not.toBe(before.tester);
  expect(await db.testEvent.count({ where: { testId } })).toBe(events);
  expect(await testV(dev.user.id, testId)).toBe(changed.dev);
  expect(await testV(j.tester.user.id, testId, c.id)).toBe(changed.tester);
});
