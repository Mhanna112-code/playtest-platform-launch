import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ANSWER_LINES, FOLD_TEXT_OPEN, LongText, QUESTION_LINES, foldGuess } from "@/components/LongText";
import { FoldText } from "@/components/FieldNote";
import { SentWork } from "@/components/SentWork";
import { SetView } from "@/components/AnswerSets";
import { ByQuestion, questionKey as bqKey } from "@/app/app/tests/[id]/ByQuestion";
import { WrittenAddForm, ADD_OPEN } from "@/app/app/sessions/[id]/SessionActions";
import { RecordingUpload } from "@/app/app/sessions/[id]/RecordingUpload";
import { LIST_PANEL } from "@/components/ScrollList";
import { OPEN_FOLD_TEXT } from "@/lib/markJump";
import { questionKey } from "@/lib/additions";

// (Owner, Nov 4, batch 35 §182) The tester's session page: "Your recording" and "Your written answers" are folds with their lists in the panel; the Add to this
// answer buttons sit below the answers' panel and open their box in it, under the question's latest part. Long text, both sides: ONE fold (LongText).
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const LONG = Array.from({ length: 6 }, (_, i) => `Line ${i + 1} of a long answer.`).join("\n");
const item = (question: string, answer: string) => ({ question, answer, required: false });

describe("the shared long-text fold", () => {
  it("short text shows whole, with no button; long text shows its first lines and ends with Show more", () => {
    const short = html(createElement(LongText, { text: "Nowhere." }));
    expect(short).toContain('data-fold-text="short"');
    expect(short).not.toContain("<button");
    const long = html(createElement(LongText, { text: LONG }));
    expect(long).toContain('data-fold-text="closed"');
    expect(long).toContain('data-fold-lines="3"');
    expect(long).toContain("line-clamp-3");
    expect(long).toMatch(/aria-expanded="false" data-fold-toggle="">Show more<\/button>/);
    // The whole text is in the page (selectable, copyable): only cut by CSS.
    expect(long).toContain("Line 6 of a long answer.");
  });

  it("a question folds at 2 lines, an answer or an addition at 3; open, a scroll box about 8 lines tall in the draggable panel", () => {
    expect(QUESTION_LINES).toBe(2);
    expect(ANSWER_LINES).toBe(3);
    expect(html(createElement(LongText, { text: LONG, lines: QUESTION_LINES }))).toContain("line-clamp-2");
    expect(FOLD_TEXT_OPEN).toBe("calc(8lh + 1.5rem)");
    const f = src("components/LongText.tsx");
    expect(f).toContain("<ResizeBox id={panelId} label={label} defaultMax={FOLD_TEXT_OPEN}>{body}</ResizeBox>");
    expect(f).toContain('{open ? "Show less" : "Show more"}');
  });

  it("clearly short or long from the text; anything else (and attachment markers) is measured on the page", () => {
    expect(foldGuess("Nowhere.", 3)).toBe(false);
    expect(foldGuess("a\nb\nc\nd", 3)).toBe(true);
    expect(foldGuess("a\nb\nc", 2)).toBe(true);
    expect(foldGuess("x".repeat(700), 3)).toBe(true);
    expect(foldGuess("x".repeat(120), 3)).toBeNull();
    expect(foldGuess("see [📎 map.png #k3f9]", 3)).toBeNull();
    expect(foldGuess(undefined, 3)).toBeNull();
    const f = src("components/LongText.tsx");
    expect(f).toContain("setLong(el.scrollHeight > el.clientHeight + 1)");
    expect(f).toContain('el.addEventListener("load", check, true)');
  });

  it("(§237) FieldNote's long value is the shared draggable box (QA's ValueText), no Show more", () => {
    const h = html(createElement(FoldText, { text: "x".repeat(20_000) }));
    expect(h).toContain('data-qa-text="value"');
    expect(h).toContain("data-panel-grip");
    expect(h).not.toContain("Show more");
    expect(src("components/FieldNote.tsx")).toContain("return <ValueText id={textId(\"note\", `${label}|${text}`)} label={label}>{text}</ValueText>;");
  });

  it("a jump to something inside a folded text opens it first", () => {
    const jump = src("lib/markJump.ts");
    expect(jump).toContain('if (p.dataset?.foldText === "closed") { p.dispatchEvent(new Event(OPEN_FOLD_TEXT)); folded = true; }');
    expect(OPEN_FOLD_TEXT).toBe("fold-text:open");
    expect(src("components/LongText.tsx")).toContain("el.addEventListener(OPEN_FOLD_TEXT, openNow)");
  });
});

describe("every place a tester's question, answer or addition shows uses it", () => {
  const Q1 = "What did you like?";
  const at = "2026-11-03T23:29:00.000Z";

  it("SentWork (Needs you's parts, the update row, the tester rows, the team's See the work, the tester's own page): (Owner, Nov 5, §223) the answer, the addition and the notes each in their own box", () => {
    const h = html(createElement(SentWork, { id: "row-s1", timeZone: "UTC", kind: "written", answers: [item(Q1, LONG)], notes: LONG, additions: [{ at, text: LONG, files: [], questionKey: questionKey(Q1) }], files: [] }));
    const body = h.slice(h.indexOf(`data-question-body="${questionKey(Q1)}"`));
    expect(body.match(/data-qa="answer"/g)?.length).toBe(3); // the answer, the addition, the notes
    expect(body).not.toContain("data-fold-text");
    expect(body).toContain('data-set-answer=""><div class="min-w-0 space-y-1" data-qa="answer">');
    expect(body.indexOf(">Added · Nov 3, 2026, 11:29 PM</p>")).toBeLessThan(body.lastIndexOf('data-qa="answer"'));
  });

  it("a long question: the title shows its first 2 lines; inside, Show more opens the whole question (the first lines aren't shown twice)", () => {
    const q = "Tell us everything about the harbour level, from the dock to the lighthouse, and what you would change first before release?";
    const h = html(createElement(SentWork, { id: "row-s1", timeZone: "UTC", kind: "written", answers: [item(q, "fine")], notes: "", additions: [], files: [] }));
    // (Owner, Nov 5, §223; was §187's title with its own Show more) The title is cut at 2 lines (CSS, no button); the whole question is the first box inside.
    expect(h).toContain(`class="line-clamp-2 min-w-0 flex-1 basis-40 text-slate-200 [overflow-wrap:anywhere]" data-question-title="">${q}</span>`);
    expect(h).not.toContain("data-question-more");
    expect(h).toContain('data-set-question=""><div class="min-w-0 space-y-1" data-qa="question">');
    expect(src("components/SentWork.tsx")).not.toContain("<ScrollText");
  });

  it("the previous sets (SetView), By question and the tester's answer form", () => {
    // (Owner, Nov 5, §223) The previous sets and By question: the one look (each question and answer in its own box), no Show more.
    const set = html(createElement(SetView, { items: [item(Q1, LONG)] }));
    expect(set).toContain('data-qa="question"');
    expect(set).toContain('data-set-answer=""><div class="min-w-0 space-y-1" data-qa="answer">');
    const bq = html(createElement(ByQuestion, { testId: "t1", blocks: [{ title: Q1, required: false, answers: [{ contractId: "c1", tester: "Ana Silva", text: LONG, sentAt: new Date(at), status: "waiting" as const, paidCents: 0 }] }] }));
    expect(bq).toContain('data-qa="answer"');
    expect(bq).toContain(`data-question-title="">${Q1}</span>`);
    // (Owner, Nov 5, §259) no visible label over a question; "Question 1" is for screen readers only.
    expect(bq).toContain('<span class="sr-only">Question 1</span>');
    expect(bq).not.toContain('data-qa-label="">Question');
    expect(bqKey(Q1)).toBe(bqKey(Q1));
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).toContain("<LongText inline text={qText(q)} lines={QUESTION_LINES} label={`Question ${i + 1}`} />"); // (§187) Show more beside the question
  });
});

describe("the tester's session page (§182)", () => {
  const page = () => src("app/app/sessions/[id]/page.tsx");

  it("Your written answers: a fold; every question in ONE panel; (Owner, Nov 5, §235) Add to this answer inside each question's fold, no rows below the panel", () => {
    const p = page();
    const fold = p.indexOf("<Fold id={`own-answers-${written.id}`}");
    const panel = p.indexOf("<ResizeBox id={`own-answers-list-${written.id}`} label=\"Your written answers\" defaultMax={LIST_PANEL.ownAnswers}>", fold);
    const sent = p.indexOf("<SentWork id={`own-${written.id}`}", panel);
    expect(fold).toBeGreaterThan(0);
    expect(panel).toBeGreaterThan(fold);
    expect(sent).toBeGreaterThan(panel);
    expect(p).not.toContain("data-add-buttons");
    // Each answered current question's fold (and Anything else's) ends with its Add to this answer, drawn in place.
    expect(p).toContain("addTo={canAdd ? ({ key, question }) => addUnder(key, question) : undefined}");
    expect(LIST_PANEL.ownAnswers).toBe("min(28rem, 60vh)");
  });

  it("pressed, the box is drawn in its slot (the question's fold opened, brought into view); the box folds and scrolls inside; drafts, the question's 5 (§222) and refusals unchanged", () => {
    const f = src("app/app/sessions/[id]/SessionActions.tsx");
    expect(f).toContain("return slotEl ? createPortal(boxNode, slotEl) : boxNode;");
    expect(f).toContain("document.querySelector<HTMLElement>(`[data-add-slot=\"${CSS.escape(slot)}\"]`)");
    expect(f).toContain("for (let p = el.parentElement; p; p = p.parentElement) if (p instanceof HTMLDetailsElement && !p.open) p.open = true;");
    expect(f).toContain('<details open className="group/fold" data-add-fold="">');
    expect(f).toContain('data-add-scroll=""');
    expect(f).toContain("useKept(`add:${sessionId}:${questionKey}`");
    expect(f).toContain("<FormMistakes text={err} press={sender} named={first ? ANSWER_PRESS : PRESS_VERBS[\"written-add\"]} />"); // (§222) Add, or Answer this question
    // Below the panel the button names its question (its first line).
    const closed = html(createElement(WrittenAddForm, { sessionId: "s1", seenAt: "2026-11-04T00:00:00.000Z", questionKey: "qabc", question: "Where did you get stuck?", made: 2, slot: "s1:qabc" }));
    expect(closed).toContain(`data-add-more="written">${ADD_OPEN}</button>`);
    expect(closed).toContain('data-add-question="">Where did you get stuck?</span>');
    const full = html(createElement(WrittenAddForm, { sessionId: "s1", seenAt: "2026-11-04T00:00:00.000Z", questionKey: "qabc", question: "Q", made: 5, slot: "s1:qabc" }));
    expect(full).toContain("data-additions-full"); // (Owner, Nov 5, §222) its own row's note, under the question's name
    expect(full).not.toContain("data-add-more");
  });

  it("Your recording: a fold (open at first) whose list sits in the list panel; the upload tools and Send stay under it", () => {
    const recs = [1, 2].map((i) => ({ id: `r${i}`, filename: `run-${i}.mp4`, size: 1000, uploaded: true, sent: true, group: 0 }));
    const h = html(createElement(RecordingUpload, { sessionId: "s1", recordings: recs, canSend: true, sentBefore: true, seenAt: "2026-11-04T00:00:00.000Z" }));
    expect(h).toMatch(/<details open="" class="group\/fold [^"]*" data-fold="own-recordings-s1" data-jump-open="">/);
    expect(h).toContain('data-own-recordings-title="">Your recordings (2)</span>');
    expect(h).toContain('data-panel="own-recordings-list-s1"');
    expect(h.indexOf('data-recording-row="r2"')).toBeLessThan(h.indexOf("</details>"));
    expect(h.indexOf('data-recording-count=""')).toBeGreaterThan(h.indexOf("</details>"));
    const one = html(createElement(RecordingUpload, { sessionId: "s1", recordings: recs.slice(0, 1), canSend: true, sentBefore: true, seenAt: "2026-11-04T00:00:00.000Z" }));
    expect(one).toContain('data-own-recordings-title="">Your recording</span>');
    expect(html(createElement(RecordingUpload, { sessionId: "s1", recordings: [], canSend: true, sentBefore: false, seenAt: "2026-11-04T00:00:00.000Z" }))).not.toContain("own-recordings");
    expect(LIST_PANEL.ownRecordings).toBe("min(24rem, 60vh)");
  });
});
