import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { busyLine, clashNotes, localFmt } from "@/lib/callClash";
import { DROP_DEV_BUSY } from "@/lib/requestDrop";
import { busyTimes } from "@/lib/server/requests";
import { json, makeUser, req } from "./helpers";
import { act, atHours, bookCall, joined, listingBody, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 6, §292) No call request at a time that clashes with a call the RECIPIENT already has booked with someone else (this test or any other), the
// overlap Accept uses. The refusal names the time, never who that call is with: "Nora Lane already has a call booked at Wed, Nov 11, 12:00 PM: pick another
// time." A daily / weekly row is refused for its clashing call, naming it. Requests already waiting when a call is booked are still dropped (§184).

const fmt = localFmt("UTC");
const plus = (iso: string, min: number) => new Date(new Date(iso).getTime() + min * 60_000).toISOString();
const once = (startsAt: string) => ({ rows: [{ startsAt, repeat: "once", count: 1 }] });
const testerReq = (sessionId: string, cookie: string, extra: Record<string, unknown>) => sact(sessionId, "request-time", cookie, { seenAt: seen(), confirmed: true, minutes: "30", ...extra });
const devReq = (testId: string, cookie: string, contractIds: string[], extra: Record<string, unknown>) => act(testId, "request-time", cookie, { seenAt: seen(), confirmed: true, minutes: "30", contractIds, ...extra });
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");

/** A second developer's test, with the given tester joined to it: its session id. */
async function otherDevTest(testerCookie: string) {
  const dev2 = await makeUser({ dev: true, name: "Omar Reyes", pronoun: "he" });
  await db.user.update({ where: { id: dev2.user.id }, data: { stripePaymentMethodId: "pm_test_saved", cardExpMonth: 12, cardExpYear: 2030 } });
  const r = await json(await testsPOST(req("/api/tests", { cookie: dev2.cookie, body: listingBody({ productName: "Night Ferry", title: "Night Ferry" }) })));
  expect(r.status).toBe(200);
  await settle();
  const testId = r.body.id as string;
  const test = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const j = await act(testId, "join", testerCookie, { listingVersion: test.listingVersion });
  expect(j.status).toBe(200);
  await settle();
  return { dev2, testId, sessionId: j.body.sessionId as string };
}

describe("§292 a request can't be sent for a time the other person already has booked", () => {
  it("a tester's request overlapping the developer's call with another tester is refused with the neutral line (no name); a free time still goes", async () => {
    const { dev, testId } = await setup();
    const dee = await joined(testId, "Dee Moss", "she");
    const bb = await joined(testId, "Bo Brown", "he");
    const call = await bookCall(testId, dev.cookie, dee.sessionId, dee.tester.cookie, 48);
    const t = call.startsAt.toISOString();
    const r = await testerReq(bb.sessionId, bb.tester.cookie, once(plus(t, 3)));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "clash", message: busyLine("Nora Lane", fmt.at(call.startsAt)) });
    expect(r.body.error.message).toBe(`Nora Lane already has a call booked at ${fmt.at(call.startsAt)}: pick another time.`);
    expect(JSON.stringify(r.body)).not.toContain("Dee");
    expect(await db.callRequest.count({ where: { contractId: bb.sessionId } })).toBe(0);
    // Right after the call ends: free.
    expect((await testerReq(bb.sessionId, bb.tester.cookie, once(plus(t, 30)))).status).toBe(200);
  });

  it("the developer's request overlapping the tester's call on another developer's test is refused (no name); ticked with a free tester, a stop names it and the others go", async () => {
    const { dev, testId } = await setup();
    const dee = await joined(testId, "Dee Moss", "she");
    const bb = await joined(testId, "Bo Brown", "he");
    const other = await otherDevTest(dee.tester.cookie);
    const call = await bookCall(other.testId, other.dev2.cookie, other.sessionId, dee.tester.cookie, 50);
    const at = plus(call.startsAt.toISOString(), 10);
    const line = busyLine("Dee Moss", fmt.at(call.startsAt));
    const r = await devReq(testId, dev.cookie, [dee.sessionId], once(at));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "clash", message: line });
    expect(JSON.stringify(r.body)).not.toContain("Omar");
    expect(JSON.stringify(r.body)).not.toContain("Night Ferry");
    expect(await db.callRequest.count({ where: { contractId: dee.sessionId } })).toBe(0);
    // Dee and Bo ticked: one stop naming Dee's busy time; the second press sends to Bo only.
    const both = await devReq(testId, dev.cookie, [dee.sessionId, bb.sessionId], once(at));
    expect(both.status).toBe(409);
    expect(both.body.error.code).toBe("stop_once");
    expect(JSON.stringify(both.body.error)).toContain(line);
    const again = await devReq(testId, dev.cookie, [dee.sessionId, bb.sessionId], { ...once(at), limitSeen: line });
    expect(again.status).toBe(200);
    expect(await db.callRequest.count({ where: { contractId: bb.sessionId, status: "pending" } })).toBe(1);
    expect(await db.callRequest.count({ where: { contractId: dee.sessionId } })).toBe(0);
  });

  it("the developer's request overlapping the tester's call with the same developer on another test is refused too", async () => {
    const { dev, testId } = await setup();
    const dee = await joined(testId, "Dee Moss", "she");
    const r2 = await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ productName: "Second Run", title: "Second Run" }) })));
    expect(r2.status).toBe(200);
    await settle();
    const test2 = await db.test.findUniqueOrThrow({ where: { id: r2.body.id as string } });
    const j2 = await act(test2.id, "join", dee.tester.cookie, { listingVersion: test2.listingVersion });
    expect(j2.status).toBe(200);
    await settle();
    const call = await bookCall(test2.id, dev.cookie, j2.body.sessionId as string, dee.tester.cookie, 52);
    const r = await devReq(testId, dev.cookie, [dee.sessionId], once(plus(call.startsAt.toISOString(), 15)));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("clash");
  });

  it("a weekly set whose 2nd call clashes is refused, naming that call and the busy time", async () => {
    const { dev, testId } = await setup();
    const dee = await joined(testId, "Dee Moss", "she");
    const bb = await joined(testId, "Bo Brown", "he");
    const call = await bookCall(testId, dev.cookie, dee.sessionId, dee.tester.cookie, 48 + 168);
    const first = plus(new Date(call.startsAt.getTime() - 7 * 86_400_000).toISOString(), 5);
    const r = await testerReq(bb.sessionId, bb.tester.cookie, { rows: [{ startsAt: first, repeat: "weekly", count: 2 }] });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "clash", message: `The 2nd call (${fmt.day(new Date(plus(first, 7 * 1440)))}): Nora Lane already has a call booked at ${fmt.at(call.startsAt)}: pick another time.` });
    expect(await db.callRequest.count({ where: { contractId: bb.sessionId } })).toBe(0);
    // One week only (no 2nd call): fine.
    expect((await testerReq(bb.sessionId, bb.tester.cookie, once(first))).status).toBe(200);
  });

  it("requests already waiting when the call is booked are still dropped (§184)", async () => {
    const { dev, testId } = await setup();
    const dee = await joined(testId, "Dee Moss", "she");
    const bb = await joined(testId, "Bo Brown", "he");
    const t = atHours(60);
    expect((await testerReq(bb.sessionId, bb.tester.cookie, once(plus(t, 3)))).status).toBe(200);
    const waiting = await db.callRequest.findFirstOrThrow({ where: { contractId: bb.sessionId, status: "pending" } });
    expect((await devReq(testId, dev.cookie, [dee.sessionId], once(t))).status).toBe(200);
    const q = await db.callRequest.findFirstOrThrow({ where: { contractId: dee.sessionId, status: "pending" } });
    expect((await sact(dee.sessionId, "answer-request", dee.tester.cookie, { requestId: q.id, action: "accept", seenAt: seen(), confirmed: true })).body.booked).toBe(true);
    expect(await db.callRequest.findUniqueOrThrow({ where: { id: waiting.id } })).toMatchObject({ status: "closed", closedReason: DROP_DEV_BUSY });
  });

  it("the form: the same red line at the row (a set's call named); the pages pass bare time ranges, never names", async () => {
    const base = "2026-11-11T12:00:00.000Z";
    const busy = [{ start: base, minutes: 30 }];
    const one = clashNotes({ rows: [{ startsAt: "2026-11-11T12:03:00.000Z", repeat: "once", count: 1 }], minutes: 30, side: "tester", targets: [{ name: "fbbb", calls: [], requests: [], busy }], elsewhere: [], fmt });
    expect(one.rows[0]).toEqual([{ tone: "red", text: "fbbb already has a call booked at Wed, Nov 11, 12:00 PM: pick another time." }]);
    const set = clashNotes({ rows: [{ startsAt: "2026-11-04T12:10:00.000Z", repeat: "weekly", count: 3 }], minutes: 30, side: "developer", targets: [{ name: "Dee Moss", calls: [], requests: [], busy }], elsewhere: [], fmt });
    expect(set.rows[0][0]).toEqual({ tone: "red", text: "The 2nd call (Wed, Nov 11): Dee Moss already has a call booked at Wed, Nov 11, 12:00 PM: pick another time." });
    const free = clashNotes({ rows: [{ startsAt: "2026-11-11T12:30:00.000Z", repeat: "once", count: 1 }], minutes: 30, side: "tester", targets: [{ name: "fbbb", calls: [], requests: [], busy }], elsewhere: [], fmt });
    expect(free.rows[0]).toEqual([]);
    // busyTimes: the other person's calls with others only (this pair's own left out), as { start, minutes }.
    const { dev, testId } = await setup();
    const dee = await joined(testId, "Dee Moss", "she");
    const bb = await joined(testId, "Bo Brown", "he");
    const call = await bookCall(testId, dev.cookie, dee.sessionId, dee.tester.cookie, 70);
    const forBo = await busyTimes("developer", dev.user.id, bb.sessionId);
    expect(forBo).toEqual([{ start: call.startsAt.toISOString(), minutes: call.minutes }]);
    expect(await busyTimes("developer", dev.user.id, dee.sessionId)).toEqual([]);
    expect(src("app/app/sessions/[id]/page.tsx")).toContain('busy: await busyTimes("developer", c.test.developerId, c.id),');
    expect(src("app/app/tests/[id]/page.tsx")).toContain("busy: testerBusy.filter((x) => x.contract.testerId === c.testerId && x.contractId !== c.id).map((x) => ({ start: x.startsAt.toISOString(), minutes: x.minutes })),");
  });
});
