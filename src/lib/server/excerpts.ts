import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { plainText } from "@/lib/markdown";
import { itemsOf } from "@/lib/answerSets";
import { excerptWithFiles } from "@/lib/answerAttachments";
import { HttpError } from "./http";
import { bell } from "./notify";

// (Owner, Oct 29, batch 13) Excerpt requests: a tester asks to show a short excerpt of written work the developer PAID for (above $0) on their public profile, and the
// test's developer allows or denies it.
//   - Never from a test that has an NDA NOW (the rule follows the test's current NDA): the button hides, a press from an older page is refused, shown excerpts are hidden
//     from profiles and hover cards. Nothing is deleted: removing the NDA brings them back. (Owner, Oct 28, batch 18 section 7) A request still pending when the test
//     gets an NDA can still be Allowed (or Denied): it's accepted straight into hidden ("Allowed · hidden while <test> has an NDA") and shows once the NDA is removed.
//   - (Batch 18 section 7) No "Don't name the product" tick any more: a new excerpt always reads "From <test>". Excerpts already shown or pending with the product
//     hidden keep their "a <category> test" wording (the tester chose that).
//   - At most 3 shown or pending per tester, and one pending request per part.
//   - Request, Allow, Deny and Remove ignore stop-once and blocks; suspensions and holds don't touch them. Only a request (or excerpt) that no longer exists is refused.
//   - The tester hears of the decision by bell only. (Owner, Oct 29, batch 29 section 30) Only the tester removes an excerpt (Remove on their profile); the developer has no
//     Take down any more, and the tester's Remove sends no bell line.
//   - Deleting an account: a tester's requests and excerpts are removed; a developer's pending requests close (excerpts already shown stay).

export const MAX_EXCERPTS = 3;
export const EXCERPT_MIN = 10;
export const EXCERPT_MAX = 500;
export const TOO_MANY_EXCERPTS = `You can show at most ${MAX_EXCERPTS} excerpts. Remove one first.`;
export const NDA_NO_EXCERPT = "This test now has an NDA, so its work can't be shown as an excerpt.";
/** (Batch 18 section 7) Allowed while the test has an NDA: the tester's list, and the bell. */
export const allowedHiddenLine = (test: string) => `Allowed · hidden while ${test} has an NDA`;
export const allowedUnderNdaLine = (test: string) => `Your excerpt from ${test} was allowed. It stays hidden while ${test} has an NDA.`;
/** The developer's request row while the test has an NDA. */
export const allowUnderNdaNote = (test: string) => `${test} has an NDA now: if you allow this, it stays hidden while ${test} has an NDA.`;
export const ALREADY_DECIDED = "This request was already decided.";
export const ALREADY_DOWN = "This excerpt was already taken down.";
export const ONE_PENDING = "You already asked to show an excerpt from this part. Wait for the developer's answer.";
export const excerptLength = `An excerpt is ${EXCERPT_MIN} to ${EXCERPT_MAX} characters.`;
export const allowedLine = (test: string) => `Your excerpt from ${test} is now on your profile.`;
export const deniedLine = (dev: string, test: string) => `${dev} prefers that work from ${test} isn't shown on profiles.`;
/** (Batch 29 section 30) A developer's Take down pressed on a page loaded before it went. */
export const ONLY_TESTER_REMOVES = "Only the tester can remove an excerpt from their profile.";
export const devDeletedClosedLine = (test: string) => `${test}'s developer deleted their account, so this request was closed`;
export const ndaHiddenLine = (test: string) => `Hidden while ${test} has an NDA`;

/** How the quote names its source: the product's name, or (an older excerpt whose tester ticked "Don't name the product") the kind of test it was. */
export function excerptSource(x: { hideProduct: boolean; test: { productName: string; title: string; categories: string[] } }) {
  if (!x.hideProduct) return x.test.productName || x.test.title;
  // "an education test", "an AI test" (AI keeps its capitals).
  const first = x.test.categories[0] ?? "";
  const cat = first === "AI" ? "AI" : first.toLowerCase();
  return cat ? `${/^[aeiou]/i.test(cat) ? "an" : "a"} ${cat} test` : "a test";
}

/** Whitespace tidied, for comparing a trimmed quote with the answer it came from. */
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Paid for above $0: the developer's Pay (or the tester's Charge), a Pay more, or a dispute decided for the tester. */
async function paidAboveZero(sub: { id: string; review: { rejected: boolean; amountCents: number } | null; dispute: { decidedCents: number | null } | null }) {
  if (sub.review && !sub.review.rejected && sub.review.amountCents > 0) return true;
  if ((sub.dispute?.decidedCents ?? 0) > 0) return true;
  return (await db.payment.count({ where: { submissionId: sub.id, kind: "extra", amountCents: { gt: 0 }, status: { in: ["charged", "not_set_up", "pending", "deferred", "owed", "needs_confirmation"] } } })) > 0;
}

/** The answers of a part the tester could quote (plain text, at least 10 characters), or [] when the part can't be shown. */
export async function excerptChoices(sub: { id: string; kind: string; answers: unknown; review: { rejected: boolean; amountCents: number } | null; dispute: { decidedCents: number | null } | null }) {
  if (sub.kind !== "written" || !(await paidAboveZero(sub))) return [];
  return itemsOf(sub.answers).map((it, i) => ({ index: i, question: it.question, text: plainText(excerptWithFiles(it.answer)) })).filter((x) => x.text.length >= EXCERPT_MIN);
}

/** A tester asks to show an excerpt. No stop-once; refused only for the rules above. */
export async function requestExcerpt(tester: { id: string; name: string; email: string; deletedAt?: Date | null }, body: Record<string, unknown>) {
  const sub = await db.submission.findUnique({ where: { id: String(body.submissionId ?? "") }, include: { review: true, dispute: true, contract: { include: { test: true } } } });
  if (!sub || sub.contract.testerId !== tester.id) throw new HttpError(404, "not_found", "That part doesn't exist or isn't yours.");
  const t = sub.contract.test;
  if (t.ndaText) throw new HttpError(409, "nda", NDA_NO_EXCERPT);
  const choices = await excerptChoices(sub);
  if (!choices.length) throw new HttpError(409, "not_paid", "Only written answers the developer paid for can be shown as excerpts.");
  const pick = choices.find((c) => c.index === Number(body.index));
  if (!pick) throw new HttpError(400, "bad_pick", "Pick one of your answers.");
  const text = squash(plainText(typeof body.text === "string" ? body.text : ""));
  if (text.length < EXCERPT_MIN || text.length > EXCERPT_MAX) throw new HttpError(400, "bad_length", excerptLength);
  if (!squash(pick.text).includes(text)) throw new HttpError(400, "not_from_answer", "Trim the excerpt from your answer: it can only leave words out, not add any.");
  const hideProduct = false; // (batch 18 section 7) always "From <test>"
  const x = await db.$transaction(async (tx) => {
    // One tester's requests one at a time: the count and the one-per-part rule hold under two quick presses.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${tester.id} FOR UPDATE`;
    if (await tx.excerpt.count({ where: { submissionId: sub.id, status: "pending" } })) throw new HttpError(409, "pending", ONE_PENDING);
    if ((await tx.excerpt.count({ where: { testerId: tester.id, status: { in: ["pending", "shown"] } } })) >= MAX_EXCERPTS) throw new HttpError(409, "too_many", TOO_MANY_EXCERPTS);
    return tx.excerpt.create({ data: { testerId: tester.id, testId: t.id, contractId: sub.contractId, submissionId: sub.id, question: pick.question, text, hideProduct } });
  });
  await bell(t.developerId, `${displayName(tester)} asked to show an excerpt from “${t.title}” on their profile`, `/app/tests/${t.id}#excerpt-${x.id}`, undefined, { testId: t.id });
  return { id: x.id };
}

/** The developer allows or denies a pending request (also from the dashboard box while restricted). (Batch 18 section 7) Allowed under an NDA, it's hidden until the NDA goes. */
export async function decideExcerpt(dev: { id: string; name: string; email: string }, body: Record<string, unknown>) {
  const allow = body.decision === "allow";
  if (!allow && body.decision !== "deny") throw new HttpError(400, "bad_decision", "Choose Allow or Deny.");
  const x = await db.excerpt.findUnique({ where: { id: String(body.excerptId ?? "") }, include: { test: true } });
  if (!x || x.test.developerId !== dev.id) throw new HttpError(404, "gone", ALREADY_DECIDED);
  // (Owner, Oct 28, batch 16 section 21) The same press already made (in another tab): a plain refusal, no stop box.
  if (x.status !== "pending") throw new HttpError(409, "decided", x.status === "shown" ? "You already allowed this excerpt." : x.status === "denied" ? "You already denied this excerpt." : ALREADY_DECIDED);
  // (Owner, Oct 29, batch 29 section 12) Your own changes in another tab never stop Allow / Deny (the same decision made elsewhere is the plain refusal above).
  const done = await db.excerpt.updateMany({ where: { id: x.id, status: "pending" }, data: { status: allow ? "shown" : "denied", decidedAt: new Date() } });
  if (done.count !== 1) throw new HttpError(409, "decided", ALREADY_DECIDED);
  const hidden = allow && !!x.test.ndaText;
  await bell(x.testerId, hidden ? allowedUnderNdaLine(x.test.title) : allow ? allowedLine(x.test.title) : deniedLine(displayName(dev), x.test.title), allow ? `/app/testers/${x.testerId}#excerpts` : "/app/account#excerpts", undefined, { testId: x.testId, group: "excerpts" }); // (batch 29 §26)
  return { status: allow ? "shown" : "denied", ...(hidden ? { hidden: true } : {}) };
}

/**
 * Remove: the tester, any of theirs (a request, a shown or a denied one). (Owner, Oct 29, batch 29 section 30) Only the tester: the developer's Take down is gone (a press
 * from a page loaded earlier is refused), and removing one sends no bell line.
 */
export async function removeExcerpt(user: { id: string; name: string; email: string }, body: Record<string, unknown>) {
  const x = await db.excerpt.findUnique({ where: { id: String(body.excerptId ?? "") }, include: { test: true } });
  if (x && x.testerId !== user.id && x.test.developerId === user.id) throw new HttpError(409, "tester_only", ONLY_TESTER_REMOVES);
  if (!x || x.testerId !== user.id) throw new HttpError(404, "gone", ALREADY_DOWN);
  const gone = await db.excerpt.deleteMany({ where: { id: x.id } });
  if (gone.count !== 1) throw new HttpError(404, "gone", ALREADY_DOWN);
  return { removed: true };
}

/** Deleting an account (restrictions.deleteAccount): a tester's requests and excerpts go; a developer's pending requests close, with the reason the tester reads. */
export async function excerptsOnDelete(userId: string) {
  await db.excerpt.deleteMany({ where: { testerId: userId } });
  const pending = await db.excerpt.findMany({ where: { status: "pending", test: { developerId: userId } }, include: { test: true } });
  for (const x of pending) {
    const line = devDeletedClosedLine(x.test.title);
    await db.excerpt.update({ where: { id: x.id }, data: { status: "closed", closedReason: line, decidedAt: new Date() } });
    await bell(x.testerId, `${line}.`, "/app/account#excerpts", undefined, { testId: x.testId });
  }
}

const withTest = { test: { select: { id: true, title: true, productName: true, categories: true, ndaText: true, developerId: true } } } as const;

/** Shown excerpts others see on a tester's profile and hover card (up to 3): never from a test that has an NDA now. */
export async function shownExcerpts(testerId: string) {
  const rows = await db.excerpt.findMany({ where: { testerId, status: "shown", test: { ndaText: "" } }, include: withTest, orderBy: { decidedAt: "desc" }, take: MAX_EXCERPTS });
  return rows.map((x) => ({ id: x.id, text: x.text, question: x.question, source: excerptSource(x) }));
}

/** The tester's own list (profile and Settings): pending, shown, denied and closed, with what each one's state reads. */
export async function myExcerpts(testerId: string) {
  const rows = await db.excerpt.findMany({ where: { testerId }, include: withTest, orderBy: { createdAt: "desc" } });
  return rows.map((x) => ({
    id: x.id, text: x.text, question: x.question, source: excerptSource(x), testTitle: x.test.title,
    state: x.test.ndaText && x.status === "shown" ? allowedHiddenLine(x.test.title) : x.test.ndaText && x.status === "pending" ? ndaHiddenLine(x.test.title)
      : x.status === "pending" ? "Waiting for the developer" : x.status === "shown" ? "Shown on your profile" : x.status === "denied" ? "Not allowed by the developer" : x.closedReason,
    status: x.status,
  }));
}

/**
 * Pending requests for a developer to decide (a test page's Needs you, or the restricted dashboard box). (Batch 18 section 7) A request from a test that has an NDA now
 * stays, with its note (`ndaNote`): Allow puts it straight into hidden.
 */
export async function pendingForDeveloper(devId: string, testId?: string) {
  const rows = await db.excerpt.findMany({ where: { status: "pending", test: { developerId: devId, ...(testId ? { id: testId } : {}) } }, include: { ...withTest, tester: true }, orderBy: { createdAt: "asc" } });
  return rows.map((x) => ({ id: x.id, contractId: x.contractId, testId: x.testId, testTitle: x.test.title, tester: displayName(x.tester), text: x.text, question: x.question, named: !x.hideProduct, source: excerptSource(x), ndaNote: x.test.ndaText ? allowUnderNdaNote(x.test.title) : "" }));
}
