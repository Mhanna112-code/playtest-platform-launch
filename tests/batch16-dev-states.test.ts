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
import { json, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 16 sections 22 (now Batch 17 §19: Pay more closes with the test's last Pay / Charge), 25 (developer), 26, plus 23 and 29: in a stopped / paused state what still works goes
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

describe("Pay more closes with the test's last Pay / Charge (Batch 17 §19 replaces section 22's 30 days after the test ended)", () => {
  it("the rule: the grey line in its last 7 days; the refusal line", () => {
    const now = new Date("2026-12-01T12:00:00Z");
    const at = (days: number) => new Date(now.getTime() + days * DAY);
    expect(R.closeOutSoon(null, now)).toBe(false); // not known yet: the test still runs
    expect(R.closeOutSoon(at(8), now)).toBe(false);
    expect(R.closeOutSoon(at(6), now)).toBe(true);
    expect(R.closeOutSoon(at(-1), now)).toBe(false); // closed
    expect(R.payClosesLine("Dec 2, 2026", true)).toBe("Pay more closes on Dec 2, 2026.");
    expect(R.payClosedLine("Dec 2, 2026", true)).toBe("Pay more closed on Dec 2, 2026.");
  });

  it("(server) open until the test's last Pay / Charge closes, refused after it; the page hides the box once closed and shows the line before", async () => {
    await db.outage.deleteMany({}); // (site-wide: an earlier file's outage would move the date)
    const w = await paidWork();
    const body = { contractId: w.sessionId, submissionId: w.sub.id, amount: "1.00", tickedCents: 100, seenAt: seen(), confirmed: true };
    // Every deadline 20 days ago (close-out 6 days ago), but the piece was sent late: its Charge opened 13 days ago, so its window (and Pay more) ends tomorrow.
    await db.contract.updateMany({ where: { testId: w.testId }, data: { dueAt: new Date(Date.now() - 20 * DAY) } });
    await db.test.update({ where: { id: w.testId }, data: { openUntil: new Date(Date.now() - 20 * DAY) } });
    await db.submission.update({ where: { id: w.sub.id }, data: { payBy: new Date(Date.now() - 13 * DAY) } });
    expect((await act(w.testId, "pay-extra", w.dev.cookie, body)).status).toBe(200);
    const payBy = new Date(Date.now() - 15 * DAY);
    await db.submission.update({ where: { id: w.sub.id }, data: { payBy } });
    const r = await act(w.testId, "pay-extra", w.dev.cookie, { ...body, amount: "0.50", tickedCents: 50 });
    expect(r.body.error.message).toBe(`Pay more closed on ${fmtDate(new Date(payBy.getTime() + 14 * DAY))}.`);
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page).toContain("const payMoreAt = await payMoreClosesAt(t.id, now);");
    expect(page.match(/payMore\.open && \(rooms\.get/g)).toHaveLength(2);
    expect(page.match(/note=\{payMore\.line \|\| undefined\}/g)).toHaveLength(2);
  });
});

// (Owner, Oct 29, batch 29 section 11) Section 25's "goes through on the first press" is replaced: what still works follows the same stop-once rules as on a running test.
describe("developer, stopped / closed or paused / held: what still works follows the running test's stop-once rules (batch 29 section 11)", () => {
  it("stopped: Pay, Pay more and Next round stop once for news and other tabs; the side of a dispute keeps its rules; Rate keeps its own list", async () => {
    const w = await paidWork({ recordingCents: "5.00" });
    const b = await joined(w.testId, "Ben Carter", "he");
    await sact(b.sessionId, "written", b.tester.cookie, { answers: ["a", "b"] });
    const subB = await db.submission.findFirstOrThrow({ where: { contractId: b.sessionId } });
    expect((await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.sub.id, reason: "I answered every question fully" })).status).toBe(200);
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: w.sub.id } });
    await db.rating.create({ data: { testId: w.testId, contractId: b.sessionId, side: "tester", raterId: b.tester.user.id, rateeId: w.dev.user.id, stars: 5 } });
    expect((await act(w.testId, "stop", w.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    await later();
    const loaded = seen();
    await later();
    // News since the page loaded: a tester's line, and a change from another tab.
    await db.testEvent.create({ data: { testId: w.testId, kind: "left", text: "Cara Diaz left the test" } });
    expect((await act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "1.00", tickedCents: 100, seenAt: seen(), confirmed: true, tab: "A" })).status).toBe(200);
    const B = { seenAt: loaded, tab: "B" };
    const news = ["Cara Diaz left the test", "You paid Ana Silva $1.00 more for their written answers in another tab"];
    const p1 = await pay(w.dev.cookie, { kind: "submission", id: subB.id, amount: "10.00", tickedCents: 1000, ...B, confirmed: false });
    expect(p1.body.error.changes.map((c: { text: string }) => c.text)).toEqual(news);
    expect((await pay(w.dev.cookie, { kind: "submission", id: subB.id, amount: "10.00", tickedCents: 1000, ...B, confirmed: true, boxAt: seen() })).status).toBe(200);
    expect((await act(w.testId, "dispute-side", w.dev.cookie, { disputeId: d.id, text: "They skipped two answers", ...B })).status).toBe(200);
    // Rate Ben: its own short list (everything was settled before the developer's Rate opened; your own changes never stop it).
    const rate = await act(w.testId, "rate", w.dev.cookie, { contractId: b.sessionId, stars: 4, ...B });
    expect(rate.status, JSON.stringify(rate.body)).toBe(200);
    // Next round on the stopped test: stops once, then goes ahead.
    expect((await act(w.testId, "next-round", w.dev.cookie, B)).body.error.code).toBe("stop_once");
    expect((await act(w.testId, "next-round", w.dev.cookie, { ...B, confirmed: true, boxAt: seen() })).status).toBe(200);
    // Repeats are plain refusals.
    expect((await act(w.testId, "dispute-side", w.dev.cookie, { disputeId: d.id, text: "Again", ...B })).body.error.message).toBe("You already sent your side.");
  });

  it("paused (a payment hold): Stop, End early and Cancel call stop once for news, then go ahead", async () => {
    const { dev, testId } = await setup({ spots: 5 });
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Okafor");
    const call = await bookCall(testId, dev.cookie, a.sessionId, a.tester.cookie, 24 * 6);
    await startHold(dev.user.id, "unpaid");
    await later();
    const loaded = seen();
    await later();
    await db.testEvent.create({ data: { testId, kind: "left", text: "Cara Diaz left the test" } });
    expect((await act(testId, "cancel-call", dev.cookie, { callId: call.id, seenAt: loaded })).body.error.code).toBe("stop_once");
    expect((await act(testId, "cancel-call", dev.cookie, { callId: call.id, seenAt: loaded, confirmed: true, boxAt: seen() })).status).toBe(200);
    expect((await act(testId, "end-early", dev.cookie, { contractIds: [b.sessionId], reason: "All done.", seenAt: loaded })).body.error.code).toBe("stop_once");
    expect((await act(testId, "end-early", dev.cookie, { contractIds: [b.sessionId], reason: "All done.", seenAt: loaded, confirmed: true, boxAt: seen() })).status).toBe(200);
    expect((await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen() })).status).toBe(200);
  });

  it("excerpt Allow / Deny: never stopped by your own changes in another tab (batch 29 section 12)", async () => {
    const w = await paidWork();
    await later();
    const loaded = seen();
    await later();
    expect((await act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "1.00", tickedCents: 100, seenAt: seen(), confirmed: true, tab: "A" })).status).toBe(200);
    expect((await ex(w.dev.cookie, { action: "decide", excerptId: "nope", decision: "allow", seenAt: loaded })).body.error.message).toBe("This request was already decided.");
    expect(src("lib/server/excerpts.ts")).not.toContain("bigOwnGate");
  });

  it("a state that began after the page loaded is news: Stop in another tab still stops this tab's Stop once (section 21)", async () => {
    const { dev, testId } = await setup();
    await later();
    const loaded = seen();
    await later();
    expect((await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true, tab: "A" })).status).toBe(200);
    expect((await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: loaded, tab: "B" })).body.error.code).toBe("stop_once");
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
