import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { GET as statusGET } from "@/app/api/account/status/route";
import { POST as deletePOST } from "@/app/api/account/delete/route";
import { cancelLateSuspensionCalls } from "@/lib/server/restrictions";
import { closedForSuspended } from "@/lib/closedPages";
import { logIn } from "@/lib/server/passwords";
import { json, makeUser, req } from "./helpers";
import { act, atHours, bookCall, joined, sact, seen, setup } from "./fixtures";

const admin = async () => {
  const a = await makeUser({ name: "Admin" });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
};
const adm = (action: string, cookie: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), ...body } })).then(json);
const later = () => new Promise((r) => setTimeout(r, 30));
async function withWork() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  await later();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  return { ...s, ...j, sub };
}

describe("a suspended developer (design doc 2 and 11.4)", () => {
  it("names the press that failed; Pay and Reject are refused too, only Cancel call goes through", async () => {
    const { dev, testId, sub, sessionId, tester } = await withWork();
    const a = await admin();
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 24 * 6);
    expect((await adm("suspend", a.cookie, { id: dev.user.id, note: "Spam" })).status).toBe(200);
    const r = await act(testId, "edit", dev.cookie, { version: 1, fields: { title: "New" } });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatchObject({ code: "suspended", failed: "Your Save on Harbor Run didn't go through" });
    expect((await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [] })).body.error.failed).toBe("Your Invite on Harbor Run didn't go through");
    expect((await pay(dev.cookie, { action: "reject", kind: "submission", id: sub.id, reason: "Not enough here", confirmed: true })).body.error.code).toBe("suspended");
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, confirmed: true })).body.error.code).toBe("suspended");
    // Cancel call is allowed (the call is 6 days away, so the suspension had not cancelled it yet).
    expect((await act(testId, "cancel-call", dev.cookie, { callId: call.id, seenAt: seen(), confirmed: true })).status).toBe(200);
  });

  it("calls within 3 days are cancelled at once with no fault; later ones when the suspension still holds 3 days before them", async () => {
    const { dev, testId, sessionId, tester } = await withWork();
    const a = await admin();
    const near = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 48);
    const far = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 24 * 6);
    await adm("suspend", a.cookie, { id: dev.user.id, note: "Spam" });
    expect((await db.call.findUniqueOrThrow({ where: { id: near.id } })).status).toBe("cancelled");
    expect((await db.call.findUniqueOrThrow({ where: { id: near.id } })).cancelledBy).toBe("system");
    expect((await db.call.findUniqueOrThrow({ where: { id: far.id } })).status).toBe("booked");
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "was cancelled because the test is paused" } } })).toBe(1);
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { contains: "was cancelled because the test is paused" } } })).toBe(1);
    // Three days before the later call, still suspended: cancelled.
    await cancelLateSuspensionCalls(new Date(far.startsAt.getTime() - 2.9 * 86_400_000));
    expect((await db.call.findUniqueOrThrow({ where: { id: far.id } })).status).toBe("cancelled");
  });

  it("testers in the test see it paused (never why): joining and calls wait, Charge waits, Let it go works; lifting resumes it", async () => {
    const { dev, testId, sessionId, tester, sub } = await withWork();
    const a = await admin();
    await adm("suspend", a.cookie, { id: dev.user.id, note: "Spam" });
    const ben = await makeUser({ tester: true });
    expect((await act(testId, "join", ben.cookie, { listingVersion: 1 })).body.error.message).toBe("This test is paused, so it isn't taking new testers right now.");
    const r = await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), startsAt: atHours(80) });
    expect(r.body.error.message).not.toMatch(/suspend|hold|fail/i);
    await db.submission.update({ where: { id: sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 86_400_000) } });
    // (Owner, Oct 27) Under the team's suspension testers can only cancel booked calls (and rate): Charge and Let it go wait too. They read only "paused".
    const ch = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", amount: "10.00", tickedCents: 1000 });
    expect(ch.body.error.message).toBe("This test is paused right now. You can only cancel booked calls for now.");
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "letgo", seenAt: seen(), confirmed: true })).body.error.message).toBe("This test is paused right now. You can only cancel booked calls for now.");
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] })).body.error.code).toBe("paused");
    expect((await adm("unsuspend", a.cookie, { id: dev.user.id })).status).toBe(200);
    expect(await db.testEvent.count({ where: { testId, kind: "resumed" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "is running again" } } })).toBe(1);
  });

  it("the closed pages: test pages, Edit, Post and Messages for a restricted developer; Find, the profile editor and Messages for a suspended tester", () => {
    const dev = { isDeveloper: true, isTester: false, suspendedAt: new Date() };
    const held = { isDeveloper: true, isTester: false, holdStartedAt: new Date() };
    const tester = { isDeveloper: false, isTester: true, suspendedAt: new Date() };
    for (const u of [dev, held]) {
      for (const p of ["/app/tests/abc", "/app/tests/abc/edit", "/app/tests/new", "/app/messages", "/app/chat/x", "/app/profile"]) expect(closedForSuspended(p, u), p).toBe(true);
      for (const p of ["/app", "/app/payments", "/app/help", "/app/account", "/app/notifications", "/app/testers/x"]) expect(closedForSuspended(p, u), p).toBe(false);
    }
    expect(closedForSuspended("/app/find", tester)).toBe(true);
    expect(closedForSuspended("/app/profile", tester)).toBe(true);
    expect(closedForSuspended("/app/messages", tester)).toBe(true);
    expect(closedForSuspended("/app/help", tester)).toBe(false);
    expect(closedForSuspended("/app/sessions/x", tester)).toBe(false);
    // A hold restricts only the developer side of an account with both.
    const both = { isDeveloper: true, isTester: true, holdStartedAt: new Date(), side: "tester" };
    expect(closedForSuspended("/app/tests/abc", both, "developer")).toBe(true);
    expect(closedForSuspended("/app/find", both, "tester")).toBe(false);
    expect(closedForSuspended("/app/messages", both, "tester")).toBe(false);
    expect(closedForSuspended("/app/messages", both, "developer")).toBe(true);
    expect(closedForSuspended("/app/tests/abc", { isDeveloper: true, isTester: false }, "developer")).toBe(false); // nobody restricted
  });
});

describe("a suspended tester (design doc 2 and 11.4)", () => {
  it("is removed from every test at once; the developer only sees 'left'; every press is refused; their pay is charged and the share held; reinstated -> re-invited or labelled", async () => {
    const open = await setup();
    const inviteOnly = await setup({ joinMode: "invite" });
    const a = await admin();
    const ana = await joined(open.testId, "Ana Silva");
    // Invite-only test: invited, then joined.
    await act(inviteOnly.testId, "invite", inviteOnly.dev.cookie, { seenAt: seen(), testerIds: [ana.tester.user.id] });
    expect((await act(inviteOnly.testId, "join", ana.tester.cookie, { listingVersion: 1 })).status).toBe(200);
    const sess2 = (await db.contract.findFirstOrThrow({ where: { testId: inviteOnly.testId, testerId: ana.tester.user.id } })).id;
    await sact(ana.sessionId, "written", ana.tester.cookie, { answers: ["a", "b"] });
    await later();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId } });
    const call = await bookCall(open.testId, open.dev.cookie, ana.sessionId, ana.tester.cookie, 30);

    expect((await adm("suspend", a.cookie, { id: ana.tester.user.id, note: "Fake work" })).status).toBe(200);
    for (const id of [ana.sessionId, sess2]) expect(await db.contract.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "left", endKind: "suspended" });
    expect((await db.call.findUniqueOrThrow({ where: { id: call.id } })).status).toBe("cancelled");
    const lines = (await db.testEvent.findMany({ where: { testId: open.testId, kind: "left" } })).map((e) => e.text);
    expect(lines).toEqual(["Ana Silva left the test"]); // never why
    expect((await sact(ana.sessionId, "written", ana.tester.cookie, { answers: ["x", "y"] })).body.error.code).toBe("suspended");
    expect((await sact(ana.sessionId, "written", ana.tester.cookie, { answers: ["x", "y"] })).body.error.failed).toBe("Your Send on Harbor Run didn't go through");

    // The developer can still pay their work: the card is charged, the share is held (neutral wording).
    const r = await pay(open.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, confirmed: true });
    expect(r.status).toBe(200);
    expect(r.body.later).toBe("Ana Silva will receive it later");
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: sub.id } });
    expect(p.transferStatus).toBe("held");
    expect(JSON.stringify(r.body)).not.toMatch(/suspend/i);

    // Lifting: re-invited to every test that is still open with spots (invite-only ones too); the held share is released (waits for a payout account).
    expect((await adm("unsuspend", a.cookie, { id: ana.tester.user.id })).status).toBe(200);
    expect(await db.invite.count({ where: { testId: open.testId, testerId: ana.tester.user.id, status: "sent" } })).toBe(1);
    expect(await db.invite.count({ where: { testId: inviteOnly.testId, testerId: ana.tester.user.id, status: "sent" } })).toBe(1); // (Owner, Oct 27) no invite-only exception
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).transferStatus).toBe("waiting");
    expect(await db.notification.count({ where: { userId: ana.tester.user.id, text: "Your account is active again" } })).toBe(1);
    // The removal keeps its "Suspended" label until she rejoins; the invite on the open test brings her back with one Join.
    expect((await db.contract.findUniqueOrThrow({ where: { id: sess2 } })).endKind).toBe("suspended");
    expect((await act(open.testId, "join", ana.tester.cookie, { listingVersion: 1 })).status).toBe(200);
  });

  it("admin refunds or releases a held share", async () => {
    const { dev, sub, tester } = await withWork();
    const a = await admin();
    await adm("suspend", a.cookie, { id: tester.user.id, note: "Fake work" });
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, confirmed: true });
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: sub.id } });
    expect((await adm("refund-share", a.cookie, { id: p.id })).status).toBe(200);
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "refunded", transferStatus: "refunded" });
  });
});

describe("deleting an account (design doc 2, 9, 11.4)", () => {
  it("stops its tests, removes it from the tests it is in, ends sign-in, and every open tab learns it", async () => {
    const { dev, testId, sessionId, tester } = await withWork();
    const email = dev.user.email;
    const before = await json(await statusGET(req("/api/account/status", { cookie: dev.cookie })));
    expect(before.body.state).toBe("ok");
    const r = await json(await deletePOST(req("/api/account/delete", { cookie: dev.cookie, body: { confirmed: true } })));
    expect(r.status).toBe(200);
    expect(await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).toMatchObject({ deletedBy: "self" });
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).status).toBe("stopped");
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("ended");
    expect((await json(await statusGET(req("/api/account/status", { cookie: dev.cookie })))).body.state).toBe("deleted");
    // API calls from the deleted account say so; logging in is refused with the red line.
    const a = await act(testId, "edit", dev.cookie, { version: 1, fields: {} });
    expect(a.status).toBe(401);
    expect(a.body.error.code).toBe("deleted");
    await expect(logIn({ email, password: "whatever123" })).rejects.toMatchObject({ message: "This account no longer exists" });
    // The tester can still read their session; history stays.
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["x", "y"] })).status).toBe(409);
  });

  it("the team deleting an account records who and why", async () => {
    const t = await makeUser({ tester: true });
    const a = await admin();
    expect((await adm("delete-account", a.cookie, { id: t.user.id, note: "Abuse" })).status).toBe(200);
    expect(await db.user.findUniqueOrThrow({ where: { id: t.user.id } })).toMatchObject({ deletedBy: "admin", deleteReason: "Abuse" });
  });
});

describe("the team pausing or stopping a test (design doc 6)", () => {
  it("paused: the developer can only stop it; testers see it paused. Stopped: every press fails and names the press", async () => {
    const { dev, testId, sessionId, tester } = await withWork();
    const a = await admin();
    await adm("pause-test", a.cookie, { id: testId, note: "Reported" });
    const e = await act(testId, "edit", dev.cookie, { version: 1, fields: { title: "x" } });
    expect(e.body.error).toMatchObject({ code: "admin_paused", failed: "Your Save on Harbor Run didn't go through" });
    const ben = await makeUser({ tester: true });
    expect((await act(testId, "join", ben.cookie, { listingVersion: 1 })).body.error.message).toBe("This test is paused, so it isn't taking new testers right now.");
    expect((await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), startsAt: atHours(80) })).body.error.message).toMatch(/paused/);
    await adm("unpause-test", a.cookie, { id: testId });
    expect((await act(testId, "edit", dev.cookie, { version: (await db.test.findUniqueOrThrow({ where: { id: testId } })).version, fields: { title: "Back" } })).status).toBe(200);
    await adm("stop-test", a.cookie, { id: testId, note: "Policy" });
    const s = await act(testId, "next-round", dev.cookie, { seenAt: seen(), confirmed: true });
    expect(s.body.error).toMatchObject({ code: "admin_stopped", failed: "Your Next round on Back didn't go through" });
    expect(await db.test.findUniqueOrThrow({ where: { id: testId } })).toMatchObject({ status: "stopped" });
  });
});
