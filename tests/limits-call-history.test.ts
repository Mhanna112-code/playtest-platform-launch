import { readFileSync } from "node:fs";
import path from "node:path";
import React, { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { LIMITS } from "@/lib/limits";
import { WRITTEN_MAX_CHARS, additionTooLongLine, checkAdditionLength, checkWrittenLength } from "@/lib/rules";
import { ADDITION_CUT_WHAT, additionRule, cutToLine, limitEdit } from "@/lib/typingLimit";
import { ADDITIONS_FULL, questionKeys } from "@/lib/additions";
import { pieceAnchor } from "@/lib/links";
import { LIST_PANEL } from "@/components/ScrollList";
import { POST as helpPOST } from "@/app/api/help/route";
import { WrittenAddForm } from "@/app/app/sessions/[id]/SessionActions";
import { joined, sact, seen, settle, setup } from "./fixtures";
import { json, req } from "./helpers";

// (Owner, Nov 4, §186) Every 50,000-character limit is 20,000; an addition ("Add to this answer") has the same limit as the answers sent first, on its own. The
// call history on both sides: two drop-downs, "Booked (N)" (ahead first, soonest first, then the ones that took place, newest first, with their payments) and
// "Cancelled (N)" (calls actually cancelled, newest first; requests never show).

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tests/test", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const Q1 = "What did you like?", Q2 = "Where did you get stuck?";
const DAY = 86_400_000, HOUR = 3_600_000;

describe("§186 text limits: 20,000 (was 50,000)", () => {
  it("the written part and Contact us", () => {
    expect(WRITTEN_MAX_CHARS).toBe(20_000);
    expect(LIMITS.contact).toEqual({ min: 10, max: 20_000 });
    expect(checkWrittenLength(["a".repeat(20_000)]).ok).toBe(true);
    expect(checkWrittenLength(["a".repeat(12_000), "b".repeat(8_001)])).toMatchObject({ ok: false, message: "Your written answers can be at most 20,000 characters in all (now 20,001)." });
    // No 50,000 left in the code.
    for (const f of ["lib/limits.ts", "lib/rules.ts", "app/app/sessions/[id]/SessionActions.tsx", "lib/typingLimit.ts"]) expect(src(f), f).not.toMatch(/50_000|50000|(?<!was )50,000/);
  });

  it("an addition: 20,000 of its own (markers not counted), whatever the rest holds", () => {
    expect(checkAdditionLength("a".repeat(20_000)).ok).toBe(true);
    expect(checkAdditionLength("a".repeat(20_001))).toMatchObject({ ok: false, message: "Your addition can be at most 20,000 characters (now 20,001)." });
    expect(additionTooLongLine(25_000)).toBe("Your addition can be at most 20,000 characters (now 25,000).");
    expect(checkAdditionLength("a".repeat(20_000) + "[📎 picture.png #abcd]").ok).toBe(true);
    const rule = additionRule();
    expect(rule.max).toBe(20_000);
    expect(rule.cutNote).toBe(cutToLine(20_000, ADDITION_CUT_WHAT));
    expect(rule.cutNote).toBe("Cut to the 20,000-character limit for this addition.");
    // A paste is cut at 20,000; an older draft already longer is never cut: it may only shrink.
    expect(limitEdit("", "x".repeat(20_005), rule).value).toHaveLength(20_000);
    const old = "y".repeat(25_000);
    expect(limitEdit(old, old + "z", rule).value).toBe(old);
    expect(limitEdit(old, old.slice(1), rule).value).toHaveLength(24_999);
  });

  it("the add form counts only its own text: 'N / 20,000', and a read-only draft keeps maxLength 20,000", () => {
    const f = src("app/app/sessions/[id]/SessionActions.tsx");
    expect(f).toContain("const length = writtenLength([text]);");
    expect(f).toContain("return setErr(FIELD + additionTooLongLine(length));");
    expect(f).toContain("total={length} alone value={text} onChange={setText} />");
    expect(f).toContain("readOnly value={text} maxLength={WRITTEN_MAX_CHARS} data-add-readonly");
    expect(f).not.toContain("used: number");
    expect(src("app/app/sessions/[id]/page.tsx")).not.toContain("used={writtenLength(");
    const html = render(h(WrittenAddForm, { sessionId: "s1", seenAt: seen(), questionKey: "qabc", question: Q1, made: 10 }));
    expect(html).not.toContain("data-additions-full");
    expect(html).not.toContain("data-add-more");
  });

  it("at 10 additions the grey note shows ONCE, directly under the answers panel, with no Add to this answer rows (2 questions)", async () => {
    const { testId } = await setup({ questions: [Q1, Q2] });
    const j = await joined(testId);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["first", "second"], seenAt: seen(), confirmed: true })).status).toBe(200);
    const [k1, k2] = questionKeys([{ question: Q1 }, { question: Q2 }]);
    const sub = await db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: j.sessionId, kind: "written" } } });
    const adds = Array.from({ length: 10 }, (_, i) => ({ at: new Date(Date.now() - 60_000 + i).toISOString(), text: `more ${i}`, files: [], questionKey: i % 2 ? k2 : k1 }));
    await db.submission.update({ where: { id: sub.id }, data: { additions: adds } });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: j.tester.user.id } });
    const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
    const page = unescape(render(await SessionPage({ params: Promise.resolve({ id: j.sessionId }) })));
    expect(page.match(/data-additions-full=""/g)).toHaveLength(1);
    expect(page).toContain(`data-additions-full="">${ADDITIONS_FULL}</p>`);
    expect(page).not.toContain("data-add-more");
    // Directly under the answers panel, before the (now empty) rows.
    const at = page.indexOf("data-additions-full");
    expect(page.lastIndexOf(`data-panel="own-answers-list-${sub.id}"`)).toBeLessThan(at);
    expect(at).toBeLessThan(page.indexOf("data-add-buttons"));
    // The developer's side never shows the note.
    expect(src("app/app/tests/[id]/page.tsx")).not.toContain("ADDITIONS_FULL");
  });

  it("Contact us refuses 20,001 characters (never cut)", async () => {
    const { dev } = await setup();
    const r = await json(await helpPOST(req("/api/help", { cookie: dev.cookie, body: { topic: "Payments", message: "x".repeat(20_001) } })));
    expect(r.status).toBe(400);
    expect(await db.contactMessage.count({ where: { userId: dev.user.id } })).toBe(0);
  });

  it("on the server: an addition at 20,000 goes through and 20,001 is refused on the first press, independent of the other answers' length", async () => {
    const { testId } = await setup({ questions: [Q1, Q2] });
    const j = await joined(testId);
    // The answers sent first fill their own 20,000 (19,990 + 10).
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a".repeat(19_940), "b".repeat(50)], notes: "c".repeat(10), seenAt: seen(), confirmed: true })).status).toBe(200);
    const [k1, k2] = questionKeys([{ question: Q1 }, { question: Q2 }]);
    // No `confirmed`: a too-long addition is refused at once, never a stop box first.
    const long = await sact(j.sessionId, "written-add", j.tester.cookie, { text: "x".repeat(20_001), question: k1, seenAt: seen() });
    expect(long.status).toBe(400);
    expect(long.body.error).toMatchObject({ code: "too_long", message: "Your addition can be at most 20,000 characters (now 20,001)." });
    const add = (text: string, question: string) => sact(j.sessionId, "written-add", j.tester.cookie, { text, question, seenAt: seen(), confirmed: true });
    expect((await add("x".repeat(20_000), k1)).status).toBe(200);
    // A second one at 20,000: the part now holds 60,000 characters, and that's fine.
    expect((await add("y".repeat(20_000), k2)).status).toBe(200);
    expect((await add("z".repeat(20_001), k2)).body.error.message).toBe("Your addition can be at most 20,000 characters (now 20,001).");
    const sub = await db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: j.sessionId, kind: "written" } } });
    expect((sub.additions as { text: string }[]).map((a) => a.text.length)).toEqual([20_000, 20_000]);
  });
});

/** One call with this tester, straight in the database. */
async function call(testId: string, contractId: string, startsAt: Date, data: Record<string, unknown> = {}) {
  const slot = await db.callSlot.create({ data: { testId, startsAt, minutes: 30, allowedTesterIds: [], status: "booked" } });
  return db.call.create({ data: { slotId: slot.id, contractId, startsAt, minutes: 30, rateCents: 3100, ...data } });
}
const cancelled = (by: string, note: string) => ({ status: "cancelled", cancelledBy: by, cancelledAt: new Date(Date.now() - 4 * DAY), cancelNote: note });
const tookPlace = { actualMinutes: 30, measuredAt: new Date() };
/** The text between two markers (the first after the other). */
const between = (html: string, from: string, to: string) => {
  const a = html.indexOf(from);
  expect(a, from).toBeGreaterThan(-1);
  const b = html.indexOf(to, a + from.length);
  return html.slice(a, b < 0 ? undefined : b);
};

describe("§186 call history: the developer's tester row", () => {
  it("only cancelled calls (and closed requests): Booked (0) and Cancelled (N), newest first, with who cancelled and why; no request shows", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva");
    await settle();
    const older = await call(s.testId, j.sessionId, new Date(Date.now() - 6 * DAY), cancelled("tester", "My train was late"));
    const newer = await call(s.testId, j.sessionId, new Date(Date.now() - 2 * DAY), cancelled("developer", ""));
    // Requests that were withdrawn, declined or closed never appear in the call history.
    for (const status of ["withdrawn", "declined", "closed"]) await db.callRequest.create({ data: { testId: s.testId, contractId: j.sessionId, fromSide: "tester", startsAt: new Date(Date.now() - 3 * DAY), minutes: 45, status } });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } });
    const { default: TestPage } = await import("@/app/app/tests/[id]/page");
    const html = unescape(render(await TestPage({ params: Promise.resolve({ id: s.testId }), searchParams: Promise.resolve({}) })));
    const row = between(html, `data-calls-fold="${j.sessionId}"`, "data-tester-summary");
    expect(row).toMatch(/<details id="calls-booked-[^"]+"[^>]*data-calls-booked="0"><summary[^>]*>Booked \(0\)<\/summary>/);
    expect(row).toContain("No booked calls.");
    expect(row).toMatch(/<details id="calls-cancelled-[^"]+"[^>]*data-calls-cancelled="2"><summary[^>]*>Cancelled \(2\)<\/summary>/);
    // Both closed at first.
    expect(row).not.toMatch(/<details open[^>]*data-calls-(booked|cancelled)/);
    const list = row.slice(row.indexOf("data-calls-cancelled"));
    expect(list.indexOf(`data-over-call="${newer.id}"`)).toBeLessThan(list.indexOf(`data-over-call="${older.id}"`));
    expect(list).toContain("Cancelled by you");
    expect(list).toContain("Cancelled by Ana Silva");
    expect(list).toContain("My train was late");
    expect(list.match(/data-call-booked-length="">· 30 min/g)).toHaveLength(2);
    expect(row).not.toContain("45 min");
  });

  it("Booked (N): ahead first (soonest first) with Join / Cancel, then the ones that took place (newest first) with their payments; past 3 rows it is the panel", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva");
    await settle();
    const later = await call(s.testId, j.sessionId, new Date(Date.now() + 3 * DAY));
    const sooner = await call(s.testId, j.sessionId, new Date(Date.now() + 2 * DAY));
    const paid = await call(s.testId, j.sessionId, new Date(Date.now() - 5 * DAY), tookPlace);
    const unpaid = await call(s.testId, j.sessionId, new Date(Date.now() - 1 * DAY), tookPlace);
    const gone = await call(s.testId, j.sessionId, new Date(Date.now() - 3 * DAY), cancelled("tester", "Sick"));
    await db.review.create({ data: { callId: paid.id, contractId: j.sessionId, amountCents: 1550, agreedCents: 1550, rateCents: 3100, payKey: "k-" + paid.id } });
    await db.payment.create({ data: { kind: "review", amountCents: 1550, status: "charged", contractId: j.sessionId, callId: paid.id, developerId: s.dev.user.id, testerId: j.tester.user.id, feeCents: 0, testerCents: 0 } });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } });
    const { default: TestPage } = await import("@/app/app/tests/[id]/page");
    const html = unescape(render(await TestPage({ params: Promise.resolve({ id: s.testId }), searchParams: Promise.resolve({}) })));
    const row = between(html, `data-calls-fold="${j.sessionId}"`, "data-tester-summary");
    expect(row).toContain(">Booked (4)</summary>");
    expect(row).toContain(">Cancelled (1)</summary>");
    const booked = between(row, "data-calls-booked", "data-calls-cancelled");
    const order = [sooner, later, unpaid, paid].map((x) => booked.indexOf(`="${x.id}"`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(booked).not.toContain(gone.id);
    // The calls ahead: their own rows (the Live session keeps call-<id>), with Add to calendar and Cancel.
    expect(booked).toContain(`id="booked-call-${sooner.id}"`);
    expect(between(booked, `id="booked-call-${sooner.id}"`, "</li>")).toContain("Add to calendar");
    expect(between(booked, `id="booked-call-${sooner.id}"`, "</li>")).toContain("Cancel");
    expect(html).toContain(`id="call-${sooner.id}"`); // the Live session's row
    // The paid call: its amount once in the badge, its payment line under it.
    expect(booked).toContain("Took place · 30 min · paid $15.50");
    expect(booked).toContain(`data-part-payments="${paid.id}"`);
    expect(booked).toContain("not paid yet");
    // 4 rows: the draggable panel at the developer's past-calls height.
    expect(booked).toContain(`data-panel="booked-calls-${j.sessionId}"`);
    expect(booked).toContain(`max-height:${LIST_PANEL.pastDeveloper}`);
    expect(row).not.toContain(`data-panel="cancelled-calls-${j.sessionId}"`);
  });
});

describe("§186 call history: the tester's session page", () => {
  it("only cancelled calls: the two drop-downs under the call requests, Booked (0), Cancelled (N) newest first; no request shows", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva");
    await settle();
    const older = await call(s.testId, j.sessionId, new Date(Date.now() - 6 * DAY), cancelled("developer", "Out of office"));
    const newer = await call(s.testId, j.sessionId, new Date(Date.now() - 2 * DAY), { status: "cancelled", cancelledBy: "system", cancelledAt: new Date(), cancelNote: "Nobody joined the call." });
    await db.callRequest.create({ data: { testId: s.testId, contractId: j.sessionId, fromSide: "developer", startsAt: new Date(Date.now() - 3 * DAY), minutes: 45, status: "declined" } });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: j.tester.user.id } });
    const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
    const html = unescape(render(await SessionPage({ params: Promise.resolve({ id: j.sessionId }) })));
    const hist = between(html, 'id="call-history"', "</section>");
    // Under the Live session (where the call requests are).
    expect(html.indexOf('data-live-panel=""')).toBeLessThan(html.indexOf('id="call-history"'));
    expect(hist).toContain(">Booked (0)</summary>");
    expect(hist).toContain("No booked calls.");
    expect(hist).toContain(">Cancelled (2)</summary>");
    expect(hist).not.toMatch(/<details open/);
    expect(hist.indexOf(newer.id)).toBeLessThan(hist.indexOf(older.id));
    expect(hist).toContain("Nobody joined");
    expect(hist).toContain("Cancelled by Nora Lane");
    expect(hist).toContain("Out of office");
    expect(hist).not.toContain("45 min");
  });

  it("Booked (N): the calls ahead (Join / Cancel, no longer in the Live session) then the ones that took place with their payments, listed once", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva");
    await settle();
    const later = await call(s.testId, j.sessionId, new Date(Date.now() + 3 * DAY));
    const sooner = await call(s.testId, j.sessionId, new Date(Date.now() + 2 * DAY));
    const paid = await call(s.testId, j.sessionId, new Date(Date.now() - 5 * DAY), tookPlace);
    const unpaid = await call(s.testId, j.sessionId, new Date(Date.now() - 1 * DAY - HOUR), { ...tookPlace, payBy: new Date(Date.now() + 6 * DAY) });
    const gone = await call(s.testId, j.sessionId, new Date(Date.now() - 3 * DAY), cancelled("tester", ""));
    await db.review.create({ data: { callId: paid.id, contractId: j.sessionId, amountCents: 1550, agreedCents: 1550, rateCents: 3100, payKey: "k-" + paid.id } });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: j.tester.user.id } });
    const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
    const html = unescape(render(await SessionPage({ params: Promise.resolve({ id: j.sessionId }) })));
    const hist = between(html, 'id="call-history"', "</section>");
    expect(hist).toContain(">Booked (4)</summary>");
    expect(hist).toContain(">Cancelled (1)</summary>");
    const booked = between(hist, "data-calls-booked", "data-calls-cancelled");
    const order = [sooner, later, unpaid, paid].map((x) => booked.indexOf(`id="call-${x.id}"`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(booked).not.toContain(gone.id);
    expect(between(booked, `id="call-${sooner.id}"`, "</li>")).toContain("Add to calendar");
    // Payments as the tester saw them in "Live call": the paid line, and the automatic charge of the unpaid one.
    expect(booked).toContain("Paid $15.50");
    expect(booked).toContain('data-auto-charge=""');
    expect(booked.match(/data-call-row=""/g)).toHaveLength(2);
    // Each call once on the page: no second row in the Live session or in the Live call part.
    for (const x of [sooner, later, paid, unpaid]) expect(html.split(`id="call-${x.id}"`)).toHaveLength(2);
    expect(html.match(/Paid \$15\.50/g)).toHaveLength(1);
    const live = between(html, 'id="part-live"', "</li>");
    expect(live).toContain("2 done");
    expect(live).toContain(`href="#calls-booked-${j.sessionId}"`);
    expect(live).not.toContain("data-call-row");
    expect(between(html, 'data-live-panel=""', 'id="call-history"')).not.toContain("Add to calendar");
    // 4 rows: the draggable panel (the §179 height, rows carry payment boxes).
    expect(booked).toContain(`data-panel="booked-calls-${j.sessionId}"`);
    expect(booked).toContain(`max-height:${LIST_PANEL.liveTester}`);
  });

  it("a payment's bell opens the call's own row; the dashboard's upcoming call opens Booked", () => {
    expect(pieceAnchor("live call", "c1")).toBe("call-c1");
    expect(pieceAnchor("written answers", null)).toBe("part-written");
    expect(pieceAnchor("live call")).toBe("part-live");
    expect(src("app/app/page.tsx")).toContain("<Link href={`/app/sessions/${c.id}#calls-booked-${c.id}`}");
  });
});
