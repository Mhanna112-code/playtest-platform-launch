import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { fmtDate } from "@/lib/format";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as excerptsPOST } from "@/app/api/excerpts/route";
import { startHold } from "@/lib/server/holds";
import { bigOwnGate } from "@/lib/server/tests";
import { json, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 16 sections 22, 25 (developer), 26, plus 23 and 29: Pay more closes 30 days after the test ends; in a stopped / paused state what still works goes
// through on the first press; no Lower the length; no excerpts on hover cards; the invite search's results under its box.
const DAY = 86_400_000;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const later = () => new Promise((r) => setTimeout(r, 30));
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const ex = (cookie: string, body: Record<string, unknown>) => excerptsPOST(req("/api/excerpts", { cookie, body })).then(json);

async function paidWork(over: Record<string, unknown> = {}) {
  const s = await setup({ spots: 5, ...over });
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["The harbour level felt great, but the second boss was far too hard for me.", "Nowhere."] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "5.00", tickedCents: 500, reason: "Partly useful" })).status).toBe(200);
  return { ...s, ...j, sub };
}

describe("Pay more closes 30 days after the test ends (section 22)", () => {
  it("the rule: when the test ended (stopped, or done when the last deadline passed); a Next round's draft has its own clock; the grey line in the last 7 days", () => {
    const now = new Date("2026-12-01T12:00:00Z");
    const stopped = new Date("2026-11-02T12:00:00Z");
    expect(R.testEndedAt({ status: "stopped", stoppedAt: stopped, openUntil: null }, [], now)).toEqual(stopped);
    const ou = new Date("2026-11-10T23:59:59Z");
    expect(R.testEndedAt({ status: "open", stoppedAt: null, openUntil: ou }, [{ status: "working", dueAt: new Date("2026-11-20T23:59:59Z"), endedAt: null }], now)).toEqual(new Date("2026-11-20T23:59:59Z"));
    expect(R.testEndedAt({ status: "open", stoppedAt: null, openUntil: ou }, [{ status: "working", dueAt: new Date("2026-12-05T23:59:59Z"), endedAt: null }], now)).toBeNull();
    expect(R.testEndedAt({ status: "draft", stoppedAt: null, openUntil: ou }, [], now)).toBeNull();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const at = (days: number) => new Date(stopped.getTime() + days * DAY);
    expect(R.payMoreState(stopped, at(20), fmt)).toEqual({ open: true, closes: at(30), line: "" });
    expect(R.payMoreState(stopped, at(29), fmt)).toEqual({ open: true, closes: at(30), line: "Pay more closes on 2026-12-02." });
    expect(R.payMoreState(stopped, at(31), fmt).open).toBe(false);
    expect(R.payMoreClosedLine(at(30), fmt)).toBe("Pay more closed on 2026-12-02, 30 days after the test ended.");
  });

  it("(server) open at day 29, refused at day 31; the page hides the box once closed and shows the line before", async () => {
    const w = await paidWork();
    const body = { contractId: w.sessionId, submissionId: w.sub.id, amount: "1.00", tickedCents: 100, seenAt: seen(), confirmed: true };
    await db.test.update({ where: { id: w.testId }, data: { status: "stopped", stoppedAt: new Date(Date.now() - 29 * DAY) } });
    expect((await act(w.testId, "pay-extra", w.dev.cookie, body)).status).toBe(200);
    const stoppedAt = new Date(Date.now() - 31 * DAY);
    await db.test.update({ where: { id: w.testId }, data: { stoppedAt } });
    const r = await act(w.testId, "pay-extra", w.dev.cookie, { ...body, amount: "0.50", tickedCents: 50 });
    expect(r.body.error.message).toBe(`Pay more closed on ${fmtDate(new Date(stoppedAt.getTime() + 30 * DAY))}, 30 days after the test ended.`);
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page).toContain("const payMore = payMoreState(testEndedAt(t, t.contracts, now), now, fmtDate);");
    expect(page.match(/payMore\.open && \(rooms\.get/g)).toHaveLength(2);
    expect(page.match(/note=\{payMore\.line \|\| undefined\}/g)).toHaveLength(2);
  });
});

describe("developer, stopped / closed or paused / held: what still works goes through on the first press (section 25)", () => {
  it("stopped: Pay, Pay more, Next round and the side of a dispute go through despite news and other tabs; Rate stops once only for a payment about that person", async () => {
    const w = await paidWork({ recordingCents: "5.00" });
    const b = await joined(w.testId, "Ben Carter", "he");
    await sact(b.sessionId, "written", b.tester.cookie, { answers: ["a", "b"] });
    const subB = await db.submission.findFirstOrThrow({ where: { contractId: b.sessionId } });
    expect((await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.sub.id, reason: "I answered every question fully" })).status).toBe(200);
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: w.sub.id } });
    await db.rating.create({ data: { testId: w.testId, contractId: b.sessionId, side: "tester", raterId: b.tester.user.id, rateeId: w.dev.user.id, stars: 5 } });
    expect((await act(w.testId, "stop", w.dev.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    await later();
    const loaded = seen();
    await later();
    // News since the page loaded: a tester's line, and a big change from another tab.
    await db.testEvent.create({ data: { testId: w.testId, kind: "left", text: "Cara Diaz left the test" } });
    expect((await act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "1.00", tickedCents: 100, seenAt: seen(), confirmed: true, tab: "A" })).status).toBe(200);
    const B = { seenAt: loaded, tab: "B" };
    expect((await pay(w.dev.cookie, { kind: "submission", id: subB.id, amount: "10.00", tickedCents: 1000, ...B, confirmed: false })).status).toBe(200);
    expect((await act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "1.00", tickedCents: 100, ...B })).status).toBe(200);
    expect((await act(w.testId, "dispute-side", w.dev.cookie, { disputeId: d.id, text: "They skipped two answers", ...B })).status).toBe(200);
    // Rate Ben: the payment about Ben arrived since the page loaded (from this tab's Pay above, as the page didn't show it): stops once, then goes ahead.
    await db.testEvent.create({ data: { testId: w.testId, kind: "paid", text: "Ben Carter charged $1.00 for their recording", contractId: b.sessionId } });
    const rate = await act(w.testId, "rate", w.dev.cookie, { contractId: b.sessionId, stars: 4, ...B });
    expect(rate.body.error.code).toBe("stop_once");
    expect(rate.body.error.changes.map((c: { text: string }) => c.text)).toContain("Ben Carter charged $1.00 for their recording");
    expect(rate.body.error.changes.some((c: { text: string }) => /another tab|Cara Diaz/.test(c.text))).toBe(false);
    expect((await act(w.testId, "rate", w.dev.cookie, { contractId: b.sessionId, stars: 4, ...B, confirmed: true, boxAt: new Date().toISOString() })).status).toBe(200);
    // Next round on the stopped test: through at once.
    expect((await act(w.testId, "next-round", w.dev.cookie, B)).status).toBe(200);
    // Repeats are plain refusals.
    expect((await act(w.testId, "dispute-side", w.dev.cookie, { disputeId: d.id, text: "Again", ...B })).body.error.message).toBe("You already sent your side.");
  });

  it("paused (a payment hold): Stop, End early and Cancel call go through on the first press", async () => {
    const { dev, testId } = await setup({ spots: 5 });
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Okafor");
    const call = await bookCall(testId, dev.cookie, a.sessionId, a.tester.cookie, 24 * 6);
    await startHold(dev.user.id, "unpaid");
    await later();
    const loaded = seen();
    await later();
    await db.testEvent.create({ data: { testId, kind: "left", text: "Cara Diaz left the test" } });
    expect((await act(testId, "cancel-call", dev.cookie, { callId: call.id, seenAt: loaded })).status).toBe(200);
    expect((await act(testId, "end-early", dev.cookie, { contractIds: [b.sessionId], reason: "Done", seenAt: loaded })).status).toBe(200);
    expect((await act(testId, "stop", dev.cookie, { seenAt: loaded })).status).toBe(200);
  });

  it("excerpt Allow / Deny: a big change in another tab stops them once on a running test, never on a stopped or paused one", async () => {
    const w = await paidWork();
    await later();
    const loaded = seen();
    await later();
    expect((await act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "1.00", tickedCents: 100, seenAt: seen(), confirmed: true, tab: "A" })).status).toBe(200);
    await expect(bigOwnGate(w.dev.user.id, w.testId, { seenAt: loaded, tab: "B" })).rejects.toMatchObject({ code: "stop_once" });
    await db.test.update({ where: { id: w.testId }, data: { status: "stopped", stoppedAt: new Date(Date.now() - DAY) } });
    await expect(bigOwnGate(w.dev.user.id, w.testId, { seenAt: loaded, tab: "B" })).resolves.toBeUndefined();
    expect((await ex(w.dev.cookie, { action: "decide", excerptId: "nope", decision: "allow", seenAt: loaded })).body.error.message).toBe("This request was already decided.");
  });

  it("a state that began after the page loaded is news: Stop in another tab still stops this tab's Stop once (section 21)", async () => {
    const { dev, testId } = await setup();
    await later();
    const loaded = seen();
    await later();
    expect((await act(testId, "stop", dev.cookie, { seenAt: seen(), confirmed: true, tab: "A" })).status).toBe(200);
    expect((await act(testId, "stop", dev.cookie, { seenAt: loaded, tab: "B" })).body.error.code).toBe("stop_once");
  });
});

describe("no Lower the length (section 26)", () => {
  it("the action and the box are gone; a call's Pay box starts at measured × rate", async () => {
    const { dev, testId } = await setup();
    const { sessionId, tester } = await joined(testId);
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 48);
    expect((await act(testId, "lower-length", dev.cookie, { callId: call.id, minutes: 20, reason: "We stopped early.", seenAt: seen(), confirmed: true })).status).toBe(404);
    const box = src("app/app/tests/[id]/PayBox.tsx");
    expect(box).not.toMatch(/LowerLength|lower-length|data-lower-length/);
    expect(box).toContain("const start = more ? null : p.listingCents;");
    expect(src("app/api/tests/[id]/[action]/route.ts")).not.toContain("lower-length");
    expect(src("app/app/tests/[id]/page.tsx")).not.toContain("lower={{");
    expect(src("lib/server/live.ts")).not.toContain('"lower-length"');
  });
});

describe("no excerpts on hover cards (section 23); invite search results under the box (section 29)", () => {
  it("the hover card has no excerpts; the profile keeps them", () => {
    expect(src("app/app/tests/[id]/TestersJoined.tsx")).not.toMatch(/data-hover-excerpt|excerpts\?:/);
    expect(src("app/app/tests/[id]/page.tsx")).not.toContain("shownExcerpts");
    expect(src("app/app/testers/[id]/page.tsx")).toMatch(/Excerpts/);
  });

  it("Find testers sits right under Search by name, in its own box, hidden while the box is empty", () => {
    const panel = src("app/app/tests/[id]/InvitePanel.tsx");
    const search = panel.indexOf('placeholder="Search by name"');
    const find = panel.indexOf("<h3>Find testers</h3>");
    expect(search).toBeGreaterThan(0);
    expect(find).toBeGreaterThan(search);
    expect(find).toBeLessThan(panel.indexOf("<h3>People you&apos;ve worked with</h3>"));
    expect(find).toBeLessThan(panel.indexOf("<h3>Suggested</h3>"));
    expect(panel).toContain('{term && (\n        <div className="space-y-1.5" data-invite-find="">');
    expect(panel).toContain('<ul className="max-h-64 space-y-1.5 overflow-y-auto" data-invite-found="">');
  });
});
