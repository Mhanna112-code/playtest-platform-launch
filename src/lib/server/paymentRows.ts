import { db } from "@/lib/db";
import { displayName, money } from "@/lib/format";
import { CHARGEBACK_FEE_CENTS, CHARGED_BY_TESTER, CHARGED_BY_TESTER_14, disputeDecisionName, pieceName, repaidReversedLine, reversedOf, reversedPart } from "@/lib/rules";

type Row = { id: string; kind: string; amountCents: number; contractId: string | null; submissionId: string | null; callId: string | null; repaysId: string | null; settledAt: Date | null; owedUntil: Date | null; chargebackAt: Date | null; reversedCents?: number | null };
/**
 * What a payment's line is built from: a Payment row, or one about to be made (a team decision is charged before its row exists). `paidCents`: an owed reversed
 * payment's own amount (holds.owed puts what the bank reversed + the fee in `amountCents`).
 */
export type PayingRow = { kind: string; amountCents: number; contractId: string | null; submissionId?: string | null; callId?: string | null; repaysId?: string | null; settledAt?: Date | null; owedUntil?: Date | null; chargeback?: string | null; reversedCents?: number | null; paidCents?: number };
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

/** The plain label of a paid row with no test to name ("What you've paid" shows it, and so does its Stripe description). */
export const plainLabel = (kind: string) =>
  kind === "call" ? "Live call" : kind === "dispute" ? "Dispute decision" : kind === "extra" ? "Extra pay" : kind === "chargeback" ? "A reversed payment, paid again" : kind === "subscription" ? "Subscription" : "Sent work";
/** A repayment line's word for the payment it repaid. */
const repaidWord = (kind: string) => (kind === "extra" ? " Pay more" : kind === "dispute" ? " dispute decision" : " payment");

/** What the lines of these payments name, loaded once: the payment a repayment repaid, each test and tester, each part, and how it was paid (its review). */
async function lineContext(ps: PayingRow[]) {
  const repaid = new Map((await db.payment.findMany({ where: { id: { in: ps.map((p) => p.repaysId).filter((x): x is string => !!x) } } })).map((p) => [p.id, p]));
  const src = (p: PayingRow): PayingRow => (p.kind === "chargeback" && p.repaysId ? repaid.get(p.repaysId) ?? p : p);
  const all = ps.map(src);
  const contracts = new Map((await db.contract.findMany({ where: { id: { in: all.map((p) => p.contractId).filter((x): x is string => !!x) } }, include: { tester: true, test: { include: { developer: true } } } })).map((c) => [c.id, c]));
  const subs = new Map((await db.submission.findMany({ where: { id: { in: all.map((p) => p.submissionId).filter((x): x is string => !!x) } }, select: { id: true, kind: true } })).map((s) => [s.id, s.kind]));
  const reviews = await db.review.findMany({ where: { OR: [{ submissionId: { in: [...subs.keys()] } }, { callId: { in: all.map((p) => p.callId).filter((x): x is string => !!x) } }] }, select: { submissionId: true, callId: true, reason: true, auto: true } });
  const reviewOf = (p: PayingRow) => reviews.find((r) => (p.submissionId && r.submissionId === p.submissionId) || (p.callId && r.callId === p.callId));
  const partOf = (p: PayingRow) => (p.callId ? "live call" : subs.get(p.submissionId ?? "") === "recording" ? "recording" : "written answers");
  return { src, contracts, reviewOf, partOf };
}
type Ctx = Awaited<ReturnType<typeof lineContext>>;

/**
 * (Owner, Nov 3) THE developer's line of one payment in Payments' "What you've paid": `what`, then `how` after a comma. Its Stripe description is built from the same
 * line (`stripeDescription`), so the two can't drift. `full`: the names uncut (Stripe, and the page's hover). Null for a row with no test to name (the page shows its
 * plain label).
 */
function devLine(ctx: Ctx, p: PayingRow, full: boolean) {
  const o = ctx.src(p);
  const c = o.contractId ? ctx.contracts.get(o.contractId) : undefined;
  if (!c) {
    // (Owner, Nov 3, §133) The repayment of part of Pay what you owe's one payment (it paid for several items; the bank gives only an amount, so no item is named):
    // "Repaid $96 reversed from your $444.67 payment ($96 + $15 chargeback fee)". A whole one keeps the page's plain label, as before.
    const line = p.kind === "chargeback" && o !== p ? repaidReversedLine(o, " payment", null) : null;
    return line ? { what: line, how: "", testId: null } : null;
  }
  const tester = displayName(c.tester);
  const r = ctx.reviewOf(o);
  // (Owner, Nov 3) The piece's own payment says how it was charged (by the tester, automatically); a Pay more or a team decision on it is its own payment and doesn't.
  const own = p.kind === "review" || p.kind === "call";
  const byTester = own && r && (r.reason === CHARGED_BY_TESTER || r.reason === CHARGED_BY_TESTER_14);
  const how = p.kind === "chargeback" ? "" : p.settledAt || p.owedUntil ? "paid through Pay what you owe" : byTester ? `charged by ${tester} after 7 days without a review` : own && r?.auto ? "charged automatically after 7 days" : "";
  // (Owner, Nov 2, §131) The developer's rows name the piece by pieceName (the tester's and the test's names cut at 10 characters on the page).
  const piece = pieceName({ tester, part: ctx.partOf(o), test: c.title, full });
  const what = p.kind === "extra" ? `Pay more for ${piece}`
    : p.kind === "dispute" ? disputeDecisionName(piece).replace(/^the/, "The")
    // (Owner, Nov 2) Which payment it repaid, and the fee: "Repaid the reversed $39.00 Pay more for … ($39.00 + $15.00 chargeback fee)". (§133) Part of it:
    // "Repaid $96 reversed from your $444.67 payment for … ($96 + $15 chargeback fee)".
    : p.kind === "chargeback" ? repaidReversedLine(o, repaidWord(o.kind), piece)!
    : piece;
  return { what, how, testId: c.testId };
}

/**
 * (Owner, Oct 30, batch 32 §18) What each line of Payments' paid lists was for: the tester (or developer), the part and the test, and how it was paid ("charged by Ana
 * Silva after 7 days without a review", "charged automatically after 7 days", "paid through Pay what you owe"); a payment the developer's bank reversed says so.
 * A chargeback's repayment names the payment it repaid. Rows it can't place keep a plain label ("Subscription", "Sent work").
 */
export async function paidRows(ps: Row[], side: "developer" | "tester"): Promise<Map<string, PaidRow>> {
  const ctx = await lineContext(ps);
  const out = new Map<string, PaidRow>();
  for (const p of ps) {
    if (side === "developer") {
      const cut = devLine(ctx, p, false), whole = devLine(ctx, p, true);
      if (cut && whole) out.set(p.id, { what: cut.what, full: whole.what, how: cut.how, testId: cut.testId, reversed: !!p.chargebackAt, reversedCents: p.chargebackAt && reversedPart(p) ? reversedOf(p) : null });
      continue;
    }
    // The tester's rows (unchanged by §131): "from Nora Lane for your written answers on “Harbor Run”".
    const o = ctx.src(p);
    const c = o.contractId ? ctx.contracts.get(o.contractId) : undefined;
    if (!c) continue;
    const r = ctx.reviewOf(o);
    const own = p.kind === "review" || p.kind === "call";
    const byTester = own && r && (r.reason === CHARGED_BY_TESTER || r.reason === CHARGED_BY_TESTER_14);
    const how = p.kind === "chargeback" ? "" : p.settledAt || p.owedUntil ? "paid through Pay what you owe" : byTester ? "charged by you after 7 days without a review" : own && r?.auto ? "charged automatically after 7 days" : "";
    const what = `from ${displayName(c.test.developer)} for your ${ctx.partOf(o)} on “${c.title}”${p.kind === "extra" ? " (extra pay)" : p.kind === "dispute" ? " (dispute decision)" : ""}`;
    out.set(p.id, { what, full: what, how, testId: c.testId, reversed: false });
  }
  return out;
}

// ---------- (Owner, Nov 3) The Stripe description of every payment ----------

/** Stripe's limit for a PaymentIntent's description. */
export const DESCRIPTION_MAX = 1000;
const PREFIX = "Playtest: ";
/** A text cut to Stripe's limit (only a list can get that long: `listWithin` ends one with "… and N more" first). */
const clip = (s: string) => (s.length > DESCRIPTION_MAX ? `${s.slice(0, DESCRIPTION_MAX - 1)}…` : s);
/** "<head><a>, <b>, … and N more<close>": as many items as fit in Stripe's 1,000 characters, the rest counted. */
export function listWithin(head: string, items: string[], close = "", max = DESCRIPTION_MAX) {
  const at = (n: number) => `${head}${[...items.slice(0, n), ...(n < items.length ? [`… and ${items.length - n} more`] : [])].join(", ")}${close}`;
  for (let n = items.length; n >= 0; n--) if (at(n).length <= max) return at(n);
  return clip(at(0));
}
/**
 * One item of Pay what you owe's one payment or of a reservation, as its row will read on the page, with its amount: "Ana Silva's written answers on “Harbor Run”
 * $8.00". A reversed payment owed again reads as its repayment will: "Repaid the reversed $10.00 payment for … ($10.00 + $15.00 chargeback fee) $25.00".
 */
function itemLine(ctx: Ctx, p: PayingRow) {
  if (p.chargeback === "open") {
    const o = { ...p, amountCents: p.paidCents ?? p.amountCents };
    const c = o.contractId ? ctx.contracts.get(o.contractId) : undefined;
    const piece = c ? pieceName({ tester: displayName(c.tester), part: ctx.partOf(o), test: c.title, full: true }) : null;
    return `${repaidReversedLine(o, repaidWord(o.kind), piece) ?? plainLabel("chargeback")} ${money(reversedOf(o) + CHARGEBACK_FEE_CENTS)}`;
  }
  return `${devLine(ctx, p, true)?.what ?? plainLabel(p.kind)} ${money(p.amountCents)}`;
}

/** What a charge pays for: one payment, Pay what you owe's one payment (its items; `charges`: the charges made while away), or a chargeback hold's reservation. */
export type Paying = { payment: PayingRow } | { owed: PayingRow[]; charges?: boolean } | { reserve: PayingRow[] };
/**
 * (Owner, Nov 3) THE Stripe description of a payment, built from what is being paid: the payment's line in Payments' "What you've paid" (developer side, `devLine`)
 * with the names in full, after "Playtest: ".
 * - One payment: "Playtest: Marc Hanna's written answers on “chargechargecharge”", "Playtest: Pay more for …", "Playtest: The team's dispute decision on …",
 *   "Playtest: Marc Hanna's written answers on “…”, charged by Marc Hanna after 7 days without a review", "Playtest: Marc Hanna's live call on “…”, charged
 *   automatically after 7 days", "Playtest: Repaid the reversed $39.00 Pay more for … ($39.00 + $15.00 chargeback fee)".
 * - Pay what you owe's one payment: "Playtest: What you owe (<each item as on the page> $8.00, …)" ("Charges made while you were away (…)" for those).
 * - A chargeback hold's reservation: "Playtest: Reserved for the team's review: <each item> $8.00, …".
 * At most 1,000 characters (Stripe's limit): a longer list ends "… and N more". A subscription keeps its own ("Playtest subscription ($7/month)").
 */
export async function stripeDescription(x: Paying): Promise<string> {
  if ("payment" in x) {
    const l = devLine(await lineContext([x.payment]), x.payment, true);
    return clip(`${PREFIX}${l ? `${l.what}${l.how ? `, ${l.how}` : ""}` : plainLabel(x.payment.kind)}`);
  }
  const rows = "owed" in x ? x.owed : x.reserve;
  const ctx = await lineContext(rows);
  const items = rows.map((p) => itemLine(ctx, p));
  if ("owed" in x) return listWithin(`${PREFIX}${x.charges ? "Charges made while you were away" : "What you owe"} (`, items, ")");
  return listWithin(`${PREFIX}Reserved for the team's review: `, items);
}

/**
 * A payment row's description, fixed the first time it is charged (`Payment.stripeDescription`): a retry with the same idempotency key (a lost answer asked again)
 * always sends what Stripe already has, even if a name changed meanwhile (Stripe refuses a key reused with other details).
 */
export async function describedOnce(id: string, build: () => Promise<string>) {
  const row = await db.payment.findUnique({ where: { id }, select: { stripeDescription: true } });
  if (row?.stripeDescription) return row.stripeDescription;
  const description = await build();
  await db.payment.updateMany({ where: { id, stripeDescription: null }, data: { stripeDescription: description } });
  return (await db.payment.findUnique({ where: { id }, select: { stripeDescription: true } }))?.stripeDescription ?? description;
}
