import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { SentWork, AddedLabel } from "@/components/SentWork";
import { AnswerText, QuestionText } from "@/components/QA";
import { NEW_QUESTION_TAG } from "@/lib/additions";
import { questionChanges } from "@/lib/questionHistory";
import { joined, sact, seen, setup } from "./fixtures";

// (Owner, Nov 5, batch 35 §254) Past questions without the earlier sets' "Previous questions and answers" folds, on both sides; an answer sent in an earlier set
// that no thread holds (sent before §136, when a Send after a switch replaced the set) is still shown, as one more past question; N counts what's drawn.
// (§255) No "new question" tag on the developer's side; the tester keeps it. (§256) Questions (sky-tinted boxes, sky labels) and answers (volt accent, volt
// labels) told apart at a glance.
// (Owner, Nov 5, §263, final) No Past questions box: an old question is only in Terms history ("Questions changed", Then with what was sent → Now).

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
// (Owner, Nov 5, §263) The tester's "Your written answers" panel, or the developer's Testers list part's panel (current questions only).
const ownList = (page: string) => { const s = page.slice(page.indexOf('data-panel="own-answers-list-')); return s.slice(0, s.indexOf('data-question-body="else"')); };
const rowList = (page: string, subId: string) => { const s = page.slice(page.indexOf(`data-panel="row-${subId}"`)); return s.slice(0, s.indexOf('data-question-body="else"')); };

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

describe("§254 / §263 the earlier sets are Terms history entries (lib)", () => {
  it("Then: each question with what was sent for it at the change (a set replaced before §136: its own sent answer); Now: the questions after", () => {
    const until = "2026-11-05T10:00:00.000Z";
    const old = [item(Q1, "the boats"), item(Q2, "level two gate")];
    const sets = [{ until, items: old, versions: [{ kind: "sent", at: until, items: old }, { kind: "draft", items: [item(Q1, "the boats"), item(Q2, "an unsent draft line")] }] }];
    const now = questionChanges(sets, [Q1, Q3], { answers: old, additions: [{ at: "2026-11-05T10:05:00.000Z", items: [item(Q1, "the boats"), item(Q3, "c")], notes: "", files: [] }] }, { drafts: true });
    expect(now).toHaveLength(1);
    expect(now[0].then.map((q) => [q.question, q.sent?.answer ?? null, q.draft])).toEqual([[Q1, "the boats", null], [Q2, "level two gate", null]]);
    expect(now[0].now.map((q) => q.question)).toEqual([Q1, Q3]);
    const legacy = questionChanges([{ until, items: old }], [Q1, Q3], { answers: [item(Q1, "the boats, again"), item(Q3, "the map colours")], additions: [] }, { drafts: true });
    expect(legacy[0].then.map((q) => q.sent?.answer)).toEqual(["the boats", "level two gate"]);
  });

  it("PrevSetFolds is gone from the code", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });
    for (const f of walk(path.resolve(__dirname, "../src"))) expect(readFileSync(f, "utf8"), f).not.toMatch(/<PrevSetFolds|export function PrevSetFolds|PastQuestions/);
  });
});

describe("§254 / §263 on both sides", () => {
  for (const legacy of [false, true]) it(`${legacy ? "sent before §136 (the set replaced)" : "as now"}: Q2 is only in Terms history, with what was sent; never the draft on the developer's side`, async () => {
    const { dev, testId, j, sub } = await switched(legacy);
    const page = await sessionPage(j.sessionId, j.tester.user.id);
    expect(ownList(page)).not.toContain(Q2);
    const mine = page.slice(page.indexOf("data-questions-changed="));
    expect(mine).toContain("Questions changed ");
    expect(mine).toContain("level two gate");
    expect(mine.slice(mine.indexOf('data-history-now=""'))).toContain(Q3);
    const theirs = await testPage(testId, dev.user.id);
    expect(rowList(theirs, sub.id)).not.toContain(Q2);
    const hist = theirs.slice(theirs.indexOf("data-dev-terms-history="));
    expect(hist).toContain("level two gate");
    expect(hist).not.toContain("an unsent draft line");
    expect(theirs).not.toContain("data-prev-set");
  });
});

describe("§255 the new question tag", () => {
  it("SentWork draws it by default (the tester) and not with newQuestionTag={false} (the developer)", () => {
    const props = { id: "n", kind: "written", answers: [item(Q1, "a")], questions: [Q1, Q3], notes: "", additions: [{ at: "2026-11-05T10:00:00.000Z", items: [item(Q1, "a"), item(Q3, "c")], notes: "", files: [] }], files: [] };
    expect(renderToStaticMarkup(h(SentWork, props))).toContain(`data-new-question="">${NEW_QUESTION_TAG}</span>`);
    expect(renderToStaticMarkup(h(SentWork, { ...props, newQuestionTag: false }))).not.toContain("data-new-question");
    const dev = src("app/app/tests/[id]/page.tsx");
    expect(count(dev, "<SentWork ")).toBe(3);
    expect(count(dev, "newQuestionTag={false}")).toBe(3); // Needs you, the update row, the Testers list ((§263) no Past questions box any more)
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
    expect(q).toMatch(/<p class="[^"]*text-sky-300" data-qa-label="">Question 1/);
    expect(q).toContain('data-qa-text="question">Why?</div>');
    const a = renderToStaticMarkup(h(AnswerText, { id: "a" }, "Because."));
    expect(a).toContain("!border-l-2 !border-l-volt-300/60");
    expect(a).not.toContain("!border-l-sky"); expect(a).not.toContain("!bg-sky");
    expect(a).toMatch(/<p class="[^"]*text-volt-300" data-qa-label="">Answer<\/p>/);
    const added = renderToStaticMarkup(h(AnswerText, { id: "b", label: h(AddedLabel, { at: "2026-11-05T10:00:00.000Z" }) }, "More."));
    expect(added).toContain('class="text-xs font-semibold text-emerald-300" data-added-label=""');
    expect(added).not.toContain("text-volt-300");
  });

  it("no answer box drawn by hand: the excerpt picker's answer is QA's AnswerText", () => {
    const picker = src("components/Excerpts.tsx");
    expect(picker).toContain("<AnswerText id={`excerpt-original-${submissionId}`}");
    expect(picker).not.toContain("<ResizeBox");
  });
});
