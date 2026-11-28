import { db } from "@/lib/db";
import { displayName, fmtDateTime, money, pronouns } from "@/lib/server/dateFormat";
import { COULD_NOT_CONNECT, NOBODY_JOINED, TESTER_CHOICE_REASONS, partWhen, type TestEventLike } from "@/lib/rules";
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
import { unanswered, answersIt, asLines, listingSaveLines, ownChanges, type Answers, pageOf, seenOf, tabOf, testerPaymentChanges } from "./live";

// The tester's ONE set of stop-once reasons (owner rule, NEWEST+3), used by every tester button on the session page:
// Switch / Keep, Send written, Send recording, Charge / Let it go, Dispute, Leave, Block, Request a time, Accept /
// Decline / Withdraw, Cancel call. Since what the page has shown (its render, moved on by what the live top notice showed):
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
/** (Owner, Nov 11, §379 item 5) A developer's call request closed by a pause or a hold (the stored reason is the same): never a stop, as CLOSED_BY_END; still a line. */
export const CLOSED_BY_PAUSE = new Set(["the test is paused"]);
/** (Owner, Nov 11, §379 item 5) Its one wording, the bell's and the top box's: "Nora Lane's call request for Fri, Nov 13, 3:00 PM was cancelled". */
export const devRequestCancelledLine = (dev: string, when: string, on = "") => `${dev}'s call request${on} for ${when} was cancelled`;
/** (Owner, Nov 11, §379 item 5) A booked call the system cancelled names why, as the bell does ("… was cancelled because the test is paused"). */
const CANCEL_NOTE_WHY: Record<string, string> = { "The test is paused.": "the test is paused", "The test was stopped.": "the test was stopped", "The developer ended the work early.": "your session was ended",
  // (Owner, Nov 11, §390 a) An outage and nobody joining name theirs too.
  "missed because the site was down": "the site was down", [NOBODY_JOINED]: "nobody joined", [COULD_NOT_CONNECT]: "the call couldn't connect" };
/**
 * (Owner, Nov 6, §286) Whether the developer's request closed for this reason is a line in the tester's top box ("The call time with Nora Lane on … is no longer
 * available"): never one her own press closed (CLOSED_BY_TESTER), one the stop, a closure or an early end closed (its own line says it), nor one a booking dropped
 * (§184's own line). Such a closure rings her bell too (closeRequests).
 */
export const testerSeesClosed = (reason: string) => !CLOSED_BY_TESTER.has(reason) && !CLOSED_BY_END.has(reason) && !isDropReason(reason);
const byTheEnd = (c: { status: string; endedAt: Date | null }, at: Date | null) => c.status === "ended" && !!c.endedAt && !!at && Math.abs(at.getTime() - c.endedAt.getTime()) < 60_000;

/**
 * The tester's changes on this session since `since` (the live box's lines, and what the gate judges). Offers count from the earlier of `since` and
 * `offersSince` (only the gate reads offer lines and cuts them at its own time; the live box and the rejoin lines drop them). `openOffersOnly`: the gate's own
 * reading, where an offer already replaced by a newer one never stops a press.
 */
export async function testerChanges(testerId: string, contractId: string, testId: string, since: Date, tab = "", offersSince: Date = since, /** (Owner, Nov 11, §380) the one-at-a-time page asking */ page = "", opts: { openOffersOnly?: boolean } = {}): Promise<TestEventLike[]> {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { test: { include: { developer: true } } } });
  const dev = displayName(c.test.developer);
  // (Design doc 8) The developer added their side to this tester's dispute: a stop-once reason for Dispute and the other buttons.
  const sides = await db.dispute.findMany({ where: { contractId, devSideAt: { gt: since } }, include: { submission: { select: { kind: true } }, call: { select: { startsAt: true } } } });
  const [offers, reviews, calls, devReqs, mine] = await Promise.all([
    // (Owner, reason A) An offer still waiting (or, outside the gate, replaced by a newer one); one the tester already decided on never.
    db.termsOffer.findMany({ where: { contractId, createdAt: { gt: offersSince < since ? offersSince : since }, status: { in: opts.openOffersOnly ? ["open"] : ["open", "superseded"] } } }),
    db.review.findMany({ where: { contractId, createdAt: { gt: since }, reason: { notIn: TESTER_CHOICE_REASONS } }, include: { submission: true, call: { select: { startsAt: true } } } }),
    db.call.findMany({ where: { contractId, cancelledAt: { gt: since }, cancelledBy: { not: "tester" } } }),
    db.callRequest.findMany({ where: { contractId, fromSide: "developer", updatedAt: { gt: since } } }),
    db.callRequest.findMany({ where: { contractId, fromSide: "tester", status: { in: ["booked", "declined"] }, decidedAt: { gt: since } } }),
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
  for (const p of await db.payment.findMany({ where: { contractId, kind: "extra", createdAt: { gt: since }, status: { in: ["charged", "not_set_up"] } }, orderBy: { createdAt: "asc" } })) {
    // (§177) A Pay more on a call names it: "Nora Lane paid you $5.00 more for your live call on Tue, Oct 27, 8:00 AM".
    const at = p.callId ? starts.get(p.callId) : undefined;
    out.push({ kind: "paid", text: payMoreLine(dev, p.amountCents, p.callId ? partWhen("live call", at ? fmtDateTime(at) : null) : kinds.get(p.submissionId ?? "") === "recording" ? "recording" : "written answers"), createdAt: p.createdAt, piece: (p.submissionId ?? p.callId) || undefined, link: testerPartRow({ kind: kinds.get(p.submissionId ?? ""), callId: p.callId }) });
  }
  for (const r of devReqs) {
    const when = fmtDateTime(r.startsAt);
    const what = requestWords(r, when);
    // (§284) The request's row in her Call requests box; once it has left (withdrawn, taken, closed), the box (lineFallbacks).
    const link = requestRow(r.id);
    if (r.status === "pending" && r.createdAt > since) out.push({ kind: "requested", text: `${dev} requested ${what}`, createdAt: r.createdAt, item: r.id, link });
    // (Owner, Nov 11, §385; replaces §185's quiet line) The developer withdrawing their request is treated like a cancel: a stop-once line (as taken / closed),
    // "Nora Lane's call request for Fri, Nov 13, 3:00 PM was cancelled". Answering it is one refusal ("Nora Lane withdrew this request, so your Accept didn't go
    // through.").
    else if (r.status === "withdrawn") out.push({ kind: "requested", text: devRequestCancelledLine(dev, when), createdAt: r.updatedAt, link });
    // (Owner, Nov 11) Another tester booked it: "Nora Lane's call request for Fri, Nov 13, 3:00 PM was cancelled: another tester took it" (a stop-once line, as before).
    else if (r.status === "taken") out.push({ kind: "requested", text: `${devRequestCancelledLine(dev, when)}: another tester took it`, createdAt: r.updatedAt, link });
    // (Owner, Nov 4, §184) One dropped when a call was booked has its own line (below), never this one too.
    // (Owner, Nov 11, §379 item 5) Closed by a pause or a hold: a quiet line (shown, never a stop), "Nora Lane's call request for … was cancelled".
    else if (r.status === "closed" && CLOSED_BY_PAUSE.has(r.closedReason)) out.push({ kind: DROP_KINDS.devQuiet, text: devRequestCancelledLine(dev, when), createdAt: r.updatedAt, link });
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
  for (const e of await db.testEvent.findMany({ where: { testId, contractId, kind: { in: [DROP_KINDS.testerClosed, DROP_KINDS.testerQuiet] }, createdAt: { gt: since } }, orderBy: { createdAt: "asc" } }))
    // (Owner, Nov 4, §185) Both quiet now: the developer's side of it ("Nora Lane's request for … closed: she is no longer free") comes with a bell instead.
    out.push({ kind: DROP_KINDS.devQuiet, text: e.text, createdAt: e.createdAt, link: e.link || TESTER_REQUESTS_BOX });
  // (Owner, Nov 11, §379 item 5) A real call change keeps stopping once (Alerts On); one the system cancelled names why, like the bell.
  for (const call of calls.filter((x) => !(x.cancelledBy === "system" && byTheEnd(c, x.cancelledAt)))) out.push({ kind: "cancelled", text: `Your call with ${dev} on ${fmtDateTime(call.startsAt)} was cancelled${call.cancelledBy === "system" && CANCEL_NOTE_WHY[call.cancelNote] ? ` because ${CANCEL_NOTE_WHY[call.cancelNote]}` : ""}`, createdAt: call.cancelledAt!, link: callRow(call.id) });
  // (Owner, Nov 6, §304) No "<dev> marked your key as working" line any more: there is no key report to answer.
  // (Batch 30 §17) The developer's Save gave this tester a key (the test had none when they joined): "<dev> gave you an access key for “<test>”" (the key is in its box).
  for (const e of await db.testEvent.findMany({ where: { testId, kind: KEY_GIVEN, contractId, createdAt: { gt: since } } })) out.push({ kind: "keygiven", text: keyGivenToYouLine(dev, c.test.title), createdAt: e.createdAt });
  // (Owner, Nov 5, §267) The NDA changed (its own notice): an ordinary line (Alerts on, not yet shown), apart from the block it makes.
  // (Owner, Nov 6, §302) "<developer> changed the NDA" whatever the kind, linking to the notice (its Acknowledge button).
  if (c.ndaChangedAt && c.ndaChangedAt > since) out.push({ kind: "nda", text: ndaChangedLine(dev), createdAt: c.ndaChangedAt, link: NDA_NOTICE });
  // (F) the listing's info (title, description, devices, languages) changed: (batch 30 §10) one line per save.
  out.push(...(await listingSaveLines(testId, since, testerId, "session")));
  out.push(...(await testerPaymentChanges(testerId, contractId, since)));
  // (§284) Her own action in another tab opens what it touched (a request, a call, a part).
  // (Owner, Nov 11, §380) On the session page (one page at a time): only her own actions from other pages (the join page, an invite's No thanks).
  out.push(...(await ownChanges(testerId, testId, since, tab, db, page)).map((o) => { const link = ownLink(o.about?.k, (s) => testerPartRow({ kind: kinds.get(s) })); return link ? { ...o, link } : o; }));
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

/**
 * (Owner, Nov 4, §171 A2) The team's decision on one of her disputes on this test ("admin" lines here are only those: they carry the part), or the developer adding
 * their side to it ("dispute"): it stops EVERY press of hers on the test once, whatever her Alerts (Send, Add to this answer, a recording's add, Charge, Let it go,
 * Dispute, Leave, call requests, Rate). Excerpt requests keep their own rules (their own route).
 */
export const disputeChange = (e: TestEventLike) => e.kind === "dispute" || (e.kind === "admin" && !!e.piece);
/**
 * (Owner, Nov 10, §373) With Alerts Off, the lines that still stop a tester's press whatever it is about: changes to their contract, their own other-tab actions
 * and dispute changes. (§362) A developer payment on the part the press is about stops it too: that one is matched on the part (`liveRuleOf`).
 */
export const stopsWithAlertsOff = (e: TestEventLike) => ALERTS_OFF_KINDS.has(e.kind) || disputeChange(e);
/**
 * (Owner, Nov 10, §373; recording race-371 2) The rule a tester's stop box was built under, sent with it (`liveRule`): with Alerts Off, a line the page picks up
 * while the box is open joins it only if it would have stopped this press (marked `forced` in the live feed, or a payment line on the press's own part); a
 * developer payment on another part never joins (it used to: "Nora Lane paid $10.00 for your recording" was added under Send Answers 1.2 s after the box).
 * Alerts On: no rule, every line joins, as before.
 */
export const liveRuleOf = (off: boolean, part?: string) => (off ? { liveRule: { off: true, ...(part ? { part } : {}) } } : {});
/**
 * (Owner, Nov 10, §374) What every tester stop box carries, whoever builds it (the gate, the session route's stop-moment box, Switch / Keep's "changed the terms
 * again" box): her Alerts (`alertsOff`, batch 17 §13) and the rule the box was built under (`liveRule`, with the part the press is about). A box thrown without
 * it took in every live line with Alerts Off, a developer payment on another part included.
 */
export async function testerBoxRule(testerId: string, part?: string) {
  const off = !!(await db.user.findUnique({ where: { id: testerId }, select: { testerAlertsOff: true } }))?.testerAlertsOff;
  return { alertsOff: off, ...liveRuleOf(off, part) };
}

// (Owner, Nov 5, §267) "nda": the NDA changed (its own notice), an ordinary kind (Alerts on).
const KINDS = ["terms", "paid", "rejected", "cancelled", "booked", "requested", "info", "payment", "admin", "own", "dispute", "nda"];
/** The kinds of line that can stop a tester's press (any other kind, e.g. a quiet dropped-request line, never does). A rename stops nothing on its own (below). */
const STOP_KINDS = new Set([...KINDS, "renamed", "keygiven"]);
/**
 * The call changes a tester sees (the developer's requests: new, withdrawn, taken or closed; her own request accepted or declined; a call cancelled). The gate
 * counts these from an earlier time than the rest (`callsSeenUpTo` in testerGate): when the page first loaded in this tab, or the newest line a stop box there
 * listed, if that is earlier than the seen marker. Why: when a redraw changes the part's state (the session page is keyed by its status and end), the live box is
 * drawn again from the new render, and the lines the old box had picked up but not yet shown are dropped, so a call change can pass the seen marker without
 * ever showing in the live box.
 */
export const TESTER_CALL_KINDS = new Set(["requested", "booked", "cancelled"]);

/** The one tester gate: the first press stops (the box shows under that button); a second press goes ahead unless something new came since its box. */
export async function testerGate(testerId: string, contractId: string, testId: string, body: Record<string, unknown>, tail = "Press again to go ahead.", opts: { skipTerms?: boolean; piece?: string; /** (Batch 35 §79) what the press answers */ answers?: Answers;
  /**
   * (Owner, Nov 4, §183; restored Nov 9, §362) Send Answers / Add to this answer (written answers) and a recording's Send / Add on a part already sent (its
   * submission id): a developer payment on THAT part since the page showed it (Pay, Pay more, the developer's $0 answer to an update, the team's dispute-decision
   * charge on it, a delayed payment going through) stops the press once whatever the tester's Alerts, marked forced. Payments on their other parts follow Alerts.
   */ sendPiece?: string;
  /** (Owner, Nov 5, §268; replaces §232's open-terms stop) Rate and Leave: new terms (and an NDA change) follow the ordinary rule: they stop once only with Alerts
   * on, and only when the change came after what the page has shown. */ ordinaryTerms?: boolean;
  /** (Owner, Nov 5, §269) Send Answers / Add to this answer: a questions change the page hasn't shown (the ordinary rule) is listed question by question. */ questionLines?: boolean;
  /** (§269) The press holds questions the contract no longer has (or lacks a new one): these lines (what changed) always stop it, whatever the Alerts, a
   * second press, a seen time or a box that listed them: the server never takes answers keyed to the old questions. The page then takes the new questions. */
  staleQuestions?: TestEventLike[] } = {}) {
  // A stopped, closed or paused test, or a tester whose work ended: every press still allowed follows these same rules (Block never stops).
  const pressPart = opts.sendPiece ?? opts.piece;
  // A page whose questions are out of date: its lines always stop the press, marked forced (the box tells the page to take the new questions).
  const stale = (opts.staleQuestions ?? []).map((e) => ({ ...e, forced: true }));

  // 1. What the page has shown up to. A second press (sent while its stop box is open) sends the box's latest time (`boxAt`); a first press sends the page's seen
  // marker (`seenAt`: its render, moved on by what the live box showed).
  const secondPress = body.confirmed === true;
  const seenUpTo = secondPress ? seenOf(body.boxAt) : seenOf(body.seenAt);
  // No time to compare with (a first press without a seen marker, or a second press from a page that sends no box time): only stale questions stop it.
  if (!seenUpTo) {
    if (stale.length) throw new HttpError(409, "stop_once", tail, { changes: asLines(stale), tail, top: false, questions: true, ...(await testerBoxRule(testerId, pressPart)) });
    return;
  }
  // Call changes count from the page's first load in this tab (`loadedAt`), or the newest line a stop box there listed (`boxSeenAt`), whichever is later, when that
  // is earlier than `seenUpTo` (see TESTER_CALL_KINDS). A second press counts them from its box's time like everything else.
  const loadedAt = secondPress ? null : seenOf(body.loadedAt);
  const boxListedUpTo = seenOf(body.boxSeenAt);
  const callsShownFrom = loadedAt && boxListedUpTo && boxListedUpTo > loadedAt ? boxListedUpTo : loadedAt;
  const callsSeenUpTo = callsShownFrom && callsShownFrom < seenUpTo ? callsShownFrom : seenUpTo;

  // 2. Collect every change since then: the tester's changes (offers still open only: a replaced offer never stops a press), ...
  const collected = await testerChanges(testerId, contractId, testId, callsSeenUpTo, tabOf(body), seenUpTo, pageOf(body), { openOffersOnly: true });
  // ... the developer's $0 answer to what the tester added after a Pay, on the part Send / Add is about (it has no line elsewhere), ...
  if (opts.sendPiece) collected.push(...(await zeroUpdateLines(opts.sendPiece, seenUpTo)));
  // ... and for Send / Add (`questionLines`), what changed in the questions, one line per question; not when a stop box already listed the listing line for
  // those Saves, nor for a stale page (its own lines, `stale`, say it).
  if (opts.questionLines && !stale.length) {
    const listingLine = collected.find((e) => e.key === "listing" && e.listing);
    const shown = listingLine && wasListed(listingLine, shownIdsOf(body)) ? listingLine.createdAt : null;
    const dev = displayName((await db.contract.findUniqueOrThrow({ where: { id: contractId }, select: { test: { select: { developer: true } } } })).test.developer);
    collected.push(...(await questionChangeLines(testId, seenUpTo, dev)).filter((e) => !shown || e.createdAt > shown));
  }

  // 3. Keep what the page hasn't shown: call changes after `callsSeenUpTo`, everything else after `seenUpTo`. Presses that new terms block instead
  // (`skipTerms`) never list an offer.
  const unseen = collected.filter((e) => (e.kind === "terms" ? !opts.skipTerms : true) && e.createdAt > (TESTER_CALL_KINDS.has(e.kind) ? callsSeenUpTo : seenUpTo));
  const offers = unseen.filter((e) => e.kind === "terms");
  const others = unseen.filter((e) => e.kind !== "terms" && STOP_KINDS.has(e.kind));

  // 4. Her Alerts. Off: of the other lines, only those that always stop (her own other-tab actions, dispute changes) and a developer payment on the part this
  // press is about (§362). Rate and Leave (`ordinaryTerms`) with Alerts Off: an offer never stops them either.
  const alertsOff = !!(await db.user.findUnique({ where: { id: testerId }, select: { testerAlertsOff: true } }))?.testerAlertsOff;
  const onPressPart = (e: TestEventLike) => !!pressPart && e.piece === pressPart;
  const othersThatStop = alertsOff ? others.filter((e) => stopsWithAlertsOff(e) || onPressPart(e)) : others;
  const offersThatStop = alertsOff && opts.ordinaryTerms ? [] : offers;

  // 5. Drop the line about the very thing this press answers (Accept on the request that just arrived, §79), lines the tester already answered, and lines any stop
  // box on this page already listed (`shownIds`, §250). A rename alone never stops a press: if only renames are left, no box. Stale questions always join.
  const kept = notListed((await unanswered(testerId, testId, [...offersThatStop, ...othersThatStop])).filter((e) => !answersIt(e, opts.answers)), body);
  const boxLines = [...(kept.every((e) => e.kind === "renamed") ? [] : kept), ...stale].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (!boxLines.length) return;

  // 6. The box. Each line says whether her Alerts could have switched it off (`forced`): her own other-tab actions, new terms (not for Rate and Leave), dispute
  // changes, and a developer payment on the part the press is about always stop. `top`: an offer line sends the page up to the offer box. `alertsOff` and
  // `liveRule`: the box's rule for lines that join it live (§373). `questions`: the box lists a questions change, so the page takes the new questions in place.
  const forced = (e: TestEventLike) => (ALERTS_OFF_KINDS.has(e.kind) && !(opts.ordinaryTerms && e.kind === "terms")) || disputeChange(e) || onPressPart(e);
  throw new HttpError(409, "stop_once", tail, { changes: asLines(boxLines.map((e) => (forced(e) ? { ...e, forced: true } : e))), tail, top: offersThatStop.some((t) => boxLines.includes(t)), alertsOff, ...liveRuleOf(alertsOff, pressPart), ...(stale.length || boxLines.some(isQuestionLine) ? { questions: true } : {}) });
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
