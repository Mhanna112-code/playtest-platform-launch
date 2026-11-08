import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { RATE_TEAM_PAUSED, RESTRICTED_OK_ACTIONS, TEAM_PAUSED_LINE, TEAM_PAUSED_OK_ACTIONS, teamPausedWaits } from "@/lib/restricted";
import { CHAT_NOT_SENT } from "@/lib/rules";
import { cancelLatePauseCalls, pauseTest, TEAM_PAUSED_EMAIL_LINE, unpauseTest } from "@/lib/server/restrictions";
import { chatRestriction, openTesterChat, CHAT_UNABLE } from "@/lib/server/messages";
import { devRateStates } from "@/lib/server/ratings";
import { autoChargeCalls, chargeDeferred } from "@/lib/server/holds";
import { confirmStart } from "@/lib/server/confirm";
import { confirmAllState } from "@/lib/server/confirmAll";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, listingBody, sact, seen, settle, setup } from "./fixtures";
import { DAY, pay, payMore, sentWork } from "./b15";

// (Owner, Nov 4, §172) "Make the team's pause of a test the same exact rules as a developer suspension": for the ONE test the team paused, for both sides.

async function admin() {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a.user.id;
}
/** A second test of the same developer (the team's pause must leave it alone). */
async function secondTest(devCookie: string) {
  const r = await json(await testsPOST(req("/api/tests", { cookie: devCookie, body: listingBody({ title: "Second Run", productName: "Second Run" }) })));
  expect(r.status).toBe(200);
  await settle();
  return r.body.id as string;
}
/** Sent work the developer paid, and the tester rated: the developer's Rate is open. */
async function rateOpen() {
  const x = await sentWork();
  expect((await pay(x.dev.cookie, { kind: "submission", id: x.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  expect((await sact(x.sessionId, "rate", x.tester.cookie, { stars: 4 })).status).toBe(200);
  expect((await devRateStates([x.sessionId])).get(x.sessionId)!.kind).toBe("open");
  return x;
}

describe("§172: the developer's presses on a test the team paused are a suspended developer's", () => {
  it("the same presses still work (Stop, End early, Cancel call, the side of a dispute); every other one, chat included, goes to the banner", async () => {
    expect(TEAM_PAUSED_OK_ACTIONS).toBe(RESTRICTED_OK_ACTIONS);
    const s = await setup();
    const a = await joined(s.testId);
    await pauseTest(await admin(), s.testId, "Checking");
    for (const [action, body] of [["message", { contractId: a.sessionId, body: "Hi" }], ["edit", { version: 1, fields: { title: "x" } }], ["invite", { testerIds: [] }], ["next-round", {}], ["pay-extra", { contractId: a.sessionId }]] as const) {
      const r = await act(s.testId, action, s.dev.cookie, { ...body, seenAt: seen() });
      if (action === "edit") { expect(r.body.error?.code).toBe("nda_only"); continue; }
      expect(r.body.error?.code, action).toBe("admin_paused");
      expect(r.body.error.message).toBe(TEAM_PAUSED_LINE);
      expect(r.body.error.testId).toBe(s.testId);
      expect(r.body.error.failed).toMatch(/didn't go through$/);
    }
    expect((await act(s.testId, "end-early", s.dev.cookie, { contractIds: [a.sessionId], reason: "Enough for now.", seenAt: seen() })).status).toBe(200);
    expect((await act(s.testId, "stop", s.dev.cookie, { reason: "This trial is finished.", seenAt: seen() })).status).toBe(200);
  });

  it("Pay waits for the lift on that test (refused back to its banner); Pay on the developer's other test goes through", async () => {
    const x = await sentWork();
    await pauseTest(await admin(), x.testId, "Checking");
    const r = await pay(x.dev.cookie, { kind: "submission", id: x.sub.id, amount: "10.00", tickedCents: 1000 });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "admin_paused", message: teamPausedWaits("Pay"), testId: x.testId, failed: "Your Pay on Harbor Run didn't go through" });
    expect(await db.review.count({ where: { submissionId: x.sub.id } })).toBe(0);
    // The developer's other test is unaffected.
    const other = await secondTest(x.dev.cookie);
    const b = await joined(other, "Ben Okafor");
    await sact(b.sessionId, "written", b.tester.cookie, { answers: ["a", "b"] });
    await settle();
    const sub2 = await db.submission.findFirstOrThrow({ where: { contractId: b.sessionId } });
    expect((await pay(x.dev.cookie, { kind: "submission", id: sub2.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    // Lifted: Pay goes through.
    await unpauseTest(x.testId);
    expect((await pay(x.dev.cookie, { kind: "submission", id: x.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  });

  it("Pay more waits too (the route and the backstop)", async () => {
    const x = await sentWork();
    expect((await pay(x.dev.cookie, { kind: "submission", id: x.sub.id, amount: "5.00", tickedCents: 500, reason: "Half of it" })).status).toBe(200);
    await pauseTest(await admin(), x.testId, "Checking");
    const r = await payMore(x.testId, x.dev.cookie, { contractId: x.sessionId, submissionId: x.sub.id, amount: "2.00" });
    expect(r.body.error.code).toBe("admin_paused");
    expect(await db.payment.count({ where: { submissionId: x.sub.id, kind: "extra" } })).toBe(0);
  });

  it("Rate: hidden and refused with the team's wording (never 'suspended'); the tester's Rate is unaffected", async () => {
    const x = await rateOpen();
    await pauseTest(await admin(), x.testId, "Checking");
    const st = (await devRateStates([x.sessionId])).get(x.sessionId)!;
    expect(st).toMatchObject({ kind: "hidden", line: RATE_TEAM_PAUSED, paused: true });
    const r = await act(x.testId, "rate", x.dev.cookie, { contractId: x.sessionId, stars: 5, seenAt: seen() });
    expect(r.body.error).toMatchObject({ code: "inactive", message: RATE_TEAM_PAUSED });
    await unpauseTest(x.testId);
    expect((await devRateStates([x.sessionId])).get(x.sessionId)!.kind).toBe("open");
    expect((await act(x.testId, "rate", x.dev.cookie, { contractId: x.sessionId, stars: 5, seenAt: seen() })).status).toBe(200);
  });

  it("Confirm with your bank and Confirm all leave that test's waiting charges for the lift", async () => {
    const x = await sentWork();
    const row = await db.payment.create({ data: { kind: "review", submissionId: x.sub.id, contractId: x.sessionId, developerId: x.dev.user.id, testerId: x.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_confirmation", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + 2 * DAY) } });
    expect((await confirmAllState(x.dev.user.id)).ids).toEqual([row.id]);
    await pauseTest(await admin(), x.testId, "Checking");
    await expect(confirmStart({ id: x.dev.user.id }, row.id, {})).rejects.toMatchObject({ code: "admin_paused", message: teamPausedWaits("Confirm with your bank") });
    expect((await confirmAllState(x.dev.user.id)).ids).toEqual([]);
    // §159 rule 4b: the tester's waiting charge itself is not cancelled by the pause.
    expect((await db.payment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("needs_confirmation");
    await unpauseTest(x.testId);
    expect((await confirmAllState(x.dev.user.id)).ids).toEqual([row.id]);
  });

  it("the pause cancels the developer's own Pay whose bank page is open on that test (§159 rule 9), and says what still works", async () => {
    const x = await sentWork();
    const open = await db.payment.create({ data: { kind: "review", submissionId: x.sub.id, contractId: x.sessionId, developerId: x.dev.user.id, testerId: x.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_action", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + 15 * 60_000) } });
    await pauseTest(await admin(), x.testId, "Checking");
    expect((await db.payment.findUniqueOrThrow({ where: { id: open.id } })).status).toBe("cancelled");
    const mail = await db.notification.findFirstOrThrow({ where: { userId: x.dev.user.id, text: { startsWith: "The team paused “Harbor Run”: it closes on " } } }); // (§310b)
    void mail;
    expect(TEAM_PAUSED_EMAIL_LINE).toContain("add your side of a dispute");
  });
});

describe("§172: chat on a test the team paused pauses as under a developer suspension", () => {
  it("the tester's Send is turned back with the neutral line; the developer's chat is closed; the developer's other test's chat is open", async () => {
    const s = await setup();
    const a = await joined(s.testId);
    await pauseTest(await admin(), s.testId, "Checking");
    expect(await chatRestriction(s.testId, a.tester.user.id)).toMatchObject({ developer: true, teamPaused: true, tester: false });
    const t = await sact(a.sessionId, "message", a.tester.cookie, { body: "Hello?" });
    expect(t.body.error).toMatchObject({ code: "chat_paused", message: CHAT_NOT_SENT });
    const dev = await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } });
    await expect(openTesterChat(dev, { contractId: a.sessionId })).rejects.toMatchObject({ message: CHAT_UNABLE });
    const other = await secondTest(s.dev.cookie);
    const b = await joined(other, "Ben Okafor");
    expect((await chatRestriction(other, b.tester.user.id)).developer).toBe(false);
    expect((await act(other, "message", s.dev.cookie, { contractId: b.sessionId, body: "Hi Ben", seenAt: seen() })).status).toBe(200);
    await unpauseTest(s.testId);
    expect((await sact(a.sessionId, "message", a.tester.cookie, { body: "Hello?" })).status).toBe(200);
  });
});

describe("§172: what a suspension runs or cancels, done for the one test", () => {
  async function heldCall(devCookie?: string, testId?: string) {
    const s = testId && devCookie ? { testId, dev: { cookie: devCookie } } : await setup();
    const j = await joined(s.testId, `Tester ${randomUUID().slice(0, 4)}`);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 48);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 8 * DAY), actualMinutes: 30, payBy: new Date(Date.now() - 60_000) } });
    await db.user.update({ where: { id: j.tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 10), payoutsReady: true } });
    return { ...s, ...j, call };
  }

  it("a listed call's automatic charge runs, then waits for the team's lift (charged then); the developer's other test's waiting charges don't wait", async () => {
    const x = await heldCall();
    const devId = (await db.test.findUniqueOrThrow({ where: { id: x.testId } })).developerId;
    await pauseTest(await admin(), x.testId, "Checking");
    expect(await autoChargeCalls(new Date())).toBeGreaterThanOrEqual(1);
    expect(await db.payment.findFirstOrThrow({ where: { callId: x.call.id } })).toMatchObject({ status: "deferred", amountCents: 1500 });
    expect((await db.testEvent.findFirstOrThrow({ where: { testId: x.testId, text: { contains: "charged when the team lifts the pause on this test" } } })).kind).toBe("paid");
    await chargeDeferred(devId);
    expect((await db.payment.findFirstOrThrow({ where: { callId: x.call.id } })).status).toBe("deferred");
    await unpauseTest(x.testId);
    expect(["charged", "not_set_up"]).toContain((await db.payment.findFirstOrThrow({ where: { callId: x.call.id } })).status);
  });

  it("calls within 3 days on that test are cancelled at the pause, later ones 3 days before (daily job); the other test's calls stay", async () => {
    const s = await setup();
    const a = await joined(s.testId);
    const soon = await bookCall(s.testId, s.dev.cookie, a.sessionId, a.tester.cookie, 24);
    const c = await joined(s.testId, "Cleo Park");
    const later = await bookCall(s.testId, s.dev.cookie, c.sessionId, c.tester.cookie, 24 * 5);
    const other = await secondTest(s.dev.cookie);
    const b = await joined(other, "Ben Okafor");
    const otherSoon = await bookCall(other, s.dev.cookie, b.sessionId, b.tester.cookie, 30);
    await pauseTest(await admin(), s.testId, "Checking");
    expect((await db.call.findUniqueOrThrow({ where: { id: soon.id } })).status).toBe("cancelled");
    expect((await db.call.findUniqueOrThrow({ where: { id: later.id } })).status).toBe("booked");
    expect((await db.call.findUniqueOrThrow({ where: { id: otherSoon.id } })).status).toBe("booked");
    await cancelLatePauseCalls(new Date(Date.now() + 3 * DAY));
    expect((await db.call.findUniqueOrThrow({ where: { id: later.id } })).status).toBe("cancelled");
    expect((await db.call.findUniqueOrThrow({ where: { id: otherSoon.id } })).status).toBe("booked");
  });

  it("the lift tells working testers it runs again, as a reinstatement does", async () => {
    const s = await setup();
    const a = await joined(s.testId);
    await pauseTest(await admin(), s.testId, "Checking");
    await unpauseTest(s.testId);
    expect(await db.notification.count({ where: { userId: a.tester.user.id, text: "“Harbor Run” is running again" } })).toBe(1);
  });

  it("a stopped test isn't team-paused any more: its presses follow a stopped test's rules", async () => {
    const x = await sentWork();
    await pauseTest(await admin(), x.testId, "Checking");
    expect((await act(x.testId, "stop", x.dev.cookie, { reason: "This trial is finished.", seenAt: seen() })).status).toBe(200);
    expect((await pay(x.dev.cookie, { kind: "submission", id: x.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  });
});
