import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, fmtDate } from "@/lib/format";
import { newDueAt, termsDiff, type ContractTerms } from "@/lib/rules";
import { HttpError } from "./http";
import { notify } from "./notify";
import { testerGate } from "./testerGate";
import { logEvent } from "./live";

const nameOf = async (id: string) => displayName(await db.user.findUniqueOrThrow({ where: { id } }));

// New terms offered to working testers (owner rule): an Edit that changes contract terms offers them to every working
// tester; their contract changes only if they switch. Work already sent keeps its price; the deadline never moves earlier.

const termsOf = (x: { ndaText: string; writtenCents: number | null; recordingCents: number | null; liveRateCents: number | null; liveMinutes: number | null; deadlineDays: number; questions: unknown; writtenRequired: boolean; recordingRequired: boolean; liveRequired: boolean }): ContractTerms => ({
  ndaText: x.ndaText ?? "", writtenCents: x.writtenCents, recordingCents: x.recordingCents, liveRateCents: x.liveRateCents, liveMinutes: x.liveMinutes, deadlineDays: x.deadlineDays, questions: (x.questions as string[]) ?? [],
  writtenRequired: x.writtenRequired, recordingRequired: x.recordingRequired, liveRequired: x.liveRequired,
});

/** After an Edit: offer the test's current terms to each working tester whose contract differs. Returns how many. */
export async function offerNewTerms(testId: string) {
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
        contractId: c.id, testId, listingVersion: t.listingVersion, ...newTerms, questions: newTerms.questions as Prisma.InputJsonValue, diff,
        // The terms the tester is on when this is offered stay in their terms history (previous questions and NDA).
        fromQuestions: c.questions as Prisma.InputJsonValue, fromNdaText: c.ndaText,
      },
    });
    const line = `${displayName(t.developer)} updated the listing: ${diff}`;
    await notify(c.tester.email, line, [line + ".", "Switch to the new terms or keep your current ones on your session page. Work you've already sent keeps its price."], `/app/sessions/${c.id}`, { about: t.developerId });
    offered++;
  }
  return offered;
}

/** The newest open offer for a contract, if any. */
export const openOffer = (contractId: string) => db.termsOffer.findFirst({ where: { contractId, status: "open" }, orderBy: { createdAt: "desc" } });

/**
 * Tester-side stop once (box at the TOP of the session page): Send and Charge / Let it go stop once if new terms were
 * offered since the page loaded. The second press goes ahead under the current terms.
 */
export async function testerTermsGate(contractId: string, _devName: string, body: Record<string, unknown>) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: contractId } });
  const fresh = typeof body.seenAt === "string" ? await db.termsOffer.count({ where: { contractId, createdAt: { gt: new Date(body.seenAt) } } }) : 0;
  await testerGate(c.testerId, contractId, c.testId, body, fresh ? "Press again to send under your current terms, or switch first." : "Press again to go ahead.");
}

/** Switch to the offered terms, or keep the current ones. Stops once if the terms changed again since (shows the newest). */
export async function decideTerms(tester: { id: string }, contractId: string, body: Record<string, unknown>) {
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { test: { include: { developer: true } } } });
  if (!c || c.testerId !== tester.id) throw new HttpError(404, "not_found", "That session doesn't exist or isn't yours.");
  await testerGate(c.testerId, contractId, c.testId, body, undefined, { skipTerms: true });
  const offer = await db.termsOffer.findUnique({ where: { id: String(body.offerId ?? "") } });
  if (!offer || offer.contractId !== contractId) throw new HttpError(404, "not_found", "That offer doesn't exist.");
  const newest = await openOffer(contractId);
  if (offer.status !== "open" || (newest && newest.id !== offer.id)) {
    if (newest && body.confirmed !== true) {
      throw new HttpError(409, "stop_once", "Press again to go ahead.", { top: true, changes: [{ text: `${displayName(c.test.developer)} changed the terms again: ${newest.diff}`, at: newest.createdAt }], offerId: newest.id, tail: "Press again to decide on these newest terms." });
    }
    if (!newest) throw new HttpError(409, "gone", offer.status === "switched" ? "You already switched to these terms." : "You already decided on these terms.");
  }
  const target = newest ?? offer;
  const now = new Date();
  if (body.choice === "switch") {
    await db.$transaction([
      db.contract.update({
        where: { id: contractId },
        // Switching to terms with an NDA means accepting it now.
        data: { ...termsOf(target), questions: target.questions as Prisma.InputJsonValue, listingVersion: target.listingVersion, dueAt: newDueAt(c.dueAt, c.joinedAt, target.deadlineDays), termsSwitchedAt: now, ndaAcceptedAt: target.ndaText ? (target.ndaText === c.ndaText ? c.ndaAcceptedAt ?? now : now) : null },
      }),
      db.termsOffer.update({ where: { id: target.id }, data: { status: "switched", decidedAt: now } }),
    ]);
    await logEvent(c.testId, "terms", `${await nameOf(c.testerId)} switched to the new terms`, c.id);
    return { switched: true };
  }
  await db.termsOffer.update({ where: { id: target.id }, data: { status: "kept", decidedAt: now } });
  await logEvent(c.testId, "terms", `${await nameOf(c.testerId)} kept their current terms`, c.id);
  return { switched: false };
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
