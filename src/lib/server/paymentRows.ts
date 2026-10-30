import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { CHARGED_BY_TESTER, CHARGED_BY_TESTER_14 } from "@/lib/rules";

type Row = { id: string; kind: string; contractId: string | null; submissionId: string | null; callId: string | null; repaysId: string | null; settledAt: Date | null; owedUntil: Date | null; chargebackAt: Date | null };
export type PaidRow = { what: string; how: string; testId: string | null; reversed: boolean };

/**
 * (Owner, Oct 30, batch 32 §18) What each line of Payments' paid lists was for: the tester (or developer), the part and the test, and how it was paid ("charged by Ana
 * Silva after 7 days without a review", "charged automatically after 7 days", "paid through Pay what you owe"); a payment the developer's bank reversed says so.
 * A chargeback's repayment names the payment it repaid. Rows it can't place keep a plain label ("Subscription", "Sent work").
 */
export async function paidRows(ps: Row[], side: "developer" | "tester"): Promise<Map<string, PaidRow>> {
  const repaid = new Map((await db.payment.findMany({ where: { id: { in: ps.map((p) => p.repaysId).filter((x): x is string => !!x) } } })).map((p) => [p.id, p]));
  const src = (p: Row) => (p.kind === "chargeback" && p.repaysId ? repaid.get(p.repaysId) ?? p : p);
  const all = ps.map(src);
  const contracts = new Map((await db.contract.findMany({ where: { id: { in: all.map((p) => p.contractId).filter((x): x is string => !!x) } }, include: { tester: true, test: { include: { developer: true } } } })).map((c) => [c.id, c]));
  const subs = new Map((await db.submission.findMany({ where: { id: { in: all.map((p) => p.submissionId).filter((x): x is string => !!x) } }, select: { id: true, kind: true } })).map((s) => [s.id, s.kind]));
  const reviews = await db.review.findMany({ where: { OR: [{ submissionId: { in: [...subs.keys()] } }, { callId: { in: all.map((p) => p.callId).filter((x): x is string => !!x) } }] }, select: { submissionId: true, callId: true, reason: true, auto: true } });
  const reviewOf = (p: Row) => reviews.find((r) => (p.submissionId && r.submissionId === p.submissionId) || (p.callId && r.callId === p.callId));
  const out = new Map<string, PaidRow>();
  for (const p of ps) {
    const o = src(p);
    const c = o.contractId ? contracts.get(o.contractId) : undefined;
    if (!c) continue;
    const tester = displayName(c.tester), dev = displayName(c.test.developer);
    const part = o.callId ? "live call" : subs.get(o.submissionId ?? "") === "recording" ? "recording" : "written answers";
    const r = reviewOf(o);
    const byTester = r && (r.reason === CHARGED_BY_TESTER || r.reason === CHARGED_BY_TESTER_14);
    const how = p.kind === "chargeback" ? "" : p.settledAt || p.owedUntil ? "paid through Pay what you owe" : byTester ? (side === "developer" ? `charged by ${tester} after 7 days without a review` : "charged by you after 7 days without a review") : r?.auto ? "charged automatically after 7 days" : "";
    const on = `on “${c.title}”`;
    const what = side === "developer"
      ? p.kind === "extra" ? `Pay more to ${tester} for their ${part} ${on}`
        : p.kind === "dispute" ? `Dispute decision: ${tester}'s ${part} ${on}`
        : p.kind === "chargeback" ? `Paid again after your bank reversed a payment: ${tester}'s ${part} ${on}`
        : `${tester}'s ${part} ${on}`
      : `from ${dev} for your ${part} ${on}${p.kind === "extra" ? " (extra pay)" : p.kind === "dispute" ? " (dispute decision)" : ""}`;
    out.set(p.id, { what, how, testId: c.testId, reversed: side === "developer" && !!p.chargebackAt });
  }
  return out;
}
