import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { INVITES_PER_DAY, INVITES_PER_TESTER_PER_TEST, invitesLeftLine, sameTesterLimitLine } from "@/lib/server/invites";
import { makeUser, uniq } from "./helpers";
import { act, seen, setup, settle } from "./fixtures";

// (Owner, Nov 2, batch 35 §128) Invites: 100 per developer a day across all their tests (a press that would go over sends nothing), and 3 to the same tester on the same
// test a day (only that tester is skipped). Cancel invite is never limited.

const DAY = 24 * 3_600_000;
/** `n` invites this developer already sent today (made directly; cancelled, so they hold no tester). */
const alreadySent = (testId: string, n: number, at = new Date()) =>
  db.invite.createMany({ data: Array.from({ length: n }, () => ({ testId, testerId: `seed-${uniq()}`, status: "cancelled", createdAt: at })) });
const tester = (name = "Ana Silva") => makeUser({ tester: true, name: `${name} ${uniq()}` });
const invite = (testId: string, cookie: string, testerIds: string[]) => act(testId, "invite", cookie, { testerIds, seenAt: seen(), confirmed: true });
const cancel = async (testId: string, cookie: string, testerId: string) => {
  const inv = await db.invite.findFirstOrThrow({ where: { testId, testerId, status: "sent" } });
  const r = await act(testId, "cancel-invite", cookie, { inviteId: inv.id, seenAt: seen(), confirmed: true });
  await settle();
  return r;
};

describe("invite limits (batch 35 §128)", () => {
  it("the lines", () => {
    expect(INVITES_PER_DAY).toBe(100);
    expect(invitesLeftLine(2)).toBe("You can send up to 100 invites a day. You have 2 left today.");
    expect(invitesLeftLine(0)).toBe("You've sent 100 invites today. You can invite more tomorrow.");
    expect(sameTesterLimitLine("Ana Silva")).toBe("Ana Silva: you've invited them to this test 2 times today. You can invite them again tomorrow.");
  });

  it("100 a day, then refused with nothing sent; a day later it works", async () => {
    const { dev, testId } = await setup();
    await alreadySent(testId, INVITES_PER_DAY - 1);
    const [a, b] = await Promise.all([tester(), tester("Ben Ode")]);
    expect((await invite(testId, dev.cookie, [a.user.id])).status).toBe(200); // the 100th
    const r = await invite(testId, dev.cookie, [b.user.id]);
    expect(r.status).toBe(429);
    expect(r.body.error).toMatchObject({ code: "too_many_invites", message: "You've sent 100 invites today. You can invite more tomorrow." });
    expect(await db.invite.count({ where: { testId, testerId: b.user.id } })).toBe(0);
    // A day later: the earlier ones are out of the window.
    await db.invite.updateMany({ where: { testId }, data: { createdAt: new Date(Date.now() - DAY - 60_000) } });
    expect((await invite(testId, dev.cookie, [b.user.id])).status).toBe(200);
  });

  it("a press of 3 with 2 left is refused whole and names 2; cancel still works at the limit", async () => {
    const { dev, testId } = await setup();
    const first = await tester("Cara Ruiz");
    expect((await invite(testId, dev.cookie, [first.user.id])).status).toBe(200);
    await alreadySent(testId, INVITES_PER_DAY - 3); // 98 sent: 2 left
    const three = await Promise.all([tester(), tester("Ben Ode"), tester("Dee Kim")]);
    const r = await invite(testId, dev.cookie, three.map((t) => t.user.id));
    expect(r.status).toBe(429);
    expect(r.body.error.message).toBe("You can send up to 100 invites a day. You have 2 left today.");
    expect(await db.invite.count({ where: { testId, testerId: { in: three.map((t) => t.user.id) } } })).toBe(0);
    // Two fit.
    expect((await invite(testId, dev.cookie, three.slice(0, 2).map((t) => t.user.id))).status).toBe(200);
    // At 100: Cancel invite still works.
    expect((await cancel(testId, dev.cookie, first.user.id)).status).toBe(200);
    expect((await db.invite.findFirstOrThrow({ where: { testId, testerId: first.user.id } })).status).toBe("cancelled");
  });

  it("cancel and re-invite counts each time: 2 to one tester on one test, then only they're skipped; those 2 count toward the 100; another test has its own 2", async () => {
    const { dev, testId } = await setup();
    const ana = await tester();
    const name = (await db.user.findUniqueOrThrow({ where: { id: ana.user.id } })).name;
    for (let i = 0; i < INVITES_PER_TESTER_PER_TEST; i++) {
      expect((await invite(testId, dev.cookie, [ana.user.id])).status).toBe(200);
      await cancel(testId, dev.cookie, ana.user.id);
    }
    // Two invitations count toward the total of 100.
    const ben = await tester("Ben Ode");
    await alreadySent(testId, INVITES_PER_DAY - INVITES_PER_TESTER_PER_TEST - 1); // 99 sent: 1 left
    const r = await invite(testId, dev.cookie, [ana.user.id, ben.user.id]);
    expect(r.status).toBe(200);
    expect(r.body.message).toContain(sameTesterLimitLine(name));
    expect(r.body.message).toContain(`Invited ${(await db.user.findUniqueOrThrow({ where: { id: ben.user.id } })).name}.`);
    expect(await db.invite.count({ where: { testId, testerId: ana.user.id, status: "sent" } })).toBe(0);
    expect(await db.invite.count({ where: { testId, testerId: ben.user.id, status: "sent" } })).toBe(1);
    // Now at 100: a 4th for Ana would be skipped anyway, and anyone else is refused whole.
    expect((await invite(testId, dev.cookie, [(await tester("Dee Kim")).user.id])).status).toBe(429);
  });

  it("another test of the same developer has its own 2 for the same tester", async () => {
    const one = await setup();
    const two = await setup();
    await db.test.update({ where: { id: two.testId }, data: { developerId: one.dev.user.id } });
    const ana = await tester();
    for (let i = 0; i < INVITES_PER_TESTER_PER_TEST; i++) {
      expect((await invite(one.testId, one.dev.cookie, [ana.user.id])).status).toBe(200);
      await cancel(one.testId, one.dev.cookie, ana.user.id);
    }
    expect((await invite(one.testId, one.dev.cookie, [ana.user.id])).body.message).toContain("times today");
    const r = await invite(two.testId, one.dev.cookie, [ana.user.id]);
    expect(r.status).toBe(200);
    expect(await db.invite.count({ where: { testId: two.testId, testerId: ana.user.id, status: "sent" } })).toBe(1);
  });

  it("another developer is unaffected", async () => {
    const full = await setup();
    await alreadySent(full.testId, INVITES_PER_DAY);
    const other = await setup();
    const ana = await tester();
    expect((await invite(full.testId, full.dev.cookie, [ana.user.id])).status).toBe(429);
    expect((await invite(other.testId, other.dev.cookie, [ana.user.id])).status).toBe(200);
  });
});
