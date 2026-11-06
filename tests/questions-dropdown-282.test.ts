import { readFileSync } from "node:fs";
import path from "node:path";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { QUESTIONS_LIST_MAX, SentWork } from "@/components/SentWork";
import { OLD_TAG, addedCount, questionKeys } from "@/lib/additions";
import { joined, sact, seen, setup } from "./fixtures";

// (Owner, Nov 6, §282) In a written part's panel, all the questions with their sent answers go inside ONE drop-down, "Questions (N)" (N: the questions shown),
// its list in the draggable scroll panel, above Pay / Pay more; each question still its own drop-down inside, unchanged (Old tag, "N added", boxes). Open at
// first in Needs you, closed in the Testers list; its open state kept per part (Fold's keptFold). Every part (written answers, recordings, calls) in Needs you and
// the Testers list is two panels: its content, then right under it, separate, its paying (Pay or Pay more; in the Testers list its payments too).
// (Owner, Nov 6, §301) In the Testers list the payments moved to a "Payments (N)" drop-down above the content, and Pay more is its own drop-down under it.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tests/t", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const Q1 = "What did you like?", Q2 = "Where did you get stuck?", Q3 = "What would you change?";
const item = (question: string, answer: string) => ({ question, required: false, answer });
const keyOf = (question: string) => questionKeys([{ question }])[0];
const written = (sessionId: string) => db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: sessionId, kind: "written" } } });
const send = (sessionId: string, cookie: string, body: Record<string, unknown>) => sact(sessionId, "written", cookie, { notes: "", seenAt: seen(), confirmed: true, ...body });
const testPage = async (testId: string, userId: string) => {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const { default: TestPage } = await import("@/app/app/tests/[id]/page");
  return unescape(renderToStaticMarkup(await TestPage({ params: Promise.resolve({ id: testId }), searchParams: Promise.resolve({}) })));
};
/** The `<details …>` tag that opens the fold with this id. */
const foldTag = (html: string, fold: string) => { const at = html.indexOf(`data-fold="${fold}"`); return at < 0 ? "" : html.slice(html.lastIndexOf("<details", at), html.indexOf(">", at)); };
const countOf = (html: string, s: string) => html.split(s).length - 1;
/** The whole element whose opening tag holds position `at` (its nested same-name tags counted). */
function elementAt(html: string, at: number) {
  if (at < 0) return "";
  const start = html.lastIndexOf("<", at);
  const tag = /^<([a-z0-9]+)/.exec(html.slice(start))![1];
  const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, "g");
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  return html.slice(start);
}

describe("§282 SentWork's Questions (N) drop-down", () => {
  const answers = [item(Q1, "the boats"), item(Q2, "level two gate")];
  const additions = [{ at: new Date(Date.now() - 10_000).toISOString(), text: "and the third gate", files: [], questionKey: keyOf(Q2) }];
  const draw = (open: boolean) =>
    unescape(renderToStaticMarkup(h(SentWork, { id: "p", kind: "written", answers, questions: [Q1, Q2], notes: "a note", additions, files: [], questionsFold: { open } })));

  it("every question's fold (and Anything else, the list's last) is inside the one drop-down, its list in the draggable panel; N counts the questions", () => {
    const html = draw(true);
    expect(html).toContain('data-questions-toggle="" data-questions-count="2">Questions (2)</span>');
    const list = html.slice(html.indexOf('data-panel="p-questions-list"'));
    expect(html.indexOf('data-panel="p-questions-list"')).toBeGreaterThan(html.indexOf('data-fold="p-questions"'));
    for (const q of [Q1, Q2]) expect(list).toContain(`data-fold="p-q-${keyOf(q)}"`);
    expect(list).toContain('data-question-body="else"');
    expect(countOf(html, 'data-question-title=""')).toBe(3); // 2 questions and Anything else, all inside
    expect(html.indexOf('data-fold="p-q-')).toBeGreaterThan(html.indexOf('data-panel="p-questions-list"'));
    expect(html).toContain(`max-height:${QUESTIONS_LIST_MAX}`);
    // Inside each question's drop-down, as before: "· 1 added", the question box, the answer and the addition.
    expect(list).toContain(`data-added-count="1">${addedCount(1)}</span>`);
    expect(list).toContain("and the third gate");
    expect(list).toContain('data-set-question=""');
  });

  it("open or closed at first; the drop-down is a Fold (its state kept per part); without questionsFold the folds sit directly (the tester's own page)", () => {
    expect(foldTag(draw(true), "p-questions")).toMatch(/^<details open=""/);
    expect(foldTag(draw(false), "p-questions")).not.toContain("open=");
    expect(draw(false)).toContain('data-questions-fold="closed"');
    const bare = unescape(renderToStaticMarkup(h(SentWork, { id: "p", kind: "written", answers, questions: [Q1, Q2], notes: "", additions, files: [] })));
    expect(bare).not.toContain("data-questions-toggle");
    expect(bare).toContain(`data-fold="p-q-${keyOf(Q1)}"`);
    expect(src("components/SentWork.tsx")).toContain("<Fold id={`${id}-questions`} defaultOpen={questionsFold.open}");
  });

  it("Needs you (newOnly): an old question's new answer stays inside, tagged Old, and N counts it; nothing new: no drop-down, the note", () => {
    const html = unescape(renderToStaticMarkup(h(SentWork, { id: "n", kind: "written", answers, questions: [Q1, Q3], notes: "", additions: [], files: [], newOnly: { since: null }, questionsFold: { open: true } })));
    expect(html).toContain("Questions (2)");
    const list = html.slice(html.indexOf('data-panel="n-questions-list"'));
    expect(list).toContain(`data-old-question="">${OLD_TAG}</span>`);
    expect(list).toContain("level two gate");
    const none = renderToStaticMarkup(h(SentWork, { id: "n", kind: "written", answers, questions: [Q1, Q2], notes: "", additions: [], files: [], newOnly: { since: new Date() }, questionsFold: { open: true } }));
    expect(none).not.toContain("data-questions-toggle");
    expect(none).toContain("Nothing new since you paid.");
  });
});

describe("§282 on the developer's test page", () => {
  it("Needs you's part: Questions (N) open, every question fold and the Old tag inside, above the Pay box; the Testers list the same, closed", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await send(j.sessionId, j.tester.cookie, { answers: ["the boats", "level two gate"] })).status).toBe(200);
    const sub = await written(j.sessionId);
    // Q2 changed after it was answered, then an unpaid addition to it: Needs you shows it, tagged Old.
    await db.contract.update({ where: { id: j.sessionId }, data: { questions: [Q1, Q3] } });
    await db.submission.update({ where: { id: sub.id }, data: { additions: [
      { at: new Date(Date.now() - 20_000).toISOString(), text: "late note on Q2", files: [], questionKey: keyOf(Q2) },
    ] } });
    const page = await testPage(testId, dev.user.id);

    const needsAt = page.indexOf(`data-fold="needs-${sub.id}-questions"`);
    expect(needsAt).toBeGreaterThan(0);
    expect(foldTag(page, `needs-${sub.id}-questions`)).toMatch(/^<details open=""/);
    const needs = page.slice(needsAt, page.indexOf(`id="part-${sub.id}"`));
    expect(needs).toContain('data-questions-count="2">Questions (2)<');
    const panelAt = needs.indexOf(`data-questions-plain="needs-${sub.id}-questions-list"`), pay = needs.indexOf('data-fold="needs-pay-');
    expect(panelAt).toBeGreaterThan(0);
    const list = needs.slice(panelAt, pay);
    expect(list).toContain(`data-fold="needs-${sub.id}-q-${keyOf(Q1)}"`);
    expect(list).toContain(`data-fold="needs-${sub.id}-q-${keyOf(Q2)}"`);
    expect(list).toContain(`data-old-question="">${OLD_TAG}</span>`);
    expect(list).toContain(`data-added-count="1">${addedCount(1)}</span>`);
    expect(list).toContain("late note on Q2");
    // The Pay box right below the drop-down, outside it.
    expect(pay).toBeGreaterThan(panelAt);
    expect(needs.slice(pay)).not.toContain('data-question-title=""');
    expect(page).not.toContain(`data-panel="needs-${sub.id}"`); // no outer panel around a written part any more

    // The Testers list: the same drop-down, closed at first (the part as paid: nothing paid yet, so what was sent; Q2 is old there, so only Q1).
    const rowFold = foldTag(page, `row-${sub.id}-questions`);
    expect(rowFold).toMatch(/^<details /);
    expect(rowFold).not.toContain("open=");
    const row = page.slice(page.indexOf(`data-fold="row-${sub.id}-questions"`));
    expect(row).toContain("Questions (1)");
    expect(row.slice(row.indexOf(`data-panel="row-${sub.id}-questions-list"`))).toContain(`data-fold="row-${sub.id}-q-${keyOf(Q1)}"`);
    expect(page).not.toContain(`data-panel="row-${sub.id}"`);
  });

  it("two panels per part, written answers and a recording, in Needs you and the Testers list: the content first, then the paying, separate", async () => {
    const { dev, testId } = await setup({ recordingCents: "10.00" });
    const j = await joined(testId);
    expect((await send(j.sessionId, j.tester.cookie, { answers: ["the boats", "level two gate"] })).status).toBe(200);
    const sub = await written(j.sessionId);
    const rec = await db.submission.create({ data: { contractId: j.sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
    await db.recording.create({ data: { contractId: j.sessionId, submissionId: rec.id, storageKey: "k/clip.mp4", filename: "clip.mp4", sizeBytes: 1000, contentType: "video/mp4", part: "recording", uploadedAt: new Date() } });
    /** The part's content panel and pay panel (whole elements), checked: content first, closed before the pay panel opens; each holds only its own. */
    const panels = (part: string, kind: string, pay: string) => {
      const content = elementAt(part, part.indexOf('data-part-panel="content"'));
      const payAt = part.indexOf('data-part-panel="pay"');
      expect(content, kind).not.toBe("");
      expect(payAt, kind).toBeGreaterThan(part.indexOf(content) + content.length - 1); // separate: the pay panel isn't inside the content panel
      const payPanel = elementAt(part, payAt);
      expect(content, kind).toContain(`data-sent-work="${kind}"`);
      expect(content, kind).not.toContain(pay);
      expect(payPanel, kind).toContain(pay);
      expect(payPanel, kind).not.toContain("data-sent-work");
      return { content, payPanel };
    };
    let page = await testPage(testId, dev.user.id);
    // Needs you: each part's drop-down holds its content panel, then its Pay panel (the Pay drop-down with the Pay box).
    for (const [s, kind] of [[sub, "written"], [rec, "recording"]] as const) {
      const part = elementAt(page, page.indexOf(`id="piece-${s.id}"`));
      const { content } = panels(part, kind, "data-pay-box=");
      if (kind === "written") expect(content).toContain(`data-fold="needs-${s.id}-questions"`);
      else expect(content).toContain(`data-panel="needs-${s.id}"`);
    }
    // The Testers list (Owner, Nov 6, §301; was §282's pay panel under the content): once something was paid, its payments are in "Payments (N)" ABOVE the
    // content panel; with no review there is no Pay more, so no Pay drop-down under it (tests/pay-panels-301.test.ts has the whole order).
    for (const s of [sub, rec]) await db.payment.create({ data: { kind: "review", amountCents: 500, status: "charged", contractId: j.sessionId, submissionId: s.id, developerId: dev.user.id, testerId: j.tester.user.id, feeCents: 0, testerCents: 0 } });
    page = await testPage(testId, dev.user.id);
    for (const [s, kind] of [[sub, "written"], [rec, "recording"]] as const) {
      const part = elementAt(page, page.indexOf(`id="part-${s.id}"`));
      const content = elementAt(part, part.indexOf('data-part-panel="content"'));
      expect(content, kind).toContain(`data-sent-work="${kind}"`);
      expect(content, kind).not.toContain("data-part-payments");
      expect(part.indexOf(`data-part-payments="${s.id}"`), kind).toBeGreaterThan(0);
      expect(part.indexOf(`data-part-payments="${s.id}"`), kind).toBeLessThan(part.indexOf(content));
      if (kind === "written") expect(content).toContain(`data-fold="row-${s.id}-questions"`);
      else expect(content).toContain(`data-panel="row-${s.id}"`);
      expect(part).not.toContain('data-part-panel="pay"'); // nothing to pay or note: no empty Pay drop-down
    }
  });

  it("the sources: Needs you's part and update rows open, the Testers list closed, the team's See the work open; the tester's own page unchanged", () => {
    const page = src("app/app/tests/[id]/page.tsx");
    // (Owner, Nov 6, §289) In Needs you without a scroll of its own.
    expect(page).toContain("newOnly={{ since: paidCut(x.s!) }} questionsFold={{ open: true, ownScroll: false }} />");
    expect(page).toContain("newOnly={{ since: paidCut(x) }} questionsFold={{ open: true, ownScroll: false }} />");
    expect(page).toContain("until={paidCut(r.sub)} questionsFold={{ open: false }} />");
    expect(src("app/admin/DisputeWork.tsx")).toContain("questionsFold={{ open: true }}");
    expect(src("app/app/sessions/[id]/page.tsx")).not.toContain("questionsFold");
    // Calls follow the same two panels: Needs you's call (its details, then the Pay drop-down) and the Testers list's call rows ((Owner, Nov 6, §301) Payments
    // (N), details, then the Pay more drop-down).
    expect(page).toContain('<div className={`${PART_PANEL} space-y-2`} data-part-panel="content">');
    expect(page.indexOf('data-part-panel="content"', page.indexOf("(Owner, Nov 6, §282) A call too"))).toBeLessThan(page.indexOf('data-call-length="">{lengthOf(x.x!)}'));
    expect(page.indexOf("{payFold(`row-pay-${x.id}`", page.indexOf("<Fold id={`row-call-${x.id}`}"))).toBeLessThan(page.indexOf("<PayBox more={{ testId: t.id, contractId: c.id }} awayInNeeds owes={owesNow} kind=\"call\""));
    expect(page.match(/"data-part-panel": "pay"/g)).toHaveLength(4); // Needs you: a sent part, a call, an update row; (§301) the Testers list's payFold
  });
});
