import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { noDevMatchLine, searchByDeveloper, testStatusWord } from "@/lib/devSearch";
import { testerSearchRows } from "@/lib/server/testerSearch";
import { makeUser } from "./helpers";
import { act, setup } from "./fixtures";

// Batch 16 sections 13 and 14: the tester dashboard's "Search by developer"; the developer profile's open tests in the long-list rule.
const DAY = 86_400_000;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");

async function testBy(devName: string, title: string) {
  const { dev, testId } = await setup({ title });
  await db.user.update({ where: { id: dev.user.id }, data: { name: devName } });
  return { dev, testId };
}
async function join(testId: string, cookie: string) {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const r = await act(testId, "join", cookie, { listingVersion: t.listingVersion });
  expect(r.status).toBe(200);
  return r.body.sessionId as string;
}

describe("Search by developer (section 13)", () => {
  it("every test the tester has been in, any status: a partial and a different-case match, an old ended test, most recent first; the no-match line", async () => {
    const tester = await makeUser({ tester: true, name: "Ana Silva" });
    const nora = await testBy("Nora Lane", "Harbor Run");
    const norah = await testBy("Norah Quinn", "Sky Forge");
    const ben = await testBy("Ben Okafor", "Moss Maze");
    const gone = await testBy("Cara Diaz", "Old Mine");
    const sNora = await join(nora.testId, tester.cookie);
    const sNorah = await join(norah.testId, tester.cookie);
    const sBen = await join(ben.testId, tester.cookie);
    const sGone = await join(gone.testId, tester.cookie);
    // Nora's test was stopped long ago (an old ended test); Norah's is working; Ben's they left; Cara deleted their account.
    await db.contract.update({ where: { id: sNora }, data: { joinedAt: new Date(Date.now() - 200 * DAY), status: "ended", endKind: "stopped", endedAt: new Date(Date.now() - 190 * DAY) } });
    await db.contract.update({ where: { id: sBen }, data: { status: "left", endedAt: new Date() } });
    await db.user.update({ where: { id: gone.dev.user.id }, data: { deletedAt: new Date() } });

    const rows = await testerSearchRows(tester.user.id);
    expect(rows.map((r) => r.id).sort()).toEqual([sNora, sNorah, sBen, sGone].sort());
    // "nOrA" (different case, part of the name) finds Norah Quinn's working test first (joined later), then Nora Lane's old stopped one.
    const found = searchByDeveloper(rows, "  nOrA ");
    expect(found.map((r) => [r.developer, r.title, r.status])).toEqual([["Norah Quinn", "Sky Forge", "Working on it"], ["Nora Lane", "Harbor Run", "Stopped"]]);
    expect(searchByDeveloper(rows, "kaf").map((r) => [r.title, r.status])).toEqual([["Moss Maze", "You left"]]);
    // A deleted developer reads (and matches) "Deleted account".
    expect(searchByDeveloper(rows, "deleted").map((r) => r.title)).toEqual(["Old Mine"]);
    expect(searchByDeveloper(rows, "cara")).toEqual([]);
    // No match, and a blank box (the normal dashboard).
    expect(searchByDeveloper(rows, "zed")).toEqual([]);
    expect(noDevMatchLine(" Zed ")).toBe("No tests with a developer named “Zed”.");
    expect(searchByDeveloper(rows, "   ")).toEqual([]);
    expect(rows.every((r) => r.href === `/app/sessions/${r.id}`)).toBe(true);
    expect((await testerSearchRows(tester.user.id, false)).every((r) => r.href === null)).toBe(true); // a suspended tester side: no links
  });

  it("status words never say why a session ended", () => {
    expect(testStatusWord({ status: "working", endKind: "" })).toBe("Working on it");
    expect(testStatusWord({ status: "left", endKind: "rated" })).toBe("Finished");
    expect(testStatusWord({ status: "left", endKind: "" })).toBe("You left");
    expect(testStatusWord({ status: "ended", endKind: "closed" })).toBe("Closed");
    expect(testStatusWord({ status: "ended", endKind: "blocked" })).toBe("Ended");
    expect(testStatusWord({ status: "ended", endKind: "early" })).toBe("Ended");
  });

  it("the dashboard: the box at the top over ALL the tester's contracts, full width on phones; typing replaces the sections, clearing brings them back; results in the plain scroll box (section 14)", () => {
    const page = src("app/app/page.tsx");
    expect(page).toContain("<DevSearch rows={devSearchRows(contracts, !suspended)}>");
    expect(page.indexOf("<DevSearch")).toBeLessThan(page.indexOf('id="suspended-tests"'));
    expect(page.indexOf("</DevSearch>")).toBeGreaterThan(page.indexOf("History</h2>"));
    // The dashboard's contracts query is every contract of the tester (no take / no status filter).
    expect(page).toMatch(/const contracts = await db\.contract\.findMany\(\{\s*where: \{ testerId: userId \},\s*orderBy: \{ joinedAt: "desc" \},/);
    const box = src("app/app/DevSearch.tsx");
    expect(box).toContain('placeholder="Search by developer"');
    expect(box).toContain('className="flex w-full items-center gap-2 sm:max-w-sm"');
    expect(box).toContain("{!typed && children}");
    expect(box).toContain('<ScrollList className="space-y-2" label="Tests found">');
    expect(box).not.toContain("LongList");
  });
});

describe("developer profile: open tests in the plain scroll box (section 14, as revised)", () => {
  it("every open test, no Show N more", () => {
    const page = src("app/app/developers/[id]/page.tsx");
    expect(page).toContain('import { ScrollList } from "@/components/ScrollList";');
    expect(page).not.toContain("LongList");
    expect(page).toMatch(/<h2 className="font-semibold text-white">Open tests<\/h2>[\s\S]*<ScrollList className="space-y-2">[\s\S]*<\/ScrollList>/);
    expect(page).not.toMatch(/Open tests<\/h2>[\s\S]{0,400}<ul className="space-y-2">/);
  });
});
