import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { bellStacks, stackHeading } from "@/lib/bell";
import { emailLines } from "@/lib/server/notify";
import { POST as invitePOST } from "@/app/api/invites/[id]/route";
import { act, joined, sact, seen, settle, setup } from "./fixtures";
import { json, makeUser, req } from "./helpers";

// (Owner, Nov 6, §308) The developer's join-related bell lines:
// - "<tester> applied to join" and "<tester> asks to rejoin": one entry a day across tests, "Applications · N" (group "applications");
// - "<tester> withdrew her application": one entry a day across tests, "Applications withdrawn · N" (group "appwithdrawn");
// - "joined" / "joined again", "left" and "said no thanks to your invite": plain per-test lines, the test's own "Harbor Run · N updates".
// The email stacks the same way (§298).

type Line = { id: string; text: string; link: string; testId: string | null; own: boolean; groupKey: string | null; createdAt: Date };
const devLines = (userId: string): Promise<Line[]> =>
  db.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { id: true, text: true, link: true, testId: true, own: true, groupKey: true, createdAt: true } });
const lv = async (testId: string) => (await db.test.findUniqueOrThrow({ where: { id: testId } })).listingVersion;
/** Each stack as the bell writes it: a stack of 2+ lines by its heading, a single line as itself. */
const shown = (lines: Line[], titles: Map<string, string>) => bellStacks(lines, "UTC", (id) => titles.get(id)).map((s) => (s.lines.length > 1 ? stackHeading(s) : s.lines[0].text));

/** Two tests of one developer ("Harbor Run", "Night Shift"), both taking applications. */
async function twoTests() {
  const a = await setup({ title: "Harbor Run", productName: "Harbor Run", joinMode: "apply" });
  const b = await setup({ title: "Night Shift", productName: "Night Shift", joinMode: "apply" });
  await db.test.update({ where: { id: b.testId }, data: { developerId: a.dev.user.id } });
  return { dev: a.dev, harbor: a.testId, night: b.testId, titles: new Map([[a.testId, "Harbor Run"], [b.testId, "Night Shift"]]) };
}
const apply = async (testId: string, cookie: string) => {
  expect((await act(testId, "apply", cookie, { note: "hi" })).body).toEqual({ applied: true });
  await settle();
};
/** A tester who joined (on an "anyone" test), left, and asks to rejoin. */
async function asksToRejoin(testId: string, name: string) {
  await db.test.update({ where: { id: testId }, data: { joinMode: "anyone" } });
  const t = await joined(testId, name, "she");
  await db.test.update({ where: { id: testId }, data: { joinMode: "apply" } });
  expect((await sact(t.sessionId, "leave", t.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
  await settle();
  expect((await act(testId, "rejoin-ask", t.tester.cookie, { listingVersion: await lv(testId), seenAt: seen(), confirmed: true, anyway: true })).status).toBe(200);
  await settle();
}

describe("§308 the developer's join-related lines", () => {
  it("applied to join and asks to rejoin on two tests: one \"Applications · 3\" entry", async () => {
    const f = await twoTests();
    await apply(f.harbor, (await makeUser({ tester: true, name: "Ben Cole", pronoun: "he" })).cookie);
    await apply(f.night, (await makeUser({ tester: true, name: "Dan Ruiz", pronoun: "he" })).cookie);
    await asksToRejoin(f.night, "Ana Silva");
    const apps = (await devLines(f.dev.user.id)).filter((n) => n.groupKey === "applications");
    expect(apps.map((n) => [n.text, n.testId])).toEqual([
      ["Ben Cole applied to join “Harbor Run”", f.harbor],
      ["Dan Ruiz applied to join “Night Shift”", f.night],
      ["Ana Silva asks to rejoin “Night Shift”", f.night],
    ]);
    expect(shown(apps, f.titles)).toEqual(["Applications · 3"]);
    expect(emailLines(apps, (n) => n.text, "UTC", f.titles)[0]).toBe("• Applications · 3");
  });

  it("withdrawn applications on two tests: one \"Applications withdrawn · 2\" entry", async () => {
    const f = await twoTests();
    for (const [testId, name] of [[f.harbor, "Ben Cole"], [f.night, "Dan Ruiz"]]) {
      const u = await makeUser({ tester: true, name, pronoun: "he" });
      await apply(testId, u.cookie);
      expect((await act(testId, "withdraw-application", u.cookie, {})).body).toEqual({ withdrawn: true });
      await settle();
    }
    const gone = (await devLines(f.dev.user.id)).filter((n) => n.groupKey === "appwithdrawn");
    expect(gone.map((n) => [n.text, n.testId])).toEqual([
      ["Ben Cole withdrew his application to “Harbor Run”", f.harbor],
      ["Dan Ruiz withdrew his application to “Night Shift”", f.night],
    ]);
    expect(shown(gone, f.titles)).toEqual(["Applications withdrawn · 2"]);
    expect(emailLines(gone, (n) => n.text, "UTC", f.titles)[0]).toBe("• Applications withdrawn · 2");
  });

  it("joined, left and no thanks stay in each test's own stack: two tests, two entries", async () => {
    const f = await twoTests();
    await db.test.updateMany({ where: { id: { in: [f.harbor, f.night] } }, data: { joinMode: "anyone" } });
    for (const [testId, name] of [[f.harbor, "Ana Silva"], [f.night, "Cara Diaz"]]) {
      const t = await joined(testId, name, "she");
      expect((await sact(t.sessionId, "leave", t.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
      await settle();
    }
    const eve = await makeUser({ tester: true, name: "Eve Park", pronoun: "she" });
    expect((await act(f.harbor, "invite", f.dev.cookie, { testerIds: [eve.user.id], seenAt: seen(), confirmed: true })).status).toBe(200);
    const inv = await db.invite.findFirstOrThrow({ where: { testId: f.harbor, testerId: eve.user.id, status: "sent" } });
    expect((await json(await invitePOST(req(`/api/invites/${inv.id}`, { cookie: eve.cookie, body: {} }), { params: Promise.resolve({ id: inv.id }) }))).status).toBe(200);
    await settle();
    const lines = await devLines(f.dev.user.id);
    expect(lines.map((n) => n.text)).toEqual([
      "Ana Silva joined “Harbor Run”",
      "Ana Silva left “Harbor Run”",
      "Cara Diaz joined “Night Shift”",
      "Cara Diaz left “Night Shift”",
      "Eve Park said no thanks to your invite",
    ]);
    for (const n of lines) expect(n).toMatchObject({ own: false, groupKey: null });
    expect(shown(lines, f.titles)).toEqual(["Harbor Run · 3 updates", "Night Shift · 2 updates"]);
    expect(emailLines(lines, (n) => n.text, "UTC", f.titles).filter((l) => l.startsWith("•"))).toEqual(["• Harbor Run · 3 updates", "• Night Shift · 2 updates"]);
  });
});
