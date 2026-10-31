import { db } from "@/lib/db";
import { displayName, fmtDateTime, money } from "@/lib/format";
import { TESTER_CHOICE_REASONS, stopOnce, type TestEventLike } from "@/lib/rules";
import { rowsOf } from "@/lib/callRows";
import { HttpError } from "./http";
import { keyGivenToYouLine } from "@/lib/keys";
import { KEY_GIVEN } from "./accessKeys";
import { asLines, listingSaveLines, ownChanges, seenOf, tabOf, testerPaymentChanges, withRenamed } from "./live";

// The tester's ONE set of stop-once reasons (owner rule, NEWEST+3), used by every tester button on the session page:
// Switch / Keep, Send written, Send recording, Charge / Let it go, Dispute, Leave, Block, Request a time, Accept /
// Decline / Withdraw, Cancel call. Since the page loaded (or since the live top notice last showed changes):
// (A) new terms; (B) the developer paid or rejected work; (C) the developer's call changes: their requests (new,
// withdrawn, taken by another tester, closed), accepting or auto-matching the tester's own request, declining it,
// cancelling a call; (E) anything the tester did themselves in another tab; (F) the listing's info changed.
// Final refusals (ended early, stopped, Open until passed, already decided, holds) are checked separately and stay final.

/** (Owner, Oct 29, batch 24 section 2) A tester who rates (finishing their part) closes their waiting call requests with this reason. */
export const FINISHED_PART_REASON = "the tester finished their part";
/** Closed because of the tester's own press (their own action, reason E): a different rate, Leave (and a suspension's removal), finishing their part by rating. */
export const CLOSED_BY_TESTER = new Set(["you asked a different rate", "the tester left", FINISHED_PART_REASON]);
/** (Owner, Oct 28, batch 16 section 24) What the stop, a closure or an early end did by itself (requests closed, calls ahead cancelled): never a stop-once
 * reason for what still works afterwards (Charge, Let it go, Dispute, Rate); the stopped line at the top already says it. */
const CLOSED_BY_END = new Set(["the test was stopped", "the session ended", "the test ended"]);
const byTheEnd = (c: { status: string; endedAt: Date | null }, at: Date | null) => c.status === "ended" && !!c.endedAt && !!at && Math.abs(at.getTime() - c.endedAt.getTime()) < 60_000;

export async function testerChanges(testerId: string, contractId: string, testId: string, seenAt: Date, tab = "", termsFrom: Date = seenAt): Promise<TestEventLike[]> {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { test: { include: { developer: true } } } });
  const dev = displayName(c.test.developer);
  // (Design doc 8) The developer added their side to this tester's dispute: a stop-once reason for Dispute and the other buttons.
  const sides = await db.dispute.findMany({ where: { contractId, devSideAt: { gt: seenAt } } });
  const [offers, reviews, calls, devReqs, mine] = await Promise.all([
    // (Owner, reason A) An offer still waiting (or replaced by a newer one) stops the press even when the top box already showed it; one the tester already decided on does not.
    db.termsOffer.findMany({ where: { contractId, createdAt: { gt: termsFrom < seenAt ? termsFrom : seenAt }, status: { in: ["open", "superseded"] } } }),
    db.review.findMany({ where: { contractId, createdAt: { gt: seenAt }, reason: { notIn: TESTER_CHOICE_REASONS } }, include: { submission: true } }),
    db.call.findMany({ where: { contractId, cancelledAt: { gt: seenAt }, cancelledBy: { not: "tester" } } }),
    db.callRequest.findMany({ where: { contractId, fromSide: "developer", updatedAt: { gt: seenAt } } }),
    db.callRequest.findMany({ where: { contractId, fromSide: "tester", status: { in: ["booked", "declined"] }, decidedAt: { gt: seenAt } } }),
  ]);
  const out: TestEventLike[] = [];
  for (const d of sides) out.push({ kind: "dispute", text: `${dev} added their side to your dispute`, createdAt: d.devSideAt! });
  // (Batch 35 §53) The offer is a consequence for a working tester; its fields are the listing's one line ("See it") and the offer box, never a list here.
  for (const o of offers) out.push({ kind: "terms", text: `${dev} offered you the new terms: Switch or Keep below`, createdAt: o.createdAt });
  const owed = await db.payment.findMany({ where: { contractId, status: "failed", owedUntil: { not: null }, settledAt: null }, select: { submissionId: true, callId: true } });
  const owedKeys = new Set(owed.map((p) => p.submissionId ?? p.callId));
  const settledLate = await db.payment.findMany({ where: { contractId, settledAt: { not: null } }, select: { submissionId: true, callId: true } });
  const lateKeys = new Set(settledLate.map((p) => p.submissionId ?? p.callId));
  for (const r of reviews) {
    // Owed (or paid late): the "delayed" line and, when it goes through, the paid line come from the payment.
    if (!r.rejected && (owedKeys.has(r.submissionId ?? r.callId) || lateKeys.has(r.submissionId ?? r.callId))) continue;
    const what = r.callId ? "your live call" : `your ${r.submission?.kind === "recording" ? "recording" : "written answers"}`;
    // (Batch 30 §5) The team's $0 closure is the team's, never the developer's.
    out.push({ kind: r.rejected ? "rejected" : "paid", text: r.rejected ? `${dev} rejected ${what}` : r.teamClosedById ? `The team closed ${what} for $0` : `${dev} paid ${money(r.amountCents)} for ${what}`, createdAt: r.createdAt });
  }
  // (Owner, Oct 28, batch 20 section 12, bug found by the owner) A Pay more (Payment kind "extra") is a "paid" change too: before, only Reviews were read, so a Pay
  // more never stopped a tester press (a Cancel call went straight through) nor showed in the stop box or the live box. Charged (or charged before payouts are set up).
  const kinds = new Map((await db.submission.findMany({ where: { contractId }, select: { id: true, kind: true } })).map((x) => [x.id, x.kind]));
  for (const p of await db.payment.findMany({ where: { contractId, kind: "extra", createdAt: { gt: seenAt }, status: { in: ["charged", "not_set_up"] } }, orderBy: { createdAt: "asc" } })) {
    out.push({ kind: "paid", text: payMoreLine(dev, p.amountCents, p.callId ? "live call" : kinds.get(p.submissionId ?? "") === "recording" ? "recording" : "written answers"), createdAt: p.createdAt });
  }
  for (const r of devReqs) {
    const when = fmtDateTime(r.startsAt);
    const what = requestWords(r, when);
    if (r.status === "pending" && r.createdAt > seenAt) out.push({ kind: "requested", text: `${dev} requested ${what}`, createdAt: r.createdAt });
    else if (r.status === "withdrawn") out.push({ kind: "requested", text: `${dev} withdrew the request for ${what}`, createdAt: r.updatedAt });
    else if (r.status === "taken") out.push({ kind: "requested", text: `The call time ${when} is no longer available: another tester took it`, createdAt: r.updatedAt });
    else if (r.status === "closed" && !CLOSED_BY_TESTER.has(r.closedReason) && !CLOSED_BY_END.has(r.closedReason)) out.push({ kind: "requested", text: `The call time ${when} is no longer available`, createdAt: r.updatedAt });
    // booked / declined by the tester themselves: their own action (reason E)
  }
  for (const r of mine) {
    const when = fmtDateTime(r.startsAt);
    if (r.status === "declined") out.push({ kind: "requested", text: `${dev} declined your call request for ${when}`, createdAt: r.decidedAt! });
    else if (r.closedReason === "matched") out.push({ kind: "booked", text: `Booked: ${dev} asked for the same time, ${when}`, createdAt: r.decidedAt! });
    else out.push({ kind: "booked", text: `${dev} accepted your call request: ${rowsOf(r).length === 1 && rowsOf(r)[0].repeat !== "once" ? requestWords(r, when) : when}`, createdAt: r.decidedAt! });
  }
  for (const call of calls.filter((x) => !(x.cancelledBy === "system" && byTheEnd(c, x.cancelledAt)))) out.push({ kind: "cancelled", text: `Your call on ${fmtDateTime(call.startsAt)} was cancelled`, createdAt: call.cancelledAt! });
  // (Owner, Oct 30, batch 15 section 45) The developer marked this tester's key as working: a change to their contract (it stops even with Alerts Off; no bell).
  const fixed = await db.accessKey.findFirst({ where: { contractId, fixedAt: { gt: seenAt }, status: "inuse" } });
  if (fixed) out.push({ kind: "keyfixed", text: `The developer marked your key as working (${fixed.value})`, createdAt: fixed.fixedAt! });
  // (Batch 30 §17) The developer's Save gave this tester a key (the test had none when they joined): "<dev> gave you an access key for “<test>”" (the key is in its box).
  for (const e of await db.testEvent.findMany({ where: { testId, kind: KEY_GIVEN, contractId, createdAt: { gt: seenAt } } })) out.push({ kind: "keygiven", text: keyGivenToYouLine(dev, c.test.title), createdAt: e.createdAt });
  // (F) the listing's info (title, description, devices, languages) changed: (batch 30 §10) one line per save.
  out.push(...(await listingSaveLines(testId, seenAt, testerId, "session")));
  out.push(...(await testerPaymentChanges(testerId, contractId, seenAt)));
  out.push(...(await ownChanges(testerId, testId, seenAt, tab)));
  return out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** (Batch 20 section 12) "Nora Lane paid you $5.00 more for your written answers". */
export const payMoreLine = (dev: string, cents: number, part: string) => `${dev} paid you ${money(cents)} more for your ${part}`;

/** (Batch 15 sections 26 and 45) Changes to the tester's own contract: they stop a press even with Alerts Off. */
export const CONTRACT_KINDS = new Set(["terms", "keyfixed"]);

const KINDS = ["terms", "paid", "rejected", "cancelled", "booked", "requested", "info", "payment", "admin", "own", "dispute"];
/**
 * (Owner, Oct 28, batch 16 section 38B) The call changes a tester sees (the developer's requests, withdrawn or taken, their own request accepted or declined, a call
 * cancelled). They stop every tester press once even after the live box or a refresh of the page showed them: counted from when the page loaded in this tab
 * (`loadedAt`), or from the newest change a stop box there already listed (`boxSeenAt`).
 */
export const TESTER_CALL_KINDS = new Set(["requested", "booked", "cancelled"]);

/** The one tester gate: the first press stops (the box shows under that button); the second goes ahead. */
export async function testerGate(testerId: string, contractId: string, testId: string, body: Record<string, unknown>, tail = "Press again to go ahead.", opts: { skipTerms?: boolean; keep?: (e: TestEventLike) => boolean } = {}) {
  // (Owner, Oct 29, batch 29 section 11; replaces batch 16 section 25) A stopped, closed or paused test, or a tester whose work ended: every press still allowed follows
  // these same stop-once rules (Rate has its own short list; Leave and Block never stop).
  // (Owner) The second press goes ahead only if nothing new happened since the box last updated (boxAt); Leave and
  // Block send no boxAt, so they still stop just once.
  const boxAt = seenOf(body.boxAt);
  if (body.confirmed === true && !boxAt) return;
  const seenAt = body.confirmed === true ? boxAt : seenOf(body.seenAt);
  if (!seenAt) return;
  // New terms count from the page's own render (pageSeenAt), or from the box's time on a second press; everything else from `seenAt`.
  const termsFrom = body.confirmed === true ? seenAt : seenOf(body.pageSeenAt) ?? seenAt;
  const loadedAt = body.confirmed === true ? null : seenOf(body.loadedAt);
  const boxSeen = seenOf(body.boxSeenAt);
  const fromBox = boxSeen && loadedAt && boxSeen > loadedAt ? boxSeen : loadedAt;
  const callsFrom = fromBox && fromBox < seenAt ? fromBox : seenAt;
  const raw0 = await testerChanges(testerId, contractId, testId, callsFrom, tabOf(body), termsFrom);
  // Everything but the call changes still counts from `seenAt` (the later of the page's render and what the live box showed).
  const raw = raw0.filter((e) => e.kind === "terms" || (TESTER_CALL_KINDS.has(e.kind) ? e.createdAt > callsFrom : e.createdAt > seenAt));
  // (Owner, Oct 28) `keep`: a button that stops for only some kinds (Rate after the test closed).
  const all = withRenamed(opts.keep ? raw.filter((e) => e.kind === "renamed" || opts.keep!(e)) : raw, body);
  const changes = all.filter((e) => (e.kind === "terms" ? !opts.skipTerms && e.createdAt > termsFrom : true));
  const terms = changes.filter((e) => e.kind === "terms");
  const r = stopOnce(changes.filter((e) => e.kind !== "terms"), callsFrom, false, [...KINDS, "renamed", "keyfixed", "keygiven"]);
  // (Owner, Oct 30, batch 15 section 26) Alerts Off: only changes to the tester's own contract stop (a new terms offer, their key marked working).
  const off = (await db.user.findUnique({ where: { id: testerId }, select: { testerAlertsOff: true } }))?.testerAlertsOff;
  const rest = r.go ? [] : off ? r.changes.filter((e) => CONTRACT_KINDS.has(e.kind)) : r.changes;
  const list = [...terms, ...rest].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  // (Batch 17 section 13) `alertsOff`: the box drops "Turn off alerts" and "You can turn these stops off below" when Alerts is already Off.
  if (list.length) throw new HttpError(409, "stop_once", tail, { changes: asLines(list), tail, top: terms.length > 0, alertsOff: !!off });
}

/** "weekly calls from Thu, Nov 5, 3:00 PM" / "a call (pick one of 3 times)" / "a call for Thu, Nov 5, 3:00 PM". */
function requestWords(r: { rows?: unknown; times: Date[]; startsAt: Date; weeks: number; repeat: string }, when: string) {
  const rows = rowsOf(r);
  if (rows.length > 1) return `a call (pick one of ${rows.length} times)`;
  const x = rows[0];
  return x.repeat === "once" ? `a call for ${when}` : `${x.repeat === "daily" ? "daily" : "weekly"} calls from ${when}${x.count ? "" : " (until cancelled)"}`;
}
