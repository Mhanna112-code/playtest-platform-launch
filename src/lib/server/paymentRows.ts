import { db } from "@/lib/db";
import { displayName, fmtDateTimeIn, money, pronouns } from "@/lib/format";
import { CHARGEBACK_FEE_CENTS, CHARGED_BY_TESTER, CHARGED_BY_TESTER_14, cut10, disputeDecisionName, pieceName, repaidReversedLine, reversedOf, reversedPart } from "@/lib/rules";
import { callAtFor } from "./dateFormat";
import { dateZone } from "./dateZone";

type Row = { id: string; kind: string; amountCents: number; contractId: string | null; submissionId: string | null; callId: string | null; repaysId: string | null; settledAt: Date | null; owedUntil: Date | null; chargebackAt: Date | null; reversedCents?: number | null; /** (§191) the one charge that paid it */ coveredById?: string | null };
/**
 * What a payment's line is built from: a Payment row, or one about to be made (a team decision is charged before its row exists). `paidCents`: an owed reversed
 * payment's own amount (holds.owed puts what the bank reversed + the fee in `amountCents`).
 */
export type PayingRow = { kind: string; amountCents: number; contractId: string | null; submissionId?: string | null; callId?: string | null; repaysId?: string | null; settledAt?: Date | null; owedUntil?: Date | null; chargeback?: string | null; reversedCents?: number | null; paidCents?: number };
/**
 * `full` (§131): `what` with the names uncut, the row's hover on Payments. `testId` null: a row with no test to link (§133: the repayment of part of Pay what you owe's
 * one payment). `reversedCents` (§133): what the bank reversed of this payment when it was only part of it.
 */
export type PaidRow = { what: string; full: string; how: string; testId: string | null; reversed: boolean; reversedCents?: number | null; /** (§191) its line inside its one payment's group */ group?: GroupItem };
/**
 * (Owner, Nov 4, §191) An item's line inside the group of the ONE charge that paid it (Pay what you owe, Confirm all): exactly what it was, never "paid through Pay
 * what you owe" / "confirmed with Confirm all" (the group says it). `amount`: a repayment's "$1.00 + $15.00 chargeback fee" (else the page shows the item's amount).
 */
export type GroupItem = { what: string; full: string; how: string; amount: string | null };

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
  // (§191) Each call's start: a group's items name a call by its date AND time (§177/§178).
  const calls = new Map((await db.call.findMany({ where: { id: { in: all.map((p) => p.callId).filter((x): x is string => !!x) } }, select: { id: true, startsAt: true } })).map((x) => [x.id, x.startsAt]));
  return { src, repaid, contracts, reviewOf, partOf, calls };
}
type Ctx = Awaited<ReturnType<typeof lineContext>>;

/**
 * (Owner, Nov 3) THE developer's line of one payment in Payments' "What you've paid": `what`, then `how` after a comma. Its Stripe description is built from the same
 * line (`stripeDescription`), so the two can't drift. `full`: the names uncut (Stripe, and the page's hover). Null for a row with no test to name (the page shows its
 * plain label).
 */
function devLine(ctx: Ctx, p: PayingRow, full: boolean, viaKnown?: Via) {
  // A caller that doesn't know what paid it (the Stripe description of a debt Pay what you owe repays) keeps the earlier reading: settled or owed is Pay what you owe.
  const via: Via = viaKnown ?? (p.settledAt || p.owedUntil ? "owed" : "");
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
  // (Owner, Nov 4) How it was paid, from what actually paid it (`paidVia`): a charge confirmed with the bank (on its own, or by Confirm all's one payment) says so; it
  // read "paid through Pay what you owe" whenever it was settled.
  const how = p.kind === "chargeback" ? "" : [byTester ? `charged by ${tester} after 7 days without a review` : own && r?.auto ? "charged automatically after 7 days" : "", VIA_LINE[via]].filter(Boolean).join(", ");
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

/** (§191) A part named for a group's item: its tester, part and test, a call by its date and time in the reader's zone (`whose`: "her" in place of the name). */
function groupPiece(ctx: Ctx, o: PayingRow, full: boolean, whose?: string) {
  const c = o.contractId ? ctx.contracts.get(o.contractId) : undefined;
  if (!c) return null;
  const start = o.callId ? ctx.calls.get(o.callId) : undefined;
  return pieceName({ tester: displayName(c.tester), part: ctx.partOf(o), test: c.title, when: start ? callAtFor(start, null) : null, full, whose });
}
/** (§191) How a payment was charged: the developer's own Pay or Pay more, the team's decision, the tester's Charge, the automatic charge (7 days without a review). */
function chargedHow(ctx: Ctx, o: PayingRow) {
  const r = ctx.reviewOf(o);
  const own = o.kind === "review" || o.kind === "call";
  if (o.kind === "extra") return "more" as const;
  if (o.kind === "dispute") return "dispute" as const;
  if (own && r && (r.reason === CHARGED_BY_TESTER || r.reason === CHARGED_BY_TESTER_14)) return "tester" as const;
  if (own && r?.auto) return "auto" as const;
  return "pay" as const;
}
const up = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * (Owner, Nov 4, §191) An item's line inside its one payment's group, naming exactly what it was (the owner: never vague): "Ana Silva's written answers on “Harbor
 * Run”", "Ben Okafor's live call on “Harbor Run” (Tue, Oct 27, 3:25 PM)", "Pay more for …", "The team's dispute decision on …", "Ana Silva charged for her written
 * answers on “Harbor Run”" (after 7 days without a review), "The automatic charge for Ben Okafor's live call on “Harbor Run” (Tue, Oct 27, 3:25 PM)". A repayment
 * names the payment the bank reversed and what kind it was, then what it repaid: "Repaid: your $1.00 Pay more for bb's written answers on “Harbor Run” that your
 * bank reversed" · "$1.00 + $15.00 chargeback fee"; "Repaid: the team's $5.00 dispute decision on …", "the $10.00 Ana Silva charged for her …", "the automatic
 * $15.50 charge for …", "your $10.00 Pay for …", "your $35.00 Pay what you owe payment on Wed, Nov 4, 12:30 PM" (a Confirm all one the same); part of one: "$96.00
 * of your …". A call is named by its date AND time in the reader's zone (§177/§178).
 */
function groupLine(ctx: Ctx, p: PayingRow, full: boolean): { what: string; how: string; amount: string | null } {
  const cut = full ? (x: string) => x : cut10;
  const when = (d: Date) => fmtDateTimeIn(d, dateZone());
  if (p.kind === "chargeback" && p.repaysId) {
    const o = ctx.repaid.get(p.repaysId);
    const rev = o ? reversedOf(o) : p.amountCents - CHARGEBACK_FEE_CENTS;
    const fee = p.amountCents - rev;
    const amount = rev > 0 && fee > 0 ? `${money(rev)} + ${money(fee)} chargeback fee` : null;
    if (!o) return { what: "Repaid: a payment your bank reversed", how: "", amount };
    const a = money(o.amountCents);
    const c = o.contractId ? ctx.contracts.get(o.contractId) : undefined;
    const piece = groupPiece(ctx, o, full);
    let paid: string;
    // A one payment (Pay what you owe's, Confirm all's, a reservation's): its kind and when it was made.
    if (o.kind === "owed") paid = `your ${a} ${o.note === "press:all" ? "Confirm all payment" : o.note === "reserve" ? "payment reserved on your card" : "Pay what you owe payment"} on ${when(o.createdAt)}`;
    else if (!c || !piece) paid = `your ${a} payment on ${when(o.createdAt)}`;
    else {
      const how = chargedHow(ctx, o);
      paid = how === "more" ? `your ${a} Pay more for ${piece}`
        : how === "dispute" ? `the team's ${a} dispute decision on ${piece}`
        : how === "tester" ? `the ${a} ${cut(displayName(c.tester))} charged for ${groupPiece(ctx, o, full, pronouns(c.tester.pronoun).poss)}`
        : how === "auto" ? `the automatic ${a} charge for ${piece}`
        : `your ${a} Pay for ${piece}`;
    }
    return { what: `Repaid: ${reversedPart(o) ? `${money(rev)} of ` : ""}${paid} that your bank reversed`, how: "", amount };
  }
  const c = p.contractId ? ctx.contracts.get(p.contractId) : undefined;
  const piece = groupPiece(ctx, p, full);
  if (!c || !piece) return { what: plainLabel(p.kind), how: "", amount: null };
  const how = chargedHow(ctx, p);
  return how === "more" ? { what: `Pay more for ${piece}`, how: "", amount: null }
    : how === "dispute" ? { what: up(disputeDecisionName(piece)), how: "", amount: null }
    : how === "tester" ? { what: `${cut(displayName(c.tester))} charged for ${groupPiece(ctx, p, full, pronouns(c.tester.pronoun).poss)}`, how: "after 7 days without a review", amount: null }
    : how === "auto" ? { what: `The automatic charge for ${piece}`, how: "after 7 days without a review", amount: null }
    : { what: piece, how: "", amount: null };
}

type Via = "" | "all" | "owed" | "bank";
const VIA_LINE: Record<Via, string> = { "": "", all: "confirmed with Confirm all", owed: "paid through Pay what you owe", bank: "confirmed with your bank" };
/**
 * (Owner, Nov 4) What paid each settled row: Confirm all's one payment (kind "owed", note "press:all", which the rows point to through coveredById), Pay what
 * you owe's one payment (any other covering payment, or a debt: owedUntil), or its own bank check (a charge made while away, confirmed on its own).
 */
async function paidVia(ps: Row[]): Promise<Map<string, Via>> {
  const settled = ps.filter((p) => p.settledAt || p.owedUntil);
  const covers = await db.payment.findMany({ where: { id: { in: settled.map((p) => p.id) }, coveredById: { not: null } }, select: { id: true, coveredById: true } });
  const alls = new Set((await db.payment.findMany({ where: { id: { in: covers.map((c) => c.coveredById!) }, note: "press:all" }, select: { id: true } })).map((x) => x.id));
  const coveredBy = new Map(covers.map((c) => [c.id, c.coveredById!]));
  return new Map(settled.map((p): [string, Via] => {
    const by = coveredBy.get(p.id);
    return [p.id, by ? (alls.has(by) ? "all" : "owed") : p.owedUntil ? "owed" : "bank"];
  }));
}

/**
 * (Owner, Oct 30, batch 32 §18) What each line of Payments' paid lists was for: the tester (or developer), the part and the test, and how it was paid ("charged by Ana
 * Silva after 7 days without a review", "charged automatically after 7 days", "paid through Pay what you owe"); a payment the developer's bank reversed says so.
 * A chargeback's repayment names the payment it repaid. Rows it can't place keep a plain label ("Subscription", "Sent work").
 */
export async function paidRows(ps: Row[], side: "developer" | "tester"): Promise<Map<string, PaidRow>> {
  const ctx = await lineContext(ps);
  const via = await paidVia(ps);
  const out = new Map<string, PaidRow>();
  for (const p of ps) {
    if (side === "developer") {
      const cut = devLine(ctx, p, false, via.get(p.id)), whole = devLine(ctx, p, true, via.get(p.id));
      // (§191) Its line inside the group of the one charge that paid it (drawn only there).
      const g = p.coveredById ? groupLine(ctx, p, false) : null;
      const group = g ? { ...g, full: groupLine(ctx, p, true).what } : undefined;
      if (cut && whole) out.set(p.id, { what: cut.what, full: whole.what, how: cut.how, testId: cut.testId, reversed: !!p.chargebackAt, reversedCents: p.chargebackAt && reversedPart(p) ? reversedOf(p) : null, group });
      else if (group) out.set(p.id, { what: plainLabel(p.kind), full: plainLabel(p.kind), how: "", testId: null, reversed: !!p.chargebackAt, reversedCents: p.chargebackAt && reversedPart(p) ? reversedOf(p) : null, group });
      continue;
    }
    // The tester's rows (unchanged by §131): "from Nora Lane for your written answers on “Harbor Run”".
    const o = ctx.src(p);
    const c = o.contractId ? ctx.contracts.get(o.contractId) : undefined;
    if (!c) continue;
    const r = ctx.reviewOf(o);
    const own = p.kind === "review" || p.kind === "call";
    const byTester = own && r && (r.reason === CHARGED_BY_TESTER || r.reason === CHARGED_BY_TESTER_14);
    // (Owner, Nov 4) How the developer confirmed it is theirs: the tester's row reads as the charge itself (Pay what you owe kept as before).
    const how = p.kind === "chargeback" ? "" : via.get(p.id) === "owed" ? "paid through Pay what you owe" : byTester ? "charged by you after 7 days without a review" : own && r?.auto ? "charged automatically after 7 days" : "";
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
export type Paying = { payment: PayingRow } | { owed: PayingRow[]; charges?: boolean; /** (§147) Confirm all's one payment */ all?: boolean } | { reserve: PayingRow[] };
/**
 * (Owner, Nov 3) THE Stripe description of a payment, built from what is being paid: the payment's line in Payments' "What you've paid" (developer side, `devLine`)
 * with the names in full, after "Playtest: ".
 * - One payment: "Playtest: Marc Hanna's written answers on “chargechargecharge”", "Playtest: Pay more for …", "Playtest: The team's dispute decision on …",
 *   "Playtest: Marc Hanna's written answers on “…”, charged by Marc Hanna after 7 days without a review", "Playtest: Marc Hanna's live call on “…”, charged
 *   automatically after 7 days", "Playtest: Repaid the reversed $39.00 Pay more for … ($39.00 + $15.00 chargeback fee)".
 * - Pay what you owe's one payment: "Playtest: What you owe (<each item as on the page> $8.00, …)" ("Charges made while you were away (…)" for those;
 *   "Confirm all (…)" for Confirm all's, §147).
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
  // (Owner, Nov 3, §147) Confirm all's one payment: "Playtest: Confirm all (Ana Silva's written answers on “Harbor Run” $10.00, …)".
  if ("owed" in x) return listWithin(`${PREFIX}${x.all ? "Confirm all" : x.charges ? "Charges made while you were away" : "What you owe"} (`, items, ")");
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
