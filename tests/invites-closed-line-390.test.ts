import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { adminStopTest, pauseTest, suspendAccount } from "@/lib/server/restrictions";
import { startHold } from "@/lib/server/holds";
import { closePausedTest } from "@/lib/server/pauseClosure";
import { invitesClosedTail } from "@/lib/server/invites";
import { renderTimes } from "@/lib/tz";
import { makeUser } from "./helpers";
import { act, seen, setup } from "./fixtures";

// (Owner, Nov 11, §390 d) The developer's own stop / closure line says how many open invites it closed, like the calls tail: "The team stopped “X”; 1 open
// invite was closed" (3: "3 open invites were closed"). The developer's Stop (its done line), the team's Stop, the 7-day pause closure. (Owner, Dec 10 2026) A
// pause (the team's, a hold / chargeback hold / suspension starting) no longer closes invites: its line has no tail and the invites stay open.

async function admin() {
  const a = await makeUser({ email: `admin-390d-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}
/** A test with `n` open invites. */
async function invited(n: number) {
  const s = await setup();
  const testers = await Promise.all(Array.from({ length: n }, () => makeUser({ tester: true })));
  const r = await act(s.testId, "invite", s.dev.cookie, { seenAt: seen(), confirmed: true, testerIds: testers.map((t) => t.user.id) });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(await db.invite.count({ where: { testId: s.testId, status: "sent" } })).toBe(n);
  return s;
}
const devLine = async (devId: string, start: string) => renderTimes((await db.notification.findFirstOrThrow({ where: { userId: devId, text: { startsWith: start } }, orderBy: { createdAt: "desc" } })).text, "UTC");
const DAY_RE = "[A-Z][a-z]{2} \\d{1,2}";

describe("§390 d: the developer's stop / closure line counts the open invites it closed", () => {
  it("the wording", () => {
    expect(invitesClosedTail(0)).toBe("");
    expect(invitesClosedTail(1)).toBe("1 open invite was closed");
    expect(invitesClosedTail(3)).toBe("3 open invites were closed");
  });

  it("(Owner, Dec 10 2026) the team's pause: no tail, the invites stay open", async () => {
    const s = await invited(3);
    const a = await admin();
    await pauseTest(a.user.id, s.testId, "Checking a report about this test.");
    expect(await devLine(s.dev.user.id, "The team paused")).toMatch(new RegExp(`^The team paused “Harbor Run”: it closes on ${DAY_RE} unless the team lifts the pause$`));
    expect(await db.invite.count({ where: { testId: s.testId, status: "sent" } })).toBe(3);
  });

  it("(Owner, Dec 10 2026) a payment hold starting, a chargeback hold starting, a suspension starting: no tail, the invites stay open", async () => {
    const h = await invited(1);
    await startHold(h.dev.user.id, "payment");
    expect(await devLine(h.dev.user.id, "Your tests are paused")).toMatch(new RegExp(`^Your tests are paused until you pay what you owe: “Harbor Run” closes on ${DAY_RE}$`));
    const c = await invited(2);
    await startHold(c.dev.user.id, "chargeback");
    expect(await devLine(c.dev.user.id, "Your tests are paused after a chargeback")).toMatch(new RegExp(`^Your tests are paused after a chargeback: “Harbor Run” closes on ${DAY_RE} unless you finish the steps$`));
    const u = await invited(2);
    const a = await admin();
    await suspendAccount(a.user.id, u.dev.user.id, "Checking a report about this account.", "developer");
    expect(await devLine(u.dev.user.id, "Your developer account is paused")).toMatch(new RegExp(`^Your developer account is paused: “Harbor Run” closes on ${DAY_RE} unless your account is cleared$`));
    for (const x of [h, c, u]) expect(await db.invite.count({ where: { testId: x.testId, status: "cancelled" } })).toBe(0);
  });

  it("the developer's own Stop: its done line", async () => {
    const s = await invited(2);
    const r = await act(s.testId, "stop", s.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.done).toBe("You stopped the test; 2 open invites were closed.");
  });

  it("the team's Stop and the 7-day pause closure", async () => {
    const s = await invited(1);
    const a = await admin();
    await adminStopTest(s.testId, "Closing this test.", a.user.id);
    expect(await devLine(s.dev.user.id, "The team stopped")).toBe("The team stopped “Harbor Run”; 1 open invite was closed");
    const c = await invited(2);
    await db.test.update({ where: { id: c.testId }, data: { adminPausedAt: new Date(), pausedSince: new Date() } });
    await closePausedTest(c.testId, "admin", new Date(), a.user.id);
    expect(await devLine(c.dev.user.id, "“Harbor Run” was closed.")).toMatch(/ 2 open invites were closed\.$/);
  });

  it("no open invite: the lines read as before", async () => {
    const s = await setup();
    const a = await admin();
    await pauseTest(a.user.id, s.testId, "Checking a report about this test.");
    expect(await devLine(s.dev.user.id, "The team paused")).toMatch(new RegExp(`unless the team lifts the pause$`));
  });
});
