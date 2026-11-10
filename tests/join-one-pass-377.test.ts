import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { makeUser } from "./helpers";
import { act, joined, seen, settle, setup } from "./fixtures";

// (Owner, Nov 11, §377) Join, Apply to join and Ask to rejoin make ONE pass under the test's lock: the J01 refusals, then the button's own refusals, the saved
// profile, the listing box, the gap box and the NDA tick, then the save. One press ends in exactly one outcome; a refusal always comes before any box.

type Res = { status: number; code?: string; message?: string; lines: string[] };
const press = async (testId: string, action: "join" | "apply" | "rejoin-ask", cookie: string, body: Record<string, unknown>): Promise<Res> => {
  const r = await act(testId, action, cookie, body);
  const e = r.body?.error ?? {};
  return { status: r.status, code: e.code, message: e.message, lines: ((e.changes ?? []) as { text: string }[]).map((c) => c.text) };
};
/** A REAL listing edit (a hand-made testEvent doesn't make the box). */
const edited = async (testId: string, cookie: string) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).listingVersion;
  const r = await act(testId, "edit", cookie, { version: v, fields: { description: `Sail through the harbors ${Date.now()}` }, seenAt: seen(), confirmed: true });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  await settle();
};
const hooks = () => ((globalThis as { __pressHooks?: Record<string, () => Promise<void>> }).__pressHooks ??= {});
/** Runs `during` once, the first time a press reaches its lock (just before it takes it). */
function pauseAt(name: string, during: () => Promise<unknown>) {
  let fired = false;
  hooks()[name] = async () => {
    if (fired) return;
    fired = true;
    await during();
    await settle();
  };
}
afterEach(() => { delete (globalThis as { __pressHooks?: unknown }).__pressHooks; });

const STOPPED = (p: string) => `This test was stopped, so your ${p} didn't go through.`;
const FULL = (p: string) => `This test is full, so your ${p} didn't go through.`;
const NOT_TAKING = (p: string) => `This test isn't taking new testers right now, so your ${p} didn't go through.`;
const box = (r: Res) => { expect(r.code, JSON.stringify(r)).toBe("stop_once"); expect(r.lines.length).toBeGreaterThan(0); };
const refused = (r: Res, message: string) => { expect(r.message, JSON.stringify(r)).toBe(message); expect(r.lines).toEqual([]); expect(r.code).not.toBe("stop_once"); };

describe("§377 Join: refusals before the listing box, in the owner's order", () => {
  it("stopped + full + the developer blocks Ana + the listing edited → only the stop line; then full; then the block (T04); then the box", async () => {
    const s = await setup({ spots: 1 });
    await joined(s.testId, "Ben Ito", "he"); // the only spot: full
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const pageSeenAt = seen();
    await settle();
    await db.block.create({ data: { blockerId: s.dev.user.id, blockedId: ana.user.id } }); // T04
    await edited(s.testId, s.dev.cookie); // the J04 box
    await db.test.update({ where: { id: s.testId }, data: { status: "stopped", stoppedAt: new Date() } });
    const body = { seenAt: pageSeenAt };
    refused(await press(s.testId, "join", ana.cookie, body), STOPPED("Join"));
    await db.test.update({ where: { id: s.testId }, data: { status: "open", stoppedAt: null } });
    refused(await press(s.testId, "join", ana.cookie, body), FULL("Join"));
    await db.test.update({ where: { id: s.testId }, data: { spots: 5 } });
    refused(await press(s.testId, "join", ana.cookie, body), NOT_TAKING("Join"));
    await db.block.deleteMany({ where: { blockerId: s.dev.user.id, blockedId: ana.user.id } });
    box(await press(s.testId, "join", ana.cookie, body));
    expect(await db.contract.count({ where: { testId: s.testId, testerId: ana.user.id } })).toBe(0);
  });

  it("an apply-only test + the listing edited: the J02 refusal on the FIRST press (no box)", async () => {
    const s = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const pageSeenAt = seen();
    await settle();
    await edited(s.testId, s.dev.cookie);
    const r = await press(s.testId, "join", ana.cookie, { seenAt: pageSeenAt });
    expect(r.code).toBe("apply");
    refused(r, "This test takes applications: press Apply to join.");
  });

  it("(owner's exception) an invite-only test + the listing edited: still the box first, then \"This test is invite only.\"", async () => {
    const s = await setup({ joinMode: "invite" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const pageSeenAt = seen();
    await settle();
    await edited(s.testId, s.dev.cookie);
    const first = await act(s.testId, "join", ana.cookie, { seenAt: pageSeenAt });
    expect(first.body.error.code).toBe("stop_once");
    const second = await press(s.testId, "join", ana.cookie, { seenAt: pageSeenAt, confirmed: true, boxAt: first.body.error.now });
    expect(second.code).toBe("invite_only");
    refused(second, "This test is invite only.");
  });

  it("the profile not saved comes before the box; the gap box before the NDA tick", async () => {
    const s = await setup({ devices: ["iPhone"], ndaText: "Keep it secret, please." });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    await db.testerProfile.update({ where: { userId: ana.user.id }, data: { devices: [] } });
    const pageSeenAt = seen();
    await settle();
    await edited(s.testId, s.dev.cookie);
    const r = await press(s.testId, "join", ana.cookie, { seenAt: pageSeenAt });
    expect(r.code).toBe("profile_first");
    await db.testerProfile.update({ where: { userId: ana.user.id }, data: { devices: ["Windows PC"] } });
    box(await press(s.testId, "join", ana.cookie, { seenAt: pageSeenAt }));
    const gap = await press(s.testId, "join", ana.cookie, { seenAt: seen() }); // no NDA tick yet: the gap box comes first
    expect(gap.code).toBe("needs");
    const nda = await press(s.testId, "join", ana.cookie, { seenAt: seen(), anyway: true });
    expect(nda.code).toBe("nda");
    expect((await press(s.testId, "join", ana.cookie, { seenAt: seen(), anyway: true, ndaAccepted: true })).status).toBe(200);
  });
});

describe("§377 Apply and Ask to rejoin: the same order", () => {
  it("Apply: full + blocked + the listing edited → full in the pattern; nothing saved", async () => {
    const s = await setup({ joinMode: "apply", spots: 1 });
    await db.test.update({ where: { id: s.testId }, data: { joinMode: "anyone" } });
    await joined(s.testId, "Ben Ito", "he");
    await db.test.update({ where: { id: s.testId }, data: { joinMode: "apply" } });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const pageSeenAt = seen();
    await settle();
    await db.block.create({ data: { blockerId: s.dev.user.id, blockedId: ana.user.id } });
    await edited(s.testId, s.dev.cookie);
    refused(await press(s.testId, "apply", ana.cookie, { seenAt: pageSeenAt }), FULL("Apply"));
    expect(await db.application.count({ where: { testId: s.testId, testerId: ana.user.id } })).toBe(0);
  });

  it("Ask to rejoin: full → the pattern; then the gap box comes before the NDA tick", async () => {
    const s = await setup({ spots: 1 });
    const ana = await joined(s.testId);
    await db.contract.update({ where: { id: ana.sessionId }, data: { status: "left", endedAt: new Date() } });
    await joined(s.testId, "Ben Ito", "he");
    await db.test.update({ where: { id: s.testId }, data: { devices: ["iPhone"], ndaText: "Keep it secret, please." } });
    refused(await press(s.testId, "rejoin-ask", ana.tester.cookie, { seenAt: seen() }), FULL("Ask to rejoin"));
    await db.test.update({ where: { id: s.testId }, data: { spots: 5 } });
    const gap = await press(s.testId, "rejoin-ask", ana.tester.cookie, { seenAt: seen() });
    expect(gap.code).toBe("needs");
    expect(gap.message).toMatch(/Ask to rejoin anyway\?$/);
    expect((await press(s.testId, "rejoin-ask", ana.tester.cookie, { seenAt: seen(), anyway: true })).code).toBe("nda");
    expect((await press(s.testId, "rejoin-ask", ana.tester.cookie, { seenAt: seen(), anyway: true, ndaAccepted: true })).status).toBe(200);
    expect(await db.application.count({ where: { testId: s.testId, testerId: ana.tester.user.id, status: "pending", kind: "rejoin" } })).toBe(1);
  });

  it("an unseen invite still joins at once (Apply), right after the J01 refusals", async () => {
    const s = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const pageSeenAt = seen();
    await settle();
    expect((await act(s.testId, "invite", s.dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [ana.user.id] })).status).toBe(200);
    const r = await act(s.testId, "apply", ana.cookie, { seenAt: pageSeenAt });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.joined).toBe(true);
    expect(await db.contract.count({ where: { testId: s.testId, testerId: ana.user.id, status: "working" } })).toBe(1);
  });
});

describe("§377 races: the result never depends on timing", () => {
  it("the test fills while Apply waits for the lock → refused (full), nothing saved", async () => {
    const s = await setup({ joinMode: "apply", spots: 1 });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const ben = await makeUser({ tester: true, name: "Ben Ito", pronoun: "he" });
    pauseAt("apply", async () => {
      await db.test.update({ where: { id: s.testId }, data: { joinMode: "anyone" } });
      expect((await act(s.testId, "join", ben.cookie, { seenAt: seen() })).status).toBe(200);
      await db.test.update({ where: { id: s.testId }, data: { joinMode: "apply" } });
    });
    refused(await press(s.testId, "apply", ana.cookie, { seenAt: seen() }), FULL("Apply"));
    expect(await db.application.count({ where: { testId: s.testId, testerId: ana.user.id } })).toBe(0);
  });

  it("the test is stopped while Apply waits for the lock → refused (stopped), nothing saved", async () => {
    const s = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    pauseAt("apply", () => db.test.update({ where: { id: s.testId }, data: { status: "stopped", stoppedAt: new Date() } }));
    refused(await press(s.testId, "apply", ana.cookie, { seenAt: seen() }), STOPPED("Apply"));
    expect(await db.application.count({ where: { testId: s.testId, testerId: ana.user.id } })).toBe(0);
  });

  it("two Apply presses at once → one saved, the other J09 with the one wording", async () => {
    const s = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const at = seen();
    const both = await Promise.all([press(s.testId, "apply", ana.cookie, { seenAt: at }), press(s.testId, "apply", ana.cookie, { seenAt: at })]);
    expect(both.filter((r) => r.status === 200)).toHaveLength(1);
    const other = both.find((r) => r.status !== 200)!;
    expect(other.code).toBe("already_waiting");
    refused(other, "You already applied to join this test in another tab.");
    expect(await db.application.count({ where: { testId: s.testId, testerId: ana.user.id, status: "pending" } })).toBe(1);
    expect(await db.testEvent.count({ where: { testId: s.testId, kind: "applied" } })).toBe(1);
  });

  it("two Ask to rejoin presses at once → one saved, the other J09 with the one wording", async () => {
    const s = await setup();
    const ana = await joined(s.testId);
    await db.contract.update({ where: { id: ana.sessionId }, data: { status: "left", endedAt: new Date() } });
    const at = seen();
    const both = await Promise.all([press(s.testId, "rejoin-ask", ana.tester.cookie, { seenAt: at }), press(s.testId, "rejoin-ask", ana.tester.cookie, { seenAt: at })]);
    expect(both.filter((r) => r.status === 200)).toHaveLength(1);
    refused(both.find((r) => r.status !== 200)!, "You already asked to rejoin this test in another tab.");
  });
});
