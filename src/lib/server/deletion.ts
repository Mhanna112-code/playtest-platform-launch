import { db } from "@/lib/db";
import { displayName, money } from "@/lib/format";
import { NO_LISTING_WORK_CAP_CENTS, PAYABLE_TESTER, callReference, pieceMaxCents, testerShare } from "@/lib/rules";

// (Owner, Oct 28) Deleting an account: what the confirm pop-up tells a tester (with their real numbers), and what blocks a developer.

export type DeleteBlocker = { key: string; text: string; href: string };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * (Owner, Oct 28; DEFAULT) A developer can't delete their account while any of these is left: sent work waiting for Pay or Reject (including parts where Charge is open),
 * an open dispute, a payment hold or a chargeback hold. Once none is left nothing is under review, so Charge never opens later. Work from a tester who deleted their own
 * account can't be paid any more, so it doesn't block. This ONE function decides it, so the rule can be swapped (the owner's alternative: keep open Charge rows and never
 * open Charge for work still under review).
 */
export async function devDeleteBlockers(userId: string, now = new Date()): Promise<DeleteBlocker[]> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { isDeveloper: true, holdStartedAt: true, holdReason: true } });
  if (!u?.isDeveloper) return [];
  const live = { tester: PAYABLE_TESTER }; // (batch 11) a deleted tester's sent work is still payable when their payout account was connected
  const [subs, calls, disputes] = await Promise.all([
    db.submission.findMany({ where: { review: null, contract: { ...live, test: { developerId: userId } } }, select: { contract: { select: { testId: true, test: { select: { title: true } } } } } }),
    db.call.findMany({ where: { review: null, status: "booked", startsAt: { lte: now }, contract: { ...live, test: { developerId: userId } } }, select: { contract: { select: { testId: true, test: { select: { title: true } } } } } }),
    db.contract.findMany({ where: { ...live, test: { developerId: userId } }, select: { id: true, testId: true, tester: true, test: { select: { title: true } } } }).then(async (cs) => {
      const byId = new Map(cs.map((c) => [c.id, c]));
      const open = await db.dispute.findMany({ where: { status: "open", contractId: { in: cs.map((c) => c.id) } }, select: { id: true, contractId: true } });
      return open.map((d) => ({ id: d.id, contract: byId.get(d.contractId)! }));
    }),
  ]);
  const out: DeleteBlocker[] = [];
  const byTest = new Map<string, { title: string; n: number }>();
  for (const x of [...subs, ...calls]) byTest.set(x.contract.testId, { title: x.contract.test.title, n: (byTest.get(x.contract.testId)?.n ?? 0) + 1 });
  for (const [testId, t] of byTest) out.push({ key: `review-${testId}`, text: `${t.title} · ${plural(t.n, "part")} to pay or reject`, href: `/app/tests/${testId}#needs-you` });
  for (const d of disputes) out.push({ key: `dispute-${d.id}`, text: `${d.contract.test.title} · ${displayName(d.contract.tester)}'s open dispute`, href: `/app/tests/${d.contract.testId}#item-dispute-${d.id}` });
  if (u.holdStartedAt) out.push(u.holdReason === "chargeback"
    ? { key: "hold", text: "your chargeback hold: follow the steps in Payments", href: "/app/payments#chargeback-steps" }
    : { key: "hold", text: "your payment hold: pay what you owe in Payments", href: "/app/payments#owed" });
  return out;
}

/** "Pay or reject the work waiting for you first: Harbor Run · 2 parts to pay or reject; your payment hold: pay what you owe in Payments." */
export const devDeleteRefusal = (blockers: DeleteBlocker[]) => `Pay or reject the work waiting for you first: ${blockers.map((b) => b.text).join("; ")}.`;

export type TesterDeleteFacts = {
  /** Pay already charged but not sent yet: waiting for their payout setup. */
  waitingCents: number;
  /** Delayed payments: the developer's payment didn't go through yet. */
  delayedN: number; delayedCents: number;
  /** Unpaid work: under review (including parts where Charge is open) and open disputes, and the most it could still pay them. */
  unpaidN: number; unpaidCents: number;
  payoutsReady: boolean;
};

/** (Owner, Oct 28) The real numbers for a tester's Delete account pop-up. Amounts are the tester's share. */
export async function testerDeleteFacts(userId: string, now = new Date()): Promise<TesterDeleteFacts> {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { payoutsReady: true } });
  const [waiting, delayed, subs, calls, disputes] = await Promise.all([
    db.payment.aggregate({ where: { testerId: userId, kind: { not: "subscription" }, status: "charged", transferStatus: "waiting" }, _sum: { testerCents: true } }),
    db.payment.findMany({ where: { testerId: userId, OR: [{ status: "failed", owedUntil: { not: null }, settledAt: null }, { status: { in: ["deferred", "owed"] } }] }, select: { amountCents: true } }),
    db.submission.findMany({ where: { review: null, contract: { testerId: userId } }, select: { id: true, agreedCents: true } }),
    db.call.findMany({ where: { review: null, status: "booked", startsAt: { lte: now }, contract: { testerId: userId } }, select: { id: true, rateCents: true, minutes: true, actualMinutes: true } }),
    db.dispute.findMany({ where: { testerId: userId, status: "open" }, select: { submissionId: true, callId: true, submission: { select: { agreedCents: true } }, call: { select: { rateCents: true, minutes: true, actualMinutes: true } } } }),
  ]);
  const paidFor = async (where: { submissionId?: string | null; callId?: string | null }) =>
    (await db.payment.aggregate({ where: { ...(where.submissionId ? { submissionId: where.submissionId } : { callId: where.callId! }), status: { in: ["charged", "not_set_up", "deferred", "owed"] } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
  let unpaid = 0;
  for (const s of subs) unpaid += s.agreedCents ?? NO_LISTING_WORK_CAP_CENTS;
  for (const c of calls) unpaid += callReference(c.rateCents, c.actualMinutes ?? c.minutes).cents ?? pieceMaxCents("call", c.actualMinutes ?? c.minutes);
  for (const d of disputes) {
    const top = d.submission ? d.submission.agreedCents ?? NO_LISTING_WORK_CAP_CENTS : d.call ? callReference(d.call.rateCents, d.call.actualMinutes ?? d.call.minutes).cents ?? pieceMaxCents("call", d.call.actualMinutes ?? d.call.minutes) : 0;
    unpaid += Math.max(0, top - (await paidFor(d)));
  }
  return {
    waitingCents: waiting._sum.testerCents ?? 0,
    delayedN: delayed.length, delayedCents: delayed.reduce((a, p) => a + testerShare(p.amountCents), 0),
    unpaidN: subs.length + calls.length + disputes.length, unpaidCents: testerShare(unpaid),
    payoutsReady: u.payoutsReady,
  };
}

/** (Owner, Oct 29, batch 11) What happens to work already sent. */
export const SENT_WORK_AFTER_DELETE = "Work you already sent can still be paid by the developer, to your Stripe account if it's set up. After deleting, you can't charge for it or dispute it.";

/** The pop-up's lines, in order (the "Set up payouts" link sits after the waiting line). */
export function testerDeleteLines(f: TesterDeleteFacts) {
  const lines: { key: string; text: string }[] = [
    { key: "sent", text: "Pay already sent to your Stripe account stays there. Your Stripe account is separate from Playtest: you can still sign in to Stripe and withdraw it." },
  ];
  if (f.waitingCents > 0) lines.push({ key: "waiting", text: `${money(f.waitingCents)} is waiting for your payout setup. Finish it before deleting, or it can't reach you.` });
  if (f.delayedN > 0) lines.push({ key: "delayed", text: `${plural(f.delayedN, "delayed payment")} (${money(f.delayedCents)}) still ${f.delayedN === 1 ? "reaches" : "reach"} your Stripe account when the developer pays, ${f.payoutsReady ? "because your payout setup is finished" : "if you finish your payout setup before deleting"}.` });
  if (f.unpaidN > 0) lines.push({ key: "unpaid", text: `${f.unpaidN} ${f.unpaidN === 1 ? "part you sent isn't" : "parts you sent aren't"} paid yet (up to ${money(f.unpaidCents)}). ${SENT_WORK_AFTER_DELETE}` });
  lines.push({ key: "leave", text: "You leave every test you're in. Calls ahead are cancelled, and your invites and applications are cancelled. Open disputes are withdrawn." });
  lines.push({ key: "chats", text: "Your chats close. The ratings you gave and got stay." });
  lines.push({ key: "final", text: "You can't sign in again, and this can't be undone." });
  return lines;
}
