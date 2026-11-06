import { readFileSync } from "node:fs";
import path from "node:path";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { SentWork } from "@/components/SentWork";
import { WrittenForm } from "@/app/app/sessions/[id]/SessionActions";
import { OLD_TAG, QUESTION_GONE, addsCounted, additionsOf, carriedAnswers, isPastQuestion, questionKeys } from "@/lib/additions";
import { PRESS_VERBS, SEND_ANSWERS, pressLabelOf } from "@/lib/pressLabels";
import { ANSWER_ONE } from "@/lib/questions";
import { joined, sact, seen, setup } from "./fixtures";

// (Owner, Nov 5, batch 35 §234) A "Past questions (N)" box: the questions no longer in the tester's contract, read-only, with what was sent and added to them, and
// the earlier sets' folds; the answers panel shows only the current questions and Anything else; Needs you never shows a past question; adding to one is refused.
// (§235) The tester's written part: Add to this answer under each answer (in its fold); one form below the answers with a box for each current question that has
// no answer yet, and only those (first answers free); its button always "Send Answers".
// (Owner, Nov 5, §263, final; replaces §234's box) No Past questions box: the answer lists show the current questions only; an old question is in Terms history;
// Needs you still shows a new, unpaid answer to one, tagged "Old".

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/s", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const Q1 = "What did you like?", Q2 = "Where did you get stuck?", Q3 = "What would you change?";
const item = (question: string, answer: string) => ({ question, required: false, answer });
const written = (sessionId: string) => db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: sessionId, kind: "written" } } });
const send = (sessionId: string, cookie: string, body: Record<string, unknown>) => sact(sessionId, "written", cookie, { notes: "", seenAt: seen(), confirmed: true, ...body });
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
/** Sent for Q1 and Q2, then the questions changed to Q1 and Q3 and the tester sent her answers to them: Q2 is a past question. */
async function switched() {
  const { dev, testId } = await setup();
  const j = await joined(testId);
  expect((await send(j.sessionId, j.tester.cookie, { answers: ["the boats", "level two gate"] })).status).toBe(200);
  const sub = await written(j.sessionId);
  await db.contract.update({ where: { id: j.sessionId }, data: { questions: [Q1, Q3] } });
  await db.submission.update({ where: { id: sub.id }, data: { additions: [
    { at: new Date(Date.now() - 30_000).toISOString(), items: [item(Q1, "the boats"), item(Q3, "the map colours")], notes: "", files: [] },
    { at: new Date(Date.now() - 20_000).toISOString(), text: "late note on Q2", files: [], questionKey: questionKeys([{ question: Q2 }])[0] },
  ] } });
  return { dev, testId, j, sub };
}

describe("§234 / §263 old questions (lib and SentWork)", () => {
  it("a question is old when the contract no longer has it (by its words); the lists draw the current ones only, Needs you also a new answer to an old one, tagged Old", () => {
    expect(isPastQuestion(Q2, [Q1, Q3])).toBe(true);
    expect(isPastQuestion(`[required] ${Q1}`, [Q1])).toBe(false);
    const additions = [{ at: "2026-11-05T10:00:00.000Z", items: [item(Q1, "a"), item(Q3, "c")], notes: "", files: [] }];
    const props = { id: "x", kind: "written", answers: [item(Q1, "a"), item(Q2, "b")], questions: [Q1, Q3], notes: "n", additions, files: [] };
    const list = renderToStaticMarkup(h(SentWork, props));
    expect(list).toContain(Q3);
    expect(list).not.toContain(Q2);
    expect(list).toContain('data-anything-else=""');
    const needs = renderToStaticMarkup(h(SentWork, { ...props, newOnly: { since: null } }));
    expect(needs.indexOf(Q3)).toBeLessThan(needs.indexOf(Q2));
    expect(needs.match(/data-old-question=""/g)).toHaveLength(1);
    expect(needs).toContain(`data-old-question="">${OLD_TAG}</span>`);
  });
});

describe("§263 on both sides", () => {
  it("the tester: the list has only the current questions; Q2 with what was sent and added is in Terms history", async () => {
    const { j } = await switched();
    const page = await sessionPage(j.sessionId, j.tester.user.id);
    const panel = page.slice(page.indexOf('data-panel="own-answers-list-'), page.indexOf('data-question-body="else"'));
    expect(panel).toContain(Q1);
    expect(panel).toContain(Q3);
    expect(panel).not.toContain(Q2);
    expect(page).not.toContain("data-past-questions");
    expect(page).not.toContain("data-old-question");
  });

  it("the developer: the Testers list's part has the current questions only; Needs you shows Q2's unpaid answer, tagged Old", async () => {
    const { dev, testId, sub } = await switched();
    const page = await testPage(testId, dev.user.id);
    const row = page.slice(page.indexOf(`id="part-${sub.id}"`));
    const rowPanel = row.slice(row.indexOf(`data-panel="row-${sub.id}"`), row.indexOf('data-question-body="else"'));
    expect(rowPanel).toContain(Q3);
    expect(rowPanel).not.toContain(Q2);
    expect(page).not.toContain("data-past-questions");
    const needs = page.slice(page.indexOf(`data-panel="needs-${sub.id}"`), page.indexOf(`id="part-${sub.id}"`));
    expect(needs).toContain(Q2);
    expect(needs).toContain("late note on Q2");
    expect(needs).toContain(`data-old-question="">${OLD_TAG}</span>`);
    expect(needs).not.toContain("data-past-elsewhere");
  });

  it("the server refuses an addition to a past question (not only hidden)", async () => {
    const { j } = await switched();
    const r = await sact(j.sessionId, "written-add", j.tester.cookie, { text: "more on the gate", question: questionKeys([{ question: Q2 }])[0], seenAt: seen(), confirmed: true });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toBe(QUESTION_GONE);
  });
});

describe("§235 the tester's written part", () => {
  it("one button: \"Send Answers\", the first Send and later; refusals name it", () => {
    expect(SEND_ANSWERS).toBe("Send Answers");
    expect(PRESS_VERBS.written).toBe("Send Answers");
    expect(pressLabelOf("/api/sessions/s1/written", {})).toBe("Send Answers");
    const first = renderToStaticMarkup(h(WrittenForm, { sessionId: "s1", seenAt: seen(), questions: [Q1, Q2], initial: ["", ""], initialNotes: "", update: false }));
    expect(first).toContain(">Send Answers</button>");
    expect(first).toContain('for="notes"');
    const later = renderToStaticMarkup(h(WrittenForm, { sessionId: "s1", seenAt: seen(), questions: [Q2], initial: [""], initialNotes: "", update: false, only: true }));
    expect(later).toContain(">Send Answers</button>");
    expect(later).not.toContain('for="notes"'); // Anything else has its own Add
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).not.toMatch(/Send my answers to the new questions"|"Send my answers"/);
  });

  it("the page: Add under each answered question (in its fold); the unanswered one in the form below, alone; no rows under the panel", async () => {
    const { testId } = await setup();
    const j = await joined(testId);
    expect((await send(j.sessionId, j.tester.cookie, { answers: ["the boats", ""] })).status).toBe(200);
    const [k1, k2] = questionKeys([{ question: Q1 }, { question: Q2 }]);
    const page = await sessionPage(j.sessionId, j.tester.user.id);
    expect(page).not.toContain("data-add-buttons");
    const q1 = page.slice(page.indexOf(`data-question-body="${k1}"`), page.indexOf(`data-question-body="${k2}"`));
    expect(q1).toContain('data-add-more="written">Add to this answer</button>');
    const q2 = page.slice(page.indexOf(`data-question-body="${k2}"`), page.indexOf('data-question-body="else"'));
    expect(q2).toContain('data-answer-below="">Answer it in the form below.</p>');
    expect(q2).not.toContain("data-add-more");
    expect(page.slice(page.indexOf('data-question-body="else"'))).toContain('data-add-more="written"');
    const form = page.slice(page.indexOf('data-answer-form="open"'));
    expect(form).toContain("Questions you haven't answered yet");
    expect(form).toContain(Q2);
    expect(form.slice(0, form.indexOf(">Send Answers</button>"))).not.toContain(Q1);
    expect(form).toContain(">Send Answers</button>");
  });

  it("the server: Send Answers after a send answers only the open questions, keeps the answered ones as they were, and the first answer is free", async () => {
    const { testId } = await setup();
    const j = await joined(testId);
    await send(j.sessionId, j.tester.cookie, { answers: ["the boats", ""] });
    const [, k2] = questionKeys([{ question: Q1 }, { question: Q2 }]);
    // Only an answered question sent (an older or edited page): nothing new to answer.
    const none = await send(j.sessionId, j.tester.cookie, { answers: ["rewritten"], for: [Q1] });
    expect(none.status).toBe(400);
    expect(none.body.error.message).toBe(ANSWER_ONE);
    const ok = await send(j.sessionId, j.tester.cookie, { answers: ["stuck at the gate"], for: [Q2] });
    expect(ok.status).toBe(200);
    const sub = await written(j.sessionId);
    expect(additionsOf(sub.additions).at(-1)?.items).toEqual([item(Q1, "the boats"), item(Q2, "stuck at the gate")]);
    expect(carriedAnswers(sub, [Q1, Q2])).toEqual(["the boats", "stuck at the gate"]);
    expect(addsCounted(sub.additions, k2)).toBe(0); // free: not one of its 5
    // Answered now: the form has nothing left, and the same Send is refused as before (locked).
    const again = await send(j.sessionId, j.tester.cookie, { answers: ["more"], for: [Q2] });
    expect(again.status).toBe(409); // SENT_ANSWERS_LOCKED: nothing open to answer
  });

  it("after a switch whose questions all have answers: the form shows only the carry-over line and Send Answers moves the part onto them", async () => {
    const { testId } = await setup();
    const j = await joined(testId);
    await send(j.sessionId, j.tester.cookie, { answers: ["the boats", "the gate"] });
    const sub = await written(j.sessionId);
    await db.contract.update({ where: { id: j.sessionId }, data: { questions: [Q1] } });
    await db.submission.update({ where: { id: sub.id }, data: { setUntil: new Date() } });
    const page = await sessionPage(j.sessionId, j.tester.user.id);
    const form = page.slice(page.indexOf('data-answer-form="open"'));
    expect(form).toContain('data-carry-over=""');
    expect(form).toContain(">Send Answers</button>");
    const r = await send(j.sessionId, j.tester.cookie, { answers: [], for: [] });
    expect(r.status).toBe(200);
    expect(additionsOf((await written(j.sessionId)).additions).at(-1)?.items).toEqual([item(Q1, "the boats")]);
  });
});
