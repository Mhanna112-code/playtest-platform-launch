import { db } from "@/lib/db";
import { displayName, pronouns } from "@/lib/format";
import { plainText } from "@/lib/markdown";
import { itemsOf } from "@/lib/answerSets";
import { markerPattern, withoutAttachmentMarkers } from "@/lib/answerAttachments";
import { fromAnswer, squash } from "@/lib/excerptTrim";
import { HttpError } from "./http";
import { bell } from "./notify";

// (Owner, Oct 29, batch 13) Excerpt requests: a tester asks to show a short excerpt of written work the developer PAID for (above $0) on their public profile, and the
// test's developer allows or denies it.
//   - Never from a test that has an NDA NOW (the rule follows the test's current NDA): the button hides, a press from an older page is refused, shown excerpts are hidden
//     from profiles and hover cards. Nothing is deleted: removing the NDA brings them back. (Owner, Oct 28, batch 18 section 7) A request still pending when the test
//     gets an NDA can still be Allowed (or Denied): it's accepted straight into hidden ("Allowed · hidden while <test> has an NDA") and shows once the NDA is removed.
//   - (Batch 18 section 7) No "Don't name the product" tick any more: a new excerpt always reads "From <test>". Excerpts already shown or pending with the product
//     hidden keep their "a <category> test" wording (the tester chose that).
//   - At most 3 shown or pending per tester, and one pending request per part. (Batch 35 §126) The same text again (pending or shown, same session and question,
//     across its submissions) is refused, one pending per session + question too; a different text for a question already shown replaces it on Allow (it doesn't count toward the 3), and Deny keeps the shown one.
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
/** (Owner, Nov 2, batch 35 §126) The same text (after squash) as a pending or shown excerpt of this tester for the same session (contract) and question. */
export const SAME_PENDING = "You already asked to show this excerpt.";
export const SAME_SHOWN = "This excerpt is already on your profile.";
/** (Batch 35 §126) One pending request per session + question too (besides one per part). */
export const ONE_PENDING_QUESTION = "You already asked to show an excerpt for this question. Wait for the developer's answer.";
export const excerptLength = `An excerpt is ${EXCERPT_MIN} to ${EXCERPT_MAX} characters.`;
export const allowedLine = (test: string) => `Your excerpt from ${test} is now on your profile.`;
export const deniedLine = (dev: string, test: string) => `${dev} prefers that work from ${test} isn't shown on profiles.`;
/** (Batch 29 section 30) A developer's Take down pressed on a page loaded before it went. */
export const ONLY_TESTER_REMOVES = "Only the tester can remove an excerpt from their profile.";
/** (Batch 35 §162) In the developer's recorded pronoun ("deleted her account"). */
export const devDeletedClosedLine = (test: string, pronoun?: string | null) => `${test}'s developer deleted ${pronouns(pronoun).poss} account, so this request was closed`;
export const ndaHiddenLine = (test: string) => `Hidden while ${test} has an NDA`;

/** How the quote names its source: the product's name, or (an older excerpt whose tester ticked "Don't name the product") the kind of test it was. */
export function excerptSource(x: { hideProduct: boolean; test: { productName: string; title: string; categories: string[] } }) {
  if (!x.hideProduct) return x.test.productName || x.test.title;
  // "an education test", "an AI test" (AI keeps its capitals).
  const first = x.test.categories[0] ?? "";
  const cat = first === "AI" ? "AI" : first.toLowerCase();
  return cat ? `${/^[aeiou]/i.test(cat) ? "an" : "a"} ${cat} test` : "a test";
}

/**
 * (Owner, Nov 2, batch 35 §126) Excerpts leave files out completely: no file markers and no "[file]" placeholder, in the trim box or the stored text. Each marker
 * goes with the spaces before it ("great [📎 map.png #k3f9] but" reads "great but", "great [📎 …]." reads "great."). Excerpts stored earlier stay as they are.
 */
const filesOut = new RegExp(`[ \t]*(?:${markerPattern.source})`, "g");
export const withoutFiles = (s: string) => withoutAttachmentMarkers(s.replace(filesOut, ""));
/** The plain text an excerpt is trimmed from (and compared with): no formatting, no files. */
export const excerptPlain = (s: string) => plainText(withoutFiles(s ?? ""));

/** Paid for above $0: the developer's Pay (or the tester's Charge), a Pay more, or a dispute decided for the tester. */
async function paidAboveZero(sub: { id: string; review: { rejected: boolean; amountCents: number } | null; dispute: { decidedCents: number | null } | null }) {
  if (sub.review && !sub.review.rejected && sub.review.amountCents > 0) return true;
  if ((sub.dispute?.decidedCents ?? 0) > 0) return true;
  return (await db.payment.count({ where: { submissionId: sub.id, kind: "extra", amountCents: { gt: 0 }, status: { in: ["charged", "not_set_up", "pending", "deferred", "owed", "needs_confirmation"] } } })) > 0;
}

/** The answers of a part the tester could quote (plain text, at least 10 characters), or [] when the part can't be shown. */
export async function excerptChoices(sub: { id: string; kind: string; answers: unknown; review: { rejected: boolean; amountCents: number } | null; dispute: { decidedCents: number | null } | null }) {
  if (sub.kind !== "written" || !(await paidAboveZero(sub))) return [];
  return itemsOf(sub.answers).map((it, i) => ({ index: i, question: it.question, text: excerptPlain(it.answer) })).filter((x) => x.text.length >= EXCERPT_MIN);
}

/** A tester asks to show an excerpt. No stop-once; refused only for the rules above. */
export async function requestExcerpt(tester: { id: string; name: string; email: string; pronoun?: string; deletedAt?: Date | null }, body: Record<string, unknown>) {
  const sub = await db.submission.findUnique({ where: { id: String(body.submissionId ?? "") }, include: { review: true, dispute: true, contract: { include: { test: true } } } });
  if (!sub || sub.contract.testerId !== tester.id) throw new HttpError(404, "not_found", "That part doesn't exist or isn't yours.");
  const t = sub.contract.test;
  if (t.ndaText) throw new HttpError(409, "nda", NDA_NO_EXCERPT);
  const choices = await excerptChoices(sub);
  if (!choices.length) throw new HttpError(409, "not_paid", "Only written answers the developer paid for can be shown as excerpts.");
  const pick = choices.find((c) => c.index === Number(body.index));
  if (!pick) throw new HttpError(400, "bad_pick", "Pick one of your answers.");
  const text = squash(excerptPlain(typeof body.text === "string" ? body.text : "")); // (batch 35 §126) any file marker left out
  if (text.length < EXCERPT_MIN || text.length > EXCERPT_MAX) throw new HttpError(400, "bad_length", excerptLength);
  // (Owner, Nov 4, §196) Trimmed in a delete-only box: a part left out of the middle reads " … ". Each "…"-separated piece must be in the answer, in order; the
  // 10 to 500 above counts the stored text, ellipses included. Anything added is refused with the same line.
  if (!fromAnswer(pick.text, text)) throw new HttpError(400, "not_from_answer", "Trim the excerpt from your answer: it can only leave words out, not add any.");
  // (Owner, Nov 5, §271) A pause of this test since the page loaded (or the team's lift of it) stops the request once, whatever her Alerts ("This test was paused at …").
  const m = await import("./stopMoment");
  m.pauseStopOnce(await m.testerPauseMoments(sub.contractId, m.loadedOf(body)), body);
  const hideProduct = false; // (batch 18 section 7) always "From <test>"
  const x = await db.$transaction(async (tx) => {
    // One tester's requests one at a time: the count and the one-per-part rule hold under two quick presses.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${tester.id} FOR UPDATE`;
    // (Batch 35 §126) No duplicates: the same text as one of theirs pending or shown for this part's question is refused.
    // (Owner, Nov 2) Matched by the session (contract) and the question's text, across all of its parts and rounds: an updated answer is a new submission.
    const same = await tx.excerpt.findMany({ where: replacedBy({ testerId: tester.id, contractId: sub.contractId, question: pick.question }, ["pending", "shown"]), select: { id: true, text: true, status: true } });
    const dup = same.filter((e) => squash(e.text) === text);
    if (dup.some((e) => e.status === "pending")) throw new HttpError(409, "same_pending", SAME_PENDING);
    if (dup.length) throw new HttpError(409, "same_shown", SAME_SHOWN);
    if (await tx.excerpt.count({ where: { submissionId: sub.id, status: "pending" } })) throw new HttpError(409, "pending", ONE_PENDING);
    if (same.some((e) => e.status === "pending")) throw new HttpError(409, "pending_question", ONE_PENDING_QUESTION);
    // (Batch 35 §126) A different text for a question already shown is a replacement: the shown one(s) go on Allow, so they don't count toward the limit.
    const replaced = same.filter((e) => e.status === "shown").length;
    if ((await tx.excerpt.count({ where: { testerId: tester.id, status: { in: ["pending", "shown"] } } })) - replaced >= MAX_EXCERPTS) throw new HttpError(409, "too_many", TOO_MANY_EXCERPTS);
    return tx.excerpt.create({ data: { testerId: tester.id, testId: t.id, contractId: sub.contractId, submissionId: sub.id, question: pick.question, text, hideProduct } });
  });
  await bell(t.developerId, `${displayName(tester)} asked to show an excerpt from “${t.title}” on ${pronouns(tester.pronoun).poss} profile`, `/app/tests/${t.id}#excerpt-${x.id}`, undefined, { testId: t.id });
  return { id: x.id };
}

/** (Batch 35 §126) The excerpts a request replaces: the same tester's shown ones for the same session (contract) and question, from any of its submissions. */
const replacedBy = (x: { testerId: string; contractId: string; question: string }, status: string[] = ["shown"]) => ({ testerId: x.testerId, contractId: x.contractId, question: x.question, status: { in: status } });

/** The developer allows or denies a pending request (also from the dashboard box while restricted). (Batch 18 section 7) Allowed under an NDA, it's hidden until the NDA goes. */
export async function decideExcerpt(dev: { id: string; name: string; email: string }, body: Record<string, unknown>) {
  const allow = body.decision === "allow";
  if (!allow && body.decision !== "deny") throw new HttpError(400, "bad_decision", "Choose Allow or Deny.");
  const id = String(body.excerptId ?? "");
  const x = await db.excerpt.findUnique({ where: { id }, include: { test: true } });
  // (Owner, Nov 3, batch 35 §157) The tester removed the request meanwhile: "Ana Silva withdrew this request." (not "already decided").
  if (!x) throw new HttpError(404, "gone", (await withdrawnLine(dev.id, id)) ?? ALREADY_DECIDED);
  if (x.test.developerId !== dev.id) throw new HttpError(404, "gone", ALREADY_DECIDED);
  // (Owner, Oct 28, batch 16 section 21) The same press already made (in another tab): a plain refusal, no stop box.
  if (x.status !== "pending") throw new HttpError(409, "decided", decidedLine(x));
  // (Owner, Oct 29, batch 29 section 12) Your own changes in another tab never stop Allow / Deny (the same decision made elsewhere is the plain refusal above).
  // (Owner, Nov 5, §271) A pause since the page loaded (the team's, their own hold or suspension) or the team's lift of it does, once, whatever the Alerts.
  const m = await import("./stopMoment");
  m.pauseStopOnce(await m.devPauseMoments(x.testId, m.loadedOf(body)), body);
  // (Batch 35 §126) Allow on a replacement: the new one is shown and the one(s) shown now for that question go, in one transaction. Deny leaves them.
  await db.$transaction(async (tx) => {
    const done = await tx.excerpt.updateMany({ where: { id: x.id, status: "pending" }, data: { status: allow ? "shown" : "denied", decidedAt: new Date() } });
    if (done.count !== 1) {
      // (§157) Lost to the same press in another tab, or to the tester's Remove at the same moment: say which.
      const now = await tx.excerpt.findUnique({ where: { id: x.id } });
      throw new HttpError(409, "decided", now ? decidedLine(now) : (await withdrawnLine(dev.id, x.id)) ?? ALREADY_DECIDED);
    }
    if (allow) await tx.excerpt.deleteMany({ where: { ...replacedBy(x), id: { not: x.id } } });
  });
  const hidden = allow && !!x.test.ndaText;
  await bell(x.testerId, hidden ? allowedUnderNdaLine(x.test.title) : allow ? allowedLine(x.test.title) : deniedLine(displayName(dev), x.test.title), allow ? `/app/testers/${x.testerId}#excerpts` : `/app/sessions/${x.contractId}` /* (owner, Nov 2) Deny: back to the session, where Show an excerpt is */, undefined, { side: "tester", testId: x.testId, group: "excerpts" }); // (batch 29 §26)
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
  // (§157) A pending request removed is recorded (which request, whose test, by whom) in the same commit, so the developer's Allow / Deny on an older page reads
  // "Ana Silva withdrew this request."
  const gone = await db.$transaction(async (tx) => {
    const n = (await tx.excerpt.deleteMany({ where: { id: x.id } })).count;
    if (n && x.status === "pending") await tx.actionLog.create({ data: { userId: x.test.developerId, testId: EXCERPT_WITHDRAWN, tab: x.id, text: displayName(user) } });
    return n;
  });
  if (gone !== 1) throw new HttpError(404, "gone", ALREADY_DOWN);
  return { removed: true };
}

/** (§157) The ActionLog "test" recording a pending excerpt request the tester removed (its id in `tab`, the tester's name in `text`): never a real test id. */
const EXCERPT_WITHDRAWN = "excerpt-withdrawn";
/** "<name> withdrew this request." when the tester removed this pending request, else null. */
async function withdrawnLine(devId: string, excerptId: string) {
  if (!excerptId) return null;
  const row = await db.actionLog.findFirst({ where: { userId: devId, testId: EXCERPT_WITHDRAWN, tab: excerptId }, select: { text: true } });
  return row ? `${row.text} withdrew this request.` : null;
}
/** The plain refusal for a request no longer pending: decided in another tab ("You already allowed this excerpt."), or closed (its reason). */
const decidedLine = (x: { status: string; closedReason?: string | null }) =>
  x.status === "shown" ? "You already allowed this excerpt." : x.status === "denied" ? "You already denied this excerpt." : x.status === "closed" && x.closedReason ? `${x.closedReason}.` : ALREADY_DECIDED;

/** Deleting an account (restrictions.deleteAccount): a tester's requests and excerpts go; a developer's pending requests close, with the reason the tester reads. */
export async function excerptsOnDelete(userId: string) {
  await db.excerpt.deleteMany({ where: { testerId: userId } });
  const pending = await db.excerpt.findMany({ where: { status: "pending", test: { developerId: userId } }, include: { test: { include: { developer: { select: { pronoun: true } } } } } });
  for (const x of pending) {
    const line = devDeletedClosedLine(x.test.title, x.test.developer.pronoun);
    await db.excerpt.update({ where: { id: x.id }, data: { status: "closed", closedReason: line, decidedAt: new Date() } });
    await bell(x.testerId, `${line}.`, `/app/sessions/${x.contractId}`, undefined, { side: "tester", testId: x.testId });
  }
}

const withTest = { test: { select: { id: true, title: true, productName: true, categories: true, ndaText: true, developerId: true } } } as const;

/** Shown excerpts others see on a tester's profile and hover card (up to 3): never from a test that has an NDA now. */
export async function shownExcerpts(testerId: string) {
  const rows = await db.excerpt.findMany({ where: { testerId, status: "shown", test: { ndaText: "" } }, include: withTest, orderBy: { decidedAt: "desc" }, take: MAX_EXCERPTS });
  return rows.map((x) => ({ id: x.id, text: x.text, question: x.question, source: excerptSource(x) }));
}

/** The tester's own records; the profile requests only accepted excerpts (owner, Nov 1). */
export async function myExcerpts(testerId: string, acceptedOnly = false) {
  const rows = await db.excerpt.findMany({ where: { testerId, ...(acceptedOnly ? { status: "shown" } : {}) }, include: withTest, orderBy: { createdAt: "desc" } });
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
  // (Batch 35 §126) A request for a question already shown replaces it on Allow: its row names the text shown now.
  const shownNow = rows.length ? await db.excerpt.findMany({ where: { status: "shown", OR: rows.map((x) => ({ testerId: x.testerId, contractId: x.contractId, question: x.question })) }, orderBy: { decidedAt: "desc" }, select: { testerId: true, contractId: true, question: true, text: true } }) : [];
  return rows.map((x) => ({
    replaces: shownNow.filter((o) => o.testerId === x.testerId && o.contractId === x.contractId && o.question === x.question).map((o) => o.text), id: x.id, /** (§181) when it was asked */ at: x.createdAt, contractId: x.contractId, testId: x.testId, testTitle: x.test.title, tester: displayName(x.tester), /** (batch 35 §162) "on her profile" */ testerPoss: pronouns(x.tester.pronoun).poss, testerHref: x.tester.deletedAt ? null : `/app/testers/${x.testerId}`, text: x.text, question: x.question, named: !x.hideProduct, source: excerptSource(x), ndaNote: x.test.ndaText ? allowUnderNdaNote(x.test.title) : "" }));
}
