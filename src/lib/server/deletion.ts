import { callMinutesOf } from "@/lib/callMeasure";
import { db } from "@/lib/db";
import { displayName, money } from "@/lib/format";
import { NO_LISTING_WORK_CAP_CENTS, PAYABLE_TESTER, callReference, pieceMaxCents, testerShare } from "@/lib/rules";

// (Owner, Oct 28) Deleting an account: what the confirm pop-up tells a tester (with their real numbers), and what blocks a developer.

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** (Owner, Oct 29, batch 12 section 1) What happens to testers' work when a developer deletes their account (said last in the warning). */
export const DEV_DELETE_LINE = "Testers can still charge for parts already open to charging. Work you haven't reviewed can't be charged after you delete.";

/**
 * (Owner, Oct 29, batch 12 section 1: the owner's version, replacing batch 5's blockers) A developer can always delete their account. Their warning lists, with counts: work
 * waiting for their review, parts testers can still charge, and open disputes; then DEV_DELETE_LINE. Work still under review never opens Charge after they delete; parts
 * already open to charging stay open (the charge goes to the saved card); open disputes are still decided; what they owe stays owed.
 */
export async function devDeleteLines(userId: string, now = new Date()) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { isDeveloper: true } });
  if (!u?.isDeveloper) return [];
  const mine = { contract: { test: { developerId: userId }, tester: PAYABLE_TESTER } };
  const [review, calls, charge, disputes] = await Promise.all([
    db.submission.count({ where: { review: null, OR: [{ choiceOfferedAt: null }, { late: true }], ...mine } }), // (batch 30 §3) late work: no Charge
    db.call.count({ where: { review: null, status: "booked", startsAt: { lte: now }, ...mine } }),
    db.submission.count({ where: { review: null, choiceOfferedAt: { not: null }, late: false, ...mine } }),
    db.contract.findMany({ where: { test: { developerId: userId } }, select: { id: true } }).then((cs) => db.dispute.count({ where: { status: "open", contractId: { in: cs.map((c) => c.id) } } })),
  ]);
  const lines: { key: string; text: string }[] = [];
  if (review + calls > 0) lines.push({ key: "review", text: `${plural(review + calls, "part")} waiting for your review` });
  if (charge > 0) lines.push({ key: "charge", text: `${plural(charge, "part")} testers can still charge` });
  if (disputes > 0) lines.push({ key: "disputes", text: plural(disputes, "open dispute") });
  lines.push({ key: "after", text: DEV_DELETE_LINE });
  return lines;
}

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
    db.call.findMany({ where: { review: null, status: "booked", startsAt: { lte: now }, contract: { testerId: userId } }, select: { id: true, rateCents: true, minutes: true, actualMinutes: true, measuredMinutes: true, measuredAt: true } }),
    db.dispute.findMany({ where: { testerId: userId, status: "open" }, select: { submissionId: true, callId: true, submission: { select: { agreedCents: true } }, call: { select: { rateCents: true, minutes: true, actualMinutes: true, measuredMinutes: true, measuredAt: true } } } }),
  ]);
  const paidFor = async (where: { submissionId?: string | null; callId?: string | null }) =>
    (await db.payment.aggregate({ where: { ...(where.submissionId ? { submissionId: where.submissionId } : { callId: where.callId! }), status: { in: ["charged", "not_set_up", "deferred", "owed"] } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
  let unpaid = 0;
  for (const s of subs) unpaid += s.agreedCents ?? NO_LISTING_WORK_CAP_CENTS;
  for (const c of calls) unpaid += callReference(c.rateCents, callMinutesOf(c) ?? c.minutes).cents ?? pieceMaxCents("call", callMinutesOf(c) ?? c.minutes);
  for (const d of disputes) {
    const top = d.submission ? d.submission.agreedCents ?? NO_LISTING_WORK_CAP_CENTS : d.call ? callReference(d.call.rateCents, callMinutesOf(d.call) ?? d.call.minutes).cents ?? pieceMaxCents("call", callMinutesOf(d.call) ?? d.call.minutes) : 0;
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
