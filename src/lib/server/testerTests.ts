import { db } from "@/lib/db";
import { testIsRunning, testerStateWord, type TesterTestRow } from "@/lib/testerTests";

/**
 * (Owner, Oct 28, batch 16 section 15, clarified) Every one of `developerId`'s tests that `testerId` joined (a contract, any status), most recent first.
 * Only that developer's own tests: nothing of other developers' tests is read, so nothing private leaks. Each row opens the developer's test page.
 */
export async function testerTestsFor(testerId: string, developerId: string, now = new Date()): Promise<TesterTestRow[]> {
  const contracts = await db.contract.findMany({
    where: { testerId, test: { developerId } },
    orderBy: { joinedAt: "desc" },
    include: { test: { include: { contracts: { select: { status: true, dueAt: true } } } } },
  });
  return contracts.map((c) => ({
    id: c.id,
    title: c.test.title,
    joinedAt: c.joinedAt.toISOString(),
    state: testerStateWord(c),
    open: testIsRunning(c.test, now),
    href: `/app/tests/${c.test.id}`,
  }));
}
