import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { pauseTest, suspendAccount } from "@/lib/server/restrictions";
import { startHold } from "@/lib/server/holds";
import { finishWorkIfDue } from "@/lib/server/workWindow";
import { CLOSING_FIELDS } from "@/lib/server/tests";
import { inviteClosedLine } from "@/lib/server/invites";
import { INVITE_NOT_OPEN, inviteClosedLine as closedReason } from "@/lib/server/joining";
import { makeUser } from "./helpers";
import { act, joined, seen, settle, setup } from "./fixtures";

// (Owner, Dec 10 2026) Open invites and pending applications (Ana the tester, Nora the developer):
// 1. A pause (the team's, a hold, a suspension) no longer cancels invites: they stay open like pending applications, and the invitee hears nothing.
// 2. A full test no longer closes pending applications: they stay open and the applicant hears nothing (not on fill, not when a spot opens).
// 3. A listing edit no longer re-sends invites: the invite stays, nothing is rung.
// 4. "deadlineDays" is not a closing field.
// 5. One Save that changes a closing field and switches to invite only closes applications with the invite-only line.
// 6. A test closing on its own (its work ended) rings each invitee whose invite it closed.
const DAY = 86_400_000;

async function admin() {
  const a = await makeUser({ email: `admin-dec10-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}
async function invitedTest(over: Record<string, unknown> = {}) {
  const s = await setup(over);
  const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
  expect((await act(s.testId, "invite", s.dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [ana.user.id] })).status).toBe(200);
  const inv = await db.invite.findFirstOrThrow({ where: { testId: s.testId, testerId: ana.user.id, status: "sent" } });
  await settle();
  return { ...s, ana, inv, since: new Date() };
}
const linesSince = (userId: string, since: Date) => db.notification.findMany({ where: { userId, createdAt: { gte: since } } });
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  const r = await act(testId, "edit", cookie, { version: v, fields, seenAt: seen(), confirmed: true });
  await settle();
  return r;
};

describe("1. a pause keeps open invites", () => {
  it("the team's pause, a payment hold, a developer suspension: the invite stays sent, Ana gets no bell, Join waits", async () => {
    const a = await admin();
    const team = await invitedTest();
    await pauseTest(a.user.id, team.testId, "Checking a report about this test.");
    const hold = await invitedTest();
    await startHold(hold.dev.user.id, "payment");
    const susp = await invitedTest();
    await suspendAccount(a.user.id, susp.dev.user.id, "Checking a report about this account.", "developer");
    for (const x of [team, hold, susp]) {
      expect((await db.invite.findUniqueOrThrow({ where: { id: x.inv.id } })).status).toBe("sent");
      expect(await linesSince(x.ana.user.id, x.since)).toEqual([]);
      const j = await act(x.testId, "join", x.ana.cookie, { seenAt: seen(), inviteId: x.inv.id });
      expect(j.body.error.message).toBe("This test isn't taking new testers right now, so your Join didn't go through.");
      expect((await db.invite.findUniqueOrThrow({ where: { id: x.inv.id } })).status).toBe("sent");
    }
    // (Owner, Dec 10 2026) An invite cancelled while the test is paused (a Cancel invite, a block…) gives its normal reason, never the pause.
    for (const x of [team, hold, susp]) {
      await db.invite.update({ where: { id: x.inv.id }, data: { status: "cancelled" } });
      expect(await closedReason(x.testId)).toBe(INVITE_NOT_OPEN);
    }
    // The developer's pause lines say nothing about invites.
    const devLines = await db.notification.findMany({ where: { userId: { in: [team.dev.user.id, hold.dev.user.id, susp.dev.user.id] } } });
    expect(devLines.some((l) => /open invites? (was|were) closed/.test(l.text))).toBe(false);
  });
});

describe("2. a full test keeps pending applications", () => {
  it("the last spot taken: Ben's application stays pending, he hears nothing (fill or a spot opening); Accept is refused while full", async () => {
    const { dev, testId } = await setup({ joinMode: "apply", spots: 1 });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const ben = await makeUser({ tester: true, name: "Ben Carter", pronoun: "he" });
    await act(testId, "apply", ana.cookie, { note: "a" });
    await act(testId, "apply", ben.cookie, { note: "b" });
    await settle();
    const since = new Date();
    const appA = await db.application.findFirstOrThrow({ where: { testId, testerId: ana.user.id } });
    expect((await act(testId, "application", dev.cookie, { applicationId: appA.id, action: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
    const appB = await db.application.findFirstOrThrow({ where: { testId, testerId: ben.user.id } });
    expect(appB.status).toBe("pending");
    expect((await db.testEvent.findFirstOrThrow({ where: { testId, kind: "full" } })).text).toBe("Harbor Run is full");
    expect((await act(testId, "application", dev.cookie, { applicationId: appB.id, action: "accept", seenAt: seen(), confirmed: true })).body.error.message).toBe("This test is full.");
    // A spot opens: still nothing for Ben; Nora can accept him now.
    await edit(testId, dev.cookie, { spots: 2 });
    expect(await linesSince(ben.user.id, since)).toEqual([]);
    expect((await act(testId, "application", dev.cookie, { applicationId: appB.id, action: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
  });

  it("the full line keeps the invites' part: \"<test> is full. 1 invite stays open until a spot opens\"", async () => {
    const x = await invitedTest({ spots: 1 });
    await joined(x.testId, "Ben Carter", "he");
    expect((await db.testEvent.findFirstOrThrow({ where: { testId: x.testId, kind: "full" } })).text).toBe("Harbor Run is full. 1 invite stays open until a spot opens");
    expect((await db.invite.findUniqueOrThrow({ where: { id: x.inv.id } })).status).toBe("sent");
  });
});

describe("3-4. a listing edit keeps open invites", () => {
  it("a price change: same invite id, still sent, no bell for Ana; the Save's effects don't mention invites", async () => {
    const x = await invitedTest();
    const r = await edit(x.testId, x.dev.cookie, { writtenCents: "12.00" });
    expect(r.status).toBe(200);
    expect(await db.invite.findMany({ where: { testId: x.testId, testerId: x.ana.user.id }, select: { id: true, status: true } })).toEqual([{ id: x.inv.id, status: "sent" }]);
    expect(await linesSince(x.ana.user.id, x.since)).toEqual([]);
    expect((await db.testChange.findFirstOrThrow({ where: { testId: x.testId }, orderBy: { createdAt: "desc" } })).effects).toBeFalsy();
    expect((await act(x.testId, "join", x.ana.cookie, { seenAt: seen(), inviteId: x.inv.id, confirmed: true })).status).toBe(200);
  });

  it("deadlineDays is not a closing field", () => {
    expect(CLOSING_FIELDS).not.toContain("deadlineDays");
  });
});

describe("5. closing field + invite only in one Save", () => {
  it("the applicant reads the invite-only line, never the listing line", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    await act(testId, "apply", ana.cookie, { note: "Hi" });
    await settle();
    const r = await edit(testId, dev.cookie, { description: `New words ${randomUUID()}`, joinMode: "invite" });
    expect(r.body.closedApps).toEqual(["Ana Silva"]);
    expect(await db.application.findFirstOrThrow({ where: { testId, testerId: ana.user.id } })).toMatchObject({ status: "closed", closedReason: "invite_only" });
    const texts = (await db.notification.findMany({ where: { userId: ana.user.id, testId } })).map((n) => n.text);
    expect(texts).toContain("“Harbor Run” is now invite only, so your application was closed.");
    expect(texts.some((t) => t.includes("listing changed"))).toBe(false);
  });
});

describe("6. a test closing on its own rings its invitees", () => {
  it("the invite is cancelled and Ana reads “Your invite to “Harbor Run” was closed.”", async () => {
    const x = await invitedTest();
    expect(await finishWorkIfDue(x.testId, new Date(Date.now() + 25 * DAY))).toBe(true);
    expect((await db.invite.findUniqueOrThrow({ where: { id: x.inv.id } })).status).toBe("cancelled");
    const lines = await linesSince(x.ana.user.id, x.since);
    expect(lines.map((l) => l.text)).toEqual([inviteClosedLine("Harbor Run")]);
    expect(lines[0]).toMatchObject({ groupKey: "apps", link: `/app/find/${x.testId}` });
  });
});
