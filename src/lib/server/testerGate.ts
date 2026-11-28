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

/** A tester who rates (finishing their part) closes their waiting call requests with this reason. */
export const FINISHED_PART_REASON = "the tester finished their part";
/** The stored reason as a row shows it, in the tester's recorded pronoun ("the tester finished her part"). */
export const finishedPartReason = (pronoun?: string | null) => `the tester finished ${pronouns(pronoun).poss} part`;
/** Closed because of the tester's own press (their own action): a different rate, Leave (and a suspension's removal), finishing their part by rating. */
export const CLOSED_BY_TESTER = new Set(["you asked a different rate", "the tester left", FINISHED_PART_REASON]);
/** What the stop, a closure or an early end did by itself (requests closed, calls ahead cancelled): never a stop-once
 * reason for what still works afterwards (Charge, Let it go, Dispute, Rate); the stopped line at the top already says it. */
const CLOSED_BY_END = new Set(["the test was stopped", "the session ended", "the test ended"]);
/** A developer's call request closed by a pause or a hold (the stored reason is the same): never a stop, as CLOSED_BY_END; still a line. */
export const CLOSED_BY_PAUSE = new Set(["the test is paused"]);
/** Its one wording, the bell's and the top box's: "Nora Lane's call request for Fri, Nov 13, 3:00 PM was cancelled". */
export const devRequestCancelledLine = (dev: string, when: string, on = "") => `${dev}'s call request${on} for ${when} was cancelled`;
/** A booked call the system cancelled names why, as the bell does ("… was cancelled because the test is paused"). */
const CANCEL_NOTE_WHY: Record<string, string> = { "The test is paused.": "the test is paused", "The test was stopped.": "the test was stopped", "The developer ended the work early.": "your session was ended",
  // An outage and nobody joining name theirs too.
  "missed because the site was down": "the site was down", [NOBODY_JOINED]: "nobody joined", [COULD_NOT_CONNECT]: "the call couldn't connect" };
/**
 * Whether the developer's request closed for this reason is a line in the tester's top box ("The call time with Nora Lane on … is no longer
 * available"): never one her own press closed (CLOSED_BY_TESTER), one the stop, a closure or an early end closed (its own line says it), nor one a booking dropped
 * (that has its own line). Such a closure rings her bell too (closeRequests).
 */
export const testerSeesClosed = (reason: string) => !CLOSED_BY_TESTER.has(reason) && !CLOSED_BY_END.has(reason) && !isDropReason(reason);
const byTheEnd = (c: { status: string; endedAt: Date | null }, at: Date | null) => c.status === "ended" && !!c.endedAt && !!at && Math.abs(at.getTime() - c.endedAt.getTime()) < 60_000;

/**
 * The tester's changes on this session since `since` (the live box's lines, and what the gate judges). `openOffersOnly`: the gate's own reading, where an
 * offer already replaced by a newer one never stops a press (the live box and the rejoin lines drop offer lines anyway).
 */
export async function testerChanges(testerId: string, contractId: string, testId: string, since: Date, tab = "", /** the one-at-a-time page asking */ page = "", opts: { openOffersOnly?: boolean } = {}): Promise<TestEventLike[]> {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { test: { include: { developer: true } } } });
  const dev = displayName(c.test.developer);
  // The developer added their side to this tester's dispute: a stop-once reason for Dispute and the other buttons.
  const sides = await db.dispute.findMany({ where: { contractId, devSideAt: { gt: since } }, include: { submission: { select: { kind: true } }, call: { select: { startsAt: true } } } });
  const [offers, reviews, calls, devReqs, mine] = await Promise.all([
    // An offer still waiting (or, outside the gate, replaced by a newer one); one the tester already decided on never.
    db.termsOffer.findMany({ where: { contractId, createdAt: { gt: since }, status: { in: opts.openOffersOnly ? ["open"] : ["open", "superseded"] } } }),
    db.review.findMany({ where: { contractId, createdAt: { gt: since }, reason: { notIn: TESTER_CHOICE_REASONS } }, include: { submission: true, call: { select: { startsAt: true } } } }),
    db.call.findMany({ where: { contractId, cancelledAt: { gt: since }, cancelledBy: { not: "tester" } } }),
    db.callRequest.findMany({ where: { contractId, fromSide: "developer", updatedAt: { gt: since } } }),
    db.callRequest.findMany({ where: { contractId, fromSide: "tester", status: { in: ["booked", "declined"] }, decidedAt: { gt: since } } }),
  ]);
  const out: TestEventLike[] = [];
  // Each line carries the place on the session page it is about (`link`): the top box opens it, ignored (greyed) lines too. These lines are
  // built from the rows themselves at read time, so older changes get their place the same way.
  for (const d of sides) out.push({ kind: "dispute", text: devSideLine(dev, c.test.developer.pronoun, d.call ? fmtDateTime(d.call.startsAt) : null, d.submission?.kind), createdAt: d.devSideAt!, link: testerPartRow({ kind: d.submission?.kind, callId: d.callId }) });
  // The offer is a consequence for a working tester; its fields are the listing's one line ("See it") and the offer box, never a list here.
  // No "below": in a stop box under Leave (and other buttons) the Switch / Keep box is ABOVE the line, so the wording names no position
  // (the same line in the stop boxes and the top box; the bell has its own "<dev> updated the listing: …").
  for (const o of offers) out.push({ kind: "terms", text: `${dev} offered you new terms: Switch or Keep them`, createdAt: o.createdAt, item: o.id, link: TERMS_OFFER_BOX });
  const owed = await db.payment.findMany({ where: { contractId, status: "failed", owedUntil: { not: null }, settledAt: null }, select: { submissionId: true, callId: true } });
  const owedKeys = new Set(owed.map((p) => p.submissionId ?? p.callId));
  const settledLate = await db.payment.findMany({ where: { contractId, settledAt: { not: null } }, select: { submissionId: true, callId: true } });
  const lateKeys = new Set(settledLate.map((p) => p.submissionId ?? p.callId));
  for (const r of reviews) {
    // Owed (or paid late): the "delayed" line and, when it goes through, the paid line come from the payment.
    if (!r.rejected && (owedKeys.has(r.submissionId ?? r.callId) || lateKeys.has(r.submissionId ?? r.callId))) continue;
    // Which call: "Nora Lane paid $15.00 for your live call on Tue, Oct 27, 8:00 AM".
    const what = r.callId ? `your ${partWhen("live call", r.call ? fmtDateTime(r.call.startsAt) : null)}` : `your ${r.submission?.kind === "recording" ? "recording" : "written answers"}`;
    // The team's $0 closure is the team's, never the developer's.
    out.push({ kind: r.rejected ? "rejected" : "paid", text: r.rejected ? `${dev} rejected ${what}` : r.teamClosedById ? `The team closed ${what} for $0` : `${dev} paid ${money(r.amountCents)} for ${what}`, createdAt: r.createdAt, piece: (r.submissionId ?? r.callId) || undefined, link: testerPartRow({ kind: r.submission?.kind, callId: r.callId }) });
  }
  // A Pay more (Payment kind "extra") is a "paid" change too, read from the payments (it has no Review): it stops a tester press and shows in the stop box
  // and the live box. Charged (or charged before payouts are set up).
  const kinds = new Map((await db.submission.findMany({ where: { contractId }, select: { id: true, kind: true } })).map((x) => [x.id, x.kind]));
  const starts = new Map((await db.call.findMany({ where: { contractId }, select: { id: true, startsAt: true } })).map((x) => [x.id, x.startsAt]));
  for (const p of await db.payment.findMany({ where: { contractId, kind: "extra", createdAt: { gt: since }, status: { in: ["charged", "not_set_up"] } }, orderBy: { createdAt: "asc" } })) {
    // A Pay more on a call names it: "Nora Lane paid you $5.00 more for your live call on Tue, Oct 27, 8:00 AM".
    const at = p.callId ? starts.get(p.callId) : undefined;
    out.push({ kind: "paid", text: payMoreLine(dev, p.amountCents, p.callId ? partWhen("live call", at ? fmtDateTime(at) : null) : kinds.get(p.submissionId ?? "") === "recording" ? "recording" : "written answers"), createdAt: p.createdAt, piece: (p.submissionId ?? p.callId) || undefined, link: testerPartRow({ kind: kinds.get(p.submissionId ?? ""), callId: p.callId }) });
  }
  for (const r of devReqs) {
    const when = fmtDateTime(r.startsAt);
    const what = requestWords(r, when);
    // The request's row in her Call requests box; once it has left (withdrawn, taken, closed), the box (lineFallbacks).
    const link = requestRow(r.id);
    if (r.status === "pending" && r.createdAt > since) out.push({ kind: "requested", text: `${dev} requested ${what}`, createdAt: r.createdAt, item: r.id, link });
    // The developer withdrawing their request is treated like a cancel: a stop-once line (as taken / closed),
    // "Nora Lane's call request for Fri, Nov 13, 3:00 PM was cancelled". Answering it is one refusal ("Nora Lane withdrew this request, so your Accept didn't go
    // through.").
    else if (r.status === "withdrawn") out.push({ kind: "requested", text: devRequestCancelledLine(dev, when), createdAt: r.updatedAt, link });
    // Another tester booked it: "Nora Lane's call request for Fri, Nov 13, 3:00 PM was cancelled: another tester took it" (a stop-once line).
    else if (r.status === "taken") out.push({ kind: "requested", text: `${devRequestCancelledLine(dev, when)}: another tester took it`, createdAt: r.updatedAt, link });
    // One dropped when a call was booked has its own line (below), never this one too.
    // Closed by a pause or a hold: a quiet line (shown, never a stop), "Nora Lane's call request for … was cancelled".
    else if (r.status === "closed" && CLOSED_BY_PAUSE.has(r.closedReason)) out.push({ kind: DROP_KINDS.devQuiet, text: devRequestCancelledLine(dev, when), createdAt: r.updatedAt, link });
    else if (r.status === "closed" && testerSeesClosed(r.closedReason)) out.push({ kind: "requested", text: `The call time with ${dev} on ${when} is no longer available`, createdAt: r.updatedAt, link });
    // booked / declined by the tester themselves: their own action
  }
  for (const r of mine) {
    const when = fmtDateTime(r.startsAt);
    // Declined: her request's row (or the box once it has left); booked: the call's row.
    const link = r.status !== "declined" && r.callId ? callRow(r.callId) : requestRow(r.id);
    if (r.status === "declined") out.push({ kind: "requested", text: `${dev} declined your call request for ${when}`, createdAt: r.decidedAt!, link });
    else if (r.closedReason === "matched") out.push({ kind: "booked", text: `Booked: ${dev} asked for the same time, ${when}`, createdAt: r.decidedAt!, link });
    else out.push({ kind: "booked", text: `${dev} accepted your call request: ${rowsOf(r).length === 1 && rowsOf(r)[0].repeat !== "once" ? requestWords(r, when) : when}`, createdAt: r.decidedAt!, link });
  }
  // A request of this session dropped (or a time taken out of it) when a call was booked: "Nora Lane's request for … closed: she is no longer
  // free at that time" (a call change, ordinary Alerts); the tester's own (her booking, or the one she was told about) is a quiet live-box line ("… closed: you
  // have another call at that time"), never a stop.
  for (const e of await db.testEvent.findMany({ where: { testId, contractId, kind: { in: [DROP_KINDS.testerClosed, DROP_KINDS.testerQuiet] }, createdAt: { gt: since } }, orderBy: { createdAt: "asc" } }))
    // Both quiet now: the developer's side of it ("Nora Lane's request for … closed: she is no longer free") comes with a bell instead.
    out.push({ kind: DROP_KINDS.devQuiet, text: e.text, createdAt: e.createdAt, link: e.link || TESTER_REQUESTS_BOX });
  // A real call change keeps stopping once (Alerts On); one the system cancelled names why, like the bell.
  for (const call of calls.filter((x) => !(x.cancelledBy === "system" && byTheEnd(c, x.cancelledAt)))) out.push({ kind: "cancelled", text: `Your call with ${dev} on ${fmtDateTime(call.startsAt)} was cancelled${call.cancelledBy === "system" && CANCEL_NOTE_WHY[call.cancelNote] ? ` because ${CANCEL_NOTE_WHY[call.cancelNote]}` : ""}`, createdAt: call.cancelledAt!, link: callRow(call.id) });
  // The developer's Save gave this tester a key (the test had none when they joined): "<dev> gave you an access key for “<test>”" (the key is in its box).
  for (const e of await db.testEvent.findMany({ where: { testId, kind: KEY_GIVEN, contractId, createdAt: { gt: since } } })) out.push({ kind: "keygiven", text: keyGivenToYouLine(dev, c.test.title), createdAt: e.createdAt });
  // The NDA changed (its own notice): an ordinary line (Alerts on, not yet shown), apart from the block it makes.
  // "<developer> changed the NDA" whatever the kind, linking to the notice (its Acknowledge button).
  if (c.ndaChangedAt && c.ndaChangedAt > since) out.push({ kind: "nda", text: ndaChangedLine(dev), createdAt: c.ndaChangedAt, link: NDA_NOTICE });
  // The listing's info (title, description, devices, languages) changed: one line per save.
  out.push(...(await listingSaveLines(testId, since, testerId, "session")));
  out.push(...(await testerPaymentChanges(testerId, contractId, since)));
  // Her own action in another tab opens what it touched (a request, a call, a part).
  // On the session page (one page at a time): only her own actions from other pages (the join page, an invite's No thanks).
  out.push(...(await ownChanges(testerId, testId, since, tab, db, page)).map((o) => { const link = ownLink(o.about?.k, (s) => testerPartRow({ kind: kinds.get(s) })); return link ? { ...o, link } : o; }));
  return out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * What changed in the test's questions since `since` (every listing Save after it that changed them), one line per question in the stop
 * lines' words (questionChangeTexts: removed, added, a Required tick), at that Save's time. Never a reorder (a reorder-only Save records no questions change).
 * The questions follow the listing, so these are the tester's own questions' changes. `since` null: every change.
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
/** A question-change line (questionChangeLines), apart from the listing's own "edited the listing" line. */
const isQuestionLine = (e: TestEventLike) => e.kind === "info" && !!e.listing && e.key !== "listing" && !!e.keys?.includes("questions");

/** "Nora Lane added her side to your dispute about your live call on …" (the top box's line; the bell's too, with the call's time as a token). */
export const devSideLine = (dev: string, pronoun: string | null | undefined, callWhen: string | null, kind?: string | null) =>
  `${dev} added ${pronouns(pronoun).poss} side to your dispute about ${callWhen ? `your live call on ${callWhen}` : `your ${kind === "recording" ? "recording" : "written answers"}`}`;

/** "Nora Lane paid you $5.00 more for your written answers". */
export const payMoreLine = (dev: string, cents: number, part: string) => `${dev} paid you ${money(cents)} more for your ${part}`;

/** Changes to the tester's own contract: they stop a press even with Alerts Off. */
export const CONTRACT_KINDS = new Set(["terms"]);
/** What stops a tester's press even with Alerts Off: changes to their contract and what they did themselves in another tab ("own",
 * like the developer's own other-tab actions). Never an Alerts-ignorable kind. */
export const ALERTS_OFF_KINDS = new Set([...CONTRACT_KINDS, "own"]);

/**
 * The team's decision on one of her disputes on this test ("admin" lines here are only those: they carry the part), or the developer adding
 * their side to it ("dispute"): it stops EVERY press of hers on the test once, whatever her Alerts (Send, Add to this answer, a recording's add, Charge, Let it go,
 * Dispute, Leave, call requests, Rate). Excerpt requests keep their own rules (their own route).
 */
export const disputeChange = (e: TestEventLike) => e.kind === "dispute" || (e.kind === "admin" && !!e.piece);
/**
 * With Alerts Off, the lines that still stop a tester's press whatever it is about: changes to their contract, their own other-tab actions
 * and dispute changes. A developer payment on the part the press is about stops it too: that one is matched on the part (`liveRuleOf`).
 */
export const stopsWithAlertsOff = (e: TestEventLike) => ALERTS_OFF_KINDS.has(e.kind) || disputeChange(e);
/**
 * The rule a tester's stop box was built under, sent with it (`liveRule`): with Alerts Off, a line the page picks up
 * while the box is open joins it only if it would have stopped this press (marked `forced` in the live feed, or a payment line on the press's own part); a
 * developer payment on another part never joins. Alerts On: no rule, every line joins.
 */
export const liveRuleOf = (off: boolean, part?: string) => (off ? { liveRule: { off: true, ...(part ? { part } : {}) } } : {});
/**
 * What every tester stop box carries, whoever builds it (the gate, the session route's stop-moment box, Switch / Keep's "changed the terms
 * again" box): her Alerts (`alertsOff`) and the rule the box was built under (`liveRule`, with the part the press is about). Without it, a box with
 * Alerts Off would take in every live line, a developer payment on another part included.
 */
export async function testerBoxRule(testerId: string, part?: string) {
  const off = !!(await db.user.findUnique({ where: { id: testerId }, select: { testerAlertsOff: true } }))?.testerAlertsOff;
  return { alertsOff: off, ...liveRuleOf(off, part) };
}

// "nda": the NDA changed (its own notice), an ordinary kind (Alerts on).
const KINDS = ["terms", "paid", "rejected", "cancelled", "booked", "requested", "info", "payment", "admin", "own", "dispute", "nda"];
/** The kinds of line that can stop a tester's press (any other kind, e.g. a quiet dropped-request line, never does). A rename stops nothing on its own (below). */
const STOP_KINDS = new Set([...KINDS, "renamed", "keygiven"]);

/** Lines her Alerts switch can never silence: they stop a press with Alerts Off too, and the box marks them `forced`. */
function alwaysStops(e: TestEventLike, opts: { ordinaryTerms?: boolean }, pressPart?: string): boolean {
  // New terms and what she did on another page (ALERTS_OFF_KINDS); Rate and Leave treat an offer as an ordinary change.
  const contractOrOwnPress = ALERTS_OFF_KINDS.has(e.kind) && !(opts.ordinaryTerms && e.kind === "terms");
  // The developer's side added to her dispute, or the team's decision on it.
  const disputeChanged = disputeChange(e);
  // About the part this press is about: e.g. a payment on the part she is sending, adding to or disputing.
  const aboutThisPart = !!pressPart && e.piece === pressPart;
  return contractOrOwnPress || disputeChanged || aboutThisPart;
}

/**
 * The one tester gate: a press stops once for changes the page hasn't shown (the box shows under that button); a second press goes ahead unless something new
 * came since its box. Final refusals (ended early, stopped, Open until passed, already decided, holds) are each press's own and come before it. Callers:
 * - Send Answers, Add to this answer, a recording's Send / Add (testerSendGate, terms.ts): skipTerms, sendPiece (the part already sent, if any); written
 *   answers also questionLines and staleQuestions.
 * - Charge / Let it go (testerTermsGate, terms.ts): no options, only its own tail when new terms came.
 * - Switch / Keep (decideTerms, terms.ts): skipTerms.
 * - Call presses (requests.ts: Request a time, Accept / Decline / Withdraw, Cancel a set of calls; calls.ts: Cancel call): skipTerms; Accept / Decline also
 *   answers (the request it answers).
 * - Dispute (payments.ts): piece (the part disputed).
 * - Rate (testerRateGate, ratings.ts): ordinaryTerms.
 * - Leave (leaveTest, tests.ts): ordinaryTerms.
 * - The session route's stop-moment box (an end of her work the page hasn't shown, with the press's own lines): piece for Dispute, skipTerms for Switch / Keep.
 *
 * Flow: the caller has already made its refusals (final, then soft); its red form mistakes and its action come after this returns.
 *   1. Read her Alerts once (testerBoxRule): every box below carries that rule.
 *   2. No seen time: only stale questions stop the press (the box); otherwise it goes ahead.
 *   3. Collect every change since the seen time (testerChanges, the $0 update lines, the question lines) and keep the unseen ones that can stop a press.
 *   4. Alerts Off keeps only the lines that always stop; then drop the lines she answered, the one this press answers and those a box already listed.
 *   5. Nothing left (or only renames): return. Otherwise throw the stop-once box (409 "stop_once").
 */
export async function testerGate(testerId: string, contractId: string, testId: string, body: Record<string, unknown>, tail = "Press again to go ahead.", opts: { skipTerms?: boolean; piece?: string; /** what the press answers */ answers?: Answers;
  /**
   * Send Answers / Add to this answer (written answers) and a recording's Send / Add on a part already sent (its
   * submission id): a developer payment on THAT part since the page showed it (Pay, Pay more, the developer's $0 answer to an update, the team's dispute-decision
   * charge on it, a delayed payment going through) stops the press once whatever the tester's Alerts, marked forced. Payments on their other parts follow Alerts.
   */ sendPiece?: string;
  /** Rate and Leave: new terms follow the ordinary rule: they stop once only with Alerts on, and only when the page hasn't shown them. */ ordinaryTerms?: boolean;
  /** Send Answers / Add to this answer: a questions change the page hasn't shown (the ordinary rule) is listed question by question. */ questionLines?: boolean;
  /** The press holds questions the contract no longer has (or lacks a new one): these lines (what changed) always stop it, whatever the Alerts, a
   * second press, a seen time or a box that listed them: the server never takes answers keyed to the old questions. The page then takes the new questions. */
  staleQuestions?: TestEventLike[] } = {}) {
  // The part the press is about (Send / Add's part, Dispute's part).
  const pressPart = opts.sendPiece ?? opts.piece;
  // A page whose questions are out of date: its lines always stop the press, marked forced.
  const stale = (opts.staleQuestions ?? []).map((e) => ({ ...e, forced: true }));
  // Her Alerts, read once: the Alerts Off filter below and the rule every box here carries (`alertsOff`, `liveRule` with the press's part).
  const rule = await testerBoxRule(testerId, pressPart);

  // The one time: what the page has shown up to. A second press sends its box's latest time; a first press the page's seen marker (its render, moved on by
  // what the live notice showed).
  const seenUpTo = body.confirmed === true ? seenOf(body.boxAt) : seenOf(body.seenAt);
  // No time to compare with: only stale questions stop the press.
  if (!seenUpTo) {
    if (stale.length) throw new HttpError(409, "stop_once", tail, { changes: asLines(stale), tail, top: false, questions: true, ...rule });
    return;
  }

  // Every change since then: hers (open offers only: a replaced offer never stops a press).
  const collected = await testerChanges(testerId, contractId, testId, seenUpTo, tabOf(body), pageOf(body), { openOffersOnly: true });
  // The developer's $0 answer to what she added after a Pay, on the part Send / Add is about (it has no line elsewhere).
  if (opts.sendPiece) collected.push(...(await zeroUpdateLines(opts.sendPiece, seenUpTo)));
  // Send / Add: what changed in the questions, one line per question (a stale page's own lines say it instead).
  if (opts.questionLines && !stale.length) collected.push(...(await questionLinesNotYetListed(contractId, testId, seenUpTo, collected, body)));

  // What the page hasn't shown, of the kinds that can stop a press; no offer line for a press that new terms block instead (`skipTerms`).
  const unseen = collected.filter((e) => e.createdAt > seenUpTo && STOP_KINDS.has(e.kind) && !(opts.skipTerms && e.kind === "terms"));

  // Every possible reason a press stops:
  // ALWAYS (whatever her Alerts): new terms (except for Rate and Leave); her own press on another page; the developer's side added to her dispute; the team's
  //   decision on her dispute; a payment on this press's part.
  // ONLY WITH ALERTS ON: other payments; call changes (requested, withdrawn, taken, declined, booked, cancelled); listing edits and changed questions; the NDA
  //   changed; an access key given; new terms for Rate and Leave.
  // NEVER ON ITS OWN: a rename.
  // Her Alerts: Off keeps only the lines that always stop.
  const reasons = rule.alertsOff ? unseen.filter((e) => alwaysStops(e, opts, pressPart)) : unseen;

  // Drop lines she already answered, the line about the very thing this press answers, and lines a stop box on this page already listed.
  const kept = notListed((await unanswered(testerId, testId, reasons)).filter((e) => !answersIt(e, opts.answers)), body);
  // A rename alone is never a reason: only renames left, no box. Stale question lines always join.
  const boxLines = [...(kept.every((e) => e.kind === "renamed") ? [] : kept), ...stale].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (!boxLines.length) return;

  // The box: each line marked `forced` when her Alerts could not have silenced it; `top` sends the page up to the offer box; `alertsOff` and `liveRule` are
  // the rule for lines that join the open box live.
  throw new HttpError(409, "stop_once", tail, {
    changes: asLines(boxLines.map((e) => (alwaysStops(e, opts, pressPart) ? { ...e, forced: true } : e))),
    tail,
    top: boxLines.some((e) => e.kind === "terms"),
    ...rule,
    // The box lists old or changed questions: the page reloads the questions in the form before the next press.
    ...(stale.length || boxLines.some(isQuestionLine) ? { questions: true } : {}),
  });
}

/** Send / Add's question-change lines since `since`, one per question; none for the Saves whose listing line a stop box on this page already listed. */
async function questionLinesNotYetListed(contractId: string, testId: string, since: Date, collected: TestEventLike[], body: Record<string, unknown>): Promise<TestEventLike[]> {
  const listingLine = collected.find((e) => e.key === "listing" && e.listing);
  const listedAt = listingLine && wasListed(listingLine, shownIdsOf(body)) ? listingLine.createdAt : null;
  const dev = displayName((await db.contract.findUniqueOrThrow({ where: { id: contractId }, select: { test: { select: { developer: true } } } })).test.developer);
  return (await questionChangeLines(testId, since, dev)).filter((e) => !listedAt || e.createdAt > listedAt);
}

/** "Nora Lane paid $0 more for what you added to your written answers" (the bell's words), when she closed the tester's update at $0 since `since`. */
async function zeroUpdateLines(submissionId: string, since: Date): Promise<TestEventLike[]> {
  const s = await db.submission.findUnique({ where: { id: submissionId }, select: { id: true, kind: true, paidUpdateZeroAt: true, contract: { select: { test: { select: { developer: true } } } } } });
  if (!s?.paidUpdateZeroAt || s.paidUpdateZeroAt <= since) return [];
  return [{ kind: "paid", text: `${displayName(s.contract.test.developer)} paid $0 more for what you added to your ${s.kind === "recording" ? "recording" : "written answers"}`, createdAt: s.paidUpdateZeroAt, piece: s.id }];
}

/** "weekly calls from Thu, Nov 5, 3:00 PM" / "a call (pick one of 3 times)" / "a call for Thu, Nov 5, 3:00 PM". The bell passes `when` as a time token. */
export function requestWords(r: { rows?: unknown; times: Date[]; startsAt: Date; weeks: number; repeat: string }, when: string, /** the bell's ` on “<test>”` */ on = "") {
  const rows = rowsOf(r);
  if (rows.length > 1) return `a call${on} (pick one of ${rows.length} times)`;
  const x = rows[0];
  return x.repeat === "once" ? `a call${on} for ${when}` : `${x.repeat === "daily" ? "daily" : "weekly"} calls${on} from ${when}${x.count ? "" : " (until testers' work ends)"}`;
}
