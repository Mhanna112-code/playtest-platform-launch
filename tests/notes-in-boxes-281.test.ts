import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { LabeledReason } from "@/components/ScrollText";
import { PAID_ZERO_LABEL, paidZeroLine } from "@/lib/rules";
import { DEV_SIDE_LABEL, TEAM_CLOSED_LABEL, teamClosedLine, teamDecidedLabel } from "@/lib/moneyLines";
import { json, req } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 6, §281) The short typed notes around a payment or a dispute (the developer's note when paying, at Pay and each Pay more; the team's decision note;
// the developer's side; the tester's dispute reason; a $0 or team close-out's reason) sit in the shared draggable reason box (ReasonQuote, §237) under their line,
// never inline, on every surface; a short one in the same (small at first) box. A long unbroken note no longer fills the card.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/s", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: (to: string) => { throw Error(`redirect:${to}`); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const unescape = (h: string) => h.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const LONG = (c: string) => c.repeat(400); // one unbroken word

/** The labeled box around `note`: its label line (containing `label`), then the reason box with the note, in that order, in one wrapper. */
function boxed(html: string, label: string, note: string) {
  const at = html.indexOf(`“${note}”`);
  expect(at, `note for ${label}`).toBeGreaterThan(0);
  const wrap = html.lastIndexOf("data-labeled-reason", at);
  expect(wrap, `wrapper for ${label}`).toBeGreaterThan(0);
  const between = html.slice(wrap, at);
  expect(between).toContain('data-reason-label=""');
  expect(between).toContain(label);
  expect(between).toContain('data-reason=""');
  expect(between).toContain('data-panel="'); // the draggable box (ResizeBox)
  expect(html.slice(html.lastIndexOf("<blockquote", at), at)).toContain("[overflow-wrap:anywhere]");
  // Never inline after the label any more.
  expect(html).not.toContain(`: “${note}”`);
  expect(html).not.toContain(` · “${note}”`);
}

describe("§281: payment and dispute notes in the draggable reason box", () => {
  it("LabeledReason: the line, then the note in a ReasonQuote; short notes boxed too; no note: just the line", () => {
    const h = render(React.createElement(LabeledReason, { line: "Paid $0 · Fri, Nov 6, 12:37 AM", label: PAID_ZERO_LABEL, text: LONG("w"), data: { "data-paid-zero": "" } }));
    expect(h).toContain('data-paid-zero=""');
    boxed(h, "Paid $0 · Fri, Nov 6, 12:37 AM", LONG("w"));
    const short = render(React.createElement(LabeledReason, { line: DEV_SIDE_LABEL, text: "ok" }));
    boxed(short, "The developer's side".replace("'", "&#x27;"), "ok");
    expect(short).toContain('data-panel-height="default"'); // starts small (the ReasonQuote default)
    const none = render(React.createElement(LabeledReason, { line: teamDecidedLabel("$0.00") + ".", text: "  " }));
    expect(none).toContain("The team decided: $0.00 in all.");
    expect(none).not.toContain("data-reason=");
    // The labels; the plain-text lines (kept for emails and older tests) are unchanged.
    expect(teamDecidedLabel("$0.00")).toBe("The team decided: $0.00 in all");
    expect(DEV_SIDE_LABEL).toBe("The developer's side");
    expect(paidZeroLine("x")).toBe(`${PAID_ZERO_LABEL}: “x”`);
    expect(teamClosedLine("x")).toBe(`${TEAM_CLOSED_LABEL}: “x”`);
  });

  it("the tester's session page and the developer's Testers list: Paid $0, the team's decision and the developer's side, each in its box", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    const payNote = LONG("p");
    expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "0", tickedCents: 0, reason: payNote })).status).toBe(200);
    const d = await sact(j.sessionId, "dispute", j.tester.cookie, { kind: "submission", id: sub.id, reason: LONG("r") });
    expect(d.status).toBe(200);
    const side = LONG("s");
    const decision = LONG("d");
    await db.dispute.updateMany({ where: { submissionId: sub.id }, data: { devSide: side, devSideAt: new Date(), status: "decided", decidedCents: 0, decidedAt: new Date(), decisionNote: decision } });

    auth.user = await db.user.findUniqueOrThrow({ where: { id: j.tester.user.id } });
    const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
    const tester = unescape(render(await SessionPage({ params: Promise.resolve({ id: j.sessionId }) })));
    boxed(tester, "Paid $0 · ", payNote);
    boxed(tester, "The team decided: $0.00 in all", decision);
    boxed(tester, "The developer's side", side);
    expect(tester).not.toContain("The team decided: $0.00 in all ·");

    auth.user = await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } });
    const { default: TestPage } = await import("@/app/app/tests/[id]/page");
    const dev = unescape(render(await TestPage({ params: Promise.resolve({ id: s.testId }), searchParams: Promise.resolve({}) })));
    boxed(dev, "Paid $0 · ", payNote);
  });

  it("Pay with a note and each Pay more's note: in boxes under their lines on the tester's page", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    const first = LONG("f");
    const more = "Thanks";
    expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "6.00", tickedCents: 600, reason: first })).status).toBe(200);
    expect((await act(s.testId, "pay-extra", s.dev.cookie, { seenAt: seen(), contractId: j.sessionId, submissionId: sub.id, amount: "2.00", tickedCents: 200, payKey: randomUUID(), note: more })).status).toBe(200);
    auth.user = await db.user.findUniqueOrThrow({ where: { id: j.tester.user.id } });
    const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
    const html = unescape(render(await SessionPage({ params: Promise.resolve({ id: j.sessionId }) })));
    boxed(html, "Paid $6.00", first);
    boxed(html, "Extra $2.00: you get", more); // a short note: the same box
  });

  it("the other surfaces: every note field rendered in a reason box, never as inline text", () => {
    const session = src("app/app/sessions/[id]/page.tsx");
    const review = session.slice(session.indexOf("function TesterReview"));
    for (const inline of ["“{review.reason}”</p>", "“{update.note}”", "“{x.note}”", "“${dispute.decisionNote}”", "“{dispute.devSide}”"]) expect(review).not.toContain(inline);
    const devPage = src("app/app/tests/[id]/page.tsx");
    expect(devPage).not.toContain("{teamClosedLine(");
    expect(devPage).not.toContain("{paidZeroLine(");
    expect(devPage).toContain('<ReasonQuote id={`dispute-${d.id}`} label={`${d.Poss} reason`} text={d.reason} />'); // Needs you: the tester's dispute reason
    expect(src("app/app/page.tsx")).toContain('<ReasonQuote id={`dispute-reason-${d.id}`} label="Their reason" text={d.reason} />'); // the dashboard's dispute box
    const admin = src("app/admin/PagedList.tsx");
    expect(admin).toContain("Developer&apos;s side:<ReasonQuote text={d.devSide}");
    expect(admin).toContain("{d.decisionNote && <ReasonQuote text={d.decisionNote}");
    expect(src("app/admin/DisputeDecision.tsx")).toContain("<ReasonQuote text={side.text}");
    const lists = src("lib/server/adminLists.ts");
    expect(lists).toContain("`'s reason:`, quoted(d.reason)"); // the team's dispute rows: the reason and the developer's note when paying
    expect(lists).toContain("quoted(r.reason)");
    expect(lists).toContain("em: d.reason"); // the test box's timeline (AdminRich / PagedList render `em` in a ReasonQuote)
  });
});
