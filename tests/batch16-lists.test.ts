import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { profileOpenTests } from "@/lib/server/profileOpenTests";
import { makeUser } from "./helpers";
import { joined, setup } from "./fixtures";

// Batch 16 section 14 (owner, Oct 28, revised): every list panel on both dashboards and the developer profile's "Open tests" is a plain scroll box.
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");

describe("plain scroll boxes on the dashboards and the developer profile (section 14)", () => {
  it("no LongList (no Show N more) on these pages; every list panel uses ScrollList; the developer's test cards scroll in the cards box", () => {
    for (const f of ["app/app/page.tsx", "app/app/CallsBox.tsx", "app/app/DevSearch.tsx", "app/app/developers/[id]/page.tsx", "components/TesterTests.tsx"]) {
      const s = src(f);
      expect(s, f).not.toContain("LongList");
      expect(s, f).toContain("<ScrollList");
    }
    const page = src("app/app/page.tsx");
    // The developer dashboard: disputes, excerpt requests, Needs review, Needs you, Your tests; the tester dashboard: removed, Charge or cancel, To do,
    // waiting, upcoming calls, invitations, Tests you left, History.
    expect((page.match(/<ScrollList/g) ?? []).length).toBeGreaterThanOrEqual(12) // (batch 35 §96) Needs review joined Needs you;
    expect(page).toContain('<ScrollList size="cards" className="grid gap-4 md:grid-cols-2">');
    expect(page).not.toMatch(/max-h-\[30rem\] overflow-y-auto|data-needs-list/);
    // The chips stay above the box (outside it).
    expect(page.indexOf("<CategoryChips basePath=\"/app\"")).toBeLessThan(page.indexOf('<ScrollList size="cards"'));
    const box = src("components/ScrollList.tsx");
    expect(box).toContain("overflow-y-auto");
    expect(box).toContain('rows: "max-h-[22rem]"');
    expect(box).toContain('cards: "max-h-[54rem] md:max-h-[38rem]"');
    expect(box).not.toContain("<button"); // no Show N more
    // Blue boxes keep the 3-lines rule.
    for (const f of ["components/LiveNotices.tsx", "components/LiveTop.tsx", "components/ChangesBox.tsx", "components/RestrictedBox.tsx"]) expect(src(f), f).toContain("LongList");
  });
});

describe("developer profile Open tests: invite-only tests only for people involved (section 14)", () => {
  it("a tester not invited doesn't see an invite-only test; invited, applied or in it they do; the developer and the team see it", async () => {
    const pub = await setup({ spots: 5 });
    const dev = pub.dev;
    const priv = await setup({ spots: 5 });
    await db.test.update({ where: { id: priv.testId }, data: { developerId: dev.user.id, joinMode: "invite" } });
    const devRow = await db.user.findUniqueOrThrow({ where: { id: dev.user.id } });
    const ids = async (viewer: { id: string }, all = false) => (await profileOpenTests(devRow, viewer, all)).map((t) => t.id).sort();
    const both = [pub.testId, priv.testId].sort();

    const stranger = await makeUser({ tester: true });
    expect(await ids(stranger.user)).toEqual([pub.testId]);
    const invited = await makeUser({ tester: true });
    await db.invite.create({ data: { testId: priv.testId, testerId: invited.user.id } });
    expect(await ids(invited.user)).toEqual(both);
    const applied = await makeUser({ tester: true });
    await db.application.create({ data: { testId: priv.testId, testerId: applied.user.id, listing: {} } });
    expect(await ids(applied.user)).toEqual(both);
    // In the test (joined while it was still open to anyone).
    await db.test.update({ where: { id: priv.testId }, data: { joinMode: "anyone" } });
    const inIt = await joined(priv.testId, "Cam Reed");
    await db.test.update({ where: { id: priv.testId }, data: { joinMode: "invite" } });
    expect(await ids(inIt.tester.user)).toEqual(both);
    // The developer themself and an admin.
    expect(await ids({ id: dev.user.id })).toEqual(both);
    expect(await ids(stranger.user, true)).toEqual(both);
  });
});
