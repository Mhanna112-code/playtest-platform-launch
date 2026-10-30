import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { runDaily } from "@/lib/server/holds";
import { developerStats, paysHint } from "@/lib/server/profileStats";
import { act, joined, seen, setup } from "./fixtures";
import { KINDS } from "@/lib/server/adminLists";
import { GET as moreGET } from "@/app/api/admin/more/route";
import { json, makeUser, req } from "./helpers";

// Batch 16 (owner, Oct 28): each tester's own deadline reminders, Find's "Most time to finish", the tester's Alerts line, "Pays on average" without the split.
const DAY = 86_400_000;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const deadlineBells = (userId: string) => db.notification.findMany({ where: { userId, text: { startsWith: "Your deadline on" } }, orderBy: { createdAt: "asc" } });

/** The daily job's decisions over a tester's whole window, run once a day (pure: Test.notifiedMarks kept in memory). */
function simulate(joinedAt: Date, dueAt: Date) {
  const recorded: string[] = [];
  const sent: string[] = [];
  for (let at = joinedAt.getTime() + 60_000; at < dueAt.getTime(); at += DAY) {
    const due = R.ownDeadlineMarkDue({ id: "c1", joinedAt, dueAt }, recorded, new Date(at));
    if (due.send) sent.push(due.send.mark);
    recorded.push(...due.record);
  }
  return sent;
}

describe("each tester is reminded before their own deadline (section 1)", () => {
  const joinedAt = new Date("2026-11-06T15:00:00Z");
  for (const [days, marks] of [[40, ["1m", "1w", "3d", "1d"]], [10, ["1w", "3d", "1d"]], [2, ["1d"]]] as const) {
    it(`a tester joining with ${days} days gets ${marks.join(", ")}`, () => {
      const dueAt = R.dueFromJoin(joinedAt, days);
      expect(R.deadlineMarksFor(joinedAt, dueAt).map((m) => m.mark)).toEqual(marks);
      expect(simulate(joinedAt, dueAt)).toEqual(marks);
    });
  }

  it("a deadline moved later: the marks still ahead of the new deadline fire again; those already behind it never do; never twice for one deadline", () => {
    const dueAt = R.dueFromJoin(joinedAt, 10);
    const recorded: string[] = [];
    const run = (at: Date, due = dueAt) => {
      const r = R.ownDeadlineMarkDue({ id: "c1", joinedAt, dueAt: due }, recorded, at);
      recorded.push(...r.record);
      return r.send?.mark ?? null;
    };
    expect(run(new Date(dueAt.getTime() - 7 * DAY + 60_000))).toBe("1w");
    expect(run(new Date(dueAt.getTime() - 7 * DAY + 120_000))).toBeNull(); // not twice
    // Open until moved 3 days later: the new 1-week mark (4 days before the old deadline) is still ahead and fires; the move itself sends nothing.
    const later = new Date(dueAt.getTime() + 3 * DAY);
    expect(run(new Date(dueAt.getTime() - 7 * DAY + 180_000), later)).toBeNull();
    expect(run(new Date(later.getTime() - 7 * DAY + 60_000), later)).toBe("1w");
    expect(run(new Date(later.getTime() - 7 * DAY + 120_000), later)).toBeNull();
    // Moved again, by a day, after the new 1-week mark passed: that mark is already behind the newest deadline, so it isn't sent late.
    const again = new Date(later.getTime() + DAY);
    expect(run(new Date(later.getTime() - 5 * DAY), again)).toBeNull();
    expect(run(new Date(again.getTime() - 3 * DAY + 60_000), again)).toBe("3d");
    expect(run(new Date(again.getTime() - DAY + 60_000), again)).toBe("1d");
    expect(run(new Date(again.getTime() - 60_000), again)).toBeNull();
    // The test's own Open until marks ("1w", bare) are never read as a tester's.
    expect(R.ownDeadlineMarkDue({ id: "c2", joinedAt, dueAt }, ["1w", "3d"], new Date(dueAt.getTime() - 7 * DAY + 60_000)).send?.mark).toBe("1w");
  });

  it("(fake clock) the daily job: a tester with 10 days gets 1 week, 3 days and 1 day before THEIR deadline, linked to their session; Edit moving Open until later sends the marks still ahead again", async () => {
    const { dev, testId } = await setup({ openUntil: new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10) });
    const a = await joined(testId, "Ana Silva");
    const c = await db.contract.findUniqueOrThrow({ where: { id: a.sessionId } });
    const D = c.dueAt.getTime();
    expect(R.deadlineMarksFor(c.joinedAt, c.dueAt).map((m) => m.mark)).toEqual(["1w", "3d", "1d"]);
    await runDaily(new Date(D - 7 * DAY + 60_000));
    let bells = await deadlineBells(a.tester.user.id);
    expect(bells.length).toBe(1);
    expect(bells[0].text).toMatch(/^Your deadline on “Harbor Run” is [A-Z][a-z]{2} \d{1,2}: send your work before then\.$/);
    expect(bells[0].link).toBe(`/app/sessions/${a.sessionId}`);
    await runDaily(new Date(D - 7 * DAY + 120_000));
    expect((await deadlineBells(a.tester.user.id)).length).toBe(1); // never twice
    // Edit: Open until 5 days later moves Ana's deadline 5 days.
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { openUntil: new Date(Date.now() + 15 * DAY).toISOString().slice(0, 10) }, seenAt: seen(), confirmed: true })).status).toBe(200);
    const D2 = (await db.contract.findUniqueOrThrow({ where: { id: a.sessionId } })).dueAt.getTime();
    expect(D2 - D).toBe(5 * DAY);
    for (const at of [D - 7 * DAY + 180_000, D2 - 7 * DAY + 60_000, D2 - 7 * DAY + 120_000, D2 - 3 * DAY + 60_000, D2 - DAY + 60_000, D2 + 60_000]) await runDaily(new Date(at));
    bells = await deadlineBells(a.tester.user.id);
    expect(bells.length).toBe(4); // the first 1-week mark, then 1 week, 3 days and 1 day before the new deadline
    expect(new Set(bells.slice(1).map((b) => b.text)).size).toBe(1);
    expect(bells[1].text).not.toBe(bells[0].text); // the new date
  }, 120_000);

  it("(fake clock) a later joiner is reminded too; nothing while the test is paused, then the mark due now once it resumes", async () => {
    const { testId } = await setup({ openUntil: new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10) });
    const b = await joined(testId, "Ben Okafor");
    // Ben joined 8 days after the test opened: his deadline is 10 days after that, well past Open until.
    const joinedAt = new Date(Date.now() + 8 * DAY);
    const dueAt = R.dueFromJoin(joinedAt, 10);
    await db.contract.update({ where: { id: b.sessionId }, data: { joinedAt, dueAt } });
    await db.test.update({ where: { id: testId }, data: { adminPausedAt: new Date(dueAt.getTime() - 4 * DAY) } }); // paused a day before (not long enough to close it)
    await runDaily(new Date(dueAt.getTime() - 3 * DAY + 60_000));
    expect((await deadlineBells(b.tester.user.id)).length).toBe(0); // the reminders wait
    await db.test.update({ where: { id: testId }, data: { adminPausedAt: null } });
    await runDaily(new Date(dueAt.getTime() - 3 * DAY + 120_000));
    expect((await deadlineBells(b.tester.user.id)).length).toBe(1); // 3 days before (the missed 1-week mark isn't sent late)
    // A tester who left gets nothing more.
    await db.contract.update({ where: { id: b.sessionId }, data: { status: "left" } });
    await runDaily(new Date(dueAt.getTime() - DAY + 60_000));
    expect((await deadlineBells(b.tester.user.id)).length).toBe(1);
  }, 60_000);
});

describe("Find: Most time to finish sorts by days per tester (section 3)", () => {
  it("most days first; ties: the later Open until first; tests without Open until last", () => {
    const at = (d: string) => new Date(`${d}T23:59:59Z`);
    const tests = [
      { id: "none", testerDays: null, createdAt: at("2026-11-01"), openUntil: null },
      { id: "short-late", testerDays: 5, createdAt: at("2026-11-20"), openUntil: at("2026-11-25") },
      { id: "long", testerDays: 20, createdAt: at("2026-11-01"), openUntil: at("2026-11-21") },
      { id: "tie-early", testerDays: 10, createdAt: at("2026-11-01"), openUntil: at("2026-11-11") },
      { id: "tie-late", testerDays: null, createdAt: at("2026-11-05"), openUntil: at("2026-11-15") }, // an older test: Open until − opened = 10
    ];
    expect([...tests].sort(R.byMostTimeToFinish).map((t) => t.id)).toEqual(["long", "tie-late", "tie-early", "short-late", "none"]);
    const page = src("app/app/find/page.tsx");
    expect(page).toContain('else if (sp.sort === "deadline") shown.sort(byMostTimeToFinish);');
    expect(page).toContain('<option value="deadline">Most time to finish</option>');
  });
});

describe("the tester's Alerts line (section 4)", () => {
  it("one grey line for the state shown; every tester stop kind in the code is in the On list", () => {
    const toggle = src("components/TesterAlertsToggle.tsx");
    expect(toggle).toContain('export const ALERTS_ON_LINE = "Stops a press once for: new terms, your key, pay, calls, delayed pay, your dispute, listing changes, other tabs.";');
    expect(toggle).toContain('export const ALERTS_OFF_LINE = "Stops a press only for: new terms, your key marked as working.";');
    expect(toggle).toContain("max-w-xs");
    expect(toggle).toContain("text-right max-sm:items-start max-sm:text-left");
    // The kinds the tester gate stops for, and the words in the line that cover them.
    const gate = src("lib/server/testerGate.ts");
    const kinds = JSON.parse(gate.match(/const KINDS = (\[[^\]]*\]);/)![1]) as string[];
    const words: Record<string, string> = { terms: "new terms", keyfixed: "your key", keygiven: "your key", paid: "pay", rejected: "pay", cancelled: "calls", booked: "calls", requested: "calls", payment: "delayed pay", admin: "your dispute", dispute: "your dispute", info: "listing changes", own: "other tabs" };
    expect(gate).toContain('[...KINDS, "renamed", "keyfixed", "keygiven"]'); // renames never stop (withRenamed); (batch 30 §17) a key given by the developer's Save
    for (const k of [...kinds, "keyfixed", "keygiven"]) expect(words[k], k).toBeDefined();
    expect(gate).toContain('export const CONTRACT_KINDS = new Set(["terms", "keyfixed"]);'); // what Off still stops for
  });
});

describe("Pays on average without the split (section 5)", () => {
  it("the hint counts the pieces; one piece; no paid work yet", async () => {
    expect(paysHint(4)).toBe("of the listing, over 4 pieces of work");
    expect(paysHint(1)).toBe("of the listing, over 1 piece of work");
    expect(paysHint(0)).toBe("no paid work yet");
    const { dev } = await setup();
    expect((await developerStats(dev.user.id)).pays).toEqual({ value: "-", hint: "no paid work yet" });
    expect(src("lib/server/profileStats.ts")).not.toContain("accepted in full");
    expect(src("app/app/find/[id]/page.tsx")).toContain('devStats.pays.value === "-" ? <span className="text-slate-500">{devStats.pays.hint}</span>');
  });
});

describe("clean-up (section 6)", () => {
  it("checkReject is gone; the unreachable suspended line on the developer's test page is gone", () => {
    expect("checkReject" in R).toBe(false);
    expect(src("app/app/tests/[id]/page.tsx")).not.toContain("you can only cancel booked calls here");
  });
});

describe("no waitlist (section 7)", () => {
  it("the home page has no email box; /api/waitlist and everything behind it are gone; the admin console has no Waitlist section", async () => {
    const home = src("app/page.tsx");
    expect(home).not.toMatch(/WaitlistForm|type="email"|<input/);
    expect(home).toContain('href="/signup"');
    for (const f of ["app/api/waitlist/route.ts", "components/WaitlistForm.tsx", "lib/server/waitlist.ts"]) expect(existsSync(path.resolve(__dirname, "../src", f)), f).toBe(false);
    expect(src("app/admin/page.tsx")).not.toMatch(/waitlist/i);
    expect(src("app/admin/PagedList.tsx")).not.toMatch(/waitlist/i);
    expect(src("app/privacy/page.tsx")).not.toMatch(/waitlist/i);
    expect(KINDS as string[]).not.toContain("waitlist");
    expect("waitlistEntry" in db).toBe(false);
    expect(readFileSync(path.resolve(__dirname, "../prisma/schema.prisma"), "utf8")).not.toContain("model WaitlistEntry");
    // An admin asking for the old list is refused like any unknown list.
    const a = await makeUser({ email: `admin-${Math.random().toString(36).slice(2)}@playtest.test` });
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    expect((await json(await moreGET(req("/api/admin/more?kind=waitlist", { cookie: a.cookie })))).status).toBe(400);
  });
});
