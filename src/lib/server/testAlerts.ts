import { db } from "@/lib/db";
import { HttpError } from "@/lib/server/http";

/** (Owner, Oct 31, batch 35 §73) The test whose Alerts are changed: it must be this developer's own (anyone else gets "not found"). */
export async function alertsTest(userId: string, testId: unknown): Promise<string> {
  if (typeof testId !== "string" || !testId) throw new HttpError(400, "no_test", "Which test's Alerts? Open the test page and try again.");
  const t = await db.test.findUnique({ where: { id: testId }, select: { developerId: true } });
  if (!t || t.developerId !== userId) throw new HttpError(404, "not_found", "That test doesn't exist.");
  return testId;
}
