import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, fmtDate, pronouns } from "@/lib/server/dateFormat";
import { overPressLine, newDueAt, switchedLine, termsDiff, testerRefusal, type ContractTerms, type TestEventLike } from "@/lib/rules";
import { ANSWER_TERMS_CODE, ANSWER_TERMS_FIRST, NO_LONGER_ON_OFFER, SENT_WORK_PRICE_EXPLANATION } from "@/lib/answerTerms";
import { HttpError } from "./http";
import { bell, notify } from "./notify";
import { testerBoxRule, testerGate } from "./testerGate";
import { logEvent, seenOf } from "./live";
import { carryOver, itemsFor, prevSetsOf, pushPrev, restoreDraft } from "@/lib/answerSets";
import { carriedAnswers } from "@/lib/additions";
import { qText, sameQuestionWords } from "@/lib/questions";
import { closeOffersOfEnded } from "./offerClose";
import { NDA_BLOCK_CODE, NDA_BLOCK_FIRST, ndaBlocked, ndaChangeOf } from "@/lib/ndaNotice";
import { testerRow } from "@/lib/lineAnchors";
export { closeOffersOfEnded };

const nameOf = async (id: string) => displayName(await db.user.findUniqueOrThrow({ where: { id } }));

// New terms offered to working testers: an Edit that changes contract terms offers them to every working
// tester; their contract changes only if they switch. Work already sent keeps its price; the deadline never moves earlier.

const termsOf = (x: { ndaText: string; writtenCents: number | null; recordingCents: number | null; liveRateCents: number | null; liveMinutes: number | null; deadlineDays: number; questions: unknown; writtenRequired: boolean; recordingRequired: boolean; liveRequired: boolean }): ContractTerms => ({
  ndaText: x.ndaText ?? "", writtenCents: x.writtenCents, recordingCents: x.recordingCents, liveRateCents: x.liveRateCents, liveMinutes: x.liveMinutes, deadlineDays: x.deadlineDays, questions: (x.questions as string[]) ?? [],
  writtenRequired: x.writtenRequired, recordingRequired: x.recordingRequired, liveRequired: x.liveRequired,
});

/** After an Edit: offer the test's current terms to each working tester whose contract differs. Returns how many. */
export async function offerNewTerms(testId: string, changeId: string | null = null) {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
  const working = await db.contract.findMany({ where: { testId, status: "working" }, include: { tester: true } });
  let offered = 0;
  for (const c of working) {
    // (5) Shortening the deadline applies to new testers only and is ignored here: an existing tester is only ever offered more time. The
    // questions are not a term: the offer carries the contract's own (the Save already wrote the listing's into it), so they're never in its diff.
    // Nor the NDA: the offer carries the contract's own (the Save already copied the listing's into it).
    const newTerms = { ...termsOf(t), deadlineDays: Math.max(c.deadlineDays, t.deadlineDays), questions: (c.questions as string[]) ?? [], ndaText: c.ndaText ?? "" };
    const diff = termsDiff(termsOf(c), newTerms);
    // Repeated saves replace a waiting offer with the newest one.
    await db.termsOffer.updateMany({ where: { contractId: c.id, status: "open" }, data: { status: "superseded", decidedAt: new Date() } });
    if (!diff) continue;
    await db.termsOffer.create({
      data: {
        contractId: c.id, testId, listingVersion: t.listingVersion, ...newTerms, questions: newTerms.questions as Prisma.InputJsonValue, diff, changeId,
        // The terms the tester is on when this is offered stay in their terms history (previous questions and NDA).
        fromQuestions: c.questions as Prisma.InputJsonValue, fromNdaText: c.ndaText,
      },
    });
    const line = `${displayName(t.developer)} updated the listing: ${diff}`;
    await notify(c.tester.email, line, [line + ".", `Switch to the new terms or keep your current ones on your session page. ${SENT_WORK_PRICE_EXPLANATION}`], `/app/sessions/${c.id}#terms-offer`, { about: t.developerId, testId }); // in the test's own day stack, like "edited the listing"
    offered++;
  }
  return offered;
}

/** Switch / Keep pressed after the tester's part ended (rated, left, removed, stopped, the work window ended): its refusal line. */
export const PART_ENDED_TERMS = "Your part in this test has ended, so your Switch didn't go through.";

/**
 * The NDA block: an NDA change the tester hasn't acknowledged refuses every press of theirs on the test (Rate and Leave never come here).
 * Called by answerTermsFirst (the presses that check new terms) and ndaBlockFirst (the session route).
 * Every change blocks (added, removed or changed), refused like an open contract change: one line, "Acknowledge the NDA change first.", and
 * the page goes up to the NDA notice and marks it (`sessionId`: a Join call away from the session page links there).
 * Flow: a soft refusal (409 NDA_BLOCK_CODE): after the press's final refusals, before its stop-once box.
 */
export function ndaBlockCheck(c: { id: string; ndaChangedAt: Date | null; ndaChangeKind: string; ndaNoticeSeenAt: Date | null }) {
  if (ndaBlocked(c)) throw new HttpError(409, NDA_BLOCK_CODE, NDA_BLOCK_FIRST, { sessionId: c.id });
}
export { NDA_BLOCK_CODE };
/** The block for a press by contract id (the session route's presses; Flow: after the route's final and paused refusals, before its stop-moment box). */
export async function ndaBlockFirst(contractId: string) {
  const c = await db.contract.findUnique({ where: { id: contractId }, select: { id: true, ndaChangedAt: true, ndaChangeKind: true, ndaNoticeSeenAt: true } });
  if (c) ndaBlockCheck(c);
}
/**
 * A Save changed the NDA: every working contract takes the listing's at once (no Switch / Keep), with the change's kind and time for its
 * notice and block. An added or removed NDA clears `ndaAcceptedAt` (an added one counts as accepted once its notice is opened); a changed text keeps it.
 * NDA-only restricted edits include ended participants so they can acknowledge the new NDA too.
 * Returns the contracts changed.
 */
export async function followNda(tx: Prisma.TransactionClient, testId: string, before: string, after: string, now: Date, includeEnded = false) {
  const kind = ndaChangeOf(before, after);
  if (!kind) return [];
  const cs = await tx.contract.findMany({ where: { testId, ...(includeEnded ? {} : { status: "working" }) }, select: { id: true, tester: { select: { email: true } } } });
  if (cs.length) await tx.contract.updateMany({ where: { id: { in: cs.map((c) => c.id) } }, data: { ndaText: after, ...(kind === "changed" ? {} : { ndaAcceptedAt: null }), ndaChangedAt: now, ndaChangeKind: kind } });
  // Every other contract on the test (left, ended) takes the listing's NDA text too, with no notice or block (nothing to press there); one
  // who rejoins accepts the listing's NDA on joining as usual.
  if (!includeEnded) await tx.contract.updateMany({ where: { testId, status: { not: "working" } }, data: { ndaText: after } });
  return cs.map((c) => ({ contractId: c.id, email: c.tester.email, kind }));
}

/**
 * Existing data: a contract that isn't working (left, ended) and that no Save reached (older data, from when only working contracts followed) still
 * holds its old questions. On read (the developer's test page, the tester's session page), each such contract is brought onto the listing's questions by
 * followQuestions (its Terms history entry, dated now, keeps the old answered questions readable there). Nothing is deleted; a contract already in line costs
 * one comparison. Returns the ids changed.
 */
export async function syncEndedQuestions(testId: string, stored: unknown) {
  const listing = Array.isArray(stored) ? (stored as string[]) : [];
  const stale = (await db.contract.findMany({ where: { testId, status: { not: "working" } }, select: { id: true, questions: true } }))
    .filter((c) => !sameQuestionWords((c.questions as string[]) ?? [], listing));
  if (!stale.length) return [];
  const now = new Date();
  return db.$transaction(async (tx) => {
    const changed: string[] = [];
    for (const { id } of stale) {
      const c = await tx.contract.findUniqueOrThrow({ where: { id }, select: { id: true, testerId: true, questions: true, prevSets: true, status: true } });
      if (c.status !== "working" && (await followQuestions(tx, c, listing, now))) changed.push(c.id);
    }
    return changed;
  });
}

/** The newest open offer for a contract, if any. */
export const openOffer = (contractId: string) => db.termsOffer.findFirst({ where: { contractId, status: "open" }, orderBy: { createdAt: "desc" } });

/**
 * An open offer blocks Send (written answers, recordings) and every call press (Request a time, Accept, Decline, Withdraw,
 * Cancel call, Cancel the remaining calls, Join call) until the tester answers it: Switch or Keep both unlock. Every press is refused the same way (no second press
 * gets through), from an old page that hasn't shown the offer too, and with Alerts Off (an offer is about the tester's own contract). A newer Save replaces the
 * offer (still blocked until the newest is answered); an offer whose work closed (the test stopped or closed, the tester's work ended, they left) blocks nothing.
 *
 * Callers: Send Answers, Add to this answer and a recording's Send / Add (tests.ts softRefusals, in the one pass), Charge / Let it go (holds.ts),
 * Dispute (payments.ts disputeRefusalsFirst), Request a time, Accept / Decline / Withdraw and Cancel a set of calls (requests.ts), Cancel call (calls.ts),
 * Join call (blocks.ts). The session route also runs the NDA block first (ndaBlockFirst) for its presses but Rate, Leave, the notice, the pill, an upload
 * under way and the one-pass presses.
 * Flow: the soft refusals a press makes after its final ones and before its stop-once box.
 *   1. No contract, or a part that is over (testerRefusal): nothing here (the press's own final refusal says it).
 *   2. An NDA change not acknowledged: 409 NDA_BLOCK_CODE (ndaBlockCheck).
 *   3. An open terms offer: 409 ANSWER_TERMS_CODE ("Answer the new terms first: Switch or Keep.").
 */
export async function answerTermsFirst(contractId: string, /** `db`, or the press's transaction under the test's lock */ q: Prisma.TransactionClient | typeof db = db) {
  const c = await q.contract.findUnique({ where: { id: contractId }, include: { test: { include: { developer: true } } } });
  if (!c || testerRefusal(c, c.test, displayName(c.test.developer), fmtDate, new Date())) return;
  // Any NDA change (added, removed or changed) the tester hasn't acknowledged blocks the press first (calls too, which come through here).
  ndaBlockCheck(c);
  const offer = await q.termsOffer.findFirst({ where: { contractId, status: "open" }, orderBy: { createdAt: "desc" } }); // (openOffer, read with `q`)
  // `sessionId`: a Join call refused away from the session page (the dashboard's Upcoming calls) links to the Switch / Keep box there.
  if (offer) throw new HttpError(409, ANSWER_TERMS_CODE, ANSWER_TERMS_FIRST, { offerId: offer.id, sessionId: contractId });
}

/**
 * Send's own stop-once, after answerTermsFirst: every other reason; new terms are not a stop-once for it (they block).
 * `piece`: the sent part this press adds to (its submission id; none for a first Send): a developer payment on it since the page loaded stops
 * once whatever the tester's Alerts. `skipTerms` only drops the terms lines (an open offer already blocked the press), so the piece needs nothing more there.
 * Run inside the press's one pass under the test's lock (Send Answers, Add to this answer, a recording's Send / Add): it only reads (the
 * work closure and "This test ended" are the pass's part-over step), and it returns the stop-once box (or null) instead of throwing it, so the pass ends normally
 * and keeps the drafts it saved.
 *
 * Flow (Send Answers, Add to this answer, a recording's Send / Add, in the one pass): drafts kept → final refusals (part over, a rejected or closed part, the same answers already sent) → soft refusals
 * (paused, answerTermsFirst, an upload still running) → THIS gate: testerGate with skipTerms, sendPiece and, for written answers, questionLines and
 * staleQuestions; the box is returned → red form mistakes → the send. The caller throws the returned box after the pass.
 */
export async function testerSendGate(tx: Prisma.TransactionClient, contractId: string, body: Record<string, unknown>, piece?: string, written?: { stale?: TestEventLike[] }) {
  const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
  try {
    // Send Answers and Add to this answer (`written`) list a questions change question by question; a page whose questions are no longer
    // the contract's (`written.stale`: what changed) always stops once, and the page then takes the new questions.
    await testerGate(c.testerId, contractId, c.testId, body, undefined, { skipTerms: true, sendPiece: piece, questionLines: !!written, staleQuestions: written?.stale });
    return null;
  } catch (e) {
    if (e instanceof HttpError) return e;
    throw e;
  }
}

/**
 * Tester-side stop once (box at the TOP of the session page): Charge / Let it go stop once if new terms were offered since the page loaded (Send
 * doesn't: an open offer blocks it). The second press goes ahead under the current terms.
 * Flow (Charge / Let it go): soft refusals (NDA block, answerTermsFirst, paused) and final refusals (already chose, paid, closed, late…) → THIS gate: testerGate
 * with no options, its tail naming the terms when new ones came → red form mistakes (choice, amount, tick) → the charge or the review.
 */
export async function testerTermsGate(contractId: string, _devName: string, body: Record<string, unknown>) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId } });
  const fresh = typeof body.seenAt === "string" ? await db.termsOffer.count({ where: { contractId, createdAt: { gt: new Date(body.seenAt) } } }) : 0;
  await testerGate(c.testerId, contractId, c.testId, body, fresh ? "Press again to go ahead under your current terms, or switch first." : "Press again to go ahead.");
}

/** Switch / Keep when no offer is open any more (one line, shared with the Switch / Keep box: lib/answerTerms.ts). */
export { NO_LONGER_ON_OFFER };

/**
 * Switch to the offered terms, or keep the current ones. Stops once if the terms changed again since (shows the newest).
 *
 * Flow (Switch / Keep; the session route has already made its final refusal, the NDA block and its stop-moment box):
 *   1. Final refusals: not her session (404); her part has ended (its offer closes; "gone"); no open offer (already switched / decided / no longer on offer).
 *   2. Stop-once box: testerGate with skipTerms (her other unseen changes).
 *   3. Final refusal again, read after the box: no open offer any more (decided in another tab while the box showed).
 *   4. Stop-once box: "changed the terms again" when the page named an older offer (not on a confirmed press, when the newest terms
 *      already existed at its box's time); it carries testerBoxRule.
 *   5. No red mistakes. Action: Switch (the contract takes the terms; a line and a bell for the developer) or Keep.
 */
export async function decideTerms(tester: { id: string }, contractId: string, body: Record<string, unknown>) {
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { test: { include: { developer: true } } } });
  if (!c || c.testerId !== tester.id) throw new HttpError(404, "not_found", "That session doesn't exist or isn't yours.");
  // A part that ended has no terms to decide: an old page's Switch / Keep is refused plainly (and any offer still open closes).
  if (c.status !== "working") {
    await closeOffersOfEnded(db, [contractId], c.endedAt ?? new Date());
    throw new HttpError(409, "gone", overPressLine(c, body.choice === "keep" ? "Keep" : "Switch"));
  }
  // The press names the offer its page showed. Missing, unknown or not the newest open one: the newest open offer is decided on,
  // after the "changed the terms again" stop-once. Only with no open offer at all is it refused, and never as "doesn't exist".
  // Order: refusals → box → field mistakes. That refusal comes before the tester's stop-once box, never after it.
  const asked = typeof body.offerId === "string" && body.offerId ? await db.termsOffer.findUnique({ where: { id: body.offerId } }) : null;
  const offer = asked && asked.contractId === contractId ? asked : null;
  const noOffer = async () => {
    const newest = await openOffer(contractId);
    if (newest) return newest;
    const now = asked ? await db.termsOffer.findUnique({ where: { id: asked.id } }) : null;
    const mine = now && now.contractId === contractId ? now : offer;
    if (mine?.status === "switched") throw new HttpError(409, "gone", "You already switched to these terms.");
    if (mine?.status === "kept") throw new HttpError(409, "gone", "You already decided on these terms.");
    throw new HttpError(409, "gone", NO_LONGER_ON_OFFER);
  };
  await noOffer();
  await testerGate(c.testerId, contractId, c.testId, body, undefined, { skipTerms: true });
  const newest = await noOffer(); // read again after the box (decided in another tab while it showed)
  // (Owner, Dec 10 2026) A second press (from the "changed the terms again" box) skips that stop only for terms that existed when its box was made (`boxAt`,
  // the box's server time, compared as the other boxAt checks do): terms that arrived after the box stop it once again, naming them; never switched to unseen.
  const boxAt = seenOf(body.boxAt);
  const secondPress = body.confirmed === true && !(boxAt && newest.createdAt > boxAt);
  if ((!offer || offer.id !== newest.id) && !secondPress) {
    throw new HttpError(409, "stop_once", "Press again to go ahead.", { top: true, changes: [{ text: `${displayName(c.test.developer)} changed the terms again: ${newest.diff}`, at: newest.createdAt }], offerId: newest.id, tail: "Press again to decide on these newest terms.",
      // Her Alerts (`alertsOff`); and the rule the box was built under, so with Alerts Off a line picked up live joins it only if it
      // always stops (Switch / Keep are about no part).
      ...(await testerBoxRule(tester.id)) });
  }
  const target = newest;
  body.offerId = target.id;
  const now = new Date();
  if (body.choice === "switch") {
    // Switch never writes the questions: they follow the listing on every Save (followQuestions), so an older offer can never put stale
    // questions back into the contract.
    // Nor the NDA: it follows the listing too (a Save copies it into every working contract), so an older offer never writes one back.
    const { questions: _offered, ndaText: _nda, ...terms } = termsOf(target);
    void _offered; void _nda;
    await db.$transaction([
      db.contract.update({
        where: { id: contractId },
        data: { ...terms, listingVersion: target.listingVersion, // With an Open until, each tester's deadline is their join + the tester days (an Edit moving Open until already moved it): switching never moves it.
        dueAt: c.test.openUntil ? c.dueAt : newDueAt(c.dueAt, c.joinedAt, target.deadlineDays), termsSwitchedAt: now },
      }),
      db.termsOffer.update({ where: { id: target.id }, data: { status: "switched", decidedAt: now } }),
    ]);
    // One quiet line in the developer's live box (not a stop-once kind); several a day stack.
    await logEvent(c.testId, "terms", switchedLine(1, await nameOf(c.testerId)), c.id, testerRow(c.id)); // the place the line opens
    // The developer's bell too, in the same words ("Ana Silva switched to the new terms"), linking to the tester's row; the day's switches on a
    // test stack in one entry, as the top box stacks them.
    await bell(c.test.developerId, switchedLine(1, await nameOf(c.testerId)), `/app/tests/${c.testId}#tester-${c.id}`, undefined, { side: "developer", testId: c.testId });
    return { switched: true };
  }
  await db.termsOffer.update({ where: { id: target.id }, data: { status: "kept", decidedAt: now } });
  // Keep: the developer is told nothing (the tester row still reads "On their terms from <date>").
  return { switched: false };
}

/**
 * Switching to terms whose questions changed (even one of them): the whole earlier set (every question with the answer it had, the
 * draft's if one is kept, else what was sent) becomes a previous set "until <date>". The form then shows the current questions: an answer to a question whose text is
 * unchanged is carried over (draft text too); changed or new questions start empty.
 * Questions follow the listing (Switch never writes them): a Save that changes them calls this for every working contract, in
 * the Save's own transaction (`tx`), and writes the new questions into the contract (`Contract.questions`, still "this tester's questions"). Every change is a
 * Terms history entry: the earlier set is always kept, with `to` (the questions after) and its "sent" / "draft" versions (the draft snapshot). A question
 * that comes back with no answer gets the draft snapshotted for it at an earlier change back into the kept draft. No "Sent for the questions until" mark
 * (an answered question can be added to straight away). Returns whether the contract's questions changed (by their words).
 */
export async function followQuestions(tx: Prisma.TransactionClient, c: { id: string; testerId: string; questions: unknown; prevSets: unknown }, next: string[], now: Date) {
  const old = (c.questions as string[]) ?? [];
  // Compared by the questions' words only: a Required tick added or removed (or the old "[not required] " marker going) is written
  // into the contract but makes no earlier set.
  // Order doesn't matter: the same words in another order are not a change either (the new order is written, no earlier set).
  if (sameQuestionWords(old, next)) {
    if (JSON.stringify(old) !== JSON.stringify(next)) await tx.contract.update({ where: { id: c.id }, data: { questions: next as Prisma.InputJsonValue } });
    return false;
  }
  const sub = await tx.submission.findUnique({ where: { contractId_kind: { contractId: c.id, kind: "written" } }, include: { review: true } });
  const kept = await tx.keptForm.findUnique({ where: { userId_key: { userId: c.testerId, key: `written:${c.id}` } } });
  const draft = (kept?.data ?? null) as { answers?: unknown; notes?: unknown; questions?: unknown } | null;
  // The latest answers sent, by the question's words (over everything sent, so a question that came back keeps its answer).
  const oldQs = old.length ? old : ["Your feedback"];
  const sentNow = sub ? carriedAnswers(sub, oldQs).map((a) => a ?? "") : oldQs.map(() => "");
  // A per-field draft lists only the questions typed since: the others count as what was sent.
  const fromDraft = Array.isArray(draft?.answers) ? restoreDraft(oldQs, sentNow, draft!) : null;
  const items = itemsFor(oldQs, fromDraft ?? sentNow);
  // The set keeps what was SENT ("Sent <date>") and, when the tester edited it afterwards without sending, the draft ("Draft (not
  // sent)"). The developer only ever sees sent versions (theirs come from the submission).
  const sentItems = sub ? itemsFor(oldQs, sentNow) : null;
  const draftItems = fromDraft ? itemsFor(oldQs, fromDraft) : null;
  const draftDiffers = !!draftItems && (!sentItems || JSON.stringify(draftItems.map((x) => x.answer)) !== JSON.stringify(sentItems.map((x) => x.answer))) && draftItems.some((x) => x.answer.trim());
  const versions = [...(sentItems ? [{ kind: "sent" as const, at: (sub!.updatedAt ?? sub!.sentAt).toISOString(), items: sentItems }] : []), ...(draftDiffers ? [{ kind: "draft" as const, ...(kept?.updatedAt ? { at: kept.updatedAt.toISOString() } : {}), items: draftItems! }] : [])];
  const nextQs = next.length ? next : ["Your feedback"];
  // A question that comes back with no answer gets its box back with the draft snapshotted for it at an earlier change (newest first), if any.
  const snapshots = prevSetsOf(c.prevSets).flatMap((p) => (p.versions ?? []).filter((v) => v.kind === "draft").map((v) => v.items));
  const fromNow = carryOver(itemsFor(oldQs, fromDraft ?? oldQs.map(() => "")), nextQs);
  const carried = fromNow.map((a, i) => a || (snapshots.map((set) => set.find((x) => qText(x.question) === qText(nextQs[i]))?.answer ?? "").find((x) => x.trim()) ?? ""));
  await tx.contract.update({ where: { id: c.id }, data: {
    questions: next as Prisma.InputJsonValue,
    prevSets: pushPrev(prevSetsOf(c.prevSets), { until: now.toISOString(), items, ...(versions.length ? { versions } : {}), to: next }) as unknown as Prisma.InputJsonValue,
  } });
  // The kept draft: the boxes typed for questions still asked stay (by their words), a returning question's snapshot comes back; nothing sent is put in it.
  if (fromDraft || carried.some((a) => a)) {
    const notes = typeof draft?.notes === "string" ? draft.notes : "";
    const data = { answers: carried, ...(typeof draft?.notes === "string" ? { notes } : {}), questions: nextQs };
    await tx.keptForm.upsert({ where: { userId_key: { userId: c.testerId, key: `written:${c.id}` } }, update: { data }, create: { userId: c.testerId, key: `written:${c.id}`, data } });
  }
  return true;
}

/** Developer's tester row: "On their original terms · offered new terms Oct 22" / "Switched to the Oct 22 terms". In the tester's pronoun ("On her original terms"). */
export async function termsRowLines(contractIds: string[]) {
  const [offers, contracts] = await Promise.all([
    db.termsOffer.findMany({ where: { contractId: { in: contractIds } }, orderBy: { createdAt: "desc" } }),
    db.contract.findMany({ where: { id: { in: contractIds } }, select: { id: true, termsSwitchedAt: true, status: true, tester: { select: { pronoun: true } } } }),
  ]);
  const out = new Map<string, string>();
  for (const c of contracts) {
    const latest = offers.find((o) => o.contractId === c.id);
    if (c.termsSwitchedAt) out.set(c.id, `Switched to the ${fmtDate(c.termsSwitchedAt).replace(/, \d{4}$/, "")} terms`);
    // An offer left unanswered when their part ended reads closed (an older row still "open" on an ended part too).
    else if (latest) out.set(c.id, `On ${pronouns(c.tester.pronoun).poss} original terms · offered new terms ${fmtDate(latest.createdAt).replace(/, \d{4}$/, "")}${latest.status === "kept" ? ` (kept ${pronouns(c.tester.pronoun).poss} terms)` : latest.status === "closed" || (latest.status === "open" && c.status !== "working") ? ` (closed: ${pronouns(c.tester.pronoun).poss} part ended)` : ""}`);
  }
  return out;
}
