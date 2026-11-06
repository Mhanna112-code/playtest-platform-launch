import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, fmtDate, pronouns } from "@/lib/server/dateFormat";
import { newDueAt, switchedLine, termsDiff, testerRefusal, type ContractTerms, type TestEventLike } from "@/lib/rules";
import { ANSWER_TERMS_CODE, ANSWER_TERMS_FIRST } from "@/lib/answerTerms";
import { HttpError } from "./http";
import { bell, notify } from "./notify";
import { testerGate } from "./testerGate";
import { logEvent } from "./live";
import { carryOver, itemsFor, prevSetsOf, pushPrev, restoreDraft } from "@/lib/answerSets";
import { carriedAnswers } from "@/lib/additions";
import { qText, sameQuestionWords } from "@/lib/questions";
import { closeOffersOfEnded } from "./offerClose";
import { NDA_BLOCK_CODE, NDA_BLOCK_FIRST, ndaBlocked, ndaChangeOf } from "@/lib/ndaNotice";
import { testerRow } from "@/lib/lineAnchors";
export { closeOffersOfEnded };

const nameOf = async (id: string) => displayName(await db.user.findUniqueOrThrow({ where: { id } }));

// New terms offered to working testers (owner rule): an Edit that changes contract terms offers them to every working
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
    // (5) Shortening the deadline applies to new testers only and is ignored here: an existing tester is only ever offered more time. (Owner, Nov 5, §265) The
    // questions are not a term any more: the offer carries the contract's own (the Save already wrote the listing's into it), so they're never in its diff.
    // (Owner, Nov 5, §267) Nor the NDA: the offer carries the contract's own (the Save already copied the listing's into it).
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
    await notify(c.tester.email, line, [line + ".", "Switch to the new terms or keep your current ones on your session page. Work you've already sent keeps its price."], `/app/sessions/${c.id}#terms-offer`, { about: t.developerId, group: "newterms" }); // (batch 29 §25) "New terms to answer", across tests
    offered++;
  }
  return offered;
}

/** (Owner, Nov 2, batch 35 §118) Switch / Keep pressed after the tester's part ended (rated, left, removed, stopped, the work window ended). */
export const PART_ENDED_TERMS = "Your part on this test has ended, so these terms no longer apply.";

/**
 * (Owner, Nov 5, §267) The NDA block: an NDA change the tester hasn't acknowledged refuses every press of theirs on the test (Rate and Leave never come here, §268).
 * (Owner, Nov 6, §302) Every change blocks (added, removed or changed), refused like an open contract change: one line, "Acknowledge the NDA change first.", and
 * the page goes up to the NDA notice and marks it (`sessionId`: a Join call away from the session page links there).
 */
export function ndaBlockCheck(c: { id: string; ndaChangedAt: Date | null; ndaChangeKind: string; ndaNoticeSeenAt: Date | null }) {
  if (ndaBlocked(c)) throw new HttpError(409, NDA_BLOCK_CODE, NDA_BLOCK_FIRST, { sessionId: c.id });
}
export { NDA_BLOCK_CODE };
/** (§267) The block for a press by contract id (the session route's presses). */
export async function ndaBlockFirst(contractId: string) {
  const c = await db.contract.findUnique({ where: { id: contractId }, select: { id: true, ndaChangedAt: true, ndaChangeKind: true, ndaNoticeSeenAt: true } });
  if (c) ndaBlockCheck(c);
}
/**
 * (Owner, Nov 5, §267) A Save changed the NDA: every working contract takes the listing's at once (no Switch / Keep), with the change's kind and time for its
 * notice and block. An added or removed NDA clears `ndaAcceptedAt` (an added one counts as accepted once its notice is opened); a changed text keeps it.
 * Returns the contracts changed.
 */
export async function followNda(tx: Prisma.TransactionClient, testId: string, before: string, after: string, now: Date) {
  const kind = ndaChangeOf(before, after);
  if (!kind) return [];
  const cs = await tx.contract.findMany({ where: { testId, status: "working" }, select: { id: true, tester: { select: { email: true } } } });
  if (cs.length) await tx.contract.updateMany({ where: { id: { in: cs.map((c) => c.id) } }, data: { ndaText: after, ...(kind === "changed" ? {} : { ndaAcceptedAt: null }), ndaChangedAt: now, ndaChangeKind: kind } });
  // (Owner, Nov 6, §283) Every other contract on the test (left, ended) takes the listing's NDA text too, with no notice or block (nothing to press there); one
  // who rejoins accepts the listing's NDA on joining as usual.
  await tx.contract.updateMany({ where: { testId, status: { not: "working" } }, data: { ndaText: after } });
  return cs.map((c) => ({ contractId: c.id, email: c.tester.email, kind }));
}

/**
 * (Owner, Nov 6, §283) Existing data: a contract that isn't working (left, ended) and that no Save reached (before §283 only working contracts followed) still
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
 * (Owner, Oct 29, batch 27 section 1) An open offer blocks Send (written answers, recordings) and every call press (Request a time, Accept, Decline, Withdraw,
 * Cancel call, Cancel the remaining calls, Join call) until the tester answers it: Switch or Keep both unlock. Every press is refused the same way (no second press
 * gets through), from an old page that hasn't shown the offer too, and with Alerts Off (an offer is about the tester's own contract). A newer Save replaces the
 * offer (still blocked until the newest is answered); an offer whose work closed (the test stopped or closed, the tester's work ended, they left) blocks nothing.
 */
export async function answerTermsFirst(contractId: string) {
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { test: { include: { developer: true } } } });
  if (!c || testerRefusal(c, c.test, displayName(c.test.developer), fmtDate, new Date())) return;
  // (Owner, Nov 5, §267; §302: every NDA change) An NDA change the tester hasn't acknowledged blocks the press first (calls too, which come through here).
  ndaBlockCheck(c);
  const offer = await openOffer(contractId);
  // (Batch 29 section 20) `sessionId`: a Join call refused away from the session page (the dashboard's Upcoming calls) links to the Switch / Keep box there.
  if (offer) throw new HttpError(409, ANSWER_TERMS_CODE, ANSWER_TERMS_FIRST, { offerId: offer.id, sessionId: contractId });
}

/**
 * (Batch 27 section 1) Send's own stop-once, after answerTermsFirst: every other reason as before; new terms are no longer a stop-once for it (they block).
 * (Owner, Nov 4, §183) `piece`: the sent part this press adds to (its submission id; none for a first Send): a developer payment on it since the page loaded stops
 * once whatever the tester's Alerts. `skipTerms` only drops the terms lines (an open offer already blocked the press), so the piece needs nothing more there.
 */
export async function testerSendGate(contractId: string, body: Record<string, unknown>, piece?: string, written?: { stale?: TestEventLike[] }) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId } });
  await (await import("./workWindow")).finishWorkIfDue(c.testId);
  await (await import("./workWindow")).assertWorkOpen(db, c.testId);
  // (Owner, Nov 5, §269) Send Answers and Add to this answer (`written`) list a questions change question by question; a page whose questions are no longer the
  // contract's (`written.stale`: what changed) always stops once, and the page then takes the new questions.
  await testerGate(c.testerId, contractId, c.testId, body, undefined, { skipTerms: true, sendPiece: piece, questionLines: !!written, staleQuestions: written?.stale });
}

/**
 * Tester-side stop once (box at the TOP of the session page): Charge / Let it go stop once if new terms were offered since the page loaded (batch 27: Send
 * no longer does; an open offer blocks it). The second press goes ahead under the current terms.
 */
export async function testerTermsGate(contractId: string, _devName: string, body: Record<string, unknown>, piece?: string) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId } });
  const fresh = typeof body.seenAt === "string" ? await db.termsOffer.count({ where: { contractId, createdAt: { gt: new Date(body.seenAt) } } }) : 0;
  // (§159 rule 4) Charge / Let it go on `piece`: a developer payment on it, or the team's decision on any of the tester's disputes, stops once whatever their Alerts.
  await testerGate(c.testerId, contractId, c.testId, body, fresh ? "Press again to go ahead under your current terms, or switch first." : "Press again to go ahead.", { owedPiece: piece });
}

/** (Batch 16 section 38A) Switch / Keep when no offer is open any more. */
export const NO_LONGER_ON_OFFER = "These terms are no longer on offer.";

/** Switch to the offered terms, or keep the current ones. Stops once if the terms changed again since (shows the newest). */
export async function decideTerms(tester: { id: string }, contractId: string, body: Record<string, unknown>) {
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { test: { include: { developer: true } } } });
  if (!c || c.testerId !== tester.id) throw new HttpError(404, "not_found", "That session doesn't exist or isn't yours.");
  // (Owner, Nov 2, batch 35 §118) A part that ended has no terms to decide: an old page's Switch / Keep is refused plainly (and any offer still open closes).
  if (c.status !== "working") {
    await closeOffersOfEnded(db, [contractId], c.endedAt ?? new Date());
    throw new HttpError(409, "gone", PART_ENDED_TERMS);
  }
  await testerGate(c.testerId, contractId, c.testId, body, undefined, { skipTerms: true });
  // (Owner, Oct 28, batch 16 section 38A) The press names the offer its page showed. Missing, unknown or not the newest open one: the newest open offer is decided on,
  // after the "changed the terms again" stop-once. Only with no open offer at all is it refused, and never as "doesn't exist".
  const asked = typeof body.offerId === "string" && body.offerId ? await db.termsOffer.findUnique({ where: { id: body.offerId } }) : null;
  const offer = asked && asked.contractId === contractId ? asked : null;
  const newest = await openOffer(contractId);
  if (!newest) {
    if (offer?.status === "switched") throw new HttpError(409, "gone", "You already switched to these terms.");
    if (offer?.status === "kept") throw new HttpError(409, "gone", "You already decided on these terms.");
    throw new HttpError(409, "gone", NO_LONGER_ON_OFFER);
  }
  if ((!offer || offer.id !== newest.id) && body.confirmed !== true) {
    throw new HttpError(409, "stop_once", "Press again to go ahead.", { top: true, changes: [{ text: `${displayName(c.test.developer)} changed the terms again: ${newest.diff}`, at: newest.createdAt }], offerId: newest.id, tail: "Press again to decide on these newest terms.", alertsOff: !!(await db.user.findUnique({ where: { id: tester.id }, select: { testerAlertsOff: true } }))?.testerAlertsOff }); // (batch 17 section 13)
  }
  const target = newest;
  body.offerId = target.id;
  const now = new Date();
  if (body.choice === "switch") {
    // (Owner, Nov 5, §265) Switch never writes the questions: they follow the listing on every Save (followQuestions), so an older offer can never put stale
    // questions back into the contract.
    // (Owner, Nov 5, §267) Nor the NDA: it follows the listing too (a Save copies it into every working contract), so an older offer never writes one back.
    const { questions: _offered, ndaText: _nda, ...terms } = termsOf(target);
    void _offered; void _nda;
    await db.$transaction([
      db.contract.update({
        where: { id: contractId },
        data: { ...terms, listingVersion: target.listingVersion, // (Batch 15 section 18) With an Open until, each tester's deadline is their join + the tester days (an Edit moving Open until already moved it): switching never moves it.
        dueAt: c.test.openUntil ? c.dueAt : newDueAt(c.dueAt, c.joinedAt, target.deadlineDays), termsSwitchedAt: now },
      }),
      db.termsOffer.update({ where: { id: target.id }, data: { status: "switched", decidedAt: now } }),
    ]);
    // (Batch 14 section 4) One quiet line in the developer's live box (not a stop-once kind); several a day stack.
    await logEvent(c.testId, "terms", switchedLine(1, await nameOf(c.testerId)), c.id, testerRow(c.id)); // (Owner, Nov 6, §284) the place the line opens
    // (Owner, Nov 6, §286) The developer's bell too, in the same words ("Ana Silva switched to the new terms"), linking to the tester's row; the day's switches on a
    // test stack in one entry, as the top box stacks them.
    await bell(c.test.developerId, switchedLine(1, await nameOf(c.testerId)), `/app/tests/${c.testId}#tester-${c.id}`, undefined, { side: "developer", testId: c.testId });
    return { switched: true };
  }
  await db.termsOffer.update({ where: { id: target.id }, data: { status: "kept", decidedAt: now } });
  // (Batch 14 section 4) Keep: the developer is told nothing (the tester row still reads "On their terms from <date>").
  return { switched: false };
}

/**
 * (Owner, Oct 29, batch 13 section 8) Switching to terms whose questions changed (even one of them): the whole earlier set (every question with the answer it had, the
 * draft's if one is kept, else what was sent) becomes a previous set "until <date>". The form then shows the current questions: an answer to a question whose text is
 * unchanged is carried over (draft text too); changed or new questions start empty.
 * (Owner, Nov 5, §265; replaces the Switch above for questions) Questions follow the listing: a Save that changes them calls this for every working contract, in
 * the Save's own transaction (`tx`), and writes the new questions into the contract (`Contract.questions`, still "this tester's questions"). Every change is a
 * Terms history entry (§263): the earlier set is always kept, with `to` (the questions after) and its "sent" / "draft" versions (the draft snapshot). A question
 * that comes back with no answer gets the draft snapshotted for it at an earlier change back into the kept draft. No "Sent for the questions until" mark any more
 * (an answered question can be added to straight away). Returns whether the contract's questions changed (by their words).
 */
export async function followQuestions(tx: Prisma.TransactionClient, c: { id: string; testerId: string; questions: unknown; prevSets: unknown }, next: string[], now: Date) {
  const old = (c.questions as string[]) ?? [];
  // (Batch 26 sections 14 and 15) Compared by the questions' words only: a Required tick added or removed (or the old "[not required] " marker going) is written
  // into the contract but makes no earlier set.
  // (Owner, Nov 5, §269) Order doesn't matter: the same words in another order are not a change either (the new order is written, no earlier set).
  if (sameQuestionWords(old, next)) {
    if (JSON.stringify(old) !== JSON.stringify(next)) await tx.contract.update({ where: { id: c.id }, data: { questions: next as Prisma.InputJsonValue } });
    return false;
  }
  const sub = await tx.submission.findUnique({ where: { contractId_kind: { contractId: c.id, kind: "written" } }, include: { review: true } });
  const kept = await tx.keptForm.findUnique({ where: { userId_key: { userId: c.testerId, key: `written:${c.id}` } } });
  const draft = (kept?.data ?? null) as { answers?: unknown; notes?: unknown; questions?: unknown } | null;
  // (Batch 35 §136) The latest answers sent, by the question's words (§263: over everything sent, so a question that came back keeps its answer).
  const oldQs = old.length ? old : ["Your feedback"];
  const sentNow = sub ? carriedAnswers(sub, oldQs).map((a) => a ?? "") : oldQs.map(() => "");
  // (Batch 35 §120) A per-field draft lists only the questions typed since: the others count as what was sent.
  const fromDraft = Array.isArray(draft?.answers) ? restoreDraft(oldQs, sentNow, draft!) : null;
  const items = itemsFor(oldQs, fromDraft ?? sentNow);
  // (Owner, Oct 30, batch 15 section 14) The set keeps what was SENT ("Sent <date>") and, when the tester edited it afterwards without sending, the draft ("Draft (not
  // sent)"). The developer only ever sees sent versions (theirs come from the submission).
  const sentItems = sub ? itemsFor(oldQs, sentNow) : null;
  const draftItems = fromDraft ? itemsFor(oldQs, fromDraft) : null;
  const draftDiffers = !!draftItems && (!sentItems || JSON.stringify(draftItems.map((x) => x.answer)) !== JSON.stringify(sentItems.map((x) => x.answer))) && draftItems.some((x) => x.answer.trim());
  const versions = [...(sentItems ? [{ kind: "sent" as const, at: (sub!.updatedAt ?? sub!.sentAt).toISOString(), items: sentItems }] : []), ...(draftDiffers ? [{ kind: "draft" as const, ...(kept?.updatedAt ? { at: kept.updatedAt.toISOString() } : {}), items: draftItems! }] : [])];
  const nextQs = next.length ? next : ["Your feedback"];
  // (§263) A question that comes back with no answer gets its box back with the draft snapshotted for it at an earlier change (newest first), if any.
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

/** Developer's tester row: "On their original terms · offered new terms Oct 22" / "Switched to the Oct 22 terms". (Batch 35 §162) In the tester's pronoun ("On her original terms"). */
export async function termsRowLines(contractIds: string[]) {
  const [offers, contracts] = await Promise.all([
    db.termsOffer.findMany({ where: { contractId: { in: contractIds } }, orderBy: { createdAt: "desc" } }),
    db.contract.findMany({ where: { id: { in: contractIds } }, select: { id: true, termsSwitchedAt: true, status: true, tester: { select: { pronoun: true } } } }),
  ]);
  const out = new Map<string, string>();
  for (const c of contracts) {
    const latest = offers.find((o) => o.contractId === c.id);
    if (c.termsSwitchedAt) out.set(c.id, `Switched to the ${fmtDate(c.termsSwitchedAt).replace(/, \d{4}$/, "")} terms`);
    // (Batch 35 §118) An offer left unanswered when their part ended reads closed (an older row still "open" on an ended part too).
    else if (latest) out.set(c.id, `On ${pronouns(c.tester.pronoun).poss} original terms · offered new terms ${fmtDate(latest.createdAt).replace(/, \d{4}$/, "")}${latest.status === "kept" ? ` (kept ${pronouns(c.tester.pronoun).poss} terms)` : latest.status === "closed" || (latest.status === "open" && c.status !== "working") ? ` (closed: ${pronouns(c.tester.pronoun).poss} part ended)` : ""}`);
  }
  return out;
}
