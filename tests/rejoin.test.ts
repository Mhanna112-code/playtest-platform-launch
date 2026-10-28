import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { json, makeUser, req } from "./helpers";
import { act, joined, sact, seen, setup, atHours } from "./fixtures";

// (Owner, Oct 22, NEWEST+4) Listing changes re-invite; applications; rejoining restores work.

const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const version = async (testId: string) => (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
const listingVersion = async (testId: string) => (await db.test.findUniqueOrThrow({ where: { id: testId } })).listingVersion;

describe("a listing change re-sends open invites", () => {
  it("closes the old invites, sends new ones (not to someone who can't be invited), refuses Accept on the old one", async () => {
    const { dev, testId } = await setup({ joinMode: "invite" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const dee = await makeUser({ tester: true, name: "Dee Moss" });
    expect((await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [ana.user.id, dee.user.id] })).status).toBe(200);
    const oldAna = await db.invite.findFirstOrThrow({ where: { testId, testerId: ana.user.id, status: "sent" } });
    await db.user.update({ where: { id: dee.user.id }, data: { devSuspendedAt: new Date(), testerSuspendedAt: new Date() } });
    // Spots only: nothing re-sent.
    expect((await act(testId, "edit", dev.cookie, { version: await version(testId), fields: { spots: 5 } })).body.notReinvited).toEqual([]);
    expect(await db.invite.count({ where: { testId, status: "replaced" } })).toBe(0);
    // A price change: both old invites close; Ana gets a new one (bell + email); Dee isn't re-invited and is named.
    const r = await act(testId, "edit", dev.cookie, { version: await version(testId), fields: { writtenCents: "12.00" } });
    expect(r.body.notReinvited).toEqual(["Dee Moss (can't be invited right now)"]);
    expect(await db.invite.count({ where: { testId, status: "replaced" } })).toBe(2);
    const fresh = await db.invite.findFirstOrThrow({ where: { testId, testerId: ana.user.id, status: "sent" } });
    expect(fresh.id).not.toBe(oldAna.id);
    expect(fresh.remindedAt).toBeNull();
    expect(await db.notification.count({ where: { userId: ana.user.id, text: "Nora Lane updated Harbor Run: your invite was sent again on the new listing." } })).toBe(1);
    expect(await db.invite.count({ where: { testId, testerId: dee.user.id, status: "sent" } })).toBe(0);
    // Accept (Join) on the old invite: refused under the button, with the new invite.
    const old = await act(testId, "join", ana.cookie, { listingVersion: await listingVersion(testId), inviteId: oldAna.id });
    expect(old.body.error.code).toBe("invite_replaced");
    expect(old.body.error.message).toMatch(/^Nora Lane changed the listing at .+ and sent you a new invite:$/);
    expect(old.body.error.newInviteId).toBe(fresh.id);
    expect((await act(testId, "join", ana.cookie, { listingVersion: await listingVersion(testId), inviteId: fresh.id })).status).toBe(200);
  });
});

describe("applications close on a listing change", () => {
  it("closes pending applications (not for spots / who can join); the applicant is told; Accept on it is refused", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    await act(testId, "apply", ana.cookie, { note: "Hi" });
    await act(testId, "edit", dev.cookie, { version: await version(testId), fields: { spots: 4 } });
    expect((await db.application.findFirstOrThrow({ where: { testId, testerId: ana.user.id } })).status).toBe("pending");
    const pageLoaded = seen();
    await new Promise((r) => setTimeout(r, 30));
    const saved = await act(testId, "edit", dev.cookie, { version: await version(testId), fields: { description: "New words" }, tab: "tab-1" });
    expect(saved.body.closedApps).toEqual(["Ana Silva"]);
    const appA = await db.application.findFirstOrThrow({ where: { testId, testerId: ana.user.id } });
    expect(appA.status).toBe("closed");
    expect(await db.invite.count({ where: { testId } })).toBe(0);
    const told = "Harbor Run's listing changed, so your application was closed. You can apply again on the current listing.";
    expect(await db.notification.count({ where: { userId: ana.user.id, text: told } })).toBe(1);
    // The developer's Accept from a page that hadn't refreshed: refused; the line stops other buttons once.
    const a = await act(testId, "application", dev.cookie, { applicationId: appA.id, action: "accept", seenAt: pageLoaded, confirmed: true, tab: "tab-2" });
    expect(a.body.error.message).toMatch(/^Ana Silva's application closed when you changed the listing in another tab at .+\.$/);
    expect(await db.contract.count({ where: { testId } })).toBe(0);
    const stop = await act(testId, "stop", dev.cookie, { seenAt: pageLoaded, tab: "tab-2" });
    expect(stop.body.error.changes.map((c: { text: string }) => c.text)).toContain("You changed the listing in another tab: closed Ana Silva's application");
    // Ana's join page: the line, and she can apply again on the current listing.
    const { GET: liveGET } = await import("@/app/api/live/route");
    await new Promise((r) => setTimeout(r, 30)); // the database clock can run a few ms ahead: the live route lists changes only up to its own now
    const al = (await json(await liveGET(req(`/api/live?scope=listing:${testId}&since=${encodeURIComponent(pageLoaded)}`, { cookie: ana.cookie })))).body.changes.map((c: { text: string }) => c.text);
    expect(al).toContain("Nora Lane changed the listing: your application was closed");
    expect((await act(testId, "apply", ana.cookie, { note: "Again" })).body).toEqual({ applied: true });
  });
});

describe("rejoining restores the session", () => {
  it("a tester who left joins again on the current listing; old work keeps its price; the deadline restarts", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    await sact(sessionId, "message", tester.cookie, { body: "Thanks!" });
    expect((await sact(sessionId, "leave", tester.cookie, {})).status).toBe(200);
    await act(testId, "edit", dev.cookie, { version: await version(testId), fields: { writtenCents: "12.00", deadlineDays: 3 } });
    // They left with 5 days to go.
    await db.$executeRaw`UPDATE "Contract" SET "dueAt" = "endedAt" + interval '5 days' WHERE id = ${sessionId}`;
    // (Design doc 7.3) Coming back is an ask the developer accepts.
    expect((await act(testId, "join", tester.cookie, { listingVersion: await listingVersion(testId) })).body.error.code).toBe("ask");
    expect((await act(testId, "rejoin-ask", tester.cookie, { listingVersion: await listingVersion(testId), seenAt: seen(), confirmed: true, anyway: true })).body).toEqual({ asked: true });
    const ask = await db.application.findFirstOrThrow({ where: { testId, testerId: tester.user.id, kind: "rejoin" } });
    const back = await act(testId, "application", dev.cookie, { applicationId: ask.id, action: "accept", seenAt: seen(), confirmed: true });
    expect(back.status).toBe(200);
    expect(back.body.sessionId).toBe(sessionId);
    const c = await db.contract.findUniqueOrThrow({ where: { id: sessionId } });
    expect(c).toMatchObject({ status: "working", writtenCents: 1200, endedAt: null }); // (batch 12) the days field is gone: Edit ignores it
    expect(Math.round((c.dueAt.getTime() - Date.now()) / 86_400_000)).toBe(5); // the time they had left, not the new 3 days
    expect(await db.contract.count({ where: { testId, testerId: tester.user.id } })).toBe(1);
    expect(await db.contract.count({ where: { testerId: tester.user.id, status: "working" } })).toBe(1);
    // Old work, its price, the payment and the chat are all still there.
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).agreedCents).toBe(1000);
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(1);
    expect(await db.payment.count({ where: { contractId: sessionId, status: { in: ["charged", "not_set_up"] } } })).toBe(1);
    expect(await db.message.count({ where: { contractId: sessionId } })).toBe(1);
    const { paidSoFar } = await import("@/lib/server/payments");
    expect(await paidSoFar(sessionId)).toBe(1000);
    // Joining twice while working: the usual refusal.
    expect((await act(testId, "join", tester.cookie, { listingVersion: await listingVersion(testId) })).body.error.message).toBe("You've already joined this test.");
  });

  it("someone invited back who left after their deadline stays past it (sends are late); they can't ask", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "leave", tester.cookie, {});
    await db.$executeRaw`UPDATE "Contract" SET "dueAt" = "endedAt" - interval '2 days' WHERE id = ${sessionId}`;
    expect((await act(testId, "rejoin-ask", tester.cookie, { listingVersion: await listingVersion(testId), seenAt: seen(), confirmed: true, anyway: true })).body.error.message).toBe("You can't ask to rejoin this test.");
    await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [tester.user.id] });
    expect((await act(testId, "join", tester.cookie, { listingVersion: await listingVersion(testId) })).status).toBe(200);
    const c = await db.contract.findUniqueOrThrow({ where: { id: sessionId } });
    expect(Math.round((c.dueAt.getTime() - Date.now()) / 86_400_000)).toBe(-2);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const { isLate } = await import("@/lib/rules");
    expect(isLate(c.dueAt, sub.sentAt)).toBe(true);
    expect(sub.late).toBe(true);
  });

  it("a tester the developer ended can only come back through a new invite", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Ben Carter", "he");
    await act(testId, "end-early", dev.cookie, { seenAt: seen(), confirmed: true, contractId: sessionId, reason: "We have enough" });
    const r = await act(testId, "join", tester.cookie, { listingVersion: await listingVersion(testId) });
    expect(r.body.error.message).toBe("You can't join this test again.");
    expect((await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [tester.user.id] })).body.message).toBe("Invited Ben Carter.");
    const back = await act(testId, "join", tester.cookie, { listingVersion: await listingVersion(testId) });
    expect(back.body.sessionId).toBe(sessionId);
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("working");
  });
});

describe("owner corrections 2 and 3", () => {
  it("a title change is info only: never stops, never closes; a press notes it; a stop for other reasons lists it", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await act(testId, "edit", dev.cookie, { version: await version(testId), fields: { joinMode: "apply" } });
    const ben = await makeUser({ tester: true, name: "Ben Carter", pronoun: "he" });
    await act(testId, "apply", ben.cookie, { note: "Hi" });
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const pageLoaded = seen();
    await new Promise((r) => setTimeout(r, 30));
    await act(testId, "edit", dev.cookie, { version: await version(testId), fields: { title: "Harbor Run 2" } });
    expect((await db.application.findFirstOrThrow({ where: { testId, testerId: ben.user.id } })).status).toBe("pending");
    // The tester's top box has the line; a press goes through with the note.
    const { GET: liveGET } = await import("@/app/api/live/route");
    await new Promise((r) => setTimeout(r, 30)); // the database clock can run a few ms ahead: the live route lists changes only up to its own now
    const l = (await json(await liveGET(req(`/api/live?scope=session:${sessionId}&since=${encodeURIComponent(pageLoaded)}`, { cookie: tester.cookie })))).body.changes.map((c: { text: string }) => c.text);
    expect(l).toEqual(["Nora Lane renamed the test to Harbor Run 2"]);
    const go = await sact(sessionId, "request-time", tester.cookie, { startsAt: new Date(Date.now() + 50 * 3_600_000).toISOString(), seenAt: pageLoaded });
    expect(go.body.error ?? null).toBeNull();
    expect(go.body.note).toBeUndefined(); // (batch 15 section 24) no note under the press
    // With another reason (the developer paid), the stop lists the title line too.
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    const stop = await sact(sessionId, "request-time", tester.cookie, { startsAt: atHours(370), seenAt: pageLoaded });
    expect(stop.body.error.changes.map((c: { text: string }) => c.text)).toEqual(["Nora Lane renamed the test to Harbor Run 2", "Nora Lane paid $10.00 for your written answers"]);
    // The developer's other tab: goes through with the note; the join page: Apply goes through with it too.
    // (The developer's other tab: Ben's application and Ana's sends stop it once; the rename is listed with them.)
    const dv = await act(testId, "request-time", dev.cookie, { seenAt: pageLoaded, tab: "tab-2", contractIds: [sessionId], startsAt: new Date(Date.now() + 60 * 3_600_000).toISOString() });
    expect(dv.body.error.changes.map((c: { text: string }) => c.text)).toContain("You renamed the test to Harbor Run 2");
    const cara = await makeUser({ tester: true, name: "Cara Diaz" });
    const ap = await act(testId, "apply", cara.cookie, { note: "x", seenAt: pageLoaded });
    expect(ap.body.error ?? null).toBeNull();
    expect(ap.body.note).toBeUndefined();
  });

  it("description changes stay a stop reason on the session page", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const pageLoaded = seen();
    await new Promise((r) => setTimeout(r, 30));
    await act(testId, "edit", dev.cookie, { version: await version(testId), fields: { description: "Other words" } });
    const r = await sact(sessionId, "request-time", tester.cookie, { startsAt: atHours(377), seenAt: pageLoaded });
    expect(r.body.error.changes.map((c: { text: string }) => c.text)).toEqual(["Nora Lane changed the description"]);
  });

  it("switching to Invite only keeps invites open but closes pending applications (told; Accept refused; lines)", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    await act(testId, "apply", ana.cookie, { note: "Hi" });
    const dee = await makeUser({ tester: true, name: "Dee Moss" });
    await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [dee.user.id] });
    const pageLoaded = seen();
    await new Promise((r) => setTimeout(r, 30));
    const r = await act(testId, "edit", dev.cookie, { version: await version(testId), fields: { joinMode: "invite" }, tab: "tab-1" });
    expect(r.body.closedApps).toEqual(["Ana Silva"]);
    expect(await db.invite.count({ where: { testId, testerId: dee.user.id, status: "sent" } })).toBe(1);
    const app = await db.application.findFirstOrThrow({ where: { testId, testerId: ana.user.id } });
    expect(app.status).toBe("closed");
    expect(await db.notification.count({ where: { userId: ana.user.id, text: "Harbor Run is now invite only, so your application was closed." } })).toBe(1);
    const acc = await act(testId, "application", dev.cookie, { applicationId: app.id, action: "accept", seenAt: pageLoaded, confirmed: true, tab: "tab-2" });
    expect(acc.body.error.message).toMatch(/^Ana Silva's application closed when the test became invite only at .+\.$/);
    const stop = await act(testId, "stop", dev.cookie, { seenAt: pageLoaded, tab: "tab-2" });
    expect(stop.body.error.changes.map((c: { text: string }) => c.text)).toContain("You changed the listing in another tab: closed Ana Silva's application");
    const { GET: liveGET } = await import("@/app/api/live/route");
    await new Promise((r) => setTimeout(r, 30)); // the database clock can run a few ms ahead: the live route lists changes only up to its own now
    const al = (await json(await liveGET(req(`/api/live?scope=listing:${testId}&since=${encodeURIComponent(pageLoaded)}`, { cookie: ana.cookie })))).body.changes.map((c: { text: string }) => c.text);
    expect(al).toContain("Nora Lane made the test invite only: your application was closed");
    const ben = await makeUser({ tester: true, name: "Ben Carter" });
    expect((await act(testId, "apply", ben.cookie, { note: "x" })).body.error.message).toBe("This test is invite only.");
  });

});

describe("when the test fills (correction 4) and no invite cap (correction 5)", () => {
  it("any number of invites; the last spot taken closes the other applications; invites stay open and wait; a spot opening tells them", async () => {
    const { dev, testId } = await setup({ joinMode: "apply", spots: 1 });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const ben = await makeUser({ tester: true, name: "Ben Carter", pronoun: "he" });
    const dee = await makeUser({ tester: true, name: "Dee Moss" });
    const eve = await makeUser({ tester: true, name: "Eve Ray" });
    await act(testId, "apply", ana.cookie, { note: "a" });
    await act(testId, "apply", ben.cookie, { note: "b" });
    // Invites never hold spots: two open invites on a 1-spot test.
    expect((await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [dee.user.id, eve.user.id] })).body.message).toBe("Invited Dee Moss and Eve Ray.");
    const pageLoaded = seen();
    await new Promise((r) => setTimeout(r, 30));
    const appA = await db.application.findFirstOrThrow({ where: { testId, testerId: ana.user.id } });
    expect((await act(testId, "application", dev.cookie, { applicationId: appA.id, action: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await db.application.count({ where: { testId, status: "closed", closedReason: "full" } })).toBe(1);
    expect(await db.invite.count({ where: { testId, status: "sent" } })).toBe(2);
    expect(await db.notification.count({ where: { userId: ben.user.id, text: "Harbor Run is full, so your application was closed." } })).toBe(1);
    expect(await db.notification.count({ where: { userId: dee.user.id, text: "Harbor Run is full right now. Your invite stays open; we'll tell you when a spot opens." } })).toBe(1);
    // The developer: the line stops once (all tabs); Accept on Ben's is refused for good.
    const stop = await act(testId, "stop", dev.cookie, { seenAt: pageLoaded });
    expect(stop.body.error.changes.map((c: { text: string }) => c.text)).toContain("Harbor Run is full: closed 1 application. 2 invites stay open until a spot opens");
    const appB = await db.application.findFirstOrThrow({ where: { testId, testerId: ben.user.id } });
    expect((await act(testId, "application", dev.cookie, { applicationId: appB.id, action: "accept", seenAt: seen(), confirmed: true })).body.error.message).toMatch(/^Ben Carter's application closed when the test filled up at /);
    // Dee's Accept (Join) while full: refused; her join page says so.
    expect((await act(testId, "join", dee.cookie, { listingVersion: await listingVersion(testId) })).body.error.message).toBe("Harbor Run is full right now.");
    const { GET: liveGET } = await import("@/app/api/live/route");
    await new Promise((r) => setTimeout(r, 30)); // the database clock can run a few ms ahead: the live route lists changes only up to its own now
    const dl = (await json(await liveGET(req(`/api/live?scope=listing:${testId}&since=${encodeURIComponent(pageLoaded)}`, { cookie: dee.cookie })))).body.changes.map((c: { text: string }) => c.text);
    expect(dl).toContain("Harbor Run is full right now. Your invite stays open; we'll tell you when a spot opens.");
    // The developer raises spots: a spot opened, both invited testers are told; Ben (closed) isn't; Dee joins.
    await act(testId, "edit", dev.cookie, { version: await version(testId), fields: { spots: 2 } });
    expect(await db.notification.count({ where: { userId: dee.user.id, text: "A spot opened on Harbor Run: you can accept Nora Lane's invite now." } })).toBe(1);
    expect(await db.notification.count({ where: { userId: eve.user.id, text: "A spot opened on Harbor Run: you can accept Nora Lane's invite now." } })).toBe(1);
    expect(await db.notification.count({ where: { userId: ben.user.id, text: { startsWith: "A spot opened" } } })).toBe(0);
    expect((await act(testId, "join", dee.cookie, { listingVersion: await listingVersion(testId) })).status).toBe(200);
    expect(await db.application.count({ where: { testId, status: "pending" } })).toBe(0); // nothing reopens
  });

  it("two testers joining for the last spot at the same moment: one gets it, the other is refused; the rest close", async () => {
    const { dev, testId } = await setup({ spots: 1 });
    const a = await makeUser({ tester: true, name: "Ana Silva" });
    const b = await makeUser({ tester: true, name: "Ben Carter" });
    const c = await makeUser({ tester: true, name: "Cara Diaz" });
    await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [c.user.id] });
    const [ra, rb] = await Promise.all([act(testId, "join", a.cookie, { listingVersion: 1 }), act(testId, "join", b.cookie, { listingVersion: 1 })]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    expect(await db.contract.count({ where: { testId, status: "working" } })).toBe(1);
    expect(await db.invite.count({ where: { testId, status: "sent" } })).toBe(1); // invites stay open while full
  });

  it("lowering spots to the testers in fills the test (closes applications, invites wait); raising them opens a spot", async () => {
    const { dev, testId } = await setup({ spots: 3 });
    await joined(testId);
    await act(testId, "edit", dev.cookie, { version: await version(testId), fields: { joinMode: "apply" } });
    const ben = await makeUser({ tester: true, name: "Ben Carter" });
    await act(testId, "apply", ben.cookie, { note: "b" });
    const dee = await makeUser({ tester: true, name: "Dee Moss" });
    await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [dee.user.id] });
    await act(testId, "edit", dev.cookie, { version: await version(testId), fields: { spots: 2 } });
    expect(await db.application.count({ where: { testId, status: "pending" } })).toBe(1);
    await act(testId, "edit", dev.cookie, { version: await version(testId), fields: { spots: 1 } });
    expect(await db.application.count({ where: { testId, status: "closed", closedReason: "full" } })).toBe(1);
    expect(await db.invite.count({ where: { testId, status: "sent" } })).toBe(1);
  });

  it("each open invite gets the 'full' and the 'spot opened' notice at most once (fill, reopen, fill, reopen)", async () => {
    const { dev, testId } = await setup({ spots: 1 });
    const dee = await makeUser({ tester: true, name: "Dee Moss" });
    await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [dee.user.id] });
    const a = await joined(testId); // fill
    await sact(a.sessionId, "leave", a.tester.cookie, {}); // reopen
    const b = await joined(testId, "Ben Carter", "he"); // fill
    await sact(b.sessionId, "leave", b.tester.cookie, {}); // reopen
    expect(await db.notification.count({ where: { userId: dee.user.id, text: "Harbor Run is full right now. Your invite stays open; we'll tell you when a spot opens." } })).toBe(1);
    expect(await db.notification.count({ where: { userId: dee.user.id, text: "A spot opened on Harbor Run: you can accept Nora Lane's invite now." } })).toBe(1);
    expect(await db.invite.count({ where: { testId, testerId: dee.user.id, status: "sent" } })).toBe(1);
  });

  it("after leaving: Find lists the test ('You left this test'); the page keeps updates; Join again stops once for paid + new terms (plain line)", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    await sact(sessionId, "leave", tester.cookie, {});
    const { findTests } = await import("@/lib/server/tests");
    const found = await findTests(tester.user as never);
    expect(found.some((t) => t.id === testId && t.contracts.some((c) => c.status === "left"))).toBe(true);
    const pageLoaded = seen();
    await new Promise((r) => setTimeout(r, 30));
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    await act(testId, "edit", dev.cookie, { version: await version(testId), fields: { writtenCents: "12.00" } });
    // The old session page's top box still shows the payment.
    const { GET: liveGET } = await import("@/app/api/live/route");
    await new Promise((r) => setTimeout(r, 30)); // the database clock can run a few ms ahead: the live route lists changes only up to its own now
    const sl = (await json(await liveGET(req(`/api/live?scope=session:${sessionId}&since=${encodeURIComponent(pageLoaded)}`, { cookie: tester.cookie })))).body.changes.map((c: { text: string }) => c.text);
    expect(sl).toContain("Nora Lane paid $10.00 for your written answers");
    // Ask to rejoin (the listing's button) stops once: paid, the terms as a plain line; then the ask goes through.
    const j = await act(testId, "rejoin-ask", tester.cookie, { listingVersion: await listingVersion(testId), seenAt: pageLoaded });
    const lines = j.body.error.changes.map((c: { text: string }) => c.text);
    expect(lines).toEqual(expect.arrayContaining(["Nora Lane paid $10.00 for your written answers", "Nora Lane changed the terms: written $10 → $12"]));
    expect(j.body.error.top).toBeUndefined(); // no offer box, no scroll to the top
    expect((await act(testId, "rejoin-ask", tester.cookie, { listingVersion: await listingVersion(testId), seenAt: pageLoaded, confirmed: true, anyway: true })).body).toEqual({ asked: true });
  });
});
