import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as liveGET } from "@/app/api/live/route";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as invitePOST } from "@/app/api/invites/[id]/route";
import { bellKeyIn, groupTitle } from "@/lib/bell";
import { emailLines } from "@/lib/server/notify";
import { closeRequests } from "@/lib/server/requests";
import { testerChanges } from "@/lib/server/testerGate";
import { autoChargeCalls } from "@/lib/server/holds";
import { finishWorkIfDue } from "@/lib/server/workWindow";
import { json, makeUser, req } from "./helpers";
import { act, atHours, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 6, §286) Every kind of update that can show as a blue top-box line for a person also gives them a bell line (and its summary email as configured), on
// both sides, in the top box's words, linking to the exact place. Call requests stack in one entry a day across tests ("Call requests · N today"), booked calls too
// ("Booked calls · N today"). Nothing that already rang rings twice; the developer's own presses never ring themselves.

const DAY = 86_400_000;
const later = () => new Promise((r) => setTimeout(r, 30));
const devReq = (testId: string, cookie: string, contractIds: string[], times: string[]) =>
  act(testId, "request-time", cookie, { seenAt: seen(), confirmed: true, contractIds, minutes: 30, times });
const testerReq = (sessionId: string, cookie: string, times: string[]) => sact(sessionId, "request-time", cookie, { seenAt: seen(), confirmed: true, minutes: 30, times });
const answer = (sessionId: string, cookie: string, requestId: string, action: string) => sact(sessionId, "answer-request", cookie, { requestId, action, seenAt: seen(), confirmed: true });
const devAnswer = (testId: string, cookie: string, contractId: string, requestId: string, action: string) =>
  act(testId, "answer-request", cookie, { contractId, requestId, action, seenAt: seen(), confirmed: true });
const newest = (contractId: string, fromSide: string) => db.callRequest.findFirstOrThrow({ where: { contractId, fromSide, status: "pending" }, orderBy: { createdAt: "desc" } });
const bells = (userId: string, text?: string) => db.notification.findMany({ where: { userId, ...(text ? { text: { contains: text } } : {}) }, orderBy: { createdAt: "asc" } });
const sessionLines = async (sessionId: string, cookie: string, since: string) => (await sessionLines0(sessionId, cookie, since)).map(noZone);
const sessionLines0 = async (sessionId: string, cookie: string, since: string) =>
  ((await json(await liveGET(req(`/api/live?scope=session:${sessionId}&since=${encodeURIComponent(since)}`, { cookie, method: "GET" })))).body.changes as { text: string }[]).map((l) => l.text);
const testLines = async (testId: string, cookie: string, since: string) => (await testLines0(testId, cookie, since)).map(noZone);
const testLines0 = async (testId: string, cookie: string, since: string) =>
  ((await json(await liveGET(req(`/api/live?scope=test:${testId}&since=${encodeURIComponent(since)}`, { cookie, method: "GET" })))).body.changes as { text: string }[]).map((l) => l.text);
/** (Batch 15 section 11) A bell writes a time in the reader's own zone, with the zone's name; the top box's line is in the page's zone without it. */
const noZone = (s: string) => s.replace(/(AM|PM)\s+[A-Z]{2,5}\b/g, "$1");
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  return act(testId, "edit", cookie, { version: v, fields, seenAt: seen(), confirmed: true });
};

describe("§286 the developer's call request rings the tester", () => {
  it("one request: a bell in her top box's words, linking to its row, in the day's Call requests stack; the developer's own press never rings her own bell", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    const loaded = new Date(Date.now() - 1000).toISOString();
    await later();
    expect((await devReq(f.testId, f.dev.cookie, [a.sessionId], [atHours(50)])).status).toBe(200);
    const r = await newest(a.sessionId, "developer");
    const mine = await bells(a.tester.user.id, "requested");
    expect(mine).toHaveLength(1);
    expect(mine[0].text).toMatch(/^Nora Lane requested a call for .+ (AM|PM)( [A-Z]+)?$/);
    // The same words as the line her top box shows.
    expect(await sessionLines(a.sessionId, a.tester.cookie, loaded)).toContain(noZone(mine[0].text));
    expect(mine[0].link).toBe(`/app/sessions/${a.sessionId}#req-${r.id}`);
    expect(mine[0]).toMatchObject({ groupKey: "callrequests", testId: f.testId, own: false, side: "tester" });
    expect(await db.notification.count({ where: { userId: f.dev.user.id, text: { contains: "requested" } } })).toBe(0);
  });

  it("a set's rows (each its own request) stack in one entry a day, across tests too, with the tester's own requests' bells on the developer's side the same", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    expect((await devReq(f.testId, f.dev.cookie, [a.sessionId], [atHours(50), atHours(54), atHours(58)])).status).toBe(200);
    const rows = await db.callRequest.findMany({ where: { contractId: a.sessionId, fromSide: "developer", status: "pending" } });
    const mine = await bells(a.tester.user.id, "requested");
    expect(mine).toHaveLength(3);
    expect(new Set(mine.map((n) => n.link))).toEqual(new Set(rows.map((r) => `/app/sessions/${a.sessionId}#req-${r.id}`)));
    expect(new Set(mine.map((n) => bellKeyIn(n, "UTC"))).size).toBe(1);
    expect(groupTitle("callrequests", 1, 3)).toBe("Call requests · 3") /* (§290) the page adds the day */;
    // Another test's request lands in the same day's entry.
    const g = await setup({ title: "Harbor Run Two", productName: "Harbor Run Two" });
    const b = await db.contract.findUniqueOrThrow({ where: { id: (await act(g.testId, "join", a.tester.cookie, { listingVersion: 1 })).body.sessionId } });
    await settle();
    expect((await devReq(g.testId, g.dev.cookie, [b.id], [atHours(70)])).status).toBe(200);
    const all = await bells(a.tester.user.id, "requested");
    expect(all).toHaveLength(4);
    expect(new Set(all.map((n) => bellKeyIn(n, "UTC"))).size).toBe(1);
    // The email stacks them the same way.
    expect(emailLines(all, (n) => n.text)[0]).toBe("• Call requests · 4");
  });

  it("an auto-matched row is a booking, not a request: one \"Booked: …\" line in the Booked calls stack, never a request line too", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    const at = atHours(52);
    expect((await testerReq(a.sessionId, a.tester.cookie, [at])).status).toBe(200);
    expect((await devReq(f.testId, f.dev.cookie, [a.sessionId], [at])).body.booked).toBe(true);
    expect(await db.notification.count({ where: { userId: a.tester.user.id, text: { contains: "requested" } } })).toBe(0);
    const booked = await bells(a.tester.user.id, "Booked:");
    expect(booked).toHaveLength(1);
    expect(booked[0].groupKey).toBe("booked");
  });
});

describe("§286 call requests closed: withdrawn (as before), declined, taken by another tester, closed by a pause", () => {
  it("a decline rings the one who asked, both ways, in the Call requests stack", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    expect((await testerReq(a.sessionId, a.tester.cookie, [atHours(50)])).status).toBe(200);
    expect((await devAnswer(f.testId, f.dev.cookie, a.sessionId, (await newest(a.sessionId, "tester")).id, "decline")).status).toBe(200);
    const hers = await bells(a.tester.user.id, "declined");
    expect(hers.map((n) => n.text)).toEqual([expect.stringMatching(/^Nora Lane declined your call request for .+ (AM|PM)( [A-Z]+)?$/)]);
    expect(hers[0]).toMatchObject({ link: `/app/sessions/${a.sessionId}#calls`, groupKey: "callrequests" });
    expect((await devReq(f.testId, f.dev.cookie, [a.sessionId], [atHours(60)])).status).toBe(200);
    const loaded = new Date(Date.now() - 1000).toISOString();
    await later();
    expect((await answer(a.sessionId, a.tester.cookie, (await newest(a.sessionId, "developer")).id, "decline")).status).toBe(200);
    const his = await bells(f.dev.user.id, "declined");
    expect(his.map((n) => n.text)).toEqual([expect.stringMatching(/^Ana Silva declined a call request for .+ (AM|PM)( [A-Z]+)?$/)]);
    expect(await testLines(f.testId, f.dev.cookie, loaded)).toContain(noZone(his[0].text));
    expect(his[0]).toMatchObject({ link: `/app/tests/${f.testId}#calls`, groupKey: "callrequests" });
    // Their own declines never ring themselves.
    expect(await db.notification.count({ where: { userId: f.dev.user.id, text: { startsWith: "Nora Lane declined" } } })).toBe(0);
    expect(await db.notification.count({ where: { userId: a.tester.user.id, text: { startsWith: "Ana Silva declined" } } })).toBe(0);
  });

  it("a time another tester took: each other tester's bell says so, in her top box's words", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    const b = await joined(f.testId, "Ben Okafor", "he");
    expect((await devReq(f.testId, f.dev.cookie, [a.sessionId, b.sessionId], [atHours(50)])).status).toBe(200);
    const loaded = new Date(Date.now() - 1000).toISOString();
    await later();
    expect((await answer(a.sessionId, a.tester.cookie, (await newest(a.sessionId, "developer")).id, "accept")).status).toBe(200);
    const bens = await bells(b.tester.user.id, "another tester took it");
    expect(bens.map((n) => n.text)).toEqual([expect.stringMatching(/^The call time with Nora Lane on .+ is no longer available: another tester took it$/)]);
    expect(await sessionLines(b.sessionId, b.tester.cookie, loaded)).toContain(noZone(bens[0].text));
    expect(bens[0]).toMatchObject({ link: `/app/sessions/${b.sessionId}#calls`, groupKey: "callrequests" });
    expect(await db.notification.count({ where: { userId: a.tester.user.id, text: { contains: "another tester took it" } } })).toBe(0);
  });

  it("the developer's requests closed by a pause ring the tester; one closed by her own Leave never does", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    expect((await devReq(f.testId, f.dev.cookie, [a.sessionId], [atHours(50)])).status).toBe(200);
    await closeRequests({ contractIds: [a.sessionId] }, "the test is paused");
    const hers = await bells(a.tester.user.id, "no longer available");
    expect(hers.map((n) => n.text)).toEqual([expect.stringMatching(/^The call time with Nora Lane on .+ is no longer available$/)]);
    expect(hers[0].groupKey).toBe("callrequests");
    expect((await devReq(f.testId, f.dev.cookie, [a.sessionId], [atHours(60)])).status).toBe(200);
    await closeRequests({ contractIds: [a.sessionId] }, "the tester left");
    expect(await bells(a.tester.user.id, "no longer available")).toHaveLength(1);
  });
});

describe("§286 booked calls: their own stack, one entry a day across tests, never twice", () => {
  it("Accept rings the one who asked once (\"Booked: …\"), in the Booked calls stack", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    await bookCall(f.testId, f.dev.cookie, a.sessionId, a.tester.cookie, 50);
    const his = await bells(f.dev.user.id, "Booked:");
    expect(his).toHaveLength(1);
    expect(his[0].groupKey).toBe("booked");
    expect(await db.notification.count({ where: { userId: a.tester.user.id, text: { contains: "Booked:" } } })).toBe(0); // her own Accept
    await bookCall(f.testId, f.dev.cookie, a.sessionId, a.tester.cookie, 60);
    const two = await bells(f.dev.user.id, "Booked:");
    expect(new Set(two.map((n) => bellKeyIn(n, "UTC"))).size).toBe(1);
    expect(groupTitle("booked", 1, 2)).toBe("Booked calls · 2");
  });
});

describe("§286 the other new tester bells", () => {
  it("the developer's side added to her dispute", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    await sact(a.sessionId, "written", a.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: a.sessionId } });
    await settle();
    expect((await json(await reviewPOST(req("/api/review", { cookie: f.dev.cookie, body: { payKey: randomUUID(), seenAt: seen(), kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Half the answers" } })))).status).toBe(200);
    await sact(a.sessionId, "dispute", a.tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question fully" });
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
    const before = new Date(Date.now() - 1000);
    await later();
    expect((await act(f.testId, "dispute-side", f.dev.cookie, { disputeId: d.id, text: "Answers 2 and 3 were one word each" })).status).toBe(200);
    const hers = await bells(a.tester.user.id, "side to your dispute");
    expect(hers.map((n) => n.text)).toEqual(["Nora Lane added her side to your dispute about your written answers"]);
    expect((await testerChanges(a.tester.user.id, a.sessionId, f.testId, before)).map((e) => e.text)).toContain(hers[0].text);
    expect(hers[0]).toMatchObject({ link: `/app/sessions/${a.sessionId}#part-written`, groupKey: "disputeside" });
  });

  // (Owner, Nov 6, §304) "Ana Silva reported her key doesn't work" and "Nora Lane marked your key as working" are gone with the key report
  // (tests/no-key-report-304.test.ts).

  it("the listing edited: \"Nora Lane edited the listing\" to each working tester; a questions-only Save keeps its own one bell (never two)", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    expect((await edit(f.testId, f.dev.cookie, { description: "Sail further" })).status).toBe(200);
    const hers = await bells(a.tester.user.id, "edited the listing");
    expect(hers.map((n) => n.text)).toEqual(["Nora Lane edited the listing"]);
    expect(hers[0].link).toBe(`/app/sessions/${a.sessionId}#scope`);
    await settle();
    expect((await edit(f.testId, f.dev.cookie, { questions: ["What did you like?", "Where did you get stuck?", "Anything else?"] })).status).toBe(200);
    expect(await bells(a.tester.user.id, "edited the listing")).toHaveLength(1);
    expect(await bells(a.tester.user.id, "updated the listing")).toHaveLength(1);
    expect(await db.notification.count({ where: { userId: f.dev.user.id, text: { contains: "the listing" } } })).toBe(0); // his own Save
  });

  it("her work ended when the test's time ran out (\"This test ended\" in her top box)", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    expect(await finishWorkIfDue(f.testId, new Date(Date.now() + 40 * DAY))).toBe(true);
    const hers = await bells(a.tester.user.id, "ended");
    expect(hers.map((n) => n.text)).toEqual(["“Harbor Run” ended"]);
    expect(hers[0]).toMatchObject({ link: `/app/sessions/${a.sessionId}`, groupKey: "tstopped" });
  });
});

describe("§286 the other new developer bells", () => {
  it("a tester switched to the new terms", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    expect((await edit(f.testId, f.dev.cookie, { writtenCents: "12.00" })).status).toBe(200);
    await settle();
    const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: a.sessionId, status: "open" } });
    expect((await sact(a.sessionId, "terms", a.tester.cookie, { choice: "switch", offerId: offer.id, seenAt: seen(), confirmed: true })).status).toBe(200);
    const his = await bells(f.dev.user.id, "switched");
    expect(his.map((n) => n.text)).toEqual(["Ana Silva switched to the new terms"]);
    expect(his[0].link).toBe(`/app/tests/${f.testId}#tester-${a.sessionId}`);
  });

  it("a tester said no thanks to the invite", async () => {
    const f = await setup();
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    expect((await act(f.testId, "invite", f.dev.cookie, { testerIds: [ana.user.id], seenAt: seen(), confirmed: true })).status).toBe(200);
    const inv = await db.invite.findFirstOrThrow({ where: { testId: f.testId, testerId: ana.user.id, status: "sent" } });
    expect((await json(await invitePOST(req(`/api/invites/${inv.id}`, { cookie: ana.cookie, body: {} }), { params: Promise.resolve({ id: inv.id }) }))).status).toBe(200);
    const his = await bells(f.dev.user.id, "no thanks");
    expect(his.map((n) => n.text)).toEqual(["Ana Silva said no thanks to your invite"]);
    expect(his[0].link).toBe(`/app/tests/${f.testId}#invite`);
  });

  it("a tester let her part go", async () => {
    const f = await setup({ writtenCents: "9.00" });
    const a = await joined(f.testId);
    await sact(a.sessionId, "written", a.tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: a.sessionId } });
    await db.submission.update({ where: { id: sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY), payBy: new Date(Date.now() - DAY) } });
    expect((await sact(a.sessionId, "choose", a.tester.cookie, { submissionId: sub.id, choice: "letgo", seenAt: seen(), confirmed: true })).status).toBe(200);
    const his = await bells(f.dev.user.id, "go: nothing charged");
    expect(his.map((n) => n.text)).toEqual(["Ana Silva let her written answers go: nothing charged"]);
    expect(his[0].link).toBe(`/app/tests/${f.testId}#piece-${sub.id}`);
  });

  it("a call closed with nothing to pay", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    const call = await bookCall(f.testId, f.dev.cookie, a.sessionId, a.tester.cookie, 50);
    await db.call.update({ where: { id: call.id }, data: { actualMinutes: 0, payBy: new Date(Date.now() - 60_000) } });
    await autoChargeCalls(new Date());
    const his = await bells(f.dev.user.id, "closed with nothing to pay");
    expect(his.map((n) => n.text)).toEqual([expect.stringMatching(/^Ana Silva's call on .+ closed with nothing to pay$/)]);
    expect(his[0].link).toBe(`/app/tests/${f.testId}#call-${call.id}`);
  });
});

describe("§286 nothing doubles for kinds that already rang", () => {
  it("a Pay, a withdrawal and an accepted request each ring the other side exactly once", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    await sact(a.sessionId, "written", a.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: a.sessionId } });
    await settle();
    expect((await json(await reviewPOST(req("/api/review", { cookie: f.dev.cookie, body: { payKey: randomUUID(), seenAt: seen(), kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 } })))).status).toBe(200);
    expect(await db.notification.count({ where: { userId: a.tester.user.id, text: { contains: "paid you" } } })).toBe(1);
    expect((await testerReq(a.sessionId, a.tester.cookie, [atHours(50)])).status).toBe(200);
    expect((await answer(a.sessionId, a.tester.cookie, (await newest(a.sessionId, "tester")).id, "withdraw")).status).toBe(200);
    expect(await db.notification.count({ where: { userId: f.dev.user.id, text: { contains: "withdrew" } } })).toBe(1);
    expect(await db.notification.count({ where: { userId: f.dev.user.id, text: { contains: "asked for a call" } } })).toBe(1);
    expect((await testerReq(a.sessionId, a.tester.cookie, [atHours(56)])).status).toBe(200);
    expect((await devAnswer(f.testId, f.dev.cookie, a.sessionId, (await newest(a.sessionId, "tester")).id, "accept")).status).toBe(200);
    expect(await db.notification.count({ where: { userId: a.tester.user.id, text: { contains: "Booked:" } } })).toBe(1);
    // The developer's own Accept never rings him.
    expect(await db.notification.count({ where: { userId: f.dev.user.id, text: { contains: "Booked:" } } })).toBe(0);
  });
});
