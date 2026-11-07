import { db } from "@/lib/db";
import { limitedTermsDiff } from "@/lib/rules";

type ContractDates = { id: string; joinedAt: Date; endedAt: Date | null; status: string };
export type ContractHistoryEntry = { id: string; at: Date; label: string; value?: string };

/** Participation dates and assigned keys sit beside the existing question history. */
export async function contractHistory(testId: string, contracts: ContractDates[], includeChoices = false) {
  const ids = contracts.map((c) => c.id);
  const [events, notes, keys, offers] = await Promise.all([
    db.testEvent.findMany({ where: { testId, contractId: { in: ids }, kind: { in: ["joined", "auto_joined", "left", "ended"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    db.contractNote.findMany({ where: { contractId: { in: ids }, kind: "key_assigned" }, orderBy: { createdAt: "asc" } }),
    db.accessKey.findMany({ where: { contractId: { in: ids }, status: { in: ["inuse", "held", "broken"] } } }),
    includeChoices ? db.termsOffer.findMany({ where: { testId, contractId: { in: ids } }, orderBy: { createdAt: "asc" } }) : [],
  ]);
  return new Map(contracts.map((c) => {
    const mine = events.filter((e) => e.contractId === c.id);
    const rows: ContractHistoryEntry[] = mine.map((e) => ({ id: e.id, at: e.createdAt, label: e.kind === "left" ? "Left test" : e.kind === "ended" ? "Work ended early" : e.text.endsWith(" joined again") ? "Rejoined" : "Joined" }));
    if (!rows.some((e) => e.label === "Joined")) rows.push({ id: `joined-${c.id}`, at: c.joinedAt, label: "Joined" });
    if (c.endedAt && !mine.some((e) => (e.kind === "left" || e.kind === "ended") && Math.abs(e.createdAt.getTime() - c.endedAt!.getTime()) < 1000)) rows.push({ id: `ended-${c.id}`, at: c.endedAt, label: c.status === "left" ? "Left test" : "Work ended" });
    const assigned = notes.filter((n) => n.contractId === c.id);
    rows.push(...assigned.map((n) => ({ id: n.id, at: n.createdAt, label: "Access key assigned", value: n.text })));
    for (const offer of offers.filter((o) => o.contractId === c.id)) {
      const diff = limitedTermsDiff(offer.diff);
      if (!diff) continue;
      rows.push({ id: offer.id, at: offer.createdAt, label: "New parts and prices offered", value: diff });
      if (offer.decidedAt && (offer.status === "kept" || offer.status === "switched")) rows.push({ id: `choice-${offer.id}`, at: offer.decidedAt, label: offer.status === "kept" ? "Kept existing parts and prices" : "Switched to new parts and prices", value: diff });
    }
    // Older assignments remain visible before the first release records them permanently.
    rows.push(...keys.filter((k) => k.contractId === c.id && !assigned.some((n) => n.text === k.value)).map((k) => ({ id: k.id, at: k.assignedAt ?? k.createdAt, label: "Access key assigned", value: k.value })));
    return [c.id, rows.sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id))];
  }));
}
