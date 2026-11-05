import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import type { User } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { pieceAnchor } from "@/lib/links";
import { hashTargets, jumpTo } from "@/lib/markJump";
import { LIST_PANEL } from "@/components/ScrollList";
import { joined, settle, setup } from "./fixtures";

// (Owner, Nov 5, §209; replaces §186's Booked / Cancelled and its Call history card, and the queued §197) Each tester's row on the developer's test page:
// "Had (N)" (the calls that took place, with their payments and Pay more) and "Cancelled (N)", both closed; the calls ahead only in the Live session with
// Join call / Cancel. The tester's session page: no Call history card; the Live session holds the calls ahead (Booked) and under them Had (N) / Cancelled (N).

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tests/test", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const DAY = 86_400_000, HOUR = 3_600_000;

/** One call with this tester, straight in the database. */
async function call(testId: string, contractId: string, startsAt: Date, data: Record<string, unknown> = {}) {
  const slot = await db.callSlot.create({ data: { testId, startsAt, minutes: 30, allowedTesterIds: [], status: "booked" } });
  return db.call.create({ data: { slotId: slot.id, contractId, startsAt, minutes: 30, rateCents: 3100, ...data } });
}
const cancelled = (by: string, note: string) => ({ status: "cancelled", cancelledBy: by, cancelledAt: new Date(Date.now() - 4 * DAY), cancelNote: note });
const tookPlace = { actualMinutes: 30, measuredAt: new Date() };
/** A no-show report: one side never came, the call was measured at 0 minutes and stays payable / disputable. */
const noShow = { measuredMinutes: 0, measuredAt: new Date(), noShowBy: "developer", noShowNote: "She never came", noShowAt: new Date() };
/** The text between two markers (the first after the other). */
const between = (html: string, from: string, to: string) => {
  const a = html.indexOf(from);
  expect(a, from).toBeGreaterThan(-1);
  const b = html.indexOf(to, a + from.length);
  return html.slice(a, b < 0 ? undefined : b);
};
const count = (html: string, s: string) => html.split(s).length - 1;

async function devPage(testId: string, devId: string) {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: devId } });
  const { default: TestPage } = await import("@/app/app/tests/[id]/page");
  return unescape(render(await TestPage({ params: Promise.resolve({ id: testId }), searchParams: Promise.resolve({}) })));
}
async function testerPage(sessionId: string, testerId: string) {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: testerId } });
  const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
  return unescape(render(await SessionPage({ params: Promise.resolve({ id: sessionId }) })));
}

describe("§209 the developer's tester row: Had (N) and Cancelled (N); the calls ahead only in the Live session", () => {
  it("only cancelled calls: Had (0) and Cancelled (N) closed, newest first, who cancelled and why (the app's Nobody joined too); no request shows", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva");
    await settle();
    const older = await call(s.testId, j.sessionId, new Date(Date.now() - 6 * DAY), cancelled("tester", "My train was late"));
    const middle = await call(s.testId, j.sessionId, new Date(Date.now() - 4 * DAY), { status: "cancelled", cancelledBy: "system", cancelledAt: new Date(), cancelNote: "Nobody joined the call." });
    const newer = await call(s.testId, j.sessionId, new Date(Date.now() - 2 * DAY), cancelled("developer", ""));
    for (const status of ["withdrawn", "declined", "closed"]) await db.callRequest.create({ data: { testId: s.testId, contractId: j.sessionId, fromSide: "tester", startsAt: new Date(Date.now() - 3 * DAY), minutes: 45, status } });
    const html = await devPage(s.testId, s.dev.user.id);
    const row = between(html, `data-calls-fold="${j.sessionId}"`, "data-tester-summary");
    expect(row).toMatch(/<details id="calls-had-[^"]+"[^>]*data-calls-had="0"><summary[^>]*>Had \(0\)<\/summary>/);
    expect(row).toContain("No calls took place yet.");
    expect(row).toMatch(/<details id="calls-cancelled-[^"]+"[^>]*data-calls-cancelled="3"><summary[^>]*>Cancelled \(3\)<\/summary>/);
    expect(row).not.toMatch(/<details open[^>]*data-calls-(had|cancelled)/);
    const list = row.slice(row.indexOf("data-calls-cancelled"));
    const order = [newer, middle, older].map((x) => list.indexOf(`data-over-call="${x.id}"`));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(list).toContain("Cancelled by you");
    expect(list).toContain("Cancelled by Ana Silva");
    expect(list).toContain("My train was late");
    expect(list).toContain(">Nobody joined<");
    expect(row).not.toContain("45 min");
    // No "Booked (N)" any more, and no Call history box anywhere (§197 never built).
    expect(html).not.toContain("Booked (");
    expect(html).not.toContain("calls-booked-");
    expect(html).not.toContain("Call history");
  });

  it("Had (N): the calls that took place (a no-show's 0 minutes too), newest first, with payments; ahead calls only in the Live session with Join / Cancel; a panel past 3", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva");
    await settle();
    const later = await call(s.testId, j.sessionId, new Date(Date.now() + 3 * DAY));
    const sooner = await call(s.testId, j.sessionId, new Date(Date.now() + 2 * DAY));
    const paid = await call(s.testId, j.sessionId, new Date(Date.now() - 6 * DAY), tookPlace);
    const old = await call(s.testId, j.sessionId, new Date(Date.now() - 7 * DAY), tookPlace);
    const missed = await call(s.testId, j.sessionId, new Date(Date.now() - 2 * DAY), noShow);
    const unpaid = await call(s.testId, j.sessionId, new Date(Date.now() - 1 * DAY), tookPlace);
    const gone = await call(s.testId, j.sessionId, new Date(Date.now() - 3 * DAY), cancelled("tester", "Sick"));
    const down = await call(s.testId, j.sessionId, new Date(Date.now() - 5 * DAY), { status: "cancelled", cancelledBy: "system", cancelledAt: new Date(), cancelNote: "Missed: the site was down." });
    await db.review.create({ data: { callId: paid.id, contractId: j.sessionId, amountCents: 1550, agreedCents: 1550, rateCents: 3100, payKey: "k-" + paid.id } });
    await db.payment.create({ data: { kind: "review", amountCents: 1550, status: "charged", contractId: j.sessionId, callId: paid.id, developerId: s.dev.user.id, testerId: j.tester.user.id, feeCents: 0, testerCents: 0 } });
    const html = await devPage(s.testId, s.dev.user.id);
    const row = between(html, `data-calls-fold="${j.sessionId}"`, "data-tester-summary");
    expect(row).toContain(">Had (4)</summary>");
    expect(row).toContain(">Cancelled (2)</summary>");
    const had = between(row, "data-calls-had", "data-calls-cancelled");
    const order = [unpaid, missed, paid, old].map((x) => had.indexOf(`data-over-call="${x.id}"`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The no-show call took place in a form that can be paid or disputed: in Had with its badge, not in Cancelled.
    expect(between(had, `data-over-call="${missed.id}"`, "</li>")).toContain("Took place · 0 min · not paid yet");
    expect(had).toContain("Took place · 30 min · paid $15.50");
    expect(had).toContain(`data-part-payments="${paid.id}"`);
    const can = row.slice(row.indexOf("data-calls-cancelled"));
    expect(can).toContain(gone.id);
    expect(between(can, `data-over-call="${down.id}"`, "</li>")).toContain("Missed: the site was down");
    expect(can).not.toContain(missed.id);
    // The calls ahead are not in the row at all ...
    for (const x of [sooner, later]) expect(row).not.toContain(x.id);
    expect(row).not.toContain("booked-call-");
    expect(row).not.toContain("data-calls-ahead");
    // ... they are in the Live session (each once on the page), with Add to calendar and Cancel.
    const live = between(html, 'data-live-panel=""', `id="tester-${j.sessionId}"`);
    for (const x of [sooner, later]) {
      expect(count(html, `id="call-${x.id}"`)).toBe(1);
      expect(live).toContain(`id="call-${x.id}"`);
      const r = between(live, `id="call-${x.id}"`, "</li>");
      expect(r).toContain("Add to calendar");
      expect(r).toContain("Cancel");
    }
    expect(live.indexOf(`id="call-${sooner.id}"`)).toBeLessThan(live.indexOf(`id="call-${later.id}"`));
    // 4 rows: Had is the draggable panel at the developer's past-calls height; Cancelled (2) is a plain list.
    expect(had).toContain(`data-panel="had-calls-${j.sessionId}"`);
    expect(had).toContain(`max-height:${LIST_PANEL.pastDeveloper}`);
    expect(row).not.toContain(`data-panel="cancelled-calls-${j.sessionId}"`);
  });
});

describe("§209 the tester's session page: no Call history; the Live session holds Booked, then Had (N) and Cancelled (N)", () => {
  it("only cancelled calls: Had (0) / Cancelled (N) inside the Live session, closed, newest first; no request shows", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva");
    await settle();
    const older = await call(s.testId, j.sessionId, new Date(Date.now() - 6 * DAY), cancelled("developer", "Out of office"));
    const newer = await call(s.testId, j.sessionId, new Date(Date.now() - 2 * DAY), { status: "cancelled", cancelledBy: "system", cancelledAt: new Date(), cancelNote: "Nobody joined the call." });
    await db.callRequest.create({ data: { testId: s.testId, contractId: j.sessionId, fromSide: "developer", startsAt: new Date(Date.now() - 3 * DAY), minutes: 45, status: "declined" } });
    const html = await testerPage(j.sessionId, j.tester.user.id);
    expect(html).not.toContain('id="call-history"');
    expect(html).not.toContain("data-call-history");
    expect(html).not.toContain("Call history");
    const live = between(html, 'data-live-panel=""', 'id="recording"');
    const fold = between(live, `data-calls-fold="${j.sessionId}"`, 'data-live-section="Requests"');
    expect(fold).toContain(">Had (0)</summary>");
    expect(fold).toContain("No calls took place yet.");
    expect(fold).toContain(">Cancelled (2)</summary>");
    expect(fold).not.toMatch(/<details open/);
    expect(fold.indexOf(newer.id)).toBeLessThan(fold.indexOf(older.id));
    expect(fold).toContain("Nobody joined");
    expect(fold).toContain("Cancelled by Nora Lane");
    expect(fold).toContain("Out of office");
    expect(fold).not.toContain("45 min");
  });

  it("Booked (Join / Cancel) back in the Live session; under it Had (N) with the payments and Dispute, and Cancelled (N); each call once; a panel past 3", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva");
    await settle();
    const later = await call(s.testId, j.sessionId, new Date(Date.now() + 3 * DAY));
    const sooner = await call(s.testId, j.sessionId, new Date(Date.now() + 2 * DAY));
    const paid = await call(s.testId, j.sessionId, new Date(Date.now() - 5 * DAY), tookPlace);
    const old = await call(s.testId, j.sessionId, new Date(Date.now() - 6 * DAY), tookPlace);
    const missed = await call(s.testId, j.sessionId, new Date(Date.now() - 2 * DAY), { ...noShow, noShowBy: "tester", noShowNote: "He never came", payBy: new Date(Date.now() + 5 * DAY) });
    const unpaid = await call(s.testId, j.sessionId, new Date(Date.now() - 1 * DAY - HOUR), { ...tookPlace, payBy: new Date(Date.now() + 6 * DAY) });
    const gone = await call(s.testId, j.sessionId, new Date(Date.now() - 3 * DAY), cancelled("tester", ""));
    await db.review.create({ data: { callId: paid.id, contractId: j.sessionId, amountCents: 1550, agreedCents: 1550, rateCents: 3100, payKey: "k-" + paid.id } });
    const html = await testerPage(j.sessionId, j.tester.user.id);
    expect(html).not.toContain('id="call-history"');
    const live = between(html, 'data-live-panel=""', 'id="recording"');
    // The calls ahead: the Live session's Booked list (its own panel id as before §186), soonest first, with Add to calendar and Cancel.
    expect(live).toContain('data-live-section="Booked"');
    expect(live).toContain(`data-panel="booked-${j.sessionId}"`);
    expect(live.indexOf(`id="call-${sooner.id}"`)).toBeLessThan(live.indexOf(`id="call-${later.id}"`));
    expect(between(live, `id="call-${sooner.id}"`, "</li>")).toContain("Add to calendar");
    expect(between(live, `id="call-${sooner.id}"`, "</li>")).toContain("Cancel");
    // Under them Had and Cancelled, then the Requests.
    expect(live.indexOf(`id="call-${later.id}"`)).toBeLessThan(live.indexOf(`id="calls-had-${j.sessionId}"`));
    expect(live.indexOf(`id="calls-had-${j.sessionId}"`)).toBeLessThan(live.indexOf(`id="calls-cancelled-${j.sessionId}"`));
    const fold = between(live, `data-calls-fold="${j.sessionId}"`, 'data-live-section="Requests"');
    expect(fold).toContain(">Had (4)</summary>");
    expect(fold).toContain(">Cancelled (1)</summary>");
    expect(fold).not.toMatch(/<details open/);
    const had = between(fold, "data-calls-had", "data-calls-cancelled");
    const order = [unpaid, missed, paid, old].map((x) => had.indexOf(`id="call-${x.id}"`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const x of [sooner, later, gone]) expect(had).not.toContain(x.id);
    expect(between(had, `id="call-${missed.id}"`, "</li>")).toContain("Took place · 0 min");
    expect(had).toContain("Paid $15.50");
    expect(had).toContain("Dispute the pay");
    expect(had).toContain('data-auto-charge=""');
    expect(fold.slice(fold.indexOf("data-calls-cancelled"))).toContain(gone.id);
    // Each call once on the page; the Live call part links to Had.
    for (const x of [sooner, later, paid, unpaid, missed, old, gone]) expect(count(html, `id="call-${x.id}"`)).toBe(1);
    const part = between(html, 'id="part-live"', "</li>");
    expect(part).toContain(`href="#calls-had-${j.sessionId}"`);
    expect(part).toContain("Each call and what it was paid: Live session, Had ↓");
    expect(part).not.toContain("data-call-row");
    expect(html).not.toContain("data-booked-below");
    // 4 rows: Had is the draggable panel at the §179 height (rows carry payment boxes); Cancelled (1) a plain list.
    expect(had).toContain(`data-panel="had-calls-${j.sessionId}"`);
    expect(had).toContain(`max-height:${LIST_PANEL.liveTester}`);
    expect(fold).not.toContain(`data-panel="cancelled-calls-${j.sessionId}"`);
  });

  it("a blocked pair: a call that took place stays in Had with its payments, the others read Cancelled: not available", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva");
    await settle();
    const done = await call(s.testId, j.sessionId, new Date(Date.now() - 2 * DAY), tookPlace);
    const ahead = await call(s.testId, j.sessionId, new Date(Date.now() + 2 * DAY));
    await db.block.create({ data: { blockerId: s.dev.user.id, blockedId: j.tester.user.id } });
    const html = await testerPage(j.sessionId, j.tester.user.id);
    expect(html).not.toContain('id="call-history"');
    const fold = between(html, `data-calls-fold="${j.sessionId}"`, "</details></div>");
    expect(fold).toContain(">Had (1)</summary>");
    expect(between(fold, "data-calls-had", "data-calls-cancelled")).toContain(done.id);
    const can = html.slice(html.indexOf("data-calls-cancelled"));
    expect(can).toContain(">Cancelled (1)</summary>");
    expect(between(can, `id="call-${ahead.id}"`, "</li>")).toContain("Cancelled: not available");
  });
});

describe("§209 links land on the call in its new place and open its drop-downs", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("the dashboard's upcoming call opens its own row in the Live session; the waiting call and payment bells open call-<id> (in Had)", () => {
    const dash = src("app/app/page.tsx");
    expect(dash).toContain("<Link href={`/app/sessions/${c.id}#call-${x.id}`} className=\"mr-auto flex min-w-0");
    expect(dash).not.toContain("#calls-booked-");
    expect(pieceAnchor("live call", "c1")).toBe("call-c1");
    expect(pieceAnchor("live call")).toBe("part-live");
    // No link anywhere still points into the Call history.
    for (const f of ["app/app/page.tsx", "app/app/sessions/[id]/page.tsx", "app/app/tests/[id]/page.tsx", "lib/server/payments.ts", "lib/server/teamClose.ts", "lib/server/calls.ts"]) {
      expect(src(f), f).not.toMatch(/#calls-booked-|#call-history|href=\{`#calls-booked/);
    }
    // A set's calls open when the hash names one of them (so the jump finds the row).
    expect(src("app/app/sessions/[id]/TesterCallPanel.tsx")).toContain('window.addEventListener("hashchange", show)');
  });

  it("older links to the retired Call history land on the Live session; others are unchanged", () => {
    expect(hashTargets("call-history")).toEqual(["call-history", "live"]);
    expect(hashTargets("calls-booked-abc123")).toEqual(["calls-booked-abc123", "live"]);
    expect(hashTargets("calls-had-abc123")).toEqual(["calls-had-abc123"]);
    expect(hashTargets("call-c1")).toEqual(["call-c1"]);
    expect(hashTargets("piece-s1")).toEqual(["piece-s1", "part-s1"]);
  });

  it("jumpTo on a call inside Had opens the Had drop-down (and the tester fold around it) and marks the row", () => {
    class Details { open = false; dataset: Record<string, string> = {}; constructor(public parentElement: unknown = null) {} }
    class El {
      dataset: Record<string, string> = {}; attrs: Record<string, string> = {}; scrolled = false;
      constructor(public id: string, public parentElement: unknown) {}
      querySelectorAll() { return []; }
      scrollIntoView() { this.scrolled = true; }
      setAttribute(k: string, v: string) { this.attrs[k] = v; }
      removeAttribute(k: string) { delete this.attrs[k]; }
    }
    vi.stubGlobal("HTMLDetailsElement", Details);
    const tester = new Details();
    const had = new Details(tester);
    const row = new El("call-x1", { dataset: {}, parentElement: had });
    vi.stubGlobal("document", { getElementById: (id: string) => (id === "call-x1" ? row : null) });
    jumpTo("call-x1");
    expect(had.open).toBe(true);
    expect(tester.open).toBe(true);
    expect(row.scrolled).toBe(true);
    expect(row.attrs["data-marked"]).toBe("");
  });
});
