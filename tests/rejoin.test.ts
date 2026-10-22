import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { json, makeUser, req } from "./helpers";
import { act, joined, sact, seen, setup } from "./fixtures";

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
    await db.user.update({ where: { id: dee.user.id }, data: { suspendedAt: new Date() } });
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
    expect(await db.notification.count({ where: { userId: ana.user.id, text: { startsWith: "Nora Lane updated Harbor Run, so here's a new invite: Written $9.60" } } })).toBe(1);
    expect(await db.invite.count({ where: { testId, testerId: dee.user.id, status: "sent" } })).toBe(0);
    // Accept (Join) on the old invite: refused under the button, with the new invite.
    const old = await act(testId, "join", ana.cookie, { listingVersion: await listingVersion(testId), inviteId: oldAna.id });
    expect(old.body.error.code).toBe("invite_replaced");
    expect(old.body.error.message).toMatch(/^Nora Lane changed the listing at .+ and sent you a new invite:$/);
    expect(old.body.error.newInviteId).toBe(fresh.id);
    expect((await act(testId, "join", ana.cookie, { listingVersion: await listingVersion(testId), inviteId: fresh.id })).status).toBe(200);
  });

  it("caps invites at the spots left (open invites count); a re-send keeps the earliest-invited; lines on both sides", async () => {
    const { dev, testId } = await setup({ joinMode: "invite", spots: 2 });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const dee = await makeUser({ tester: true, name: "Dee Moss" });
    const cara = await makeUser({ tester: true, name: "Cara Diaz" });
    await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [ana.user.id] });
    await new Promise((r) => setTimeout(r, 5));
    await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [dee.user.id] });
    const capped = await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [cara.user.id] });
    expect(capped.body.error.message).toBe("Only 2 spots are left and 2 people are already invited. Cancel an invite or add spots.");
    const pageLoaded = seen();
    await new Promise((r) => setTimeout(r, 5));
    const r = await act(testId, "edit", dev.cookie, { version: await version(testId), fields: { spots: 1, writtenCents: "11.00" }, tab: "tab-1" });
    expect(r.body.notReinvited).toEqual(["Dee Moss (no spots left)"]);
    expect(r.body.resent).toEqual(["Ana Silva"]);
    expect(await db.invite.count({ where: { testId, status: "sent" } })).toBe(1);
    expect(await db.invite.count({ where: { testId, testerId: ana.user.id, status: "sent" } })).toBe(1);
    // The developer's other tab (reason E): one line naming the closings, and a stop once on any button.
    const { GET: liveGET } = await import("@/app/api/live/route");
    const lines = (await json(await liveGET(req(`/api/live?scope=test:${testId}&since=${encodeURIComponent(pageLoaded)}`, { cookie: dev.cookie, headers: { "x-tab": "tab-2" } })))).body.changes.map((c: { text: string }) => c.text);
    expect(lines).toEqual(["You changed the listing in another tab: re-sent Ana Silva's invite and didn't re-invite Dee Moss (no spots left)"]);
    expect((await act(testId, "next-round", dev.cookie, { seenAt: pageLoaded, tab: "tab-2" })).body.error.code).toBe("stop_once");
    // The saving tab itself: nothing.
    expect((await json(await liveGET(req(`/api/live?scope=test:${testId}&since=${encodeURIComponent(pageLoaded)}`, { cookie: dev.cookie, headers: { "x-tab": "tab-1" } })))).body.changes).toEqual([]);
    // Ana's join page (opened before): the line and a stop once on Join.
    const al = (await json(await liveGET(req(`/api/live?scope=listing:${testId}&since=${encodeURIComponent(pageLoaded)}`, { cookie: ana.cookie })))).body.changes.map((c: { text: string }) => c.text);
    expect(al).toContain("Nora Lane changed the listing: here's a new invite on the updated listing");
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
    await new Promise((r) => setTimeout(r, 5));
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
    // Never "You've already joined" for someone who left.
    const back = await act(testId, "join", tester.cookie, { listingVersion: await listingVersion(testId) });
    expect(back.status).toBe(200);
    expect(back.body.sessionId).toBe(sessionId);
    const c = await db.contract.findUniqueOrThrow({ where: { id: sessionId } });
    expect(c).toMatchObject({ status: "working", writtenCents: 1200, deadlineDays: 3, endedAt: null });
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

  it("someone who left after their deadline stays past it (sends are late)", async () => {
    const { testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "leave", tester.cookie, {});
    await db.$executeRaw`UPDATE "Contract" SET "dueAt" = "endedAt" - interval '2 days' WHERE id = ${sessionId}`;
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
