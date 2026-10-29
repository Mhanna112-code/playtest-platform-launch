import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, fmtDate } from "@/lib/format";
import { newDueAt, switchedLine, termsDiff, testerRefusal, type ContractTerms } from "@/lib/rules";
import { ANSWER_TERMS_CODE, ANSWER_TERMS_FIRST } from "@/lib/answerTerms";
import { HttpError } from "./http";
import { notify } from "./notify";
import { testerGate } from "./testerGate";
import { logEvent } from "./live";
import { carryOver, itemsFor, itemsOf, prevSetsOf, pushPrev, restoreDraft } from "@/lib/answerSets";
import { qText } from "@/lib/questions";

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
    // (5) Shortening the deadline applies to new testers only and is ignored here: an existing tester is only ever offered more time.
    const newTerms = { ...termsOf(t), deadlineDays: Math.max(c.deadlineDays, t.deadlineDays) };
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
  const offer = await openOffer(contractId);
  if (offer) throw new HttpError(409, ANSWER_TERMS_CODE, ANSWER_TERMS_FIRST, { offerId: offer.id });
}

/** (Batch 27 section 1) Send's own stop-once, after answerTermsFirst: every other reason as before; new terms are no longer a stop-once for it (they block). */
export async function testerSendGate(contractId: string, body: Record<string, unknown>) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId } });
  await testerGate(c.testerId, contractId, c.testId, body, undefined, { skipTerms: true });
}

/**
 * Tester-side stop once (box at the TOP of the session page): Charge / Let it go stop once if new terms were offered since the page loaded (batch 27: Send
 * no longer does; an open offer blocks it). The second press goes ahead under the current terms.
 */
export async function testerTermsGate(contractId: string, _devName: string, body: Record<string, unknown>) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId } });
  const fresh = typeof body.seenAt === "string" ? await db.termsOffer.count({ where: { contractId, createdAt: { gt: new Date(body.seenAt) } } }) : 0;
  await testerGate(c.testerId, contractId, c.testId, body, fresh ? "Press again to send under your current terms, or switch first." : "Press again to go ahead.");
}

/** (Batch 16 section 38A) Switch / Keep when no offer is open any more. */
export const NO_LONGER_ON_OFFER = "These terms are no longer on offer.";

/** Switch to the offered terms, or keep the current ones. Stops once if the terms changed again since (shows the newest). */
export async function decideTerms(tester: { id: string }, contractId: string, body: Record<string, unknown>) {
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { test: { include: { developer: true } } } });
  if (!c || c.testerId !== tester.id) throw new HttpError(404, "not_found", "That session doesn't exist or isn't yours.");
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
  const now = new Date();
  if (body.choice === "switch") {
    const sets = await questionSetsOnSwitch(c, (target.questions as string[]) ?? [], now);
    await db.$transaction([
      ...sets,
      db.contract.update({
        where: { id: contractId },
        // Switching to terms with an NDA means accepting it now.
        data: { ...termsOf(target), questions: target.questions as Prisma.InputJsonValue, listingVersion: target.listingVersion, // (Batch 15 section 18) With an Open until, each tester's deadline is their join + the tester days (an Edit moving Open until already moved it): switching never moves it.
        dueAt: c.test.openUntil ? c.dueAt : newDueAt(c.dueAt, c.joinedAt, target.deadlineDays), termsSwitchedAt: now, ndaAcceptedAt: target.ndaText ? (target.ndaText === c.ndaText ? c.ndaAcceptedAt ?? now : now) : null },
      }),
      db.termsOffer.update({ where: { id: target.id }, data: { status: "switched", decidedAt: now } }),
    ]);
    // (Batch 14 section 4) One quiet line in the developer's live box (not a stop-once kind); several a day stack.
    await logEvent(c.testId, "terms", switchedLine(1, await nameOf(c.testerId)), c.id);
    return { switched: true };
  }
  await db.termsOffer.update({ where: { id: target.id }, data: { status: "kept", decidedAt: now } });
  // (Batch 14 section 4) Keep: the developer is told nothing (the tester row still reads "On their terms from <date>").
  return { switched: false };
}

/**
 * (Owner, Oct 29, batch 13 section 8) Switching to terms whose questions changed (even one of them): the whole earlier set (every question with the answer it had, the
 * draft's if one is kept, else what was sent) becomes a previous set "until <date>" (at most 3). The form then shows the current questions: an answer to a question
 * whose text is unchanged is carried over (draft text too); changed or new questions start empty. A sent, unpaid set for the old questions is marked "Sent for the
 * questions until <date>" for the developer, and keeps its price.
 */
async function questionSetsOnSwitch(c: { id: string; testerId: string; questions: unknown; prevSets: unknown }, next: string[], now: Date) {
  const old = (c.questions as string[]) ?? [];
  // (Batch 26 sections 14 and 15) Compared by the questions' words only: a Required tick added or removed (or the old "[not required] " marker going) never moves the
  // current set into "Previous questions and answers".
  if (JSON.stringify(old.map(qText)) === JSON.stringify(next.map(qText))) return [];
  const sub = await db.submission.findUnique({ where: { contractId_kind: { contractId: c.id, kind: "written" } }, include: { review: true } });
  const kept = await db.keptForm.findUnique({ where: { userId_key: { userId: c.testerId, key: `written:${c.id}` } } });
  const draft = (kept?.data ?? null) as { answers?: unknown; notes?: unknown; questions?: unknown } | null;
  const sent = sub ? itemsOf(sub.answers, old) : [];
  const oldQs = old.length ? old : ["Your feedback"];
  const fromDraft = Array.isArray(draft?.answers) ? restoreDraft(oldQs, [], draft!) : null;
  const byText = new Map(sent.map((x) => [x.question, x.answer]));
  const items = itemsFor(oldQs, fromDraft ?? oldQs.map((q) => byText.get(qText(q)) ?? ""));
  // (Owner, Oct 30, batch 15 section 14) The set keeps what was SENT ("Sent <date>") and, when the tester edited it afterwards without sending, the draft ("Draft (not
  // sent)"). The developer only ever sees sent versions (theirs come from the submission).
  const sentItems = sub ? itemsFor(oldQs, oldQs.map((q) => byText.get(qText(q)) ?? "")) : null;
  const draftItems = fromDraft ? itemsFor(oldQs, fromDraft) : null;
  const draftDiffers = !!draftItems && (!sentItems || JSON.stringify(draftItems.map((x) => x.answer)) !== JSON.stringify(sentItems.map((x) => x.answer))) && draftItems.some((x) => x.answer.trim());
  const versions = [...(sentItems ? [{ kind: "sent" as const, at: (sub!.updatedAt ?? sub!.sentAt).toISOString(), items: sentItems }] : []), ...(draftDiffers ? [{ kind: "draft" as const, ...(kept?.updatedAt ? { at: kept.updatedAt.toISOString() } : {}), items: draftItems! }] : [])];
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (items.some((x) => x.answer.trim()) || sub) ops.push(db.contract.update({ where: { id: c.id }, data: { prevSets: pushPrev(prevSetsOf(c.prevSets), { until: now.toISOString(), items, ...(versions.length ? { versions } : {}) }) as unknown as Prisma.InputJsonValue } }));
  const nextQs = next.length ? next : ["Your feedback"];
  if (!sub?.review) {
    const notes = typeof draft?.notes === "string" ? draft.notes : sub?.notes ?? "";
    ops.push(db.keptForm.upsert({ where: { userId_key: { userId: c.testerId, key: `written:${c.id}` } }, update: { data: { answers: carryOver(items, nextQs), notes, questions: nextQs } }, create: { userId: c.testerId, key: `written:${c.id}`, data: { answers: carryOver(items, nextQs), notes, questions: nextQs } } }));
    if (sub && !sub.setUntil) ops.push(db.submission.update({ where: { id: sub.id }, data: { setUntil: now } }));
  }
  return ops;
}

/** Developer's tester row: "On their original terms · offered new terms Oct 22" / "Switched to the Oct 22 terms". */
export async function termsRowLines(contractIds: string[]) {
  const [offers, contracts] = await Promise.all([
    db.termsOffer.findMany({ where: { contractId: { in: contractIds } }, orderBy: { createdAt: "desc" } }),
    db.contract.findMany({ where: { id: { in: contractIds } }, select: { id: true, termsSwitchedAt: true } }),
  ]);
  const out = new Map<string, string>();
  for (const c of contracts) {
    const latest = offers.find((o) => o.contractId === c.id);
    if (c.termsSwitchedAt) out.set(c.id, `Switched to the ${fmtDate(c.termsSwitchedAt).replace(/, \d{4}$/, "")} terms`);
    else if (latest) out.set(c.id, `On their original terms · offered new terms ${fmtDate(latest.createdAt).replace(/, \d{4}$/, "")}${latest.status === "kept" ? " (kept their terms)" : ""}`);
  }
  return out;
}
