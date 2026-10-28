import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { filterTesterTests, noTestsWithLine, testIsRunning, testerStateWord } from "@/lib/testerTests";
import { testerTestsFor } from "@/lib/server/testerTests";
import { joined, setup } from "./fixtures";

// Batch 16 section 15 (owner, Oct 28, clarified): a tester's profile, seen by a developer: "Your tests with <name>", only that developer's own tests.
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const DAY = 86_400_000;

describe("a tester's profile: your tests with them (section 15)", () => {
  it("mixed open and closed, most recent first, both filters, each row opens the developer's test page; another developer's tests never appear", async () => {
    const a = await setup({ spots: 5 });
    const dev = a.dev;
    const ana = await joined(a.testId, "Ana Silva");
    const tid = ana.tester.user.id;
    await db.contract.update({ where: { id: ana.sessionId }, data: { joinedAt: new Date(Date.now() - 5 * DAY) } });
    const base = await db.contract.findUniqueOrThrow({ where: { id: ana.sessionId } });
    const copy = (testId: string, daysAgo: number, extra: Record<string, unknown> = {}) =>
      db.contract.create({ data: { ...base, id: undefined, testId, joinedAt: new Date(Date.now() - daysAgo * DAY), prevSets: [], questions: [], ...extra } as never });
    // A second test of this developer, stopped, which Ana left; a third, still running, that's invite-only with an NDA (theirs: it shows).
    const stopped = await setup({ spots: 5 });
    await db.test.update({ where: { id: stopped.testId }, data: { developerId: dev.user.id, status: "stopped" } });
    const s = await copy(stopped.testId, 10, { status: "left", endKind: "" });
    const priv = await setup({ spots: 5 });
    await db.test.update({ where: { id: priv.testId }, data: { developerId: dev.user.id, joinMode: "invite", ndaText: "Keep it secret." } });
    const p = await copy(priv.testId, 1);
    // Another developer's tests Ana joined, public and private: never in this developer's list.
    const other = await setup({ spots: 5 });
    await copy(other.testId, 2);
    const otherPriv = await setup({ spots: 5 });
    await db.test.update({ where: { id: otherPriv.testId }, data: { joinMode: "invite" } });
    await copy(otherPriv.testId, 3);

    const rows = await testerTestsFor(tid, dev.user.id);
    expect(rows.map((r) => r.id)).toEqual([p.id, ana.sessionId, s.id]);
    expect(rows.map((r) => r.open)).toEqual([true, true, false]);
    expect(rows.map((r) => r.state)).toEqual(["Working", "Working", "Left"]);
    expect(rows.map((r) => r.href)).toEqual([`/app/tests/${priv.testId}`, `/app/tests/${a.testId}`, `/app/tests/${stopped.testId}`]);
    // The ticks: both = all; only Open; only Closed; neither = all.
    expect(filterTesterTests(rows, true, true)).toHaveLength(3);
    expect(filterTesterTests(rows, true, false).map((r) => r.id)).toEqual([p.id, ana.sessionId]);
    expect(filterTesterTests(rows, false, true).map((r) => r.id)).toEqual([s.id]);
    expect(filterTesterTests(rows, false, false)).toHaveLength(3);
    // The other developer sees only theirs; a developer Ana was never with sees none.
    expect(await testerTestsFor(tid, other.dev.user.id)).toHaveLength(1);
    const stranger = await setup({ spots: 1 });
    expect(await testerTestsFor(tid, stranger.dev.user.id)).toEqual([]);
    expect(noTestsWithLine("Ana Silva")).toBe("Ana Silva hasn't been in any of your tests yet.");
  });

  it("states never say why; running means taking testers or joining closed with testers still working", () => {
    expect(testerStateWord({ status: "working", endKind: "" })).toBe("Working");
    expect(testerStateWord({ status: "left", endKind: "rated" })).toBe("Finished");
    expect(testerStateWord({ status: "left", endKind: "" })).toBe("Left");
    for (const k of ["blocked", "suspended", "early", "stopped", "closed"]) expect(testerStateWord({ status: "ended", endKind: k })).toBe("Ended");
    const now = new Date();
    const past = new Date(now.getTime() - DAY), later = new Date(now.getTime() + DAY);
    expect(testIsRunning({ status: "open", openUntil: later, contracts: [] }, now)).toBe(true);
    expect(testIsRunning({ status: "open", openUntil: past, contracts: [{ status: "working", dueAt: later }] }, now)).toBe(true);
    expect(testIsRunning({ status: "open", openUntil: past, contracts: [{ status: "working", dueAt: past }, { status: "left", dueAt: later }] }, now)).toBe(false);
    expect(testIsRunning({ status: "stopped", openUntil: later, contracts: [] }, now)).toBe(false);
    expect(testIsRunning({ status: "closed", openUntil: later, contracts: [] }, now)).toBe(false);
  });

  it("the page: only for a developer viewing someone else's profile (not the tester's own view, not an admin view), after the block check; ticks wrap above the box", () => {
    const page = src("app/app/testers/[id]/page.tsx");
    expect(page).toContain("{viewer.isDeveloper && !mine && !isAdmin(viewer) && <TesterTests name={name} rows={await testerTestsFor(p.id, viewer.id)} />}");
    expect(page.indexOf("db.block.count")).toBeGreaterThan(0);
    expect(page.indexOf("db.block.count")).toBeLessThan(page.indexOf("<TesterTests"));
    const box = src("components/TesterTests.tsx");
    expect(box).toContain("Your tests with {name}");
    expect(box).toContain("{noTestsWithLine(name)}");
    expect(box).toContain('className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"');
    expect(box).toContain("<ScrollList");
    expect(box).toContain("Joined {fmtDate(new Date(r.joinedAt))}");
    expect(box).not.toMatch(/With you|r\.developer/);
    // Only this developer's own tests are read.
    expect(src("lib/server/testerTests.ts")).toContain("where: { testerId, test: { developerId } }");
  });
});
