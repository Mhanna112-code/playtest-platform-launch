import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as excerptsPOST } from "@/app/api/excerpts/route";
import { GET as liveGET } from "@/app/api/live/route";
import { startHold } from "@/lib/server/holds";
import { pauseTest } from "@/lib/server/restrictions";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { act, atHours, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 29 sections 11-13: stopped, closed and paused tests keep the stop-once rules; your own changes in another tab stop every press once (both sides).

const later = () => new Promise((r) => setTimeout(r, 30));
afterEach(() => setStripeForTests(null));
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), ...body } })).then(json);
const ex = (cookie: string, body: Record<string, unknown>) => excerptsPOST(req("/api/excerpts", { cookie, body })).then(json);
const texts = (r: { body: { error?: { changes?: { text: string }[] } } }) => (r.body.error?.changes ?? []).map((c) => c.text);
const live = (cookie: string, scope: string, since: string, tab = "") =>
  later().then(() => liveGET(req(`/api/live?scope=${encodeURIComponent(scope)}&since=${encodeURIComponent(since)}`, { cookie, headers: tab ? { "x-tab": tab } : {} }))).then(json);
/** The page's load time, clear of the writes before and after it (Windows' clock). */
const loadedNow = async () => {
  await later();
  const t = seen();
  await later();
  return t;
};

/** A test where Ana sent written answers the developer paid $5.00 for (the answer holds an excerpt's text). */
async function paidWork(over: Record<string, unknown> = {}) {
  const s = await setup({ spots: 5, ...over });
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["The harbour level felt great, but the second boss was far too hard for me.", "Nowhere."] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "5.00", tickedCents: 500, reason: "Partly useful", seenAt: seen(), confirmed: true })).status).toBe(200);
  return { ...s, ...j, sub };
}

/** Ana's written answers are open to her Charge (the review days and her deadline passed). */
async function chargeOpen(over: Record<string, unknown> = {}, before?: (sessionId: string, cookie: string) => Promise<void>) {
  const s = await setup(over);
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId, kind: "written" } });
  if (before) await before(j.sessionId, j.tester.cookie);
  await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000) } });
  await db.test.update({ where: { id: s.testId }, data: { openUntil: new Date(Date.now() - 1000) } });
  await db.contract.updateMany({ where: { testId: s.testId }, data: { dueAt: new Date(Date.now() - 1000) } });
  await db.submission.update({ where: { id: sub.id }, data: { choiceOfferedAt: new Date() } });
  await settle();
  return { ...s, ...j, sub };
}

describe("batch 29 section 11: stopped, closed and paused tests keep the stop-once rules", () => {
  it("on a stopped test, a tester's dispute after the page loaded stops the developer's Pay once; the second press goes ahead", async () => {
    const w = await paidWork();
    const b = await joined(w.testId, "Ben Okafor", "he");
    await sact(b.sessionId, "written", b.tester.cookie, { answers: ["a", "b"] });
    const subB = await db.submission.findFirstOrThrow({ where: { contractId: b.sessionId } });
    expect((await act(w.testId, "stop", w.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    const loaded = await loadedNow();
    expect((await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.sub.id, reason: "I answered every question fully", seenAt: seen() })).status).toBe(200);
    const first = await pay(w.dev.cookie, { kind: "submission", id: subB.id, amount: "10.00", tickedCents: 1000, seenAt: loaded, tab: "B" });
    expect(first.body.error?.code).toBe("stop_once");
    expect(texts(first).some((t) => t.startsWith("Ana Silva disputed"))).toBe(true);
    const second = await pay(w.dev.cookie, { kind: "submission", id: subB.id, amount: "10.00", tickedCents: 1000, seenAt: loaded, tab: "B", confirmed: true, boxAt: seen() });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
  });

  it("the stop itself is a change: a page opened before it stops Next round once naming it", async () => {
    const { dev, testId } = await setup();
    await joined(testId);
    const loaded = await loadedNow();
    await db.test.update({ where: { id: testId }, data: { status: "stopped", stoppedAt: new Date(), adminStoppedAt: null } });
    await later();
    const r = await act(testId, "next-round", dev.cookie, { seenAt: loaded, tab: "B" });
    expect(r.body.error?.code).toBe("stop_once");
    expect(texts(r)[0]).toMatch(/^You stopped this test at .+\.$/);
  });

  it("on a paused test a payment elsewhere stops Charge once; the pause itself stops a page opened before it", async () => {
    const w = await chargeOpen({ recordingCents: "5.00" });
    // The team pauses the test after the page loaded: Charge stops once naming the pause (never why), then goes ahead.
    const before = await loadedNow();
    const admin = await makeUser({ name: "Team Admin" });
    await pauseTest(admin.user.id, w.testId, "Checking reports");
    await later();
    const p = await sact(w.sessionId, "choose", w.tester.cookie, { submissionId: w.sub.id, choice: "letgo", seenAt: before, pageSeenAt: before });
    expect(p.body.error?.code).toBe("stop_once");
    expect(texts(p)).toHaveLength(1);
    expect(texts(p)[0]).toMatch(/^This test was paused at .+\.$/);
    // A page opened while paused: a payment on her other work since then stops Charge once (no "first press goes through" any more).
    const loaded = await loadedNow();
    const rec = await db.submission.create({ data: { contractId: w.sessionId, kind: "recording", agreedCents: 500, answers: [], payBy: new Date(Date.now() + 86_400_000) } });
    await db.review.create({ data: { contractId: w.sessionId, submissionId: rec.id, amountCents: 500, reason: "", payKey: randomUUID() } });
    const r = await sact(w.sessionId, "choose", w.tester.cookie, { submissionId: w.sub.id, choice: "letgo", seenAt: loaded, pageSeenAt: loaded });
    expect(r.body.error?.code).toBe("stop_once");
    expect(texts(r)).toEqual(["Nora Lane paid $5.00 for your recording"]);
    expect(texts(r).join(" ")).not.toMatch(/hold|suspended|failed|chargeback/i);
    const again = await sact(w.sessionId, "choose", w.tester.cookie, { submissionId: w.sub.id, choice: "letgo", seenAt: loaded, pageSeenAt: loaded, confirmed: true, boxAt: seen() });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
  });

  it("on a held developer's paused test, Stop, End early and Cancel call stop once for news since the page loaded", async () => {
    const { dev, testId } = await setup({ spots: 5 });
    await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Okafor", "he");
    await startHold(dev.user.id, "unpaid");
    const loaded = await loadedNow();
    await db.testEvent.create({ data: { testId, kind: "left", text: "Cara Diaz left the test" } });
    const e = await act(testId, "end-early", dev.cookie, { contractIds: [b.sessionId], reason: "All done.", seenAt: loaded });
    expect(texts(e)).toEqual(["Cara Diaz left the test"]);
    expect((await act(testId, "end-early", dev.cookie, { contractIds: [b.sessionId], reason: "All done.", seenAt: loaded, confirmed: true, boxAt: seen() })).status).toBe(200);
  });

  it("Rate keeps its own short list on a stopped test; excerpt Allow / Deny never stop", async () => {
    const w = await paidWork();
    const b = await joined(w.testId, "Ben Okafor", "he");
    await sact(b.sessionId, "written", b.tester.cookie, { answers: ["a", "b"] });
    const subB = await db.submission.findFirstOrThrow({ where: { contractId: b.sessionId } });
    expect((await pay(w.dev.cookie, { kind: "submission", id: subB.id, amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true })).status).toBe(200);
    await db.rating.create({ data: { testId: w.testId, contractId: b.sessionId, side: "tester", raterId: b.tester.user.id, rateeId: w.dev.user.id, stars: 5 } });
    expect((await ex(w.tester.cookie, { action: "request", submissionId: w.sub.id, index: 0, text: "the second boss was far too hard" })).status).toBe(200);
    const x = await db.excerpt.findFirstOrThrow({ where: { testerId: w.tester.user.id } });
    expect((await act(w.testId, "stop", w.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    const loaded = await loadedNow();
    // News since the page loaded, and a Pay more for Ana from another tab.
    await db.testEvent.create({ data: { testId: w.testId, kind: "left", text: "Cara Diaz left the test" } });
    expect((await act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "1.00", tickedCents: 100, seenAt: seen(), confirmed: true, tab: "A" })).status).toBe(200);
    const B = { seenAt: loaded, pageSeenAt: loaded, tab: "B" };
    // Next round stops once for both.
    const n = await act(w.testId, "next-round", w.dev.cookie, B);
    expect(texts(n)).toEqual(["Cara Diaz left the test", "You paid Ana Silva $1.00 more for their written answers in another tab"]);
    // Rate Ben and the excerpt decision: through at once.
    const rate = await act(w.testId, "rate", w.dev.cookie, { contractId: b.sessionId, stars: 4, ...B });
    expect(rate.status, JSON.stringify(rate.body)).toBe(200);
    expect((await ex(w.dev.cookie, { action: "decide", excerptId: x.id, decision: "allow", ...B })).status).toBe(200);
    // The same decision made again (another tab): a plain refusal.
    expect((await ex(w.dev.cookie, { action: "decide", excerptId: x.id, decision: "allow", ...B })).body.error.message).toBe("You already allowed this excerpt.");
  });
});

describe("batch 29 section 12: the developer's own changes in another tab stop every press once, on the test page and Edit", () => {
  it("Pay in tab A stops Save on Edit in tab B once; the second Save goes ahead", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId);
    await sact(a.sessionId, "written", a.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: a.sessionId } });
    const loaded = await loadedNow();
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true, tab: "A" })).status).toBe(200);
    const s = await act(testId, "edit", dev.cookie, { version: v, fields: { description: "Sail faster" }, seenAt: loaded, tab: "B" });
    expect(s.status).toBe(409);
    expect(texts(s)).toContain("You paid Ana Silva $10.00 for the written answers in another tab");
    const v2 = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    const s2 = await act(testId, "edit", dev.cookie, { version: v2, fields: { description: "Sail faster" }, seenAt: loaded, tab: "B", confirmed: true, boxAt: seen() });
    expect(s2.status, JSON.stringify(s2.body)).toBe(200);
  });

  it("an Edit save in tab A stops Next round, End early and Request a time in tab B once; the line shows live", async () => {
    const { dev, testId } = await setup({ spots: 5 });
    const a = await joined(testId);
    const loaded = await loadedNow();
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { description: "Sail faster", spots: 6 }, seenAt: seen(), tab: "A" })).status).toBe(200);
    const line = "You saved the listing in another tab: description, spots";
    const B = { seenAt: loaded, tab: "B" };
    const n = await act(testId, "next-round", dev.cookie, B);
    expect(n.body.error?.code).toBe("stop_once");
    expect(texts(n)).toContain(line);
    const e = await act(testId, "end-early", dev.cookie, { contractIds: [a.sessionId], reason: "All done.", ...B });
    expect(texts(e)).toContain(line);
    const q = await act(testId, "request-time", dev.cookie, { contractIds: [a.sessionId], startsAt: atHours(50), ...B });
    expect(texts(q)).toContain(line);
    expect((await act(testId, "request-time", dev.cookie, { contractIds: [a.sessionId], startsAt: atHours(50), ...B, confirmed: true, boxAt: seen() })).status).toBe(200);
    // Live in the top box of tab B (the test page and Edit read the same scope); tab A never sees its own.
    const lv = await live(dev.cookie, `test:${testId}`, loaded, "B");
    expect(lv.body.changes.map((c: { text: string }) => c.text)).toContain(line);
    expect((await live(dev.cookie, `test:${testId}`, loaded, "A")).body.changes.map((c: { text: string }) => c.text)).not.toContain(line);
  });

  it("Rate and excerpt presses aren't stopped by your own changes; the same rating twice is a plain refusal", async () => {
    const w = await paidWork();
    expect((await sact(w.sessionId, "rate", w.tester.cookie, { stars: 5, seenAt: seen() })).status).toBe(200);
    expect((await ex(w.tester.cookie, { action: "request", submissionId: w.sub.id, index: 0, text: "the second boss was far too hard" })).status).toBe(200);
    const x = await db.excerpt.findFirstOrThrow({ where: { testerId: w.tester.user.id } });
    const loaded = await loadedNow();
    expect((await act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "1.00", tickedCents: 100, seenAt: seen(), confirmed: true, tab: "A" })).status).toBe(200);
    const B = { seenAt: loaded, pageSeenAt: loaded, tab: "B" };
    expect((await ex(w.dev.cookie, { action: "decide", excerptId: x.id, decision: "deny", ...B })).status).toBe(200);
    const r = await act(w.testId, "rate", w.dev.cookie, { contractId: w.sessionId, stars: 4, ...B });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await act(w.testId, "rate", w.dev.cookie, { contractId: w.sessionId, stars: 3, ...B, tab: "C" })).body.error.message).toBe("You already rated Ana Silva.");
  });
});

describe("batch 29 section 13: the tester's own changes in another tab, the same way", () => {
  it("Send in tab A stops Charge in tab B once", async () => {
    let loaded = "";
    const w = await chargeOpen({ recordingCents: "5.00" }, async (sessionId, cookie) => {
      loaded = await loadedNow();
      const up = await sact(sessionId, "recording-start", cookie, { filename: "run.mp4", size: 1000, contentType: "video/mp4", tab: "A" });
      expect(up.status, JSON.stringify(up.body)).toBe(200);
      await sact(sessionId, "recording-done", cookie, { recordingId: up.body.recordingId, tab: "A" });
      const sent = await sact(sessionId, "recording-send", cookie, { seenAt: seen(), confirmed: true, tab: "A" });
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    });
    const B = { seenAt: loaded, pageSeenAt: loaded, tab: "B" };
    const c = await sact(w.sessionId, "choose", w.tester.cookie, { submissionId: w.sub.id, choice: "charge", ...B });
    expect(c.body.error?.code).toBe("stop_once");
    expect(texts(c)).toContain("You sent your recording in another tab");
    const c2 = await sact(w.sessionId, "choose", w.tester.cookie, { submissionId: w.sub.id, choice: "charge", ...B, confirmed: true, boxAt: seen() });
    expect(c2.status, JSON.stringify(c2.body)).toBe(200);
    // The Charge, as another tab reads it.
    const later2 = await sact(w.sessionId, "request-time", w.tester.cookie, { startsAt: atHours(60), seenAt: loaded, tab: "C" });
    expect(texts(later2)).toContain("You charged Nora Lane $10.00 for your written answers in another tab");
  });

  it("a call request in A stops Dispute in B once; with Alerts Off it doesn't", async () => {
    const w = await paidWork();
    const loaded = await loadedNow();
    expect((await sact(w.sessionId, "request-time", w.tester.cookie, { startsAt: atHours(50), seenAt: seen(), confirmed: true, tab: "A" })).status).toBe(200);
    const q = await db.callRequest.findFirstOrThrow({ where: { contractId: w.sessionId, fromSide: "tester" } });
    const B = { seenAt: loaded, pageSeenAt: loaded, tab: "B" };
    const d = await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.sub.id, reason: "I answered every question fully", ...B });
    expect(d.body.error?.code).toBe("stop_once");
    expect(texts(d)).toEqual([`You requested a call for ${(await import("@/lib/format")).fmtDateTime(q.startsAt)} in another tab`]);
    // Alerts Off: own changes from another tab don't stop (they follow Alerts like the other tabs' lines).
    await db.user.update({ where: { id: w.tester.user.id }, data: { testerAlertsOff: true } });
    const d2 = await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.sub.id, reason: "I answered every question fully", ...B });
    expect(d2.status, JSON.stringify(d2.body)).toBe(200);
    // The same press again: a plain refusal.
    expect((await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.sub.id, reason: "I answered every question fully", ...B, tab: "C" })).body.error.message).toMatch(/^You already disputed this payment/);
  });

  it("Apply in A stops Join on B's join page once", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const t = await makeUser({ tester: true, name: "Dee Moss" });
    expect((await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [t.user.id] })).status).toBe(200);
    const loaded = await loadedNow();
    expect((await act(testId, "apply", t.cookie, { seenAt: seen(), tab: "A", note: "hi" })).status).toBe(200);
    const test = await db.test.findUniqueOrThrow({ where: { id: testId } });
    const j = await act(testId, "join", t.cookie, { listingVersion: test.listingVersion, seenAt: loaded, tab: "B" });
    expect(j.body.error?.code).toBe("stop_once");
    expect(texts(j)).toEqual(["You applied to join in another tab"]);
    const j2 = await act(testId, "join", t.cookie, { listingVersion: test.listingVersion, seenAt: loaded, tab: "B", confirmed: true, boxAt: seen() });
    expect(j2.status, JSON.stringify(j2.body)).toBe(200);
  });

  it("Rate in A refuses Rate in B plainly; a Rate made elsewhere stops nothing else", async () => {
    const w = await paidWork();
    const loaded = await loadedNow();
    expect((await sact(w.sessionId, "rate", w.tester.cookie, { stars: 5, seenAt: seen(), tab: "A" })).status).toBe(200);
    expect((await sact(w.sessionId, "rate", w.tester.cookie, { stars: 4, seenAt: loaded, tab: "B" })).body.error.message).toBe("You already rated Nora Lane.");
    expect(await db.actionLog.count({ where: { userId: w.tester.user.id, text: { contains: "rated" } } })).toBe(0);
  });
});
