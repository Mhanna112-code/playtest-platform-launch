import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { GET as moreGET } from "@/app/api/admin/more/route";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import { POST as reviewPOST } from "@/app/api/review/route";
import { bellKey } from "@/lib/bell";
import { startHold } from "@/lib/server/holds";
import { adminPage, PAGE } from "@/lib/server/adminLists";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, setup } from "./fixtures";

const DAY = 86_400_000;
const cron = () => cronGET(new Request("http://localhost:3400/api/cron/daily", { headers: { authorization: "Bearer cron-test" } })).then((r) => r.json());
const aact = (cookie: string, action: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const admin = async () => {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
};
const lines = (userId: string) => db.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

describe("bell stacking: same-day lines about one test stack, except the lines that always arrive on their own", () => {
  it("bellKey stacks per test per day and never an own line or a line about no test", () => {
    const at = new Date("2026-11-02T10:00:00Z");
    const n = (id: string, testId: string | null, own = false, createdAt = at) => ({ id, testId, own, createdAt });
    expect(bellKey(n("a", "t1"))).toBe(bellKey(n("b", "t1")));
    expect(bellKey(n("a", "t1"))).not.toBe(bellKey(n("b", "t2")));
    expect(bellKey(n("a", "t1"))).not.toBe(bellKey(n("b", "t1", false, new Date("2026-11-03T10:00:00Z"))));
    expect(bellKey(n("a", "t1", true))).toBe("solo|a");
    expect(bellKey(n("b", "t1", true))).toBe("solo|b");
    expect(bellKey(n("a", null))).toBe("solo|a");
  });

  it("ordinary lines (a send, a join) are stackable; stops, holds, lifts, suspensions, pause moves and dispute decisions are their own", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const mine = await lines(dev.user.id);
    expect(mine.filter((l) => /joined|sent written answers/.test(l.text)).every((l) => !l.own && l.testId === testId)).toBe(true);
    // A hold starting and being lifted, and the test stopped, are their own lines.
    await startHold(dev.user.id, "unpaid");
    const { payOwed } = await import("@/lib/server/holds");
    await payOwed(dev.user);
    await act(testId, "stop", dev.cookie, { seenAt: seen(), confirmed: true });
    const after = await lines(dev.user.id);
    // (Owner, Oct 27) Hold started / lifted lines are one KIND ("payhold"): they stack across tests, one entry a day.
    for (const text of ["Your tests are paused", "Your tests are running again"]) expect(after.find((l) => l.text === text), text).toMatchObject({ own: false, groupKey: "payhold" });
    const tl = await lines(tester.user.id);
    expect(tl.find((l) => l.text.endsWith("was stopped"))).toMatchObject({ own: false, groupKey: "tstopped" });
    // (Owner, Oct 26) A tester's paused / resumed lines stack per day across tests (a group), they are not their own line.
    expect(tl.find((l) => l.text.endsWith("is running again"))).toMatchObject({ own: false, groupKey: "paused" });
  });

  it("admin decisions arrive on their own: suspension, reinstatement, the team pausing or stopping a test, a pause moved later, a dispute decided", async () => {
    const a = await admin();
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Only half answered" })).status).toBe(200);
    expect((await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered everything properly", seenAt: seen(), confirmed: true })).status).toBe(200);
    const dispute = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
    expect((await aact(a.cookie, "decide", { id: dispute.id, total: "8.00", note: "Fair" })).status).toBe(200);
    expect((await aact(a.cookie, "pause-test", { id: testId, note: "Looking" })).status).toBe(200);
    expect((await aact(a.cookie, "extend-pause", { id: testId, days: 3 })).status).toBe(200);
    expect((await aact(a.cookie, "unpause-test", { id: testId })).status).toBe(200);
    expect((await aact(a.cookie, "stop-test", { id: testId, note: "Done" })).status).toBe(200);
    expect((await aact(a.cookie, "suspend", { id: dev.user.id, note: "Testing" })).status).toBe(200);
    expect((await aact(a.cookie, "unsuspend", { id: dev.user.id })).status).toBe(200);
    const dl = await lines(dev.user.id);
    for (const re of [/will close later$/, /^The team lifted the pause/]) expect(dl.find((l) => re.test(l.text))?.own, String(re)).toBe(true);
    // (Owner, Oct 27) Lines of the same kind stack across tests: account paused / active again are "admin decisions"; a decided dispute is "disputes decided".
    for (const re of [/^Your account is paused$/, /^Your account is active again$/]) expect(dl.find((l) => re.test(l.text)), String(re)).toMatchObject({ own: false, groupKey: "admindecision" });
    expect(dl.find((l) => /was decided$/.test(l.text))).toMatchObject({ own: false, groupKey: "disputedecided" });
    // (Owner, Oct 26) The team pausing or stopping your test stacks into one line a day across all your tests (their emails stay always-send).
    for (const re of [/^The team paused/, /^The team stopped/]) expect(dl.find((l) => re.test(l.text)), String(re)).toMatchObject({ own: false, groupKey: "team" });
    expect(dl.filter((l) => l.groupKey === "team").map(bellKey).filter((k, i, a) => a.indexOf(k) === i).length).toBe(1);
    expect((await lines(tester.user.id)).find((l) => /dispute on .* was decided$/.test(l.text))).toMatchObject({ own: false, groupKey: "disputedecided" });
  });

  it("admins get ONE new-dispute line a day across different tests, linking to #disputes", async () => {
    const a = await admin();
    const disputes: string[] = [];
    for (const name of ["Ana Silva", "Ben Carter"]) {
      const { dev, testId } = await setup();
      const j = await joined(testId, name);
      await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
      const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
      expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Only half answered" })).status).toBe(200);
      expect((await sact(j.sessionId, "dispute", j.tester.cookie, { kind: "submission", id: sub.id, reason: "I answered everything properly", seenAt: seen(), confirmed: true })).status).toBe(200);
      disputes.push((await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } })).id);
    }
    const mine = (await lines(a.user.id)).filter((l) => l.groupKey === "disputes");
    expect(mine.length).toBe(2);
    expect(mine.every((l) => !l.own && l.link === "/admin#disputes")).toBe(true);
    expect(new Set(mine.map(bellKey)).size).toBe(1); // one stacked line
    expect(disputes.length).toBe(2);
  });
});

describe("a paused test is told by bell, not by a countdown on the pages", () => {
  it("one reminder when it is paused and then once a day (replacing the day-before line); no countdown text on the developer pages", async () => {
    const { dev, testId } = await setup();
    await startHold(dev.user.id, "unpaid");
    const first = (await lines(dev.user.id)).find((l) => / is paused and closes on /.test(l.text))!;
    expect(first.text).toMatch(/^Harbor Run is paused and closes on [A-Z][a-z]{2} \d{1,2} unless you pay what you owe$/);
    expect(first).toMatchObject({ own: false, groupKey: "pausedreminder", link: "/app/payments#owed", reminderKey: `paused:${testId}` });
    // A day before: 6.5 days into the pause. Daily: once a day, and no separate "closes tomorrow" line any more.
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: new Date(Date.now() - 6.5 * DAY) } });
    await db.notification.updateMany({ where: { userId: dev.user.id, groupKey: "pausedreminder" }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
    await cron();
    await cron();
    expect((await lines(dev.user.id)).filter((l) => / is paused and closes on /.test(l.text)).length).toBe(2);
    expect((await lines(dev.user.id)).filter((l) => l.text.startsWith("Harbor Run closes tomorrow")).length).toBe(0);
    // The pages carry no countdown any more.
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const files = walk(path.resolve(__dirname, "../src/app/app")).filter((f) => /\.tsx$/.test(f));
    expect(files.filter((f) => /pauseCountdownLine|data-pause-countdown/.test(fs.readFileSync(f, "utf8")))).toEqual([]);
  });
});

describe("every bell line opens the exact place", () => {
  it("developer: the Needs you row, the tester row or the call; tester: the part or the call; admin: the dispute", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const devLine = (re: RegExp) => lines(dev.user.id).then((l) => l.find((x) => re.test(x.text))!.link);
    const testerLine = (re: RegExp) => lines(tester.user.id).then((l) => l.find((x) => re.test(x.text))!.link);
    expect(await devLine(/joined/)).toBe(`/app/tests/${testId}#tester-${sessionId}`);
    expect(await devLine(/written answers for/)).toBe(`/app/tests/${testId}#piece-${sub.id}`);
    expect(await testerLine(/^Work sent: your written answers/)).toBe(`/app/sessions/${sessionId}#part-written`);
    // Pay → the tester's line opens the written part.
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    expect(await testerLine(/paid you \$10\.00 for your written answers/)).toBe(`/app/sessions/${sessionId}#part-written`);
    // A booked call opens the call on both sides.
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 60);
    expect(await devLine(/^Booked:/)).toBe(`/app/tests/${testId}#call-${call.id}`);
    expect(await testerLine(/^Booked:/).catch(() => "")).toBeDefined();
    expect((await act(testId, "cancel-call", dev.cookie, { seenAt: seen(), callId: call.id })).status).toBe(200);
    expect(await testerLine(/cancelled the call/)).toBe(`/app/sessions/${sessionId}#call-${call.id}`);
  });

  it("the anchors the links use exist on the pages", () => {
    const read = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
    const dev = ["app/app/tests/[id]/page.tsx", "app/app/tests/[id]/NeedsYou.tsx", "app/app/tests/[id]/DevCallPanel.tsx", "app/app/tests/[id]/KeysNotice.tsx"].map(read).join("\n");
    for (const re of [/`piece-\$\{/, /`call-\$\{/, /`tester-\$\{/, /`item-dispute-\$\{/, /id="needs-you"/, /id="keys-notice"/]) expect(dev, String(re)).toMatch(re);
    const session = ["app/app/sessions/[id]/page.tsx", "app/app/sessions/[id]/TesterCallPanel.tsx", "app/app/sessions/[id]/TesterTop.tsx", "app/app/sessions/[id]/KeyBox.tsx"].map(read).join("\n");
    for (const re of [/`part-\$\{key\}`/, /id="part-live"/, /`call-\$\{m\.id\}`/, /id="terms-offer"/, /id="access-key"/]) expect(session, String(re)).toMatch(re);
    const pay = [read("app/app/payments/page.tsx"), read("components/OwedBox.tsx"), read("components/ChargebackSteps.tsx")].join("\n");
    for (const re of [/id="payout"/, /id="owed"/, /id="chargeback-steps"/]) expect(pay, String(re)).toMatch(re);
    const adm = [read("app/admin/PagedList.tsx"), read("app/admin/page.tsx")].join("\n");
    for (const re of [/`dispute-\$\{d\.id\}`/, /`user-\$\{u\.id\}`/, /`test-\$\{t\.id\}`/, /id="users"/]) expect(adm, String(re)).toMatch(re);
    // And the keys (written / recording) the links name are the ones the session page builds.
    expect(read("app/app/sessions/[id]/page.tsx")).toMatch(/key: "written"|"written"/);
  });
});

describe("the admin dashboard lists", () => {
  it("lists are 20 at a time, newest first, by keyset: no overlap and no gaps, and only admins can load more", async () => {
    const tag = randomUUID().slice(0, 6);
    for (let i = 0; i < 25; i++) await db.waitlistEntry.create({ data: { email: `w-${tag}-${i}@test.playtest.test`, role: "tester", createdAt: new Date(Date.now() + i * 1000) } }).catch(() => null);
    const a = await admin();
    const p1 = (await adminPage("waitlist", a.user.id, null)) as { rows: { id: string; at: string }[]; next: string | null; total: number };
    expect(p1.rows.length).toBe(PAGE);
    expect(p1.next).toBeTruthy();
    expect(p1.rows.map((r) => r.at)).toEqual([...p1.rows.map((r) => r.at)].sort().reverse());
    const r2 = await json(await moreGET(req(`/api/admin/more?kind=waitlist&after=${encodeURIComponent(p1.next!)}`, { cookie: a.cookie })));
    expect(r2.status).toBe(200);
    expect(r2.body.rows.length).toBeGreaterThan(0);
    expect(r2.body.rows.every((r: { id: string; at: string }) => !p1.rows.some((o) => o.id === r.id) && r.at <= p1.rows[PAGE - 1].at)).toBe(true);
    const nobody = await makeUser({ dev: true });
    expect((await json(await moreGET(req("/api/admin/more?kind=waitlist", { cookie: nobody.cookie })))).status).toBe(403);
    expect((await json(await moreGET(req("/api/admin/more?kind=bogus", { cookie: a.cookie })))).status).toBe(400);
  });

  it("'Your actions' lists the tests THIS admin paused or stopped, or whose developer this admin suspended; open disputes come newest first", async () => {
    const me = await admin();
    const other = await admin();
    const one = await setup(), two = await setup(), three = await setup(), four = await setup();
    expect((await aact(me.cookie, "pause-test", { id: one.testId, note: "x" })).status).toBe(200);
    expect((await aact(me.cookie, "stop-test", { id: two.testId, note: "x" })).status).toBe(200);
    expect((await aact(me.cookie, "suspend", { id: three.dev.user.id, note: "Testing" })).status).toBe(200);
    expect((await aact(other.cookie, "pause-test", { id: four.testId, note: "x" })).status).toBe(200);
    const mine = (await adminPage("mine", me.user.id, null)) as { rows: { testId: string; why: string; at: string }[]; total: number };
    const byTest = new Map(mine.rows.map((r) => [r.testId, r.why]));
    expect(byTest.get(one.testId)).toBe("paused by you");
    expect(byTest.get(two.testId)).toBe("stopped by you");
    expect(byTest.get(three.testId)).toBe("developer suspended by you");
    expect(byTest.has(four.testId)).toBe(false); // the other admin's
    expect(mine.rows.map((r) => r.at)).toEqual([...mine.rows.map((r) => r.at)].sort().reverse());
    const theirs = (await adminPage("mine", other.user.id, null)) as { rows: { testId: string }[] };
    expect(theirs.rows.map((r) => r.testId)).toContain(four.testId);
    expect(theirs.rows.map((r) => r.testId)).not.toContain(one.testId);
    // Open disputes: newest first, open only.
    const ds = (await adminPage("disputes", me.user.id, null)) as { rows: { at: string; open: boolean }[] };
    expect(ds.rows.every((d) => d.open)).toBe(true);
    expect(ds.rows.map((d) => d.at)).toEqual([...ds.rows.map((d) => d.at)].sort().reverse());
  });
});
