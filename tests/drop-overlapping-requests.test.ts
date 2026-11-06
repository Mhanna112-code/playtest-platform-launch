import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { GET as liveGET } from "@/app/api/live/route";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { DROP_BOTH, DROP_DEV_BUSY, DROP_TESTER_BUSY } from "@/lib/requestDrop";
import { topUpForeverSets } from "@/lib/server/requests";
import { json, makeUser, req } from "./helpers";
import { act, atHours, joined, listingBody, oldChooseOne, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 4, §184) The moment a call is booked, every OTHER waiting call request of either person in it (any test, sent by either side) whose time overlaps
// the call is dropped: a single time closes, a "choose one" request loses only the overlapping times (closing when none is left). The request's other person is
// told without naming who the call is with; the person with the call gets a quiet live-box line. An Accept on a dropped request is a single refusal.

const later = () => new Promise((r) => setTimeout(r, 30));
const plus = (iso: string, min: number) => new Date(new Date(iso).getTime() + min * 60_000).toISOString();
type Line = { text: string; quiet?: boolean; alert?: string };
const live = async (scope: string, cookie: string, since: string) =>
  (await json(await liveGET(req(`/api/live?scope=${scope}&since=${encodeURIComponent(since)}`, { cookie, method: "GET" })))).body.changes as Line[];
const devReq = (testId: string, cookie: string, contractId: string, extra: Record<string, unknown>) =>
  act(testId, "request-time", cookie, { seenAt: seen(), confirmed: true, contractIds: [contractId], minutes: 30, ...extra });
const testerReq = (sessionId: string, cookie: string, extra: Record<string, unknown>) => sact(sessionId, "request-time", cookie, { seenAt: seen(), confirmed: true, minutes: 30, ...extra });
const pendingFrom = (contractId: string, fromSide: string) => db.callRequest.findFirstOrThrow({ where: { contractId, fromSide, status: "pending" }, orderBy: { createdAt: "desc" } });
const row = (id: string) => db.callRequest.findUniqueOrThrow({ where: { id } });
/** Another developer's test (or the same developer's second one): returns its id. */
async function anotherTest(dev: { user: { id: string }; cookie: string }, title = "Night Ferry") {
  const r = await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ productName: title, title }) })));
  expect(r.status).toBe(200);
  await settle();
  return r.body.id as string;
}
const T_ = ".+ (?:AM|PM)(?: [A-Z]+)?"; // a time as the live box writes it

describe("§184: a booking drops the other waiting requests that overlap it", () => {
  it("single time: the developer's request to another tester closes; that tester is told without naming who; the developer's own line is quiet; Accept is a single refusal", async () => {
    const { dev, testId } = await setup({ spots: 5 });
    const ana = await joined(testId, "Ana Silva", "she");
    const ben = await joined(testId, "Ben Carter", "he");
    const t = atHours(60);
    expect((await devReq(testId, dev.cookie, ana.sessionId, { times: [t] })).status).toBe(200);
    expect((await devReq(testId, dev.cookie, ben.sessionId, { times: [t] })).status).toBe(200);
    const ra = await pendingFrom(ana.sessionId, "developer");
    const rb = await pendingFrom(ben.sessionId, "developer");
    const benLoaded = seen(), devLoaded = seen();
    await later();
    expect((await sact(ana.sessionId, "answer-request", ana.tester.cookie, { requestId: ra.id, action: "accept", seenAt: seen(), confirmed: true })).body.booked).toBe(true);
    // Closed at once, in the booking's own transaction.
    expect(await row(rb.id)).toMatchObject({ status: "closed", closedReason: DROP_DEV_BUSY });
    // Ben (the other side): an ordinary call-change line, never naming Ana.
    const benLines = await live(`session:${ben.sessionId}`, ben.tester.cookie, benLoaded);
    const benDrop = benLines.filter((l) => / closed: /.test(l.text));
    expect(benDrop).toHaveLength(1);
    expect(benDrop[0].text).toMatch(new RegExp(`^Nora Lane's request for ${T_} closed: she is no longer free at that time$`));
    expect(benDrop[0].quiet).toBe(true); // (Owner, Nov 4, §185) quiet now, with a bell
    const benBell = await db.notification.findMany({ where: { userId: ben.tester.user.id, groupKey: "callrequests", text: { contains: " closed: " } } }); // (§286) the day's stack across tests
    expect(benBell.map((n) => n.text)).toEqual([expect.stringMatching(/^Nora Lane's request for .+ closed: she is no longer free at that time$/)]);
    expect(await db.notification.count({ where: { userId: dev.user.id, groupKey: "callrequests", text: { contains: " closed: " } } })).toBe(0); // the developer has the call: no bell
    expect(benLines.map((l) => l.text).join(" | ")).not.toContain("Ana");
    // The developer (her booking was Ana's Accept): her own dropped request, a quiet line.
    const devLines = await live(`test:${testId}`, dev.cookie, devLoaded);
    const devDrop = devLines.filter((l) => / closed: /.test(l.text));
    expect(devDrop).toHaveLength(1);
    expect(devDrop[0]).toMatchObject({ quiet: true });
    expect(devDrop[0].text).toMatch(new RegExp(`^Your request to Ben Carter for ${T_} closed: you have another call at that time$`));
    // Ben's Accept on the stale page: one refusal, "already closed", naming nobody else.
    const acc = await sact(ben.sessionId, "answer-request", ben.tester.cookie, { requestId: rb.id, action: "accept", seenAt: benLoaded });
    expect(acc.status).toBe(409);
    expect(acc.body.error).toMatchObject({ code: "gone", message: "This request closed: Nora Lane is no longer free at that time." });
    // The open Call requests panel's row reads it in each reader's words.
    const gone = async (cookie: string) => (await json(await pulseGET(req(`/api/pulse?requests=${rb.id}`, { cookie, method: "GET" })))).body.gone[0].line as string;
    expect(await gone(ben.tester.cookie)).toBe("Closed: Nora Lane is no longer free at that time");
    expect(await gone(dev.cookie)).toBe("Closed: you have another call at that time");
    // (Owner, Nov 4, §185) Ben's next press no longer stops for the line (quiet, with his bell); the developer's never did for her quiet one.
    const press = await sact(ben.sessionId, "request-time", ben.tester.cookie, { times: [atHours(90)], minutes: 30, seenAt: benLoaded });
    expect(press.status).toBe(200);
    const devPress = await act(testId, "request-time", dev.cookie, { contractIds: [ben.sessionId], times: [atHours(100)], minutes: 30, seenAt: devLoaded });
    expect(JSON.stringify(devPress.body)).not.toContain("closed: you have another call");
  });

  it("a tester's 'choose one' request to the developer: only the overlapping time is taken out; both told; Accept on the time left still books", async () => {
    const { dev, testId } = await setup({ spots: 5 });
    const ana = await joined(testId, "Ana Silva", "she");
    const ben = await joined(testId, "Ben Carter", "he");
    const t = atHours(60), t2 = atHours(84);
    // (§208) An older "choose one" request still waiting (none is made now).
    await oldChooseOne(ben.sessionId, "tester", [t, t2]);
    const rb = await pendingFrom(ben.sessionId, "tester");
    expect((await devReq(testId, dev.cookie, ana.sessionId, { times: [t] })).status).toBe(200);
    const ra = await pendingFrom(ana.sessionId, "developer");
    const loaded = seen();
    await later();
    await sact(ana.sessionId, "answer-request", ana.tester.cookie, { requestId: ra.id, action: "accept", seenAt: seen(), confirmed: true });
    const left = await row(rb.id);
    expect(left.status).toBe("pending");
    expect(left.times.map((d) => d.toISOString())).toEqual([t2]);
    expect(left.startsAt.toISOString()).toBe(t2);
    const benLine = (await live(`session:${ben.sessionId}`, ben.tester.cookie, loaded)).filter((l) => /no longer offers/.test(l.text));
    expect(benLine.map((l) => l.text)).toEqual([expect.stringMatching(new RegExp(`^Your request to Nora Lane no longer offers ${T_}: she is no longer free at that time$`))]);
    const devLine = (await live(`test:${testId}`, dev.cookie, loaded)).filter((l) => /no longer offers/.test(l.text));
    expect(devLine).toHaveLength(1);
    expect(devLine[0]).toMatchObject({ quiet: true });
    expect(devLine[0].text).toMatch(new RegExp(`^Ben Carter's request no longer offers ${T_}: you have another call at that time$`));
    // The time left is still bookable.
    const acc = await act(testId, "answer-request", dev.cookie, { contractId: ben.sessionId, requestId: rb.id, action: "accept", time: t2, seenAt: seen(), confirmed: true });
    expect(acc.body.booked).toBe(true);
  });

  it("a 'choose one' request whose every time overlaps closes", async () => {
    const { dev, testId } = await setup({ spots: 5 });
    const ana = await joined(testId, "Ana Silva", "she");
    const ben = await joined(testId, "Ben Carter", "he");
    const t = atHours(60);
    await oldChooseOne(ben.sessionId, "tester", [plus(t, -20), plus(t, 25)]); // (§208) an older "choose one" request still waiting

    const rb = await pendingFrom(ben.sessionId, "tester");
    expect((await devReq(testId, dev.cookie, ana.sessionId, { times: [t] })).status).toBe(200);
    const ra = await pendingFrom(ana.sessionId, "developer");
    const loaded = seen();
    await later();
    await sact(ana.sessionId, "answer-request", ana.tester.cookie, { requestId: ra.id, action: "accept", seenAt: seen(), confirmed: true });
    expect(await row(rb.id)).toMatchObject({ status: "closed", closedReason: DROP_DEV_BUSY });
    const benLine = (await live(`session:${ben.sessionId}`, ben.tester.cookie, loaded)).filter((l) => / closed: /.test(l.text));
    expect(benLine.map((l) => l.text)).toEqual([expect.stringMatching(new RegExp(`^Your request to Nora Lane for ${T_} closed: she is no longer free at that time$`))]);
    // The developer's Accept on it (a stale page, nothing seen since): a single refusal, never a stop first.
    const acc = await act(testId, "answer-request", dev.cookie, { contractId: ben.sessionId, requestId: rb.id, action: "accept", time: plus(t, 25), seenAt: loaded });
    expect(acc.body.error).toMatchObject({ code: "gone", message: "This request closed: you have another call at that time." });
  });

  it("a tester's requests on ANOTHER developer's test (both directions) close; that developer is told, never who the call is with; Accept is a single refusal", async () => {
    const { dev: nora, testId: X } = await setup({ spots: 5 });
    const omar = await makeUser({ dev: true, name: "Omar Reed", pronoun: "he" });
    const Y = await anotherTest(omar, "Night Ferry");
    const ana = await joined(X, "Ana Silva", "she");
    const anaY = await db.contract.findUniqueOrThrow({ where: { id: (await act(Y, "join", ana.tester.cookie, { listingVersion: (await db.test.findUniqueOrThrow({ where: { id: Y } })).listingVersion })).body.sessionId } });
    await settle();
    const t = atHours(60);
    // Ana asked Omar for t; Omar asked Ana for t + 20 minutes (another of his requests, overlapping too).
    expect((await testerReq(anaY.id, ana.tester.cookie, { times: [t] })).status).toBe(200);
    const fromAna = await pendingFrom(anaY.id, "tester");
    // Not overlapping hers between the same two (refused at send): a separate test of Omar's for his own request.
    const Z = await anotherTest(omar, "Low Tide");
    const anaZ = (await act(Z, "join", ana.tester.cookie, { listingVersion: (await db.test.findUniqueOrThrow({ where: { id: Z } })).listingVersion })).body.sessionId as string;
    await settle();
    expect((await devReq(Z, omar.cookie, anaZ, { times: [plus(t, 20)] })).status).toBe(200);
    const fromOmar = await pendingFrom(anaZ, "developer");
    // Nora books Ana at t on her own test: Ana's Accept.
    expect((await devReq(X, nora.cookie, ana.sessionId, { times: [t] })).status).toBe(200);
    const nr = await pendingFrom(ana.sessionId, "developer");
    const loaded = seen();
    await later();
    expect((await sact(ana.sessionId, "answer-request", ana.tester.cookie, { requestId: nr.id, action: "accept", seenAt: seen(), confirmed: true })).body.booked).toBe(true);
    expect(await row(fromAna.id)).toMatchObject({ status: "closed", closedReason: DROP_TESTER_BUSY });
    expect(await row(fromOmar.id)).toMatchObject({ status: "closed", closedReason: DROP_TESTER_BUSY });
    // Omar: a line on each test, with Ana's pronoun, never naming Nora; (Owner, Nov 4, §185) quiet now, with a bell stacked per test and day.
    const onY = (await live(`test:${Y}`, omar.cookie, loaded)).filter((l) => / closed: /.test(l.text));
    expect(onY).toHaveLength(1);
    expect(onY[0].text).toMatch(new RegExp(`^Ana Silva's request for ${T_} closed: she is no longer free at that time$`));
    expect(onY[0].quiet).toBe(true);
    // (§286) Both in the day's one "Call requests" stack across tests, each naming its own test.
    expect(await db.notification.count({ where: { userId: omar.user.id, groupKey: "callrequests", testId: Y, text: { contains: " closed: " } } })).toBe(1);
    expect(await db.notification.count({ where: { userId: omar.user.id, groupKey: "callrequests", testId: Z, text: { contains: " closed: " } } })).toBe(1);
    const onZ = (await live(`test:${Z}`, omar.cookie, loaded)).filter((l) => / closed: /.test(l.text));
    expect(onZ.map((l) => l.text)).toEqual([expect.stringMatching(new RegExp(`^Your request to Ana Silva for ${T_} closed: she is no longer free at that time$`))]);
    for (const l of [...onY, ...onZ]) expect(l.text).not.toContain("Nora");
    // Ana (her own Accept caused it): quiet lines on those sessions.
    const anaY1 = (await live(`session:${anaY.id}`, ana.tester.cookie, loaded)).filter((l) => / closed: /.test(l.text));
    expect(anaY1).toEqual([expect.objectContaining({ quiet: true, text: expect.stringMatching(new RegExp(`^Your request to Omar Reed for ${T_} closed: you have another call at that time$`)) })]);
    const anaZ1 = (await live(`session:${anaZ}`, ana.tester.cookie, loaded)).filter((l) => / closed: /.test(l.text));
    expect(anaZ1).toEqual([expect.objectContaining({ quiet: true, text: expect.stringMatching(new RegExp(`^Omar Reed's request for ${T_} closed: you have another call at that time$`)) })]);
    // Ana's own quiet line never stops her next press there.
    expect((await testerReq(anaY.id, ana.tester.cookie, { times: [atHours(100)], seenAt: loaded, confirmed: false })).status).toBe(200);
    // Omar's Accept of Ana's request on his stale page: a single refusal (no stop first, though its line is unseen).
    const acc = await act(Y, "answer-request", omar.cookie, { contractId: anaY.id, requestId: fromAna.id, action: "accept", seenAt: loaded });
    expect(acc.status).toBe(409);
    expect(acc.body.error).toMatchObject({ code: "gone", message: "This request closed: Ana Silva is no longer free at that time." });
    // Ana's Accept of Omar's (her stale page): her own words.
    const acc2 = await sact(anaZ, "answer-request", ana.tester.cookie, { requestId: fromOmar.id, action: "accept", seenAt: loaded });
    expect(acc2.body.error).toMatchObject({ code: "gone", message: "This request closed: you have another call at that time." });
  });

  it("the developer's auto-match (both picked the same time) drops her request to another tester; requests between the same two on another test close too", async () => {
    const { dev, testId } = await setup({ spots: 5 });
    const Z = await anotherTest(dev, "Low Tide");
    const ana = await joined(testId, "Ana Silva", "she");
    const ben = await joined(testId, "Ben Carter", "he");
    const anaZ = (await act(Z, "join", ana.tester.cookie, { listingVersion: (await db.test.findUniqueOrThrow({ where: { id: Z } })).listingVersion })).body.sessionId as string;
    await settle();
    const t = atHours(60);
    expect((await devReq(testId, dev.cookie, ben.sessionId, { times: [t] })).status).toBe(200);
    expect((await devReq(Z, dev.cookie, anaZ, { times: [plus(t, 15)] })).status).toBe(200);
    const toBen = await pendingFrom(ben.sessionId, "developer");
    const sameTwo = await pendingFrom(anaZ, "developer");
    expect((await testerReq(ana.sessionId, ana.tester.cookie, { times: [t] })).status).toBe(200);
    const loaded = seen();
    await later();
    const r = await devReq(testId, dev.cookie, ana.sessionId, { times: [t] });
    expect(r.body.booked).toBe(true);
    expect(await row(toBen.id)).toMatchObject({ status: "closed", closedReason: DROP_DEV_BUSY });
    expect(await row(sameTwo.id)).toMatchObject({ status: "closed", closedReason: DROP_BOTH });
    // Between the same two: each reads the other by name, quietly (both know about their call).
    const devZ = (await live(`test:${Z}`, dev.cookie, loaded)).filter((l) => / closed: /.test(l.text));
    expect(devZ).toEqual([expect.objectContaining({ quiet: true, text: expect.stringMatching(new RegExp(`^Your request to Ana Silva for ${T_} closed: you have a call with her at that time$`)) })]);
    const anaZl = (await live(`session:${anaZ}`, ana.tester.cookie, loaded)).filter((l) => / closed: /.test(l.text));
    expect(anaZl).toEqual([expect.objectContaining({ quiet: true, text: expect.stringMatching(new RegExp(`^Nora Lane's request for ${T_} closed: you have a call with her at that time$`)) })]);
    expect((await sact(anaZ, "answer-request", ana.tester.cookie, { requestId: sameTwo.id, action: "accept", seenAt: loaded })).body.error.message).toBe("This request closed: you have a call with Nora Lane at that time.");
    // Ben: told neutrally.
    expect((await live(`session:${ben.sessionId}`, ben.tester.cookie, loaded)).filter((l) => / closed: /.test(l.text)).map((l) => l.text)).toEqual([expect.stringMatching(/^Nora Lane's request for .+ closed: she is no longer free at that time$/)]);
  });

  it("the daily job's Forever top-up books the next call and drops what overlaps it", async () => {
    const { dev, testId } = await setup({ spots: 5 });
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() + 60 * 86_400_000) } });
    const ana = await joined(testId, "Ana Silva", "she");
    const ben = await joined(testId, "Ben Carter", "he");
    expect((await devReq(testId, dev.cookie, ana.sessionId, { rows: [{ startsAt: atHours(48), repeat: "weekly", count: "forever" }] })).status).toBe(200);
    const ra = await pendingFrom(ana.sessionId, "developer");
    expect((await sact(ana.sessionId, "answer-request", ana.tester.cookie, { requestId: ra.id, action: "accept", seenAt: seen(), confirmed: true })).body.calls).toBe(4);
    const set = await db.callSet.findFirstOrThrow({ where: { contractId: ana.sessionId } });
    // Ben asks for the set's 5th week (not booked yet, so nothing refuses it).
    expect((await testerReq(ben.sessionId, ben.tester.cookie, { times: [set.nextAt.toISOString()] })).status).toBe(200);
    const rb = await pendingFrom(ben.sessionId, "tester");
    const first = await db.call.findFirstOrThrow({ where: { setId: set.id }, orderBy: { startsAt: "asc" } });
    await db.call.update({ where: { id: first.id }, data: { startsAt: new Date(Date.now() - 3_600_000) } });
    await topUpForeverSets();
    expect(await db.call.count({ where: { setId: set.id, startsAt: set.nextAt } })).toBe(1);
    expect(await row(rb.id)).toMatchObject({ status: "closed", closedReason: DROP_DEV_BUSY });
  });

  it("only overlapping requests drop; a developer batch's other copies close as taken (not dropped)", async () => {
    const { dev, testId } = await setup({ spots: 5 });
    const ana = await joined(testId, "Ana Silva", "she");
    const ben = await joined(testId, "Ben Carter", "he");
    const cara = await joined(testId, "Cara Diaz", "she");
    const t = atHours(60);
    // One request to Ana and Ben together (a batch), one to Cara an hour later (no overlap with a 30-minute call).
    expect((await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [ana.sessionId, ben.sessionId], times: [t], minutes: 30 })).status).toBe(200);
    expect((await devReq(testId, dev.cookie, cara.sessionId, { times: [plus(t, 30)] })).status).toBe(200);
    const ra = await pendingFrom(ana.sessionId, "developer");
    const rb = await pendingFrom(ben.sessionId, "developer");
    const rc = await pendingFrom(cara.sessionId, "developer");
    await sact(ana.sessionId, "answer-request", ana.tester.cookie, { requestId: ra.id, action: "accept", seenAt: seen(), confirmed: true });
    expect((await row(rb.id)).status).toBe("taken");
    expect((await row(rc.id)).status).toBe("pending");
  });
});
