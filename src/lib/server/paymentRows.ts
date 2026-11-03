import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { CHARGED_BY_TESTER, CHARGED_BY_TESTER_14, disputeDecisionName, pieceName, repaidReversedLine, reversedOf, reversedPart } from "@/lib/rules";

type Row = { id: string; kind: string; amountCents: number; contractId: string | null; submissionId: string | null; callId: string | null; repaysId: string | null; settledAt: Date | null; owedUntil: Date | null; chargebackAt: Date | null; reversedCents?: number | null };
/**
 * `full` (§131): `what` with the names uncut, the row's hover on Payments. `testId` null: a row with no test to link (§133: the repayment of part of Pay what you owe's
 * one payment). `reversedCents` (§133): what the bank reversed of this payment when it was only part of it.
 */
export type PaidRow = { what: string; full: string; how: string; testId: string | null; reversed: boolean; reversedCents?: number | null };

type Counted = { amountCents: number; reversedCents?: number | null; chargebackAt: Date | null; chargeback: string; status: string };
/**
 * "What you've paid"'s total: every payment listed that went through (a refunded repayment left out). (Owner, Nov 2) A payment the bank reversed counts once, as its
 * repayment; (Owner, Nov 3, §133) when the bank reversed only PART of it, the rest of it still counts: each reversal (not won) takes off what it reversed. `ones`:
 * Pay what you owe's one payments the bank reversed (they aren't listed: the items they paid for are).
 */
export const paidOutTotal = (listed: Counted[], ones: Counted[] = []) =>
  listed.filter((p) => p.status !== "refunded").reduce((a, p) => a + p.amountCents, 0)
  - [...listed, ...ones].filter((p) => p.chargebackAt && p.chargeback !== "won" && p.status !== "refunded").reduce((a, p) => a + reversedOf(p), 0);

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
    if (!c) {
      // (Owner, Nov 3, §133) The repayment of part of Pay what you owe's one payment (it paid for several items; the bank gives only an amount, so no item is named):
      // "Repaid $96 reversed from your $444.67 payment ($96 + $15 chargeback fee)". A whole one keeps the page's plain label, as before.
      const line = side === "developer" && p.kind === "chargeback" && o !== p ? repaidReversedLine(o, " payment", null) : null;
      if (line) out.set(p.id, { what: line, full: line, how: "", testId: null, reversed: false });
      continue;
    }
    const tester = displayName(c.tester), dev = displayName(c.test.developer);
    const part = o.callId ? "live call" : subs.get(o.submissionId ?? "") === "recording" ? "recording" : "written answers";
    const r = reviewOf(o);
    const byTester = r && (r.reason === CHARGED_BY_TESTER || r.reason === CHARGED_BY_TESTER_14);
    const how = p.kind === "chargeback" ? "" : p.settledAt || p.owedUntil ? "paid through Pay what you owe" : byTester ? (side === "developer" ? `charged by ${tester} after 7 days without a review` : "charged by you after 7 days without a review") : r?.auto ? "charged automatically after 7 days" : "";
    const on = `on “${c.title}”`;
    // (Owner, Nov 2, §131) The developer's rows name the piece by pieceName (the tester's and the test's names cut at 10 characters); the tester's rows are unchanged.
    const devWhat = (full: boolean) => {
      const piece = pieceName({ tester, part, test: c.title, full });
      return p.kind === "extra" ? `Pay more for ${piece}`
        : p.kind === "dispute" ? disputeDecisionName(piece).replace(/^the/, "The")
        // (Owner, Nov 2) Which payment it repaid, and the fee: "Repaid the reversed $39.00 Pay more for … ($39.00 + $15.00 chargeback fee)". (§133) Part of it:
        // "Repaid $96 reversed from your $444.67 payment for … ($96 + $15 chargeback fee)".
        : p.kind === "chargeback" ? repaidReversedLine(o, o.kind === "extra" ? " Pay more" : o.kind === "dispute" ? " dispute decision" : " payment", piece)!
        : piece;
    };
    const what = side === "developer" ? devWhat(false) : `from ${dev} for your ${part} ${on}${p.kind === "extra" ? " (extra pay)" : p.kind === "dispute" ? " (dispute decision)" : ""}`;
    out.set(p.id, { what, full: side === "developer" ? devWhat(true) : what, how, testId: c.testId, reversed: side === "developer" && !!p.chargebackAt, reversedCents: side === "developer" && p.chargebackAt && reversedPart(p) ? reversedOf(p) : null });
  }
  return out;
}
