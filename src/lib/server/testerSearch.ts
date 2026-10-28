import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { testStatusWord, type DevSearchRow } from "@/lib/devSearch";

type ContractLike = { id: string; title: string; status: string; endKind: string; joinedAt: Date; test: { developer: { name?: string | null; email: string; deletedAt?: Date | null } } };

/**
 * (Owner, Oct 28, batch 16 section 13) Every test the tester has been in, any status, as rows for "Search by developer" (deleted developers read
 * "Deleted account"; a blocked developer's past tests are included: they stay on the dashboard). `linked`: false while the tester side is suspended
 * (their session pages are closed).
 */
export function devSearchRows(contracts: ContractLike[], linked = true): DevSearchRow[] {
  return contracts
    .map((c) => ({ id: c.id, title: c.title, developer: displayName(c.test.developer), status: testStatusWord(c), joinedAt: c.joinedAt.toISOString(), href: linked ? `/app/sessions/${c.id}` : null }))
    .sort((a, b) => b.joinedAt.localeCompare(a.joinedAt));
}

/** The same rows straight from the database: all of the tester's contracts, no cap. */
export async function testerSearchRows(testerId: string, linked = true) {
  const contracts = await db.contract.findMany({ where: { testerId }, orderBy: { joinedAt: "desc" }, include: { test: { include: { developer: true } } } });
  return devSearchRows(contracts, linked);
}
