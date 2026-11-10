import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { prevSetsOf } from "@/lib/answerSets";
import { carriedAnswers, questionKey } from "@/lib/additions";
import { countsOf } from "@/lib/limits";
import { unitsOf } from "@/lib/draftUnits";
import { questionChanges } from "@/lib/questionHistory";
import { sameQuestionSet, sameQuestionWords } from "@/lib/questions";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 5, batch 35 §269) 1. Order doesn't matter: a Save that only reorders the questions (the same words and Required ticks) is not a questions change
// (no count, notice, Terms history set or stop); the order is saved and shown, and answers stay with their questions by words. 2. A tester's Send Answers or Add
// to this answer from a page that hasn't shown a questions change stops once, listing what changed; the page then takes the new questions (typed text kept by
// words, a removed question's text in the draft snapshot) and the next press sends. A question that comes back is current again on both sides.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/s", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const Q1 = "What did you like?", Q2 = "Where did you get stuck?", Q3 = "What would you change?";
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  const r = await act(testId, "edit", cookie, { version: v, fields, seenAt: seen(), confirmed: true });
  await settle();
  return r;
};
const sessionPage = async (sessionId: string, userId: string) => {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
  return unescape(renderToStaticMarkup(await SessionPage({ params: Promise.resolve({ id: sessionId }) })));
};
type Line = { text: string; sid?: string; forced?: boolean };
const linesOf = (r: { body: { error?: { changes?: Line[] } } }) => r.body.error?.changes ?? [];
const qCount = async (testId: string) => countsOf((await db.test.findUniqueOrThrow({ where: { id: testId } })).criticalCounts).questions;
const bells = (userId: string) => db.notification.count({ where: { userId, text: { contains: "updated the listing" } } });

describe("§269 order doesn't matter", () => {
  it("compares question lists as sets: words and Required ticks, never their order", () => {
    expect(sameQuestionSet([Q1, `[required] ${Q2}`], [`[required] ${Q2}`, Q1])).toBe(true);
    expect(sameQuestionSet([Q1, Q2], [Q1, `[required] ${Q2}`])).toBe(false);
    expect(sameQuestionWords([Q1, Q2], [`[required] ${Q2}`, Q1])).toBe(true);
    expect(sameQuestionWords([Q1, Q2], [Q1, Q3])).toBe(false);
  });

  it("a reorder-only Save: no count (even at 3), no notice, no Terms history set, no stop; the order is saved and shown, answers stay by words", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["the boats", "level two gate"], notes: "", seenAt: seen(), confirmed: true })).status).toBe(200);
    // The questions' 3 changes are used up: a reorder is still allowed (it uses none).
    const c0 = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } });
    await db.test.update({ where: { id: testId }, data: { criticalCounts: { questions: 3, since: c0.joinedAt.toISOString() } } });
    const pageAt = seen();
    await settle();
    const events0 = await db.testEvent.count({ where: { testId } });
    expect((await edit(testId, dev.cookie, { questions: [Q2, Q1] })).status).toBe(200);
    expect(await qCount(testId)).toBe(3);
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).questions).toEqual([Q2, Q1]);
    const c = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } });
    expect(c.questions).toEqual([Q2, Q1]);
    expect(prevSetsOf(c.prevSets)).toHaveLength(0);
    // No listing line, top-box line, Updated mark or bell: nothing was recorded.
    expect(await db.testEvent.count({ where: { testId } })).toBe(events0);
    expect(await bells(j.tester.user.id)).toBe(0);
    // Answers stay with their questions by their words.
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId, kind: "written" } });
    expect(carriedAnswers(sub, [Q2, Q1])).toEqual(["level two gate", "the boats"]);
    // The page: question numbers follow the new order, no "Updated", no "Questions changed".
    const page = await sessionPage(j.sessionId, j.tester.user.id);
    const scope = page.slice(page.indexOf('data-scope-questions=""'), page.indexOf('data-scope-due=""'));
    expect(scope.indexOf(Q2)).toBeLessThan(scope.indexOf(Q1));
    expect(scope).not.toContain("Updated ");
    expect(page).not.toContain("Questions changed ");
    // A press from the page loaded before the reorder doesn't stop (no stop-once reason), and adds by words.
    expect((await sact(j.sessionId, "written-add", j.tester.cookie, { text: "more on the gate", question: questionKey(Q2), seenAt: pageAt })).status).toBe(200);
  });

  it("a reorder with other fields saves the order with them; questions aren't in that Save's changes", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await edit(testId, dev.cookie, { questions: [Q2, Q1], description: "Sail further" })).status).toBe(200);
    expect(await qCount(testId)).toBe(0);
    expect((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions).toEqual([Q2, Q1]);
    const save = await db.testEvent.findFirstOrThrow({ where: { testId, kind: "listing_saved" }, orderBy: { createdAt: "desc" } });
    expect(JSON.parse(save.text).fields).toEqual(["description"]);
  });

  it("reorder plus a change: counted once, one Terms history set, and its Then → Now shows the real change, not the reorder", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await edit(testId, dev.cookie, { questions: [Q3, Q1] })).status).toBe(200);
    expect(await qCount(testId)).toBe(1);
    const c = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } });
    expect(c.questions).toEqual([Q3, Q1]);
    expect(prevSetsOf(c.prevSets)).toHaveLength(1);
    const [entry] = questionChanges(c.prevSets, [Q3, Q1], null, { drafts: true });
    expect(entry.then.map((q) => q.question)).toEqual([Q1, Q2]);
    // Q1 keeps its place; Q2 removed, Q3 added.
    expect(entry.now.map((q) => q.question)).toEqual([Q1, Q3]);
    expect(await bells(j.tester.user.id)).toBe(1);
  });
});

describe("§269 a stale page's Send stops once, then takes the new questions", () => {
  it("the first form: stops (even confirmed, even with Alerts Off), keeps the typed text by words, puts a removed question's text in the snapshot; the next press sends", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    await db.user.update({ where: { id: j.tester.user.id }, data: { testerAlertsOff: true } });
    const pageAt = seen();
    await settle();
    expect((await edit(testId, dev.cookie, { questions: [Q1, Q3] })).status).toBe(200);
    const stale = { answers: ["the boats", "level two gate"], for: [Q1, Q2], notes: "", seenAt: pageAt };
    for (const body of [stale, { ...stale, confirmed: true }]) {
      const r = await sact(j.sessionId, "written", j.tester.cookie, body);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe("stop_once");
      expect(r.body.error.questions).toBe(true);
      const texts = linesOf(r).map((l) => l.text);
      expect(texts).toContain(`Nora Lane removed the question “${Q2}”`);
      expect(texts).toContain(`Nora Lane added the question “${Q3}”`);
      expect(linesOf(r).every((l) => l.forced)).toBe(true);
    }
    expect(await db.submission.count({ where: { contractId: j.sessionId } })).toBe(0);
    // Typed for a current question: in the draft (by its words). Typed for the removed one: the draft snapshot of its Terms history entry.
    const kept = await db.keptForm.findUniqueOrThrow({ where: { userId_key: { userId: j.tester.user.id, key: `written:${j.sessionId}` } } });
    expect(unitsOf(`written:${j.sessionId}`, kept.data)[`a:${Q1}`]).toBe("the boats");
    const [set] = prevSetsOf((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).prevSets);
    expect(set.versions?.find((v) => v.kind === "draft")?.items.find((x) => x.question === Q2)?.answer).toBe("level two gate");
    const page = await sessionPage(j.sessionId, j.tester.user.id);
    const history = page.slice(page.indexOf("data-history-then"));
    expect(history).toContain("Draft (not sent)");
    expect(history).toContain("level two gate");
    // The page took the new questions: the next press sends, by words.
    const ok = await sact(j.sessionId, "written", j.tester.cookie, { answers: ["the colours", "the boats"], for: [Q3, Q1], notes: "", seenAt: pageAt, confirmed: true, boxAt: seen() });
    expect(ok.status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId, kind: "written" } });
    expect(carriedAnswers(sub, [Q1, Q3])).toEqual(["the boats", "the colours"]);
  });

  it("a page that already has the new questions follows the ordinary rule: one stop listing the question changes (Alerts on), then it sends", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    const pageAt = seen();
    await settle();
    expect((await edit(testId, dev.cookie, { questions: [Q1, `[required] ${Q2}`, Q3] })).status).toBe(200);
    const body = { answers: ["the boats", "level two gate", ""], for: [Q1, `[required] ${Q2}`, Q3], notes: "", seenAt: pageAt };
    const r = await sact(j.sessionId, "written", j.tester.cookie, body);
    expect(r.status).toBe(409);
    expect(r.body.error.questions).toBe(true);
    const texts = linesOf(r).map((l) => l.text);
    expect(texts).toContain(`Nora Lane added the question “${Q3}”`);
    expect(texts).toContain(`Nora Lane made the question “${Q2}” required`);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { ...body, confirmed: true, boxAt: seen() })).status).toBe(200);
  });

  it("comes back unanswered: the draft typed on the stale page is back in the form's kept draft", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    const pageAt = seen();
    await settle();
    expect((await edit(testId, dev.cookie, { questions: [Q1, Q3] })).status).toBe(200);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["", "level two gate"], for: [Q1, Q2], notes: "", seenAt: pageAt })).status).toBe(409);
    expect((await edit(testId, dev.cookie, { questions: [Q1, Q3, Q2] })).status).toBe(200);
    const kept = await db.keptForm.findUniqueOrThrow({ where: { userId_key: { userId: j.tester.user.id, key: `written:${j.sessionId}` } } });
    expect(unitsOf(`written:${j.sessionId}`, kept.data)[`a:${Q2}`]).toBe("level two gate");
    const page = await sessionPage(j.sessionId, j.tester.user.id);
    const form = page.slice(page.indexOf("data-answer-form="));
    expect(form).toContain(Q2);
  });

  it("the open-questions form (after a Send): a stale page stops once, and its removed question's text comes back with the question", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["the boats", "level two gate"], notes: "", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await edit(testId, dev.cookie, { questions: [Q1, Q2, Q3] })).status).toBe(200);
    const pageAt = seen();
    await settle();
    const Q4 = "Would you play again?";
    expect((await edit(testId, dev.cookie, { questions: [Q1, Q2, Q4] })).status).toBe(200);
    const r = await sact(j.sessionId, "written", j.tester.cookie, { answers: ["more colour"], for: [Q3], notes: "", seenAt: pageAt, confirmed: true });
    expect(r.status).toBe(409);
    expect(linesOf(r).map((l) => l.text)).toContain(`Nora Lane removed the question “${Q3}”`);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["yes"], for: [Q4], notes: "", seenAt: pageAt, confirmed: true, boxAt: seen() })).status).toBe(200);
    expect((await edit(testId, dev.cookie, { questions: [Q1, Q2, Q4, Q3] })).status).toBe(200);
    const kept = await db.keptForm.findUniqueOrThrow({ where: { userId_key: { userId: j.tester.user.id, key: `written:${j.sessionId}` } } });
    expect(unitsOf(`written:${j.sessionId}`, kept.data)[`a:${Q3}`]).toBe("more colour");
  });
});

describe("§269 a stale page's Add to this answer, and an answered question that comes back", () => {
  it("stops for its removed question every time (text kept under it); brought back, its answer and additions return and Add works", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["the boats", "level two gate"], notes: "", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await sact(j.sessionId, "written-add", j.tester.cookie, { text: "and the second gate", question: questionKey(Q2), seenAt: seen(), confirmed: true })).status).toBe(200);
    const pageAt = seen();
    await settle();
    expect((await edit(testId, dev.cookie, { questions: [Q1, Q3] })).status).toBe(200);
    const add = { text: "one more thing", question: questionKey(Q2), seenAt: pageAt };
    const r = await sact(j.sessionId, "written-add", j.tester.cookie, add);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("stop_once");
    expect(r.body.error.questions).toBe(true);
    expect(linesOf(r).map((l) => l.text)).toContain(`Nora Lane removed the question “${Q2}”`);
    const draft = await db.keptForm.findUniqueOrThrow({ where: { userId_key: { userId: j.tester.user.id, key: `add:${j.sessionId}:${questionKey(Q2)}` } } });
    expect(draft.data).toEqual({ text: "one more thing" });
    // (Owner, Nov 11, §375; was the plain refusal once listed) Every press is the questions box again, never added under a question the contract no longer has.
    const again = await sact(j.sessionId, "written-add", j.tester.cookie, { ...add, confirmed: true, boxAt: seen(), shownIds: linesOf(r).map((l) => l.sid) });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("stop_once");
    expect(again.body.error.questions).toBe(true);
    // Brought back: current again, its answer and its addition in the list, and Add to this answer works.
    expect((await edit(testId, dev.cookie, { questions: [Q1, Q3, Q2] })).status).toBe(200);
    const page = await sessionPage(j.sessionId, j.tester.user.id);
    const list = page.slice(page.indexOf('data-panel="own-answers-list-'), page.indexOf('data-question-body="else"'));
    expect(list).toContain(Q2);
    expect(list).toContain("level two gate");
    expect(list).toContain("and the second gate");
    expect(page.slice(page.indexOf("data-answer-form=")).slice(0, 2000)).not.toContain(Q2);
    expect((await sact(j.sessionId, "written-add", j.tester.cookie, { text: "one more thing", question: questionKey(Q2), seenAt: seen(), confirmed: true })).status).toBe(200);
  });
});
