import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { RATE_TEAM_PAUSED, RESTRICTED_OK_ACTIONS, TEAM_PAUSED_OK_ACTIONS } from "@/lib/restricted";
import { cancelLatePauseCalls, pauseTest, TEAM_PAUSED_EMAIL_LINE, unpauseTest } from "@/lib/server/restrictions";
import { chatRestriction, openTesterChat, CHAT_UNABLE } from "@/lib/server/messages";
import { devRateStates } from "@/lib/server/ratings";
import { autoChargeCalls } from "@/lib/server/holds";
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
  it("the same presses still work (Stop, End early, Cancel call, the side of a dispute; §368: Pay more); every other one, chat included, goes to the banner", async () => {
    expect([...TEAM_PAUSED_OK_ACTIONS].sort()).toEqual([...RESTRICTED_OK_ACTIONS, "pay-extra", "message"].sort()); // (Owner, Nov 9, §368) paying goes on; (Nov 11, §379 item 1) chat too
    const s = await setup();
    const a = await joined(s.testId);
    await pauseTest(await admin(), s.testId, "Checking");
    expect((await act(s.testId, "message", s.dev.cookie, { contractId: a.sessionId, body: "Hi", seenAt: seen() })).status).toBe(200); // (§379 item 1)
    for (const [action, body] of [["edit", { version: 1, fields: { title: "x" } }], ["invite", { testerIds: [] }], ["next-round", {}]] as const) {
      const r = await act(s.testId, action, s.dev.cookie, { ...body, seenAt: seen() });
      if (action === "edit") { expect(r.body.error?.code).toBe("nda_only"); continue; }
      expect(r.body.error?.code, action).toBe("admin_paused");
      expect(r.body.error.message).toBe(`The team paused this test, so your ${({ message: "Send", invite: "Invite", "next-round": "Next round" } as Record<string, string>)[action]} didn't go through.`); // (§364 item 6)
      expect(r.body.error.testId).toBe(s.testId);
      expect(r.body.error.failed).toMatch(/didn't go through$/);
    }
    expect((await act(s.testId, "end-early", s.dev.cookie, { contractIds: [a.sessionId], reason: "Enough for now.", seenAt: seen() })).status).toBe(200);
    expect((await act(s.testId, "stop", s.dev.cookie, { reason: "This trial is finished.", seenAt: seen() })).status).toBe(200);
  });

  // (Owner, Nov 9, §368; replaces §172's wait for the lift) Pay and Pay more go through on a test the team paused, as the tester's Charge does.
  it("Pay goes through on that test during the pause (§368), as on the developer's other test", async () => {
    const x = await sentWork();
    await pauseTest(await admin(), x.testId, "Checking");
    expect((await pay(x.dev.cookie, { kind: "submission", id: x.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    expect(await db.review.count({ where: { submissionId: x.sub.id } })).toBe(1);
    const other = await secondTest(x.dev.cookie);
    const b = await joined(other, "Ben Okafor");
    await sact(b.sessionId, "written", b.tester.cookie, { answers: ["a", "b"] });
    await settle();
    const sub2 = await db.submission.findFirstOrThrow({ where: { contractId: b.sessionId } });
    expect((await pay(x.dev.cookie, { kind: "submission", id: sub2.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  });

  it("Pay more goes through too (§368)", async () => {
    const x = await sentWork();
    expect((await pay(x.dev.cookie, { kind: "submission", id: x.sub.id, amount: "5.00", tickedCents: 500, reason: "Half of it" })).status).toBe(200);
    await pauseTest(await admin(), x.testId, "Checking");
    const r = await payMore(x.testId, x.dev.cookie, { contractId: x.sessionId, submissionId: x.sub.id, amount: "2.00", tickedCents: 200 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await db.payment.count({ where: { submissionId: x.sub.id, kind: "extra" } })).toBe(1);
  });

  it("Rate: hidden and refused with the team's wording (never 'suspended'); the tester's Rate is unaffected", async () => {
    const x = await rateOpen();
    await pauseTest(await admin(), x.testId, "Checking");
    const st = (await devRateStates([x.sessionId])).get(x.sessionId)!;
    expect(st).toMatchObject({ kind: "hidden", line: RATE_TEAM_PAUSED, paused: true });
    const r = await act(x.testId, "rate", x.dev.cookie, { contractId: x.sessionId, stars: 5, seenAt: seen() });
    expect(r.body.error).toMatchObject({ code: "inactive", message: "The team paused this test, so your Rate didn't go through." }); // (§364 item 6; the Rate box keeps RATE_TEAM_PAUSED)
    await unpauseTest(x.testId);
    expect((await devRateStates([x.sessionId])).get(x.sessionId)!.kind).toBe("open");
    expect((await act(x.testId, "rate", x.dev.cookie, { contractId: x.sessionId, stars: 5, seenAt: seen() })).status).toBe(200);
  });

  it("Confirm with your bank and Confirm all remain available during the pause", async () => {
    const x = await sentWork();
    const row = await db.payment.create({ data: { kind: "review", submissionId: x.sub.id, contractId: x.sessionId, developerId: x.dev.user.id, testerId: x.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_confirmation", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + 2 * DAY) } });
    expect((await confirmAllState(x.dev.user.id)).ids).toEqual([row.id]);
    await pauseTest(await admin(), x.testId, "Checking");
    await expect(confirmStart({ id: x.dev.user.id }, row.id, {})).resolves.toMatchObject({ paymentId: row.id });
    expect((await confirmAllState(x.dev.user.id)).ids).toEqual([row.id]);
    // §159 rule 4b: the tester's waiting charge itself is not cancelled by the pause.
    expect((await db.payment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("needs_confirmation");
    await unpauseTest(x.testId);
    expect((await confirmAllState(x.dev.user.id)).ids).toEqual([row.id]);
  });

  it("the pause no longer cancels the developer's own Pay whose bank page is open on that test (§368; was §159 rule 9), and says what still works", async () => {
    const x = await sentWork();
    const open = await db.payment.create({ data: { kind: "review", submissionId: x.sub.id, contractId: x.sessionId, developerId: x.dev.user.id, testerId: x.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_action", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + 15 * 60_000) } });
    await pauseTest(await admin(), x.testId, "Checking");
    expect((await db.payment.findUniqueOrThrow({ where: { id: open.id } })).status).toBe("needs_action");
    const mail = await db.notification.findFirstOrThrow({ where: { userId: x.dev.user.id, text: { startsWith: "The team paused “Harbor Run”: it closes on " } } }); // (§310b)
    void mail;
    expect(TEAM_PAUSED_EMAIL_LINE).toContain("add your side of a dispute");
    expect(TEAM_PAUSED_EMAIL_LINE).toContain("pay for work (Pay, Pay more, Confirm with your bank)");
    expect(TEAM_PAUSED_EMAIL_LINE).not.toMatch(/Pay[^.]*wait until/);
  });
});

describe("§172: chat on a test the team paused pauses as under a developer suspension", () => {
  it("(Owner, Nov 11, §376 and §379 item 1; reverse §172) both sides' Send go through during the team's pause; the developer's own suspension still closes theirs", async () => {
    const s = await setup();
    const a = await joined(s.testId);
    await pauseTest(await admin(), s.testId, "Checking");
    expect(await chatRestriction(s.testId, a.tester.user.id)).toMatchObject({ developer: false, teamPaused: true, tester: false });
    const t = await sact(a.sessionId, "message", a.tester.cookie, { body: "Hello?" });
    expect(t.status).toBe(200);
    const dev = await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } });
    expect(await openTesterChat(dev, { contractId: a.sessionId })).toEqual({ href: expect.stringContaining("/app/chat/") });
    expect((await act(s.testId, "message", s.dev.cookie, { contractId: a.sessionId, body: "Hi Ana", seenAt: seen() })).status).toBe(200);
    await db.user.update({ where: { id: s.dev.user.id }, data: { devSuspendedAt: new Date() } });
    expect((await act(s.testId, "message", s.dev.cookie, { contractId: a.sessionId, body: "Still there?", seenAt: seen() })).status).toBeGreaterThanOrEqual(400);
    await expect(openTesterChat(await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } }), { contractId: a.sessionId })).rejects.toMatchObject({ message: CHAT_UNABLE });
    await db.user.update({ where: { id: s.dev.user.id }, data: { devSuspendedAt: null } });
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

  it("a listed call's automatic charge is made at once during the team's pause (§368; was: waited for the lift)", async () => {
    const x = await heldCall();
    await pauseTest(await admin(), x.testId, "Checking");
    expect(await autoChargeCalls(new Date())).toBeGreaterThanOrEqual(1);
    const p = await db.payment.findFirstOrThrow({ where: { callId: x.call.id } });
    expect(p.amountCents).toBe(1500);
    expect(["charged", "not_set_up"]).toContain(p.status);
    expect(await db.payment.count({ where: { callId: x.call.id } })).toBe(1);
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
