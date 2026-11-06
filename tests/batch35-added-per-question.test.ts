import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { GET as keptGET, POST as keptPOST } from "@/app/api/kept/route";
import { SentWork } from "@/components/SentWork";
import { ADD_OPEN, ADD_PRESS, WrittenAddForm } from "@/app/app/sessions/[id]/SessionActions";
import {
  ANYTHING_ELSE_KEY, ANYTHING_ELSE_TITLE, ADD_UNDER_QUESTION, NEW_QUESTION_TAG, QUESTION_GONE, additionsOf, answersByQuestion, questionKey, questionKeys,
  quoteQuestion, writtenThreads,
} from "@/lib/additions";
import { fmtStampIn } from "@/lib/format";
import { SENT_ANSWERS_LOCKED } from "@/lib/rules";
import { joined, sact, seen, settle, setup } from "./fixtures";
import { json, req } from "./helpers";

// (Owner, Nov 3, batch 35 §167) What's added to sent written answers is added to ONE question: the developer reads each question as its own fold (closed at first,
// "· 2 added" on its title) holding the answer and each dated addition; the tester adds with each question's own "Add to this answer". (Owner, Nov 5, §222) The
// part's 10 became 5 per question: tests/batch35-added-per-question-222.test.ts.
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const Q1 = "What did you like?", Q2 = "Where did you get stuck?";
const send = (sessionId: string, cookie: string, answers: string[], notes = "") => sact(sessionId, "written", cookie, { answers, notes, seenAt: seen(), confirmed: true });
const add = (sessionId: string, cookie: string, text: string, question?: string) => sact(sessionId, "written-add", cookie, { text, ...(question ? { question } : {}), seenAt: seen(), confirmed: true });
const written = (sessionId: string) => db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: sessionId, kind: "written" } } });
const events = (testId: string) => db.testEvent.findMany({ where: { testId }, orderBy: { createdAt: "asc" } }).then((e) => e.map((x) => x.text));
const pay = (cookie: string, id: string, amount: string) => reviewPOST(req("/api/review", { cookie, body: { kind: "submission", id, payKey: randomUUID(), amount, tickedCents: Math.round(Number(amount) * 100), seenAt: seen(), confirmed: true } })).then(json);
const item = (question: string, answer: string) => ({ question, required: false, answer });
const at1 = "2026-11-03T23:29:00.000Z", at2 = "2026-11-04T08:05:00.000Z";

describe("the developer's view: a fold per question", () => {
  const additions = [
    { at: at2, text: "second addition", files: [], questionKey: questionKey(Q1) },
    { at: at1, text: "first addition", files: [], questionKey: questionKey(Q1) },
  ].sort((a, b) => a.at.localeCompare(b.at));
  const html = () => renderToStaticMarkup(createElement(SentWork, { id: "needs-s1", timeZone: "UTC", kind: "written", answers: [item(Q1, "the boats"), item(Q2, "level 2")], notes: "", additions, files: [] }));

  it("each question is a fold, closed at first, titled with the question and its count of additions", () => {
    const h = html();
    // (Owner, Nov 4, §188) Two questions, then the fixed "Anything else" fold.
    expect(h.match(/<details /g)).toHaveLength(3);
    expect(h).not.toMatch(/<details[^>]* open/);
    expect(h).toContain(`data-fold="needs-s1-q-${questionKey(Q1)}"`);
    // (Owner, Nov 5, §223) The title is the question cut at 2 lines (no Show more: its whole text is the first box inside).
    expect(h).toMatch(new RegExp(`data-question-title="">${Q1.replace("?", "\\?")}</span>`));
    expect(h).toContain('data-added-count="2">· 2 added</span>');
    // The question with nothing added shows no count.
    expect(h.match(/data-added-count/g)).toHaveLength(1);
    // A link to the part doesn't open its question folds (they stay closed; the count says which changed).
    expect(h).not.toMatch(/data-fold="needs-s1-q-[^"]+" data-jump-open/);
  });

  it("inside, indented one step: the answer, then each addition oldest first, dated in the viewer's zone", () => {
    const h = html();
    const body = h.slice(h.indexOf(`data-question-body="${questionKey(Q1)}"`));
    expect(h).toContain('class="space-y-2 border-l border-white/10 pl-2 sm:pl-3" data-question-body'); // (§187) 8px on a phone
    expect(body.indexOf("the boats")).toBeLessThan(body.indexOf("first addition"));
    expect(body.indexOf("first addition")).toBeLessThan(body.indexOf("second addition"));
    expect(h).toContain(">Added · Nov 3, 2026, 11:29 PM</p>");
    expect(h).toContain(">Added · Nov 4, 2026, 8:05 AM</p>");
    // In another zone, the same addition reads in that zone.
    const ny = renderToStaticMarkup(createElement(SentWork, { timeZone: "America/New_York", kind: "written", answers: [item(Q1, "a")], notes: "", additions: [additions[0]], files: [] }));
    expect(ny).toContain(">Added · Nov 3, 2026, 6:29 PM</p>"); // (EST: summer time ended Nov 1)
    expect(fmtStampIn(at1, "UTC")).toBe("Nov 3, 2026, 11:29 PM");
  });

  it("(§188, was §167's last fold) additions made before §167 (no question) go under Anything else, with their dates, after the notes", () => {
    const h = renderToStaticMarkup(createElement(SentWork, {
      id: "x", timeZone: "UTC", kind: "written", answers: [item(Q1, "a"), item(Q2, "b")], notes: "my notes",
      additions: [{ at: at1, text: "old general addition", files: [] }, { at: at2, text: "about Q2", files: [], questionKey: questionKey(Q2) }], files: [],
    }));
    expect(h.match(/<details /g)).toHaveLength(3);
    expect(h.lastIndexOf("<details")).toBe(h.indexOf(`<details class="group/fold rounded-lg border border-white/10 px-2 py-1.5" data-fold="x-q-${ANYTHING_ELSE_KEY}"`));
    expect(h).toContain(`data-else-title="">${ANYTHING_ELSE_TITLE}</span>`);
    expect(h).not.toContain("not about one question");
    const general = h.slice(h.indexOf(`data-question-body="${ANYTHING_ELSE_KEY}"`));
    expect(general).toContain(">Added · Nov 3, 2026, 11:29 PM</p>");
    expect(general).toContain("old general addition");
    expect(general).not.toContain("about Q2");
    // The notes are Anything else's original: after the questions, before its additions.
    expect(h.indexOf("my notes")).toBeGreaterThan(h.indexOf("about Q2"));
    expect(general.indexOf("my notes")).toBeLessThan(general.indexOf("old general addition"));
  });

  it("changed questions: a new question gets its own fold (§283: no tag); an unchanged one whose answer changed gets it as an addition", () => {
    const Q3 = "What would you change?";
    const t = writtenThreads([item(Q1, "liked"), item(Q2, "stuck")], [], [
      { at: at1, items: [item(Q1, "liked"), item(Q3, "the map")], notes: "", files: [] },
      { at: at2, text: "and the colours", files: [], questionKey: questionKey(Q3) },
    ]);
    expect(t.threads.map((x) => [x.question, x.fresh, x.answer, x.adds.map((a) => a.text)])).toEqual([[Q1, false, "liked", []], [Q2, false, "stuck", []], [Q3, true, "the map", ["and the colours"]]]);
    const changed = writtenThreads([item(Q1, "liked")], [], [{ at: at1, items: [item(Q1, "liked more now")], notes: "", files: [] }]);
    expect(changed.threads[0].adds).toEqual([{ at: at1, text: "liked more now", files: [] }]);
    const h = renderToStaticMarkup(createElement(SentWork, { timeZone: "UTC", kind: "written", answers: [item(Q1, "liked")], notes: "", additions: [{ at: at1, items: [item(Q1, "liked"), item(Q3, "the map")], notes: "", files: [] }], files: [] }));
    // (Owner, Nov 6, §283) No "new question" tag in the answer lists any more (it is on an unanswered question in the tester's form).
    expect(h).toContain(`>${Q3}</span>`);
    expect(h).not.toContain(`>${NEW_QUESTION_TAG}<`);
  });

  it("files placed in an addition still show in place; recordings keep their list with the date next to each Added", () => {
    const files = [{ id: "f1aaaa", filename: "first.mp4", contentType: "video/mp4", sizeBytes: 10, part: "recording" }, { id: "f2bbbb", filename: "map.png", contentType: "image/png", sizeBytes: 10, part: "written" }];
    const w = renderToStaticMarkup(createElement(SentWork, { timeZone: "UTC", kind: "written", answers: [item(Q1, "a")], notes: "", additions: [{ at: at1, text: "see [[attachment:f2bbbb|map.png]]", files: ["f2bbbb"], questionKey: questionKey(Q1) }], files }));
    expect(w).toContain('alt="map.png"');
    expect(w).not.toContain("data-attachments"); // placed inline, not listed again
    const r = renderToStaticMarkup(createElement(SentWork, { timeZone: "UTC", kind: "recording", answers: [], notes: "", additions: [{ at: at1, files: ["f1aaaa"] }], files }));
    expect(r).not.toContain("<details");
    expect(r).toContain(">Added · Nov 3, 2026, 11:29 PM</p>");
    // The tester's own recordings list too.
    expect(src("app/app/sessions/[id]/RecordingUpload.tsx")).toContain("addedLabel(on)");
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("addedOn: fmtStampIn(recAdds[i].at, u.timeZone)");
  });

  it("every place the developer reads a written part passes its fold ids and zone; By question puts an addition under its question", () => {
    const page = src("app/app/tests/[id]/page.tsx");
    // (Owner, Nov 5, §263, final; was §234's part) The current questions (Needs you also a new answer to an old one, tagged Old).
    for (const id of ["needs-${x.s!.id}", "update-${x.id}", "row-${r.sub.id}"]) expect(page).toMatch(new RegExp(`<SentWork id=\\{\`${id.replace(/[$!{}.]/g, (m) => `\\${m}`)}\`\\}(?: earlier=\\{[^}]+\\})? timeZone=\\{u\\.timeZone\\}`));
    expect(src("app/admin/DisputeWork.tsx")).toContain("timeZone={work.timeZone}");
    expect(src("lib/server/adminLists.ts")).toContain("timeZone: dateZone(), subId: s.id");
    const b = answersByQuestion({ answers: [item(Q1, "a"), item(Q2, "b")], notes: "n", additions: [{ at: at1, text: "more on Q2", files: [], questionKey: questionKey(Q2) }, { at: at2, text: "general", files: [] }] }, [], (at) => fmtStampIn(at, "UTC"));
    expect(b.answers).toEqual(["a", "b\n\n*Added · Nov 3, 2026, 11:29 PM*\nmore on Q2"]);
    // (Owner, Nov 4, §188) Anything else is By question's last entry; what was added there is dated like a question's.
    expect(b.notes).toBe("n\n\n*Added · Nov 4, 2026, 8:05 AM*\ngeneral");
  });
});

describe("the tester adds under one question", () => {
  it("Add to this answer stores the question's key; the live line, bell, email and own line name the question", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await send(j.sessionId, j.tester.cookie, ["the boats", "level 2"])).status).toBe(200);
    const [k1, k2] = questionKeys([{ question: Q1 }, { question: Q2 }]);
    const r = await add(j.sessionId, j.tester.cookie, "and the harbour at night", k2);
    expect(r.status).toBe(200);
    const adds = additionsOf((await written(j.sessionId)).additions);
    expect(adds).toEqual([expect.objectContaining({ text: "and the harbour at night", questionKey: k2 })]);
    expect(k1).not.toBe(k2);
    expect((await events(testId)).at(-1)).toBe(`Ana Silva added to her answer to “${Q2}”`);
    const bell = await db.notification.findFirst({ where: { userId: dev.user.id }, orderBy: { createdAt: "desc" } });
    expect(bell?.text).toContain(`Ana Silva added to her answer to “${Q2}” for “Harbor Run”`);
    // The tester's "Work sent" alert names it too (its body: "What you added to your answer to “…” was sent to Nora Lane.").
    expect(src("lib/server/tests.ts")).toContain("[added ? `What you added ${part === \"recording\" ? `to your ${part}` : addedToWhat(\"your\", question)} was sent to ${dev}.`");
    const log = await db.actionLog.findFirst({ where: { userId: j.tester.user.id }, orderBy: { createdAt: "desc" } });
    expect(log?.text).toContain(`added to your answer to “${Q2}”`);
    // After a Pay, the update row's live line names it too.
    expect((await pay(dev.cookie, (await written(j.sessionId)).id, "10.00")).status).toBe(200);
    await settle();
    expect((await add(j.sessionId, j.tester.cookie, "one more on the first", k1)).status).toBe(200);
    expect((await events(testId)).at(-1)).toBe(`Ana Silva added to her answer to “${Q1}” after you paid`);
    // A long question is cut in the lines.
    expect(quoteQuestion("x".repeat(200))).toBe(`“${"x".repeat(79)}…”`);
  });

  it("an older page's general Add more (no question) is refused with a line telling her to add under a question; a question no longer asked too", async () => {
    const { testId } = await setup();
    const j = await joined(testId);
    await send(j.sessionId, j.tester.cookie, ["a", "b"]);
    const r = await add(j.sessionId, j.tester.cookie, "general more");
    expect(r.status).toBe(409);
    expect(r.body.error.message).toBe(ADD_UNDER_QUESTION);
    expect((await add(j.sessionId, j.tester.cookie, "more", questionKey("Not one of the questions"))).body.error.message).toBe(QUESTION_GONE);
    expect(additionsOf((await written(j.sessionId)).additions)).toHaveLength(0);
    // The locked-send line points at the new box.
    expect(SENT_ANSWERS_LOCKED).toContain("Add to this answer");
  });

  it("drafts are kept per question (add:<session>:<questionKey>)", async () => {
    const { testId } = await setup();
    const j = await joined(testId);
    const key = `add:${j.sessionId}:${questionKey(Q1)}`;
    const kept = await json(await keptPOST(req("/api/kept", { cookie: j.tester.cookie, headers: { "x-uid": j.tester.user.id }, body: { key, data: { text: "half typed" } } })));
    expect(kept.status).toBe(200);
    const back = await json(await keptGET(req(`/api/kept?key=${encodeURIComponent(key)}`, { cookie: j.tester.cookie, headers: { "x-uid": j.tester.user.id } })));
    expect(back.body.data).toMatchObject({ text: "half typed" });
    const other = await json(await keptGET(req(`/api/kept?key=${encodeURIComponent(`add:${j.sessionId}:${questionKey(Q2)}`)}`, { cookie: j.tester.cookie, headers: { "x-uid": j.tester.user.id } })));
    expect(other.body.data).toBeNull();
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).toContain("useKept(`add:${sessionId}:${questionKey}`");
  });

  it("the tester's page: each current question's fold gets its own box, with the same editor, limits and rules", () => {
    const page = src("app/app/sessions/[id]/page.tsx");
    // (Owner, Nov 5, §235) In the question's own fold, under its answer and additions.
    expect(page).toContain("addTo={canAdd ? ({ key, question }) => addUnder(key, question) : undefined}");
    expect(page).toContain("return <WrittenAddForm key={key}");
    expect(page).not.toMatch(/<WrittenAddForm sessionId=\{c\.id\} seenAt=\{seenAt\} canSend=\{!rulesPaused\} lines=\{sendLines\(written, c\.writtenCents\)\}\s+used=/);
    const h = renderToStaticMarkup(createElement(WrittenAddForm, { sessionId: "s1", seenAt: seen(), questionKey: "qabc", question: Q1, made: 3 }));
    expect(h).toContain(`data-add-more="written">${ADD_OPEN}</button>`);
    expect(ADD_PRESS).toBe("Add to my answer");
    const actions = src("app/app/sessions/[id]/SessionActions.tsx");
    expect(actions).toContain("api(`/api/sessions/${sessionId}/written-add`, { text, question: questionKey, seenAt, confirmed: !!boxAt, boxAt, ...(first ? { first: true } : {}) })");
    // The same box as before: the editor with Bold, Italic, Code block and 📎, the 20,000 count (§186: the addition's own), the paused draft line.
    const form = actions.slice(actions.indexOf("export function WrittenAddForm"), actions.indexOf("export function LeaveButton"));
    // (Owner, Nov 4, §189) The count is the editor's own (AnswerBox `alone` carries data-written-count); the form draws no second one.
    for (const s of ["<AnswerBox ", " alone value={text}", "What you add is kept as a draft. Adding comes back when the test resumes.", "<ChangesBox side=\"tester\""]) expect(form).toContain(s);
    expect(form).not.toContain("data-written-count");
    expect(actions).toContain('{...(alone ? { "data-written-count": "" } : {})} />');
  });
});

// (Owner, Nov 5, §222) "At most 10 additions per part" (its 11th refused, the race at the 10th, the part's remaining count and the one note under the panel) was
// replaced by 5 per question: tests/batch35-added-per-question-222.test.ts.
