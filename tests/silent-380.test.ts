import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as excerptsPOST } from "@/app/api/excerpts/route";
import { POST as invitePOST } from "@/app/api/invites/[id]/route";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import { GET as statusGET } from "@/app/api/account/status/route";
import { blocksChange } from "@/components/SessionWatch";
import { json, makeUser, req } from "./helpers";
import { act, atHours, bookCall, joined, sact, seen, setup } from "./fixtures";

// (Owner, Nov 11, §380 item 2) Silent when the result is already what you wanted: no refusal, just success (the page redraws). The kept refusals still read
// correctly. (Item 3 and its Nov 11 addition) A block reaches every open page of both people through the account check.

const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const ex = (cookie: string, body: Record<string, unknown>) => excerptsPOST(req("/api/excerpts", { cookie, body })).then(json);
const noThanks = (cookie: string, id: string) => invitePOST(req(`/api/invites/${id}`, { cookie, body: { confirmed: true } }), { params: Promise.resolve({ id }) }).then(json);
const block = (cookie: string, userId: string, action?: string) => blocksPOST(req("/api/blocks", { cookie, body: { userId, ...(action ? { action } : {}) } })).then(json);
const status = (cookie: string) => statusGET(req("/api/account/status", { cookie })).then(json).then((r) => r.body.blocks as string);
const WHY = "We have what we need now.";

describe("§380 silent when already done", () => {
  it("Withdraw application: declined → silent (J10); accepted keeps its one line", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const t = await makeUser({ tester: true, name: "Dee Moss" });
    expect((await act(testId, "apply", t.cookie, { seenAt: seen(), note: "hi" })).status).toBe(200);
    const a = await db.application.findFirstOrThrow({ where: { testId, testerId: t.user.id } });
    expect((await act(testId, "application", dev.cookie, { applicationId: a.id, action: "decline", seenAt: seen(), confirmed: true })).status).toBe(200);
    const w = await act(testId, "withdraw-application", t.cookie, { seenAt: seen() });
    expect(w.status).toBe(200);
    expect(w.body.already).toBe(true);
    // Its own action is not logged (it did nothing).
    expect(await db.actionLog.count({ where: { userId: t.user.id, testId, text: { startsWith: "withdrew" } } })).toBe(0);
    // Accepted: the one refusal stays.
    const u = await makeUser({ tester: true, name: "Eli Park" });
    expect((await act(testId, "apply", u.cookie, { seenAt: seen(), note: "hi" })).status).toBe(200);
    const b = await db.application.findFirstOrThrow({ where: { testId, testerId: u.user.id } });
    expect((await act(testId, "application", dev.cookie, { applicationId: b.id, action: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
    const w2 = await act(testId, "withdraw-application", u.cookie, { seenAt: seen() });
    expect(w2.status).toBe(409);
    expect(w2.body.error.message).toMatch(/^Nora Lane accepted your application at .*, so you're in this test\.$/);
  });

  it("Decline application: withdrawn or already declined → silent (J13, J14); Accept on a withdrawn one keeps its refusal", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const t = await makeUser({ tester: true, name: "Dee Moss", pronoun: "she" });
    await act(testId, "apply", t.cookie, { seenAt: seen(), note: "hi" });
    const a = await db.application.findFirstOrThrow({ where: { testId, testerId: t.user.id } });
    expect((await act(testId, "withdraw-application", t.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    const d = await act(testId, "application", dev.cookie, { applicationId: a.id, action: "decline", seenAt: seen() });
    expect(d.status).toBe(200);
    expect(d.body.already).toBe(true);
    const acc = await act(testId, "application", dev.cookie, { applicationId: a.id, action: "accept", seenAt: seen() });
    expect(acc.status).toBe(409);
    expect(acc.body.error.message).toBe("Dee Moss withdrew her application.");
  });

  it("Cancel invite after No thanks → silent (J17); No thanks on a cancelled invite → silent (J08); joined keeps its lines", async () => {
    const { dev, testId } = await setup();
    const t = await makeUser({ tester: true, name: "Cara Diaz", pronoun: "she" });
    await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [t.user.id] });
    const inv = await db.invite.findFirstOrThrow({ where: { testId, testerId: t.user.id } });
    expect((await noThanks(t.cookie, inv.id)).status).toBe(200);
    const c = await act(testId, "cancel-invite", dev.cookie, { inviteId: inv.id, seenAt: seen(), confirmed: true });
    expect(c.status).toBe(200);
    expect(c.body.already).toBe(true);
    // No thanks again on the declined one: silent.
    const again = await noThanks(t.cookie, inv.id);
    expect(again.status).toBe(200);
    expect(again.body.already).toBe(true);
    // A cancelled one: silent too.
    const u = await makeUser({ tester: true, name: "Finn Ode", pronoun: "he" });
    await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [u.user.id] });
    const inv2 = await db.invite.findFirstOrThrow({ where: { testId, testerId: u.user.id } });
    expect((await act(testId, "cancel-invite", dev.cookie, { inviteId: inv2.id, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await noThanks(u.cookie, inv2.id)).body.already).toBe(true);
    // Joined: Cancel invite keeps "He already joined.", No thanks keeps "You already joined."
    const v = await makeUser({ tester: true, name: "Gus Hale", pronoun: "he" });
    await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [v.user.id] });
    const inv3 = await db.invite.findFirstOrThrow({ where: { testId, testerId: v.user.id } });
    const test = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect((await act(testId, "join", v.cookie, { inviteId: inv3.id, listingVersion: test.listingVersion, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await act(testId, "cancel-invite", dev.cookie, { inviteId: inv3.id, seenAt: seen(), confirmed: true })).body.error.message).toBe("He already joined.");
    expect((await noThanks(v.cookie, inv3.id)).body.error.message).toBe("You already joined.");
  });

  it("Leave after the part ended early, or twice → silent (W23); the developer's Stop twice → silent", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    expect((await act(testId, "end-early", dev.cookie, { contractIds: [sessionId], reason: WHY, seenAt: seen(), confirmed: true })).status).toBe(200);
    const l = await sact(sessionId, "leave", tester.cookie, { seenAt: seen() });
    expect(l.status).toBe(200);
    expect(l.body.already).toBe(true);
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("ended"); // nothing changed
    const b = await joined(testId, "Ben Okafor", "he");
    expect((await sact(b.sessionId, "leave", b.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await sact(b.sessionId, "leave", b.tester.cookie, { seenAt: seen() })).body.already).toBe(true);
    expect((await act(testId, "stop", dev.cookie, { reason: WHY, seenAt: seen(), confirmed: true })).status).toBe(200);
    const s2 = await act(testId, "stop", dev.cookie, { reason: WHY, seenAt: seen() });
    expect(s2.status).toBe(200);
    expect(s2.body.already).toBe(true);
  });

  it("Cancel call already cancelled (by the other side, or a stop) → silent on both sides (C11)", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 72);
    expect((await sact(sessionId, "cancel-call", tester.cookie, { callId: call.id, seenAt: seen(), confirmed: true })).status).toBe(200);
    const d = await act(testId, "cancel-call", dev.cookie, { callId: call.id, seenAt: seen() });
    expect(d.status).toBe(200);
    expect(d.body.already).toBe(true);
    // A stop cancelled the calls ahead: the tester's Cancel on an old page is silent too (no "stopped" refusal).
    const call2 = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 96);
    expect((await act(testId, "stop", dev.cookie, { reason: WHY, seenAt: seen(), confirmed: true })).status).toBe(200);
    const t = await sact(sessionId, "cancel-call", tester.cookie, { callId: call2.id, seenAt: seen() });
    expect(t.status).toBe(200);
    expect(t.body.already).toBe(true);
  });

  it("Withdraw a call request that was declined → silent (C04); booked keeps its refusal", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    expect((await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], startsAt: atHours(80) })).status).toBe(200);
    const q = await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId, fromSide: "developer", status: "pending" } });
    expect((await sact(sessionId, "answer-request", tester.cookie, { requestId: q.id, action: "decline", seenAt: seen(), confirmed: true })).status).toBe(200);
    const w = await act(testId, "answer-request", dev.cookie, { contractId: sessionId, requestId: q.id, action: "withdraw", seenAt: seen() });
    expect(w.status).toBe(200);
    expect(w.body.already).toBe(true);
    await bookCall(testId, dev.cookie, sessionId, tester.cookie, 100);
    const booked = await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId, status: "booked" } });
    const w2 = await act(testId, "answer-request", dev.cookie, { contractId: sessionId, requestId: booked.id, action: "withdraw", seenAt: seen() });
    expect(w2.status).toBe(409);
  });

  it("excerpts: Deny on a withdrawn or denied request → silent; Allow on an allowed one → silent; Allow on a withdrawn one keeps its line (W17, W18); Remove twice → silent", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["The harbour level felt great, but the boss was hard.", "Nowhere."], seenAt: seen(), confirmed: true });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const request = async (text: string, index = 0) => {
      expect((await ex(tester.cookie, { action: "request", submissionId: sub.id, index, text })).status).toBe(200);
      return db.excerpt.findFirstOrThrow({ where: { testerId: tester.user.id, text } });
    };
    const x = await request("the boss was hard");
    expect((await ex(tester.cookie, { action: "remove", excerptId: x.id })).status).toBe(200);
    // Remove again: silent.
    expect((await ex(tester.cookie, { action: "remove", excerptId: x.id })).body.already).toBe(true);
    // Deny on the withdrawn request: silent. Allow on it: the one line.
    const deny = await ex(dev.cookie, { action: "decide", excerptId: x.id, decision: "deny" });
    expect(deny.status).toBe(200);
    expect(deny.body.already).toBe(true);
    expect((await ex(dev.cookie, { action: "decide", excerptId: x.id, decision: "allow" })).body.error.message).toBe("Ana Silva withdrew this request.");
    const y = await request("felt great");
    expect((await ex(dev.cookie, { action: "decide", excerptId: y.id, decision: "allow" })).status).toBe(200);
    expect((await ex(dev.cookie, { action: "decide", excerptId: y.id, decision: "allow" })).body.already).toBe(true);
    expect((await ex(dev.cookie, { action: "decide", excerptId: y.id, decision: "deny" })).body.error.message).toBe("You already allowed this excerpt.");
  });
});

describe("§380 Block reaches every open page of both people", () => {
  it("Block twice → silent; the account check's blocks value changes for the blocker (reload) and for the blocked person (redraw)", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane" });
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    const devBefore = await status(dev.cookie), tBefore = await status(t.cookie);
    const r = await block(dev.cookie, t.user.id);
    expect(r.status).toBe(200);
    expect(typeof r.body.blocks).toBe("string");
    const again = await block(dev.cookie, t.user.id);
    expect(again.status).toBe(200);
    expect(again.body.already).toBe(true);
    const devAfter = await status(dev.cookie), tAfter = await status(t.cookie);
    expect(devAfter).toBe(r.body.blocks);
    // The blocker's other pages: reload (every button disabled first); the page that pressed Block: nothing (it redraws itself).
    expect(blocksChange(devBefore, devAfter)).toBe("reload");
    expect(blocksChange(devBefore, devAfter, r.body.blocks)).toBe("");
    // The blocked person's pages: the live feed carries the change, and they redraw.
    expect(tAfter).not.toBe(tBefore);
    expect(blocksChange(tBefore, tAfter)).toBe("redraw");
    // Unblock: the blocker's pages reload again; the other person's redraw.
    expect((await block(dev.cookie, t.user.id, "unblock")).status).toBe(200);
    expect(blocksChange(devAfter, await status(dev.cookie))).toBe("reload");
    expect(blocksChange(tAfter, await status(t.cookie))).toBe("redraw");
    // Nothing changed: nothing happens.
    expect(blocksChange(tAfter, tAfter)).toBe("");
  });
});
