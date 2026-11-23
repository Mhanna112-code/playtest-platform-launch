import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { adminStopTest, deleteAccount, pauseTest } from "@/lib/server/restrictions";
import { closePausedTest } from "@/lib/server/pauseClosure";
import { finishWorkIfDue } from "@/lib/server/workWindow";
import { matchInviteAndAsk, onSwitchToAnyone } from "@/lib/server/joining";
import { sendSummaries } from "@/lib/server/notify";
import { makeUser } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 2026) The tester's "test stopped / ended / your work was ended early" lines (`tstopped`) and her "You're in" / "You're back in" lines
// (accepted or joined) reach her morning email whatever her email setting, Off included (`always` → mustEmail), like her deadline reminders. Not sent at
// once; wording, group and stacking unchanged. "Your application / ask to rejoin wasn't accepted" and "A spot opened on …" still follow the setting.

const DAY = 86_400_000;
const lv = async (testId: string) => (await db.test.findUniqueOrThrow({ where: { id: testId } })).listingVersion;
const apply = async (testId: string, cookie: string, extra: Record<string, unknown> = {}) =>
  act(testId, "apply", cookie, { listingVersion: await lv(testId), seenAt: seen(), confirmed: true, note: "I sail a lot", ...extra });
const ask = async (testId: string, cookie: string, extra: Record<string, unknown> = {}) =>
  act(testId, "rejoin-ask", cookie, { listingVersion: await lv(testId), seenAt: seen(), confirmed: true, anyway: true, ...extra });
const leave = (sessionId: string, cookie: string) => sact(sessionId, "leave", cookie, { seenAt: seen(), confirmed: true });
const decide = (testId: string, cookie: string, applicationId: string, action: "accept" | "decline") =>
  act(testId, "application", cookie, { applicationId, action, seenAt: seen(), confirmed: true });
const appOf = (testId: string, testerId: string) => db.application.findFirstOrThrow({ where: { testId, testerId } });
async function admin() {
  const a = await makeUser({ email: `admin-must-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}

/** The line is written once, must-send (the morning email whatever the setting; `must` false: follows the setting), not emailed at once, in its usual group. */
async function expectMust(userId: string, text: string | { startsWith: string }, groupKey: string, must = true) {
  const ns = await db.notification.findMany({ where: { userId, text } });
  expect(ns, JSON.stringify(text)).toHaveLength(1);
  expect(ns[0]).toMatchObject({ mustEmail: must, summarizedAt: null, groupKey });
}

describe("(Owner, Nov 2026) the tester's stopped / ended lines are must-send", () => {
  it("the developer's Stop: “Harbor Run” was stopped", async () => {
    const { dev, testId } = await setup();
    const { tester } = await joined(testId);
    expect((await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    await expectMust(tester.user.id, "“Harbor Run” was stopped", "tstopped");
  });

  it("End early: Your work on “Harbor Run” was ended early (must-send); the invited tester's A spot opened on Harbor Run still follows the setting", async () => {
    const { dev, testId } = await setup({ spots: 1 });
    const dee = await makeUser({ tester: true, name: "Dee Moss", pronoun: "she" });
    expect((await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [dee.user.id], confirmed: true })).status).toBe(200);
    const { tester, sessionId } = await joined(testId); // fills the test: Dee's invite stays open, she's told it's full
    expect((await act(testId, "end-early", dev.cookie, { contractIds: [sessionId], reason: "We have enough", seenAt: seen(), confirmed: true })).status).toBe(200);
    await expectMust(tester.user.id, "Your work on “Harbor Run” was ended early", "tstopped");
    await expectMust(dee.user.id, "A spot opened on Harbor Run: you can accept Nora Lane's invite now.", "apps", false);
  });

  it("the developer deleting their account: “Harbor Run” was stopped", async () => {
    const { dev, testId } = await setup();
    const { tester } = await joined(testId);
    await deleteAccount(dev.user.id, "self");
    await expectMust(tester.user.id, "“Harbor Run” was stopped", "tstopped");
  });

  it("the team's Stop: “Harbor Run” was stopped", async () => {
    const { testId } = await setup();
    const { tester } = await joined(testId);
    const a = await admin();
    await adminStopTest(testId, "Reported content.", a.user.id);
    await expectMust(tester.user.id, "“Harbor Run” was stopped", "tstopped");
  });

  it("a paused test closed: “Harbor Run” ended", async () => {
    const { testId } = await setup();
    const { tester } = await joined(testId);
    const a = await admin();
    await pauseTest(a.user.id, testId, "Checking a report about this test.");
    expect((await closePausedTest(testId, "daily")).closed).toBe(true);
    await expectMust(tester.user.id, "“Harbor Run” ended", "tstopped");
  });

  it("the work deadline passing: “Harbor Run” ended", async () => {
    const { testId } = await setup();
    const { tester } = await joined(testId);
    expect(await finishWorkIfDue(testId, new Date(Date.now() + 40 * DAY))).toBe(true);
    await expectMust(tester.user.id, "“Harbor Run” ended", "tstopped");
  });
});

describe("(Owner, Nov 2026) the tester's You're in / You're back in lines are must-send; wasn't accepted follows the setting", () => {
  it("Accept and Decline of an application: You're in: Harbor Run / Your application to “Harbor Run” wasn't accepted", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const ben = await makeUser({ tester: true, name: "Ben Cole", pronoun: "he" });
    for (const t of [ana, ben]) expect((await apply(testId, t.cookie)).status).toBe(200);
    expect((await decide(testId, dev.cookie, (await appOf(testId, ana.user.id)).id, "accept")).body.accepted).toBe(true);
    expect((await decide(testId, dev.cookie, (await appOf(testId, ben.user.id)).id, "decline")).body.declined).toBe(true);
    await expectMust(ana.user.id, "You're in: Harbor Run", "joined");
    await expectMust(ben.user.id, "Your application to “Harbor Run” wasn't accepted", "joined", false);
  });

  it("Accept and Decline of an ask to rejoin: You're back in Harbor Run: … / Your ask to rejoin “Harbor Run” wasn't accepted", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Cole", "he");
    for (const x of [a, b]) {
      expect((await leave(x.sessionId, x.tester.cookie)).status).toBe(200);
      expect((await ask(testId, x.tester.cookie)).body).toEqual({ asked: true });
    }
    expect((await decide(testId, dev.cookie, (await appOf(testId, a.tester.user.id)).id, "accept")).body.accepted).toBe(true);
    expect((await decide(testId, dev.cookie, (await appOf(testId, b.tester.user.id)).id, "decline")).body.declined).toBe(true);
    await expectMust(a.tester.user.id, { startsWith: "You're back in Harbor Run: your deadline is " }, "joined");
    await expectMust(b.tester.user.id, "Your ask to rejoin “Harbor Run” wasn't accepted", "joined", false);
  });

  it("the switch to Anyone can join: You're in: Harbor Run", async () => {
    const { testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    expect((await apply(testId, ana.cookie)).status).toBe(200);
    await db.test.update({ where: { id: testId }, data: { joinMode: "anyone" } });
    await onSwitchToAnyone(testId);
    await expectMust(ana.user.id, "You're in: Harbor Run", "joined");
  });

  it("the developer's Invite meeting an application (as Accept): You're in: Harbor Run", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const devPageAt = seen();
    await settle();
    expect((await apply(testId, ana.cookie)).body).toEqual({ applied: true });
    await settle();
    expect((await act(testId, "invite", dev.cookie, { seenAt: devPageAt, testerIds: [ana.user.id] })).body.joined).toEqual([ana.user.id]);
    await expectMust(ana.user.id, "You're in: Harbor Run", "joined");
  });

  it("an ask to rejoin meeting an invite: You're back in Harbor Run: … (the developer's Invite, as Accept) / You're back in Harbor Run (not the developer's press)", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Cole", "he");
    await leave(a.sessionId, a.tester.cookie);
    await leave(b.sessionId, b.tester.cookie);
    // Ask first, then the developer's Invite from a page that didn't show the ask: as Accept.
    const devPageAt = seen();
    await settle();
    await ask(testId, a.tester.cookie);
    expect((await act(testId, "invite", dev.cookie, { seenAt: devPageAt, testerIds: [a.tester.user.id], confirmed: true })).body.joined).toEqual([a.tester.user.id]);
    await expectMust(a.tester.user.id, { startsWith: "You're back in Harbor Run: your deadline is " }, "joined");
    // A waiting ask meeting an invite, not by the developer's press (matchInviteAndAsk's own branch; today only the Invite calls it, byDeveloper).
    expect((await ask(testId, b.tester.cookie)).body).toEqual({ asked: true });
    await db.invite.create({ data: { testId, testerId: b.tester.user.id } });
    expect(await matchInviteAndAsk(testId, b.tester.user.id)).toBeTruthy();
    await expectMust(b.tester.user.id, "You're back in Harbor Run", "joined");
  });

  it("an application meeting an invite (not the developer's press): You're in: Harbor Run", async () => {
    const { testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    expect((await apply(testId, ana.cookie)).body).toEqual({ applied: true });
    await db.invite.create({ data: { testId, testerId: ana.user.id } });
    expect(await matchInviteAndAsk(testId, ana.user.id)).toBeTruthy();
    await expectMust(ana.user.id, "You're in: Harbor Run", "joined");
  });
});

describe("(Owner, Nov 2026) a tester with email Off gets them in the next morning's short email", () => {
  it("You're in and was stopped go in the morning email; an invite and a wasn't accepted (follow the setting) stay out", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const other = await setup({ title: "Pier Ten", productName: "Pier Ten" });
    const third = await setup({ title: "Dock Nine", productName: "Dock Nine", joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    await db.user.update({ where: { id: ana.user.id }, data: { emailPref: "off" } });
    expect((await apply(testId, ana.cookie)).status).toBe(200);
    expect((await decide(testId, dev.cookie, (await appOf(testId, ana.user.id)).id, "accept")).body.accepted).toBe(true);
    expect((await act(other.testId, "invite", other.dev.cookie, { seenAt: seen(), testerIds: [ana.user.id], confirmed: true })).status).toBe(200);
    expect((await apply(third.testId, ana.cookie)).status).toBe(200);
    expect((await decide(third.testId, third.dev.cookie, (await appOf(third.testId, ana.user.id)).id, "decline")).body.declined).toBe(true);
    expect((await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    const invite = await db.notification.findFirstOrThrow({ where: { userId: ana.user.id, text: "Nora Lane invited you to “Pier Ten”" } });
    expect(invite.mustEmail).toBe(false);
    expect(await db.outboxEmail.count({ where: { to: ana.user.email } })).toBe(0); // nothing sent at once
    await sendSummaries(new Date(), [ana.user.id]);
    const mails = await db.outboxEmail.findMany({ where: { to: ana.user.email } });
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/^Your Playtest account updates: \d+$/);
    expect(mails[0].text).toContain("You're in: Harbor Run");
    expect(mails[0].text).toContain("“Harbor Run” was stopped");
    expect(mails[0].text).not.toContain("invited you");
    expect(mails[0].text).not.toContain("wasn't accepted");
    expect((await db.notification.findUniqueOrThrow({ where: { id: invite.id } })).summarizedAt).toBeNull(); // waits: Off never emails it
    // Once only.
    await sendSummaries(new Date(), [ana.user.id]);
    expect(await db.outboxEmail.count({ where: { to: ana.user.email } })).toBe(1);
  });
});
