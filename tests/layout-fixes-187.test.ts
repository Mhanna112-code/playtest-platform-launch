import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as React from "react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { InsidePanel, ResizeBox } from "@/components/Panel";
import { ScrollList, LIST_PANEL } from "@/components/ScrollList";
import { LongText, QuestionTitle } from "@/components/LongText";
import { NameLink } from "@/components/Cut";
import { SentWork } from "@/components/SentWork";
import { SetView } from "@/components/AnswerSets";
import { RestrictedCalls } from "@/app/app/tests/[id]/RestrictedCalls";
import { PersonHover } from "@/components/PersonHover";
import { hoverShift } from "@/components/HoverFit";
import { NavMenu } from "@/components/NavMenu";
import { CallRequestsPanel, goneLineFor, OTHER_TIME_BOOKED_LINE, timeRows, type PanelReq } from "@/components/CallRequestsPanel";
import { acceptChoices, describeRows } from "@/components/RequestRows";
import { callsTaken, OTHER_TIME_BOOKED, TIME_GONE } from "@/lib/server/requests";
import { act, atHours, joined, oldChooseOne, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 4, §187) The layout fixes found by the Nov 4 screenshot run, and the two server fixes (the tester's Charge refusals; a "one of" request as one row per time).

vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams() }));
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const render = (el: React.ReactElement) => renderToStaticMarkup(el);
const count = (s: string, sub: string) => s.split(sub).length - 1;
const LONG = "I opened the map right after the tutorial and the wind arrows are drawn in almost the same blue as the shallow water. ".repeat(20);
const LONG_Q = "When you first opened the harbor map and tried to plan a route through the three outer islands, which parts of the legend did you understand right away and which ones did you have to guess at, step by step, including the tide markers and the wind arrows? ".repeat(2);

describe("§187 items 1 and 2: only the outermost panel scrolls", () => {
  it("a panel inside a panel is plain: no scroll box, no grip, no border or padding; the outer one keeps its box and its one grip", () => {
    const html = render(h(ResizeBox, { id: "outer", label: "Needs you" }, h(ResizeBox, { id: "inner", label: "Ana: Needs you" }, h(ResizeBox, { id: "answers", label: "Written answers" }, "text"))));
    expect(count(html, "data-panel-box")).toBe(1);
    expect(count(html, "data-panel-grip")).toBe(1);
    expect(html).toMatch(/<div class="min-w-0 space-y-2 " data-panel="inner" data-panel-flat="" aria-label="Ana: Needs you">/);
    expect(html).toMatch(/data-panel="answers" data-panel-flat=""/);
    // Alone, a panel is the draggable box as before.
    expect(render(h(ResizeBox, { id: "alone", label: "x" }, "y"))).toContain("data-panel-grip");
  });
  it("a scroll list (ScrollList) counts as the outer panel too", () => {
    // (Owner, Nov 5, §237) The list is the draggable panel itself: its one grip; the panel inside it is plain.
    const html = render(h(ScrollList, { as: "div", children: null }, h(ResizeBox, { id: "in-list", label: "Calls" }, "c")));
    expect(html).toContain('data-panel-flat=""');
    expect(count(html, "data-panel-grip")).toBe(1);
    expect(render(h(InsidePanel, null, h(ResizeBox, { id: "x", label: "x" }, "y")))).toContain('data-panel-flat=""');
  });
  it("Show more inside a panel opens the text inline (no 8-line box of its own); outside any panel it keeps the box", () => {
    const lt = src("components/LongText.tsx");
    expect(lt).toContain('inPanel ? <div className="break-words [overflow-wrap:anywhere]" data-fold-open="inline">{body}</div> : <ResizeBox id={panelId} label={label} defaultMax={FOLD_TEXT_OPEN}>{body}</ResizeBox>');
    // Folded, it is the same inside or outside a panel: 3 lines + Show more.
    const inside = render(h(ResizeBox, { id: "p", label: "Written answers" }, h(LongText, { text: LONG, label: "Answer" })));
    expect(inside).toContain('data-fold-text="closed"');
    expect(inside).toContain(">Show more</button>");
  });
  it("Needs you's levels indent at most 8px on a phone", () => {
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page).toContain('<div key={x.id} id={anchor} className="rounded-lg border border-white/10 p-2 scroll-mt-24 sm:p-3">');
    expect(page).toContain('className="rounded-lg border border-white/10 p-2 scroll-mt-24 sm:p-3" data-update-row={x.id}>');
    expect(page).not.toMatch(/border-white\/10 p-3 (text-sm|scroll-mt-24)/);
    expect(src("components/SentWork.tsx")).toContain('className="space-y-2 border-l border-white/10 pl-2 sm:pl-3" data-question-body={t.key}');
  });
});

describe("§187 item 3: names are cut only when the row is full", () => {
  const NAME = "Maximiliana Alexandrovna Konstantinopoulou-Featherstonehaugh";
  it("a fitted name is drawn whole, cut by CSS on the width it has (no 12-character cut)", () => {
    const html = render(h(NameLink, { fit: true, text: NAME, href: "/app/testers/t1" }));
    expect(html).toBe(`<a href="/app/testers/t1" class="relative z-10 inline-block min-w-0 max-w-full align-bottom " data-name-link="person"><span class="inline-block min-w-0 max-w-full truncate align-bottom " data-cut-fit="person">${NAME}</span></a>`);
    expect(html).not.toContain("…");
    // Not fitted: the old 12-character cut stays wherever it isn't asked for.
    expect(render(h(NameLink, { text: NAME, href: "/app/testers/t1" }))).toContain("…");
  });
  it("Needs you's people, the call request boxes and the testers' calls cards use it, in rows that may shrink", () => {
    expect(src("app/app/tests/[id]/page.tsx")).toContain('<span className="flex min-w-0 flex-1 items-baseline gap-1"><span className="min-w-0" data-needs-person-name=""><NameLink fit text={p.name} href={p.href} /></span>');
    expect(src("components/CallRequestsPanel.tsx")).toContain('<span className="min-w-0"><NameLink fit text={p.name} href={p.href} /></span>');
    const calls = src("app/app/tests/[id]/DevCallPanel.tsx");
    expect(calls.match(/<span className="mr-auto min-w-0"><NameLink fit text=\{t.name\}/g)!.length).toBe(2);
    expect(calls).toContain('<fieldset className="max-h-48 min-w-0 space-y-1');
  });
});

describe("§187 item 4: the testers' calls panel starts about 3.5 cards tall", () => {
  it("min(37rem, 80vh) (was min(28rem, 70vh), about 2.5 cards)", () => {
    expect(LIST_PANEL.testersCalls).toBe("min(37rem, 80vh)");
  });
});

describe("§187 item 5: the held view's booked calls inside a person's drop-down don't repeat the name", () => {
  const calls = [{ id: "c1", who: "Ana Silva", whoHref: "/app/testers/a", when: new Date(Date.now() + 86_400_000).toISOString(), minutes: 30, needsReason: false }];
  it("in the person's own drop-down: time · length; on its own: time · name · length", () => {
    const own = render(h(RestrictedCalls, { testId: "t", seenAt: seen(), calls, embedded: true, person: "k1" }));
    expect(own).not.toContain("Ana Silva</");
    expect(own).toMatch(/ · 30 min<\/span>/);
    expect(render(h(RestrictedCalls, { testId: "t", seenAt: seen(), calls }))).toContain("Ana Silva</span></a> · 30 min");
  });
});

// (Owner, Nov 5, §223) Item 6's title Show more is gone where a question is shown with its answer (SentWork, By question, the previous sets): the title is cut at
// 2 lines by CSS and the whole question is the first box inside (components/QA.tsx). QuestionTitle and the answer form's inline Show more stay.
describe("§187 item 6, after §223: the question title is cut at 2 lines; the whole question is its own box inside", () => {
  it("in the question fold's title (the summary): no Show more; inside, the question's box comes before the answer", () => {
    const html = render(h(SentWork, { kind: "written", answers: [LONG], questions: [LONG_Q], notes: "", additions: [], files: [] }));
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
    expect(summary).toContain('class="line-clamp-2 min-w-0 flex-1 basis-40 text-slate-200 [overflow-wrap:anywhere]" data-question-title=""');
    expect(summary).not.toContain("data-question-more");
    const body = html.slice(html.indexOf("data-question-body"));
    expect(body.indexOf("data-set-question")).toBeLessThan(body.indexOf('data-set-answer=""'));
    expect(body).not.toContain("Show more");
  });
  it("a short question has no button (QuestionTitle, still exported); By question cuts its title the same way", () => {
    expect(render(h(QuestionTitle, { text: "Short?" }))).not.toContain("<button");
    expect(src("app/app/tests/[id]/ByQuestion.tsx")).toContain('data-question-title="">{b.title}</span>');
  });
  it("a question shown above its answer (earlier sets): its own box; the answer form keeps Show more beside its last line", () => {
    const html = render(h(SetView, { items: [{ question: LONG_Q, answer: "an answer", required: false }] } as never));
    expect(html).toContain('data-qa="question"');
    expect(html).not.toContain("data-fold-toggle");
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).toContain("<LongText inline text={qText(q)}");
  });
});

describe("§187 item 7: hover cards never widen the page", () => {
  it("hidden cards are not drawn (display: none, not just invisible) until hover or focus", () => {
    const html = render(h(PersonHover, { name: "Nora Lane", href: "/app/developers/d", summary: ["Rated 4.8"] }));
    expect(html).toMatch(/role="tooltip" class="hidden absolute left-0 top-full z-40 mt-2 w-80 max-w-\[calc\(100vw-2rem\)\][^"]*group-focus-within:block group-hover:block" data-hover-card=""/);
    expect(html).not.toContain("invisible");
    for (const f of ["app/app/tests/[id]/TestersJoined.tsx", "components/Ui.tsx"]) {
      expect(src(f)).toContain('data-hover-card=""');
      expect(src(f)).not.toContain("group-hover:visible");
    }
    expect(src("app/layout.tsx")).toContain("<HoverFit />");
  });
  it("a shown card that would pass the right edge moves left to fit (8px from the edge, never past the left one)", () => {
    expect(hoverShift({ left: 40, right: 360 }, 375)).toBe(0);
    expect(hoverShift({ left: 60, right: 380 }, 375)).toBe(13);
    expect(hoverShift({ left: 10, right: 400 }, 375)).toBe(2);
  });
});

describe("§187 item 8: on a phone the header's links fold into one Menu button", () => {
  it("Menu (below 640px only) is a disclosure for the same links; a dot while Messages has unread; from 640px up the links as before", () => {
    const html = render(h(NavMenu, { messages: 2, children: null }, h("a", { href: "/app", className: "nav-link" }, "Dashboard"), h("a", { href: "/app/messages", className: "nav-link" }, "Messages")));
    expect(html).toMatch(/<button type="button" class="nav-link relative border border-white\/10 sm:hidden" aria-expanded="false" aria-controls="[^"]+" data-nav-menu-button="">/);
    expect(html).toContain("Menu");
    expect(html).toContain('data-nav-menu-dot="2"');
    expect(html).toContain('<span class="sr-only">, 2 unread messages</span>');
    expect(html).toMatch(/data-nav-links="" class="hidden sm:static sm:mt-0 sm:flex /);
    expect(html).toContain('href="/app/messages"');
    expect(render(h(NavMenu, { messages: 0, children: null }, "x"))).not.toContain("data-nav-menu-dot");
    const layout = src("app/app/layout.tsx");
    expect(layout).toContain("<NavMenu messages={off ? 0 : unreadChats}>");
    // The bell, the account and sign-out stay in the header.
    expect(layout.indexOf("<BellLink unread={unread} />")).toBeGreaterThan(layout.indexOf("</NavMenu>"));
    const menu = src("components/NavMenu.tsx");
    for (const s of ['e.key === "Escape"', "useEffect(() => setOpen(false), [path]);", '.closest("a")) setOpen(false)', '"pointerdown", outside']) expect(menu).toContain(s);
  });
});

// ---------- item 9: the tester's Charge refusals ----------
async function charged(kind: "written" | "call") {
  const s = await setup({ writtenCents: "10.00" });
  const j = await joined(s.testId);
  if (kind === "written") {
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["answer", "answer"] });
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    return { ...s, ...j, where: { submissionId: sub.id }, body: { submissionId: sub.id } };
  }
  const at = new Date(Date.now() - 3 * 86_400_000);
  const slot = await db.callSlot.create({ data: { testId: s.testId, startsAt: at, minutes: 30, allowedTesterIds: [j.tester.user.id], status: "booked" } });
  const call = await db.call.create({ data: { slotId: slot.id, contractId: j.sessionId, startsAt: at, minutes: 30, rateCents: null, status: "booked" } });
  return { ...s, ...j, where: { callId: call.id }, body: { callId: call.id }, at };
}
const payment = (f: Awaited<ReturnType<typeof charged>>, kind: string, cents: number, status: string) =>
  db.payment.create({ data: { kind, contractId: f.sessionId, developerId: f.dev.user.id, testerId: f.tester.user.id, amountCents: cents, feeCents: 0, testerCents: 0, status, actionBy: new Date(Date.now() + 2 * 86_400_000), payKey: randomUUID(), ...f.where } });
const choose = (f: Awaited<ReturnType<typeof charged>>, choice = "charge") => sact(f.sessionId, "choose", f.tester.cookie, { ...f.body, choice, seenAt: seen(), confirmed: true });

describe("§187 item 9: the tester's Charge refusals", () => {
  it("(a) her own Charge waiting for the developer's bank: \"You already charged $10.00 for your written answers. It's waiting for Nora Lane's bank.\"", async () => {
    const f = await charged("written");
    await db.review.create({ data: { ...f.where, contractId: f.sessionId, amountCents: 1000, reason: R.CHARGED_BY_TESTER, payKey: randomUUID() } });
    await payment(f, "review", 1000, "needs_confirmation");
    for (const choice of ["charge", "letgo"]) {
      const r = await choose(f, choice);
      expect(r.status).toBe(409);
      expect(r.body.error.message).toBe("You already charged $10.00 for your written answers. It's waiting for Nora Lane's bank.");
    }
  });
  it("(a) a call: \"… for your call on <date/time>. …\"", async () => {
    const f = await charged("call");
    await db.review.create({ data: { ...f.where, contractId: f.sessionId, amountCents: 1550, reason: R.CHARGED_BY_TESTER, payKey: randomUUID() } });
    await payment(f, "call", 1550, "needs_action");
    const r = await choose(f);
    expect(r.body.error.message).toMatch(/^You already charged \$15\.50 for your call on .+\. It's waiting for Nora Lane's bank\.$/);
  });
  it("(b) the developer paid anything: the final refusal, even while another payment of theirs on it is at the bank (paid-anything wins)", async () => {
    const f = await charged("written");
    await db.review.create({ data: { ...f.where, contractId: f.sessionId, amountCents: 600, reason: "", payKey: randomUUID() } });
    await payment(f, "review", 600, "charged");
    await payment(f, "extra", 200, "needs_confirmation");
    const r = await choose(f);
    expect(r.status).toBe(409);
    expect(r.body.error.message).toBe(R.paidMeanwhileLine("Nora Lane", 600));
    expect(r.body.error.message).not.toBe(R.PIECE_LOCKED);
  });
  it("(c) nothing paid yet and the developer's first Pay at the bank: \"being confirmed\" (as before)", async () => {
    const f = await charged("written");
    await payment(f, "review", 1000, "needs_confirmation");
    expect((await choose(f)).body.error.message).toBe(R.PIECE_LOCKED);
  });
});

// ---------- item 10: a "one of" request, one row per time ----------
const devAnswer = (testId: string, cookie: string, contractId: string, requestId: string, action: string, extra: Record<string, unknown> = {}) =>
  act(testId, "answer-request", cookie, { contractId, requestId, action, seenAt: seen(), confirmed: true, ...extra });
const testerAnswer = (sessionId: string, cookie: string, requestId: string, action: string, extra: Record<string, unknown> = {}) =>
  sact(sessionId, "answer-request", cookie, { requestId, action, seenAt: seen(), confirmed: true, ...extra });

describe("§187 item 10: a \"one of\" request is one row per time", () => {
  const ROWS = [
    { startsAt: new Date("2026-11-12T21:22:00Z").toISOString(), repeat: "once" as const, count: 1 },
    { startsAt: new Date("2026-11-19T21:22:00Z").toISOString(), repeat: "once" as const, count: 1 },
    { startsAt: new Date("2026-11-14T18:22:00Z").toISOString(), repeat: "once" as const, count: 1 },
  ];
  const req = (mine: boolean): PanelReq => ({ id: "r1", contractId: "c1", tester: "Ana Silva", testerHref: "/app/testers/a", asker: mine ? "you" : "Ana Silva", rows: ROWS, minutes: 30, mine, rate: "Contract $31/h" });
  it("each time its own row with its own buttons; no \"one of:\", no \"asked by\"; Accept never names a time", () => {
    const theirs = render(h(CallRequestsPanel, { side: "developer", seenAt: seen(), requests: [req(false)], path: () => "/api/tests/t", panelId: "call-requests-t" }));
    expect(count(theirs, "<li ")).toBe(3);
    expect(count(theirs, ">Accept</button>")).toBe(3);
    expect(count(theirs, ">Decline</button>")).toBe(3);
    expect(theirs).not.toMatch(/one of|asked by|Accept [A-Z]/);
    expect(theirs).toContain(" · 30 min · Contract $31/h");
    // In time order; the request's anchor on its first row.
    const times = [...theirs.matchAll(/data-request-time="([^"]+)"/g)].map((m) => m[1]);
    expect(times).toEqual([ROWS[0].startsAt, ROWS[2].startsAt, ROWS[1].startsAt]);
    expect(count(theirs, 'id="req-r1"')).toBe(1);
    const yours = render(h(CallRequestsPanel, { side: "developer", seenAt: seen(), requests: [req(true)], path: () => "/api/tests/t", panelId: "your-requests-t" }));
    expect(count(yours, ">Withdraw</button>")).toBe(3);
    expect(yours).not.toMatch(/one of|asked by/);
    expect(timeRows(ROWS).map((x) => x.accept)).toEqual(["Accept", "Accept", "Accept"]);
    // A label that still names a time names its date ("Accept Thu 4:22 PM" twice was the bug).
    const labels = acceptChoices(ROWS).map((x) => x.label);
    expect(new Set(labels).size).toBe(3);
    for (const l of labels) expect(l).toMatch(/^Accept [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, /);
    expect(describeRows(ROWS)).not.toContain("one of");
  });
  it("once booked at one time, that row reads Booked and the other times' rows \"Another time of this request was booked\"", () => {
    const gone = { line: "Booked", bookedAt: ROWS[0].startsAt };
    expect(goneLineFor(gone, ROWS[0].startsAt)).toBe("Booked");
    expect(goneLineFor(gone, ROWS[1].startsAt)).toBe(OTHER_TIME_BOOKED_LINE);
    expect(goneLineFor({ line: "Withdrawn" }, ROWS[1].startsAt)).toBe("Withdrawn");
    expect(goneLineFor(undefined, ROWS[1].startsAt)).toBe("");
  });

  it("Decline on a row takes out just that time; the last one declines the request; still ONE request for the limit", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const T = [atHours(50), atHours(74), atHours(98)];
    await oldChooseOne(j.sessionId, "tester", T); // (§208) an older "one of" request still waiting (none is made now)
    const r = await db.callRequest.findFirstOrThrow({ where: { contractId: j.sessionId, status: "pending" } });
    expect(await callsTaken(j.sessionId)).toBe(1);
    const d1 = await devAnswer(s.testId, s.dev.cookie, j.sessionId, r.id, "decline", { time: T[1] });
    expect(d1.status).toBe(200);
    let now = await db.callRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(now.status).toBe("pending");
    expect(now.times.map((x) => x.toISOString())).toEqual([T[0], T[2]]);
    expect(await callsTaken(j.sessionId)).toBe(1);
    expect(await db.testEvent.count({ where: { testId: s.testId, kind: "declined_req" } })).toBe(1);
    // That time again (an older page): one refusal.
    expect((await devAnswer(s.testId, s.dev.cookie, j.sessionId, r.id, "decline", { time: T[1] })).body.error.message).toBe(TIME_GONE);
    expect((await devAnswer(s.testId, s.dev.cookie, j.sessionId, r.id, "accept", { time: T[1] })).body.error.message).toBe("Pick one of the times.");
    expect((await devAnswer(s.testId, s.dev.cookie, j.sessionId, r.id, "decline", { time: T[0] })).status).toBe(200);
    now = await db.callRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect([now.status, now.times.map((x) => x.toISOString())]).toEqual(["pending", [T[2]]]);
    // The last time: the whole request is declined.
    expect((await devAnswer(s.testId, s.dev.cookie, j.sessionId, r.id, "decline", { time: T[2] })).status).toBe(200);
    expect((await db.callRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("declined");
    expect(await callsTaken(j.sessionId)).toBe(0);
  });
  it("Withdraw on a row takes out just that time (the developer told by a bell); the last one withdraws it", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const T = [atHours(50), atHours(74)];
    await oldChooseOne(j.sessionId, "tester", T);
    const r = await db.callRequest.findFirstOrThrow({ where: { contractId: j.sessionId, status: "pending" } });
    expect((await testerAnswer(j.sessionId, j.tester.cookie, r.id, "withdraw", { time: T[0] })).status).toBe(200);
    expect((await db.callRequest.findUniqueOrThrow({ where: { id: r.id } })).times.map((x) => x.toISOString())).toEqual([T[1]]);
    expect(await db.notification.count({ where: { userId: s.dev.user.id, text: { contains: "withdrew a call request for" } } })).toBe(1);
    expect((await testerAnswer(j.sessionId, j.tester.cookie, r.id, "withdraw", { time: T[1] })).status).toBe(200);
    expect((await db.callRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("withdrawn");
  });
  it("Accept on a row books that time and closes the others; a press on another time then reads \"Another time of this request was booked.\"", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const T = [atHours(50), atHours(74), atHours(98)];
    await oldChooseOne(j.sessionId, "tester", T);
    const r = await db.callRequest.findFirstOrThrow({ where: { contractId: j.sessionId, status: "pending" } });
    const a = await devAnswer(s.testId, s.dev.cookie, j.sessionId, r.id, "accept", { time: T[1] });
    expect(a.status).toBe(200);
    const call = await db.call.findUniqueOrThrow({ where: { id: a.body.callId } });
    expect(call.startsAt.toISOString()).toBe(T[1]);
    expect(await db.call.count({ where: { contractId: j.sessionId } })).toBe(1);
    expect((await db.callRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("booked");
    await settle();
    const w = await testerAnswer(j.sessionId, j.tester.cookie, r.id, "withdraw", { time: T[2] });
    expect(w.status).toBe(409);
    expect(w.body.error.message).toBe(OTHER_TIME_BOOKED);
  });
  it("Accept on a single remaining time from a page that showed a removed one is refused (never books the other time)", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const T = [atHours(50), atHours(74)];
    await oldChooseOne(j.sessionId, "tester", T);
    const r = await db.callRequest.findFirstOrThrow({ where: { contractId: j.sessionId, status: "pending" } });
    await testerAnswer(j.sessionId, j.tester.cookie, r.id, "withdraw", { time: T[0] });
    const a = await devAnswer(s.testId, s.dev.cookie, j.sessionId, r.id, "accept", { time: T[0] });
    expect(a.status).toBe(400);
    expect(a.body.error.message).toBe("Pick one of the times.");
    expect(await db.call.count({ where: { contractId: j.sessionId } })).toBe(0);
  });
});
