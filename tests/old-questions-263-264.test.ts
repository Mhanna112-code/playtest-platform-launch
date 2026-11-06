import { randomUUID } from "node:crypto";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { SentWork } from "@/components/SentWork";
import { OLD_TAG, carriedAnswers, currentQuestionsFor, questionKeys } from "@/lib/additions";
import { attachmentMarker } from "@/lib/answerAttachments";
import { questionChanges } from "@/lib/questionHistory";
import { setKept } from "@/lib/server/kept";
import { POST as reviewPOST } from "@/app/api/review/route";
import { act, joined, sact, seen, settle, setup } from "./fixtures";
import { json, req } from "./helpers";

// (Owner, Nov 5, batch 35 §263, final) Old questions live only in Terms history. A question is current while it's in the tester's contract (currentQuestionsFor),
// old otherwise, by its words. The answer lists (the tester's "Your written answers", the developer's Testers list and By question) show the current questions
// only; each change of the questions is a Terms history entry, "Questions changed <date/time>", Then (with what the tester had for each question at that moment:
// the sent answer and its additions, else their unsent draft "Draft (not sent)" (the tester's side only), else "(no answer)") → Now, on both sides (the
// developer's under each tester's written answers, never a draft). Files are drawn as in the written answers. Needs you still shows a new, unpaid answer to a
// question that has since changed, tagged "Old", and Pay covers it. A question that comes back is simply current again (a snapshotted draft comes back too).
// (§264) "Your agreed scope": what to do, the build link, languages and devices under "Your contract", below Due, still live.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/s", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const Q1 = "What did you like?", Q2 = "Where did you get stuck?", Q3 = "What would you change?", Q4 = "Which device did you use?";
const key = (q: string) => questionKeys([{ question: q }])[0];
const item = (question: string, answer: string) => ({ question, required: false, answer });
const href = (id: string) => `/api/recordings/${id}/file`;
const written = (sessionId: string) => db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: sessionId, kind: "written" } } });
const send = (sessionId: string, cookie: string, body: Record<string, unknown>) => sact(sessionId, "written", cookie, { notes: "", seenAt: seen(), confirmed: true, ...body });
const add = (sessionId: string, cookie: string, q: string, text: string) => sact(sessionId, "written-add", cookie, { text, question: key(q), seenAt: seen(), confirmed: true });
const sessionPage = async (sessionId: string, userId: string) => {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
  return unescape(renderToStaticMarkup(await SessionPage({ params: Promise.resolve({ id: sessionId }) })));
};
const testPage = async (testId: string, userId: string) => {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const { default: TestPage } = await import("@/app/app/tests/[id]/page");
  return unescape(renderToStaticMarkup(await TestPage({ params: Promise.resolve({ id: testId }), searchParams: Promise.resolve({}) })));
};
/**
 * The developer saves changed questions; (Owner, Nov 5, §265) every working tester's contract follows at once (no offer). The flips here change the questions
 * more often than the listing's 3 changes allow, so each Save starts from a fresh count for the questions (test setup only).
 */
async function changeTo(testId: string, devCookie: string, questions: string[]) {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  await db.test.update({ where: { id: testId }, data: { criticalCounts: { ...(t.criticalCounts as Record<string, unknown>), questions: 0 } } });
  const r = await act(testId, "edit", devCookie, { version: t.version, fields: { questions }, seenAt: seen(), confirmed: true });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(await db.termsOffer.count({ where: { testId, status: "open" } })).toBe(0);
  await settle();
}
// One question's fold in a list (from its <details> to the next question's).
const foldOf = (html: string, q: string) => {
  const i = html.indexOf(`data-question-title="">${q}`);
  if (i < 0) return "";
  const start = html.lastIndexOf("<details", i), next = html.indexOf('data-question-title=""', i + 10);
  return html.slice(start, next < 0 ? html.length : html.lastIndexOf("<details", next));
};
const OLD = `data-old-question="">${OLD_TAG}</span>`;
// The tester's "Your written answers" list, the form below it, and their Terms history's question entries.
const tList = (html: string) => { const s = html.slice(html.indexOf('data-panel="own-answers-list-')); return s.slice(0, s.indexOf('data-question-body="else"')); };
const tForm = (html: string) => { const at = html.indexOf("data-answer-form="); return at < 0 ? "" : html.slice(at, html.indexOf("</section>", at)); };
const entries = (html: string) => html.split("data-questions-changed=").slice(1).map((e) => e.slice(0, e.indexOf("</ol>", e.indexOf('data-history-now=""'))));
// The developer's Testers list part's list (as paid), and the tester's Terms history under it.
const dList = (html: string, subId: string) => { const s = html.slice(html.indexOf(`data-panel="row-${subId}-questions-list"`)); return s.slice(0, s.indexOf('data-question-body="else"')); };
// The Then part of an entry, one question's drop-down in it (by its words).
const thenOf = (entry: string) => entry.slice(entry.indexOf('data-history-then=""'), entry.indexOf('data-history-now=""'));
const thenQ = (entry: string, q: string) => { const t = thenOf(entry); const i = t.indexOf(`>${q}</span>`); const e = t.indexOf('data-question=""', i); return i < 0 ? "" : t.slice(i, e < 0 ? t.length : e); };

describe("§263 lib", () => {
  it("currentQuestionsFor: the contract's questions (none: Your feedback); carriedAnswers: a question that comes back keeps its last answer", () => {
    expect(currentQuestionsFor({ questions: [Q1, `[required] ${Q2}`] })).toEqual([Q1, `[required] ${Q2}`]);
    expect(currentQuestionsFor({ questions: [] })).toEqual(["Your feedback"]);
    const sub = { answers: [item(Q1, "a"), item(Q2, "b")], additions: [{ at: "2026-11-05T10:00:00.000Z", items: [item(Q1, "a"), item(Q3, "c")], notes: "", files: [] }] };
    expect(carriedAnswers(sub, [Q1, Q2])).toEqual(["a", "b"]);
    expect(carriedAnswers(sub, [Q1, Q2, Q4])).toEqual(["a", "b", null]);
  });

  it("questionChanges: Then has the sent answer and its additions up to the change, else the draft (only with drafts), else nothing; Now the questions after", () => {
    const until = "2026-11-05T10:00:00.000Z";
    const items = [item(Q1, "a"), item(Q2, "b"), item(Q3, "my draft")];
    const sets = [{ until, items, to: [Q1, Q4], versions: [{ kind: "sent", at: until, items: [item(Q1, "a"), item(Q2, "b"), item(Q3, "")] }, { kind: "draft", items }] }];
    const sub = { answers: [item(Q1, "a"), item(Q2, "b"), item(Q3, "")], additions: [
      { at: "2026-11-05T09:59:00.000Z", text: "more on Q2", files: [], questionKey: key(Q2) },
      { at: "2026-11-05T10:01:00.000Z", text: "after the change", files: [], questionKey: key(Q1) },
    ] };
    const [mine] = questionChanges(sets, [Q1, Q4], sub, { drafts: true });
    expect(mine.then.map((q) => [q.question, q.sent?.answer ?? null, q.sent?.adds.map((a) => a.text) ?? null, q.draft])).toEqual([
      [Q1, "a", [], null], [Q2, "b", ["more on Q2"], null], [Q3, null, null, "my draft"],
    ]);
    expect(mine.now.map((q) => q.question)).toEqual([Q1, Q4]);
    const [theirs] = questionChanges(sets, [Q1, Q4], sub, { drafts: false });
    expect(theirs.then[2]).toMatchObject({ sent: null, draft: null });
  });

  it("SentWork: the current questions only; Needs you (newOnly) also a new answer to an old question, after the current ones, tagged Old, without Add", () => {
    const props = { id: "n", kind: "written", answers: [item(Q1, "a"), item(Q2, "b")], questions: [Q1, Q3], notes: "", files: [],
      additions: [{ at: "2026-11-05T10:00:00.000Z", items: [item(Q1, "a"), item(Q3, "c")], notes: "", files: [] }], addTo: () => h("button", { "data-add-more": "written" }) };
    const list = renderToStaticMarkup(h(SentWork, props));
    expect(list).not.toContain(Q2);
    expect(list).not.toContain("data-old-question");
    const needs = renderToStaticMarkup(h(SentWork, { ...props, newOnly: { since: null } }));
    expect(needs.indexOf(Q3)).toBeLessThan(needs.indexOf(Q2));
    expect(foldOf(needs, Q2)).toContain(OLD);
    expect(foldOf(needs, Q2)).not.toContain("data-add-more");
    expect(needs.match(/data-old-question=""/g)).toHaveLength(1);
  });
});

describe("§263 Terms history entries, both sides", () => {
  it("Then: the sent answer with its additions and their files, the unsent draft with its file (the tester only), or (no answer); Now: the new questions", async () => {
    const { dev, testId } = await setup({ questions: [Q1, Q2, Q3] });
    const j = await joined(testId);
    expect((await send(j.sessionId, j.tester.cookie, { answers: ["the boats", "level two gate", ""] })).status).toBe(200);
    const sub = await written(j.sessionId);
    // A file added with Q2's addition (sent), and one uploaded for Q3's draft (not sent).
    const sentFile = await db.recording.create({ data: { contractId: j.sessionId, submissionId: sub.id, part: "written", filename: "gate.png", contentType: "image/png", sizeBytes: 10, storageKey: randomUUID(), uploadedAt: new Date() } });
    const draftFile = await db.recording.create({ data: { contractId: j.sessionId, part: "written", filename: "idea.pdf", contentType: "application/pdf", sizeBytes: 10, storageKey: randomUUID(), uploadedAt: new Date() } });
    await db.submission.update({ where: { id: sub.id }, data: { additions: [{ at: new Date().toISOString(), text: `and the second gate ${attachmentMarker(sentFile.id, sentFile.filename)}`, files: [sentFile.id], questionKey: key(Q2) }] } });
    await setKept(j.tester.user.id, `written:${j.sessionId}`, { answers: [`a bigger map ${attachmentMarker(draftFile.id, draftFile.filename)}`], questions: [Q3], notes: "" });
    await settle();
    await changeTo(testId, dev.cookie, [Q1, Q4]);

    const mine = await sessionPage(j.sessionId, j.tester.user.id);
    expect(tList(mine)).not.toContain(Q2);
    expect(tList(mine)).not.toContain(Q3);
    const [e] = entries(mine);
    expect(e).toContain("Questions changed ");
    expect(thenQ(e, Q1)).toContain("the boats");
    expect(thenQ(e, Q2)).toContain("level two gate");
    expect(thenQ(e, Q2)).toContain("and the second gate");
    expect(thenQ(e, Q2)).toContain(`<img src="${href(sentFile.id)}"`); // the file still opens after its question changed
    expect(thenQ(e, Q3)).toContain('data-history-draft=""');
    expect(thenQ(e, Q3)).toContain("Draft (not sent)");
    expect(thenQ(e, Q3)).toContain("a bigger map");
    expect(thenQ(e, Q3)).toContain(href(draftFile.id));
    expect(e.slice(e.indexOf('data-history-now=""'))).toContain(Q4);

    const theirs = await testPage(testId, dev.user.id);
    expect(dList(theirs, sub.id)).not.toContain(Q2);
    const hist = theirs.slice(theirs.indexOf("data-dev-terms-history="));
    const [d] = entries(hist);
    expect(thenQ(d, Q2)).toContain("and the second gate");
    expect(thenQ(d, Q2)).toContain(`<img src="${href(sentFile.id)}"`);
    expect(thenQ(d, Q3)).toContain('data-no-answer="">(no answer)</p>');
    expect(d).not.toContain("a bigger map");
    expect(d).not.toContain(href(draftFile.id));
    expect(d).not.toContain("Draft (not sent)");
  });
});

describe("§263 a question flips old → current → old → current, on both sides", () => {
  it("answered Q2 and never-answered Q4 move between the list, Terms history and the form; Add works again; a snapshotted draft comes back", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    const tid = j.tester.user.id;
    expect((await send(j.sessionId, j.tester.cookie, { answers: ["the boats", "level two gate"] })).status).toBe(200);
    await settle();
    expect((await add(j.sessionId, j.tester.cookie, Q2, "and the second gate")).status).toBe(200);
    const sub = await written(j.sessionId);

    // 1. Q2 → Q3, Q4: Q2 leaves the lists for Terms history; Q3 and Q4 are boxes in the form. A draft is typed for Q4 and not sent.
    await changeTo(testId, dev.cookie, [Q1, Q3, Q4]);
    let mine = await sessionPage(j.sessionId, tid);
    expect(tList(mine)).not.toContain(Q2);
    expect(thenQ(entries(mine)[0], Q2)).toContain("and the second gate");
    expect(tForm(mine)).toContain(Q3);
    expect(tForm(mine)).toContain(Q4);
    expect((await add(j.sessionId, j.tester.cookie, Q2, "refused")).status).toBe(409); // old: never added to
    let theirs = await testPage(testId, dev.user.id);
    expect(dList(theirs, sub.id)).not.toContain(Q2);
    // (§289) Needs you's Questions has no scroll panel now: its list is found by data-questions-plain.
    expect(foldOf(theirs.slice(theirs.indexOf(`data-questions-plain="needs-${sub.id}-questions-list"`)), Q2)).toContain(OLD); // never paid: Needs you still has it, tagged Old
    expect((await send(j.sessionId, j.tester.cookie, { answers: ["the map colours", ""], for: [Q3, Q4] })).status).toBe(200);
    await setKept(tid, `written:${j.sessionId}`, { answers: ["a laptop, I think"], questions: [Q4], notes: "" });
    await settle();

    // 2. Back to Q1, Q2: Q2 is current again with its answer and its addition; Q3 and Q4 are in the new entry (Q4's draft with it).
    await changeTo(testId, dev.cookie, [Q1, Q2]);
    mine = await sessionPage(j.sessionId, tid);
    expect(foldOf(tList(mine), Q2)).toContain("level two gate");
    expect(foldOf(tList(mine), Q2)).toContain("and the second gate");
    expect(tList(mine)).not.toContain(Q3);
    expect(entries(mine)).toHaveLength(2);
    expect(thenQ(entries(mine)[1], Q3)).toContain("the map colours");
    expect(thenQ(entries(mine)[1], Q4)).toContain("a laptop, I think");
    expect(tForm(mine)).not.toContain("Questions you haven't answered yet"); // Q2 was answered: never asked again
    theirs = await testPage(testId, dev.user.id);
    expect(foldOf(dList(theirs, sub.id), Q2)).toContain("and the second gate");
    expect(dList(theirs, sub.id)).not.toContain(Q3);
    // (§265) Add to this answer works on Q2 again straight away (no Send to "move onto" the questions).
    expect((await add(j.sessionId, j.tester.cookie, Q2, "and the third gate")).status).toBe(200);
    mine = await sessionPage(j.sessionId, tid);
    expect(foldOf(tList(mine), Q2)).toContain("and the third gate");
    expect(foldOf(tList(mine), Q2).match(/level two gate/g)).toHaveLength(1);
    expect(foldOf(tList(mine), Q2)).toContain('data-add-more="written"');

    // 3. Q2 → Q4 again: Q2 to Terms history with every addition; Q4 (never sent) is a box in the form again, its snapshotted draft back in the kept draft.
    await changeTo(testId, dev.cookie, [Q1, Q4]);
    mine = await sessionPage(j.sessionId, tid);
    expect(tList(mine)).not.toContain(Q2);
    expect(thenQ(entries(mine)[2], Q2)).toContain("and the third gate");
    expect(tForm(mine)).toContain("Questions you haven't answered yet");
    expect(tForm(mine)).toContain(Q4);
    const kept = await db.keptForm.findUniqueOrThrow({ where: { userId_key: { userId: tid, key: `written:${j.sessionId}` } } });
    const k = kept.data as { answers: string[]; questions: string[] };
    expect(k.answers[k.questions.indexOf(Q4)]).toBe("a laptop, I think");
    expect((await send(j.sessionId, j.tester.cookie, { answers: ["a laptop"], for: [Q4] })).status).toBe(200);
    await settle();
    theirs = await testPage(testId, dev.user.id);
    expect(foldOf(dList(theirs, sub.id), Q4)).toContain("a laptop");
    expect(dList(theirs, sub.id)).not.toContain(Q2);

    // 4. Back to Q1, Q2, Q3: both current again with everything; the history entries stay as they were.
    await changeTo(testId, dev.cookie, [Q1, Q2, Q3]);
    mine = await sessionPage(j.sessionId, tid);
    for (const [q, x] of [[Q2, "level two gate"], [Q2, "and the third gate"], [Q3, "the map colours"]]) expect(foldOf(tList(mine), q)).toContain(x);
    expect(tList(mine)).not.toContain(Q4);
    expect(entries(mine)).toHaveLength(4);
    expect(thenQ(entries(mine)[1], Q4)).toContain("a laptop, I think"); // as it was at that change
    expect((await add(j.sessionId, j.tester.cookie, Q3, "and the fonts")).status).toBe(200);
    theirs = await testPage(testId, dev.user.id);
    for (const [q, x] of [[Q2, "and the third gate"], [Q3, "and the fonts"]]) expect(foldOf(dList(theirs, sub.id), q)).toContain(x);
    expect(entries(theirs.slice(theirs.indexOf("data-dev-terms-history=")))).toHaveLength(4);
    expect(theirs.slice(theirs.indexOf("data-dev-terms-history="))).not.toContain("a laptop, I think");
  });
});

describe("§263 Needs you: an unpaid answer to a question changed since is shown, tagged Old, and Pay covers it", () => {
  const payReview = (cookie: string, id: string, amount: string) => reviewPOST(req("/api/review", { cookie, body: { kind: "submission", id, payKey: randomUUID(), amount, tickedCents: Math.round(Number(amount) * 100), seenAt: seen(), confirmed: true } })).then(json);
  const updateRow = (html: string, subId: string) => { const at = html.indexOf(`data-update-row="${subId}"`); return at < 0 ? "" : html.slice(at, html.indexOf(`id="part-${subId}"`)); };

  it("the owner's case: added to Q2 after the last payment, then Q2 changed", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await send(j.sessionId, j.tester.cookie, { answers: ["the boats", "level two gate"] })).status).toBe(200);
    const sub = await written(j.sessionId);
    expect((await payReview(dev.cookie, sub.id, "10.00")).status).toBe(200);
    await settle();
    expect((await add(j.sessionId, j.tester.cookie, Q2, "the gate again, after you paid")).status).toBe(200);
    await settle();
    await changeTo(testId, dev.cookie, [Q1, Q3]);
    let html = await testPage(testId, dev.user.id);
    const upd = updateRow(html, sub.id);
    expect(foldOf(upd, Q2)).toContain("the gate again, after you paid");
    expect(foldOf(upd, Q2)).toContain(OLD);
    expect(dList(html, sub.id)).not.toContain(Q2);
    // Pay (Needs you's press for what's new on a paid part): it leaves Needs you; afterwards it is only in Terms history.
    const before = (await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).paidUpdateAt;
    expect(before).not.toBeNull();
    const r = await act(testId, "pay-extra", dev.cookie, { contractId: j.sessionId, submissionId: sub.id, amount: "2.00", tickedCents: 200, note: "", payKey: randomUUID(), seenAt: seen(), confirmed: true, press: "Pay" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await db.payment.findFirstOrThrow({ where: { submissionId: sub.id, kind: "extra" } })).amountCents).toBe(200);
    await settle();
    html = await testPage(testId, dev.user.id);
    expect(updateRow(html, sub.id)).toBe("");
    expect(html).not.toContain("data-old-question");
    const cut = /data-paid-until="([^"]+)"/.exec(html.slice(html.indexOf(`id="part-${sub.id}"`)))?.[1] ?? "";
    expect(new Date(cut).getTime()).toBeGreaterThan(before!.getTime()); // the paid cut is past the old question's addition
    expect(thenQ(entries(html.slice(html.indexOf("data-dev-terms-history=")))[0], Q2)).toContain("the gate again, after you paid");
  });

  it("never paid: Needs you's part shows the old question's answer, tagged Old, and the first Pay covers it", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await send(j.sessionId, j.tester.cookie, { answers: ["the boats", "level two gate"] })).status).toBe(200);
    const sub = await written(j.sessionId);
    await changeTo(testId, dev.cookie, [Q1, Q3]);
    let html = await testPage(testId, dev.user.id);
    // (§289) Needs you's Questions has no scroll panel now: its list is found by data-questions-plain.
    const needs = html.slice(html.indexOf(`data-questions-plain="needs-${sub.id}-questions-list"`), html.indexOf(`id="part-${sub.id}"`));
    expect(needs).not.toBe("");
    expect(foldOf(needs, Q2)).toContain("level two gate");
    expect(foldOf(needs, Q2)).toContain(OLD);
    expect((await payReview(dev.cookie, sub.id, "10.00")).status).toBe(200);
    await settle();
    html = await testPage(testId, dev.user.id);
    // (§289) Needs you's Questions has no scroll panel now: paid, Needs you's plain list is gone.
    expect(html).not.toContain(`data-questions-plain="needs-${sub.id}-questions-list"`);
    expect(html).not.toContain("data-old-question");
  });
});

describe("§264 \"Your agreed scope\": four listing lines under Your contract", () => {
  it("what to do, the build link, languages and devices sit below Due, live (Updated), and See it still finds them", async () => {
    const { dev, testId } = await setup({ languages: ["English"], devices: ["Windows PC"] });
    const j = await joined(testId);
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { description: "Sail to the second island" }, seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    const page = await sessionPage(j.sessionId, j.tester.user.id);
    const scope = page.slice(page.indexOf('data-scope=""'), page.indexOf('data-terms-history=""'));
    const contract = scope.slice(scope.indexOf('data-scope-contract=""'), scope.indexOf('data-scope-info=""'));
    const info = scope.slice(scope.indexOf('data-scope-info=""'));
    const at = (k: string) => contract.indexOf(`data-info-line="${k}"`);
    expect(contract.indexOf('data-scope-due=""')).toBeGreaterThan(0);
    expect(at("description")).toBeGreaterThan(contract.indexOf('data-scope-due=""'));
    expect(at("buildUrl")).toBeGreaterThan(at("description"));
    expect(at("languages")).toBeGreaterThan(at("buildUrl"));
    expect(at("devices")).toBeGreaterThan(at("languages"));
    expect(contract.indexOf('data-scope-agreed=""')).toBeGreaterThan(at("devices"));
    expect(contract).toContain("are the exception: they follow");
    expect(contract).toContain("marked Updated.");
    // Live: the current value, its Updated tag (See it marks lines by data-info-line / data-updated-at inside #scope); the shared boxes for long text.
    expect(contract).toMatch(/data-info-line="description" data-updated-at="[^"]+"/);
    expect(contract).toContain("Sail to the second island");
    expect(contract).toContain(`data-panel="scope-info-${j.sessionId}-description"`);
    expect(contract).toContain(`data-panel="scope-info-${j.sessionId}-buildUrl"`);
    expect(contract).toContain("English");
    expect(contract).toContain("Windows PC");
    for (const k of ["description", "buildUrl", "languages", "devices"]) expect(info).not.toContain(`data-info-line="${k}"`);
    expect(info).toContain('data-info-line="title"');
    expect(page.indexOf('id="scope"')).toBeLessThan(page.indexOf('data-info-line="description"'));
  });
});
