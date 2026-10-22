import { db } from "@/lib/db";
import { paidByKind } from "@/lib/rules";

/** Paid-so-far per kind for each contract (written / recording / live calls with minutes). */
export async function paidLines(contractIds: string[]) {
  const pays = await db.payment.findMany({ where: { contractId: { in: contractIds }, status: { in: ["charged", "not_set_up"] } } });
  const subs = await db.submission.findMany({ where: { id: { in: pays.map((p) => p.submissionId).filter((x): x is string => !!x) } }, select: { id: true, kind: true } });
  const calls = await db.call.findMany({ where: { id: { in: pays.map((p) => p.callId).filter((x): x is string => !!x) } }, select: { id: true, minutes: true, actualMinutes: true } });
  const out = new Map<string, string>();
  for (const id of contractIds) {
    const counted = new Set<string>();
    const parts = pays
      .filter((p) => p.contractId === id)
      .map((p) => {
        if (p.callId) {
          const c = calls.find((x) => x.id === p.callId);
          const first = !counted.has(p.callId);
          counted.add(p.callId);
          return { kind: "call" as const, amountCents: p.amountCents, minutes: first ? (c?.actualMinutes ?? c?.minutes ?? 0) : 0 };
        }
        return { kind: (subs.find((s) => s.id === p.submissionId)?.kind === "recording" ? "recording" : "written") as "written" | "recording", amountCents: p.amountCents };
      });
    out.set(id, paidByKind(parts));
  }
  return out;
}
