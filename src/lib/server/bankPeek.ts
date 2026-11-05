import type { Payment } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, money, pronouns } from "@/lib/format";
import { PRESS_ACTION_MS, awayFromTest, onTestLine, paymentWords } from "@/lib/rules";
import { CANCELLED_WHY, cancelledLine, stillPaysLine } from "@/lib/bankNotice";
import { HttpError } from "./http";
import { fakeOn, getStripe, isMissing, stripeOn } from "./stripe";
import { payPressOf, seenOf } from "./live";
import { partAway } from "./partWords";

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

/** (Owner, Nov 5, §207) Stripe's answer, and whether Stripe itself shows the check cancelled ("canceled"). */
async function piState(id: string): Promise<{ answer: PeekAnswer; canceled: boolean }> {
  if (!stripeOn()) return { answer: "waiting", canceled: false }; // no Stripe: the stand-in's own Confirm / Cancel decides
  // (§130) Stripe doesn't know it: nothing to wait for (the finish says how it ended).
  const pi = await getStripe().paymentIntents.retrieve(id).catch((e) => { if (isMissing(e)) return null; throw e; });
  return { answer: pi && stillWaiting(pi as { status: string }) ? "waiting" : "done", canceled: (pi as { status?: string } | null)?.status === "canceled" };
}

/**
 * (Owner, Nov 5, §207; bug in the Nov 4 recordings R1c and R10b) Whatever ends a check underneath its open window (Cancel this check in another tab, a chargeback
 * won, a hold starting, the team's pause, the clocks) cancels it at Stripe FIRST, then lets go of it in the app (`actionPi` cleared) and, for Pay what you owe's
 * one payment, marks it cancelled a moment later (releaseOwed). A peek landing in between read the check as still held while Stripe already said "canceled", or
 * as let go but not yet cancelled: either way it answered "done", the page ran its finish at once, and the window closed by itself with a refusal instead of
 * staying open with the cancelled notice (§160, §171 B6 b). Such a peek now waits (up to SETTLE_MS) for the app to finish ending it, then answers from that.
 */
export const SETTLE_MS = 2500;
const SETTLE_STEP_MS = 100;
/** A payment in the middle of being ended: let go of (`actionPi` cleared) while Pay what you owe's one payment still reads as active (releaseOwed hasn't run yet). */
async function midRelease(p: Payment) {
  const { OWED_KIND, OWED_ACTIVE } = await import("./owedOnce");
  return !p.actionPi && p.kind === OWED_KIND && OWED_ACTIVE.includes(p.status);
}
/** The payment once whatever is ending it has finished (`ending` false), or as it is after SETTLE_MS. */
async function settled(p: Payment, ending: (x: Payment) => boolean | Promise<boolean>) {
  const until = Date.now() + SETTLE_MS;
  let cur = p;
  while ((await ending(cur)) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, SETTLE_STEP_MS));
    cur = (await db.payment.findUnique({ where: { id: p.id } })) ?? cur;
  }
  return cur;
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
async function pieceChanges(p: Payment, since: Date, tab: string, page: unknown) {
  const c = await db.contract.findUnique({ where: { id: p.contractId! }, select: { id: true, testId: true, title: true } });
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
    // (Owner, Nov 4, §177) A window open anywhere but this test's own page (the dashboard, Payments, Confirm all) names the test on each line: "On “Harbor Run”:
    // Nina Park disputed the pay for her live call on Tue, Oct 27, 8:00 AM". On the test's own page the page is the test.
    const lines = after((e.data?.changes as Line[] | undefined) ?? [], since);
    return awayFromTest(page, c.testId) ? lines.map((l) => onTestLine(c.title, l)) : lines;
  }
}

/**
 * (§160) Pay what you owe (its one payment, or a chargeback hold's reservation): every new debt or charge that arrived after the press, named with its amount and
 * what happens to it (owner, Nov 3). None is ever added to the check that is open: a new chargeback, a payment declined or a tester's Charge waits for the next Pay
 * what you owe (an unpaid hold), or is charged right after the team approves lifting the hold (a chargeback hold's reservation, which reserves ONCE: batch 28
 * §8); a charge made during an unpaid hold is charged right after this payment goes through (§125). A disputed amount the bank changed is said too.
 */
/**
 * (Owner, Nov 4, §177) A charge that arrived meanwhile, named by WHO charged WHAT on WHICH test (these windows are never a test's own page): "Ana Silva charged $5.00
 * for her written answers on “Harbor Run” meanwhile", "Ana Silva charged $15.00 for her live call on “Harbor Run” (Tue, Oct 27, 8:00 AM) meanwhile", "The
 * automatic charge for Ana Silva's live call on “Harbor Run” (Tue, Oct 27, 8:00 AM) added $15.00 meanwhile", "The team's dispute decision on Ana Silva's
 * recording on “Harbor Run” added $5.00 meanwhile", "Your Pay more for … added $5.00 meanwhile".
 */
async function meanwhileHead(p: { kind: string; amountCents: number; contractId: string | null; submissionId: string | null; callId: string | null }) {
  const c = p.contractId ? await db.contract.findUnique({ where: { id: p.contractId }, select: { title: true, tester: true } }) : null;
  const amount = money(p.amountCents);
  if (!c) return `${p.kind === "dispute" ? "The team's dispute decision added" : "A tester charged"} ${amount} meanwhile`;
  const name = displayName(c.tester);
  const piece = async () => `${name}'s ${(await partAway(p, "", c.title)).trimStart()}`;
  if (p.kind === "dispute") return `The team's dispute decision on ${await piece()} added ${amount} meanwhile`;
  if (p.kind === "extra") return `Your Pay more for ${await piece()} added ${amount} meanwhile`;
  if (p.callId && (await db.review.findUnique({ where: { callId: p.callId }, select: { auto: true } }))?.auto) return `The automatic charge for ${await piece()} added ${amount} meanwhile`;
  return `${name} charged ${amount} for ${await partAway(p, pronouns(c.tester.pronoun).poss, c.title)} meanwhile`;
}
export const owedTail = (reservation: boolean, charge: boolean) =>
  reservation ? "it isn't in this reservation; it's charged right after the team approves lifting your hold"
    : charge ? "it's charged right after this payment goes through" : "it isn't in this payment; pay it with Pay what you owe after this one";
async function owedChanges(devId: string, since: Date, covered: Set<string>, reservation = false) {
  const { owedLines } = await import("./holds");
  const lines = (await owedLines(devId)).filter((l) => !covered.has(l.id));
  const rows = lines.length ? await db.payment.findMany({ where: { id: { in: lines.map((l) => l.id) } }, select: { id: true, kind: true, status: true, amountCents: true, createdAt: true, owedUntil: true, chargebackAt: true, contractId: true, submissionId: true, callId: true } }) : [];
  const out: Line[] = [];
  for (const l of lines) {
    const r = rows.find((x) => x.id === l.id);
    if (!r) continue;
    if (r.status === "deferred") {
      if (r.createdAt > since) out.push({ text: `${await meanwhileHead(r)}: ${owedTail(reservation, true)}`, at: r.createdAt });
      continue;
    }
    const at = [r.chargebackAt, r.owedUntil, r.status === "owed" ? r.createdAt : null].filter((d): d is Date => !!d && d > since).sort((a, b) => a.getTime() - b.getTime())[0];
    if (!at) continue;
    const what = l.source === "failed" ? `${l.text.replace(/ · card declined .*$/, "")} (card declined)` : l.text;
    out.push({ text: `${what}: ${owedTail(reservation, false)}`, at });
  }
  for (const e of await db.accountEvent.findMany({ where: { userId: devId, kind: "chargeback-amount", createdAt: { gt: since } }, orderBy: { createdAt: "asc" }, take: 20 })) {
    // (Owner, Nov 4, §192) A change followed after the repayment is settled on its own (refunded or charged): it isn't about this open check.
    if (e.note.includes(": followed after repayment:")) continue;
    // (Owner, Nov 4, §193b) The team's line names the payment's part (or a one payment's items) and its PaymentIntent: this notice names it the same way, from the
    // payment itself, in the developer's own zone: "… of your $35.00 Pay what you owe payment on … (Ana Silva's written answers on “Harbor Run”, …) from …".
    const m = / of the (\$[\d,.]+) .*?\((pi_[^)\s]+|no payment id)\) from (\$[\d,.]+) to (\$[\d,.]+)/.exec(e.note);
    if (!m) continue;
    const paid = m[2].startsWith("pi_") ? await db.payment.findFirst({ where: { developerId: devId, stripePaymentIntentId: m[2], chargeback: { not: "" } }, orderBy: { createdAt: "asc" } }) : null;
    const holds = await import("./holds");
    const named = paid ? await holds.reversedNaming(paid, false, await holds.pageCallDay(devId)) : null;
    const which = paid && named ? paymentWords(paid.amountCents, named.piece, named.one) : `your ${m[1]} payment`;
    out.push({ text: `Your bank changed the disputed amount of ${which} from ${m[3]} to ${m[4]}${reservation ? ": this reservation stays as pressed; the difference is settled when the team approves lifting your hold" : ": this payment stays as pressed"}`, at: e.createdAt });
  }
  return after(out, since);
}

/**
 * (§160) Confirm all: a new charge made while away (it asks the bank) that this one payment doesn't cover. Never added to it: "Ben Okafor charged $10.00 meanwhile:
 * it isn't in this payment; confirm it on its own, or with Confirm all after this one." (owner, Nov 3).
 */
export const notInAllLine = (head: string) => `${head}: it isn't in this payment; confirm it on its own, or with Confirm all after this one`;
async function allChanges(devId: string, since: Date, oneId: string, tab: string, page: unknown) {
  const { inAll } = await import("./confirmAll");
  const fresh = (await db.payment.findMany({ where: { developerId: devId, createdAt: { gt: since }, actionPi: { not: null }, coveredById: null, NOT: { id: oneId } }, orderBy: { createdAt: "asc" } })).filter(inAll);
  const out: Line[] = [];
  for (const p of fresh) out.push({ text: notInAllLine(await meanwhileHead(p)), at: p.createdAt }); // (§177) who, which part, which test
  // (Owner, Nov 4, §171 A3) And everything about each covered charge's tester (its part's pay-press lines, whatever the Alerts ticks), each line once.
  const lines = [...after(out, since)];
  for (const c of await db.payment.findMany({ where: { coveredById: oneId, contractId: { not: null } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }))
    for (const t of await pieceChanges(c, since, tab, page)) if (!lines.includes(t)) lines.push(t);
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
  // (Owner, Nov 4, §172) The team paused this payment's test since the press: its Pause cancelled the open check.
  const t = p.contractId ? (await db.contract.findUnique({ where: { id: p.contractId }, select: { test: { select: { adminPausedAt: true } } } }))?.test : null;
  if (t?.adminPausedAt && t.adminPausedAt >= since) return CANCELLED_WHY.teamPaused;
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
    const { answer: status, canceled } = reservation.stripePaymentIntentId ? await piState(reservation.stripePaymentIntentId) : { answer: "waiting" as const, canceled: false };
    // (§207) Cancelled at Stripe a moment ago and not yet marked in the app (it cancels at Stripe first): read it once it is, then answer as above.
    if (since && canceled) {
      const until = Date.now() + SETTLE_MS;
      let cur = reservation;
      while (cur.status === reservation.status && Date.now() < until) {
        await new Promise((r) => setTimeout(r, SETTLE_STEP_MS));
        cur = (await db.reservation.findUnique({ where: { id: reservation.id } })) ?? cur;
      }
      if (cur.status !== reservation.status) return peekBankCheck(dev, body);
      return { status: "waiting", cancelled: cancelledLine(CANCELLED_WHY.elsewhere) };
    }
    return since ? withChanges(status, await owedChanges(dev.id, since, new Set(reservation.covers), true), reservation.amountCents, true) : { status };
  }
  let p = await db.payment.findUnique({ where: { id: paymentId } });
  if (!p || p.developerId !== dev.id) throw new HttpError(404, "not_found", NOTHING);
  const since = sinceOf(body, p.createdAt);
  // (§207) Let go of a moment ago and still being marked: read it once it is.
  if (since && (await midRelease(p))) p = await settled(p, midRelease);
  // (Owner, Nov 4, §171 B4) This window's own check (its PaymentIntent, `pi`) is no longer the charge's live check: Confirm all took the charge over, a new check
  // replaced it, or it was paid on another one. Complete there charges nothing, and the notice says why.
  const gone = since ? await notThisCheck(p, typeof body.pi === "string" ? body.pi : "") : null;
  if (gone) return { status: "waiting", cancelled: cancelledLine(gone) };
  // (§160) Cancelled underneath the open bank page: said, and the box stays open (Stripe cancelled the check, so Complete charges nothing).
  if (since && endedUnderneath(p)) return { status: "waiting", cancelled: cancelledLine(await whyCancelled(p, dev.id, since)) };
  // Already finished, released or claimed elsewhere: nothing waits; the page's finish gives the server's own answer.
  if (!p.actionPi) return { status: "done" };
  const { answer: status, canceled } = await piState(p.actionPi);
  // (§207) Stripe already shows this check cancelled while the app still holds it: something is ending it right now (it cancels at Stripe first). Read the
  // payment once that has finished: cancelled underneath → the notice, and the window stays open; anything else (paid, a check that replaced it) as usual.
  if (since && canceled) {
    const pi = p.actionPi;
    const after = await settled(p, async (x) => x.actionPi === pi || (await midRelease(x)));
    if (after.actionPi !== pi) return peekBankCheck(dev, body);
    // Still held after the wait (cancelled at Stripe by something the app never recorded): Complete charges nothing; said as ended elsewhere.
    return { status: "waiting", cancelled: cancelledLine(CANCELLED_WHY.elsewhere) };
  }
  if (!since) return { status };
  const once = await import("./owedOnce");
  if (once.isAll(p)) return withChanges(status, await allChanges(dev.id, since, p.id, tab, body.page), p.amountCents);
  if (p.kind === once.OWED_KIND) {
    const covered = new Set((await db.payment.findMany({ where: { coveredById: p.id }, select: { id: true } })).map((x) => x.id));
    return withChanges(status, await owedChanges(dev.id, since, covered), p.amountCents);
  }
  if (p.contractId) return withChanges(status, await pieceChanges(p, since, tab, body.page), p.amountCents);
  return { status }; // a Subscribe or a renewal: only a cancelled check is said
}
