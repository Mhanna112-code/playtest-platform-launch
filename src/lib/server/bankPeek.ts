import type { Payment } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, money } from "@/lib/format";
import { PRESS_ACTION_MS } from "@/lib/rules";
import { CANCELLED_WHY, cancelledLine, stillPaysLine } from "@/lib/bankNotice";
import { HttpError } from "./http";
import { fakeOn, getStripe, isMissing, stripeOn } from "./stripe";
import { payPressOf, seenOf } from "./live";

// (Owner, Nov 3, batch 35 §158) The inline bank check finishes by itself even when the bank's return page is blocked (on localhost Chrome blocks Stripe's public page from
// sending the frame back to http://localhost: Private Network Access). While the bank's page is open the page asks here every few seconds whether Stripe is still waiting
// for the customer; once it isn't, the page runs its normal finish (the same one the return page's message or Close runs), and the server decides there as always.
// (Owner, Nov 3, batch 35 §160) Once the bank's page is open, Stripe's Complete can't be stopped by us. So the same peek also says what changed since the press that
// would have stopped it (`changes`: the very stop-once lines the press would have got), or that the check was cancelled underneath it (`cancelled`, with the plain
// reason): the box shows them in a blue notice above the bank's frame before the developer presses Complete.
//
// READ-ONLY: a peek only reads Stripe's status and the app's rows. It never finishes, cancels, releases, expires, claims or charges anything, writes no log (nothing is
// marked answered or seen), and only answers for the developer's own check.

export type PeekAnswer = "waiting" | "done";
/** What a peek answers: Stripe still waits or not, and (§160) what the box's blue notice says. `changes`, `still` and `cancelled` are left out when there are none. */
export type PeekReply = { status: PeekAnswer; changes?: string[]; still?: string; cancelled?: string };

/** Stripe still waits for the customer (the bank's page is open, or its answer is processing); anything else (succeeded, requires_capture, canceled, a failed attempt) is an end. */
export function stillWaiting(o: { status?: string | null; last_payment_error?: unknown; last_setup_error?: unknown }) {
  // (§159 R4) "processing" (the bank's answer on its way after Complete) isn't an end yet either: the finish would read it as not confirmed.
  if (o.status === "requires_action" || o.status === "requires_confirmation" || o.status === "processing") return true;
  // Back to requires_payment_method after a failed attempt (the bank refused): ended. Without an error it hasn't been tried yet: still waiting.
  if (o.status === "requires_payment_method") return !(o.last_payment_error || o.last_setup_error);
  return false;
}

const NOTHING = "There's nothing to confirm here.";

async function piAnswer(id: string): Promise<PeekAnswer> {
  if (!stripeOn()) return "waiting"; // no Stripe: the stand-in's own Confirm / Cancel decides
  // (§130) Stripe doesn't know it: nothing to wait for (the finish says how it ended).
  const pi = await getStripe().paymentIntents.retrieve(id).catch((e) => { if (isMissing(e)) return null; throw e; });
  return pi && stillWaiting(pi as { status: string }) ? "waiting" : "done";
}

/** (§160) The press time the page sent (when its bank box opened), never later than now; a press's own row is never older than its press. */
function sinceOf(body: Record<string, unknown>, made?: Date | null) {
  const sent = seenOf(body.since);
  if (!sent) return null;
  const now = new Date();
  const at = sent > now ? now : sent;
  return made && made > at ? made : at;
}

type Line = { text: string; at: Date | string };
/** Only what came after the press (a stop box before it already showed the rest), each line once, oldest first. */
const after = (lines: Line[], since: Date) => [...new Set(lines.filter((l) => new Date(l.at) > since).sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()).map((l) => l.text))];

/**
 * (§160) A piece's payment (Pay, Pay more, Confirm with your bank on a test): EXACTLY the stop-once lines that press would get now. The same devGate call (read-only:
 * it only reads, and throws its stop) with the same press (payPressOf; a retried chargeback's row checks the piece of the payment the bank reversed), so the Alerts
 * ticks and the team's-decision rule apply as for Pay. Seen at the press: only what came after it.
 */
async function pieceChanges(p: Payment, since: Date, tab: string) {
  const c = await db.contract.findUnique({ where: { id: p.contractId! }, select: { id: true, testId: true } });
  if (!c) return [];
  const orig = p.kind === "chargeback" && p.repaysId && !p.submissionId && !p.callId ? await db.payment.findUnique({ where: { id: p.repaysId }, select: { submissionId: true, callId: true } }) : null;
  const piece = { submissionId: p.submissionId ?? orig?.submissionId ?? null, callId: p.callId ?? orig?.callId ?? null };
  const { devGate } = await import("./tests");
  try {
    // (Owner, Nov 4, §171 A3) Everything about this payment's tester, whatever the Alerts ticks (`wholeTester`); other testers' lines keep following them.
    await devGate(db as unknown as Parameters<typeof devGate>[0], c.testId, { seenAt: since.toISOString(), tab }, {}, [], undefined, { ...payPressOf(c.id, piece), wholeTester: true });
    return [];
  } catch (e) {
    if (!(e instanceof HttpError) || e.code !== "stop_once") throw e;
    return after((e.data?.changes as Line[] | undefined) ?? [], since);
  }
}

/**
 * (§160) Pay what you owe (its one payment, or a chargeback hold's reservation): every new debt or charge that arrived after the press, named with its amount and
 * what happens to it (owner, Nov 3). None is ever added to the check that is open: a new chargeback, a payment declined or a tester's Charge waits for the next Pay
 * what you owe (an unpaid hold), or is charged right after the team approves lifting the hold (a chargeback hold's reservation, which reserves ONCE: batch 28
 * §8); a charge made during an unpaid hold is charged right after this payment goes through (§125). A disputed amount the bank changed is said too.
 */
const testerOf = async (contractId: string | null) => { const c = contractId ? await db.contract.findUnique({ where: { id: contractId }, select: { tester: true } }) : null; return c ? displayName(c.tester) : "A tester"; };
export const owedTail = (reservation: boolean, charge: boolean) =>
  reservation ? "it isn't in this reservation; it's charged right after the team approves lifting your hold"
    : charge ? "it's charged right after this payment goes through" : "it isn't in this payment; pay it with Pay what you owe after this one";
async function owedChanges(devId: string, since: Date, covered: Set<string>, reservation = false) {
  const { owedLines } = await import("./holds");
  const lines = (await owedLines(devId)).filter((l) => !covered.has(l.id));
  const rows = lines.length ? await db.payment.findMany({ where: { id: { in: lines.map((l) => l.id) } }, select: { id: true, kind: true, status: true, amountCents: true, createdAt: true, owedUntil: true, chargebackAt: true, contractId: true } }) : [];
  const out: Line[] = [];
  for (const l of lines) {
    const r = rows.find((x) => x.id === l.id);
    if (!r) continue;
    if (r.status === "deferred") {
      if (r.createdAt > since) out.push({ text: `${r.kind === "dispute" ? "The team's dispute decision added" : `${await testerOf(r.contractId)} charged`} ${money(r.amountCents)} meanwhile: ${owedTail(reservation, true)}`, at: r.createdAt });
      continue;
    }
    const at = [r.chargebackAt, r.owedUntil, r.status === "owed" ? r.createdAt : null].filter((d): d is Date => !!d && d > since).sort((a, b) => a.getTime() - b.getTime())[0];
    if (!at) continue;
    const what = l.source === "failed" ? `${l.text.replace(/ · card declined .*$/, "")} (card declined)` : l.text;
    out.push({ text: `${what}: ${owedTail(reservation, false)}`, at });
  }
  for (const e of await db.accountEvent.findMany({ where: { userId: devId, kind: "chargeback-amount", createdAt: { gt: since } }, orderBy: { createdAt: "asc" }, take: 20 })) {
    const m = / of the (\$[\d,.]+) payment \([^)]*\) from (\$[\d,.]+) to (\$[\d,.]+)/.exec(e.note);
    if (m) out.push({ text: `Your bank changed the disputed amount of your ${m[1]} payment from ${m[2]} to ${m[3]}${reservation ? ": this reservation stays as pressed; the difference is settled when the team approves lifting your hold" : ": this payment stays as pressed"}`, at: e.createdAt });
  }
  return after(out, since);
}

/**
 * (§160) Confirm all: a new charge made while away (it asks the bank) that this one payment doesn't cover. Never added to it: "Ben Okafor charged $10.00 meanwhile:
 * it isn't in this payment; confirm it on its own, or with Confirm all after this one." (owner, Nov 3).
 */
export const notInAllLine = (who: string, cents: number) => `${who} ${who.startsWith("The team") ? "added" : "charged"} ${money(cents)} meanwhile: it isn't in this payment; confirm it on its own, or with Confirm all after this one`;
async function allChanges(devId: string, since: Date, oneId: string, tab: string) {
  const { inAll } = await import("./confirmAll");
  const fresh = (await db.payment.findMany({ where: { developerId: devId, createdAt: { gt: since }, actionPi: { not: null }, coveredById: null, NOT: { id: oneId } }, orderBy: { createdAt: "asc" } })).filter(inAll);
  const out: Line[] = [];
  for (const p of fresh) out.push({ text: notInAllLine(p.kind === "dispute" ? "The team's dispute decision" : await testerOf(p.contractId), p.amountCents), at: p.createdAt });
  // (Owner, Nov 4, §171 A3) And everything about each covered charge's tester (its part's pay-press lines, whatever the Alerts ticks), each line once.
  const lines = [...after(out, since)];
  for (const c of await db.payment.findMany({ where: { coveredById: oneId, contractId: { not: null } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }))
    for (const t of await pieceChanges(c, since, tab)) if (!lines.includes(t)) lines.push(t);
  return lines;
}

/**
 * (Owner, Nov 4, §171 B4) The reason this window's check is not the charge's live check any more, or null: the charge is covered by Confirm all (or another one
 * payment), its check was replaced by a new one, or it was paid on another check. `pi`: the PaymentIntent the window holds (from its client secret); a page that
 * doesn't send it is only told about a cover. A one payment's own check (Pay what you owe, Confirm all) is always its own.
 */
async function notThisCheck(p: Payment, pi: string) {
  const once = await import("./owedOnce");
  if (p.kind === once.OWED_KIND) return null;
  if (p.coveredById && p.coveredById !== p.id) {
    const cover = await db.payment.findUnique({ where: { id: p.coveredById }, select: { kind: true, note: true } });
    if (cover) return once.isAll(cover) ? CANCELLED_WHY.inAll : CANCELLED_WHY.inOther;
  }
  if (!pi) return null;
  if (p.actionPi && p.actionPi !== pi) return CANCELLED_WHY.replaced;
  if (!p.actionPi && p.settledAt && p.stripePaymentIntentId && p.stripePaymentIntentId !== pi) return CANCELLED_WHY.paidOther;
  return null;
}

/** (§160) Was this payment's check ended by something else while its bank page was open? Still waiting, or paid: no. */
function endedUnderneath(p: Payment) {
  if (p.actionPi) return false;
  return p.status === "cancelled" || p.status === "deferred" || (p.status === "failed" && p.kind !== "owed");
}

/** (§160) Why it was cancelled, in plain words: a hold started, a new card, its time ran out, paused, Stripe's other mode, or ended elsewhere. */
async function whyCancelled(p: Payment, devId: string, since: Date) {
  // (Owner, Nov 4, §171 B6) Pay what you owe's check cancelled by a chargeback change: the one payment keeps why.
  const once = await import("./owedOnce");
  if (p.failure === once.OWED_REVIEW_AGAIN) return CANCELLED_WHY.reviewAgain;
  if (p.failure === once.OWED_WON_MEANWHILE) return CANCELLED_WHY.won;
  const u = await db.user.findUnique({ where: { id: devId }, select: { holdStartedAt: true, stripePaymentMethodId: true } });
  if (u?.holdStartedAt && u.holdStartedAt >= since) return CANCELLED_WHY.hold;
  const { RAN_OUT } = await import("./owedOnce");
  if (p.failure === RAN_OUT || (p.status === "failed" && p.owedUntil)) return CANCELLED_WHY.awayRanOut;
  const { STALE_CHECK } = await import("./confirm");
  if (p.failure === STALE_CHECK) return CANCELLED_WHY.otherMode;
  // The check was made on another card than the one saved now: a new card cancelled it (§148).
  const pi = p.stripePaymentIntentId;
  if (pi && stripeOn() && u?.stripePaymentMethodId) {
    const was = await getStripe().paymentIntents.retrieve(pi).catch(() => null);
    const pm = was ? (typeof was.payment_method === "string" ? was.payment_method : was.payment_method?.id ?? null) : null;
    if (pm && pm !== u.stripePaymentMethodId) return CANCELLED_WHY.card;
  }
  if (p.status === "deferred" && u?.holdStartedAt) return CANCELLED_WHY.paused;
  if (p.status === "cancelled" && Date.now() - p.createdAt.getTime() >= PRESS_ACTION_MS) return CANCELLED_WHY.pressRanOut;
  return CANCELLED_WHY.elsewhere;
}

/** A notice of plain changes also says what Complete still does. Nothing is added without changes. */
const withChanges = (status: PeekAnswer, changes: string[], cents: number, reserve = false): PeekReply => (changes.length ? { status, changes, still: stillPaysLine(money(cents), reserve) } : { status });

/**
 * (§158) Is the developer's bank check still waiting? `paymentId`: a payment's check (Pay, Pay more, Subscribe, Confirm with your bank, Pay what you owe, Confirm all) or
 * a chargeback hold's reservation (Pay what you owe during a chargeback hold); `setupIntent`: Verify a card. Someone else's (or an unknown one) is refused.
 * (§160) With `since` (when the page's bank box opened): also the `changes` since then, and `cancelled`. A cancelled check keeps the box open with its notice
 * (Stripe cancelled it, so its Complete charges nothing; the return page's message or Close ends it with the usual finish). One that had already gone through when
 * it was cancelled was recorded as paid: not cancelled, so done as before.
 */
export async function peekBankCheck(dev: { id: string }, body: Record<string, unknown>): Promise<PeekReply> {
  const tab = typeof body.tab === "string" ? body.tab : "";
  const setupIntent = typeof body.setupIntent === "string" ? body.setupIntent : "";
  if (setupIntent) {
    if (!stripeOn() || fakeOn()) return { status: "waiting" }; // simulated: the stand-in decides
    const si = await getStripe().setupIntents.retrieve(setupIntent).catch((e) => { if (isMissing(e)) return null; throw e; });
    if (!si) return { status: "done" };
    if (si.metadata?.userId !== dev.id || si.metadata?.purpose !== "chargeback-verify") throw new HttpError(403, "bad_setup", "That card check belongs to another account.");
    // (§160) Verify a card: only a cancelled check is said (it never charges).
    if (si.status === "canceled" && seenOf(body.since)) return { status: "waiting", cancelled: cancelledLine(CANCELLED_WHY.elsewhere, true) };
    return { status: stillWaiting(si) ? "waiting" : "done" };
  }
  const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
  if (!paymentId) throw new HttpError(404, "not_found", NOTHING);
  const reservation = await db.reservation.findUnique({ where: { id: paymentId } });
  if (reservation && reservation.developerId === dev.id) {
    const since = sinceOf(body, reservation.createdAt);
    // (§160) A new card cancelled it (§148), or it lapsed: its Complete reserves nothing.
    if (since && ["cancelled", "expired", "failed"].includes(reservation.status)) {
      // (Owner, Nov 4, §171 B6b) A chargeback it covered was won meanwhile: said so (Pay what you owe then reserves the new total).
      const won = reservation.status === "cancelled" && reservation.covers.length ? await db.payment.count({ where: { id: { in: reservation.covers }, chargeback: "won" } }) : 0;
      return { status: "waiting", cancelled: cancelledLine(won ? CANCELLED_WHY.won : reservation.status === "cancelled" ? CANCELLED_WHY.card : CANCELLED_WHY.pressRanOut) };
    }
    const status = reservation.stripePaymentIntentId ? await piAnswer(reservation.stripePaymentIntentId) : "waiting";
    return since ? withChanges(status, await owedChanges(dev.id, since, new Set(reservation.covers), true), reservation.amountCents, true) : { status };
  }
  const p = await db.payment.findUnique({ where: { id: paymentId } });
  if (!p || p.developerId !== dev.id) throw new HttpError(404, "not_found", NOTHING);
  const since = sinceOf(body, p.createdAt);
  // (Owner, Nov 4, §171 B4) This window's own check (its PaymentIntent, `pi`) is no longer the charge's live check: Confirm all took the charge over, a new check
  // replaced it, or it was paid on another one. Complete there charges nothing, and the notice says why.
  const gone = since ? await notThisCheck(p, typeof body.pi === "string" ? body.pi : "") : null;
  if (gone) return { status: "waiting", cancelled: cancelledLine(gone) };
  // (§160) Cancelled underneath the open bank page: said, and the box stays open (Stripe cancelled the check, so Complete charges nothing).
  if (since && endedUnderneath(p)) return { status: "waiting", cancelled: cancelledLine(await whyCancelled(p, dev.id, since)) };
  // Already finished, released or claimed elsewhere: nothing waits; the page's finish gives the server's own answer.
  if (!p.actionPi) return { status: "done" };
  const status = await piAnswer(p.actionPi);
  if (!since) return { status };
  const once = await import("./owedOnce");
  if (once.isAll(p)) return withChanges(status, await allChanges(dev.id, since, p.id, tab), p.amountCents);
  if (p.kind === once.OWED_KIND) {
    const covered = new Set((await db.payment.findMany({ where: { coveredById: p.id }, select: { id: true } })).map((x) => x.id));
    return withChanges(status, await owedChanges(dev.id, since, covered), p.amountCents);
  }
  if (p.contractId) return withChanges(status, await pieceChanges(p, since, tab), p.amountCents);
  return { status }; // a Subscribe or a renewal: only a cancelled check is said
}
