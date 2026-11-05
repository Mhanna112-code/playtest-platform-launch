import { db } from "@/lib/db";
import { paidOutTotal, paidRows, type PaidRow } from "@/lib/server/paymentRows";
import { owedForBox } from "@/lib/server/holds";
import { isAdmin } from "@/lib/server/session";
import { stripeDashboardUrl } from "@/lib/server/adminLinks";

// (Owner, Nov 4, §190) The payments lists of Payments, read once here: the developer's "What you've paid" (and its total) and the tester's "Your earnings" (and its
// total). Payments draws them for the account holder; a person's admin box draws the SAME lists (src/components/PaymentLists.tsx) for the team, read-only.

type Pay = Awaited<ReturnType<typeof db.payment.findMany>>[number];
/** One of Payments' paid lists: its payments (newest first, at most 500), each one's line (paidRows), and the total shown beside its heading. */
export type PaidList = { list: Pay[]; rows: Map<string, PaidRow>; totalCents: number };

/** The developer's "What you've paid": every payment that went through (a refunded repayment stays listed, out of the total), its line, and the total. */
export async function developerPaid(devId: string): Promise<PaidList> {
  // (Batch 10) A repaid chargeback refunded after the platform won it stays in the list, marked refunded (not in the total).
  const list = await db.payment.findMany({ where: { developerId: devId, OR: [{ status: { in: ["charged", "not_set_up"] } }, { status: "refunded", kind: "chargeback" }] }, orderBy: { createdAt: "desc" }, take: 500 });
  // (Owner, Nov 3, §133) Pay what you owe's one payments the bank reversed (not listed themselves: the items they paid for are): what was reversed leaves the total.
  const reversedOnes = await db.payment.findMany({ where: { developerId: devId, kind: "owed", chargebackAt: { not: null } }, select: { amountCents: true, reversedCents: true, chargebackAt: true, chargeback: true, status: true } });
  return { list, rows: await paidRows(list, "developer"), totalCents: paidOutTotal(list, reversedOnes) };
}

/**
 * The tester's "Your earnings": what reached them for their work (never a developer's subscription, a repayment of a reversed payment, or Pay what you owe's own
 * record: those are never the tester's), each line, and the total of their shares.
 */
export async function testerEarned(testerId: string): Promise<PaidList> {
  const list = await db.payment.findMany({ where: { testerId, kind: { notIn: ["subscription", "chargeback", "owed"] }, status: { in: ["charged", "not_set_up"] } }, orderBy: { createdAt: "desc" }, take: 500 });
  return { list, rows: await paidRows(list, "tester"), totalCents: list.reduce((a, p) => a + p.testerCents, 0) };
}

/** Pay what you owe's lines as the developer's box lists them (owedForBox), and what its button pays (the lines it retries). */
export type OwedList = { lines: Awaited<ReturnType<typeof owedForBox>>; totalCents: number };

/**
 * (Owner, Nov 4, §190) A person's payments as THEY see them on Payments, for the team: the developer's "What you've paid" (and "What you owe" while Payments shows
 * it: during a hold, with lines in it), the tester's "Your earnings". Admins only: anyone else gets null (nothing is read). `stripeUrl`: each payment's Stripe
 * Dashboard page (test or live mode from the key, as every admin Stripe link: stripeDashboardUrl), only for a payment with a PaymentIntent.
 */
export async function accountPaymentsForAdmin(viewer: Parameters<typeof isAdmin>[0], userId: string) {
  if (!isAdmin(viewer)) return null;
  const u = await db.user.findUnique({ where: { id: userId }, select: { isDeveloper: true, isTester: true, holdStartedAt: true } });
  if (!u) return null;
  const developer = u.isDeveloper ? await developerPaid(userId) : null;
  const tester = u.isTester ? await testerEarned(userId) : null;
  // Payments draws Pay what you owe only during a hold, and only with something in it.
  const lines = u.isDeveloper && u.holdStartedAt ? await owedForBox(userId) : [];
  const owed: OwedList | null = lines.length ? { lines, totalCents: lines.filter((o) => o.retry).reduce((s, o) => s + o.amountCents, 0) } : null;
  // An owed line is a payment's own row (a failed charge, a reversed payment owed again): its PaymentIntent, when it has one.
  const owedPis = owed ? new Map((await db.payment.findMany({ where: { id: { in: owed.lines.map((o) => o.id) } }, select: { id: true, stripePaymentIntentId: true } })).map((p) => [p.id, p.stripePaymentIntentId])) : new Map<string, string | null>();
  return { developer, tester, owed, owedStripe: (id: string) => stripeUrl(owedPis.get(id)) };
}

/** A payment's Stripe Dashboard page, only from its PaymentIntent id ("" without one). */
export const stripeUrl = (pi: string | null | undefined) => (pi && pi.startsWith("pi_") ? stripeDashboardUrl(pi) : "");
