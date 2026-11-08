import { db } from "@/lib/db";

export type RejoinLabel = "Previously left test" | "Previously ended early";

/** A working contract's most recent recorded departure before its latest join. No contract state is changed. */
export async function rejoinLabels(testId: string, contracts: { id: string; status: string }[]) {
  const ids = contracts.filter((c) => c.status === "working").map((c) => c.id);
  const result = new Map<string, RejoinLabel>();
  if (!ids.length) return result;
  const events = await db.testEvent.findMany({ where: { testId, contractId: { in: ids }, kind: { in: ["joined", "auto_joined", "left", "ended"] } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { contractId: true, kind: true } });
  const joined = new Set<string>();
  for (const e of events) {
    const id = e.contractId!;
    if (result.has(id)) continue;
    if (e.kind === "joined" || e.kind === "auto_joined") joined.add(id);
    else if (joined.has(id)) result.set(id, e.kind === "ended" ? "Previously ended early" : "Previously left test");
  }
  return result;
}
