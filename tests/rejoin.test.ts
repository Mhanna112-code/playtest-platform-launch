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
    expect(old.body.error.message).toBe("This invite was replaced by a new one with the current listing.");
    expect(old.body.error.newInviteId).toBe(fresh.id);
    expect((await act(testId, "join", ana.cookie, { listingVersion: await listingVersion(testId), inviteId: fresh.id })).status).toBe(200);
  });
});

describe("applications after a listing change", () => {
  it("Accept doesn't join someone who applied before the change; unchanged listings join at once", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    await act(testId, "apply", ana.cookie, { note: "Hi" });
    await act(testId, "edit", dev.cookie, { version: await version(testId), fields: { description: "New words" } });
    const ben = await makeUser({ tester: true, name: "Ben Carter", pronoun: "he" });
    await act(testId, "apply", ben.cookie, { note: "Hello" });
    const appA = await db.application.findFirstOrThrow({ where: { testId, testerId: ana.user.id } });
    const a = await act(testId, "application", dev.cookie, { applicationId: appA.id, action: "accept", seenAt: seen(), confirmed: true });
    expect(a.body).toEqual({ asked: true, message: "Ana Silva applied before your changes, so she'll be asked to join on the current listing." });
    expect(await db.contract.count({ where: { testId, testerId: ana.user.id } })).toBe(0);
    expect(await db.notification.count({ where: { userId: ana.user.id, text: "Harbor Run changed since you applied" } })).toBe(1);
    // Ana joins on the current listing herself.
    expect((await act(testId, "join", ana.cookie, { listingVersion: await listingVersion(testId) })).status).toBe(200);
    // Ben applied after the change: Accept joins him at once.
    const appB = await db.application.findFirstOrThrow({ where: { testId, testerId: ben.user.id } });
    expect((await act(testId, "application", dev.cookie, { applicationId: appB.id, action: "accept", seenAt: seen(), confirmed: true })).body.asked).toBeUndefined();
    expect(await db.contract.count({ where: { testId, testerId: ben.user.id, status: "working" } })).toBe(1);
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
    // Never "You've already joined" for someone who left.
    const back = await act(testId, "join", tester.cookie, { listingVersion: await listingVersion(testId) });
    expect(back.status).toBe(200);
    expect(back.body.sessionId).toBe(sessionId);
    const c = await db.contract.findUniqueOrThrow({ where: { id: sessionId } });
    expect(c).toMatchObject({ status: "working", writtenCents: 1200, deadlineDays: 3, endedAt: null });
    expect(Math.round((c.dueAt.getTime() - Date.now()) / 86_400_000)).toBe(3);
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
