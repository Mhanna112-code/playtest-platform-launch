import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { startHold } from "@/lib/server/holds";
import { blockUser } from "@/lib/server/blocks";
import { inviteOnlyHidden, noteJoinPageVisit, visitedTests } from "@/lib/server/testVisits";
import { POST as removePOST } from "@/app/api/visits/[testId]/route";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { json, makeUser, req } from "./helpers";
import { act, joined, seen, settle, setup } from "./fixtures";

// Batch 17 §18: "Tests visited" on the tester dashboard.
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const utcDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const pulse = async (cookie: string) => (await json(await pulseGET(req("/api/pulse?visited=1", { cookie, method: "GET" })))).body.v as string;
const remove = (testId: string, cookie: string) => removePOST(req(`/api/visits/${testId}`, { cookie, body: {} }), { params: Promise.resolve({ testId }) }).then(json);

/** A test by Nora and a tester (Ana) who opened its join page. */
async function visited(over: Record<string, unknown> = {}) {
  const s = await setup(over);
  const ana = await makeUser({ tester: true, name: "Ana Silva" });
  const t = await db.test.findUniqueOrThrow({ where: { id: s.testId } });
  expect(await noteJoinPageVisit(ana.user, t, false)).toBe(true);
  const rows = async () => visitedTests(ana.user.id);
  const card = async () => (await rows()).find((r) => r.testId === s.testId);
  return { ...s, ana, rows, card };
}

describe("Tests visited: the cards and their state now (Batch 17 §18)", () => {
  it("an open test: the test, its developer, \"Accepting testers\", opening the join page", async () => {
    const x = await visited();
    expect(await x.rows()).toEqual([expect.objectContaining({ testId: x.testId, title: "Harbor Run", developer: "Nora Lane", state: "Open", label: "Accepting testers", href: `/app/find/${x.testId}` })]);
  });

  it("full, joining closed, paused (a hold and the team's pause), stopped and closed", async () => {
    const full = await visited({ spots: 1 });
    await joined(full.testId, "Ben Okafor");
    expect(await full.card()).toMatchObject({ state: "Full", label: "Full" });

    const ou = await visited();
    const until = new Date(Date.now() - 60_000);
    await db.test.update({ where: { id: ou.testId }, data: { openUntil: until } });
    expect(await ou.card()).toMatchObject({ state: "Joining closed", label: `Closed to new testers on ${utcDay(until)}` });

    const held = await visited();
    await startHold(held.dev.user.id, "unpaid");
    expect(await held.card()).toMatchObject({ state: "Paused", label: "Paused" }); // never "hold" to a tester

    const teamPaused = await visited();
    await db.test.update({ where: { id: teamPaused.testId }, data: { adminPausedAt: new Date() } });
    expect(await teamPaused.card()).toMatchObject({ state: "Paused", label: "Paused" });

    const suspendedDev = await visited();
    await db.user.update({ where: { id: suspendedDev.dev.user.id }, data: { devSuspendedAt: new Date() } });
    expect(await suspendedDev.card()).toMatchObject({ state: "Paused", label: "Paused" }); // never "suspended" to a tester

    const stopped = await visited();
    expect((await act(stopped.testId, "stop", stopped.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await stopped.card()).toMatchObject({ state: "Stopped", label: "Stopped" });

    const closed = await visited();
    await db.test.update({ where: { id: closed.testId }, data: { status: "closed" } });
    expect(await closed.card()).toMatchObject({ state: "Closed", label: "Closed" });
  });

  it("applied (waiting), and invited (the card opens the invitation)", async () => {
    const ap = await visited({ joinMode: "apply" });
    expect((await act(ap.testId, "apply", ap.ana.cookie, { seenAt: seen(), note: "hi" })).status).toBe(200);
    expect(await ap.card()).toMatchObject({ state: "Applied", label: "Applied (waiting)", href: `/app/find/${ap.testId}` });

    const inv = await visited({ joinMode: "invite" });
    expect(await inv.card()).toMatchObject({ state: "Invite only", label: "Invite only" });
    expect((await act(inv.testId, "invite", inv.dev.cookie, { testerIds: [inv.ana.user.id], seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await inv.card()).toMatchObject({ state: "Invited", label: "Invited", href: `/app/find/${inv.testId}#invitation` });
    expect(src("app/app/find/[id]/page.tsx")).toContain('<section className="card flex flex-wrap items-start gap-3 border-emerald-400/30" id="invitation">');
  });

  it("invite only and not invited: the card says \"Invite only\" and the join page shows only \"This test isn't available right now.\"", async () => {
    const x = await visited({ joinMode: "invite" });
    expect(await x.card()).toMatchObject({ state: "Invite only", label: "Invite only" });
    const t = await db.test.findUniqueOrThrow({ where: { id: x.testId } });
    expect(await inviteOnlyHidden(t, x.ana.user.id)).toBe(true);
    // Full or past Open until changes nothing for them: still only the line.
    await db.test.update({ where: { id: x.testId }, data: { openUntil: new Date(Date.now() - 60_000) } });
    expect(await x.card()).toMatchObject({ state: "Invite only" });
    expect(await inviteOnlyHidden(await db.test.findUniqueOrThrow({ where: { id: x.testId } }), x.ana.user.id)).toBe(true);
    await db.test.update({ where: { id: x.testId }, data: { openUntil: new Date(Date.now() + 5 * 86_400_000) } });
    // Invited: the page shows the listing and the invitation; the developer cancels it: only the line again.
    expect((await act(x.testId, "invite", x.dev.cookie, { testerIds: [x.ana.user.id], seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await inviteOnlyHidden(t, x.ana.user.id)).toBe(false);
    const inv = await db.invite.findFirstOrThrow({ where: { testId: x.testId, testerId: x.ana.user.id, status: "sent" } });
    expect((await act(x.testId, "cancel-invite", x.dev.cookie, { inviteId: inv.id, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await inviteOnlyHidden(t, x.ana.user.id)).toBe(true);
    expect(await x.card()).toMatchObject({ state: "Invite only" });
    // The developer never gets the line on their own test; a stopped invite-only test keeps its own refusal.
    expect(await inviteOnlyHidden(t, x.dev.user.id)).toBe(false);
    expect(await inviteOnlyHidden({ ...t, status: "stopped" }, x.ana.user.id)).toBe(false);
    const page = src("app/app/find/[id]/page.tsx");
    expect(page).toContain("const inviteOnly = !isAdmin(u) && (await inviteOnlyHidden(t, u.id));");
    expect(page).toContain("if (((paused && !involved) || inviteOnly || (blocked && !involved && t.developerId !== u.id)) && !isAdmin(u)) {");
    expect(page).toContain('<p className="card note" data-unavailable="">This test isn&apos;t available right now.</p>');
  });
});

describe("Tests visited: what goes on and off the list (Batch 17 §18)", () => {
  it("most recent visit first; a second visit moves it up", async () => {
    const a = await visited();
    const b = await setup({ title: "Sky Forge", productName: "Sky Forge" });
    await settle();
    expect(await noteJoinPageVisit(a.ana.user, await db.test.findUniqueOrThrow({ where: { id: b.testId } }), false)).toBe(true);
    expect((await a.rows()).map((r) => r.title)).toEqual(["Sky Forge", "Harbor Run"]);
    await settle();
    await noteJoinPageVisit(a.ana.user, await db.test.findUniqueOrThrow({ where: { id: a.testId } }), false);
    expect((await a.rows()).map((r) => r.title)).toEqual(["Harbor Run", "Sky Forge"]);
    expect(await db.testVisit.count({ where: { testerId: a.ana.user.id } })).toBe(2); // one row per test, the last visit
  });

  it("Remove drops the card at once (no confirm); opening the join page again brings it back", async () => {
    const x = await visited();
    const r = await remove(x.testId, x.ana.cookie);
    expect(r.status).toBe(200);
    expect(await x.rows()).toEqual([]);
    // Someone else's Remove touches nothing of Ana's.
    await noteJoinPageVisit(x.ana.user, await db.test.findUniqueOrThrow({ where: { id: x.testId } }), false);
    const other = await makeUser({ tester: true });
    expect((await remove(x.testId, other.cookie)).status).toBe(200);
    expect((await x.rows()).map((r) => r.testId)).toEqual([x.testId]);
    expect(src("app/app/RemoveVisit.tsx")).toContain("<X className=\"h-3.5 w-3.5\" /> Remove");
    expect(src("app/app/RemoveVisit.tsx")).not.toContain("confirm(");
  });

  it("a visit then joining: it leaves the list (and stays off after leaving the test)", async () => {
    const x = await visited();
    const test = await db.test.findUniqueOrThrow({ where: { id: x.testId } });
    const r = await act(x.testId, "join", x.ana.cookie, { listingVersion: test.listingVersion });
    expect(r.status).toBe(200);
    expect(await x.rows()).toEqual([]);
    await db.contract.update({ where: { id: r.body.sessionId }, data: { status: "left", endedAt: new Date() } });
    expect(await x.rows()).toEqual([]);
  });

  it("not recorded for a test the tester is in (or was in), their own test, the team or someone not testing", async () => {
    const { testId, dev } = await setup();
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    const { tester } = await joined(testId);
    expect(await noteJoinPageVisit(tester.user, t, false)).toBe(false);
    await db.contract.updateMany({ where: { testId, testerId: tester.user.id }, data: { status: "left", endedAt: new Date() } });
    expect(await noteJoinPageVisit(tester.user, t, false)).toBe(false);
    expect(await noteJoinPageVisit({ ...dev.user, isTester: true }, t, false)).toBe(false);
    const admin = await makeUser({ tester: true });
    expect(await noteJoinPageVisit(admin.user, t, true)).toBe(false);
    const devOnly = await makeUser({ dev: true });
    expect(await noteJoinPageVisit(devOnly.user, t, false)).toBe(false);
    expect(await db.testVisit.count({ where: { testId } })).toBe(0);
    expect(src("app/app/find/[id]/page.tsx")).toContain("await noteJoinPageVisit(u, t, isAdmin(u));");
  });

  it("a test from a developer blocked either way is left out", async () => {
    const byTester = await visited();
    await blockUser({ id: byTester.ana.user.id, email: byTester.ana.user.email, name: "Ana Silva" }, byTester.dev.user.id);
    expect(await byTester.rows()).toEqual([]);

    const byDev = await visited();
    await blockUser({ id: byDev.dev.user.id, email: byDev.dev.user.email, name: "Nora Lane" }, byDev.ana.user.id);
    expect(await byDev.rows()).toEqual([]);
    // Unblocked: it comes back.
    await db.block.deleteMany({ where: { blockerId: byDev.dev.user.id } });
    expect((await byDev.rows()).map((r) => r.testId)).toEqual([byDev.testId]);
  });
});

describe("Tests visited: live on the dashboard's poll (Batch 17 §18)", () => {
  it("the fingerprint changes when a listed test's state changes, a card is removed or the test is joined", async () => {
    const x = await visited({ spots: 2 });
    let v = await pulse(x.ana.cookie);
    await joined(x.testId, "Ben Okafor");
    expect(await pulse(x.ana.cookie)).toBe(v); // a spot taken but still open: the same card
    await joined(x.testId, "Cam Reed");
    expect(await pulse(x.ana.cookie)).not.toBe(v); // full
    v = await pulse(x.ana.cookie);
    await db.test.update({ where: { id: x.testId }, data: { adminPausedAt: new Date() } });
    expect(await pulse(x.ana.cookie)).not.toBe(v); // paused
    v = await pulse(x.ana.cookie);
    await db.test.update({ where: { id: x.testId }, data: { adminPausedAt: null, status: "stopped" } });
    expect(await pulse(x.ana.cookie)).not.toBe(v); // stopped
    v = await pulse(x.ana.cookie);
    await remove(x.testId, x.ana.cookie);
    expect(await pulse(x.ana.cookie)).not.toBe(v);
    expect(await pulse(x.ana.cookie)).toBe("");

    const dash = src("app/app/page.tsx");
    expect(dash).toContain("{!suspended && <TestsVisited testerId={userId} />}");
    const box = src("app/app/TestsVisited.tsx");
    expect(box).toContain('<AutoRefresh query="visited=1" v={visitedV(rows)} />');
    expect(box).toContain('<ScrollList className="space-y-2" label="Tests visited">');
    expect(src("app/api/pulse/route.ts")).toContain('if (q.get("visited")) {');
  });
});
