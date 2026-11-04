import { readFileSync } from "node:fs";
import path from "node:path";
import React, { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { clampPanel, PANEL_MIN_PX, ResizeBox } from "@/components/Panel";
import { LIST_PANEL, PAST_CALLS_SHOWN, PAY_LINES_SHOWN, PanelWhen, PayLinesBox, TESTERS_CALLS_TALLEST } from "@/components/ScrollList";
import { PartPayments } from "@/components/PartPayments";
import { partPaymentLines, partPayStatus, type PartPayLine } from "@/lib/server/partPayments";
import { paidRows } from "@/lib/server/paymentRows";
import { fmtDateTimeIn } from "@/lib/format";
import { bringInView } from "@/lib/markJump";
import { noQuestionsLine, questionMatches, QuestionSearch } from "@/app/app/tests/[id]/QuestionSearch";
import { ByQuestion, questionKey } from "@/app/app/tests/[id]/ByQuestion";
import { joined, sact, settle, setup } from "./fixtures";

// (Owner, Nov 3, batch 35 §152) "Do call requests and booked calls have scrolls (with expand) — have the expand for the payment lists we just mentioned too." Every
// call list and payment list sits in the §139 draggable panel (ResizeBox: scrolls inside, a grip drags it shorter or taller, the height kept by its id); under each
// part on the developer's test page, that part's payments (Payments' "What you've paid" lines). And "By question": a search, the list in a panel, each question a fold.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tests/test", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("§152: every call list in the draggable panel, with a stable id", () => {
  it("call requests, booked calls (both sides, the paused view), the testers' calls, the dashboards' calls, past calls", () => {
    const checks: [string, string][] = [
      ["components/CallRequestsPanel.tsx", '<ResizeBox id={panelId} label="Call requests" defaultMax={LIST_PANEL.requests}>'],
      ["app/app/tests/[id]/CallRequestsBox.tsx", "panelId={`call-requests-${testId}`}"], // (§181) the box of its own
      ["components/CallRequests.tsx", 'panelId={`call-requests-${p.path.split("/").filter(Boolean).pop() ?? ""}`}'],
      ["app/app/tests/[id]/DevCallPanel.tsx", "<ResizeBox id={`booked-${t.contractId}`} label={`Booked calls with ${t.name}`} defaultMax={LIST_PANEL.booked}>"],
      ["app/app/tests/[id]/DevCallPanel.tsx", "<ResizeBox id={`testers-calls-${testId}`} label=\"Testers' calls\" defaultMax={LIST_PANEL.testersCalls} tallest={TESTERS_CALLS_TALLEST}>"],
      ["app/app/tests/[id]/RestrictedCalls.tsx", "<ResizeBox id={person ? `booked-restricted-${testId}-${person}` : `booked-restricted-${testId}`} label=\"Booked calls\" defaultMax={LIST_PANEL.restricted}>"],
      ["app/app/CallsBox.tsx", '<ResizeBox id="dash-calls" label="Calls" defaultMax={LIST_PANEL.dashCalls}>'],
      ["app/app/page.tsx", '<ResizeBox id="dash-upcoming-calls" label="Upcoming calls" defaultMax={LIST_PANEL.dashCalls}>'],
      ["app/app/sessions/[id]/TesterCallPanel.tsx", "panel={`booked-${p.sessionId}`} panelMax={LIST_PANEL.testerBooked}"],
      ["app/app/tests/[id]/page.tsx", "<PanelWhen on={overCalls.length > PAST_CALLS_SHOWN} id={`past-calls-${c.id}`}"],
      ["app/app/sessions/[id]/page.tsx", "<PanelWhen on={overCalls.length > PAST_CALLS_SHOWN} id={`past-calls-${c.id}`}"],
      ["app/app/sessions/[id]/page.tsx", "<PayLinesBox id={id} count={1 + extras.length + (update ? 1 : 0)}>"],
      ["app/app/tests/[id]/ByQuestion.tsx", "<ResizeBox id={`by-question-${testId}-${key}`}"],
      ["app/app/tests/[id]/QuestionSearch.tsx", "<ResizeBox id={`by-question-${testId}`} label=\"Questions\" defaultMax={LIST_PANEL.questions}>"],
    ];
    for (const [f, s] of checks) expect(src(f), f).toContain(s);
    // No fixed-height scroll boxes left on these lists.
    expect(src("components/CallRequestsPanel.tsx")).not.toContain("max-h-80");
    expect(src("app/app/tests/[id]/DevCallPanel.tsx")).not.toMatch(/max-h-40|max-h-\[200vh\]/);
    expect(src("app/app/tests/[id]/RestrictedCalls.tsx")).not.toContain("max-h-72");
    expect(src("app/app/CallsBox.tsx")).not.toContain("<ScrollList");
  });

  it("each starts at its old height (never past 60% of the screen), and the grip drags it from about 3 lines up to 60% (the testers' list: up to 2 screens)", () => {
    expect(LIST_PANEL).toMatchObject({ requests: "min(20rem, 60vh)", booked: "min(10rem, 60vh)", restricted: "min(18rem, 60vh)", dashCalls: "min(14rem, 60vh)", pastDeveloper: "min(27rem, 60vh)", pastTester: "min(16rem, 60vh)", payLines: "7rem" });
    const html = render(h(ResizeBox, { id: "call-requests-t1", label: "Call requests", defaultMax: LIST_PANEL.requests, children: h("ul", null, h("li", null, "a request")) }));
    expect(html).toContain('data-panel="call-requests-t1"');
    expect(html).toContain("max-height:min(20rem, 60vh)");
    expect(html).toContain("data-panel-grip");
    expect(clampPanel(10, 800)).toBe(PANEL_MIN_PX);
    expect(clampPanel(5000, 800)).toBe(480);
    expect(clampPanel(5000, 800, TESTERS_CALLS_TALLEST)).toBe(1600);
    expect(src("components/Panel.tsx")).toContain("style={height != null ? { height, maxHeight: `${tallest * 100}vh` } : { maxHeight: defaultMax }}");
  });

  it("past calls and the tester's payment lines: a panel only when long (more than 3 calls, more than 4 lines)", () => {
    expect(PAST_CALLS_SHOWN).toBe(3);
    const list = h("ul", null, h("li", null, "a call"));
    expect(render(h(PanelWhen, { on: false, id: "past-calls-c1", label: "Calls", children: list }))).not.toContain("data-panel");
    expect(render(h(PanelWhen, { on: true, id: "past-calls-c1", label: "Calls", defaultMax: LIST_PANEL.pastDeveloper, children: list }))).toContain("max-height:min(27rem, 60vh)");
    const lines = (n: number) => Array.from({ length: n }, (_, i) => h("p", { key: i }, `Extra $${i + 1}.00`));
    expect(render(h(PayLinesBox, { id: "s1", count: 5, children: lines(5) }))).toContain('data-panel="paylines-s1"');
    expect(render(h(PayLinesBox, { id: "s1", count: PAY_LINES_SHOWN, children: lines(4) }))).not.toContain("data-panel");
  });
});

describe("§152: each part's payments on the developer's test page", () => {
  const line = (i: number, over: Partial<PartPayLine> = {}): PartPayLine => ({ id: `p${i}`, what: "Ana Silva's written answers on “Harbor Run”", full: "Ana Silva's written answers on “Harbor Run”", how: "", when: "Oct 30, 2026, 2:00 PM", amount: "$10.00", status: "", ...over });

  it("the status words are the ones the developer already sees (Payments, Pay what you owe, Confirm with your bank)", () => {
    expect(partPayStatus({ status: "charged" })).toBe("");
    expect(partPayStatus({ status: "needs_confirmation" })).toBe("waiting for your bank");
    expect(partPayStatus({ status: "failed" })).toBe("card declined");
    expect(partPayStatus({ status: "not_set_up" })).toBe("recorded (payments not set up)");
    expect(partPayStatus({ status: "charged" }, { reversed: true, reversedCents: null })).toBe("your bank reversed this (chargeback)");
    expect(partPayStatus({ status: "charged" }, { reversed: true, reversedCents: 9600 })).toBe("your bank reversed $96.00 of this (chargeback)");
    // The same words as Payments' "What you've paid" list (so the two can't drift apart unnoticed).
    const payments = src("app/app/payments/page.tsx");
    for (const w of ["recorded (payments not set up)", "refunded (your bank's chargeback was reversed)", "your bank reversed this (chargeback)", "of this (chargeback)"]) expect(payments).toContain(w);
  });

  it("4 lines: a plain list; 5: the panel (kept by the part's id); none: nothing", () => {
    const four = unescape(render(h(PartPayments, { id: "s1", lines: [1, 2, 3, 4].map((i) => line(i)) })));
    expect(four).toContain('data-part-pay-list="plain"');
    expect(four).not.toContain("data-panel");
    expect(four.match(/data-part-pay="/g)).toHaveLength(4);
    const five = unescape(render(h(PartPayments, { id: "s1", lines: [1, 2, 3, 4, 5].map((i) => line(i)) })));
    expect(five).toContain('data-panel="part-pays-s1"');
    expect(five).toContain("max-height:min(12rem, 40vh)");
    expect(five).toContain('data-part-pay-list="panel"');
    expect(render(h(PartPayments, { id: "s1", lines: [] }))).toBe("");
  });

  it("a part with a Pay, 2 Pay mores and a team decision: 4 lines in Payments' words, oldest first; a 5th (waiting for the bank) makes it a panel, on the page", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva");
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["answer", "answer"] });
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    let at = Date.now() - 10 * 86_400_000;
    const pay = (kind: string, amountCents: number, status = "charged") =>
      db.payment.create({ data: { kind, amountCents, status, contractId: j.sessionId, submissionId: sub.id, developerId: s.dev.user.id, testerId: j.tester.user.id, feeCents: 0, testerCents: 0, createdAt: new Date((at += 86_400_000)) } });
    const made = [await pay("review", 1000), await pay("extra", 300), await pay("extra", 200), await pay("dispute", 150)];
    // Never listed: one still being sent, one cancelled (nothing charged), Pay what you owe's own record.
    await pay("extra", 999, "pending");
    await pay("extra", 998, "cancelled");
    const when = (d: Date) => fmtDateTimeIn(d, null);
    const all = () => db.payment.findMany({ where: { contractId: j.sessionId } });
    const lines = (await partPaymentLines(await all(), when)).get(sub.id)!;
    expect(lines.map((l) => l.id)).toEqual(made.map((p) => p.id));
    // The same "what" as Payments' "What you've paid" (paidRows, developer side).
    const rows = await paidRows(made, "developer");
    expect(lines.map((l) => l.what)).toEqual(made.map((p) => rows.get(p.id)!.what));
    expect(lines[1].what).toMatch(/^Pay more for /);
    expect(lines[3].what).toMatch(/^The team's dispute decision on /);
    expect(lines.map((l) => l.amount)).toEqual(["$10.00", "$3.00", "$2.00", "$1.50"]);
    expect(lines[0].when).toBe(when(made[0].createdAt));
    expect(lines.every((l) => l.status === "")).toBe(true);
    expect(render(h(PartPayments, { id: sub.id, lines }))).toContain('data-part-pay-list="plain"');
    // A 5th: a Pay more waiting for the bank.
    const waiting = await pay("extra", 500, "needs_confirmation");
    const five = (await partPaymentLines(await all(), when)).get(sub.id)!;
    expect(five.at(-1)).toMatchObject({ id: waiting.id, amount: "$5.00", status: "waiting for your bank" });
    // On the developer's test page: under the part, in a panel. (The page settles a payment stuck "pending" with no charge as declined, so that row goes first.)
    await db.payment.deleteMany({ where: { submissionId: sub.id, status: "pending" } });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } });
    const { default: TestPage } = await import("@/app/app/tests/[id]/page");
    const html = unescape(render(await TestPage({ params: Promise.resolve({ id: s.testId }), searchParams: Promise.resolve({}) })));
    expect(html).toContain(`data-part-payments="${sub.id}"`);
    expect(html).toContain(`data-panel="part-pays-${sub.id}"`);
    expect(html).toContain("$5.00</span> · waiting for your bank");
    const part = html.slice(html.indexOf(`data-part-payments="${sub.id}"`), html.indexOf("</ul>", html.indexOf(`data-part-payments="${sub.id}"`)));
    expect(part.match(/data-part-pay="/g)).toHaveLength(5);
    expect(part).not.toContain("$9.98"); // the cancelled one isn't listed
  });
});

describe("§152: By question — search, the list in a panel, each question a fold", () => {
  it("the search matches anywhere in the question, any case; nothing matching says so", () => {
    expect(questionMatches("Where did you get stuck?", "STUCK")).toBe(true);
    expect(questionMatches("Other notes", "notes")).toBe(true);
    expect(questionMatches("What did you like?", "stuck")).toBe(false);
    expect(questionMatches("What did you like?", "  ")).toBe(true);
    expect(noQuestionsLine("zzz ")).toBe("No questions match “zzz”.");
    const html = unescape(render(h(QuestionSearch, { testId: "t1", items: [{ key: "a", title: "Where did you get stuck?", node: h("p", null, "A") }] })));
    expect(html).toContain('placeholder="Search questions"');
    expect(html).toContain('data-panel="by-question-t1"');
    expect(html).toContain(">Open all<");
    expect(html).toContain(">Close all<");
  });

  it("each question: a fold closed at first (the question, required, N answers); open, its answers in their own panel", () => {
    const at = new Date("2026-10-20T10:00:00Z");
    const answer = (contractId: string, text: string) => ({ contractId, tester: "Ana Silva", text, sentAt: at, status: "waiting" as const, paidCents: 0 });
    const html = unescape(render(h(ByQuestion, { testId: "t1", blocks: [
      { title: "Where did you get stuck?", required: true, answers: [answer("c1", "the bridge"), answer("c2", "the cave")] },
      { title: "Other notes", required: false, answers: [answer("c1", "fun")] },
    ] })));
    const k = questionKey("Where did you get stuck?");
    expect(html).toMatch(new RegExp(`<details class="group/fold [^"]*" data-fold="bq-t1-${k}"`)); // no open="": closed at first
    expect(html).not.toContain(`<details open="" class="group/fold " data-fold="bq-t1-${k}"`);
    expect(html).toContain(`data-panel="by-question-t1-${k}"`);
    expect(html).toContain("data-required");
    expect(html).toContain("2 answers");
    expect(html).toContain("1 answer<");
    expect(questionKey("Where did you get stuck?")).toBe(k); // stable
    expect(questionKey("Other notes")).not.toBe(k);
  });
});

// (Owner, Nov 4, §179) "Scroll box needed for different charges": the tester's "Live call: N done" lists every call with its payment box; more than 3 sit in the
// draggable panel (`live-calls-<sessionId>`, about 3 calls tall at first), like past calls. The developer's "Calls (N)" was already a panel past 3 (§152).
describe("§179: the tester's Live call list in the draggable panel past 3 calls", () => {
  it("the page wraps both kinds of rows (done and not yet paid, paid) in PanelWhen with the session's id; the developer's Calls (N) is already one", () => {
    expect(LIST_PANEL.liveTester).toBe("min(27rem, 60vh)");
    const page = src("app/app/sessions/[id]/page.tsx");
    expect(page).toContain("<PanelWhen on={liveRowCount > PAST_CALLS_SHOWN} id={`live-calls-${c.id}`} label=\"Live calls and their payments\" defaultMax={LIST_PANEL.liveTester}>");
    expect(page).toContain("const liveRowCount = unpaidLive.length + paidLive.length;");
    expect(src("app/app/tests/[id]/page.tsx")).toContain("<PanelWhen on={overCalls.length > PAST_CALLS_SHOWN} id={`past-calls-${c.id}`} label={`Calls with ${name}`} defaultMax={LIST_PANEL.pastDeveloper}>");
  });

  it("a notice inside a panel: the panel scrolls to it first, then the page (the least scrolling)", () => {
    const scrolled: number[] = [];
    const g = globalThis as unknown as { window?: unknown };
    const had = g.window;
    g.window = { innerHeight: 800, scrollBy: ({ top }: { top: number }) => scrolled.push(top) };
    try {
      // The panel shows 300–500 on the screen; the notice sits at 600–640 inside it (scrolled out of the panel's view).
      const box = { scrollTop: 50, getBoundingClientRect: () => ({ top: 300, bottom: 500 }) };
      let shift = 0;
      Object.defineProperty(box, "scrollTop", { get: () => 50 + shift, set: (v: number) => void (shift = v - 50) });
      const el = { closest: (q: string) => (q === "[data-panel-box]" ? box : null), previousElementSibling: null, getBoundingClientRect: () => ({ top: 600 - shift, bottom: 640 - shift }) };
      bringInView(el as unknown as HTMLElement);
      expect(shift).toBe(140); // its bottom at the panel's bottom
      expect(scrolled).toEqual([]); // then on the screen already: the page doesn't move
      // Not in a panel: as before (the page only).
      const plain = { closest: () => null, previousElementSibling: null, getBoundingClientRect: () => ({ top: 900, bottom: 950 }) };
      bringInView(plain as unknown as HTMLElement);
      expect(scrolled).toEqual([162]);
    } finally {
      g.window = had;
    }
  });

  it("on the tester's page: 3 paid calls are a plain list; a 4th makes it the panel (each row's hooks kept)", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva");
    await settle();
    const DAY = 86_400_000;
    const call = async (i: number) => {
      const startsAt = new Date(Date.now() - (10 - i) * DAY);
      const slot = await db.callSlot.create({ data: { testId: s.testId, startsAt, minutes: 30, allowedTesterIds: [], status: "booked" } });
      const x = await db.call.create({ data: { slotId: slot.id, contractId: j.sessionId, startsAt, minutes: 30, rateCents: 3100, actualMinutes: 30 } });
      await db.review.create({ data: { callId: x.id, contractId: j.sessionId, amountCents: 1550, agreedCents: 1550, rateCents: 3100, payKey: "k-" + x.id } });
      return x;
    };
    for (const i of [1, 2, 3]) await call(i);
    auth.user = await db.user.findUniqueOrThrow({ where: { id: j.tester.user.id } });
    const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
    const page = async () => unescape(render(await SessionPage({ params: Promise.resolve({ id: j.sessionId }) })));
    const three = await page();
    expect(three).toContain('data-live-calls="3"');
    expect(three).not.toContain(`data-panel="live-calls-${j.sessionId}"`);
    await call(4);
    const four = await page();
    expect(four).toContain(`data-panel="live-calls-${j.sessionId}"`);
    const panel = four.slice(four.indexOf(`data-panel="live-calls-${j.sessionId}"`));
    expect(panel).toContain("max-height:min(27rem, 60vh)");
    expect(panel).toContain('data-live-calls="4" data-live-calls-scroll="4"');
    const inside = panel.slice(0, panel.indexOf("data-panel-grip"));
    expect(inside.match(/data-call-row=""/g)).toHaveLength(4);
    expect(inside.match(/Paid \$15\.50/g)).toHaveLength(4);
    // Still inside the Live call part (#part-live links land on it).
    expect(four.indexOf('id="part-live"')).toBeLessThan(four.indexOf(`data-panel="live-calls-${j.sessionId}"`));
  });
});
