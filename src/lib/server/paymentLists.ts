import { db } from "@/lib/db";
import { paidOutTotal, paidRows, type PaidRow } from "@/lib/server/paymentRows";
import { owedForBox } from "@/lib/server/holds";
import { isAdmin } from "@/lib/server/session";
import { stripeDashboardUrl } from "@/lib/server/adminLinks";
import { ALL_NOTE, OWED_KIND, OWED_PAID } from "@/lib/server/owedOnce";
import { reversedOf, reversedPart } from "@/lib/rules";

// (Owner, Nov 4, §190) The payments lists of Payments, read once here: the developer's "What you've paid" (and its total) and the tester's "Your earnings" (and its
// total). Payments draws them for the account holder; a person's admin box draws the SAME lists (src/components/PaymentLists.tsx) for the team, read-only.

type Pay = Awaited<ReturnType<typeof db.payment.findMany>>[number];
/**
 * (Owner, Nov 4, §191) ONE charge that paid several items (Pay what you owe's one payment, Confirm all's): one line for the charge (its amount, date, PaymentIntent;
 * "your bank reversed this" when the bank reversed that charge), opening on the items it paid (`items`, newest first, each with its own line from paidRows).
 */
export type PaidGroup = { id: string; label: "Pay what you owe" | "Confirm all"; amountCents: number; createdAt: Date; stripePaymentIntentId: string | null; reversed: boolean; reversedCents: number | null; items: Pay[] };
/** (§191) A line of "What you've paid": a payment paid on its own, or one charge's group. */
export type PaidEntry = { pay: Pay } | { group: PaidGroup };
/**
 * One of Payments' paid lists: its payments (newest first, at most 500), each one's line (paidRows), and the total shown beside its heading. `entries` (the
 * developer's list, §191): the lines as drawn, each covered item inside its one payment's group (without it: one line per payment, the tester's list).
 */
export type PaidList = { list: Pay[]; rows: Map<string, PaidRow>; totalCents: number; entries?: PaidEntry[] };

/** The developer's "What you've paid": every payment that went through (a refunded repayment stays listed, out of the total), its line, and the total. */
export async function developerPaid(devId: string): Promise<PaidList> {
  // (Batch 10) A repaid chargeback refunded after the platform won it stays in the list, marked refunded (not in the total).
  const list = await db.payment.findMany({ where: { developerId: devId, OR: [{ status: { in: ["charged", "not_set_up"] } }, { status: "refunded", kind: "chargeback" }] }, orderBy: { createdAt: "desc" }, take: 500 });
  // (Owner, Nov 3, §133) Pay what you owe's one payments the bank reversed (not listed themselves: the items they paid for are): what was reversed leaves the total.
  const reversedOnes = await db.payment.findMany({ where: { developerId: devId, kind: "owed", chargebackAt: { not: null } }, select: { amountCents: true, reversedCents: true, chargebackAt: true, chargeback: true, status: true } });
  // (Owner, Nov 4, §191) The lines are grouped by the charge that paid them; the total is the same sum of the same rows (never counted twice).
  return { list, rows: await paidRows(list, "developer"), totalCents: paidOutTotal(list, reversedOnes), entries: await paidEntries(list) };
}

/**
 * (Owner, Nov 4, §191) "What you've paid"'s lines: a payment paid on its own keeps its line (Pay, Pay more, one confirmed with the bank, a charge the tester made);
 * the items ONE charge paid together (Pay what you owe's one payment, Confirm all's: kind "owed", went through, `coveredById` on each item) sit only inside that
 * charge's group, placed at the charge's date. A reversed payment repaid by Pay what you owe keeps its own line ("your bank reversed this"); its repayment (+ fee) is
 * inside the group that paid it. Not grouped: a chargeback hold's reservation (note "reserve": its items are grouped only once disputed, so they keep their lines).
 */
async function paidEntries(list: Pay[]): Promise<PaidEntry[]> {
  const coverIds = [...new Set(list.map((p) => p.coveredById).filter((x): x is string => !!x))];
  const ones = coverIds.length ? await db.payment.findMany({ where: { id: { in: coverIds }, kind: OWED_KIND, status: OWED_PAID, note: { not: "reserve" } } }) : [];
  const groups = new Map(ones.map((o): [string, PaidGroup] => [o.id, {
    id: o.id, label: o.note === ALL_NOTE ? "Confirm all" : "Pay what you owe", amountCents: o.amountCents, createdAt: o.createdAt, stripePaymentIntentId: o.stripePaymentIntentId,
    reversed: !!o.chargebackAt, reversedCents: o.chargebackAt && reversedPart(o) ? reversedOf(o) : null, items: [],
  }]));
  // The reversed payment itself is never inside the group that repaid it (only its repayment is), should it still point to it.
  const repaidIn = (p: Pay) => list.some((r) => r.kind === "chargeback" && r.repaysId === p.id && r.coveredById === p.coveredById);
  const own: PaidEntry[] = [];
  for (const p of list) {
    const g = p.coveredById ? groups.get(p.coveredById) : undefined;
    if (g && !repaidIn(p)) g.items.push(p);
    else own.push({ pay: p });
  }
  const at = (e: PaidEntry) => ("pay" in e ? e.pay.createdAt : e.group.createdAt).getTime();
  // Newest first, as the list (a group at its charge's date); a group with nothing listed in it isn't drawn.
  return [...own, ...[...groups.values()].filter((g) => g.items.length).map((group) => ({ group }))].sort((a, b) => at(b) - at(a));
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
