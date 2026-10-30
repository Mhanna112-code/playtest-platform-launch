import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { makeUser } from "./helpers";
import { act, setup, seen, settle } from "./fixtures";
import { invitable, inviteGaps, testerRowInfo } from "@/lib/server/invites";
import { ratingChangedLine, testerNeedsChangedLines, type Needs } from "@/lib/testerState";
import { redrawTesterChanges } from "@/lib/useTesterChanges";
import { testV } from "@/lib/server/pulseV";

const needs = { devices: [] as string[], languages: ["Spanish", "Russian"] };
type Action = "invite" | "cancel" | "accept" | "decline";
async function scenario(action: Action, languages: string[] = ["Russian"]) {
  const { dev, testId } = await setup({ ...needs, joinMode: action === "accept" || action === "decline" ? "apply" : "anyone" });
  const tester = await makeUser({ tester: true, name: "Ana Silva" });
  await db.testerProfile.update({ where: { userId: tester.user.id }, data: { languages } });
  const application = action === "accept" || action === "decline" ? await db.application.create({ data: { testId, testerId: tester.user.id, listing: {} } }) : null;
  const invite = action === "cancel" ? await db.invite.create({ data: { testId, testerId: tester.user.id } }) : null;
  await settle();
  const loaded = seen();
  const snapshot = async (): Promise<Needs> => {
    const person = await db.user.findUniqueOrThrow({ where: { id: tester.user.id }, include: { profile: true } });
    return (await testerRowInfo(dev.user.id, needs, [person])).get(tester.user.id)!.seen;
  };
  const press = (shown: Needs, extra = {}) => act(testId, action === "accept" || action === "decline" ? "application" : action === "cancel" ? "cancel-invite" : "invite", dev.cookie, { action, applicationId: application?.id, inviteId: invite?.id, testerIds: [tester.user.id], seenAt: loaded, seenNeeds: needs, seenTesters: { [tester.user.id]: shown }, ...extra });
  const rate = async (stars: number[]) => {
    await db.rating.deleteMany({ where: { rateeId: tester.user.id } });
    for (const n of stars) await db.rating.create({ data: { testId, contractId: randomUUID(), side: "developer", raterId: dev.user.id, rateeId: tester.user.id, stars: n, revealedAt: new Date() } });
  };
  return { dev, tester, testId, snapshot, press, rate };
}
const lines = (result: Awaited<ReturnType<typeof act>>) => (result.body.error?.changes ?? []) as { text: string; key?: string }[];

describe("Task 5: stops compare the rows currently shown", () => {
  for (const action of ["invite", "cancel", "accept", "decline"] as const) {
    it(`${action}: adding the first needed language stops once, but a shown redraw goes through`, async () => {
      const s = await scenario(action, []);
      const shown = await s.snapshot();
      await settle();
      await db.testerProfile.update({ where: { userId: s.tester.user.id }, data: { languages: ["Spanish"] } });
      const stopped = await s.press(shown);
      expect(stopped.body.error.code).toBe("stop_once");
      expect(lines(stopped).map((c) => c.text)).toContain("Ana Silva now lists Spanish, which this test needs.");
      const redrawn = await s.snapshot();
      expect((await s.press(redrawn, { confirmed: true, boxAt: stopped.body.error.now })).status).toBe(200);
    });

    it(`${action}: a live redraw already shown is accepted on the first press`, async () => {
      const s = await scenario(action, []);
      await db.testerProfile.update({ where: { userId: s.tester.user.id }, data: { languages: ["Spanish"] } });
      expect((await s.press(await s.snapshot())).status).toBe(200);
    });

    it(`${action}: a second needed language and a bio save do not stop`, async () => {
      const s = await scenario(action);
      const shown = await s.snapshot();
      await db.testerProfile.update({ where: { userId: s.tester.user.id }, data: { languages: ["Russian", "Spanish"], bio: "A new bio" } });
      expect((await s.press(shown)).status).toBe(200);
    });

    it(`${action}: removing the last needed language stops with its name`, async () => {
      const s = await scenario(action);
      const shown = await s.snapshot();
      await db.testerProfile.update({ where: { userId: s.tester.user.id }, data: { languages: [] } });
      const result = await s.press(shown);
      expect(result.body.error.code).toBe("stop_once");
      expect(lines(result).map((c) => c.text)).toContain("Ana Silva no longer lists Russian, which this test needs.");
    });

    it(`${action}: one star stops, half a star does not`, async () => {
      const s = await scenario(action);
      await s.rate([5, 5, 5, 4, 4]); // 4.6 shown
      const shown = await s.snapshot();
      await s.rate([3, 4]); // 3.5, a 1.1-star move
      const stopped = await s.press(shown);
      expect(stopped.body.error.code).toBe("stop_once");
      expect(lines(stopped).map((c) => c.text)).toContain("Ana Silva's rating went from 4.6 to 3.5");
      await s.rate([4, 4, 4, 4, 4, 4, 4, 4, 4, 5]); // 4.1, a 0.5-star move
      expect((await s.press(shown)).status).toBe(200);
    });
  }

  it("Cancel invite combines needs and rating into one keyed line for the tester", async () => {
    const s = await scenario("cancel");
    await s.rate([5]);
    const shown = await s.snapshot();
    await s.rate([3]);
    await db.testerProfile.update({ where: { userId: s.tester.user.id }, data: { languages: [] } });
    const result = await s.press(shown);
    const own = lines(result).filter((c) => c.key === `needs:${s.tester.user.id}`);
    expect(own).toHaveLength(1);
    expect(own[0].text).toContain("no longer lists Russian");
    expect(own[0].text).toContain("rating went from 5.0 to 3.0");
  });

  it("rows name only missing kinds and show the public rating plus tests together", async () => {
    const s = await scenario("invite", []);
    const before = (await invitable(s.dev.user.id, s.testId)).find((r) => r.id === s.tester.user.id)!;
    expect(before.tag).toBe("Doesn't list languages");
    expect(before.detail).toBe("No ratings yet · 0 tests with you");
    await s.rate([5, 5, 5, 4, 4]);
    const after = (await invitable(s.dev.user.id, s.testId)).find((r) => r.id === s.tester.user.id)!;
    expect(after.detail).toBe("4.6 ★ (5 ratings) · 0 tests with you");
    expect(after.ratingAvg).toBe(4.6);
  });

  it("a rating on another test and a profile save both redraw this page's rows", async () => {
    const s = await scenario("invite");
    const initial = await testV(s.dev.user.id, s.testId);
    const other = await setup();
    await db.rating.create({ data: { testId: other.testId, contractId: randomUUID(), side: "developer", raterId: other.dev.user.id, rateeId: s.tester.user.id, stars: 3, revealedAt: new Date() } });
    const rated = await testV(s.dev.user.id, s.testId);
    expect(rated).not.toBe(initial);
    await settle();
    await db.testerProfile.update({ where: { userId: s.tester.user.id }, data: { bio: "Live profile" } });
    expect(await testV(s.dev.user.id, s.testId)).not.toBe(rated);
  });

  it("redraws open tester lines without erasing a fresh stop before the new row arrives", () => {
    const before = new Map([["ana", { devices: [], languages: ["Russian"], rating: 4.6 }]]);
    const change = [{ key: "needs:ana", kind: "profile", text: "Ana no longer lists Russian, which this test needs.", at: "2026-10-30T12:00:02Z" }];
    expect(redrawTesterChanges(change, before, [{ id: "ana", name: "Ana", seen: before.get("ana")!, changedAt: "2026-10-30T12:00:01Z" }], needs)).toBe(change);
    const redraw = redrawTesterChanges(change, before, [{ id: "ana", name: "Ana", seen: { devices: [], languages: [], rating: 3.5 }, changedAt: "2026-10-30T12:00:03Z" }], needs)!;
    expect(redraw).toHaveLength(1);
    expect(redraw[0].text).toContain("rating went from 4.6 to 3.5");
    expect(redrawTesterChanges(redraw, before, [{ id: "ana", name: "Ana", seen: { devices: [], languages: ["Spanish"], rating: 4.6 }, changedAt: "2026-10-30T12:00:04Z" }], needs)).toBeNull();
  });

  it("the live Invite anyway response carries the same fresh state for its rows and blue box", async () => {
    const s = await scenario("invite", []);
    await s.rate([4, 5]);
    await db.testerProfile.update({ where: { userId: s.tester.user.id }, data: { languages: ["Spanish"] } });
    const live = await inviteGaps(s.dev.user.id, s.testId, [s.tester.user.id]);
    expect(live.lines).toEqual([]);
    expect(live.testers[0]).toMatchObject({ id: s.tester.user.id, seen: { languages: ["Spanish"], rating: 4.5 }, tag: "", detail: "4.5 ★ (2 ratings) · 0 tests with you" });
  });

  it("kind flips, rather than needed-item substitutions, decide the lines", () => {
    expect(testerNeedsChangedLines("Ana", { devices: [], languages: ["Russian"] }, { devices: [], languages: ["Spanish"] }, needs)).toEqual([]);
    expect(ratingChangedLine("Ana", 4.6, 4.1)).toBe("");
    expect(ratingChangedLine("Ana", 4.6, 3.6)).toBe("Ana's rating went from 4.6 to 3.6");
  });
});
