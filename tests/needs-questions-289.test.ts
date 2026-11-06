import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { SentWork } from "@/components/SentWork";
import { questionKeys } from "@/lib/additions";
import { joined, sact, seen, setup } from "./fixtures";

// (Owner, Nov 6, §289) In Needs you, the "Questions (N)" list (§282) has NO scroll of its own inside the person's panel: a plain drop-down, the person's panel
// the only scroll (§187's rule wins). In the Testers list and the team's "See the work" it keeps its draggable scroll panel (ResizeBox).

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tests/t", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const Q1 = "What did you like?", Q2 = "Where did you get stuck?";
const keyOf = (question: string) => questionKeys([{ question }])[0];

describe("§289 SentWork's Questions (N) with and without its own scroll", () => {
  const answers = [{ question: Q1, required: false, answer: "the boats" }, { question: Q2, required: false, answer: "level two gate" }];
  const draw = (ownScroll?: boolean) =>
    unescape(renderToStaticMarkup(h(SentWork, { id: "p", kind: "written", answers, questions: [Q1, Q2], notes: "", additions: [], files: [], questionsFold: { open: true, ...(ownScroll === undefined ? {} : { ownScroll }) } })));

  it("ownScroll false: the questions sit plainly in the drop-down (no ResizeBox: no panel, no scroll box, no grip)", () => {
    const html = draw(false);
    expect(html).toContain("Questions (2)");
    expect(html).toContain('data-questions-plain="p-questions-list"');
    expect(html).not.toContain('data-panel="p-questions-list"');
    // Between the drop-down's toggle and the first question: no scroll box and no grip (each question's and answer's own box keeps its own, QA.tsx).
    const head = html.slice(html.indexOf('data-fold="p-questions"'), html.indexOf('data-fold="p-q-'));
    expect(head).toContain("data-questions-plain");
    expect(head).not.toContain("data-panel-box");
    expect(head).not.toContain("data-panel-grip");
    expect(html.slice(html.indexOf("data-questions-plain"))).toContain(`data-fold="p-q-${keyOf(Q1)}"`);
  });

  it("by default (the Testers list, See the work): its draggable scroll panel", () => {
    const html = draw();
    expect(html).toContain('data-panel="p-questions-list"');
    const head = html.slice(html.indexOf('data-fold="p-questions"'), html.indexOf('data-fold="p-q-'));
    expect(head).toContain("data-panel-box");
    expect(head).not.toContain("data-panel-flat");
    expect(html).not.toContain("data-questions-plain");
  });
});

describe("§289 on the developer's test page", () => {
  it("Needs you's Questions has no ResizeBox; the Testers list's does", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["the boats", "level two gate"], notes: "", seenAt: seen(), confirmed: true })).status).toBe(200);
    const sub = await db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: j.sessionId, kind: "written" } } });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: dev.user.id } });
    const { default: TestPage } = await import("@/app/app/tests/[id]/page");
    const page = unescape(renderToStaticMarkup(await TestPage({ params: Promise.resolve({ id: testId }), searchParams: Promise.resolve({}) })));

    // Needs you: the plain list inside the open drop-down, above the Pay panel; no scroll panel of its own.
    const needsAt = page.indexOf(`data-fold="needs-${sub.id}-questions"`);
    expect(needsAt).toBeGreaterThan(0);
    const needs = page.slice(needsAt, page.indexOf('data-fold="needs-pay-', needsAt));
    expect(needs).toContain(`data-questions-plain="needs-${sub.id}-questions-list"`);
    expect(needs).toContain(`data-fold="needs-${sub.id}-q-${keyOf(Q1)}"`);
    expect(page).not.toContain(`data-panel="needs-${sub.id}-questions-list"`);
    const head = needs.slice(0, needs.indexOf(`data-fold="needs-${sub.id}-q-`));
    expect(head).not.toContain("data-panel-box");
    expect(head).not.toContain("data-panel-grip");

    // The Testers list: its draggable scroll panel (a real one: its own box and grip, never flat).
    const rowAt = page.indexOf(`data-panel="row-${sub.id}-questions-list"`);
    expect(rowAt).toBeGreaterThan(0);
    const row = page.slice(rowAt, rowAt + 600);
    expect(row).not.toContain("data-panel-flat");
    expect(row).toContain("data-panel-box");
    expect(page).not.toContain(`data-questions-plain="row-${sub.id}-questions-list"`);
  });
});
