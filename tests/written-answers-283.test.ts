import { readFileSync } from "node:fs";
import path from "node:path";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { SentWork } from "@/components/SentWork";
import { prevSetsOf, snapshotOnlyFiles } from "@/lib/answerSets";
import { attachmentMarker } from "@/lib/answerAttachments";
import { questionKeys } from "@/lib/additions";
import { syncEndedQuestions } from "@/lib/server/terms";
import { FILTER_EVENT, clearTesterFilter } from "@/app/app/tests/[id]/TesterFilter";
import { onCircleChosen, searchTyped } from "@/app/app/tests/[id]/TesterSearch";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 6, §283) Written answers: only current, answered questions in every list (an unanswered one is only a box in the tester's form, tagged "new
// question" when it came after their sends); every contract on the test follows a questions Save (left and ended too, each change a Terms history entry), and
// an ended one no Save reached is brought in line on read; the avatars and "Search testers" clear each other; Anything else counts a send only with notes or
// loose files; the Testers list's Terms history at the bottom of the tester's drop-down.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tests/t", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const Q1 = "What did you like?", Q2 = "Where did you get stuck?", Q3 = "What would you change?", Q4 = "Which device did you use?";
const item = (question: string, answer: string) => ({ question, required: false, answer });
const send = (sessionId: string, cookie: string, body: Record<string, unknown>) => sact(sessionId, "written", cookie, { notes: "", seenAt: seen(), confirmed: true, ...body });
const written = (sessionId: string) => db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: sessionId, kind: "written" } } });
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
const testPage = async (testId: string, userId: string) => {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const { default: TestPage } = await import("@/app/app/tests/[id]/page");
  return unescape(renderToStaticMarkup(await TestPage({ params: Promise.resolve({ id: testId }), searchParams: Promise.resolve({}) })));
};
const titles = (html: string) => [...html.matchAll(/data-question-title=""[^>]*>([^<]*)</g)].map((m) => m[1]);
const ownList = (html: string) => { const at = html.indexOf('data-sent-answers=""'); return html.slice(at, html.indexOf("data-answer-form=", at) < 0 ? undefined : html.indexOf("data-answer-form=", at)); };

describe("§283 2: only answered questions are listed; an unanswered one is only a box in the form", () => {
  it("the tester's Your written answers, the Testers list and Needs you list Q1 (answered) and never Q2 (left blank); Q2 is a box in the form", async () => {
    const { dev, testId } = await setup({ questions: [Q1, Q2] });
    const j = await joined(testId);
    expect((await send(j.sessionId, j.tester.cookie, { answers: ["the boats", ""] })).status).toBe(200);
    const sub = await written(j.sessionId);
    const mine = await sessionPage(j.sessionId, j.tester.user.id);
    const list = ownList(mine);
    expect(titles(list)).toEqual([Q1, "Anything else"]);
    const form = mine.slice(mine.indexOf('data-answer-form="open"'));
    expect(form).toContain("Questions you haven't answered yet");
    expect(form).toContain(Q2);
    expect(form).not.toContain("data-new-question"); // Q2 was there when they sent: not new
    const theirs = await testPage(testId, dev.user.id);
    // (§289) Needs you's Questions has no scroll panel now: Needs you's list is found by data-questions-plain, the Testers list's by its scroll panel.
    for (const [where, mark] of [[`needs-${sub.id}`, "data-questions-plain"], [`row-${sub.id}`, "data-panel"]]) {
      const at = theirs.indexOf(`${mark}="${where}-questions-list"`);
      expect(at, where).toBeGreaterThan(0);
      const panel = theirs.slice(at, theirs.indexOf('data-question-body="else"', at));
      expect(panel, where).toContain(Q1);
      expect(panel, where).not.toContain(Q2);
    }
    expect(theirs).toContain('data-questions-count="1">Questions (1)<');
  });

  it("SentWork: a blank answer with an addition is listed (answered by the addition); a blank one with nothing is not", () => {
    const base = { id: "s", kind: "written", answers: [item(Q1, ""), item(Q2, "")], questions: [Q1, Q2], notes: "", files: [] };
    expect(titles(renderToStaticMarkup(h(SentWork, { ...base, additions: [] })))).toEqual(["Anything else"]);
    const withAdd = renderToStaticMarkup(h(SentWork, { ...base, additions: [{ at: "2026-11-06T07:00:00.000Z", text: "the answer, added", files: [], questionKey: questionKeys([{ question: Q2 }])[0] }] }));
    expect(titles(withAdd)).toEqual([Q2, "Anything else"]);
  });
});

describe("§283 1: the new question tag", () => {
  it("only in the tester's form, beside an unanswered question that came after their sends; never in a list, never the developer's", async () => {
    const { dev, testId } = await setup({ questions: [Q1, Q2] });
    const j = await joined(testId);
    expect((await send(j.sessionId, j.tester.cookie, { answers: ["the boats", "the gate"] })).status).toBe(200);
    expect((await edit(testId, dev.cookie, { questions: [Q1, Q2, Q3] })).status).toBe(200);
    const mine = await sessionPage(j.sessionId, j.tester.user.id);
    expect(ownList(mine)).not.toContain("data-new-question");
    const form = mine.slice(mine.indexOf('data-answer-form="open"'));
    const at = form.indexOf(Q3);
    expect(at).toBeGreaterThan(0);
    expect(form.slice(at, at + 600)).toContain('data-new-question="">new question</span>');
    expect(await testPage(testId, dev.user.id)).not.toContain("data-new-question");
    // Answered: no tag anywhere.
    expect((await send(j.sessionId, j.tester.cookie, { answers: ["the map"] })).status).toBe(200);
    expect(await sessionPage(j.sessionId, j.tester.user.id)).not.toContain("data-new-question");
  });
});

describe("§283 3: every contract follows the listing's questions", () => {
  it("a Save writes them into a left or ended contract too, with the same Terms history entry; only the working tester is told", async () => {
    const { dev, testId } = await setup({ questions: [Q1, Q2] });
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Nina Park");
    for (const x of [a, b]) expect((await send(x.sessionId, x.tester.cookie, { answers: ["the boats", "the gate"] })).status).toBe(200);
    await db.contract.update({ where: { id: b.sessionId }, data: { status: "ended", endKind: "ended", endedAt: new Date() } });
    expect((await edit(testId, dev.cookie, { questions: [Q1, Q3] })).status).toBe(200);
    for (const x of [a, b]) {
      const c = await db.contract.findUniqueOrThrow({ where: { id: x.sessionId } });
      expect(c.questions).toEqual([Q1, Q3]);
      const [set] = prevSetsOf(c.prevSets);
      expect(set.items.map((i) => [i.question, i.answer])).toEqual([[Q1, "the boats"], [Q2, "the gate"]]);
      expect(set.to).toEqual([Q1, Q3]);
    }
    expect(await db.notification.count({ where: { userId: b.tester.user.id, text: { contains: "updated the listing: questions" } } })).toBe(0);
    expect(await db.notification.count({ where: { userId: a.tester.user.id, text: { contains: "updated the listing: questions" } } })).toBe(1);
    // The Testers list: the ended tester's old Q2 is in their Terms history, not in the list.
    const theirs = await testPage(testId, dev.user.id);
    const subB = await written(b.sessionId);
    const row = theirs.slice(theirs.indexOf(`data-panel="row-${subB.id}-questions-list"`));
    expect(row.slice(0, row.indexOf('data-question-body="else"'))).not.toContain(Q2);
    expect(theirs.slice(theirs.indexOf(`data-dev-terms-history="${b.sessionId}"`))).toContain("the gate");
  });

  it("existing data: an ended contract no Save reached is brought in line when the page is read (Terms history keeps the old answers); nothing else changes", async () => {
    const { dev, testId } = await setup({ questions: [Q1, Q2] });
    const b = await joined(testId, "Nina Park");
    expect((await send(b.sessionId, b.tester.cookie, { answers: ["the boats", "the gate"] })).status).toBe(200);
    // As before §283: the listing changed while only working contracts followed.
    await db.contract.update({ where: { id: b.sessionId }, data: { status: "ended", endKind: "ended", endedAt: new Date() } });
    await db.test.update({ where: { id: testId }, data: { questions: [Q1, Q3, Q4] } });
    expect(await syncEndedQuestions(testId, [Q1, Q3, Q4])).toEqual([b.sessionId]);
    expect(await syncEndedQuestions(testId, [Q1, Q3, Q4])).toEqual([]); // in line: nothing to do
    const c = await db.contract.findUniqueOrThrow({ where: { id: b.sessionId } });
    expect(c.questions).toEqual([Q1, Q3, Q4]);
    expect(prevSetsOf(c.prevSets)[0].items.map((i) => i.answer)).toEqual(["the boats", "the gate"]);
    // On read: the pages call it (the developer's test page, the tester's session page).
    await db.contract.update({ where: { id: b.sessionId }, data: { questions: [Q1, Q2] } });
    await testPage(testId, dev.user.id);
    expect((await db.contract.findUniqueOrThrow({ where: { id: b.sessionId } })).questions).toEqual([Q1, Q3, Q4]);
    expect(src("app/app/sessions/[id]/page.tsx")).toContain('(await import("@/lib/server/terms")).syncEndedQuestions(head.testId, lt.questions)');
  });

  it("a tester who comes back is on the listing's questions, the old ones in Terms history", async () => {
    const { testId } = await setup({ questions: [Q1, Q2] });
    const b = await joined(testId, "Nina Park");
    expect((await send(b.sessionId, b.tester.cookie, { answers: ["the boats", "the gate"] })).status).toBe(200);
    await db.contract.update({ where: { id: b.sessionId }, data: { status: "left", endKind: "left", endedAt: new Date() } });
    await db.test.update({ where: { id: testId }, data: { questions: [Q1, Q3] } });
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    // (§352) Back by an invite (a request body can't say the rejoin was accepted any more).
    await db.invite.create({ data: { testId, testerId: b.tester.user.id } });
    const r = await act(testId, "join", b.tester.cookie, { listingVersion: t.listingVersion });
    expect(r.status).toBe(200);
    const c = await db.contract.findUniqueOrThrow({ where: { id: b.sessionId } });
    expect(c.status).toBe("working");
    expect(c.questions).toEqual([Q1, Q3]);
    expect(prevSetsOf(c.prevSets).at(-1)!.items.map((i) => [i.question, i.answer])).toEqual([[Q1, "the boats"], [Q2, "the gate"]]);
  });
});

describe("§283 4: the avatars and Search testers clear each other", () => {
  const events: { type: string; detail: unknown }[] = [];
  function fakeWindow() {
    const m = new Map<string, string>();
    const listeners = new Map<string, ((e: Event) => void)[]>();
    (globalThis as unknown as { window: unknown }).window = {
      sessionStorage: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) },
      addEventListener: (t: string, f: (e: Event) => void) => listeners.set(t, [...(listeners.get(t) ?? []), f]),
      removeEventListener: () => {},
      dispatchEvent: (e: CustomEvent) => { events.push({ type: e.type, detail: e.detail }); (listeners.get(e.type) ?? []).forEach((f) => f(e)); return true; },
    };
    return m;
  }
  afterEach(() => { delete (globalThis as unknown as { window?: unknown }).window; events.length = 0; });

  it("typing a name clears the circle chosen; choosing a circle clears what's typed", () => {
    const store = fakeWindow();
    store.set("tester-filter", "t1");
    searchTyped("an");
    expect(store.has("tester-filter")).toBe(false);
    expect(events).toContainEqual({ type: FILTER_EVENT, detail: "" });
    expect(events).toContainEqual({ type: "tester-search", detail: "an" });
    events.length = 0;
    onCircleChosen("t2");
    expect(events).toEqual([{ type: "tester-search", detail: "" }]);
    // Clearing the box, or "All testers", clears nothing else.
    events.length = 0;
    searchTyped("");
    onCircleChosen("");
    expect(events).toEqual([{ type: "tester-search", detail: "" }]);
    clearTesterFilter();
    expect(events).toHaveLength(1);
    expect(src("app/app/tests/[id]/TesterSearch.tsx")).toContain("<SearchTestersBox value={typed} onChange={searchTyped} where=\"testers\" />");
    // Needs you has no circles: its box filters only its own people.
    expect(src("app/app/tests/[id]/NeedsYou.tsx")).not.toContain("useTesterFilter");
  });
});

describe("§283 5: Anything else counts a send only with notes or loose files", () => {
  it("the owner's case: a 9-answer send at 07:01:10Z, notes \"\", its one file a video placed in an answer by its marker: no \"1 added\", no empty Added entry", () => {
    const fileId = "cmw4m75r2005d7kkoyne6avpz";
    const qs = Array.from({ length: 9 }, (_, i) => `Question number ${i + 1}?`);
    const marker = attachmentMarker(fileId, "clip.mp4");
    const items = qs.map((q, i) => item(q, i === 3 ? `see the clip ${marker}` : `answer ${i + 1}`));
    const files = [{ id: fileId, filename: "clip.mp4", contentType: "video/mp4", sizeBytes: 1000, part: "written", uploadedAt: "2026-11-06T07:01:00.000Z" }];
    const props = { id: "bb", kind: "written", answers: [item(qs[0], "answer 1"), item(qs[1], "answer 2")], questions: qs, notes: "", files,
      additions: [{ at: "2026-11-06T07:01:10.000Z", items, notes: "", files: [fileId] }] };
    // Needs you (newOnly, never paid): nothing new in Anything else, so no Anything else fold at all (no notes, no file sent first).
    const needs = unescape(renderToStaticMarkup(h(SentWork, { ...props, newOnly: { since: null } })));
    expect(needs).not.toContain('data-else-title=""');
    expect(needs).toContain(`/api/recordings/${fileId}/file`);
    for (const extra of [{}, { questionsFold: { open: true } }, { until: new Date("2026-11-06T08:00:00Z") }]) {
      const html = unescape(renderToStaticMarkup(h(SentWork, { ...props, ...extra })));
      const elseAt = html.indexOf('data-else-title=""');
      expect(elseAt).toBeGreaterThan(0);
      const elseFold = html.slice(html.lastIndexOf("<details", elseAt));
      expect(elseFold.slice(0, elseFold.indexOf("</summary>"))).not.toContain("data-added-count");
      expect(elseFold).not.toContain("data-added-label");
      expect(elseFold).not.toContain("data-set-extra");
      // The file shows in its answer's fold, not under Anything else.
      expect(html.indexOf(`/api/recordings/${fileId}/file`)).toBeGreaterThan(0);
      expect(html.indexOf(`/api/recordings/${fileId}/file`)).toBeLessThan(elseAt);
      expect(elseFold).not.toContain(fileId);
    }
    // Notes, or a file no answer places, still count.
    const loose = unescape(renderToStaticMarkup(h(SentWork, { ...props, additions: [{ at: "2026-11-06T07:01:10.000Z", items: items.map((x, i) => (i === 3 ? item(x.question, "no marker now") : x)), notes: "", files: [fileId] }] })));
    expect(loose).toContain('data-added-count="1"');
    const noted = unescape(renderToStaticMarkup(h(SentWork, { ...props, additions: [{ at: "2026-11-06T07:01:10.000Z", items, notes: "a note", files: [fileId] }] })));
    expect(noted).toContain('data-added-count="1"');
  });
});

describe("§283 6: the Testers list's Terms history at the bottom of the tester's drop-down", () => {
  it("below every part panel (written answers, recording, calls and their Pay panels), still inside the tester's drop-down", async () => {
    const { dev, testId } = await setup({ questions: [Q1, Q2] });
    const j = await joined(testId);
    expect((await send(j.sessionId, j.tester.cookie, { answers: ["the boats", "the gate"] })).status).toBe(200);
    expect((await edit(testId, dev.cookie, { questions: [Q1, Q3] })).status).toBe(200);
    const page = await testPage(testId, dev.user.id);
    const panelAt = page.indexOf(`id="tester-${j.sessionId}"`);
    const fold = page.slice(panelAt, page.indexOf('data-tester-summary=""', panelAt));
    const hist = fold.indexOf(`data-dev-terms-history="${j.sessionId}"`);
    expect(hist).toBeGreaterThan(0);
    expect(hist).toBeGreaterThan(fold.lastIndexOf('data-part-panel="'));
    expect(hist).toBeGreaterThan(fold.indexOf('data-parts-sent=""'));
    if (fold.includes("data-calls-fold=")) expect(hist).toBeGreaterThan(fold.indexOf("data-calls-fold="));
    // (Owner, Nov 6, §301) No Pay drop-down when there's nothing to pay: the content panel ends before the Terms history.
    expect(fold.indexOf('data-part-panel="content"')).toBeLessThan(hist);
    expect(fold.slice(fold.indexOf('data-part-panel="content"'), hist)).toContain("data-sent-work=");
  });
});

describe("§283 7: the written form never lists or sends a file already sent, or one that went into Terms history with its draft", () => {
  const upload = (contractId: string, filename: string) =>
    db.recording.create({ data: { contractId, storageKey: `k/${filename}`, filename, sizeBytes: 85_100_000, contentType: "video/mp4", part: "written", uploadedAt: new Date() } });

  it("the owner's case: a video sent in Q2's answer, then Q2 changed: the form shows no \"Files not in an answer\"", async () => {
    const { dev, testId } = await setup({ questions: [Q1, Q2] });
    const j = await joined(testId);
    const f = await upload(j.sessionId, "WIN_20261012_13_43_03_Pro.mp4");
    expect((await send(j.sessionId, j.tester.cookie, { answers: ["the boats", `the gate ${attachmentMarker(f.id, f.filename)}`] })).status).toBe(200);
    expect((await db.recording.findUniqueOrThrow({ where: { id: f.id } })).submissionId).not.toBeNull();
    expect((await edit(testId, dev.cookie, { questions: [Q1, Q3] })).status).toBe(200);
    const page = await sessionPage(j.sessionId, j.tester.user.id);
    expect(page).toContain('data-answer-form="open"');
    expect(page).not.toContain("data-loose-files");
    expect(page.slice(page.indexOf('data-answer-form="open"'))).not.toContain(f.filename);
  });

  it("an unsent file in a draft answer to a question that changed goes into Terms history with the draft: not loose in the form, not taken by the next Send", async () => {
    const { dev, testId } = await setup({ questions: [Q1, Q2] });
    const j = await joined(testId);
    expect((await send(j.sessionId, j.tester.cookie, { answers: ["the boats", ""] })).status).toBe(200);
    const f = await upload(j.sessionId, "draft-clip.mp4");
    const marker = attachmentMarker(f.id, f.filename);
    await db.keptForm.create({ data: { userId: j.tester.user.id, key: `written:${j.sessionId}`, data: { answers: ["the boats", `typed, not sent ${marker}`], notes: "", questions: [Q1, Q2] } } });
    expect((await edit(testId, dev.cookie, { questions: [Q1, Q3] })).status).toBe(200);
    const c = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } });
    expect(JSON.stringify(prevSetsOf(c.prevSets).at(-1)!.versions)).toContain(marker); // the draft, with its file, is the Terms history snapshot
    const page = await sessionPage(j.sessionId, j.tester.user.id);
    expect(page).not.toContain("data-loose-files");
    expect((await send(j.sessionId, j.tester.cookie, { answers: ["the map"] })).status).toBe(200);
    expect((await db.recording.findUniqueOrThrow({ where: { id: f.id } })).submissionId).toBeNull();
    // Back in the form (its question current again, the draft in the kept draft) or placed in what is sent: not left out.
    const uploads = [{ id: f.id, filename: f.filename }];
    expect([...snapshotOnlyFiles(c.prevSets, uploads, [])]).toEqual([f.id]);
    expect([...snapshotOnlyFiles(c.prevSets, uploads, [JSON.stringify({ answers: ["", `typed, not sent ${marker}`] })])]).toEqual([]);
  });
});
