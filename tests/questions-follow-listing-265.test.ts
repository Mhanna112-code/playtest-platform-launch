import { randomUUID } from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { prevSetsOf } from "@/lib/answerSets";
import { saveLine } from "@/lib/listingSave";
import { questionsUpdatedLine, termsDiff } from "@/lib/rules";
import { decideTerms } from "@/lib/server/terms";
import { POST as reviewPOST } from "@/app/api/review/route";
import { act, joined, sact, seen, settle, setup } from "./fixtures";
import { json, req } from "./helpers";

// (Owner, Nov 5, batch 35 §265) Questions follow the listing, not the contract's Switch / Keep: a Save that changes them writes them into every working tester's
// contract at once (Contract.questions stays "this tester's questions"), each change a Terms history entry (§263); the tester is told as for listing information
// (the "Updated" mark, the top box's line, the bell). No offer carries questions; an older offer's Switch never writes them back. A new required question
// applies to the tester's next Send only, never to what was sent, never to the developer's Pay.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/s", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const Q1 = "What did you like?", Q2 = "Where did you get stuck?", Q3 = "What would you change?";
const send = (sessionId: string, cookie: string, body: Record<string, unknown>) => sact(sessionId, "written", cookie, { notes: "", seenAt: seen(), confirmed: true, ...body });
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

describe("§265 a Save that changes the questions", () => {
  it("makes no offer; every working contract follows at once, with a Terms history entry, the Updated mark, the top box's line and the bell", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await send(j.sessionId, j.tester.cookie, { answers: ["the boats", "level two gate"] })).status).toBe(200);
    expect((await edit(testId, dev.cookie, { questions: [Q1, Q3] })).status).toBe(200);
    expect(await db.termsOffer.count({ where: { contractId: j.sessionId } })).toBe(0);
    const c = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } });
    expect(c.questions).toEqual([Q1, Q3]);
    const [set] = prevSetsOf(c.prevSets);
    expect(set.items.map((x) => x.question)).toEqual([Q1, Q2]);
    expect(set.to).toEqual([Q1, Q3]);
    // The bell, in the listing's words, to the contract box.
    const bell = await db.notification.findMany({ where: { userId: j.tester.user.id, text: { contains: "updated the listing: questions" } } });
    expect(bell).toHaveLength(1);
    expect(bell[0].text).toContain(questionsUpdatedLine("Nora Lane"));
    expect(bell[0].link).toBe(`/app/sessions/${j.sessionId}#scope`);
    // The top box's line names the questions (the session side's listing line).
    const save = await db.testEvent.findFirstOrThrow({ where: { testId, kind: "listing_save" }, orderBy: { createdAt: "desc" } });
    expect(saveLine(JSON.parse(save.text), save.createdAt, null, "session")?.text).toContain("questions");
    // The contract box: the questions carry "Updated <time>" and the See it mark; Terms history has the entry; the list shows the current questions only.
    const page = await sessionPage(j.sessionId, j.tester.user.id);
    const qs = page.slice(page.indexOf('data-scope-questions=""'));
    expect(qs.slice(0, 400)).toMatch(/data-info-line="questions"[^>]*data-updated-at="[^"]+"/);
    expect(qs).toContain("Updated ");
    expect(page).toContain("Questions changed ");
    const list = page.slice(page.indexOf('data-panel="own-answers-list-'), page.indexOf('data-question-body="else"'));
    expect(list).not.toContain(Q2);
    // Add to this answer works straight away on an answered current question (no Send to move onto the new questions).
    expect((await sact(j.sessionId, "written-add", j.tester.cookie, { text: "more on the boats", question: (await import("@/lib/additions")).questionKey(Q1), seenAt: seen(), confirmed: true })).status).toBe(200);
  });

  it("a Save of the price and the questions offers the price only; Switch on it (or an older offer with other questions) never writes questions", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect(termsDiff({ ndaText: "", writtenCents: 1000, recordingCents: null, liveRateCents: null, liveMinutes: null, deadlineDays: 7, questions: [Q1], writtenRequired: false, recordingRequired: false, liveRequired: false },
      { ndaText: "", writtenCents: 1000, recordingCents: null, liveRateCents: null, liveMinutes: null, deadlineDays: 7, questions: [Q3], writtenRequired: false, recordingRequired: false, liveRequired: false })).toBe("");
    expect((await edit(testId, dev.cookie, { questions: [Q1, Q3], writtenCents: "12.00" })).status).toBe(200);
    const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: j.sessionId, status: "open" } });
    expect(offer.diff).not.toContain("question");
    expect(offer.questions).toEqual([Q1, Q3]);
    // A stale offer's questions (made before §265) are never applied.
    await db.termsOffer.update({ where: { id: offer.id }, data: { questions: [Q1, Q2], fromQuestions: [Q1, Q2] } });
    await decideTerms({ id: j.tester.user.id }, j.sessionId, { offerId: offer.id, choice: "switch", seenAt: seen(), confirmed: true });
    const c = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } });
    expect(c.writtenCents).toBe(1200);
    expect(c.questions).toEqual([Q1, Q3]);
    // The offer box has no questions block.
    expect(await sessionPage(j.sessionId, j.tester.user.id)).not.toContain("data-question-changes");
  });

  it("a contract that already differs from the listing (an offer kept before §265) follows on the next question Save", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    await db.contract.update({ where: { id: j.sessionId }, data: { questions: ["An old kept question?"] } });
    expect((await edit(testId, dev.cookie, { questions: [Q1, Q3] })).status).toBe(200);
    expect((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions).toEqual([Q1, Q3]);
  });
});

describe("§265 a new required question applies to the next Send only", () => {
  const payReview = (cookie: string, id: string, amount: string) => reviewPOST(req("/api/review", { cookie, body: { kind: "submission", id, payKey: randomUUID(), amount, tickedCents: Math.round(Number(amount) * 100), seenAt: seen(), confirmed: true } })).then(json);

  it("it is a box under Questions you haven't answered yet, required there; what was sent stays payable", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await send(j.sessionId, j.tester.cookie, { answers: ["the boats", "level two gate"] })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId, kind: "written" } });
    expect((await edit(testId, dev.cookie, { questions: [Q1, Q2, `[required] ${Q3}`] })).status).toBe(200);
    const page = await sessionPage(j.sessionId, j.tester.user.id);
    const form = page.slice(page.indexOf("data-answer-form="));
    expect(form).toContain("Questions you haven't answered yet");
    expect(form).toContain(Q3);
    const blank = await send(j.sessionId, j.tester.cookie, { answers: [""], for: [`[required] ${Q3}`] });
    expect(blank.status).toBe(400);
    // The developer's Pay on what was sent is never blocked by it.
    expect((await payReview(dev.cookie, sub.id, "10.00")).status).toBe(200);
    expect((await send(j.sessionId, j.tester.cookie, { answers: ["the colours"], for: [`[required] ${Q3}`] })).status).toBe(200);
  });
});
