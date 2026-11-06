import { db } from "@/lib/db";
import { displayName, fmtDateTime, money, pronouns } from "@/lib/server/dateFormat";
import { TESTER_CHOICE_REASONS, partWhen, stopOnce, type TestEventLike } from "@/lib/rules";
import { rowsOf } from "@/lib/callRows";
import { HttpError } from "./http";
import { keyGivenToYouLine } from "@/lib/keys";
import { TERMS_OFFER_BOX, TESTER_REQUESTS_BOX, callRow, ownLink, requestRow, testerPartRow } from "@/lib/lineAnchors";
import { KEY_GIVEN } from "./accessKeys";
import { DROP_KINDS, isDropReason } from "@/lib/requestDrop";
import { notListed, shownIdsOf, wasListed } from "./shownLines";
import { LISTING_SAVED, parseSaved } from "@/lib/listingPanel";
import { questionChangeTexts } from "@/lib/questionHistory";
import { NDA_NOTICE, ndaChangedLine } from "@/lib/ndaNotice";
import { loadedOf, testerPauseMoments } from "./stopMoment";
import { unanswered, answersIt, asLines, listingSaveLines, ownChanges, type Answers, seenOf, tabOf, testerPaymentChanges, withRenamed } from "./live";

// The tester's ONE set of stop-once reasons (owner rule, NEWEST+3), used by every tester button on the session page:
// Switch / Keep, Send written, Send recording, Charge / Let it go, Dispute, Leave, Block, Request a time, Accept /
// Decline / Withdraw, Cancel call. Since the page loaded (or since the live top notice last showed changes):
// (A) new terms; (B) the developer paid or rejected work; (C) the developer's call changes: their requests (new,
// withdrawn, taken by another tester, closed), accepting or auto-matching the tester's own request, declining it,
// cancelling a call; (E) anything the tester did themselves in another tab; (F) the listing's info changed.
// Final refusals (ended early, stopped, Open until passed, already decided, holds) are checked separately and stay final.

/** (Owner, Oct 29, batch 24 section 2) A tester who rates (finishing their part) closes their waiting call requests with this reason. */
export const FINISHED_PART_REASON = "the tester finished their part";
/** (Batch 35 §162) The stored reason as a row shows it, in the tester's recorded pronoun ("the tester finished her part"). */
export const finishedPartReason = (pronoun?: string | null) => `the tester finished ${pronouns(pronoun).poss} part`;
/** Closed because of the tester's own press (their own action, reason E): a different rate, Leave (and a suspension's removal), finishing their part by rating. */
export const CLOSED_BY_TESTER = new Set(["you asked a different rate", "the tester left", FINISHED_PART_REASON]);
/** (Owner, Oct 28, batch 16 section 24) What the stop, a closure or an early end did by itself (requests closed, calls ahead cancelled): never a stop-once
 * reason for what still works afterwards (Charge, Let it go, Dispute, Rate); the stopped line at the top already says it. */
const CLOSED_BY_END = new Set(["the test was stopped", "the session ended", "the test ended"]);
/**
 * (Owner, Nov 6, §286) Whether the developer's request closed for this reason is a line in the tester's top box ("The call time with Nora Lane on … is no longer
 * available"): never one her own press closed (CLOSED_BY_TESTER), one the stop, a closure or an early end closed (its own line says it), nor one a booking dropped
 * (§184's own line). Such a closure rings her bell too (closeRequests).
 */
export const testerSeesClosed = (reason: string) => !CLOSED_BY_TESTER.has(reason) && !CLOSED_BY_END.has(reason) && !isDropReason(reason);
const byTheEnd = (c: { status: string; endedAt: Date | null }, at: Date | null) => c.status === "ended" && !!c.endedAt && !!at && Math.abs(at.getTime() - c.endedAt.getTime()) < 60_000;

export async function testerChanges(testerId: string, contractId: string, testId: string, seenAt: Date, tab = "", termsFrom: Date = seenAt): Promise<TestEventLike[]> {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { test: { include: { developer: true } } } });
  const dev = displayName(c.test.developer);
  // (Design doc 8) The developer added their side to this tester's dispute: a stop-once reason for Dispute and the other buttons.
  const sides = await db.dispute.findMany({ where: { contractId, devSideAt: { gt: seenAt } }, include: { submission: { select: { kind: true } }, call: { select: { startsAt: true } } } });
  const [offers, reviews, calls, devReqs, mine] = await Promise.all([
    // (Owner, reason A) An offer still waiting (or replaced by a newer one) stops the press even when the top box already showed it; one the tester already decided on does not.
    db.termsOffer.findMany({ where: { contractId, createdAt: { gt: termsFrom < seenAt ? termsFrom : seenAt }, status: { in: ["open", "superseded"] } } }),
    db.review.findMany({ where: { contractId, createdAt: { gt: seenAt }, reason: { notIn: TESTER_CHOICE_REASONS } }, include: { submission: true, call: { select: { startsAt: true } } } }),
    db.call.findMany({ where: { contractId, cancelledAt: { gt: seenAt }, cancelledBy: { not: "tester" } } }),
    db.callRequest.findMany({ where: { contractId, fromSide: "developer", updatedAt: { gt: seenAt } } }),
    db.callRequest.findMany({ where: { contractId, fromSide: "tester", status: { in: ["booked", "declined"] }, decidedAt: { gt: seenAt } } }),
  ]);
  const out: TestEventLike[] = [];
  // (Owner, Nov 6, §284) Each line carries the place on the session page it is about (`link`): the top box opens it, ignored (greyed) lines too. These lines are
  // built from the rows themselves at read time, so older changes get their place the same way.
  for (const d of sides) out.push({ kind: "dispute", text: devSideLine(dev, c.test.developer.pronoun, d.call ? fmtDateTime(d.call.startsAt) : null, d.submission?.kind), createdAt: d.devSideAt!, link: testerPartRow({ kind: d.submission?.kind, callId: d.callId }) });
  // (Batch 35 §53) The offer is a consequence for a working tester; its fields are the listing's one line ("See it") and the offer box, never a list here.
  // (Owner, Nov 6, §304b) No "below": in a stop box under Leave (and other buttons) the Switch / Keep box is ABOVE the line, so the wording names no position
  // (the same line in the stop boxes and the top box; the bell has its own "<dev> updated the listing: …").
  for (const o of offers) out.push({ kind: "terms", text: `${dev} offered you new terms: Switch or Keep them`, createdAt: o.createdAt, item: o.id, link: TERMS_OFFER_BOX });
  const owed = await db.payment.findMany({ where: { contractId, status: "failed", owedUntil: { not: null }, settledAt: null }, select: { submissionId: true, callId: true } });
  const owedKeys = new Set(owed.map((p) => p.submissionId ?? p.callId));
  const settledLate = await db.payment.findMany({ where: { contractId, settledAt: { not: null } }, select: { submissionId: true, callId: true } });
  const lateKeys = new Set(settledLate.map((p) => p.submissionId ?? p.callId));
  for (const r of reviews) {
    // Owed (or paid late): the "delayed" line and, when it goes through, the paid line come from the payment.
    if (!r.rejected && (owedKeys.has(r.submissionId ?? r.callId) || lateKeys.has(r.submissionId ?? r.callId))) continue;
    // (Owner, Nov 4, §177) Which call: "Nora Lane paid $15.00 for your live call on Tue, Oct 27, 8:00 AM".
    const what = r.callId ? `your ${partWhen("live call", r.call ? fmtDateTime(r.call.startsAt) : null)}` : `your ${r.submission?.kind === "recording" ? "recording" : "written answers"}`;
    // (Batch 30 §5) The team's $0 closure is the team's, never the developer's.
    out.push({ kind: r.rejected ? "rejected" : "paid", text: r.rejected ? `${dev} rejected ${what}` : r.teamClosedById ? `The team closed ${what} for $0` : `${dev} paid ${money(r.amountCents)} for ${what}`, createdAt: r.createdAt, piece: (r.submissionId ?? r.callId) || undefined, link: testerPartRow({ kind: r.submission?.kind, callId: r.callId }) });
  }
  // (Owner, Oct 28, batch 20 section 12, bug found by the owner) A Pay more (Payment kind "extra") is a "paid" change too: before, only Reviews were read, so a Pay
  // more never stopped a tester press (a Cancel call went straight through) nor showed in the stop box or the live box. Charged (or charged before payouts are set up).
  const kinds = new Map((await db.submission.findMany({ where: { contractId }, select: { id: true, kind: true } })).map((x) => [x.id, x.kind]));
  const starts = new Map((await db.call.findMany({ where: { contractId }, select: { id: true, startsAt: true } })).map((x) => [x.id, x.startsAt]));
  for (const p of await db.payment.findMany({ where: { contractId, kind: "extra", createdAt: { gt: seenAt }, status: { in: ["charged", "not_set_up"] } }, orderBy: { createdAt: "asc" } })) {
    // (§177) A Pay more on a call names it: "Nora Lane paid you $5.00 more for your live call on Tue, Oct 27, 8:00 AM".
    const at = p.callId ? starts.get(p.callId) : undefined;
    out.push({ kind: "paid", text: payMoreLine(dev, p.amountCents, p.callId ? partWhen("live call", at ? fmtDateTime(at) : null) : kinds.get(p.submissionId ?? "") === "recording" ? "recording" : "written answers"), createdAt: p.createdAt, piece: (p.submissionId ?? p.callId) || undefined, link: testerPartRow({ kind: kinds.get(p.submissionId ?? ""), callId: p.callId }) });
  }
  for (const r of devReqs) {
    const when = fmtDateTime(r.startsAt);
    const what = requestWords(r, when);
    // (§284) The request's row in her Call requests box; once it has left (withdrawn, taken, closed), the box (lineFallbacks).
    const link = requestRow(r.id);
    if (r.status === "pending" && r.createdAt > seenAt) out.push({ kind: "requested", text: `${dev} requested ${what}`, createdAt: r.createdAt, item: r.id, link });
    // (Owner, Nov 4, §185) The developer withdrawing their request is a quiet live-box line, never a stop (whatever her Alerts); answering it is one refusal
    // ("Nora Lane withdrew this request."). The quiet kind is §184's (the live box marks it quiet; no tester press stops for it).
    else if (r.status === "withdrawn") out.push({ kind: DROP_KINDS.devQuiet, text: `${dev} withdrew the request for ${what}`, createdAt: r.updatedAt, link });
    else if (r.status === "taken") out.push({ kind: "requested", text: `The call time with ${dev} on ${when} is no longer available: another tester took it`, createdAt: r.updatedAt, link });
    // (Owner, Nov 4, §184) One dropped when a call was booked has its own line (below), never this one too.
    else if (r.status === "closed" && testerSeesClosed(r.closedReason)) out.push({ kind: "requested", text: `The call time with ${dev} on ${when} is no longer available`, createdAt: r.updatedAt, link });
    // booked / declined by the tester themselves: their own action (reason E)
  }
  for (const r of mine) {
    const when = fmtDateTime(r.startsAt);
    // (§284) Declined: her request's row (or the box once it has left); booked: the call's row.
    const link = r.status !== "declined" && r.callId ? callRow(r.callId) : requestRow(r.id);
    if (r.status === "declined") out.push({ kind: "requested", text: `${dev} declined your call request for ${when}`, createdAt: r.decidedAt!, link });
    else if (r.closedReason === "matched") out.push({ kind: "booked", text: `Booked: ${dev} asked for the same time, ${when}`, createdAt: r.decidedAt!, link });
    else out.push({ kind: "booked", text: `${dev} accepted your call request: ${rowsOf(r).length === 1 && rowsOf(r)[0].repeat !== "once" ? requestWords(r, when) : when}`, createdAt: r.decidedAt!, link });
  }
  // (Owner, Nov 4, §184) A request of this session dropped (or a time taken out of it) when a call was booked: "Nora Lane's request for … closed: she is no longer
  // free at that time" (a call change, ordinary Alerts); the tester's own (her booking, or the one she was told about) is a quiet live-box line ("… closed: you
  // have another call at that time"), never a stop.
  for (const e of await db.testEvent.findMany({ where: { testId, contractId, kind: { in: [DROP_KINDS.testerClosed, DROP_KINDS.testerQuiet] }, createdAt: { gt: seenAt } }, orderBy: { createdAt: "asc" } }))
    // (Owner, Nov 4, §185) Both quiet now: the developer's side of it ("Nora Lane's request for … closed: she is no longer free") comes with a bell instead.
    out.push({ kind: DROP_KINDS.devQuiet, text: e.text, createdAt: e.createdAt, link: e.link || TESTER_REQUESTS_BOX });
  for (const call of calls.filter((x) => !(x.cancelledBy === "system" && byTheEnd(c, x.cancelledAt)))) out.push({ kind: "cancelled", text: `Your call with ${dev} on ${fmtDateTime(call.startsAt)} was cancelled`, createdAt: call.cancelledAt!, link: callRow(call.id) });
  // (Owner, Nov 6, §304) No "<dev> marked your key as working" line any more: there is no key report to answer.
  // (Batch 30 §17) The developer's Save gave this tester a key (the test had none when they joined): "<dev> gave you an access key for “<test>”" (the key is in its box).
  for (const e of await db.testEvent.findMany({ where: { testId, kind: KEY_GIVEN, contractId, createdAt: { gt: seenAt } } })) out.push({ kind: "keygiven", text: keyGivenToYouLine(dev, c.test.title), createdAt: e.createdAt });
  // (Owner, Nov 5, §267) The NDA changed (its own notice): an ordinary line (Alerts on, not yet shown), apart from the block it makes.
  // (Owner, Nov 6, §302) "<developer> changed the NDA" whatever the kind, linking to the notice (its Acknowledge button).
  if (c.ndaChangedAt && c.ndaChangedAt > seenAt) out.push({ kind: "nda", text: ndaChangedLine(dev), createdAt: c.ndaChangedAt, link: NDA_NOTICE });
  // (F) the listing's info (title, description, devices, languages) changed: (batch 30 §10) one line per save.
  out.push(...(await listingSaveLines(testId, seenAt, testerId, "session")));
  out.push(...(await testerPaymentChanges(testerId, contractId, seenAt)));
  // (§284) Her own action in another tab opens what it touched (a request, a call, a part).
  out.push(...(await ownChanges(testerId, testId, seenAt, tab)).map((o) => { const link = ownLink(o.about?.k, (s) => testerPartRow({ kind: kinds.get(s) })); return link ? { ...o, link } : o; }));
  return out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * (Owner, Nov 5, §269) What changed in the test's questions since `since` (every listing Save after it that changed them), one line per question in the stop
 * lines' words (questionChangeTexts: removed, added, a Required tick), at that Save's time. Never a reorder (a reorder-only Save records no questions change).
 * The questions follow the listing (§265), so these are the tester's own questions' changes. `since` null: every change.
 */
export async function questionChangeLines(testId: string, since: Date | null, dev: string): Promise<TestEventLike[]> {
  const rows = await db.testEvent.findMany({ where: { testId, kind: LISTING_SAVED, ...(since ? { createdAt: { gt: since } } : {}) }, orderBy: { createdAt: "asc" } });
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((q): q is string => typeof q === "string") : []);
  return rows.flatMap((e) => {
    const v = parseSaved(e.text);
    if (!v?.fields.includes("questions")) return [];
    return questionChangeTexts(dev, list(v.before.questions), list(v.after.questions)).map((text) => ({ kind: "info", text, createdAt: e.createdAt, listing: true, keys: ["questions"] }));
  });
}
/** (§269) A question-change line (questionChangeLines), apart from the listing's own "edited the listing" line. */
const isQuestionLine = (e: TestEventLike) => e.kind === "info" && !!e.listing && e.key !== "listing" && !!e.keys?.includes("questions");

/** (Design doc 8) "Nora Lane added her side to your dispute about your live call on …" (the top box's line; §286: the bell's, with the call's time as a token). */
export const devSideLine = (dev: string, pronoun: string | null | undefined, callWhen: string | null, kind?: string | null) =>
  `${dev} added ${pronouns(pronoun).poss} side to your dispute about ${callWhen ? `your live call on ${callWhen}` : `your ${kind === "recording" ? "recording" : "written answers"}`}`;

/** (Batch 20 section 12) "Nora Lane paid you $5.00 more for your written answers". */
export const payMoreLine = (dev: string, cents: number, part: string) => `${dev} paid you ${money(cents)} more for your ${part}`;

/** (Batch 15 sections 26 and 45) Changes to the tester's own contract: they stop a press even with Alerts Off. (Owner, Nov 6, §304) No keyfixed kind: a key is never
 * marked as working any more. */
export const CONTRACT_KINDS = new Set(["terms"]);
/** (Owner, Oct 31, batch 35 §61) What stops a tester's press even with Alerts Off: changes to their contract and what they did themselves in another tab ("own",
 * like the developer's own other-tab actions, batch 29 §12). Never an Alerts-ignorable kind. */
export const ALERTS_OFF_KINDS = new Set([...CONTRACT_KINDS, "own"]);

/** (§159 rule 4) What stops Charge / Let it go on `piece` whatever the tester's Alerts: a payment on that very part ("paid": Pay, Pay more, an automatic call charge,
 * the team's $0 closure, a delayed payment going through) or the team's decision on any of their disputes in this test (lines about other tests carry no `piece`). */
export const owedChange = (e: TestEventLike, piece: string) => (e.kind === "paid" && e.piece === piece) || (e.kind === "admin" && !!e.piece);
/**
 * (Owner, Nov 4, §171 A2) The team's decision on one of her disputes on this test ("admin" lines here are only those: they carry the part), or the developer adding
 * their side to it ("dispute"): it stops EVERY press of hers on the test once, whatever her Alerts (Send, Add to this answer, a recording's add, Charge, Let it go,
 * Dispute, Leave, call requests, Rate). Excerpt requests keep their own rules (their own route).
 */
export const disputeChange = (e: TestEventLike) => e.kind === "dispute" || (e.kind === "admin" && !!e.piece);

// (Owner, Nov 5, §267) "nda": the NDA changed (its own notice), an ordinary kind (Alerts on).
const KINDS = ["terms", "paid", "rejected", "cancelled", "booked", "requested", "info", "payment", "admin", "own", "dispute", "nda"];
/**
 * (Owner, Oct 28, batch 16 section 38B) The call changes a tester sees (the developer's requests, withdrawn or taken, their own request accepted or declined, a call
 * cancelled). They stop every tester press once even after the live box or a refresh of the page showed them: counted from when the page loaded in this tab
 * (`loadedAt`), or from the newest change a stop box there already listed (`boxSeenAt`).
 */
export const TESTER_CALL_KINDS = new Set(["requested", "booked", "cancelled"]);

/** The one tester gate: the first press stops (the box shows under that button); the second goes ahead. */
export async function testerGate(testerId: string, contractId: string, testId: string, body: Record<string, unknown>, tail = "Press again to go ahead.", opts: { skipTerms?: boolean; keep?: (e: TestEventLike) => boolean; piece?: string; /** (Batch 35 §79) what the press answers */ answers?: Answers; /** (§93) Stop/pause moments: always stop, in the same box as the shared lines. */ moments?: TestEventLike[];
  /** (§159 rule 4) Charge / Let it go on this piece (submission or call id): a developer payment on it, or the team's decision on any of the tester's disputes. */ owedPiece?: string;
  /** (Owner, Nov 4, §183) Send / Add to this answer / a recording's add on this sent part (its submission id): a developer payment on it always stops once. */ sendPiece?: string;
  /** (Owner, Nov 5, §268; replaces §232's open-terms stop) Rate and Leave: new terms (and an NDA change) follow the ordinary rule: they stop once only with Alerts
   * on, and only when the change came before what the live pill showed (seen counts, §90). */ ordinaryTerms?: boolean;
  /** (Owner, Nov 5, §269) Send Answers / Add to this answer: a questions change the page hasn't shown (the ordinary rule) is listed question by question. */ questionLines?: boolean;
  /** (§269) The press holds questions the contract no longer has (or lacks a new one): these lines (what changed) always stop it, whatever the Alerts, a
   * confirmed press, a seen time or a box that listed them: the server never takes answers keyed to the old questions. The page then takes the new questions. */
  staleQuestions?: TestEventLike[] } = {}) {
  // (Owner, Oct 29, batch 29 section 11; replaces batch 16 section 25) A stopped, closed or paused test, or a tester whose work ended: every press still allowed follows
  // these same stop-once rules (Block never stops; batch 35 §59: Leave stops like the rest).
  // (Owner) The second press goes ahead only if nothing new happened since the box last updated (boxAt); Leave and
  // Block send no boxAt, so they still stop just once.
  const boxAt = seenOf(body.boxAt);
  // (§269) A stale page's questions: the stop is never skipped (its box tells the page to take the new questions, `questions`).
  const stale = (opts.staleQuestions ?? []).map((e) => ({ ...e, forced: true }));
  const staleStop = async () => new HttpError(409, "stop_once", tail, { changes: asLines(stale), tail, top: false, questions: true,
    alertsOff: !!(await db.user.findUnique({ where: { id: testerId }, select: { testerAlertsOff: true } }))?.testerAlertsOff });
  if (body.confirmed === true && !boxAt) { if (stale.length) throw await staleStop(); return; }
  const seenAt = body.confirmed === true ? boxAt : seenOf(body.seenAt);
  if (!seenAt) { if (stale.length) throw await staleStop(); return; }
  // (Owner, Nov 5, §271) A pause since the page loaded (the team's, the developer's hold or suspension: she reads only "This test was paused at 3:10 PM.") and the
  // team's lift of it ("This test resumed at 3:10 PM.") stop EVERY press that comes through here once, whatever her Alerts, like a stop moment. Counted from the
  // page's load (or the stop box's time on a second press, loadedOf); one a stop box on this page already listed (any button's, `shownIds`) never stops again.
  // A press refused while paused (Send, Request a time, Accept, Join call, Rate on a team pause) gets only its refusal: those refusals come before this gate.
  const pauses = await testerPauseMoments(contractId, loadedOf(body));
  // New terms count from the page's own render (pageSeenAt), or from the box's time on a second press; everything else from `seenAt`.
  const termsFrom = body.confirmed === true || opts.ordinaryTerms ? seenAt : seenOf(body.pageSeenAt) ?? seenAt;
  const loadedAt = body.confirmed === true ? null : seenOf(body.loadedAt);
  const boxSeen = seenOf(body.boxSeenAt);
  const fromBox = boxSeen && loadedAt && boxSeen > loadedAt ? boxSeen : loadedAt;
  const callsFrom = fromBox && fromBox < seenAt ? fromBox : seenAt;
  const raw0 = await testerChanges(testerId, contractId, testId, callsFrom, tabOf(body), termsFrom);
  // (Owner, Nov 4, §183) The developer's $0 answer to what the tester added after a Pay is a payment on that part too (it has no line elsewhere: only this press reads it).
  if (opts.sendPiece) raw0.push(...(await zeroUpdateLines(opts.sendPiece, callsFrom)));
  // (Owner, Nov 5, §269) Send / Add: what changed in the questions, one line each (ordinary lines, Alerts on, not yet shown). A stale page's are its own lines
  // (`stale`, below). A box that already listed the listing's own line for these Saves showed them: their question lines don't stop again.
  if (opts.questionLines && !stale.length) {
    const listingLine = raw0.find((e) => e.key === "listing" && e.listing);
    const shown = listingLine && wasListed(listingLine, shownIdsOf(body)) ? listingLine.createdAt : null;
    const dev = displayName((await db.contract.findUniqueOrThrow({ where: { id: contractId }, select: { test: { select: { developer: true } } } })).test.developer);
    raw0.push(...(await questionChangeLines(testId, seenAt, dev)).filter((e) => !shown || e.createdAt > shown));
  }
  // Everything but the call changes still counts from `seenAt` (the later of the page's render and what the live box showed).
  const raw = raw0.filter((e) => e.kind === "terms" || (TESTER_CALL_KINDS.has(e.kind) ? e.createdAt > callsFrom : e.createdAt > seenAt));
  // (Owner, Oct 28) `keep`: a button that stops for only some kinds (Rate after the test closed).
  const all = withRenamed(opts.keep ? raw.filter((e) => e.kind === "renamed" || opts.keep!(e)) : raw, body);
  const changes = all.filter((e) => (e.kind === "terms" ? !opts.skipTerms && e.createdAt > termsFrom : true));
  const terms = changes.filter((e) => e.kind === "terms");
  const r = stopOnce(changes.filter((e) => e.kind !== "terms"), callsFrom, false, [...KINDS, "renamed", "keygiven"]);
  // (Owner, Oct 30, batch 15 section 26) Alerts Off: only changes to the tester's own contract stop (a new terms offer; (§304) no key line any more), and (batch 35 §61)
  // what they did themselves in another tab. (Owner, Oct 31, batch 35 §68) `piece` (the Dispute press): a payment on that piece since the page loaded (Pay, Pay more,
  // a dispute decision, a Charge) changes what's disputed, so it stops once even with Alerts Off, like new terms.
  const off = (await db.user.findUnique({ where: { id: testerId }, select: { testerAlertsOff: true } }))?.testerAlertsOff;
  // (Owner, Nov 4, §183) Send, Add to this answer and a recording's add on a part already sent (`sendPiece`) stop once, whatever the tester's Alerts, for a
  // developer payment on THAT part since the page loaded (Pay, Pay more, a team dispute decision's charge, the developer's $0 answer to an update, a delayed payment
  // going through): "Your new payment can change whether they still want to add anything" (the developer side's "anything on the same part always stops", §171 A1).
  // It reuses §68's piece rule. Payments on their other parts keep following their Alerts.
  const piece = opts.piece ?? opts.sendPiece;
  // (Owner, Nov 3, batch 35 §159 rule 4) Charge / Let it go (`owedPiece`): a developer payment on THAT part (Pay, Pay more, an automatic call charge) and the team's
  // decision on ANY of this tester's disputes change what they're owed: one the page hasn't shown stops the press once even with Alerts Off. A payment on their
  // other parts follows their Alerts as before.
  const rest = r.go ? [] : off ? r.changes.filter((e) => ALERTS_OFF_KINDS.has(e.kind) || disputeChange(e) || (!!piece && e.piece === piece) || (!!opts.owedPiece && owedChange(e, opts.owedPiece))) : r.changes;
  // (§268) Rate and Leave with Alerts Off: an offer never stops them (it's an ordinary line for them).
  const termsShown = off && opts.ordinaryTerms ? [] : terms;
  // (Batch 35 §79) Never the line about the very thing this press answers (Accept on the developer's call request that just arrived).
  // (Owner, Nov 5, §250) Nor a line a stop box on this page already LISTED (any button's box: `shownIds`), forced lines and stop / pause moments included.
  const list = [...withRenamed(notListed((await unanswered(testerId, testId, [...termsShown, ...rest, ...(opts.moments ?? []).filter((e) => e.createdAt > seenAt), ...pauses])).filter((e) => !answersIt(e, opts.answers)), body), body), ...stale].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  // (Batch 17 section 13) `alertsOff`: the box drops "Turn off alerts" and "You can turn these stops off below" when Alerts is already Off.
  // (Owner, Nov 3, §160) Each line says whether the tester's Alerts could have switched it off (`forced`): new terms, their own other-tab
  // actions, a stop or pause, and the piece rules (Dispute's payment on that piece; Charge / Let it go's payment on that part and any team decision) always stop.
  // (§171 A2) And the team's decision on her dispute, or the developer's side added to it, on every press.
  const forced = (e: TestEventLike) => (ALERTS_OFF_KINDS.has(e.kind) && !(opts.ordinaryTerms && e.kind === "terms")) || e.kind === "stop" || disputeChange(e) || (!!piece && e.piece === piece) || (!!opts.owedPiece && owedChange(e, opts.owedPiece));
  // (§269) `questions`: the box lists a questions change, so the page redraws and its form takes the new questions in place (typed text kept by words).
  if (list.length) throw new HttpError(409, "stop_once", tail, { changes: asLines(list.map((e) => (forced(e) ? { ...e, forced: true } : e))), tail, top: termsShown.some((t) => list.includes(t)) /* (§250) a listed offer line no longer sends the page up */, alertsOff: !!off, ...(stale.length || list.some(isQuestionLine) ? { questions: true } : {}) });
}

/** (Owner, Nov 4, §183) "Nora Lane paid $0 more for what you added to your written answers" (the bell's words), when she closed the tester's update at $0 since `since`. */
async function zeroUpdateLines(submissionId: string, since: Date): Promise<TestEventLike[]> {
  const s = await db.submission.findUnique({ where: { id: submissionId }, select: { id: true, kind: true, paidUpdateZeroAt: true, contract: { select: { test: { select: { developer: true } } } } } });
  if (!s?.paidUpdateZeroAt || s.paidUpdateZeroAt <= since) return [];
  return [{ kind: "paid", text: `${displayName(s.contract.test.developer)} paid $0 more for what you added to your ${s.kind === "recording" ? "recording" : "written answers"}`, createdAt: s.paidUpdateZeroAt, piece: s.id }];
}

/** "weekly calls from Thu, Nov 5, 3:00 PM" / "a call (pick one of 3 times)" / "a call for Thu, Nov 5, 3:00 PM". (§286) The bell passes `when` as a time token. */
export function requestWords(r: { rows?: unknown; times: Date[]; startsAt: Date; weeks: number; repeat: string }, when: string, /** (Owner, Nov 6, §312a) the bell's ` on “<test>”` */ on = "") {
  const rows = rowsOf(r);
  if (rows.length > 1) return `a call${on} (pick one of ${rows.length} times)`;
  const x = rows[0];
  return x.repeat === "once" ? `a call${on} for ${when}` : `${x.repeat === "daily" ? "daily" : "weekly"} calls${on} from ${when}${x.count ? "" : " (until testers' work ends)"}`;
}
