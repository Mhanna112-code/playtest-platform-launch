import { db } from "@/lib/db";
import { HttpError } from "@/lib/server/http";

/** (Owner, Oct 31, batch 35 §73) The test whose Alerts are changed: it must be this developer's own (anyone else gets "not found"). */
export async function alertsTest(userId: string, testId: unknown): Promise<string> {
  if (typeof testId !== "string" || !testId) throw new HttpError(400, "no_test", "Which test's Alerts? Open the test page and try again.");
  const t = await db.test.findUnique({ where: { id: testId }, select: { developerId: true } });
  if (!t || t.developerId !== userId) throw new HttpError(404, "not_found", "That test doesn't exist.");
  return testId;
}

/**
 * (Owner, Nov 4, §169) Every save of a test's Alerts, in one locked write: the test row is locked first, so two saves at the same moment (two tabs, a stop box's
 * chip and the menu, the menu's All) each apply to the other's result and neither is lost. `on`: the types ticked (not stopped for); `off`: the types unticked;
 * `set`: the whole list (the older form). A stored type not named is kept as it is. `alertsV` goes up by one with the list; the answer is the saved list and it.
 */
export async function saveTestAlerts(testId: string, change: { on?: string[]; off?: string[]; set?: string[] }): Promise<{ ignored: string[]; v: number }> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${testId} FOR UPDATE`;
    const now = (await tx.test.findUniqueOrThrow({ where: { id: testId }, select: { ignoredAlerts: true } })).ignoredAlerts;
    const off = new Set(change.off ?? []);
    const list = change.set ? [...new Set(change.set)] : [...new Set([...now, ...(change.on ?? [])])].filter((k) => !off.has(k));
    const t = await tx.test.update({ where: { id: testId }, data: { ignoredAlerts: list, alertsV: { increment: 1 } }, select: { ignoredAlerts: true, alertsV: true } });
    return { ignored: t.ignoredAlerts, v: t.alertsV };
  });
}
