import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { json, makeUser, req } from "./helpers";
import { act, joined, listingBody, sact, seen, setup } from "./fixtures";

const later = () => new Promise((r) => setTimeout(r, 30));

describe("post and edit", () => {
  it("only developers post; listing errors are plain sentences", async () => {
    const t = await makeUser({ tester: true });
    expect((await json(await testsPOST(req("/api/tests", { cookie: t.cookie, body: listingBody() })))).status).toBe(403);
    const d = await makeUser({ dev: true });
    const r = await json(await testsPOST(req("/api/tests", { cookie: d.cookie, body: listingBody({ writtenCents: "0.50" }) })));
    expect(r.body.error.message).toBe("The written answers price must be at least $1.00 (or free).");
  });

  it("Edit: a changed version stops once and lists what changed; the second press saves typed values on top", async () => {
    const { dev, testId } = await setup();
    const loaded = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    // Another tab edits the title; a tester joins (uses a spot).
    expect((await act(testId, "edit", dev.cookie, { version: loaded, fields: { title: "Harbor Run 2" } })).status).toBe(200);
    await joined(testId);
    const first = await act(testId, "edit", dev.cookie, { version: loaded, fields: { writtenCents: "12.00" } });
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe("changed");
    expect(first.body.error.changes.map((c: { text: string }) => c.text)).toEqual(["The listing was edited: title", "Ana Silva joined"]);
    const second = await act(testId, "edit", dev.cookie, { version: loaded, fields: { writtenCents: "12.00" }, confirmed: true });
    expect(second.status).toBe(200);
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect(t.title).toBe("Harbor Run 2"); // untouched field keeps the newer value
    expect(t.writtenCents).toBe(1200);
  });

  it("spots can't go below the testers already in", async () => {
    const { dev, testId } = await setup();
    await joined(testId, "Ana Silva");
    await joined(testId, "Ben Carter", "he");
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    const r = await act(testId, "edit", dev.cookie, { version: v, fields: { spots: 1 } });
    expect(r.body.error.message).toBe("Spots can't go below the 2 testers already in.");
  });

  it("other developers can't see or change the test", async () => {
    const { testId } = await setup();
    const other = await makeUser({ dev: true });
    expect((await act(testId, "edit", other.cookie, { version: 1, fields: { title: "Mine" } })).status).toBe(404);
    expect((await act(testId, "stop", other.cookie, { seenAt: seen() })).status).toBe(404);
  });
});

describe("join and contract snapshots", () => {
  it("the contract is a snapshot: edits never change it", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    await act(testId, "edit", dev.cookie, { version: v, fields: { writtenCents: "50.00", questions: ["New?"], deadlineDays: 1 } });
    const c = await db.contract.findUniqueOrThrow({ where: { id: sessionId } });
    expect(c).toMatchObject({ writtenCents: 1000, liveRateCents: 3000, liveMinutes: null, deadlineDays: 7, testerId: tester.user.id });
    expect(c.questions).toEqual(["What did you like?", "Where did you get stuck?"]);
  });

  it("a changed listing stops the join once with the new terms; the second press joins on them", async () => {
    const { dev, testId } = await setup();
    const t0 = await db.test.findUniqueOrThrow({ where: { id: testId } });
    await act(testId, "edit", dev.cookie, { version: t0.version, fields: { writtenCents: "8.00" } });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    const first = await act(testId, "join", ana.cookie, { seenAt: new Date(Date.now() - 60_000).toISOString() });
    expect(first.status).toBe(409);
    expect(first.body.error).toMatchObject({ code: "stop_once" });
    expect(first.body.error.changes[0].text).toBe("The listing was edited: written answers price");
    const second = await act(testId, "join", ana.cookie, { seenAt: new Date(Date.now() - 60_000).toISOString(), confirmed: true });
    expect(second.status).toBe(200);
    expect((await db.contract.findUniqueOrThrow({ where: { id: second.body.sessionId } })).writtenCents).toBe(800);
  });

  it("a spot-only change doesn't stop the join", async () => {
    const { dev, testId } = await setup();
    const t0 = await db.test.findUniqueOrThrow({ where: { id: testId } });
    await act(testId, "edit", dev.cookie, { version: t0.version, fields: { spots: 5 } });
    const ana = await makeUser({ tester: true });
    expect((await act(testId, "join", ana.cookie, { seenAt: new Date(Date.now() - 60_000).toISOString() })).status).toBe(200);
  });

  it("full, stopped and own tests refuse for good; device needs are checked", async () => {
    const { dev, testId } = await setup({ spots: 1 });
    await joined(testId);
    const ben = await makeUser({ tester: true });
    expect((await act(testId, "join", ben.cookie, { listingVersion: 1, confirmed: true })).body.error.message).toBe("This test is full.");
    expect((await act(testId, "join", dev.cookie, { listingVersion: 1 })).status).toBe(403); // not a tester
    const s = await setup({ devices: ["Mac"] });
    expect((await act(s.testId, "join", ben.cookie, { listingVersion: 1 })).body.error.message).toContain("This test needs one of: Mac");
    await act(s.testId, "stop", s.dev.cookie, { seenAt: seen() });
    expect((await act(s.testId, "join", ben.cookie, { listingVersion: 1, confirmed: true })).body.error.message).toBe("This test was stopped.");
  });
});

describe("top panel stops once", () => {
  it("a tester joining, leaving or sending since the page loaded stops the first press; the second goes ahead", async () => {
    const { dev, testId } = await setup();
    const pageLoaded = seen();
    await later();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["Fun", "Level 2"] });
    const first = await act(testId, "next-round", dev.cookie, { seenAt: pageLoaded });
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe("stop_once");
    expect(first.body.error.message).toBe("Press again to go ahead.");
    expect(first.body.error.changes.map((c: { text: string }) => c.text)).toEqual(["Ana Silva joined", "Ana Silva sent her written answers"]);
    const second = await act(testId, "next-round", dev.cookie, { seenAt: pageLoaded, confirmed: true });
    expect(second.status).toBe(200);
    const copy = await db.test.findUniqueOrThrow({ where: { id: second.body.id } });
    expect(copy).toMatchObject({ status: "draft", round: 2, title: "Harbor Run (round 2)", previousId: testId });
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).status).toBe("open") // (Owner) a next round no longer closes the current round;
  });

  it("nothing new: the press goes straight through", async () => {
    const { dev, testId } = await setup();
    const { sessionId } = await joined(testId);
    await later();
    const r = await act(testId, "end-early", dev.cookie, { seenAt: seen(), contractId: sessionId, reason: "We have enough feedback" });
    expect(r.status).toBe(200);
  });

  it("a press that can't happen any more is refused with a plain sentence (and Refresh when the page is out of date)", async () => {
    const { dev, testId } = await setup();
    const pageLoaded = seen();
    await later();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "leave", tester.cookie);
    const r = await act(testId, "end-early", dev.cookie, { seenAt: pageLoaded, contractId: sessionId, reason: "Enough feedback", confirmed: true });
    expect(r.body.error.message).toBe("Ana Silva already left the test. Refresh to see the latest.");
    await act(testId, "stop", dev.cookie, { seenAt: seen(), confirmed: true });
    await later();
    expect((await act(testId, "stop", dev.cookie, { seenAt: seen() })).body.error.message).toBe("This test was stopped.");
  });
});

describe("tester session", () => {
  it("after End early the session shows one line and later presses are refused with it", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await act(testId, "end-early", dev.cookie, { seenAt: seen(), contractId: sessionId, reason: "We have enough", confirmed: true });
    const r = await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/^Nora Lane ended your session early on .+\. Work you sent is still reviewed\.$/);
    expect((await db.call.count({ where: { contractId: sessionId, status: "booked" } }))).toBe(0);
  });

  it("stopping the test refuses later presses with the stop line", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await act(testId, "stop", dev.cookie, { seenAt: seen(), confirmed: true });
    const r = await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    expect(r.body.error.message).toMatch(/^Nora Lane stopped the test on .+\. Work you sent is still reviewed\.$/);
  });

  it("late work is accepted and marked; after Open until it's refused", async () => {
    const { testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await db.contract.update({ where: { id: sessionId }, data: { dueAt: new Date(Date.now() - 86_400_000) } });
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
    expect((await db.submission.findFirstOrThrow({ where: { contractId: sessionId } })).late).toBe(true);
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() - 1000) } });
    const r = await sact(sessionId, "written", tester.cookie, { answers: ["c", "d"] });
    expect(r.body.error.message).toMatch(/^This test closed on /);
  });

  it("extra written work (not in the listing) can be sent and is marked extra", async () => {
    const { testId } = await setup({ writtenCents: null, questions: [] });
    const { tester, sessionId } = await joined(testId);
    expect((await sact(sessionId, "written", tester.cookie, { answers: [] })).status).toBe(400);
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["Loved the boats"] })).status).toBe(200);
    expect((await db.submission.findFirstOrThrow({ where: { contractId: sessionId } })).agreedCents).toBeNull();
  });

  it("answers can be updated until paid; nobody else can send on a session", async () => {
    const { testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a2", "b2"] })).status).toBe(200);
    expect((await db.submission.findFirstOrThrow({ where: { contractId: sessionId } })).answers).toEqual(["a2", "b2"]);
    const other = await makeUser({ tester: true });
    expect((await sact(sessionId, "written", other.cookie, { answers: ["x", "y"] })).status).toBe(404);
    expect((await sact(sessionId, "leave", other.cookie)).status).toBe(404);
  });
});
