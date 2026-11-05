import { db } from "@/lib/db";
import { displayName, fmtDateTimeIn, money, pronouns } from "@/lib/format";
import { CHARGEBACK_FEE_CENTS, CHARGED_BY_TESTER, CHARGED_BY_TESTER_14, cut10, disputeDecisionName, pieceName, raiseOf, repaidReversedLine, reversedOf, reversedPart } from "@/lib/rules";
import { callAtFor } from "./dateFormat";
import { dateZone } from "./dateZone";

type Row = { id: string; kind: string; amountCents: number; contractId: string | null; submissionId: string | null; callId: string | null; repaysId: string | null; settledAt: Date | null; owedUntil: Date | null; chargebackAt: Date | null; reversedCents?: number | null; /** (§191) the one charge that paid it */ coveredById?: string | null; /** (§192) a raise charge's "raise:<from>:<to>" */ note?: string };
/**
 * What a payment's line is built from: a Payment row, or one about to be made (a team decision is charged before its row exists). `paidCents`: an owed reversed
 * payment's own amount (holds.owed puts what the bank reversed + the fee in `amountCents`).
 */
export type PayingRow = { /** (§193b) a one payment's id: its items are named */ id?: string; kind: string; amountCents: number; contractId: string | null; submissionId?: string | null; callId?: string | null; repaysId?: string | null; settledAt?: Date | null; owedUntil?: Date | null; chargeback?: string | null; reversedCents?: number | null; paidCents?: number; /** (§192) a raise charge's note */ note?: string | null; createdAt?: Date };
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

/**
 * (Owner, Nov 4, §192) "What you've paid"'s total once every refund is its own negative line: the plain signed sum of the lines (each payment that went through, a
 * refunded repayment included, less each refund line), each reversal (not won) taking off what it reversed as before (§133). For the same history it equals
 * paidOutTotal (a refunded repayment and its refund cancel out).
 */
export const paidLinesTotal = (listed: Counted[], ones: Counted[] = [], refunds: { amountCents: number }[] = []) =>
  listed.reduce((a, p) => a + p.amountCents, 0) - refunds.reduce((a, r) => a + r.amountCents, 0)
  - [...listed, ...ones].filter((p) => p.chargebackAt && p.chargeback !== "won" && p.status !== "refunded").reduce((a, p) => a + reversedOf(p), 0);

// (Owner, Nov 4, §195) What the developer has paid FOR ONE TESTER'S WORK on a test, shown once by the tester's name (Needs you's person, the Testers row, the Call
// requests box's person): Pay (the tester's Charge and a call's automatic charge are recorded as one: kinds "review" / "call"), Pay more ("extra") and the team's
// decision charges ("dispute"), each that went through (charged, or recorded with payments not set up). Never a repayment of a reversed payment ("chargeback": its
// fee is the platform's), a subscription or Pay what you owe's own record; a charge still waiting (for the bank, a hold, a retry) isn't paid yet. A payment the
// bank reversed (not won) counts less what was reversed and not paid back (the same reversal rule as paidOutTotal: reversedOf, §133).
/** (§195) The kinds of payment that pay for a tester's work. */
export const WORK_KINDS = ["review", "call", "extra", "dispute"];
const WENT_THROUGH = ["charged", "not_set_up"];
type WorkRow = { id: string; kind: string; status: string; amountCents: number; reversedCents?: number | null; chargebackAt: Date | null; chargeback: string };
/** (§195) The sum; `repaidOf(id)`: what of that payment's reversal the developer paid back (without the chargeback fee). */
export const workPaidCents = (rows: WorkRow[], repaidOf: (id: string) => number = () => 0) =>
  rows.filter((p) => WORK_KINDS.includes(p.kind) && WENT_THROUGH.includes(p.status))
    .reduce((a, p) => a + p.amountCents - (p.chargebackAt && p.chargeback !== "won" ? Math.max(0, reversedOf(p) - repaidOf(p.id)) : 0), 0);
/**
 * (§195) What of a reversal was paid back: its repayment and each raise charged after it that went through, less what was refunded of them (holds.repaidFor's
 * rule), less the ONE chargeback fee the repayment carried.
 */
export const repaidPrincipal = (sources: { id: string; kind: string; note?: string | null; amountCents: number }[], refunds: { paymentId: string; amountCents: number }[]) =>
  Math.max(0, sources.reduce((a, x) => a + x.amountCents - refunds.filter((r) => r.paymentId === x.id).reduce((b, r) => b + r.amountCents, 0), 0)
    - (sources.some((x) => !raiseOf(x)) ? CHARGEBACK_FEE_CENTS : 0));
/** (§195) Each contract's work paid (`workPaidCents`), read at once for a page: contract id → cents (0 when nothing went through). */
export async function paidForWork(contractIds: string[]): Promise<Map<string, number>> {
  const out = new Map(contractIds.map((id): [string, number] => [id, 0]));
  if (!contractIds.length) return out;
  const work = await db.payment.findMany({ where: { contractId: { in: contractIds }, kind: { in: WORK_KINDS }, status: { in: WENT_THROUGH } }, select: { id: true, kind: true, status: true, amountCents: true, reversedCents: true, chargebackAt: true, chargeback: true, contractId: true } });
  const reversedIds = work.filter((p) => p.chargebackAt && p.chargeback !== "won").map((p) => p.id);
  const sources = reversedIds.length ? await db.payment.findMany({ where: { repaysId: { in: reversedIds }, kind: "chargeback", status: { in: WENT_THROUGH } }, select: { id: true, kind: true, note: true, amountCents: true, repaysId: true } }) : [];
  const refunds = sources.length ? await db.paymentRefund.findMany({ where: { paymentId: { in: sources.map((x) => x.id) }, status: { not: "failed" } }, select: { paymentId: true, amountCents: true } }) : [];
  const repaidOf = (id: string) => repaidPrincipal(sources.filter((x) => x.repaysId === id), refunds);
  for (const id of contractIds) out.set(id, workPaidCents(work.filter((p) => p.contractId === id), repaidOf));
  return out;
}

/** The plain label of a paid row with no test to name ("What you've paid" shows it, and so does its Stripe description). */
export const plainLabel = (kind: string) =>
  kind === "call" ? "Live call" : kind === "dispute" ? "Dispute decision" : kind === "extra" ? "Extra pay" : kind === "chargeback" ? "A reversed payment, paid again" : kind === "subscription" ? "Subscription" : "Sent work";
/** A repayment line's word for the payment it repaid. */
const repaidWord = (kind: string) => (kind === "extra" ? " Pay more" : kind === "dispute" ? " dispute decision" : " payment");

/** What the lines of these payments name, loaded once: the payment a repayment repaid, each test and tester, each part, and how it was paid (its review). */
async function lineContext(ps: PayingRow[]) {
  const repaid = new Map((await db.payment.findMany({ where: { id: { in: ps.map((p) => p.repaysId).filter((x): x is string => !!x) } } })).map((p) => [p.id, p]));
  // (Owner, Nov 4, §192) A reversal whose amount the bank changed after it was repaid (a raise charged, or a refund of a lowered amount): its repayment still names
  // what the bank had reversed when it was repaid (the repayment less the fee), not the amount followed since.
  const ids = [...repaid.keys()];
  const changed = new Set(ids.length ? [
    ...(await db.payment.findMany({ where: { repaysId: { in: ids }, kind: "chargeback", note: { startsWith: "raise:" } }, select: { repaysId: true } })).map((x) => x.repaysId!),
    ...(await db.paymentRefund.findMany({ where: { reversalId: { in: ids }, reason: "lowered" }, select: { reversalId: true } })).map((x) => x.reversalId),
  ] : []);
  const src = (p: PayingRow): PayingRow => {
    const o = p.kind === "chargeback" && p.repaysId ? repaid.get(p.repaysId) : undefined;
    if (!o) return p;
    return changed.has(o.id) && !raiseOf({ kind: p.kind, note: p.note }) && p.amountCents > CHARGEBACK_FEE_CENTS ? { ...o, reversedCents: p.amountCents - CHARGEBACK_FEE_CENTS } : o;
  };
  // (Owner, Nov 4, §193b) The items each one payment paid (Pay what you owe's, Confirm all's): a line about a one payment the bank reversed names them all.
  const oneIds = [...ps, ...ps.map(src)].flatMap((p) => (p.kind === "owed" && p.id ? [p.id] : []));
  const coveredRows: (PayingRow & { id: string; coveredById: string | null })[] = oneIds.length ? await db.payment.findMany({ where: { coveredById: { in: oneIds } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }) : [];
  const covered = new Map<string, PayingRow[]>();
  for (const x of coveredRows) covered.set(x.coveredById!, [...(covered.get(x.coveredById!) ?? []), x]);
  const all = [...ps.map(src), ...coveredRows];
  const contracts = new Map((await db.contract.findMany({ where: { id: { in: all.map((p) => p.contractId).filter((x): x is string => !!x) } }, include: { tester: true, test: { include: { developer: true } } } })).map((c) => [c.id, c]));
  const subs = new Map((await db.submission.findMany({ where: { id: { in: all.map((p) => p.submissionId).filter((x): x is string => !!x) } }, select: { id: true, kind: true } })).map((s) => [s.id, s.kind]));
  const reviews = await db.review.findMany({ where: { OR: [{ submissionId: { in: [...subs.keys()] } }, { callId: { in: all.map((p) => p.callId).filter((x): x is string => !!x) } }] }, select: { submissionId: true, callId: true, reason: true, auto: true } });
  const reviewOf = (p: PayingRow) => reviews.find((r) => (p.submissionId && r.submissionId === p.submissionId) || (p.callId && r.callId === p.callId));
  const partOf = (p: PayingRow) => (p.callId ? "live call" : subs.get(p.submissionId ?? "") === "recording" ? "recording" : "written answers");
  // (§191) Each call's start: a group's items name a call by its date AND time (§177/§178).
  const calls = new Map((await db.call.findMany({ where: { id: { in: all.map((p) => p.callId).filter((x): x is string => !!x) } }, select: { id: true, startsAt: true } })).map((x) => [x.id, x.startsAt]));
  return { src, repaid, contracts, reviewOf, partOf, calls, covered };
}
type Ctx = Awaited<ReturnType<typeof lineContext>>;

/**
 * (Owner, Nov 3) THE developer's line of one payment in Payments' "What you've paid": `what`, then `how` after a comma. Its Stripe description is built from the same
 * line (`stripeDescription`), so the two can't drift. `full`: the names uncut (Stripe, and the page's hover). Null for a row with no test to name (the page shows its
 * plain label).
 */
function devLine(ctx: Ctx, p: PayingRow, full: boolean, viaKnown?: Via) {
  // (Owner, Nov 4, §192) A charge of what the bank raised after the repayment: "Your bank raised what it took back from your $20.00 Pay for …: $12.00 → $20.00".
  const raised = raiseLine(ctx, p, full);
  if (raised) {
    const o = p.repaysId ? ctx.repaid.get(p.repaysId) : undefined;
    return { what: raised, how: "", testId: (o?.contractId ? ctx.contracts.get(o.contractId)?.testId : null) ?? null };
  }
  // A caller that doesn't know what paid it (the Stripe description of a debt Pay what you owe repays) keeps the earlier reading: settled or owed is Pay what you owe.
  const via: Via = viaKnown ?? (p.settledAt || p.owedUntil ? "owed" : "");
  const o = ctx.src(p);
  const c = o.contractId ? ctx.contracts.get(o.contractId) : undefined;
  if (!c) {
    // (Owner, Nov 3, §133) The repayment of part of Pay what you owe's one payment (it paid for several items; the bank gives only an amount, so no item is named):
    // "Repaid $96 reversed from your $444.67 payment ($96 + $15 chargeback fee)". A whole one keeps the page's plain label, as before.
    // (Owner, Nov 4, §193b) Now it names that one payment and its items: "Repaid $96 reversed from your $444.67 Pay what you owe payment on … (…) (…)".
    const line = p.kind === "chargeback" && o !== p ? repaidReversedLine(o, " payment", null, o.kind === "owed" ? oneName(ctx, o, full) : null) : null;
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
/**
 * (§191) The payment the bank reversed, named for a line about it: "your $10.00 Pay for …", "your $1.00 Pay more for …", "the team's $5.00 dispute decision on …",
 * "the $12.00 Cid Moreau charged for his …", "the automatic $15.50 charge for …", "your $35.00 Pay what you owe payment on Wed, Nov 4, 12:30 PM" (a Confirm all one
 * the same). (§192) The refund lines and a raise's line name it the same way.
 */
function paidPhrase(ctx: Ctx, o: PayingRow, full: boolean) {
  const cut = full ? (x: string) => x : cut10;
  const when = (d: Date) => fmtDateTimeIn(d, dateZone());
  const a = money(o.amountCents);
  const c = o.contractId ? ctx.contracts.get(o.contractId) : undefined;
  const piece = groupPiece(ctx, o, full);
  const at = o.createdAt ?? new Date();
  // A one payment (Pay what you owe's, Confirm all's, a reservation's): its kind and when it was made, (Owner, Nov 4, §193b) and every item it paid.
  if (o.kind === "owed") return `your ${a} ${oneName(ctx, o, full)}`;
  if (!c || !piece) return `your ${a} payment on ${when(at)}`;
  const how = chargedHow(ctx, o);
  return how === "more" ? `your ${a} Pay more for ${piece}`
    : how === "dispute" ? `the team's ${a} dispute decision on ${piece}`
    : how === "tester" ? `the ${a} ${cut(displayName(c.tester))} charged for ${groupPiece(ctx, o, full, pronouns(c.tester.pronoun).poss)}`
    : how === "auto" ? `the automatic ${a} charge for ${piece}`
    : `your ${a} Pay for ${piece}`;
}

/**
 * (Owner, Nov 4, §193b) A one payment named by its kind, when it was made and every item it paid, in §191's item words: "Pay what you owe payment on Wed, Nov 4,
 * 12:30 PM (Ana Silva's written answers on “Harbor Run”, the automatic charge for Ben Okafor's live call on “Harbor Run” (Tue, Oct 27, 3:25 PM))".
 */
function oneName(ctx: Ctx, o: PayingRow, full: boolean) {
  const when = (d: Date) => fmtDateTimeIn(d, dateZone());
  const kind = o.note === "press:all" ? "Confirm all payment" : o.note === "reserve" ? "payment reserved on your card" : "Pay what you owe payment";
  const items = o.id ? ctx.covered.get(o.id) ?? [] : [];
  const names = items.map((x) => groupLine(ctx, x, full).what.replace(/^(The|Repaid: the|Repaid:) /, (m) => m.toLowerCase()));
  return `${kind} on ${when(o.createdAt ?? new Date())}${names.length ? ` (${names.join(", ")})` : ""}`;
}

/** (Owner, Nov 4, §192) A raise charge's line: "Your bank raised what it took back from your $20.00 Pay for …: $12.00 → $20.00" (null for any other payment). */
function raiseLine(ctx: Ctx, p: PayingRow, full: boolean) {
  const r = raiseOf({ kind: p.kind, note: p.note });
  if (!r) return null;
  const o = p.repaysId ? ctx.repaid.get(p.repaysId) : undefined;
  return `Your bank raised what it took back from ${o ? paidPhrase(ctx, o, full) : "your payment"}: ${money(r.from)} → ${money(r.to)}`;
}

function groupLine(ctx: Ctx, p: PayingRow, full: boolean): { what: string; how: string; amount: string | null } {
  const cut = full ? (x: string) => x : cut10;
  const raised = raiseLine(ctx, p, full);
  if (raised) return { what: raised, how: "", amount: null };
  if (p.kind === "chargeback" && p.repaysId) {
    // (§192) What the bank had reversed when it was repaid (ctx.src), whatever was followed since.
    const o = ctx.repaid.has(p.repaysId) ? ctx.src(p) : undefined;
    const rev = o ? reversedOf(o) : p.amountCents - CHARGEBACK_FEE_CENTS;
    const fee = p.amountCents - rev;
    const amount = rev > 0 && fee > 0 ? `${money(rev)} + ${money(fee)} chargeback fee` : null;
    if (!o) return { what: "Repaid: a payment your bank reversed", how: "", amount };
    return { what: `Repaid: ${reversedPart(o) ? `${money(rev)} of ` : ""}${paidPhrase(ctx, o, full)} that your bank reversed`, how: "", amount };
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

/**
 * (Owner, Nov 4, §192) A refund the developer received for a reversed payment they had repaid, as its own negative line under the payment it refunds (`paymentId`):
 * "Refunded: your bank's chargeback on your $10.00 Pay more for Ana Silva's written answers on “Harbor Run” was reversed in your favour" (won), "Refunded: your bank
 * lowered what it took back from your $20.00 Pay for …: $20.00 → $12.00" (lowered after the repayment). `amountCents` is positive (the page writes it "−$25.00").
 * `createdAt` null: a refund made before §192 (only its refunded repayment records it; its date isn't known). `stripePaymentIntentId`: the PaymentIntent refunded.
 */
export type RefundLine = { id: string; paymentId: string; amountCents: number; createdAt: Date | null; what: string; full: string; stripePaymentIntentId: string | null };

const WON_HEAD = "Refunded: your bank's chargeback on ", WON_TAIL = " was reversed in your favour";
/**
 * (Owner, Nov 5, §210) A won chargeback's refund said under the press whose bank check paid it (a chargeback won just as the bank approved it): "Your bank's
 * chargeback on your $10.00 Pay for Ana Silva's written answers on “Harbor Run” was reversed: $25.00 refunded." (the part named as its refund line names it);
 * null for any other refund line.
 */
export function wonRefundSaid(l: Pick<RefundLine, "full" | "amountCents">) {
  if (!l.full.startsWith(WON_HEAD) || !l.full.endsWith(WON_TAIL)) return null;
  return `Your bank's chargeback on ${l.full.slice(WON_HEAD.length, -WON_TAIL.length)} was reversed: ${money(l.amountCents)} refunded.`;
}

/** (§192) The refund lines of these payments (repayments and raise charges), by the payment each refunds. Failed refunds aren't lines (nothing reached the card). */
export async function refundLines(ps: (Row & { status: string; stripePaymentIntentId?: string | null; createdAt?: Date })[]): Promise<Map<string, RefundLine[]>> {
  const out = new Map<string, RefundLine[]>();
  const srcs = ps.filter((p) => p.kind === "chargeback" && p.repaysId);
  if (!srcs.length) return out;
  const recs = await db.paymentRefund.findMany({ where: { paymentId: { in: srcs.map((p) => p.id) }, status: { not: "failed" } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const ctx = await lineContext(srcs);
  const line = (src: Row, rec: { reason: string; fromCents: number | null; toCents: number | null }, full: boolean) => {
    const o = src.repaysId ? ctx.repaid.get(src.repaysId) : undefined;
    const phrase = o ? paidPhrase(ctx, o, full) : "a payment your bank reversed";
    if (rec.reason === "lowered") return `Refunded: your bank lowered what it took back from ${phrase}: ${money(rec.fromCents ?? 0)} → ${money(rec.toCents ?? 0)}`;
    return `${WON_HEAD}${o && reversedPart(o) ? `${money(reversedOf(o))} of ` : ""}${phrase}${WON_TAIL}`;
  };
  for (const p of srcs) {
    const mine = recs.filter((r) => r.paymentId === p.id);
    const list: RefundLine[] = mine.map((r) => ({ id: r.id, paymentId: p.id, amountCents: r.amountCents, createdAt: r.createdAt, what: line(p, r, false), full: line(p, r, true), stripePaymentIntentId: p.stripePaymentIntentId ?? null }));
    // A repayment refunded before §192 (won after it was repaid): its whole amount, as its own line too.
    if (!mine.length && p.status === "refunded") list.push({ id: `refunded-${p.id}`, paymentId: p.id, amountCents: p.amountCents, createdAt: null, what: line(p, { reason: "won", fromCents: null, toCents: null }, false), full: line(p, { reason: "won", fromCents: null, toCents: null }, true), stripePaymentIntentId: p.stripePaymentIntentId ?? null });
    if (list.length) out.set(p.id, list);
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
    return `${repaidReversedLine(o, repaidWord(o.kind), piece, o.kind === "owed" ? oneName(ctx, o, true) : null) ?? plainLabel("chargeback")} ${money(reversedOf(o) + CHARGEBACK_FEE_CENTS)}`; // (§193b) a one payment names its items
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
