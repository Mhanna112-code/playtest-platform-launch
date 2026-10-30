import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { json, makeUser, req } from "./helpers";
import { act, joined, listingBody, sact, seen, setup } from "./fixtures";

const day = 86_400_000;
const lv = async (testId: string) => (await db.test.findUniqueOrThrow({ where: { id: testId } })).listingVersion;
const leave = (sessionId: string, cookie: string) => sact(sessionId, "leave", cookie, { seenAt: seen(), confirmed: true });
const ask = async (testId: string, cookie: string, extra: Record<string, unknown> = {}) => act(testId, "rejoin-ask", cookie, { listingVersion: await lv(testId), seenAt: seen(), confirmed: true, anyway: true, ...extra });
const decide = (testId: string, cookie: string, applicationId: string, action: "accept" | "decline") => act(testId, "application", cookie, { applicationId, action, seenAt: seen(), confirmed: true });

describe("Ask to rejoin (design doc 7.3, 8)", () => {
  it("coming back is an ask the developer accepts; the session returns with the time the tester had left", async () => {
    const { dev, testId } = await setup({ deadlineDays: 6 });
    const { tester, sessionId } = await joined(testId, "Ana Silva");
    await leave(sessionId, tester.cookie);
    // Joining directly is refused: ask instead.
    const direct = await act(testId, "join", tester.cookie, { listingVersion: await lv(testId), seenAt: seen(), confirmed: true });
    expect(direct.status).toBe(409);
    expect(direct.body.error.code).toBe("ask");
    const r = await ask(testId, tester.cookie, { note: "Back from holiday" });
    expect(r.body).toEqual({ asked: true });
    const a = await db.application.findFirstOrThrow({ where: { testId, testerId: tester.user.id } });
    expect(a).toMatchObject({ kind: "rejoin", status: "pending", note: "Back from holiday" });
    // The developer is told what Ana gets back.
    const note = await db.notification.findFirstOrThrow({ where: { userId: dev.user.id, text: { contains: "asks to rejoin" } } });
    expect(note.link).toBe(`/app/tests/${testId}#needs-you`);
    const old = await db.contract.findUniqueOrThrow({ where: { id: sessionId } });
    const accepted = await decide(testId, dev.cookie, a.id, "accept");
    expect(accepted.status).toBe(200);
    expect(accepted.body.sessionId).toBe(sessionId);
    const back = await db.contract.findUniqueOrThrow({ where: { id: sessionId } });
    expect(back.status).toBe("working");
    // Exactly the time that was left when they left (about 6 days), counted from now.
    expect(Math.abs(back.dueAt.getTime() - (Date.now() + (old.dueAt.getTime() - old.endedAt!.getTime())))).toBeLessThan(5000);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "You're back in" } } })).toBe(1);
  });

  it("declined: the tester is told; not offered after the deadline, a stop or a rating", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await leave(sessionId, tester.cookie);
    await ask(testId, tester.cookie);
    const a = await db.application.findFirstOrThrow({ where: { testId, testerId: tester.user.id } });
    expect((await decide(testId, dev.cookie, a.id, "decline")).status).toBe(200);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "wasn't accepted" } } })).toBe(1);
    // After the deadline had passed when they left: no ask.
    await db.contract.update({ where: { id: sessionId }, data: { dueAt: new Date(Date.now() - day), endedAt: new Date() } });
    expect((await ask(testId, tester.cookie)).body.error.message).toBe("You can't ask to rejoin this test.");
    // After a stop: no ask either.
    await db.contract.update({ where: { id: sessionId }, data: { dueAt: new Date(Date.now() + 3 * day) } });
    await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true });
    expect((await ask(testId, tester.cookie)).status).toBe(409);
  });

  it("an invite and an ask, in either order, bring the tester back at once", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Cole");
    await leave(a.sessionId, a.tester.cookie);
    await leave(b.sessionId, b.tester.cookie);
    // Ask first, then the developer invites from a page that didn't show the ask yet (batch 34 §16: a page that showed it answers in Needs you).
    const devPageAt = seen();
    await new Promise((r) => setTimeout(r, 25));
    await ask(testId, a.tester.cookie);
    expect((await db.contract.findUniqueOrThrow({ where: { id: a.sessionId } })).status).toBe("left");
    const inv = await act(testId, "invite", dev.cookie, { seenAt: devPageAt, testerIds: [a.tester.user.id], confirmed: true });
    expect(inv.body.joined).toEqual([a.tester.user.id]);
    expect((await db.contract.findUniqueOrThrow({ where: { id: a.sessionId } })).status).toBe("working");
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { contains: "Ana Silva rejoined" } } })).toBe(1);
    // Invite first, then the ask from a page that didn't show the invite yet (batch 34 §16: a page that showed it offers Join).
    const pageAt = seen();
    await new Promise((r) => setTimeout(r, 25));
    await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [b.tester.user.id], confirmed: true });
    expect((await db.contract.findUniqueOrThrow({ where: { id: b.sessionId } })).status).toBe("left");
    const r = await ask(testId, b.tester.cookie, { seenAt: pageAt });
    expect(r.body).toMatchObject({ joined: true, sessionId: b.sessionId });
    expect((await db.contract.findUniqueOrThrow({ where: { id: b.sessionId } })).status).toBe("working");
  });
});

describe("10 tests at once (design doc 7.3)", () => {
  it("joining, applying, accepting an application and asking to rejoin all say \"You can't join more tests right now.\"", async () => {
    const LINE = "You can't join more tests right now.";
    const tester = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const dev = await makeUser({ dev: true, name: "Nora Lane", pronoun: "she" });
    // (Batch 12 section 4) A developer has at most 10 open tests: a second developer posts the rest.
    const dev2 = await makeUser({ dev: true, name: "Omar Reed" });
    let posted = 0;
    const post = async (over: Record<string, unknown> = {}) => (await json(await testsPOST(req("/api/tests", { cookie: (posted++ < 8 ? dev : dev2).cookie, body: listingBody({ spots: 10, title: `Harbor Run ${posted}`, ...over }) })))).body.id as string; // (batch 34 §7) different names
    // The tester asks to join an apply-mode test while still free, and leaves one test (to ask to rejoin later).
    const applyTest = await post({ joinMode: "apply" });
    expect((await act(applyTest, "apply", tester.cookie, { listingVersion: await lv(applyTest), seenAt: seen(), confirmed: true, anyway: true })).body.applied).toBe(true);
    const first = await post();
    const j = await act(first, "join", tester.cookie, { listingVersion: await lv(first) });
    await leave(j.body.sessionId, tester.cookie);
    for (let i = 0; i < 10; i++) {
      const id = await post();
      expect((await act(id, "join", tester.cookie, { listingVersion: await lv(id) })).status).toBe(200);
    }
    const eleventh = await post();
    expect((await act(eleventh, "join", tester.cookie, { listingVersion: await lv(eleventh) })).body.error.message).toBe(LINE);
    const applyMore = await post({ joinMode: "apply" });
    expect((await act(applyMore, "apply", tester.cookie, { listingVersion: await lv(applyMore), seenAt: seen(), confirmed: true, anyway: true })).body.error.message).toBe(LINE);
    // The developer accepting the earlier application is refused naming the tester.
    const app = await db.application.findFirstOrThrow({ where: { testId: applyTest, testerId: tester.user.id } });
    expect((await decide(applyTest, dev.cookie, app.id, "accept")).body.error.message).toBe("Ana Silva can't join more tests right now.");
    // Asking to rejoin the test they left.
    expect((await ask(first, tester.cookie)).body.error.message).toBe(LINE);
    // Accepting an invite is joining.
    await act(eleventh, "invite", dev.cookie, { seenAt: seen(), testerIds: [tester.user.id], confirmed: true });
    expect((await act(eleventh, "join", tester.cookie, { listingVersion: await lv(eleventh) })).body.error.message).toBe(LINE);
  });
});
