import { db } from "@/lib/db";
import { nameMatches } from "@/lib/nameSearch";
import { ACCOUNT } from "./accountChanges";

/** Previous profile names are private to people who shared a developer/tester contract. */
export async function previousNamesFor(viewerId: string) {
  const contracts = await db.contract.findMany({ where: { OR: [{ testerId: viewerId }, { test: { developerId: viewerId } }] }, select: { testerId: true, test: { select: { developerId: true } } } });
  const ids = [...new Set(contracts.map((c) => c.testerId === viewerId ? c.test.developerId : c.testerId))].filter((id) => id !== viewerId);
  if (!ids.length) return new Map<string, string[]>();
  const blocks = await db.block.findMany({ where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] }, select: { blockerId: true, blockedId: true } });
  const blocked = new Set(blocks.map((b) => b.blockerId === viewerId ? b.blockedId : b.blockerId));
  const users = await db.user.findMany({ where: { id: { in: ids.filter((id) => !blocked.has(id)) }, deletedAt: null }, select: { id: true, name: true } });
  const current = new Map(users.map((u) => [u.id, u.name.trim().toLowerCase()]));
  const result = new Map<string, string[]>();
  const logs = await db.actionLog.findMany({ where: { userId: { in: users.map((u) => u.id) }, testId: ACCOUNT }, orderBy: { createdAt: "desc" }, select: { userId: true, text: true } });
  for (const log of logs) {
    try {
      const change = JSON.parse(log.text);
      if (change.field !== "name") continue;
      for (const value of [change.before, change.after]) {
        if (typeof value !== "string" || !value.trim() || value.trim().toLowerCase() === current.get(log.userId)) continue;
        const names = result.get(log.userId) ?? [];
        if (!names.some((n) => n.toLowerCase() === value.trim().toLowerCase())) names.push(value.trim());
        result.set(log.userId, names);
      }
    } catch { /* Older non-JSON account records are not name history. */ }
  }
  return result;
}

export function previousNameMatch(current: string, names: string[] | undefined, query: string) {
  return query.trim() && !nameMatches(current, query) ? names?.find((name) => nameMatches(name, query)) : undefined;
}
