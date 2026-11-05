import { readFileSync } from "node:fs";
import path from "node:path";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { SentWork } from "@/components/SentWork";
import { QA_BOX_MAX } from "@/components/QA";
import { ResizeBox } from "@/components/Panel";
import { WrittenAddForm } from "@/app/app/sessions/[id]/SessionActions";
import {
  ADDITIONS_FULL, ADDITIONS_MAX, ANSWER_PRESS, ANYTHING_ELSE_KEY, additionsFull, additionsLeftLine, additionsOf, addsCounted, addsTo, latestItems, noAnswerYet, questionKeys,
} from "@/lib/additions";
import { pressLabelOf } from "@/lib/pressLabels";
import { joined, sact, seen, setup } from "./fixtures";

// (Owner, Nov 5, batch 35 §222; replaces §167's 10 additions per part) Each current question takes at most 5 additions, and Anything else its own 5. At a question's
// 5 only its row closes, with a grey note under it; the other rows stay open; each row says "N of 5 additions left". A question with no answer yet gets "Answer
// this question": that first answer is free (never one of its 5) and is offered after any cap; then the normal 5. The server enforces the same.
// (§223) Your written answers: each question's text, each answer and each addition in its own box that scrolls and drags taller.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/s", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const Q1 = "What did you like?", Q2 = "Where did you get stuck?";
const [K1, K2] = questionKeys([{ question: Q1 }, { question: Q2 }]);
const item = (question: string, answer: string) => ({ question, required: false, answer });
const send = (sessionId: string, cookie: string, answers: string[]) => sact(sessionId, "written", cookie, { answers, notes: "", seenAt: seen(), confirmed: true });
const add = (sessionId: string, cookie: string, text: string, question: string, first = false) =>
  sact(sessionId, "written-add", cookie, { text, question, seenAt: seen(), confirmed: true, ...(first ? { first: true } : {}) });
const written = (sessionId: string) => db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: sessionId, kind: "written" } } });
/** Puts `n` additions under each key (none: an old one with no question) straight into the stored part. */
async function seed(sessionId: string, per: [string | null, number][]) {
  const sub = await written(sessionId);
  let i = 0;
  const adds = per.flatMap(([key, n]) => Array.from({ length: n }, () => ({ at: new Date(Date.now() - 60_000 + i++).toISOString(), text: `seeded ${i}`, files: [], ...(key ? { questionKey: key } : {}) })));
  await db.submission.update({ where: { id: sub.id }, data: { additions: adds } });
}
const at1 = "2026-11-03T23:29:00.000Z";

describe("§222 the counts (lib/additions.ts)", () => {
  it("5 per question; the lines", () => {
    expect(ADDITIONS_MAX).toBe(5);
    expect(additionsFull(K1)).toBe("You've added to this answer 5 times, the most it takes.");
    expect(ADDITIONS_FULL).toBe("You've added to this answer 5 times, the most it takes.");
    expect(additionsFull(ANYTHING_ELSE_KEY)).toBe("You've added to Anything else 5 times, the most it takes.");
    expect(additionsLeftLine(2)).toBe("3 of 5 additions left");
    expect(ANSWER_PRESS).toBe("Answer this question");
  });

  it("each question counts only its own additions; Anything else counts its own and the old ones with no question; changed-questions sends and a free first answer never count", () => {
    const stored = [
      { at: at1, text: "q1 a", files: [], questionKey: K1 },
      { at: at1, text: "q1 b", files: [], questionKey: K1 },
      { at: at1, text: "q2 first", files: [], questionKey: K2, first: true },
      { at: at1, text: "q2 more", files: [], questionKey: K2 },
      { at: at1, text: "old untied", files: [] },
      { at: at1, text: "else", files: [], questionKey: ANYTHING_ELSE_KEY },
      { at: at1, items: [item(Q1, "changed"), item(Q2, "x")], notes: "set notes", files: [] },
    ];
    expect(addsCounted(stored, K1)).toBe(2);
    expect(addsTo(stored, K2)).toHaveLength(2);
    expect(addsCounted(stored, K2)).toBe(1);
    expect(addsCounted(stored, ANYTHING_ELSE_KEY)).toBe(2);
    expect(additionsOf(stored)[2].first).toBe(true);
    expect(additionsOf([{ at: at1, text: "t", files: [], first: "yes" }])[0].first).toBeUndefined();
  });

  it("a question with no answer yet: blank latest answer and nothing added to it (a new question from changed questions too); Anything else never", () => {
    const Q3 = "What would you change?";
    const sub = { answers: [item(Q1, "a"), item(Q2, "b")], additions: [{ at: at1, items: [item(Q1, "a"), item(Q2, "b"), item(Q3, "")], notes: "", files: [] }] };
    const latest = latestItems(sub);
    const keys = questionKeys(latest);
    expect(noAnswerYet(latest, keys, sub.additions, keys[2])).toBe(true);
    expect(noAnswerYet(latest, keys, sub.additions, keys[0])).toBe(false);
    expect(noAnswerYet(latest, keys, sub.additions, ANYTHING_ELSE_KEY)).toBe(false);
    // Answered (by its first answer): the normal 5 from then on.
    const answered = [...sub.additions, { at: at1, text: "now answered", files: [], questionKey: keys[2], first: true }];
    expect(noAnswerYet(latest, keys, answered, keys[2])).toBe(false);
    expect(addsCounted(answered, keys[2])).toBe(0);
  });
});

describe("§222 on the server", () => {
  it("a question's 6th is refused with its line; the other questions stay open; old untied additions count only toward Anything else", async () => {
    const { testId } = await setup();
    const j = await joined(testId);
    expect((await send(j.sessionId, j.tester.cookie, ["a", "b"])).status).toBe(200);
    await seed(j.sessionId, [[K1, 4], [null, 3]]);
    expect((await add(j.sessionId, j.tester.cookie, "the fifth", K1)).status).toBe(200);
    const sixth = await add(j.sessionId, j.tester.cookie, "the sixth, from an older page", K1);
    expect(sixth.status).toBe(409);
    expect(sixth.body.error.code).toBe("add_full");
    expect(sixth.body.error.message).toBe("You've added to this answer 5 times, the most it takes.");
    // Q2 is open (8 additions on the part, past the old 10's reach soon): 5 go, the 6th is refused.
    for (let n = 1; n <= 5; n++) expect((await add(j.sessionId, j.tester.cookie, `q2 ${n}`, K2)).status, `q2 ${n}`).toBe(200);
    expect((await add(j.sessionId, j.tester.cookie, "q2 6", K2)).body.error.message).toBe(additionsFull(K2));
    // Anything else: 3 old ones with no question count there, so 2 more go and the next is refused with its own line.
    expect((await add(j.sessionId, j.tester.cookie, "else 4", ANYTHING_ELSE_KEY)).status).toBe(200);
    expect((await add(j.sessionId, j.tester.cookie, "else 5", ANYTHING_ELSE_KEY)).status).toBe(200);
    const elseFull = await add(j.sessionId, j.tester.cookie, "else 6", ANYTHING_ELSE_KEY);
    expect(elseFull.status).toBe(409);
    expect(elseFull.body.error.message).toBe("You've added to Anything else 5 times, the most it takes.");
    expect(additionsOf((await written(j.sessionId)).additions)).toHaveLength(15); // 7 seeded, Q1's 5th, Q2's 5, Anything else's 2
  });

  it("two adds to one question at its 4 give exactly one 5th; the other gets the line", async () => {
    const { testId } = await setup();
    const j = await joined(testId);
    await send(j.sessionId, j.tester.cookie, ["a", "b"]);
    await seed(j.sessionId, [[K1, 4]]);
    const both = await Promise.all([add(j.sessionId, j.tester.cookie, "first press", K1), add(j.sessionId, j.tester.cookie, "second press", K1)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(both.find((r) => r.status === 409)!.body.error.message).toBe(additionsFull(K1));
    expect(addsCounted((await written(j.sessionId)).additions, K1)).toBe(5);
  });

  it("Answer this question: a question sent with no answer takes its first answer free (stored as `first`), even after every other cap; then its normal 5", async () => {
    const { testId } = await setup();
    const j = await joined(testId);
    expect((await send(j.sessionId, j.tester.cookie, ["a", ""])).status).toBe(200);
    await seed(j.sessionId, [[K1, 5], [ANYTHING_ELSE_KEY, 5]]);
    expect((await add(j.sessionId, j.tester.cookie, "one more", K1)).body.error.message).toBe(additionsFull(K1));
    const answer = await add(j.sessionId, j.tester.cookie, "I got stuck at the gate", K2, true);
    expect(answer.status).toBe(200);
    const stored = additionsOf((await written(j.sessionId)).additions);
    expect(stored.at(-1)).toMatchObject({ text: "I got stuck at the gate", questionKey: K2, first: true });
    expect(addsCounted(stored, K2)).toBe(0);
    // Then the normal 5: five more go, the sixth is refused.
    for (let n = 1; n <= 5; n++) expect((await add(j.sessionId, j.tester.cookie, `more ${n}`, K2)).status, `more ${n}`).toBe(200);
    expect((await add(j.sessionId, j.tester.cookie, "more 6", K2)).body.error.message).toBe(additionsFull(K2));
    const after = additionsOf((await written(j.sessionId)).additions).filter((a) => a.questionKey === K2);
    expect(after.filter((a) => a.first)).toHaveLength(1);
    expect(after).toHaveLength(6);
  });

  it("the server decides what is free, not the page: `first` from a page on an answered question still counts and is refused at its 5", async () => {
    const { testId } = await setup();
    const j = await joined(testId);
    await send(j.sessionId, j.tester.cookie, ["a", "b"]);
    await seed(j.sessionId, [[K1, 5]]);
    const r = await add(j.sessionId, j.tester.cookie, "pretending", K1, true);
    expect(r.status).toBe(409);
    expect(r.body.error.message).toBe(additionsFull(K1));
  });

  it("the press is named Answer this question (refusals, failed-press lines); Add otherwise", () => {
    expect(pressLabelOf("/api/sessions/s1/written-add", { first: true, question: K2 })).toBe("Answer this question");
    expect(pressLabelOf("/api/sessions/s1/written-add", { question: K1 })).toBe("Add");
  });
});

describe("§222 the tester's rows", () => {
  const row = (over: Record<string, unknown>) => unescape(renderToStaticMarkup(h(WrittenAddForm, { sessionId: "s1", seenAt: seen(), questionKey: K1, question: Q1, slot: `s1:${K1}`, ...over })));

  it("below 5: Add to this answer and the row's own count once there is one", () => {
    expect(row({ made: 0 })).not.toContain("data-additions-left");
    const two = row({ made: 2 });
    expect(two).toContain('data-add-more="written">Add to this answer</button>');
    expect(two).toContain('data-additions-left="">3 of 5 additions left</p>');
  });

  it("at 5: only this row closes, the question's name and the grey note under it, no button", () => {
    const full = row({ made: 5 });
    expect(full).not.toContain("data-add-more");
    expect(full).toContain("data-add-closed");
    expect(full.indexOf(`data-add-question="">${Q1}</span>`)).toBeLessThan(full.indexOf('data-additions-full="">You\'ve added to this answer 5 times, the most it takes.</p>'));
    expect(row({ made: 5, questionKey: ANYTHING_ELSE_KEY, question: "Anything else" })).toContain("You've added to Anything else 5 times, the most it takes.");
  });

  it("a question with no answer yet: Answer this question (no count), whatever was counted", () => {
    const first = row({ made: 0, first: true, questionKey: K2, question: Q2 });
    expect(first).toContain('data-answer-first="">Answer this question</button>');
    expect(first).not.toContain("Add to this answer");
    expect(first).not.toContain("data-additions-left");
    expect(row({ made: 9, first: true })).toContain(">Answer this question</button>");
    const f = src("app/app/sessions/[id]/SessionActions.tsx");
    expect(f).toContain('<FormMistakes text={err} press={sender} named={first ? ANSWER_PRESS : PRESS_VERBS["written-add"]} />');
    expect(f).toContain('label={first ? ANSWER_PRESS : "Add"}');
  });

  // (Owner, Nov 5, §235) The session page's rows moved into each question's fold, and an unanswered question is answered in the form below the answers:
  // tests/written-form-234-235.test.ts.
});

describe("§223 Your written answers: each question and its answer in draggable scroll boxes", () => {
  const LONG = Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of a long answer.`).join("\n");
  const draw = (id: string) => renderToStaticMarkup(h(ResizeBox, { id: "own-answers-list-s1", label: "Your written answers" }, h(SentWork, {
    id, timeZone: "UTC", kind: "written", answers: [item(Q1, LONG), item(Q2, "")], notes: "my notes", files: [],
    additions: [{ at: at1, text: "more on one", files: [], questionKey: K1 }, { at: at1, text: "second answer", files: [], questionKey: K2, first: true }, { at: at1, text: "else add", files: [], questionKey: ANYTHING_ELSE_KEY }],
  })));

  it("each question's text, each answer and each addition is its own box (6rem, the grip), inside the outer panel (OwnPanel: not flat)", () => {
    const page = draw("own-s1");
    for (const p of [`own-s1-q-${K1}-question`, `own-s1-q-${K1}-answer`, `own-s1-q-${K1}-add-0`, `own-s1-q-${K2}-question`, `own-s1-q-${K2}-add-0`, "own-s1-notes", "own-s1-else-0"]) {
      const at = page.indexOf(`data-panel="${p}"`);
      expect(at, p).toBeGreaterThan(-1);
      const box = page.slice(at, page.indexOf("data-panel-grip", at));
      expect(box, p).toContain(`max-height:${QA_BOX_MAX}`);
      expect(box, p).not.toContain("data-panel-flat");
    }
    expect(QA_BOX_MAX).toBe("6rem");
    // The outer panel keeps its own box and grip; every inner box has its grip (8 boxes: 2 questions, 1 answer, 2 additions, the notes, Anything else's addition).
    expect(page.match(/data-panel-grip=""/g)).toHaveLength(8);
    expect(page).toContain("more on one");
  });

  it("one scroll per text: no Show more inside the written answers; the title is cut at 2 lines with no Show more of its own", () => {
    const page = draw("own-s1");
    expect(page).not.toContain("data-fold-text");
    expect(page).not.toContain("data-question-more");
    expect(page).toContain(`class="line-clamp-2 min-w-0 flex-1 basis-40 text-slate-200 [overflow-wrap:anywhere]" data-question-title="">${Q1.replace("?", "?")}</span>`);
    const s = src("components/SentWork.tsx");
    expect(s).toContain("<QuestionText ");
    expect(s).toContain("<AnswerText ");
    expect(s).not.toContain("QuestionTitle");
  });

  it("an unanswered question answered later shows its answer, not \"(no answer)\"; one still unanswered keeps the grey line", () => {
    const page = draw("own-s1");
    const q2 = page.slice(page.indexOf(`data-question-body="${K2}"`), page.indexOf(`data-question-body="${ANYTHING_ELSE_KEY}"`));
    expect(q2).not.toContain("(no answer)");
    expect(q2).toContain("second answer");
    const blank = renderToStaticMarkup(h(SentWork, { kind: "written", answers: [item(Q1, "")], notes: "", additions: [], files: [] }));
    expect(blank).toContain('data-no-answer="">(no answer)</p>');
  });

  it("the developer's views draw the same component (Needs you, the update row, the tester rows, the team's See the work)", () => {
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page.match(/<SentWork /g)).toHaveLength(4); // (§234) and the Past questions box
    expect(src("app/admin/DisputeWork.tsx")).toContain("<SentWork ");
    const dev = draw("row-s1");
    expect(dev).toContain(`data-panel="row-s1-q-${K1}-answer"`);
  });
});

describe("§223 widened: one look for questions and answers everywhere they are shown", () => {
  it("a question: a small label with a Required tag, quiet italic text on a faint background; an answer: its label, bright text, a volt left accent border", async () => {
    const { QuestionText, AnswerText } = await import("@/components/QA");
    const q = renderToStaticMarkup(h(ResizeBox, { id: "outer", label: "x" }, h(QuestionText, { id: "q1", label: "Question 1", required: true }, "What did you like?")));
    expect(q).toMatch(/data-qa-label="">Question 1<span [^>]*data-required-tag="">Required<\/span><\/p>/);
    expect(q).toContain("!bg-white/[0.05]");
    expect(q).toContain('class="whitespace-pre-wrap break-words text-sm font-medium italic text-slate-300 [overflow-wrap:anywhere]" data-qa-text="question">What did you like?</div>');
    expect(q).not.toContain("data-panel-flat"); // in OwnPanel: its own box inside the outer panel
    const a = renderToStaticMarkup(h(AnswerText, { id: "a1" }, "the boats"));
    expect(a).toContain('data-qa-label="">Answer</p>');
    expect(a).toContain("!border-l-2 !border-l-volt-300/60");
    expect(a).toContain('class="break-words text-sm text-slate-100 [overflow-wrap:anywhere]" data-qa-text="answer">the boats</div>');
    expect(renderToStaticMarkup(h(AnswerText, { id: "a2", empty: true }))).toContain('data-no-answer="">(no answer)</p>');
  });

  it("the previous sets (SetView / PrevSetFolds), By question, the new terms' question changes and every SentWork view use it; no scroll stacked around them", async () => {
    const { SetView } = await import("@/components/AnswerSets");
    const set = renderToStaticMarkup(h(SetView, { id: "prev-0-0", items: [item(Q1, "liked it"), { question: Q2, required: true, answer: "" }] }));
    expect(set).toContain('data-panel="prev-0-0-0-question"');
    expect(set).toContain('data-panel="prev-0-0-0-answer"');
    expect(set).toContain('data-qa-label="">Question 2<span');
    expect(set).toContain('data-no-answer="">(no answer)</p>');
    expect(set).not.toContain("data-fold-text");
    expect(src("components/AnswerSets.tsx")).not.toContain("max-h-[24rem]");
    expect(src("app/app/tests/[id]/page.tsx")).toContain("<PrevSetFolds id={`prev-${c.id}`}");
    const bq = src("app/app/tests/[id]/ByQuestion.tsx");
    expect(bq).toContain("<QuestionText id={`bq-${testId}-${key}-question`}");
    expect(bq).toContain("<AnswerText id={`bq-${testId}-${key}-${a.contractId}`}");
    expect(bq).not.toContain("<LongText");
    // A phone (375 px): the tester's name sits above the answer there, beside it from sm up (no fixed 8rem column squeezing the box).
    expect(bq).toContain('className="flex flex-col gap-1.5 py-2.5 text-sm sm:flex-row sm:gap-3"');
    const top = src("app/app/sessions/[id]/TesterTop.tsx");
    expect(top).toContain("<QuestionText id={`offer-${offer.id}-${i}-${key}`}");
    expect(top).toContain("<AnswerText id={`offer-${offer.id}-${i}-${key}`}");
    expect(src("app/admin/DisputeWork.tsx")).toContain("<SentWork ");
  });
});
