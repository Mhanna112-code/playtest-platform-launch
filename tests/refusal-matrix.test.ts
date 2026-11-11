import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as excerptsPOST } from "@/app/api/excerpts/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { POST as subscriptionPOST } from "@/app/api/payments/subscription/route";
import { pauseTest, adminStopTest, deleteAccount } from "@/lib/server/restrictions";
import { startHold } from "@/lib/server/holds";
import { json, makeUser, req } from "./helpers";
import { act, atHours, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 9, §365, file 1 of 3) THE REFUSAL MATRIX: every cause family left after §364, put into that state ONCE (one shared setup per family), and every
// button that can reach it pressed, on both sides. Each press must be refused with exactly "{cause}, so your {button} didn't go through." (the button's own
// name) and must change nothing in the database (a fingerprint of the test's rows before and after). A button that gives another text, or goes through, fails
// its own row: nothing here is papered over.

type Press = { side: "tester" | "developer"; button: string; go: () => Promise<{ status: number; body: { error?: { message?: string } } }> };
const S = (cause: string, button: string) => `${cause}, so your ${button} didn't go through.`;

/** Everything a refused press could have written about this test. */
async function fingerprint(testId: string) {
  const cs = await db.contract.findMany({ where: { testId }, orderBy: { id: "asc" }, select: { id: true, status: true, endKind: true, dueAt: true } });
  const ids = cs.map((c) => c.id);
  const [subs, reqs, calls, pays, invites, apps, excerpts, ratings, msgs, t] = await Promise.all([
    db.submission.findMany({ where: { contractId: { in: ids } }, orderBy: { id: "asc" }, select: { id: true, updatedAt: true, choiceOfferedAt: true } }),
    db.callRequest.count({ where: { contractId: { in: ids } } }),
    db.call.findMany({ where: { contractId: { in: ids } }, orderBy: { id: "asc" }, select: { id: true, status: true } }),
    db.payment.count({ where: { contractId: { in: ids } } }),
    db.invite.count({ where: { testId } }),
    db.application.findMany({ where: { testId }, orderBy: { id: "asc" }, select: { id: true, status: true } }),
    db.excerpt.count({ where: { testId } }),
    db.rating.count({ where: { testId } }),
    db.message.count({ where: { contractId: { in: ids } } }).catch(() => -1),
    db.test.findUniqueOrThrow({ where: { id: testId }, select: { status: true, version: true, stoppedAt: true, workEndedAt: true } }),
  ]);
  return JSON.stringify({ cs, subs, reqs, calls, pays, invites, apps, excerpts, ratings, msgs, t });
}

/** Presses each button; returns the rows that didn't read exactly as expected (or changed something). */
async function matrix(testId: string, cause: (p: Press) => string, presses: Press[]) {
  const wrong: string[] = [];
  for (const p of presses) {
    const before = await fingerprint(testId);
    const r = await p.go();
    const want = S(cause(p), p.button);
    if (r.status < 400) wrong.push(`${p.side} ${p.button}: went through (${r.status})`);
    else if (r.body.error?.message !== want) wrong.push(`${p.side} ${p.button}: "${r.body.error?.message}" (want "${want}")`);
    if ((await fingerprint(testId)) !== before) wrong.push(`${p.side} ${p.button}: changed the database`);
  }
  return wrong;
}

/** A test with Ana working (written answers sent, unpaid), a call booked with her and a request from the developer waiting. */
async function world() {
  const s = await setup({ recordingCents: "10.00" });
  const ana = await joined(s.testId, "Ana Silva");
  expect((await sact(ana.sessionId, "written", ana.tester.cookie, { answers: ["The harbour level was clear and the boats handled well.", "Fine."], seenAt: seen(), confirmed: true })).status).toBe(200);
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId } });
  expect((await act(s.testId, "request-time", s.dev.cookie, { seenAt: seen(), confirmed: true, minutes: "30", contractIds: [ana.sessionId], rows: [{ startsAt: atHours(60), repeat: "once", count: 1 }] })).status).toBe(200);
  const reqRow = await db.callRequest.findFirstOrThrow({ where: { contractId: ana.sessionId, status: "pending" } });
  return { ...s, ana, sub, reqRow };
}
type W = Awaited<ReturnType<typeof world>>;

/** The tester's presses on her own session. */
const testerPresses = (w: W): Press[] => {
  const t = (action: string, body: Record<string, unknown>, button: string): Press => ({ side: "tester", button, go: () => sact(w.ana.sessionId, action, w.ana.tester.cookie, { seenAt: seen(), ...body }) });
  return [
    t("written", { answers: ["The harbour level was clear and the boats handled well.", "Fine."] }, "Send Answers"), // (Nov 9 small fixes) the button's real label
    t("written-add", { text: "One more thing.", question: "x" }, "Add"),
    t("recording-send", {}, "Send"),
    t("recording-start", { filename: "a.webm", size: 10, contentType: "video/webm" }, "upload"),
    t("request-time", { minutes: "30", rows: [{ startsAt: atHours(70), repeat: "once", count: 1 }] }, "Request a time"),
    t("answer-request", { requestId: w.reqRow.id, action: "accept" }, "Accept"),
    t("answer-request", { requestId: w.reqRow.id, action: "decline" }, "Decline"),
  ];
};

describe("§365 refusal matrix: every cause × every button that reaches it", () => {
  it("stopped (the developer's Stop): tester and developer presses", async () => {
    const w = await world();
    expect((await act(w.testId, "stop", w.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    const dev = (action: string, body: Record<string, unknown>, button: string): Press => ({ side: "developer", button, go: () => act(w.testId, action, w.dev.cookie, { seenAt: seen(), confirmed: true, ...body }) });
    const wrong = await matrix(w.testId, () => "This test was stopped", [
      ...testerPresses(w),
      // (Owner, Nov 11, §380) Leave and Stop the test on a stopped test are already what they wanted: silent (silent-380.test.ts), never refused.
      dev("end-early", { contractIds: [w.ana.sessionId], reason: "We have enough feedback." }, "End early"),
      dev("request-time", { minutes: "30", contractIds: [w.ana.sessionId], rows: [{ startsAt: atHours(80), repeat: "once", count: 1 }] }, "Request a time"),
      dev("invite", { testerIds: [(await makeUser({ tester: true })).user.id] }, "Invite"),
    ]);
    expect(wrong).toEqual([]);
  });

  it("stopped (the team's Stop): the developer's presses", async () => {
    const w = await world();
    await adminStopTest(w.testId, "Closing this one.");
    const dev = (action: string, body: Record<string, unknown>, button: string): Press => ({ side: "developer", button, go: () => act(w.testId, action, w.dev.cookie, { seenAt: seen(), confirmed: true, ...body }) });
    expect(await matrix(w.testId, () => "This test was stopped", [
      dev("invite", { testerIds: [] }, "Invite"),
      dev("next-round", {}, "Next round"),
      dev("request-time", { minutes: "30", contractIds: [w.ana.sessionId], rows: [{ startsAt: atHours(80), repeat: "once", count: 1 }] }, "Request a time"),
    ])).toEqual([]);
  });

  it("stopped (the developer deleted their account): the tester's presses, Rate and an excerpt request included", async () => {
    const w = await world();
    await db.review.create({ data: { contractId: w.ana.sessionId, submissionId: w.sub.id, amountCents: 1000, agreedCents: 1000, reason: "", payKey: randomUUID() } });
    await deleteAccount(w.dev.user.id, "self");
    expect(await matrix(w.testId, () => "This test was stopped", [
      ...testerPresses(w).slice(0, 1),
      { side: "tester", button: "Rate", go: () => sact(w.ana.sessionId, "rate", w.ana.tester.cookie, { stars: 5, seenAt: seen(), confirmed: true }) },
      { side: "tester", button: "Ask the developer", go: () => excerptsPOST(req("/api/excerpts", { cookie: w.ana.tester.cookie, body: { action: "request", submissionId: w.sub.id, index: 0, text: "The harbour level was clear" } })).then(json) },
    ])).toEqual([]);
  });

  it("ended (the work window): the tester's presses", async () => {
    const w = await world();
    const at = new Date(Date.now() - 60_000);
    await db.contract.updateMany({ where: { testId: w.testId, status: "working" }, data: { status: "ended", endKind: "closed", endedAt: at, dueAt: at } });
    await db.test.update({ where: { id: w.testId }, data: { status: "closed", workEndedAt: at, openUntil: at } });
    expect(await matrix(w.testId, () => "This test ended", testerPresses(w))).toEqual([]);
  });

  it("part ended (she left): the tester's presses; session ended: the developer's presses about her", async () => {
    const w = await world();
    expect((await sact(w.ana.sessionId, "leave", w.ana.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    const dev = (action: string, body: Record<string, unknown>, button: string): Press => ({ side: "developer", button, go: () => act(w.testId, action, w.dev.cookie, { seenAt: seen(), confirmed: true, ...body }) });
    expect(await matrix(w.testId, (p) => (p.side === "tester" ? "Your part in this test has ended" : "Ana Silva's session has ended"), [
      ...testerPresses(w).filter((p) => !["Accept", "Decline"].includes(p.button)),
      // (Owner, Nov 11, §380) Leave when her part already ended: silent, never refused.
      dev("end-early", { contractIds: [w.ana.sessionId], reason: "We have enough feedback." }, "End early"),
      dev("request-time", { minutes: "30", contractIds: [w.ana.sessionId], rows: [{ startsAt: atHours(80), repeat: "once", count: 1 }] }, "Request a time"),
    ])).toEqual([]);
  });

  it("paused (the developer's hold): the tester's presses; own hold: the developer's presses", async () => {
    const w = await world();
    await startHold(w.dev.user.id, "unpaid");
    const dev = (action: string, body: Record<string, unknown>, button: string): Press => ({ side: "developer", button, go: () => act(w.testId, action, w.dev.cookie, { seenAt: seen(), confirmed: true, ...body }) });
    expect(await matrix(w.testId, (p) => (p.side === "tester" ? "This test is paused right now" : "Your tests are paused"), [
      ...testerPresses(w).filter((p) => ["Send", "Request a time", "Accept"].includes(p.button)),
      dev("next-round", {}, "Next round"),
      dev("invite", { testerIds: [] }, "Invite"),
      { side: "developer", button: "Pay", go: () => reviewPOST(req("/api/review", { cookie: w.dev.cookie, body: { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000, payKey: randomUUID(), seenAt: seen(), confirmed: true } })).then(json) },
      { side: "developer", button: "Subscribe for $7/month", go: () => subscriptionPOST(req("/api/payments/subscription", { cookie: w.dev.cookie, body: { action: "subscribe" } })).then(json) },
    ])).toEqual([]);
  });

  it("team paused: the developer's presses", async () => {
    const w = await world();
    const a = await makeUser();
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    await pauseTest(a.user.id, w.testId, "Checking it");
    const dev = (action: string, body: Record<string, unknown>, button: string): Press => ({ side: "developer", button, go: () => act(w.testId, action, w.dev.cookie, { seenAt: seen(), confirmed: true, ...body }) });
    expect(await matrix(w.testId, () => "The team paused this test", [
      dev("invite", { testerIds: [] }, "Invite"),
      dev("next-round", {}, "Next round"),
      dev("message", { contractId: w.ana.sessionId, body: "Hi" }, "Send"),
      // (Owner, Nov 9, §368) Pay and Pay more go through during a team pause: tests/pay-during-pauses-368.test.ts.
    ])).toEqual([]);
  });

  it("account paused (a suspended tester) and account suspended (a suspended developer)", async () => {
    const w = await world();
    await db.user.update({ where: { id: w.ana.tester.user.id }, data: { testerSuspendedAt: new Date() } });
    await db.user.update({ where: { id: w.dev.user.id }, data: { devSuspendedAt: new Date() } });
    const dev = (action: string, body: Record<string, unknown>, button: string): Press => ({ side: "developer", button, go: () => act(w.testId, action, w.dev.cookie, { seenAt: seen(), confirmed: true, ...body }) });
    expect(await matrix(w.testId, (p) => (p.side === "tester" ? "Your account is paused" : "Your account is suspended"), [
      { side: "tester", button: "Send Answers", go: () => sact(w.ana.sessionId, "written", w.ana.tester.cookie, { answers: ["a", "b"], seenAt: seen() }) },
      { side: "tester", button: "Rate", go: () => sact(w.ana.sessionId, "rate", w.ana.tester.cookie, { stars: 5, seenAt: seen() }) },
      dev("next-round", {}, "Next round"),
      dev("invite", { testerIds: [] }, "Invite"),
      // (Owner, Nov 9, §368) A suspended developer's Pay goes through: tests/pay-during-pauses-368.test.ts.
    ])).toEqual([]);
  });

  it("join and invites closed: Open until passed, and a paused test", async () => {
    const w = await world();
    const ben = await makeUser({ tester: true, name: "Ben Ward" });
    const t = await db.test.findUniqueOrThrow({ where: { id: w.testId } });
    await db.test.update({ where: { id: w.testId }, data: { openUntil: new Date(Date.now() - 60_000) } });
    const joinBen = (button: string, action: string): Press => ({ side: "tester", button, go: () => act(w.testId, action, ben.cookie, { listingVersion: t.listingVersion, note: "Hi", confirmed: true }) });
    const r = await joinBen("Join", "join").go();
    expect(r.body.error?.message).toMatch(/^This test closed to new testers on .+, so your Join didn't go through\.$/);
    await db.test.update({ where: { id: w.testId }, data: { openUntil: new Date(Date.now() + 5 * 86_400_000) } });
    await startHold(w.dev.user.id, "unpaid");
    expect(await matrix(w.testId, () => "This test isn't taking new testers right now", [joinBen("Join", "join")])).toEqual([]);
  });

  it("call already cancelled: both sides' Cancel call go through silently (§380)", async () => {
    const w = await world();
    expect((await sact(w.ana.sessionId, "answer-request", w.ana.tester.cookie, { requestId: w.reqRow.id, action: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
    const call = await db.call.findFirstOrThrow({ where: { contractId: w.ana.sessionId, status: "booked" } });
    await db.call.update({ where: { id: call.id }, data: { status: "cancelled", cancelledBy: "developer", cancelledAt: new Date() } });
    for (const r of [
      await sact(w.ana.sessionId, "cancel-call", w.ana.tester.cookie, { callId: call.id, reason: "Something came up at work today.", seenAt: seen(), confirmed: true }),
      await act(w.testId, "cancel-call", w.dev.cookie, { callId: call.id, reason: "Something came up at work today.", seenAt: seen(), confirmed: true }),
    ]) expect([r.status, r.body.already]).toEqual([200, true]); // (Owner, Nov 11, §380) already what Cancel call wanted
  });

  it("own deleted account: Confirm with your bank from an old tab", async () => {
    const w = await world();
    await db.user.update({ where: { id: w.dev.user.id }, data: { deletedAt: new Date() } });
    const r = await confirmPOST(req("/api/payments/confirm", { cookie: w.dev.cookie, body: { paymentId: "x", start: true } })).then(json);
    expect(r.body.error?.message).toBe("This account no longer exists.");
  });
});

