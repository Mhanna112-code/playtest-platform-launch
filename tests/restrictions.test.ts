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

  it("testers in the test see it paused (never why): joining, calls and sending wait; (batch 6) Charge goes through at once, Let it go works; lifting resumes it", async () => {
    const { dev, testId, sessionId, tester, sub } = await withWork();
    const a = await admin();
    await adm("suspend", a.cookie, { id: dev.user.id, note: "Spam" });
    const ben = await makeUser({ tester: true });
    expect((await act(testId, "join", ben.cookie, { listingVersion: 1 })).body.error.message).toBe("This test is paused right now.");
    const r = await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), startsAt: atHours(80) });
    expect(r.body.error.message).not.toMatch(/suspend|hold|fail/i);
    await db.submission.update({ where: { id: sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 86_400_000) } });
    // (Owner, Oct 28 afternoon) Under the team's suspension with no hold a Charge is charged at once; sending waits. They read only "paused".
    const ch = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true });
    expect(ch.status).toBe(200);
    expect(ch.body.status).not.toBe("owed");
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] })).body.error.message).toBe("This test is paused right now. You can send this once it resumes.");
    expect((await adm("unsuspend", a.cookie, { id: dev.user.id })).status).toBe(200);
    expect(await db.testEvent.count({ where: { testId, kind: "resumed" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "is running again" } } })).toBe(1);
  });

  it("(batch 5 item 3) the closed pages: every signed-in page except the dashboard, Payments, Settings and the bell list, for a restricted developer and a suspended tester", () => {
    const dev = { isDeveloper: true, isTester: false, devSuspendedAt: new Date() };
    const held = { isDeveloper: true, isTester: false, holdStartedAt: new Date() };
    const tester = { isDeveloper: false, isTester: true, testerSuspendedAt: new Date() };
    for (const u of [dev, held]) {
      for (const p of ["/app/tests/abc", "/app/tests/abc/edit", "/app/tests/new", "/app/messages", "/app/chat/x", "/app/profile", "/app/testers/x", "/app/developers/x", "/app/find", "/app/find/x", "/app/sessions/x", "/app/calls/x"]) expect(closedForSuspended(p, u), p).toBe(true);
      for (const p of ["/app", "/app/", "/app?failed=x", "/app/payments", "/app/help", "/app/account", "/app/account/blocked", "/app/notifications", "/app/switch"]) expect(closedForSuspended(p, u), p).toBe(false);
    }
    for (const p of ["/app/find", "/app/find/x", "/app/profile", "/app/messages", "/app/chat/x", "/app/sessions/x", "/app/calls/x", "/app/testers/x", "/app/developers/x"]) expect(closedForSuspended(p, tester), p).toBe(true);
    expect(closedForSuspended("/app/help", tester)).toBe(false);
    expect(closedForSuspended("/app/payments", tester)).toBe(false);
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

    // Lifting (owner, Oct 28): NO automatic re-invite; the held share is released (waits for a payout account).
    expect((await adm("unsuspend", a.cookie, { id: ana.tester.user.id })).status).toBe(200);
    expect(await db.invite.count({ where: { testId: open.testId, testerId: ana.tester.user.id, status: "sent" } })).toBe(0);
    expect(await db.invite.count({ where: { testId: inviteOnly.testId, testerId: ana.tester.user.id, status: "sent" } })).toBe(0);
    expect(await db.notification.count({ where: { userId: ana.tester.user.id, text: { startsWith: "You're invited back" } } })).toBe(0);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).transferStatus).toBe("waiting");
    expect(await db.notification.count({ where: { userId: ana.tester.user.id, text: "Your tester account is active again" } })).toBe(1); // (batch 15 section 16: the side is named)
    // The removed tests wait on her dashboard with Ask to rejoin until she asks or dismisses them; asking takes the card away.
    expect((await db.contract.findUniqueOrThrow({ where: { id: sess2 } })).endKind).toBe("suspended");
    expect((await act(open.testId, "join", ana.tester.cookie, { listingVersion: 1 })).body.error.code).toBe("ask");
    expect((await act(open.testId, "rejoin-ask", ana.tester.cookie, { listingVersion: 1, seenAt: seen(), confirmed: true, anyway: true })).body).toEqual({ asked: true });
    expect((await db.contract.findUniqueOrThrow({ where: { id: ana.sessionId } })).removedDismissedAt).not.toBeNull();
    // The developer can also invite her again as usual: with her ask waiting, the invite joins her at once.
    expect((await act(open.testId, "invite", open.dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [ana.tester.user.id] })).status).toBe(200);
    expect((await db.contract.findUniqueOrThrow({ where: { id: ana.sessionId } })).status).toBe("working");
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
    const { dev, testId, sessionId, tester, sub } = await withWork();
    const email = dev.user.email;
    // (Owner, Oct 28; DEFAULT) Work waiting for Pay or Reject blocks a developer's deletion: pay it first.
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, confirmed: true })).status).toBe(200);
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
    await expect(logIn({ email, password: "whatever123" })).rejects.toMatchObject({ message: "Wrong email or password" }); // (batch 15 section 7: one message)
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
    expect((await act(testId, "join", ben.cookie, { listingVersion: 1 })).body.error.message).toBe("This test is paused right now.");
    expect((await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), startsAt: atHours(80) })).body.error.message).toMatch(/paused/);
    await adm("unpause-test", a.cookie, { id: testId });
    expect((await act(testId, "edit", dev.cookie, { version: (await db.test.findUniqueOrThrow({ where: { id: testId } })).version, fields: { title: "Back" } })).status).toBe(200);
    await adm("stop-test", a.cookie, { id: testId, note: "Policy" });
    const s = await act(testId, "next-round", dev.cookie, { seenAt: seen(), confirmed: true });
    expect(s.body.error).toMatchObject({ code: "admin_stopped", failed: "Your Next round on Back didn't go through" });
    expect(await db.test.findUniqueOrThrow({ where: { id: testId } })).toMatchObject({ status: "stopped" });
  });
});
