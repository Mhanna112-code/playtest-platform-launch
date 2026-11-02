import { db } from "@/lib/db";
import { MAX_ACTIVE_TESTS } from "@/lib/rules";
import { canInviteRow, inviteAvailabilityKey, inviteAvailabilityV, inviteDetailsKey } from "@/lib/inviteAvailability";
import { displayName } from "@/lib/format";

/** §109: only the shown people, and only crossing the capacity limit matters. */
export async function inviteAvailability(devId: string, testId: string, shownIds: string[]) {
  const ids = [...new Set(shownIds)].sort();
  const [people, active, blocks, here, invites] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, isTester: true, deletedAt: true, testerSuspendedAt: true } }),
    db.contract.groupBy({ by: ["testerId"], where: { testerId: { in: ids }, status: "working" }, _count: { _all: true } }),
    db.block.findMany({ where: { OR: [{ blockerId: devId, blockedId: { in: ids } }, { blockedId: devId, blockerId: { in: ids } }] }, select: { blockerId: true, blockedId: true } }),
    db.contract.findMany({ where: { testId, testerId: { in: ids } }, select: { testerId: true, status: true, endKind: true } }),
    db.invite.findMany({ where: { testId, testerId: { in: ids }, status: "sent" }, select: { testerId: true } }),
  ]);
  const rows = ids.map((id) => {
    const p = people.find((p) => p.id === id);
    const row = { id, exists: !!p?.isTester && !p.deletedAt, blocked: blocks.some((b) => b.blockerId === id || b.blockedId === id), suspended: !!p?.testerSuspendedAt, atLimit: (active.find((c) => c.testerId === id)?._count._all ?? 0) >= MAX_ACTIVE_TESTS, invited: invites.some((i) => i.testerId === id), inTest: here.some((c) => c.testerId === id && c.status === "working"), rated: here.some((c) => c.testerId === id && c.endKind === "rated") };
    return { ...row, availability: inviteAvailabilityKey(row) };
  });
  return { rows: rows.map((r) => ({ id: r.id, availability: r.availability })), v: inviteAvailabilityV(rows), unavailable: rows.filter((r) => !canInviteRow(r)).map((r) => r.id) };
}

export async function inviteDetailsRows(devId: string, ids: string[]) {
  const [people, together, mine] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, deletedAt: true, profile: { select: { updatedAt: true } } } }),
    db.contract.findMany({ where: { testerId: { in: ids }, test: { developerId: devId } }, select: { testerId: true, joinedAt: true, status: true, endKind: true, test: { select: { id: true, title: true } } } }),
    db.rating.groupBy({ by: ["rateeId"], where: { raterId: devId, rateeId: { in: ids }, side: "developer" }, _avg: { stars: true } }),
  ]);
  return ids.map((id) => {
    const p = people.find((p) => p.id === id);
    return { id, availability: inviteDetailsKey(p ? displayName(p) : "", p?.profile?.updatedAt.getTime() ?? 0, mine.find((r) => r.rateeId === id)?._avg.stars ?? null, together.filter((c) => c.testerId === id)) };
  });
}

export async function inviteDetails(devId: string, ids: string[]) {
  return inviteAvailabilityV(await inviteDetailsRows(devId, ids));
}
