import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { dropLine } from "@/lib/requestDrop";
import { requestWords } from "@/lib/server/testerGate";
import { ndaNoticeOpen } from "@/lib/ndaNotice";
import { act, atHours, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 6, §312) a: call-request, booked and cancelled-call bells name the test; b: "<dev> updated the listing: …" is in its test's own day stack; c: no bell
// for a key given; d: no "Work sent" bell for a first send; e: a rejoined session page starts fresh (no NDA notice or block from the earlier stint).

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const bells = (userId: string, text: string) => db.notification.findMany({ where: { userId, text: { contains: text } }, orderBy: { createdAt: "asc" } });

describe("§312a call-request and call bells name the test", () => {
  it("the line builders: the bell's words with the test, the page's without", () => {
    const at = new Date("2026-11-11T17:00:00Z");
    expect(R.cancelLine("Omar Reyes", at, "", "Harbor Run")).toMatch(/^Omar Reyes cancelled the call on “Harbor Run” on .+\.$/);
    expect(R.cancelLine("Omar Reyes", at, "")).toMatch(/^Omar Reyes cancelled the call on (?!“).+\.$/);
    expect(R.callCancelledLine(at, "paused", "Harbor Run")).toMatch(/^Your call on “Harbor Run” on .+ was cancelled because the test is paused\.$/);
    const one = { times: [at], startsAt: at, weeks: 0, repeat: "once" };
    expect(requestWords(one, "Wed, Nov 11, 11:00 AM CST", " on “Harbor Run”")).toBe("a call on “Harbor Run” for Wed, Nov 11, 11:00 AM CST");
    expect(requestWords(one, "Wed, Nov 11, 11:00 AM CST")).toBe("a call for Wed, Nov 11, 11:00 AM CST");
    expect(dropLine({ reason: "x", side: "tester", fromReader: false, other: "Nora Lane", when: "Wed", partial: false, on: " on “Harbor Run”" })).toMatch(/^Nora Lane's request on “Harbor Run” for Wed closed: /);
  });

  it("requested, asked, declined, withdrawn and cancelled: each bell names the test (the top box's lines don't)", async () => {
    const f = await setup();
    const a = await joined(f.testId, "Ana Silva");
    // The developer's request: the tester's bell.
    expect((await act(f.testId, "request-time", f.dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [a.sessionId], minutes: 30, times: [atHours(50)] })).status).toBe(200);
    expect((await bells(a.tester.user.id, "requested"))[0].text).toMatch(/^Nora Lane requested a call on “Harbor Run” for .+$/);
    // The tester's request: the developer's bell; the developer declines it: the tester's bell.
    expect((await sact(a.sessionId, "request-time", a.tester.cookie, { seenAt: seen(), confirmed: true, minutes: 30, times: [atHours(60)] })).status).toBe(200);
    expect((await bells(f.dev.user.id, "asked for a call"))[0].text).toMatch(/^Ana Silva asked for a call on “Harbor Run”: .+$/);
    const mine = await db.callRequest.findFirstOrThrow({ where: { contractId: a.sessionId, fromSide: "tester", status: "pending" } });
    expect((await act(f.testId, "answer-request", f.dev.cookie, { contractId: a.sessionId, requestId: mine.id, action: "decline", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await bells(a.tester.user.id, "declined"))[0].text).toMatch(/^Nora Lane declined your call request on “Harbor Run” for .+$/);
    // The developer withdraws hers: the tester's bell.
    const theirs = await db.callRequest.findFirstOrThrow({ where: { contractId: a.sessionId, fromSide: "developer", status: "pending" } });
    expect((await act(f.testId, "answer-request", f.dev.cookie, { contractId: a.sessionId, requestId: theirs.id, action: "withdraw", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await bells(a.tester.user.id, "withdrew"))[0].text).toMatch(/^Nora Lane withdrew a call request on “Harbor Run” for .+$/);
    // A booked call cancelled by the developer: the tester's bell.
    const call = await bookCall(f.testId, f.dev.cookie, a.sessionId, a.tester.cookie);
    expect((await act(f.testId, "cancel-call", f.dev.cookie, { seenAt: seen(), callId: call.id })).status).toBe(200);
    expect((await bells(a.tester.user.id, "cancelled the call"))[0].text).toMatch(/^Nora Lane cancelled the call on “Harbor Run” on .+\.$/);
    // The top box's own lines keep their words (the page names the test).
    expect(await db.testEvent.count({ where: { testId: f.testId, text: { contains: "“Harbor Run”" }, kind: { in: ["requested", "declined_req", "withdrew_req", "cancelled"] } } })).toBe(0);
  });
});

describe("§312b \"updated the listing: …\" is in its test's own day stack", () => {
  it("no group, the test named", async () => {
    const f = await setup();
    const a = await joined(f.testId, "Ana Silva");
    const v = (await db.test.findUniqueOrThrow({ where: { id: f.testId } })).version;
    expect((await act(f.testId, "edit", f.dev.cookie, { version: v, fields: { writtenCents: "12.00" }, seenAt: seen(), confirmed: true })).status).toBe(200);
    const line = (await bells(a.tester.user.id, "updated the listing: "))[0];
    expect(line).toMatchObject({ groupKey: null, testId: f.testId });
    expect(src("lib/server/terms.ts")).not.toContain('group: "newterms"');
  });
});

describe("§312c and §312d: lines removed", () => {
  it("no bell for a key given (its top-box line stays); no \"Work sent\" bell for a first send (an addition keeps its line)", async () => {
    const t = src("lib/server/tests.ts");
    expect(t).not.toContain("keyGivenToYouLine(displayName(dev), result.title)");
    expect(t).toContain("for (const g of keysGiven) await logEvent(testId, KEY_GIVEN,");
    expect(t).not.toContain("`Work sent: your ${part} for");
    expect(t).toContain("if (added) await notify(tester.email, youAddedLine(");
    const f = await setup();
    const a = await joined(f.testId, "Ana Silva");
    const n = ((await db.contract.findUniqueOrThrow({ where: { id: a.sessionId } })).questions as string[]).length || 1;
    expect((await sact(a.sessionId, "written", a.tester.cookie, { answers: Array(n).fill("answer") })).status).toBe(200);
    await settle();
    expect(await db.notification.count({ where: { userId: a.tester.user.id, text: { startsWith: "Work sent" } } })).toBe(0);
  });
});

describe("§312e a rejoined session page starts fresh", () => {
  it("an NDA change from the earlier stint: no notice and no block after rejoining; open offers superseded; old cancelled calls not listed", async () => {
    const f = await setup({ joinMode: "anyone" });
    const a = await joined(f.testId, "Ana Silva");
    // The earlier stint: an NDA change she never acknowledged.
    await db.contract.update({ where: { id: a.sessionId }, data: { ndaChangedAt: new Date(Date.now() - 3_600_000), ndaChangeKind: "changed", ndaNoticeSeenAt: null } });
    expect(ndaNoticeOpen(await db.contract.findUniqueOrThrow({ where: { id: a.sessionId } }))).toBe(true);
    expect((await sact(a.sessionId, "leave", a.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    const lv = (await db.test.findUniqueOrThrow({ where: { id: f.testId } })).listingVersion;
    expect((await act(f.testId, "rejoin-ask", a.tester.cookie, { listingVersion: lv, seenAt: seen(), confirmed: true, anyway: true })).status).toBe(200);
    await settle();
    const app = await db.application.findFirstOrThrow({ where: { testId: f.testId, testerId: a.tester.user.id } });
    expect((await act(f.testId, "application", f.dev.cookie, { applicationId: app.id, decision: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
    const c = await db.contract.findUniqueOrThrow({ where: { id: a.sessionId } });
    expect(c).toMatchObject({ status: "working", ndaChangedAt: null, ndaChangeKind: "", ndaNoticeSeenAt: null });
    expect(ndaNoticeOpen(c)).toBe(false);
    // Her presses go through (no NDA block): a call request.
    expect((await sact(a.sessionId, "request-time", a.tester.cookie, { seenAt: seen(), confirmed: true, minutes: 30, times: [atHours(70)] })).status).toBe(200);
    expect(await db.termsOffer.count({ where: { contractId: c.id, status: "open" } })).toBe(0);
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("!(x.cancelledAt && x.cancelledAt < c.joinedAt)");
  }, 60_000);
});
