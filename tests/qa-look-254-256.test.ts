import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { SentWork, AddedLabel } from "@/components/SentWork";
import { pastCount } from "@/components/PastQuestions";
import { AnswerText, QuestionText } from "@/components/QA";
import { NEW_QUESTION_TAG, earlierSent, pastThreads, writtenThreads } from "@/lib/additions";
import { joined, sact, seen, setup } from "./fixtures";

// (Owner, Nov 5, batch 35 §254) Past questions without the earlier sets' "Previous questions and answers" folds, on both sides; an answer sent in an earlier set
// that no thread holds (sent before §136, when a Send after a switch replaced the set) is still shown, as one more past question; N counts what's drawn.
// (§255) No "new question" tag on the developer's side; the tester keeps it. (§256) Questions (sky-tinted boxes, sky labels) and answers (volt accent, volt
// labels) told apart at a glance.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/s", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const Q1 = "What did you like?", Q2 = "Where did you get stuck?", Q3 = "What would you change?";
const item = (question: string, answer: string) => ({ question, required: false, answer });
const count = (s: string, needle: string) => s.split(needle).length - 1;
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
const pastBox = (page: string) => { const s = page.slice(page.indexOf("data-past-questions=")); return s.slice(0, s.indexOf("</section>")); };

/** Sent for Q1 and Q2; the questions changed to Q1 and Q3. `legacy`: the answers to Q1 and Q3 were sent before §136 (they REPLACED the set, the old one kept in
 *  the piece's prevSets); otherwise as now (added under it). The contract keeps its earlier set (a "Sent" version and an unsent draft) either way. */
async function switched(legacy: boolean) {
  const { dev, testId } = await setup();
  const j = await joined(testId);
  expect((await send(j.sessionId, j.tester.cookie, { answers: ["the boats", "level two gate"] })).status).toBe(200);
  const sub = await written(j.sessionId);
  const until = new Date(Date.now() - 40_000).toISOString();
  const old = [item(Q1, "the boats"), item(Q2, "level two gate")];
  await db.contract.update({ where: { id: j.sessionId }, data: { questions: [Q1, Q3], prevSets: [{ until, items: old, versions: [{ kind: "sent", at: until, items: old }, { kind: "draft", items: [item(Q1, "the boats"), item(Q2, "an unsent draft line")] }] }] } });
  await db.submission.update({ where: { id: sub.id }, data: legacy
    ? { answers: [item(Q1, "the boats, again"), item(Q3, "the map colours")], prevSets: [{ until, items: old }], additions: [] }
    : { additions: [{ at: new Date(Date.now() - 30_000).toISOString(), items: [item(Q1, "the boats"), item(Q3, "the map colours")], notes: "", files: [] }] } });
  return { dev, testId, j, sub };
}

describe("§254 the earlier sets' sent answers (lib)", () => {
  it("an answer no thread holds becomes a past question; one a thread holds (its answer or an addition) is never shown twice; blanks are skipped", () => {
    // As now (§136): the earlier set only copies what was sent, so nothing is added.
    const additions = [{ at: "2026-11-05T10:00:00.000Z", items: [item(Q1, "a"), item(Q3, "c")], notes: "", files: [] }];
    const { threads } = writtenThreads([item(Q1, "a"), item(Q2, "b")], [Q1, Q3], additions);
    expect(earlierSent(threads, [[item(Q1, "a"), item(Q2, "b")]])).toEqual([]);
    expect(pastThreads([item(Q1, "a"), item(Q2, "b")], [Q1, Q3], additions, [[item(Q1, "a"), item(Q2, "b")]]).map((t) => t.question)).toEqual([Q2]);
    // Before §136: the set was replaced; the old answers are in no thread.
    const legacy = pastThreads([item(Q1, "a2"), item(Q3, "c")], [Q1, Q3], [], [[item(Q1, "a"), item(Q2, "b"), item(Q3, "")], [item(Q2, "b")]]);
    expect(legacy.map((t) => [t.question, t.answer])).toEqual([[Q1, "a"], [Q2, "b"]]);
    expect(new Set(legacy.map((t) => t.key)).size).toBe(2);
    expect(legacy.every((t) => !t.fresh && !t.adds.length)).toBe(true);
  });

  it("pastCount is exactly the folds SentWork's Past questions draws", () => {
    const answers = [item(Q1, "a2"), item(Q3, "c")], earlier = [[item(Q1, "a"), item(Q2, "b")]];
    const html = renderToStaticMarkup(h(SentWork, { id: "p", part: "past", kind: "written", answers, questions: [Q1, Q3], notes: "", additions: [], files: [], earlier }));
    expect(count(html, 'data-question-title=""')).toBe(2);
    expect(pastCount(answers, [Q1, Q3], [], earlier)).toBe(2);
    expect(html).toContain("<span>b</span>");
    expect(html).not.toContain("data-add-more");
    // The current panel never draws them.
    expect(renderToStaticMarkup(h(SentWork, { id: "c", part: "current", kind: "written", answers, questions: [Q1, Q3], notes: "", additions: [], files: [], earlier }))).not.toContain("<span>b</span>");
  });

  it("PrevSetFolds is gone from the code", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });
    for (const f of walk(path.resolve(__dirname, "../src"))) expect(readFileSync(f, "utf8"), f).not.toMatch(/<PrevSetFolds|export function PrevSetFolds/);
  });
});

describe("§254 on both sides", () => {
  it("as now: Past questions holds Q2 once, no earlier-set fold, no unsent draft", async () => {
    const { dev, testId, j, sub } = await switched(false);
    const mine = pastBox(await sessionPage(j.sessionId, j.tester.user.id));
    expect(mine).toContain('data-past-questions-title="">Past questions (1)</p>');
    expect(count(mine, "level two gate")).toBeGreaterThan(0);
    expect(mine).not.toContain("Previous questions and answers");
    expect(mine).not.toContain("an unsent draft line");
    const page = await testPage(testId, dev.user.id);
    const theirs = pastBox(page.slice(page.indexOf(`id="part-${sub.id}"`)));
    expect(theirs).toContain('data-past-questions-title="">Past questions (1)</p>');
    expect(theirs).toContain("level two gate");
    expect(theirs).not.toContain("Previous questions and answers");
    expect(theirs).not.toContain("data-prev-set");
  });

  it("sent before §136 (the set replaced): the old answers no thread holds still show, as past questions, and N counts them", async () => {
    const { dev, testId, j, sub } = await switched(true);
    const mine = pastBox(await sessionPage(j.sessionId, j.tester.user.id));
    expect(mine).toContain('data-past-questions-title="">Past questions (2)</p>');
    expect(mine).toContain("level two gate");
    expect(mine).toContain("<span>the boats</span>");
    expect(count(mine, 'data-question-title=""')).toBe(2);
    expect(mine).not.toContain("Previous questions and answers");
    const page = await testPage(testId, dev.user.id);
    const theirs = pastBox(page.slice(page.indexOf(`id="part-${sub.id}"`)));
    expect(theirs).toContain('data-past-questions-title="">Past questions (2)</p>');
    expect(theirs).toContain("level two gate");
    expect(theirs).toContain("<span>the boats</span>");
    expect(count(theirs, 'data-question-title=""')).toBe(2);
  });
});

describe("§255 the new question tag", () => {
  it("SentWork draws it by default (the tester) and not with newQuestionTag={false} (the developer)", () => {
    const props = { id: "n", kind: "written", answers: [item(Q1, "a")], questions: [Q1, Q3], notes: "", additions: [{ at: "2026-11-05T10:00:00.000Z", items: [item(Q1, "a"), item(Q3, "c")], notes: "", files: [] }], files: [] };
    expect(renderToStaticMarkup(h(SentWork, props))).toContain(`data-new-question="">${NEW_QUESTION_TAG}</span>`);
    expect(renderToStaticMarkup(h(SentWork, { ...props, newQuestionTag: false }))).not.toContain("data-new-question");
    const dev = src("app/app/tests/[id]/page.tsx");
    expect(count(dev, "<SentWork ")).toBe(4);
    expect(count(dev, "newQuestionTag={false}")).toBe(4); // Needs you, the update row, the Testers list, its Past questions
    expect(src("app/app/sessions/[id]/page.tsx")).not.toContain("newQuestionTag");
    expect(src("app/app/tests/[id]/ByQuestion.tsx")).not.toContain("NEW_QUESTION_TAG");
  });

  it("the pages: the tester sees it on Q3, the developer nowhere", async () => {
    const { dev, testId, j } = await switched(false);
    expect(await sessionPage(j.sessionId, j.tester.user.id)).toContain("data-new-question");
    expect(await testPage(testId, dev.user.id)).not.toContain("data-new-question");
  });
});

describe("§256 questions and answers told apart", () => {
  it("a question: a sky-tinted box with a sky border and left accent, a sky label; an answer: the volt accent and a volt label; Added stays green", () => {
    const q = renderToStaticMarkup(h(QuestionText, { id: "q", label: "Question 1", required: true }, "Why?"));
    expect(q).toContain("!border-sky-300/30 !border-l-2 !border-l-sky-300/70 !bg-sky-400/[0.08]");
    // (Owner, Nov 5, §259) no visible label over a question; "Question 1" is for screen readers only; the Required tag sits in the sky label line.
    expect(q).toContain('<span class="sr-only">Question 1</span>');
    expect(q).toMatch(/<p class="[^"]*text-sky-300" data-qa-required=""><span [^>]*data-required-tag="">Required<\/span><\/p>/);
    expect(q).toContain('data-qa-text="question">Why?</div>');
    const a = renderToStaticMarkup(h(AnswerText, { id: "a" }, "Because."));
    expect(a).toContain("!border-l-2 !border-l-volt-300/60");
    expect(a).not.toContain("!border-l-sky"); expect(a).not.toContain("!bg-sky");
    expect(a).toMatch(/<p class="[^"]*text-volt-300" data-qa-label="">Answer<\/p>/);
    const added = renderToStaticMarkup(h(AnswerText, { id: "b", label: h(AddedLabel, { at: "2026-11-05T10:00:00.000Z" }) }, "More."));
    expect(added).toContain('class="text-xs font-semibold text-emerald-300" data-added-label=""');
    expect(added).not.toContain("text-volt-300");
  });

  it("(Owner, Nov 5, §259) no visible label over a question, except where showLabel is passed (the questions changed' Before / After), in sky", () => {
    const plain = renderToStaticMarkup(h(QuestionText, { id: "q", label: "Question 1" }, "Why?"));
    expect(plain).not.toContain("data-qa-label");
    expect(plain).toContain('<span class="sr-only">Question 1</span>');
    expect(plain).not.toContain("data-qa-required"); // not required: nothing above the box
    const shown = renderToStaticMarkup(h(QuestionText, { id: "q", label: "Before", showLabel: true, required: true }, "Why?"));
    expect(shown).toMatch(/<p class="[^"]*text-sky-300" data-qa-label="">Before<span [^>]*data-required-tag="">Required<\/span><\/p>/);
    expect(shown).not.toContain('<span class="sr-only">Before</span>');
  });

  it("no answer box drawn by hand: the excerpt picker's answer is QA's AnswerText", () => {
    const picker = src("components/Excerpts.tsx");
    expect(picker).toContain("<AnswerText id={`excerpt-original-${submissionId}`}");
    expect(picker).not.toContain("<ResizeBox");
  });
});
