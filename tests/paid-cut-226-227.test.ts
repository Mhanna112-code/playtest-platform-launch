import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { SentWork } from "@/components/SentWork";
import { lastPaidAt } from "@/lib/paidCut";
import { pressLabelOf } from "@/lib/pressLabels";
import { PAY_OWED_HREF, PAY_OWED_LINK } from "@/lib/rules";
import { questionKeys } from "@/lib/additions";
import { POST as reviewPOST } from "@/app/api/review/route";
import { act, joined, sact, seen, settle, setup } from "./fixtures";
import { json, req } from "./helpers";

// (Owner, Nov 5, batch 35 §226) The Testers list shows a part as last paid; Needs you shows only what is new since then; Needs you's button for the new is "Pay"
// (Pay more's route and checks), the Testers list keeps "Pay more"; the questions and answers in Needs you in the §223 boxes.
// (§227) Pay what you owe never shows on the developer's test page: the page links to it on Payments.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tests/test", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const Q1 = "What did you like?", Q2 = "Where did you get stuck?";
const [K1, K2] = questionKeys([{ question: Q1 }, { question: Q2 }]);
const item = (question: string, answer: string) => ({ question, required: false, answer });
const T0 = new Date("2026-11-05T10:00:00.000Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

describe("§226 the cut-off: the review's last payment time (lib/paidCut.ts)", () => {
  const pay = (kind: string, status: string, min: number, submissionId = "s1") => ({ submissionId, kind, status, createdAt: at(min) });
  it("null before the first payment; else the latest Pay / Pay more that went through, at its press", () => {
    expect(lastPaidAt({ id: "s1", review: null }, [])).toBeNull();
    const review = { amountCents: 1000, createdAt: at(1) };
    expect(lastPaidAt({ id: "s1", review }, [pay("review", "charged", 0)])).toEqual(at(0));
    expect(lastPaidAt({ id: "s1", review }, [pay("review", "charged", 0), pay("extra", "charged", 30), pay("extra", "failed", 40), pay("extra", "needs_action", 50), pay("extra", "charged", 60, "other")])).toEqual(at(30));
    expect(lastPaidAt({ id: "s1", review }, [pay("review", "not_set_up", 0), pay("dispute", "charged", 90)])).toEqual(at(0)); // a team decision doesn't move it
  });
  it("a Pay that charged nothing ($0, rejected, the team's closure, not gone through) counts at the review; a $0 Pay more closing an update counts too", () => {
    expect(lastPaidAt({ id: "s1", review: { amountCents: 0, createdAt: at(5) } }, [])).toEqual(at(5));
    expect(lastPaidAt({ id: "s1", review: { amountCents: 900, createdAt: at(6) } }, [pay("review", "owed", 4)])).toEqual(at(6));
    expect(lastPaidAt({ id: "s1", review: { amountCents: 900, createdAt: at(6) }, paidUpdateZeroAt: at(70) }, [pay("review", "charged", 4)])).toEqual(at(70));
  });
});

describe("§226 SentWork: as paid (until) and only the new (newOnly)", () => {
  const additions = [
    { at: at(10).toISOString(), text: "paid addition", files: [], questionKey: K1 },
    { at: at(40).toISOString(), text: "new addition", files: ["f2"], questionKey: K1 },
    { at: at(45).toISOString(), text: "first answer to Q2", files: [], questionKey: K2, first: true },
    { at: at(50).toISOString(), text: "new in anything else", files: [], questionKey: "else" },
  ];
  const files = [{ id: "f1", filename: "first.png", contentType: "image/png", sizeBytes: 5, part: "written" }, { id: "f2", filename: "later.txt", contentType: "text/plain", sizeBytes: 5, part: "written" }];
  const draw = (over: Record<string, unknown>) => unescape(renderToStaticMarkup(h(SentWork, { id: "x", timeZone: "UTC", kind: "written", answers: [item(Q1, "the boats"), item(Q2, "")], notes: "my notes", additions, files, ...over })));

  it("until: the part as last paid: later additions, their files and questions answered later are left out", () => {
    const html = draw({ until: at(20) });
    expect(html).toContain("the boats");
    expect(html).toContain("paid addition");
    expect(html).toContain("my notes");
    for (const later of ["new addition", "first answer to Q2", "new in anything else", "later.txt"]) expect(html, later).not.toContain(later);
    // (Owner, Nov 6, §283) Q2, unanswered as paid, isn't listed (it was "(no answer)" before).
    expect(html).not.toContain(`data-question-body="${K2}"`);
    expect(html).not.toContain("(no answer)");
  });

  it("newOnly since the last payment: only the questions answered or added to since, with just the new; unchanged and unanswered left out", () => {
    const html = draw({ newOnly: { since: at(20) } });
    expect(html).toContain("new addition");
    expect(html).toContain("first answer to Q2");
    expect(html).toContain("new in anything else");
    for (const old of ["the boats", "paid addition", "my notes", "first.png", "(no answer)"]) expect(html, old).not.toContain(old);
    // Each in the §223 boxes: the question's box, then the new addition's.
    const q1 = html.slice(html.indexOf(`data-question-body="${K1}"`), html.indexOf(`data-question-body="${K2}"`));
    expect(q1).toContain('data-qa="question"');
    expect(q1.match(/data-qa="answer"/g)).toHaveLength(1);
    expect(html).toContain('data-added-count="1">· 1 added</span>');
  });

  it("newOnly with nothing new: one line; never paid (since null): every answered question, not the unanswered ones", () => {
    expect(draw({ newOnly: { since: at(60) } })).toContain('data-nothing-new="">Nothing new since you paid.</p>');
    const never = renderToStaticMarkup(h(SentWork, { id: "y", kind: "written", answers: [item(Q1, "the boats"), item(Q2, "")], notes: "", additions: [], files: [], newOnly: { since: null } }));
    expect(never).toContain("the boats");
    expect(never).not.toContain(`data-question-body="${K2}"`);
    expect(never).not.toContain("(no answer)");
  });
});

describe("§226 on the developer's test page", () => {
  const payReview = (cookie: string, id: string, amount: string) => reviewPOST(req("/api/review", { cookie, body: { kind: "submission", id, payKey: randomUUID(), amount, tickedCents: Math.round(Number(amount) * 100), seenAt: seen(), confirmed: true } })).then(json);
  const written = (sessionId: string) => db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: sessionId, kind: "written" } } });
  const page = async (testId: string) => unescape(renderToStaticMarkup(await (await import("@/app/app/tests/[id]/page")).default({ params: Promise.resolve({ id: testId }), searchParams: Promise.resolve({}) })));
  // The Testers list's part (up to the next part, or By question below the list).
  const testersRow = (html: string, subId: string) => {
    const from = html.indexOf(`id="part-${subId}"`);
    const ends = [html.indexOf('id="part-', from + 5), html.indexOf("data-live-part", from), html.indexOf('id="by-question"', from)].filter((x) => x > from);
    return html.slice(from, Math.min(...ends, html.length));
  };
  const updateRow = (html: string, subId: string) => html.slice(html.indexOf(`data-update-row="${subId}"`), html.indexOf(`id="part-${subId}"`));

  it("an addition after a Pay waits in Needs you only (named Pay); once paid it moves into the Testers list; the next one waits in Needs you again", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["the boats", "level 2"], notes: "", seenAt: seen(), confirmed: true })).status).toBe(200);
    const sub = await written(j.sessionId);
    auth.user = await db.user.findUniqueOrThrow({ where: { id: dev.user.id } });
    // Never paid: the Testers list shows what was sent.
    expect(testersRow(await page(testId), sub.id)).toContain("the boats");
    expect((await payReview(dev.cookie, sub.id, "10.00")).status).toBe(200);
    await settle();
    expect((await sact(j.sessionId, "written-add", j.tester.cookie, { text: "the harbour at night", question: K2, seenAt: seen(), confirmed: true })).status).toBe(200);
    let html = await page(testId);
    const upd = updateRow(html, sub.id);
    expect(upd).toContain("the harbour at night");
    expect(upd).not.toContain("the boats"); // unchanged answers are left out
    expect(upd).not.toContain(`data-question-body="${K1}"`);
    expect(upd).toContain(`data-fold="update-pay-${sub.id}"`);
    expect(upd).toContain(">Pay</button>");
    expect(upd).not.toContain(">Pay more</button>");
    let row = testersRow(html, sub.id);
    expect(row).toContain("the boats");
    expect(row).not.toContain("the harbour at night");
    expect(row).toContain(">Pay more</button>");
    // Pay (Pay more's route, named Pay): the addition moves into the Testers list.
    const r = await act(testId, "pay-extra", dev.cookie, { contractId: j.sessionId, submissionId: sub.id, amount: "2.00", tickedCents: 200, note: "", payKey: randomUUID(), seenAt: seen(), confirmed: true, press: "Pay" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await settle();
    expect((await sact(j.sessionId, "written-add", j.tester.cookie, { text: "and the lighthouse", question: K1, seenAt: seen(), confirmed: true })).status).toBe(200);
    html = await page(testId);
    row = testersRow(html, sub.id);
    expect(row).toContain("the harbour at night");
    expect(row).not.toContain("and the lighthouse");
    const next = updateRow(html, sub.id);
    expect(next).toContain("and the lighthouse");
    expect(next).not.toContain("the harbour at night");
  });

  it("the press is named Pay from Needs you, Pay more from the Testers list (same route)", () => {
    expect(pressLabelOf("/api/tests/t1/pay-extra", { press: "Pay", submissionId: "s" })).toBe("Pay");
    expect(pressLabelOf("/api/tests/t1/pay-extra", { submissionId: "s" })).toBe("Pay more");
    const box = src("app/app/tests/[id]/PayBox.tsx");
    expect(box).toContain('...(p.moreLabel ? { press: p.moreLabel } : {})');
    expect(box).toContain('const pressName = !more || p.moreLabel === "Pay" ? "Pay" : "Pay more";');
  });
});

describe("§227 Pay what you owe never on the developer's test page", () => {
  it("no OwedBox on the test page; the links go to Payments' #owed (its anchor is OwedBox's own there)", () => {
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page).not.toContain("<OwedBox");
    expect(page).not.toContain('from "@/components/OwedBox"');
    expect(PAY_OWED_HREF).toBe("/app/payments#owed");
    expect(PAY_OWED_LINK).toBe("Pay what you owe on Payments");
    expect(src("components/OwedBox.tsx")).toContain('<div id="owed"');
    expect(src("app/app/payments/page.tsx")).toContain("<OwedBox ");
    expect(src("app/app/tests/[id]/PayBox.tsx")).not.toContain('href="#owed"');
  });

  it("the paused banner (a payment hold), the Pay boxes' line and every refusal about what's owed link there", async () => {
    const { TestBanner } = await import("@/app/app/tests/[id]/TestBanner");
    const banner = renderToStaticMarkup(h(TestBanner, { cause: "hold", allowed: "" }));
    expect(banner).toContain(`href="${PAY_OWED_HREF}"`);
    expect(banner).toContain(`data-pay-owed-link="" href="${PAY_OWED_HREF}">${PAY_OWED_LINK}</a>`);
    expect(renderToStaticMarkup(h(TestBanner, { cause: "team-paused", allowed: "" }))).not.toContain("data-pay-owed-link");
    const { Err } = await import("@/components/Err");
    const refusal = unescape(renderToStaticMarkup(h(Err, { text: "Pay what you owe first.", press: "Request a time" })));
    expect(refusal).toContain("Your Request a time didn't go through: Pay what you owe first.");
    expect(refusal).toContain(`href="${PAY_OWED_HREF}"`);
    expect(renderToStaticMarkup(h(Err, { text: "The team paused this test.", press: "Save" }))).not.toContain("data-pay-owed-link");
    const { PayBox } = await import("@/app/app/tests/[id]/PayBox");
    const box = renderToStaticMarkup(h(PayBox, { kind: "submission", id: "s1", name: "Ana Silva", listingCents: 1000, listingText: "$10.00 for written answers", seenAt: seen(), owes: true }));
    expect(box).toContain('data-owes-note="">Pay what you owe first. <a');
    expect(box).toContain(`href="${PAY_OWED_HREF}"`);
  });

  it("owing before any pause: the test page shows one line linking to Payments, not the box", async () => {
    const { dev, testId } = await setup();
    await db.payment.create({ data: { kind: "review", developerId: dev.user.id, testerId: dev.user.id, amountCents: 900, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(Date.now() + 86_400_000), failure: "card_declined" } });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: dev.user.id } });
    const html = unescape(renderToStaticMarkup(await (await import("@/app/app/tests/[id]/page")).default({ params: Promise.resolve({ id: testId }), searchParams: Promise.resolve({}) })));
    expect(html).not.toContain('id="owed"');
    expect(html).toContain("data-owed-on-payments");
    expect(html).toContain(`href="${PAY_OWED_HREF}"`);
  });
});
